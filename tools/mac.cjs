// Probar la app en un Mac de la red por SSH (alias «mac» de ~/.ssh/config, o CA_MAC=usuario@ip).
// Copia la fuente limpia (sin personal.mjs, como las copias para otros) a ~/claude-assistant-pruebas
// y la abre desde el código con el perfil de pruebas y CDP en el puerto 9223 (node tools/cdp.cjs --mac).
//   node tools/mac.cjs sync      copia la fuente (npm install si cambia package.json)
//   node tools/mac.cjs start     copia y abre la app      ·  restart: copia, cierra y abre  ·  stop: la cierra
//   node tools/mac.cjs run "<cmd>"   ejecuta un comando en la carpeta de la app del Mac
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { prepareSource } = require('./build-src.cjs');

const HOST = process.env.CA_MAC || 'mac';
const DIR = 'claude-assistant-pruebas'; // en el home del Mac
const PORT = 9223;
// Homebrew, el instalador de Claude Code y el de nodejs.org no están en el PATH de una sesión SSH
const ENV = 'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; cd ~/' + DIR + ' 2>/dev/null;';

function ssh(cmd, opts = {}) {
  const r = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', HOST, ENV + cmd], { stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (r.status !== 0 && !opts.ok) throw new Error(`Falla en el Mac (${r.status}): ${cmd}`);
  return (r.stdout || '').trim();
}

async function sync() {
  const src = path.join(os.tmpdir(), 'claude-assistant-mac');
  const pkg = prepareSource(src, {});
  // Desde el código no hace falta electron-builder (solo para las copias empaquetadas)
  delete pkg.devDependencies['electron-builder'];
  delete pkg.build;
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify(pkg, null, 2));
  const stamp = crypto.createHash('sha1').update(JSON.stringify([pkg.dependencies, pkg.devDependencies])).digest('hex');

  // Fuera lo anterior salvo node_modules (así no quedan archivos borrados) y dentro lo nuevo
  ssh(`mkdir -p ~/${DIR} && cd ~/${DIR} && find . -mindepth 1 -maxdepth 1 ! -name node_modules ! -name .stamp -exec rm -rf {} +`);
  await new Promise((resolve, reject) => {
    const tar = spawn('tar', ['-C', src, '-cf', '-', '.'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const up = spawn('ssh', ['-o', 'BatchMode=yes', HOST, `tar -C ~/${DIR} -xf -`], { stdio: ['pipe', 'inherit', 'inherit'] });
    tar.stdout.pipe(up.stdin);
    up.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('No se ha podido copiar la fuente al Mac.'))));
  });
  fs.rmSync(src, { recursive: true, force: true });

  if (ssh('cat .stamp 2>/dev/null', { capture: true, ok: true }) !== stamp) {
    console.log('npm install en el Mac…');
    ssh(`npm install --no-audit --no-fund && echo ${stamp} > .stamp`);
  }
  // A veces npm no llega a bajar el binario de Electron (su postinstall)
  ssh('[ -d node_modules/electron/dist/Electron.app ] || node node_modules/electron/install.js');
  // node-pty trae su spawn-helper sin permiso de ejecución: sin él, ninguna pestaña arranca Claude Code
  ssh('find node_modules/node-pty -name spawn-helper -exec chmod 755 {} +', { ok: true });
  console.log(`Copiado en ${HOST}:~/${DIR}`);
}

const stop = () => ssh(`pkill -f -- '--remote-debugging-port=${PORT}'; sleep 1`, { ok: true });

function start() {
  // open: se abre en la sesión gráfica del Mac (desde SSH no tendría Dock ni permisos de la sesión)
  ssh(`open -n node_modules/electron/dist/Electron.app --env CA_PROFILE=dev --args "$HOME/${DIR}" --remote-debugging-port=${PORT}`);
  console.log(`Abierta en el Mac (CDP: node tools/cdp.cjs --mac …)`);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'sync') await sync();
  else if (cmd === 'start') { await sync(); start(); }
  else if (cmd === 'restart') { await sync(); stop(); start(); }
  else if (cmd === 'stop') stop();
  else if (cmd === 'run') ssh(arg, { ok: true });
  else { console.error('Uso: node tools/mac.cjs sync | start | restart | stop | run "<cmd>"'); process.exitCode = 1; }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
