// Herramienta del preset «Mejorar Claude Assistant» (ver CLAUDE.md). Se ejecuta con el Node de la propia app
// mediante mejorar/ca (macOS y Linux) o mejorar\ca.cmd (Windows), que escribe la app al arrancar junto con
// mejorar/entorno.json (dónde está instalada, su carpeta de datos y su versión).
//   ca estado                  qué versión se usa, cambios hechos y si la instalada es más nueva
//   ca prueba                  abre (o reabre) la instancia de pruebas con el código de esta carpeta
//   ca parar                   cierra la instancia de pruebas
//   ca captura [archivo.png]   captura de su ventana (dice dónde la deja)
//   ca eval "<js>"             ejecuta JavaScript en su interfaz (admite promesas; p. ej. state.convs)
//   ca registros               lo último de errores.log y cuelgues.log (la app en uso y la de pruebas)
//   ca comprobar               revisa la sintaxis de todo el código
//   ca aplicar "qué cambia"    comprueba, guarda en git y pide a la app reiniciarse con esta versión
//   ca original                vuelve a la versión instalada (los cambios se quedan aquí)
//   ca actualizar              tras instalar una versión nueva: la trae y mezcla los cambios (git merge)
//   ca parche                  guarda los cambios en un .patch para compartirlos
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// La copia editable: mejorar/ca ejecuta la herramienta de la app instalada (la de la copia puede ser de una
// versión anterior, o faltar) y le dice aquí dónde está la copia
const DIR = process.env.CA_SELF_DIR ? path.resolve(process.env.CA_SELF_DIR) : path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const ENV = JSON.parse(fs.readFileSync(path.join(DIR, 'mejorar', 'entorno.json'), 'utf8'));
const STATE = path.join(ENV.data, 'mejoras.json');
// La que arranca la app: copia congelada al aplicar (así no arranca nunca algo a medio editar)
const APPLIED = path.join(ENV.data, 'mejoras', 'aplicada');
// Versión instalada: de su build.json (entorno.json se renueva al arrancar la app y puede ir por detrás)
const BUILD = read(path.join(ENV.original, 'build.json'))?.id || ENV.build;
const TEST_DATA = path.join(path.dirname(ENV.data), 'claude-assistant-prueba');
const PID_FILE = path.join(TEST_DATA, 'prueba.pid');
const PORT = 9333;
const SKIP = new Set(['node_modules', 'out', '.git', 'dist']);

const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const git = (...args) => spawnSync('git', args, { cwd: DIR, encoding: 'utf8', windowsHide: true });
const hasGit = () => git('rev-parse', '--git-dir').status === 0;
const die = (msg) => { console.error(msg); process.exit(1); };
// Electron como Node (ELECTRON_RUN_AS_NODE) para revisar la sintaxis; la instancia de pruebas, sin ello
const appEnv = (extra = {}) => { const e = { ...process.env, ...extra }; delete e.ELECTRON_RUN_AS_NODE; return e; };

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function stop() {
  const pid = read(PID_FILE)?.pid;
  if (!pid || !alive(pid)) return false;
  if (ENV.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else { try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch {} } }
  return true;
}

async function page() {
  const pages = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const p = pages.find((x) => x.type === 'page' && x.url.includes('index.html'));
  if (!p) throw new Error('La instancia de pruebas no tiene ventana');
  return p;
}

async function cdp(fn) {
  let p;
  try { p = await page(); } catch { die('La instancia de pruebas no está abierta: ca prueba'); }
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const call = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  try { return await fn(call); } finally { ws.close(); }
}

async function startTest() {
  stop();
  await sleep(800);
  // Sin la puesta a punto del primer arranque, que taparía la ventana
  const cfgFile = path.join(TEST_DATA, 'config.json');
  if (!fs.existsSync(cfgFile)) write(cfgFile, { setupDone: true });
  fs.mkdirSync(TEST_DATA, { recursive: true });
  const out = fs.openSync(path.join(TEST_DATA, 'salida.log'), 'w');
  const child = spawn(ENV.exe, [...ENV.exeArgs, `--remote-debugging-port=${PORT}`], {
    env: appEnv({ CA_PROFILE: 'prueba', CA_SOURCE: DIR }), detached: true, stdio: ['ignore', out, out], windowsHide: false,
  });
  child.unref();
  write(PID_FILE, { pid: child.pid });
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    if (!alive(child.pid)) break;
    try {
      await page();
      const ready = await cdp(async (call) => (await call('Runtime.evaluate', { expression: 'typeof state !== "undefined" && !!state.config', returnByValue: true })).result?.result?.value);
      if (ready) { console.log('Instancia de pruebas abierta (ventana «Claude Assistant» aparte, con datos de prueba).'); return; }
    } catch {}
  }
  console.error('La instancia de pruebas no ha llegado a abrir su ventana. Lo que ha escrito:');
  console.error(fs.readFileSync(path.join(TEST_DATA, 'salida.log'), 'utf8').slice(-3000));
  showLogs(TEST_DATA);
  process.exit(1);
}

function tail(file, lines = 30) {
  try { return fs.readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n'); } catch { return ''; }
}
function showLogs(...dirs) {
  for (const d of dirs) for (const f of ['errores.log', 'cuelgues.log']) {
    const t = tail(path.join(d, f));
    if (t) console.log(`\n── ${path.join(d, f)}\n${t}`);
  }
}

function sourceFiles(dir = DIR, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(dir, r));
    else if (/\.(mjs|cjs|js)$/.test(e.name)) out.push(r);
  }
  return out;
}

function check() {
  const bad = [];
  for (const f of sourceFiles()) {
    const r = spawnSync(ENV.exe, ['--check', path.join(DIR, f)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) bad.push(`${f}\n${(r.stderr || '').trim()}`);
  }
  if (bad.length) die(`Errores de sintaxis:\n\n${bad.join('\n\n')}`);
  console.log('Sintaxis bien.');
}

// Copia la carpeta (sin dependencias ni git) a la aplicada; node_modules lo enlaza boot.mjs al arrancar
function freeze() {
  const tmp = `${APPLIED}.nueva`;
  removeTree(tmp);
  fs.mkdirSync(tmp, { recursive: true });
  for (const e of fs.readdirSync(DIR)) if (!SKIP.has(e)) fs.cpSync(path.join(DIR, e), path.join(tmp, e), { recursive: true });
  // Primero se aparta la anterior: si algo la tiene abierta, falla aquí sin dejarla a medias
  const old = `${APPLIED}.vieja`;
  removeTree(old);
  if (fs.existsSync(APPLIED)) fs.renameSync(APPLIED, old);
  fs.renameSync(tmp, APPLIED);
  try { removeTree(old); } catch {}
}

// Borra una carpeta quitando antes los enlaces de primer nivel (node_modules): rmSync con recursive, en
// Windows, vaciaría la carpeta a la que apunta un junction
function removeTree(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) if (fs.lstatSync(path.join(dir, e)).isSymbolicLink()) fs.unlinkSync(path.join(dir, e));
  fs.rmSync(dir, { recursive: true, force: true });
}

function requestRestart(text) {
  write(path.join(ENV.data, 'restart-request.json'), { mode: 'offer', text });
  console.log('La app ofrecerá reiniciarse (ahora, al terminar las pestañas o más tarde). Esta conversación se reabre sola.');
}

const [cmd, arg] = process.argv.slice(2);
const s = read(STATE, {});

switch (cmd) {
  case 'estado': {
    console.log(`Versión instalada: ${BUILD} (${ENV.original})`);
    console.log(`En uso: ${s.activa ? `la mejorada (aplicada${s.commit ? ` en ${s.commit}` : ''})` : 'la original'}${!s.activa && s.motivo ? ` — motivo: ${s.motivo}` : ''}`);
    if (s.base && s.base !== BUILD) console.log(`La versión aplicada partía de ${s.base}: integra la nueva (ca actualizar), pruébala y aplícala.`);
    if (hasGit()) {
      console.log(`\nCambios propios (original..main):\n${git('log', '--oneline', 'original..HEAD').stdout || '(ninguno)\n'}`);
      const st = git('status', '--short').stdout;
      if (st) console.log(`Sin guardar:\n${st}`);
    } else console.log('\n(Sin git: no hay historial de cambios.)');
    break;
  }
  case 'prueba': await startTest(); break;
  case 'parar': console.log(stop() ? 'Cerrada.' : 'No estaba abierta.'); break;
  case 'captura': {
    const file = path.resolve(arg || path.join(os.tmpdir(), 'captura-prueba.png'));
    const r = await cdp((call) => call('Page.captureScreenshot', { format: 'png' }));
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log(file);
    break;
  }
  case 'eval': {
    if (!arg) die('Uso: ca eval "<js>"');
    const r = (await cdp((call) => call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true }))).result;
    if (r.exceptionDetails) die(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    console.log(JSON.stringify(r.result.value, null, 2) ?? String(r.result.description));
    break;
  }
  case 'registros': showLogs(ENV.data, TEST_DATA); break;
  case 'comprobar': check(); break;
  case 'aplicar': {
    check();
    if (hasGit()) {
      // La rama original tiene que ser la versión instalada: si no, faltaría integrar la nueva
      if (!git('log', '-1', '--format=%s', 'original').stdout.includes(`(${BUILD})`)) die('La app instalada es de otra versión que la rama original: primero ca actualizar.');
      git('add', '-A');
      const c = git('commit', '-q', '-m', arg || 'Cambios');
      if (c.status !== 0 && !/nothing to commit|nada para hacer commit/i.test(c.stdout + c.stderr)) die(c.stderr || c.stdout);
    }
    freeze();
    const commit = hasGit() ? git('rev-parse', '--short', 'HEAD').stdout.trim() : '';
    write(STATE, { ...s, activa: true, base: BUILD, commit, intento: 0, fallos: 0, motivo: '' });
    requestRestart('Los cambios ya están listos. Reinicia la app para usarlos: tus pestañas se volverán a abrir con su conversación.');
    break;
  }
  case 'original': {
    write(STATE, { ...s, activa: false, motivo: 'a mano', intento: 0 });
    requestRestart('La app volverá a la versión instalada (tus cambios se conservan). Reiníciala para usarla: tus pestañas se volverán a abrir con su conversación.');
    break;
  }
  case 'actualizar': {
    if (!hasGit()) die('Hace falta git para integrar los cambios con la versión nueva.');
    if (git('status', '--porcelain').stdout.trim()) die('Hay cambios sin guardar: guárdalos antes (git commit) o descártalos.');
    const tmp = path.join(os.tmpdir(), `ca-original-${Date.now()}`);
    if (git('worktree', 'add', '-q', tmp, 'original').status !== 0) die('No se ha podido preparar la rama original.');
    try {
      for (const e of fs.readdirSync(tmp)) if (e !== '.git') fs.rmSync(path.join(tmp, e), { recursive: true, force: true });
      for (const e of fs.readdirSync(ENV.original)) if (!SKIP.has(e)) fs.cpSync(path.join(ENV.original, e), path.join(tmp, e), { recursive: true, dereference: true });
      if (fs.existsSync(path.join(tmp, 'mejorar', 'CLAUDE.md'))) fs.copyFileSync(path.join(tmp, 'mejorar', 'CLAUDE.md'), path.join(tmp, 'CLAUDE.md'));
      fs.writeFileSync(path.join(tmp, '.gitignore'), fs.readFileSync(path.join(DIR, '.gitignore')));
      spawnSync('git', ['add', '-A'], { cwd: tmp });
      spawnSync('git', ['commit', '-q', '--allow-empty', '-m', `Versión original (${BUILD})`], { cwd: tmp }); // vacío si solo cambia la versión
    } finally {
      git('worktree', 'remove', '--force', tmp);
    }
    const m = git('merge', '--no-edit', 'original');
    if (m.status !== 0) {
      console.log(`Hay conflictos entre los cambios propios y la versión nueva:\n${git('diff', '--name-only', '--diff-filter=U').stdout}`);
      console.log('Resuélvelos, git add + git commit, pruébalo (ca prueba) y aplícalo (ca aplicar).');
      process.exit(2);
    }
    console.log('Versión nueva integrada sin conflictos. Pruébala (ca prueba) y aplícala (ca aplicar).');
    break;
  }
  case 'parche': {
    if (!hasGit()) die('Hace falta git para sacar el parche.');
    const desk = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Escritorio')].find((d) => fs.existsSync(d)) || os.homedir();
    const file = path.join(desk, `claude-assistant-mejoras-${new Date().toISOString().slice(0, 10)}.patch`);
    const r = git('format-patch', '--stdout', 'original..HEAD');
    if (!r.stdout.trim()) die('No hay cambios propios que exportar.');
    fs.writeFileSync(file, r.stdout);
    console.log(file);
    break;
  }
  default:
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   ')).map((l) => l.slice(5)).join('\n'));
}
