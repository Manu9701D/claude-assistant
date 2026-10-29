// Claude Assistant en la terminal (Linux y macOS; en Windows, ca.ps1): los presets de la app, con el
// `claude` de siempre. Lo lanza el envoltorio `ca` (sh).
//   ca                  menú de presets
//   ca trabajo          abre el preset directamente
//   ca trabajo --resume retoma una conversación de ese preset (selector de Claude Code)
//   Otras opciones: --continue, --model <id>, --effort <nivel>, --dry-run (solo muestra el comando)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAccounts } from '../accounts.mjs';

const HOME = os.homedir();
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const SELF = fileURLToPath(import.meta.url);
// La misma carpeta de datos que la app (app.getPath('appData') de Electron)
const APP_DATA = IS_WIN ? process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')
  : IS_MAC ? path.join(HOME, 'Library', 'Application Support')
  : process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
const DATA = path.join(APP_DATA, 'claude-assistant');
const TMP = path.join(os.tmpdir(), 'claude-assistant-terminal');
fs.mkdirSync(TMP, { recursive: true });

// Mismas notas que main.mjs
const LANGUAGE_NOTE = 'Responde siempre en castellano (español de España), en todas las conversaciones, aunque te escriban, citen o pasen material en otro idioma. El código, los comandos y los nombres técnicos se quedan como son.';
const DESKTOP_NOTE = 'macOS-MCP gasta mucho contexto: úsalo solo cuando no haya otra forma. Antes de un Snapshot, prueba con App, Shortcut, Click o Type. Para comandos y AppleScript usa tu herramienta Bash (osascript), no su Shell. Si no responde o falla por permisos, dile al usuario que active su terminal en Ajustes del Sistema › Privacidad y seguridad › Accesibilidad (y Grabación de pantalla para el Snapshot).';
const CHROME_ASK_NOTE = 'Usa Claude in Chrome (el navegador) solo si el usuario lo pide expresamente o después de preguntarle.';

const MODELS = [
  { id: '', label: 'Por defecto (el del preset o el general)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// ---------- Opciones ----------
const opts = { preset: '', resume: false, continue: false, model: '', effort: '', dryRun: false };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--resume' || a === '-r') opts.resume = true;
  else if (a === '--continue' || a === '-c') opts.continue = true;
  else if (a === '--model') opts.model = process.argv[++i] || '';
  else if (a === '--effort') opts.effort = process.argv[++i] || '';
  else if (a === '--dry-run') opts.dryRun = true;
  else if (!a.startsWith('-') && !opts.preset) opts.preset = a;
}

// ---------- Configuración de la app (solo lectura) ----------
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const config = readJson(path.join(DATA, 'config.json')) || { cwd: HOME, model: '', effort: '', permissionMode: 'bypassPermissions', compactWindow: 200, systemPrompt: '', presets: [] };
const blank = { id: 'blank', name: 'En blanco', emoji: '＋', description: 'Pestaña sin preset', cwd: config.cwd || HOME, addDirs: [] };
const presets = [blank, ...(config.presets || [])];

// ---------- Cuentas (las de la app) ----------
const accounts = createAccounts({
  file: path.join(DATA, 'accounts.json'),
  legacyDecrypt: () => null, // las de safeStorage solo las lee la app
  claudeExe: () => 'claude',
  env: () => process.env,
});
const activeAccount = () => { try { return accounts.list().find((a) => a.active) || null; } catch { return null; } };

// ---------- Lanzar una sesión ----------
const writeTemp = (name, text) => { const f = path.join(TMP, name); fs.writeFileSync(f, text); return f; };
const onPath = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, cmd)));

function claudeArgs(p) {
  const a = [];
  const model = opts.model || p.model || config.model;
  const effort = opts.effort || p.effort || config.effort;
  const perm = p.permissionMode || config.permissionMode;
  if (model) a.push('--model', model);
  if (effort) a.push('--effort', effort);
  if (perm) a.push('--permission-mode', perm);
  // Como la app: la parte fija del prompt de sistema igual en todas las pestañas (se lee de caché)
  a.push('--exclude-dynamic-system-prompt-sections');
  const desktop = IS_MAC && p.desktop;
  const notes = [LANGUAGE_NOTE, config.systemPrompt, p.instructions, desktop && DESKTOP_NOTE, p.chrome && p.chromeAsk && CHROME_ASK_NOTE];
  const append = notes.map((n) => String(n || '').trim()).filter(Boolean).join('\n\n');
  if (append) a.push('--append-system-prompt', append);
  for (const d of p.addDirs || []) if (d && fs.existsSync(d)) a.push('--add-dir', d);
  if (p.chrome) a.push('--chrome');
  if (desktop) {
    const uvx = [path.join(HOME, '.local', 'bin', 'uvx')].find((f) => fs.existsSync(f)) || 'uvx';
    const mcp = { mcpServers: { 'macos-mcp': { type: 'stdio', command: uvx, args: ['macos-mcp'], env: { ANONYMIZED_TELEMETRY: 'false' } } } };
    a.push('--mcp-config', writeTemp('macos-mcp.json', JSON.stringify(mcp, null, 2)));
  }
  // Presets que no son de programación: sin los plugins de usuario
  if (p.plugins === false) {
    const us = readJson(path.join(HOME, '.claude', 'settings.json'));
    const off = Object.fromEntries(Object.keys(us?.enabledPlugins || {}).map((k) => [k, false]));
    if (Object.keys(off).length) a.push('--settings', writeTemp(`settings-${p.id}.json`, JSON.stringify({ enabledPlugins: off })));
  }
  if (opts.resume) a.push('--resume');
  else if (opts.continue) a.push('--continue');
  return a;
}

// Variables de entorno de la sesión: compactación y cuenta de GitHub del preset
function sessionEnv(p) {
  const env = {};
  const cw = Number(config.compactWindow) || 0;
  if (cw > 0) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(cw * 1000);
  if (p.github) {
    const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
    env.GIT_CONFIG_COUNT = String(n + 1);
    env[`GIT_CONFIG_KEY_${n}`] = 'credential.https://github.com.username';
    env[`GIT_CONFIG_VALUE_${n}`] = p.github;
    try { const t = execFileSync('gh', ['auth', 'token', '-u', p.github], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (t) env.GH_TOKEN = t; } catch {}
  }
  return env;
}

const presetCwd = (p) => { const c = p.cwd || HOME; return fs.existsSync(c) ? c : HOME; };
const setTitle = (t) => process.stdout.write(`\x1b]0;${t}\x07`);

function startHere(p) {
  const cwd = presetCwd(p);
  if (cwd !== (p.cwd || HOME)) console.log(`\x1b[33mNo existe ${p.cwd}; se abre en ${HOME}\x1b[0m`);
  const args = claudeArgs(p);
  const env = sessionEnv(p);
  if (opts.dryRun) {
    for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${k === 'GH_TOKEN' ? '***' : v}`);
    console.log(`[${cwd}] claude`);
    for (const a of args) console.log(`  ${a}`);
    return;
  }
  setTitle(`${p.emoji || ''} ${p.name}`.trim());
  spawnSync('claude', args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' });
  setTitle('');
}

// Ventana nueva de la terminal con ese preset (Terminal en macOS; en Linux, la del escritorio)
function startTab(p) {
  const cmd = [process.execPath, SELF, p.id, ...(opts.model ? ['--model', opts.model] : []), ...(opts.effort ? ['--effort', opts.effort] : []),
    ...(opts.resume ? ['--resume'] : opts.continue ? ['--continue'] : [])];
  const sh = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const line = `cd ${sh(presetCwd(p))} && ${cmd.map(sh).join(' ')}`;
  const run = (file, args) => { try { spawn(file, args, { detached: true, stdio: 'ignore', cwd: presetCwd(p) }).unref(); return true; } catch { return false; } };
  if (IS_MAC) return run('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(line)}`, '-e', 'tell application "Terminal" to activate']);
  // $TERMINAL (lo habitual en Arch con Hyprland/Sway) y, si no, la primera que haya
  const terms = [
    ...(process.env.TERMINAL ? [[process.env.TERMINAL, ['-e', ...cmd]]] : []),
    ['ptyxis', ['--new-window', '--', ...cmd]], ['kgx', ['--', ...cmd]], ['gnome-terminal', ['--', ...cmd]],
    ['konsole', ['-e', ...cmd]], ['xfce4-terminal', ['-x', ...cmd]],
    ['kitty', cmd], ['alacritty', ['-e', ...cmd]], ['foot', cmd], ['ghostty', ['-e', ...cmd]], ['wezterm', ['start', '--', ...cmd]], ['x-terminal-emulator', ['-e', ...cmd]], ['xterm', ['-e', ...cmd]],
  ];
  const t = terms.find(([f]) => onPath(f));
  return t ? run(...t) : false;
}

// ---------- Menús (flechas, números, Enter, Esc) ----------
const C = { cyan: '\x1b[36m', dim: '\x1b[2m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', bold: '\x1b[1m', off: '\x1b[0m' };
const clear = () => process.stdout.write('\x1b[2J\x1b[H');

// Una tecla: 'up', 'down', 'tab', 'enter', 'esc' o el carácter
function readKey() {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', (b) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const s = b.toString('utf8');
      if (s === '\x03') { clear(); process.exit(0); }
      resolve({ '\x1b[A': 'up', '\x1bOA': 'up', '\x1b[B': 'down', '\x1bOB': 'down', '\t': 'tab', '\r': 'enter', '\n': 'enter', '\x1b': 'esc' }[s] || s);
    });
  });
}

async function selectOption(title, labels, index = 0) {
  for (;;) {
    clear();
    console.log(` ${C.bold}${title}${C.off}\n`);
    labels.forEach((l, i) => console.log(i === index ? `${C.cyan} ❯ ${i + 1}. ${l}${C.off}` : `   ${i + 1}. ${l}`));
    console.log(`\n${C.dim} ↑↓ elegir · Enter aceptar · Esc volver${C.off}`);
    const k = await readKey();
    if (k === 'up') index = (index - 1 + labels.length) % labels.length;
    else if (k === 'down' || k === 'tab') index = (index + 1) % labels.length;
    else if (k === 'enter') return index;
    else if (k === 'esc') return -1;
    else if (/^[1-9]$/.test(k) && Number(k) <= labels.length) return Number(k) - 1;
  }
}

async function showAccounts() {
  let list;
  try { list = accounts.list(); } catch (e) { console.log(`${C.red}${e.message}${C.off}`); await readKey(); return; }
  const labels = list.map((a) => `${a.email}${a.plan ? ` · ${a.plan}` : ''}${a.active ? '  ✔' : ''}${a.locked ? '  (volver a iniciar sesión)' : ''}`);
  labels.push('Iniciar sesión con otra cuenta…');
  const i = await selectOption('Cuenta de Claude', labels, Math.max(0, list.findIndex((a) => a.active)));
  if (i < 0) return;
  // La activa ya quedó guardada al listar; la nueva se guarda la próxima vez que se abra este menú
  if (i === list.length) { spawnSync('claude', ['auth', 'login', '--claudeai'], { stdio: 'inherit' }); return; }
  try { console.log(`${C.green}Cuenta activa: ${accounts.use(list[i].key).email}${C.off}`); }
  catch (e) { console.log(`${C.red}${e.message}${C.off}`); await readKey(); }
}

async function showMenu() {
  let index = presets.length > 1 ? 1 : 0;
  let account = activeAccount();
  for (;;) {
    clear();
    const who = account ? `${account.email}${account.plan ? ` · ${account.plan}` : ''}` : 'sin cuenta guardada';
    console.log(`${C.yellow} ✻ Claude Assistant · terminal${C.off}${C.dim}   ${who}${C.off}\n`);
    presets.forEach((p, i) => {
      const tags = [p.model, p.chrome && (p.chromeAsk ? 'Chrome · pregunta' : 'Chrome'), IS_MAC && p.desktop && 'Apps', p.github && `gh:${p.github}`].filter(Boolean);
      const line = `${i + 1}. ${p.emoji || ''} ${p.name}`;
      console.log(`${i === index ? `${C.cyan} ❯ ${line}${C.off}` : `   ${line}`}${C.dim}  ${p.description || ''}${tags.length ? `  [${tags.join(', ')}]` : ''}${C.off}`);
    });
    const state = [`modelo: ${opts.model || 'del preset'}`, `effort: ${opts.effort || 'del preset'}`, `retomar: ${opts.resume ? 'elegir conversación' : opts.continue ? 'la última' : 'no'}`];
    console.log(`\n${C.dim} ${state.join(' · ')}`);
    console.log(` ↑↓/número elegir · Enter aquí · T ventana nueva · M modelo · E effort · R retomar · C cuenta · Esc salir${C.off}`);
    const k = await readKey();
    if (k === 'up') index = (index - 1 + presets.length) % presets.length;
    else if (k === 'down' || k === 'tab') index = (index + 1) % presets.length;
    else if (k === 'esc') { clear(); return; }
    else if (k === 'enter') { clear(); startHere(presets[index]); account = activeAccount(); }
    else if (k.toLowerCase() === 't') { if (!startTab(presets[index])) { console.log(`${C.red}No se ha encontrado ninguna terminal para abrir otra ventana.${C.off}`); await readKey(); } }
    else if (k.toLowerCase() === 'm') { const i = await selectOption('Modelo', MODELS.map((m) => m.label)); if (i >= 0) opts.model = MODELS[i].id; }
    else if (k.toLowerCase() === 'e') { const i = await selectOption('Effort', EFFORTS.map((e) => e || 'Por defecto')); if (i >= 0) opts.effort = EFFORTS[i]; }
    else if (k.toLowerCase() === 'r') {
      if (opts.resume) { opts.resume = false; opts.continue = true; }
      else if (opts.continue) opts.continue = false;
      else opts.resume = true;
    }
    else if (k.toLowerCase() === 'c') { await showAccounts(); account = activeAccount(); }
    else if (/^[1-9]$/.test(k) && Number(k) <= presets.length) index = Number(k) - 1;
  }
}

if (opts.preset) {
  const p = presets.find((x) => x.id === opts.preset || x.name === opts.preset);
  if (!p) { console.error(`${C.red}No hay ningún preset «${opts.preset}». Hay: ${presets.map((x) => x.id).join(', ')}${C.off}`); process.exit(1); }
  startHere(p);
} else if (!process.stdin.isTTY) {
  console.error('El menú necesita una terminal. Usa: ca <preset>');
  process.exit(1);
} else {
  await showMenu();
}
