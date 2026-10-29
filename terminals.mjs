// Modo terminal: cada pestaña ejecuta el `claude` interactivo de siempre en una pseudoconsola
// (node-pty) y la interfaz lo pinta con xterm.js. Sin SDK: gasta exactamente lo que la terminal.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import pty from 'node-pty';

const HOME = os.homedir();
// Texto de Claude Code al preguntar si confías en la carpeta (sin espacios: la terminal mueve el cursor en vez de escribirlos)
const TRUST_ASK = /itrustthisfolder/i;
// Aviso del modo de acceso total la primera vez en un equipo (hasta aceptarlo, Claude Code no arranca)
const BYPASS_ASK = /BypassPermissionsmode.*Yes,Iaccept/i;
const BUFFER_MAX = 400 * 1024; // salida que se guarda para volver a pintar la pestaña si se recarga la interfaz

// macOS y Linux: node-pty lanza cada terminal con su spawn-helper, que a veces llega sin permiso de
// ejecución (el de prebuilds/, al instalar o empaquetar) y entonces ninguna pestaña arranca
// («posix_spawnp failed»). Se le devuelve una vez, antes de la primera pestaña.
let helperChecked = process.platform === 'win32';
function ensureSpawnHelper() {
  if (helperChecked) return;
  helperChecked = true;
  try {
    const dir = path.dirname(createRequire(import.meta.url).resolve('node-pty/package.json'));
    for (const f of [path.join(dir, 'build', 'Release', 'spawn-helper'), path.join(dir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper')]) {
      try { if (!(fs.statSync(f).mode & 0o111)) fs.chmodSync(f, 0o755); } catch {}
    }
  } catch {}
}

// El Claude Code de la terminal (el que se actualiza solo); si no está, el que trae el SDK
export function terminalClaude(configured, appDir) {
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = [
    configured,
    path.join(HOME, '.local', 'bin', exe),
    ...(process.env.PATH || '').split(path.delimiter).map((d) => path.join(d, exe)),
    path.join(appDir, 'node_modules', '@anthropic-ai', `claude-agent-sdk-${process.platform}-${process.arch}`, exe),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || exe;
}

// ¿Hay transcripción de esa sesión? (para retomarla con --resume tras un reinicio)
export function sessionExists(id) {
  const root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'projects');
  try { return fs.readdirSync(root).some((d) => fs.existsSync(path.join(root, d, `${id}.jsonl`))); } catch { return false; }
}

/**
 * @param {object} o
 * @param {(tab) => { file, args, cwd, env }} o.command  qué lanzar para una pestaña
 * @param {(channel, payload) => void} o.send
 * @param {{ add, kill }} o.jobs  Job Objects de cada pestaña
 * @param {{ start?, exit?, title?, fail?, notice? }} [o.on]  avisos: arranque, salida, título (OSC), problemas al arrancar y preguntas de Claude Code que esperan al usuario ('bypass')
 */
export function createTerminals({ command, send, jobs, on = {} }) {
  const tabs = new Map(); // id -> { conv, proc, buffer, started }

  function create(conv) {
    tabs.set(conv.id, { conv, proc: null, buffer: '', pending: '', flush: null, titleTail: '', title: '' });
    return conv;
  }

  // Se agrupa la salida (~60 por segundo) para no saturar el IPC
  function emit(t, data) {
    t.buffer += data;
    if (t.buffer.length > BUFFER_MAX) t.buffer = t.buffer.slice(-BUFFER_MAX);
    t.pending += data;
    if (!t.flush) {
      t.flush = setTimeout(() => {
        t.flush = null;
        send('pty:data', { id: t.conv.id, data: t.pending });
        t.pending = '';
      }, 16);
    }
  }

  function start(id, { cols = 120, rows = 30 } = {}) {
    const t = tabs.get(id);
    if (!t) return null;
    if (t.proc) return { buffer: t.buffer, running: true };
    t.buffer = '';
    let proc;
    ensureSpawnHelper();
    try {
      const { file, args, cwd, env } = command(t.conv); // puede fallar (p. ej. la cuenta pide iniciar sesión)
      proc = pty.spawn(file, args, { name: 'xterm-256color', cols, rows, cwd, env, useConpty: true });
    } catch (err) {
      emit(t, `\r\n\x1b[31mNo se pudo abrir Claude Code: ${err.message}\x1b[0m\r\n`);
      on.fail?.(id, err);
      return { buffer: t.buffer, running: false };
    }
    t.proc = proc;
    t.conv.started = true;
    // Desde la primera vez, retomar esta sesión si se vuelve a abrir (salida, reinicio)
    t.conv.resume = true;
    if (proc.pid) jobs.add(id, proc.pid);
    // «¿Confías en esta carpeta?»: las carpetas son las de tus presets (con el SDK no se preguntaba).
    // En la carpeta de usuario Claude Code no lo recuerda y lo preguntaría cada vez.
    // (texto de Claude Code: si cambia, la pestaña se queda en la pregunta y hay que contestarla en la terminal)
    // El aviso del acceso total no se contesta solo: lo acepta el usuario (en la terminal o en la puesta a punto)
    let screenCheck = '', trusted = false;
    const checkUntil = Date.now() + 20000;
    t.bypassAsk = false;
    proc.onData((d) => {
      if (screenCheck !== null) {
        screenCheck = (screenCheck + d).slice(-4000);
        // Sin códigos de control ni espacios: la terminal mueve el cursor en vez de escribir espacios
        const flat = screenCheck.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\s/g, '');
        if (!trusted && TRUST_ASK.test(flat)) {
          trusted = true;
          screenCheck = '';
          setTimeout(() => { proc.write('\x1b[B'); setTimeout(() => proc.write('\r'), 150); }, 300);
        } else if (!t.bypassAsk && BYPASS_ASK.test(flat)) {
          t.bypassAsk = true;
          screenCheck = '';
          on.notice?.(id, 'bypass');
        }
        if (Date.now() > checkUntil) screenCheck = null;
      }
      watchTitle(t, d);
      emit(t, d);
    });
    on.start?.(id);
    // Sin título de Claude Code, la vista de chat no sabe si está listo ni si trabaja: se apunta lo
    // que hay en pantalla para ver por qué (su bienvenida la primera vez, un cambio de versión…)
    setTimeout(() => {
      if (t.proc !== proc || t.title) return;
      const screen = t.buffer.slice(-4000).replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>78()][A-Z0-9]?/g, ' ')
        .replace(/[^\S\n]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      on.fail?.(id, new Error(`Claude Code no ha puesto su título en 20 s. En pantalla:\n${screen.slice(-1500)}`), { silent: true });
    }, 20000);
    proc.onExit(({ exitCode }) => {
      if (t.proc !== proc) return;
      t.proc = null;
      clearTimeout(t.flush);
      t.flush = null;
      if (t.pending) { send('pty:data', { id, data: t.pending }); t.pending = ''; }
      send('pty:exit', { id, code: exitCode });
      on.exit?.(id);
    });
    return { buffer: '', running: true };
  }

  // Título de la ventana (OSC 0/2): Claude Code pone ✳ en espera y un spinner mientras trabaja
  function watchTitle(t, d) {
    if (!on.title) return;
    const text = t.titleTail + d;
    const re = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let m, last = null, end = 0;
    while ((m = re.exec(text))) { last = m[1]; end = re.lastIndex; }
    const rest = text.slice(end);
    const open = rest.lastIndexOf('\x1b]');
    t.titleTail = open >= 0 ? rest.slice(open).slice(0, 400) : '';
    if (last !== null && last !== t.title) { t.title = last; on.title(t.conv.id, last); }
  }

  const write = (id, data) => tabs.get(id)?.proc?.write(data);
  function resize(id, cols, rows) {
    const p = tabs.get(id)?.proc;
    if (p && cols > 1 && rows > 1) { try { p.resize(cols, rows); } catch {} }
  }
  function close(id) {
    const t = tabs.get(id);
    if (!t) return;
    tabs.delete(id);
    clearTimeout(t.flush);
    jobs.collect?.(id); // macOS: sus descendientes, antes de que se queden huérfanos
    try { t.proc?.kill(); } catch {}
    setTimeout(() => jobs.kill(id), 1500);
  }
  // Vuelve a lanzar la pestaña (al cambiar de cuenta): se cierra el proceso y la interfaz la reabre,
  // retomando la conversación. false si no estaba en marcha (ya usará lo nuevo al abrirse).
  function restart(id) {
    const t = tabs.get(id);
    if (!t?.proc) return false;
    const proc = t.proc;
    t.proc = null; // así su salida no se avisa como un cierre
    clearTimeout(t.flush);
    t.flush = null;
    t.pending = '';
    on.exit?.(id);
    // Hasta que el anterior no ha salido, el nuevo chocaría con él (mismo id de sesión)
    let sent = false;
    const relaunch = () => { if (!sent) { sent = true; send('pty:restart', { id }); } };
    proc.onExit(() => setTimeout(relaunch, 300));
    setTimeout(relaunch, 5000);
    try { proc.kill(); } catch { relaunch(); }
    return true;
  }
  const closeAll = () => { for (const id of [...tabs.keys()]) { try { tabs.get(id).proc?.kill(); } catch {} } };

  return {
    create, start, restart, write, resize, close, closeAll,
    // Aceptado el acceso total en la puesta a punto: se contesta el aviso en las pestañas que lo tienen delante
    acceptBypass() {
      for (const t of tabs.values()) {
        if (!t.proc || !t.bypassAsk || t.title) continue;
        t.bypassAsk = false;
        const p = t.proc;
        p.write('\x1b[B');
        setTimeout(() => p.write('\r'), 150);
      }
    },
    has: (id) => tabs.has(id),
    get: (id) => tabs.get(id)?.conv,
    list: () => [...tabs.values()].map((t) => t.conv),
    buffer: (id) => tabs.get(id)?.buffer || '',
    running: (id) => !!tabs.get(id)?.proc,
    pid: (id) => tabs.get(id)?.proc?.pid || null,
  };
}
