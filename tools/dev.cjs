// App de pruebas: la copia de trabajo abierta como «Claude Assistant (pruebas)», con sus propios datos.
//   node tools/dev.cjs start [--sync-config]   abrirla (la primera vez copia tu configuración)
//   node tools/dev.cjs restart                 reiniciarla con los cambios, conservando sus pestañas
//   node tools/dev.cjs stop                    cerrarla
//   node tools/dev.cjs status
// Escucha CDP en un puerto libre (lo apunta en DevToolsActivePort); tools/cdp.cjs lo usa para inspeccionarla.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DEV_DIR, EXE, PROD_DATA, DEV_DATA, runningPid, appEnv, waitReady, devtoolsPort, requestRestart } = require('./common.cjs');

const [cmd = 'status', ...flags] = process.argv.slice(2);

function syncConfig(force) {
  const dst = path.join(DEV_DATA, 'config.json');
  if (fs.existsSync(dst) && !force) return;
  fs.mkdirSync(DEV_DATA, { recursive: true });
  fs.copyFileSync(path.join(PROD_DATA, 'config.json'), dst);
  console.log('Configuración copiada de tu app.');
}

async function start() {
  const pid = runningPid(DEV_DATA);
  if (pid) return console.log(`La app de pruebas ya está abierta (PID ${pid}).`);
  syncConfig(flags.includes('--sync-config'));
  const since = Date.now();
  const out = fs.openSync(path.join(DEV_DATA, 'app.log'), 'w');
  spawn(EXE, [DEV_DIR, '--remote-debugging-port=0'], { env: appEnv('dev'), detached: true, stdio: ['ignore', out, out] }).unref();
  if (await waitReady(DEV_DATA, since)) console.log(`App de pruebas abierta (CDP en el puerto ${devtoolsPort()}).`);
  else fail('La app de pruebas no ha llegado a arrancar.');
}

async function restart() {
  if (!runningPid(DEV_DATA)) return start();
  const since = Date.now();
  requestRestart(DEV_DATA, 'now');
  if (await waitReady(DEV_DATA, since)) console.log('App de pruebas reiniciada con sus pestañas.');
  else fail('La app de pruebas no ha vuelto a arrancar. Mira watchdog.log en ' + DEV_DATA + '.');
}

function stop() {
  const pid = runningPid(DEV_DATA);
  if (!pid) return console.log('La app de pruebas no está abierta.');
  try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
  console.log('App de pruebas cerrada.');
}

function fail(msg) {
  const log = path.join(DEV_DATA, 'app.log');
  console.error(`${msg}\nSalida de la app (${log}):\n${fs.existsSync(log) ? fs.readFileSync(log, 'utf8').slice(-3000) : '(vacía)'}`);
  process.exitCode = 1;
}

const actions = {
  start,
  restart,
  stop,
  status: () => {
    const pid = runningPid(DEV_DATA);
    console.log(pid ? `Abierta (PID ${pid}, CDP en el puerto ${devtoolsPort()}).` : 'Cerrada.');
  },
};
if (!actions[cmd]) fail(`Orden desconocida: ${cmd}`);
else Promise.resolve(actions[cmd]()).catch((e) => fail(String(e?.message || e)));
