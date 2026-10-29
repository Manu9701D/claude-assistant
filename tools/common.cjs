// Rutas y utilidades compartidas por tools/dev.cjs y tools/apply.cjs
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

// Esta carpeta puede ser la copia de pruebas (worktree) o la app en uso; la app en uso es la del repositorio principal
const DEV_DIR = path.resolve(__dirname, '..');
const PROD_DIR = path.resolve(path.dirname(git(DEV_DIR, 'rev-parse', '--path-format=absolute', '--git-common-dir')));
const EXE = path.join(PROD_DIR, 'runtime', 'Claude Assistant.exe');
const PROD_DATA = path.join(process.env.APPDATA, 'claude-assistant');
const DEV_DATA = path.join(process.env.APPDATA, 'claude-assistant-dev');

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

// PID de la instancia que usa esa carpeta de datos, si sigue abierta
function runningPid(dataDir) {
  const pid = readJson(path.join(dataDir, 'ready.json'))?.pid;
  if (!pid) return null;
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' });
    return out.includes('Claude Assistant.exe') ? pid : null;
  } catch { return null; }
}

// Entorno para lanzar la app: sin restos de ELECTRON_RUN_AS_NODE ni del perfil de quien lo lanza
function appEnv(profile) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CA_PROFILE;
  if (profile) env.CA_PROFILE = profile;
  return env;
}

// Pide a la app (la de pruebas o la de uso) que se reinicie: 'now' directamente, 'offer' preguntando.
// Es un archivo que la app vigila, así que no se ejecuta el código nuevo para avisarla.
const requestRestart = (dataDir, mode) => fs.writeFileSync(path.join(dataDir, 'restart-request.json'), JSON.stringify({ mode, at: Date.now() }));

async function waitReady(dataDir, since, ms = 45000) {
  for (let t = 0; t < ms; t += 500) {
    if ((readJson(path.join(dataDir, 'ready.json'))?.at || 0) >= since) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// Puerto de depuración (CDP) de la app de pruebas, que Chromium apunta al arrancar
const devtoolsPort = () => { try { return parseInt(fs.readFileSync(path.join(DEV_DATA, 'DevToolsActivePort'), 'utf8'), 10) || null; } catch { return null; } };

module.exports = { requestRestart, devtoolsPort, git, DEV_DIR, PROD_DIR, EXE, PROD_DATA, DEV_DATA, readJson, runningPid, appEnv, waitReady };
