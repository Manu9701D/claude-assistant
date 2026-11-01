// Cuelgues, apuntados en cuelgues.log de la carpeta de datos:
// - Una interfaz deja de responder: se pausa su JavaScript con el depurador (llega aunque esté en un bucle)
//   y se apunta dónde estaba (la pila); al volver, cuánto ha durado.
// - El proceso principal se bloquea: cuánto, qué mensaje de la interfaz estaba atendiendo (ipcMain envuelto)
//   y su pila (la saca un hilo aparte, ver mainStack).
// No hace nada mientras todo va bien: un temporizador cada 500 ms y una marca por mensaje.
import { app, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export function watchHangs(dataDir, describe = () => '') {
  const file = path.join(dataDir, 'cuelgues.log');
  const write = (text) => {
    try {
      try { if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.1`); } catch {}
      fs.appendFileSync(file, `${new Date().toISOString()} ${text}\n`);
    } catch {}
  };
  const where = () => { try { return describe() || ''; } catch { return ''; } };

  // Proceso principal: qué mensaje se atiende ahora (la parte síncrona, que es la que bloquea)
  let busy = null;
  const wrap = (channel, fn) => function (...args) {
    const prev = busy;
    busy = { channel, at: Date.now() };
    try { return fn.apply(this, args); } finally { busy = prev; }
  };
  for (const m of ['handle', 'handleOnce', 'on', 'once']) {
    const orig = ipcMain[m].bind(ipcMain);
    ipcMain[m] = (channel, fn) => orig(channel, wrap(channel, fn));
  }
  // El temporizador llega tarde si el proceso ha estado bloqueado. Durante el bloqueo no corre nada: el
  // mensaje en curso es el último que vio el segundo temporizador (como mucho 100 ms antes)
  let last = Date.now();
  let seen = null;
  const beat = mainStack(write, file);
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 500;
    if (lag > 1500) write(`proceso principal bloqueado ${lag} ms${seen ? ` (atendiendo «${seen.channel}»)` : ''}${where() ? ` · ${where()}` : ''}`);
    last = now;
  }, 500).unref();
  setInterval(() => { seen = busy; beat(); }, 100).unref();

  // Interfaces (ventanas, vistas y webviews del panel)
  // El aviso de Chromium ('unresponsive') tarda ~15 s y solo salta si se le manda algo (un clic, una tecla):
  // además se le pregunta cada 2 s si está viva; sin respuesta en 4 s, se le saca la pila
  app.on('web-contents-created', (_e, wc) => {
    let since = 0;
    let asking = false;
    const label = () => `${wc.getType()} ${wc.id}${wc.getType() === 'webview' ? ` ${String(wc.getURL()).replace(/\/[0-9a-f]{16,}\//, '/…/').slice(0, 120)}` : ''}`;
    const hung = async (why) => {
      if (since) return;
      since = Date.now();
      write(`${label()} no responde (${why})${where() ? ` · ${where()}` : ''}`);
      const stack = await pauseStack(wc).catch((err) => `  (sin pila: ${err.message})`);
      write(`${label()} pila:\n${stack}`);
    };
    const back = () => {
      if (!since) return;
      write(`${label()} vuelve a responder tras ${Math.round((Date.now() - since) / 1000)} s`);
      since = 0;
    };
    wc.on('unresponsive', () => hung('aviso de Chromium'));
    wc.on('responsive', back);
    if (wc.getType() === 'webview') return; // las del panel van en su proceso: no congelan la app
    // El depurador se activa ya: con el hilo bloqueado, Debugger.enable no llegaría (Debugger.pause sí)
    wc.on('dom-ready', () => armDebugger(wc));
    const timer = setInterval(() => {
      if (wc.isDestroyed()) { clearInterval(timer); return; }
      if (asking || wc.isLoading() || wc.isCrashed()) return;
      asking = true;
      const t = setTimeout(() => { if (asking) hung('no contesta en 4 s'); }, 4000);
      wc.executeJavaScript('1', false).then(() => { clearTimeout(t); asking = false; back(); }, () => { clearTimeout(t); asking = false; });
    }, 2000);
    timer.unref();
    wc.once('destroyed', () => clearInterval(timer));
  });

  return { log: write };
}

// Pila del proceso principal bloqueado: mientras está bloqueado no corre nada suyo, así que la saca un hilo
// aparte. El principal marca un contador cada 100 ms; si no avanza en 2 s, el hilo lo pausa con el inspector
// (llega aunque esté en un bucle; si espera a algo nativo, como un execFileSync, se para al volver de él, en
// quien lo llamó) y apunta la pila directamente en el archivo, por si no se recupera.
const WATCHER = `
const { workerData: { beat: sab, file } } = require('node:worker_threads');
const fs = require('node:fs');
const inspector = require('node:inspector');
const beat = new Int32Array(sab);
const s = new inspector.Session();
s.connectToMainThread();
const post = (m, p = {}) => new Promise((res, rej) => s.post(m, p, (e, r) => (e ? rej(e) : res(r))));
let want = null;
s.on('Debugger.paused', ({ params }) => { if (want) { want(params); want = null; } else post('Debugger.resume').catch(() => {}); });
let seen = Atomics.load(beat, 0), since = Date.now(), done = false;
setInterval(async () => {
  const n = Atomics.load(beat, 0);
  if (n !== seen) { seen = n; since = Date.now(); done = false; return; }
  if (done || Date.now() - since < 2000) return;
  done = true;
  let text;
  try {
    await post('Debugger.enable');
    const p = await new Promise((res, rej) => {
      want = res;
      post('Debugger.pause').catch(rej);
      setTimeout(() => rej(new Error('no se ha podido pausar en 30 s')), 30000);
    });
    text = 'proceso principal, pila:\\n' + ((p.callFrames || []).slice(0, 30).map((f) =>
      '  ' + (f.functionName || '(anónima)') + ' ' + String(f.url || '').replace(/^.*[\\\\/]/, '') + ':' + (f.location.lineNumber + 1) + ':' + ((f.location.columnNumber || 0) + 1)).join('\\n') || '  (vacía)');
  } catch (err) {
    want = null;
    text = 'proceso principal, sin pila: ' + err.message;
  } finally {
    await post('Debugger.resume').catch(() => {});
    await post('Debugger.disable').catch(() => {});
  }
  try { fs.appendFileSync(file, new Date().toISOString() + ' ' + text + '\\n'); } catch {}
}, 250);
`;
function mainStack(write, file) {
  const beat = new Int32Array(new SharedArrayBuffer(4));
  try {
    const w = new Worker(WATCHER, { eval: true, workerData: { beat: beat.buffer, file } });
    w.on('error', (err) => write(`vigilante del proceso principal: ${err.message}`));
    w.unref();
  } catch (err) { write(`vigilante del proceso principal: ${err.message}`); }
  return () => Atomics.add(beat, 0, 1);
}

// Depurador conectado y activo, sin pararse nunca solo: cualquier pausa que no pida pauseStack
// (un `debugger;`, por ejemplo) se reanuda en el acto
const armed = new WeakMap(); // webContents -> { want: función que espera la pausa pedida }
function armDebugger(wc) {
  if (wc.isDestroyed()) return;
  const dbg = wc.debugger;
  let st = armed.get(wc);
  if (!st) {
    st = { want: null };
    armed.set(wc, st);
    dbg.on('message', (_e, method, params) => {
      if (method !== 'Debugger.paused') return;
      if (st.want) { st.want(params); st.want = null; } else dbg.sendCommand('Debugger.resume').catch(() => {});
    });
    dbg.on('detach', () => { st.ready = false; }); // p. ej. al abrir las DevTools de otra forma
  }
  try { if (!dbg.isAttached()) dbg.attach('1.3'); } catch { return; }
  dbg.sendCommand('Debugger.enable').then(() => { st.ready = true; }, () => {});
}

// Pausa el JavaScript de la página, copia la pila y la deja seguir
async function pauseStack(wc) {
  if (wc.isDestroyed()) throw new Error('cerrada');
  const st = armed.get(wc);
  if (!st?.ready || !wc.debugger.isAttached()) throw new Error('depurador no activo');
  const dbg = wc.debugger;
  const timeout = (ms, what) => new Promise((_r, rej) => setTimeout(() => rej(new Error(what)), ms));
  try {
    const paused = new Promise((res) => { st.want = res; });
    dbg.sendCommand('Debugger.pause').catch(() => {});
    const p = await Promise.race([paused, timeout(5000, 'no se ha podido pausar')]);
    return (p.callFrames || []).slice(0, 30).map((f) => {
      const url = String(f.url || '').replace(/^.*\/(renderer\/[^?#]+|[^/?#]+)([?#].*)?$/, '$1');
      return `  ${f.functionName || '(anónima)'} ${url}:${f.location.lineNumber + 1}:${(f.location.columnNumber || 0) + 1}`;
    }).join('\n') ||'  (pila vacía: esperando fuera de JavaScript, p. ej. al proceso principal)';
  } finally {
    st.want = null;
    await dbg.sendCommand('Debugger.resume').catch(() => {});
  }
}
