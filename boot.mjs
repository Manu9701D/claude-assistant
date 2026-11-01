// Entrada de las copias para otros (build-src.cjs la pone como «main»): arranca la versión mejorada por el
// usuario con el preset «Mejorar Claude Assistant» si la ha aplicado (<datos>/mejoras/aplicada: la copia que
// congela «aplicar», no la carpeta en la que se edita; ver mejoras.mjs)
// o la original. Vuelve a la original (y main.mjs lo avisa) si la mejorada falla al cargarse, si el arranque
// anterior con ella no llegó a la interfaz o si la app instalada es de otra versión que la de partida. Con
// --original, siempre la original. CA_SOURCE=<carpeta>: la instancia de pruebas del preset (mejorar/herramienta.mjs prueba).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const profile = process.env.CA_PROFILE || '';
const DATA = path.join(app.getPath('appData'), profile ? `claude-assistant-${profile}` : 'claude-assistant');
const STATE = path.join(DATA, 'mejoras.json');
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const build = () => read(path.join(HERE, 'build.json'))?.id || 'dev';

function pick() {
  if (process.env.CA_SOURCE) return process.env.CA_SOURCE;
  if (process.argv.includes('--original')) return null;
  const dir = path.join(DATA, 'mejoras', 'aplicada');
  const s = read(STATE);
  if (!s?.activa || !fs.existsSync(path.join(dir, 'main.mjs'))) return null;
  const off = (motivo) => { fs.writeFileSync(STATE, JSON.stringify({ ...s, activa: false, motivo, intento: 0 }, null, 2)); process.env.CA_SELF_FALLBACK = motivo; return null; };
  if (s.base !== build()) return off('actualizada');
  // El arranque anterior con la mejorada no llegó a la interfaz (ready.json, que escribe main.mjs)
  const ready = read(path.join(DATA, 'ready.json'))?.at || 0;
  const fallos = s.intento && ready < s.intento ? (s.fallos || 0) + 1 : 0;
  if (fallos) return off('no arrancaba');
  fs.writeFileSync(STATE, JSON.stringify({ ...s, intento: Date.now(), fallos }, null, 2));
  return dir;
}

// node_modules de la copia: enlace a los de la app instalada (en un AppImage, su ruta cambia en cada arranque)
function linkModules(dir) {
  const link = path.join(dir, 'node_modules');
  const target = path.join(HERE, 'node_modules');
  try { if (fs.realpathSync(link) === fs.realpathSync(target)) return; } catch {}
  // Un enlace se quita con unlink: rmSync con recursive, en Windows, vacía la carpeta a la que apunta un junction
  const st = (() => { try { return fs.lstatSync(link); } catch { return null; } })();
  if (st?.isSymbolicLink()) fs.unlinkSync(link);
  else if (st) fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

// Si la app ya está abierta, este arranque no cuenta como intento (main.mjs pasa el aviso a la abierta)
app.setPath('userData', DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let dir = null;
try {
  dir = pick();
  if (dir) linkModules(dir);
} catch (e) {
  dir = null;
  process.env.CA_SELF_FALLBACK = `error: ${e.message}`;
}
process.env.CA_APP_ORIGINAL = HERE;
delete process.env.CA_APP_CUSTOM; // heredada de un reinicio con app.relaunch
if (dir) process.env.CA_APP_CUSTOM = dir;
try {
  await import(pathToFileURL(path.join(dir || HERE, 'main.mjs')).href);
} catch (e) {
  if (!dir || process.env.CA_SOURCE) throw e;
  const s = read(STATE) || {};
  fs.writeFileSync(STATE, JSON.stringify({ ...s, activa: false, motivo: `no arrancaba: ${String(e?.stack || e).split('\n').slice(0, 3).join(' · ')}`, intento: 0 }, null, 2));
  // Error de sintaxis o un import que no existe: no ha llegado a ejecutarse nada, así que la original
  // arranca en este mismo proceso. Si ya se ejecutó algo (ventanas, IPC), se reabre la app con la original.
  if (e instanceof SyntaxError || /^ERR_(MODULE_NOT_FOUND|UNSUPPORTED|INVALID)/.test(e?.code || '')) {
    process.env.CA_SELF_FALLBACK = 'no arrancaba';
    delete process.env.CA_APP_CUSTOM;
    await import(pathToFileURL(path.join(HERE, 'main.mjs')).href);
  } else {
    process.env.CA_SELF_FALLBACK = 'no arrancaba'; // lo hereda el proceso nuevo, para avisar
    app.relaunch({ execPath: process.env.APPIMAGE || process.execPath, args: process.argv.slice(1).filter((a) => a !== '--restore') });
    app.exit(0);
  }
}
