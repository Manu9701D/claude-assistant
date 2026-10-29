// Vuelve a abrir la app cuando se cierra para reiniciarse (lo lanza restartApp() en main.mjs con
// ELECTRON_RUN_AS_NODE). Si la versión nueva no llega a arrancar y hay un commit anterior al que
// volver, deja la app en ese commit y la abre otra vez. Deja un registro en watchdog.log.
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cfg = JSON.parse(process.env.CA_WATCH);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CA_WATCH;

const READY = path.join(cfg.dataDir, 'ready.json');
const START_TIMEOUT = 45000;

const trace = (msg) => { try { fs.appendFileSync(path.join(cfg.dataDir, 'watchdog.log'), `${new Date().toISOString()} ${msg}\n`); } catch {} };
process.on('uncaughtException', (e) => { trace(`error: ${e.stack || e}`); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readyAt = () => { try { return JSON.parse(fs.readFileSync(READY, 'utf8')).at || 0; } catch { return 0; } };

// Con Start-Process (ShellExecute) la app nueva no hereda los handles que este proceso heredó de la
// anterior (con spawn se quedaría, por ejemplo, con su puerto de depuración). Devuelve su PID.
function launch() {
  // Start-Process une los argumentos con espacios sin entrecomillarlos: los que llevan espacios van entre comillas
  const args = cfg.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).map((a) => `'${a.replace(/'/g, "''")}'`).join(',');
  const ps = `(Start-Process -FilePath '${cfg.exe.replace(/'/g, "''")}' -ArgumentList ${args} -PassThru).Id`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
    { env, encoding: 'utf8', windowsHide: true });
  const pid = parseInt(r.stdout, 10);
  if (!pid) trace(`no se pudo abrir: ${(r.stderr || '').replace(/\s+/g, ' ').slice(0, 500)}`);
  return pid;
}

async function started(since) {
  for (let t = 0; t < START_TIMEOUT; t += 500) {
    if (readyAt() >= since) return true;
    await sleep(500);
  }
  return false;
}

(async () => {
  // Espera a que la app anterior suelte el bloqueo de instancia única
  for (let i = 0; i < 80 && alive(cfg.pid); i++) await sleep(250);
  if (alive(cfg.pid)) { try { process.kill(cfg.pid); } catch {} await sleep(1000); }

  trace(`anterior cerrada (${cfg.pid}); abriendo ${cfg.args.join(' ')}`);
  const since = Date.now();
  const pid = launch();
  const ok = pid && await started(since);
  trace(ok ? `arrancada (${pid})` : `no ha arrancado en ${START_TIMEOUT / 1000} s`);
  if (ok || !cfg.prev) return;

  // No ha arrancado: se cierra lo que haya quedado y se vuelve al commit anterior
  if (pid) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {} }
  execFileSync('git', ['-C', cfg.appDir, 'reset', '--hard', cfg.prev], { stdio: 'ignore' });
  fs.writeFileSync(path.join(cfg.dataDir, 'update-note.json'), JSON.stringify({ rolledBack: true, to: cfg.prev, at: Date.now() }));
  trace(`vuelta a ${cfg.prev}`);
  await sleep(500);
  launch();
})();
