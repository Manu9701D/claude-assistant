// Cuentas de Claude: como /login en la terminal, pero recordando cada cuenta para cambiar con un clic.
// Claude Code guarda la cuenta activa en ~/.claude/.credentials.json (claudeAiOauth) y su ficha en
// ~/.claude.json (oauthAccount); cambiar de cuenta es poner ahí las de otra (en macOS, las credenciales
// van en el Llavero: ver readCreds). Las cuentas se guardan
// cifradas en un archivo que comparten la app en uso y la de pruebas. No vale safeStorage: su clave
// es de cada carpeta de datos y una app no podría leer lo que guardó la otra. Se usa una clave propia
// (accounts.key) protegida con DPAPI, que solo puede abrir el mismo usuario de Windows.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const GLOBAL = process.env.CLAUDE_CONFIG_DIR ? path.join(CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');

// Si el archivo existe pero no se puede leer, se para: no hay que pisar la configuración de Claude Code
function readStrict(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 }); // en Linux, solo para el usuario (tokens)
  try { fs.renameSync(tmp, file); } catch {
    // En Windows falla si otro proceso lo tiene abierto en ese momento: se escribe directamente
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    fs.rmSync(tmp, { force: true });
  }
}

const keyOf = (account) => `${account.accountUuid}:${account.organizationUuid}`;
const describe = ({ oauth, account }) => ({
  key: keyOf(account),
  email: account.emailAddress || '',
  name: account.displayName || '',
  org: account.organizationName || '',
  plan: oauth.subscriptionType || '',
});

// Credenciales de una carpeta de configuración de Claude Code. En macOS no van en .credentials.json sino
// en el Llavero: servicio «Claude Code-credentials», con «-<sha256 de la carpeta, 8 cifras>» detrás si
// se lanza con CLAUDE_CONFIG_DIR (como hace Claude Code); si no hay nada allí, el archivo, como él.
const IS_MAC = process.platform === 'darwin';
const KC_USER = process.env.USER || (() => { try { return os.userInfo().username; } catch { return 'claude-code-user'; } })();
const kcService = (dir) => 'Claude Code-credentials'
  + (!process.env.CLAUDE_CONFIG_DIR && dir === CONFIG_DIR ? '' : '-' + crypto.createHash('sha256').update(dir.normalize('NFC')).digest('hex').slice(0, 8));
const kc = (args, input) => execFileSync('security', args, { input, encoding: 'utf8', timeout: 5000, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'ignore'] }).trim();
function readCreds(dir) {
  if (IS_MAC) { try { const v = kc(['find-generic-password', '-a', KC_USER, '-w', '-s', kcService(dir)]); if (v) return JSON.parse(v); } catch {} }
  return readStrict(path.join(dir, '.credentials.json'));
}
function writeCreds(dir, data) {
  // Por la entrada estándar (-i) y en hexadecimal: los tokens no salen en la lista de procesos
  if (IS_MAC) { try { kc(['-i'], `add-generic-password -U -a "${KC_USER}" -s "${kcService(dir)}" -X "${Buffer.from(JSON.stringify(data)).toString('hex')}"\n`); return; } catch {} }
  writeAtomic(path.join(dir, '.credentials.json'), data);
}
function deleteCreds(dir) {
  if (IS_MAC) { try { kc(['delete-generic-password', '-a', KC_USER, '-s', kcService(dir)]); } catch {} }
}

function readLogin(dir, globalFile) {
  try {
    const oauth = readCreds(dir).claudeAiOauth;
    const account = readStrict(globalFile).oauthAccount;
    return oauth?.refreshToken && account?.accountUuid ? { oauth, account } : null;
  } catch { return null; }
}

// DPAPI del usuario de Windows mediante PowerShell (una sola vez: al primer uso de la clave).
// En Linux no hay DPAPI: la clave queda en un archivo que solo puede leer el usuario (0600).
function dpapi(op, b64) {
  if (process.platform !== 'win32') return b64;
  const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($env:CA_DATA), $null, 'CurrentUser'))`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, CA_DATA: b64 }, windowsHide: true, encoding: 'utf8' }).trim();
}

export function createAccounts({ file, legacyDecrypt, claudeExe, env }) {
  const keyFile = path.join(path.dirname(file), 'accounts.key');
  let key = null;
  function getKey() {
    if (key) return key;
    try { key = Buffer.from(dpapi('Unprotect', fs.readFileSync(keyFile, 'utf8').trim()), 'base64'); }
    catch (err) {
      if (fs.existsSync(keyFile)) throw err; // existe pero no se abre: no se pisa
      const k = crypto.randomBytes(32);
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      try { fs.writeFileSync(keyFile, dpapi('Protect', k.toString('base64')), { flag: 'wx', mode: 0o600 }); key = k; }
      catch { return getKey(); } // la otra app la creó a la vez: se usa la suya
    }
    return key;
  }
  function encrypt(str) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const data = Buffer.concat([c.update(str, 'utf8'), c.final()]);
    return 'v2:' + Buffer.concat([iv, c.getAuthTag(), data]).toString('base64');
  }
  // Devuelve null si no se puede leer (p. ej. guardada con safeStorage por la otra app)
  function decrypt(blob) {
    try {
      if (!blob.startsWith('v2:')) return JSON.parse(legacyDecrypt(blob) || 'null');
      const buf = Buffer.from(blob.slice(3), 'base64');
      const d = crypto.createDecipheriv('aes-256-gcm', getKey(), buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    } catch { return null; }
  }

  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; } };
  const save = (list) => { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, list); };

  // Guarda (o actualiza, con los tokens más recientes) una cuenta
  function remember(entry) {
    const list = load();
    const info = describe(entry);
    const i = list.findIndex((a) => a.key === info.key);
    // Sin cambios no se reescribe (el cifrado cambia en cada guardado y el archivo es de las dos apps)
    if (i >= 0) {
      const { blob, ...prev } = list[i];
      if (JSON.stringify(prev) === JSON.stringify(info) && JSON.stringify(decrypt(blob)) === JSON.stringify(entry)) return list[i];
    }
    const item = { ...info, blob: encrypt(JSON.stringify(entry)) };
    if (i >= 0) list[i] = item; else list.push(item);
    save(list);
    return item;
  }

  const active = () => readLogin(CONFIG_DIR, GLOBAL);

  // Pasa al formato compartido las guardadas con safeStorage que esta app sí puede leer
  function migrate() {
    const list = load();
    let changed = false;
    for (const a of list) {
      if (a.blob.startsWith('v2:')) continue;
      const entry = decrypt(a.blob);
      if (entry) { a.blob = encrypt(JSON.stringify(entry)); changed = true; }
    }
    if (changed) save(list);
  }

  function list() {
    migrate();
    syncProfiles();
    const cur = active();
    if (cur) remember(cur);
    const key = cur && keyOf(cur.account);
    // locked: no se puede leer y hay que volver a iniciar sesión con ella
    return load().map(({ blob, ...a }) => ({ ...a, active: a.key === key, locked: a.key !== key && !decrypt(blob) }));
  }

  function use(key) {
    syncProfiles(); // si tenía perfil, sus tokens son los más recientes
    const cur = active();
    if (cur) remember(cur); // antes de salir de ella, sus tokens al día
    if (cur && keyOf(cur.account) === key) return describe(cur);
    const target = load().find((a) => a.key === key);
    if (!target) throw new Error('No se encuentra esa cuenta.');
    const entry = decrypt(target.blob);
    if (!entry) throw new Error(`Hay que volver a iniciar sesión con ${target.email}.`);
    const creds = readCreds(CONFIG_DIR);
    const global = readStrict(GLOBAL);
    writeCreds(CONFIG_DIR, { ...creds, claudeAiOauth: entry.oauth });
    writeAtomic(GLOBAL, { ...global, oauthAccount: entry.account });
    return describe(entry);
  }

  // Otra cuenta pasa a ser la de ~/.claude (la principal). Su perfil sobra: cada cuenta vive en un solo sitio
  function makeMain(key) {
    const entry = use(key);
    try { removeProfile(key); } catch {} // si algo lo tiene abierto, ya no se usa: profile() no lo pide para la activa
    return entry;
  }

  function remove(key, inUse = []) {
    const cur = active();
    if ((cur && keyOf(cur.account) === key) || inUse.includes(key)) throw new Error('No se puede quitar una cuenta que se está usando.');
    save(load().filter((a) => a.key !== key));
    removeProfile(key);
  }
  // Primero los enlaces (sin entrar en ellos: apuntan a ~/.claude) y después lo propio del perfil
  function removeProfile(key) {
    const dir = profileDir(key);
    deleteCreds(dir);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---------- Una cuenta por ventana: perfiles de Claude Code ----------
  // Cada pestaña lanza `claude` con CLAUDE_CONFIG_DIR apuntando al perfil de su cuenta (la activa
  // usa ~/.claude, como la terminal). El perfil tiene sus propias credenciales y .claude.json; las
  // carpetas (conversaciones, plugins, skills…) son enlaces a las de ~/.claude, y los ajustes se
  // copian al lanzar. Así cada proceso renueva sus tokens sin pisar a los demás. Cada cuenta vive en
  // un solo sitio: si dos copias renovasen el mismo token, una dejaría de valer.
  const PROFILES = path.join(path.dirname(file), 'perfiles');
  const profileDir = (key) => path.join(PROFILES, key.replace(/[^\w-]/g, '_'));
  const SHARED_FILES = ['settings.json', 'CLAUDE.md', 'keybindings.json'];
  // Por cuenta u organización: no se comparten
  const OWN = new Set(['.credentials.json', 'daemon', 'backups', 'policy-limits.json', 'policy-limits.json.stamp.json', 'remote-settings.json', 'mcp-needs-auth-cache.json', 'daemon.lock', 'daemon.status.json']);

  const expires = (oauth) => Number(oauth?.expiresAt) || 0;

  // Las credenciales del perfil (las renueva Claude Code) vuelven al almacén, para no perderlas
  function syncProfiles() {
    for (const a of load()) {
      const dir = profileDir(a.key);
      const entry = readLogin(dir, path.join(dir, '.claude.json'));
      if (!entry || keyOf(entry.account) !== a.key) continue;
      const saved = decrypt(a.blob);
      if (!saved || expires(entry.oauth) > expires(saved.oauth)) remember(entry);
    }
  }

  // Carpeta de configuración para lanzar Claude Code con esa cuenta; null si es la activa (~/.claude)
  function profile(key) {
    const cur = active();
    if (!key || (cur && keyOf(cur.account) === key)) return null;
    const target = load().find((a) => a.key === key);
    if (!target) throw new Error('No se encuentra esa cuenta.');
    const dir = profileDir(key);
    fs.mkdirSync(dir, { recursive: true });
    // Credenciales: las más recientes entre las del perfil y las del almacén
    const globalFile = path.join(dir, '.claude.json');
    const own = readLogin(dir, globalFile);
    const mine = own && keyOf(own.account) === key ? own : null;
    const saved = decrypt(target.blob);
    if (!mine && !saved) throw new Error(`Hay que volver a iniciar sesión con ${target.email}.`);
    const entry = mine && (!saved || expires(mine.oauth) >= expires(saved.oauth)) ? mine : saved;
    if (entry !== mine) writeCreds(dir, { ...readCreds(dir), claudeAiOauth: entry.oauth });
    // .claude.json: copia del de ~/.claude.json (MCP de usuario, carpetas de confianza…) con su cuenta.
    // Los MCP de usuario se vuelven a copiar cada vez, por si se han cambiado.
    const base = readStrict(GLOBAL);
    const conf = fs.existsSync(globalFile) ? readStrict(globalFile) : { ...base };
    const next = { ...conf, oauthAccount: entry.account, mcpServers: base.mcpServers };
    if (!base.mcpServers) delete next.mcpServers;
    if (JSON.stringify(next) !== JSON.stringify(conf) || !fs.existsSync(globalFile)) writeAtomic(globalFile, next);
    // Carpetas compartidas: enlaces (junctions en Windows, sin permisos de administrador). Las
    // conversaciones, siempre: si aún no existen (equipo recién instalado), se crean para enlazarlas
    try { fs.mkdirSync(path.join(CONFIG_DIR, 'projects'), { recursive: true }); } catch {}
    for (const it of fs.readdirSync(CONFIG_DIR, { withFileTypes: true })) {
      if (OWN.has(it.name)) continue;
      const src = path.join(CONFIG_DIR, it.name);
      const dst = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (!fs.existsSync(dst)) { try { fs.symlinkSync(src, dst, 'junction'); } catch {} }
      } else if (SHARED_FILES.includes(it.name)) {
        // Claude Code reescribe estos archivos (un enlace se rompería): se copian al lanzar
        try { if (!fs.existsSync(dst) || !fs.readFileSync(src).equals(fs.readFileSync(dst))) fs.copyFileSync(src, dst); } catch {}
      } else if (it.name === 'history.jsonl' && !fs.existsSync(dst)) {
        try { fs.linkSync(src, dst); } catch {} // historial de mensajes (↑): solo se le añaden líneas
      }
    }
    return dir;
  }

  // Inicio de sesión con otra cuenta: `claude auth login` en una carpeta aparte, para no tocar la
  // cuenta activa hasta que termine bien. Abre el navegador; si este muestra un código, se le pasa.
  let pending = null;
  function login({ onUrl }) {
    if (pending) pending.kill();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-login-'));
    const childEnv = { ...env(), CLAUDE_CONFIG_DIR: dir };
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;
    const child = spawn(claudeExe(), ['auth', 'login', '--claudeai'], { env: childEnv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    pending = child;
    let out = '';
    const onData = (d) => {
      out += d.toString();
      const url = out.match(/https:\/\/\S+oauth\S+/)?.[0];
      if (url && !child.url) { child.url = url; onUrl(url); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        if (pending === child) pending = null;
        const entry = readLogin(dir, path.join(dir, '.claude.json'));
        deleteCreds(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        if (child.cancelled) return reject(new Error('cancelled'));
        if (code !== 0 || !entry) {
          const why = out.split('\n').map((l) => l.trim()).filter((l) => l && !/^https?:/.test(l) && !/Paste code|Opening browser|If the browser/.test(l)).pop();
          return reject(new Error(why || `No se pudo iniciar sesión (código ${code}).`));
        }
        remember(entry);
        resolve(describe(entry));
      });
    });
  }
  const sendCode = (code) => pending?.stdin.write(`${String(code).trim()}\n`);
  const cancelLogin = () => { if (pending) { pending.cancelled = true; pending.kill(); } };

  const activeKey = () => { const cur = active(); return cur ? keyOf(cur.account) : null; };

  return { list, use, makeMain, remove, login, sendCode, cancelLogin, profile, activeKey };
}
