import { app, BrowserWindow, WebContentsView, Tray, Menu, ipcMain, globalShortcut, nativeImage, nativeTheme, safeStorage, shell, dialog, Notification, screen, systemPreferences, desktopCapturer } from 'electron';
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { createAssist } from './assist.mjs';
import { createWhatsApp } from './whatsapp.mjs';
import { createAccounts } from './accounts.mjs';
import { createTerminals, terminalClaude, sessionExists } from './terminals.mjs';
import { createTermChat, unwrapPasted } from './termchat.mjs';
import { createHttpMcp } from './mcp-http.mjs';
import { createUnixJobs } from './unix-jobs.mjs';
import { readOutput, stopTask } from './bgtasks.mjs';
import { createDocView } from './docview.mjs';
import { createSchedules, cleanSchedule, nextRun } from './schedules.mjs';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Perfil de pruebas (CA_PROFILE=nombre): datos aparte, sin bloquear la instancia normal,
// sin atajo global ni inicio con Windows. Sirve para probar cambios sin cerrar la app en uso.
const TEST_PROFILE = process.env.CA_PROFILE || '';
// Siempre «claude-assistant», también empaquetada (allí el nombre sería el productName)
app.setPath('userData', path.join(app.getPath('appData'), TEST_PROFILE ? `claude-assistant-${TEST_PROFILE}` : 'claude-assistant'));

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// macOS y Linux: una app abierta desde el Finder, el Dock o el menú del escritorio no hereda el PATH de la
// terminal (lo que se añade en .zshrc o .bashrc: ~/.local/bin, Homebrew, nvm…; sin él no encontraría
// claude, gh, uvx…): se toma el de la shell de inicio del usuario
if (!IS_WIN) {
  let shellPath = '';
  try { shellPath = execFileSync(process.env.SHELL || (IS_MAC ? '/bin/zsh' : '/bin/bash'), ['-ilc', 'printf "<<%s>>" "$PATH"'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).match(/<<(.*)>>/s)?.[1] || ''; } catch {} // entre marcas: el .bashrc puede escribir algo
  const extra = [path.join(os.homedir(), '.local', 'bin'), ...(IS_MAC ? ['/opt/homebrew/bin'] : ['/home/linuxbrew/.linuxbrew/bin']), '/usr/local/bin'].filter((d) => fs.existsSync(d));
  process.env.PATH = [...new Set([...extra, ...shellPath.split(':'), ...(process.env.PATH || '').split(':')].filter(Boolean))].join(':');
  // macOS tampoco trae LANG: sin UTF-8, la terminal de cada pestaña pinta mal los acentos y los símbolos
  if (IS_MAC && !/utf-?8/i.test(process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || '')) process.env.LANG = 'es_ES.UTF-8';
}
// Linux con Wayland: los atajos globales pasan por el portal del escritorio
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const APP_ID = 'com.mnldz.claude-assistant';
app.setAppUserModelId(APP_ID);

// ---------- Configuración ----------
const DATA_DIR = app.getPath('userData');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
// Un error suelto del proceso principal no debe sacar diálogos: se apunta en errores.log y la app sigue
const logError = (kind) => (err) => {
  try { fs.appendFileSync(path.join(DATA_DIR, 'errores.log'), `${new Date().toISOString()} ${kind}: ${err?.stack || err}\n`); } catch {}
};
process.on('uncaughtException', logError('uncaughtException'));
process.on('unhandledRejection', logError('unhandledRejection'));

const DEFAULTS = {
  authMode: 'claude-code', // 'claude-code' | 'api-key' | 'oauth-token'
  secrets: {},             // { apiKey, oauthToken } cifrados con DPAPI (safeStorage)
  model: '',               // modelo por defecto de las pestañas nuevas ('' = el de Claude Code)
  effort: '',              // '', low, medium, high, xhigh, max
  compactWindow: 200,      // compactar la conversación al llegar a estos miles de tokens (0 = al llenar la ventana del modelo)
  cwd: os.homedir(),       // carpeta por defecto de las pestañas nuevas
  permissionMode: 'bypassPermissions',
  hotkey: 'Control+Shift+Space',
  voiceHotkey: 'Control+Alt+Space', // asistente por voz (ver assist.mjs)
  voicePreset: 'assist',   // preset de la pestaña de voz ('' = en blanco)
  shotHotkey: 'Control+Alt+S', // recortar la pantalla y pedir algo sobre ella (ver assist.mjs)
  voiceModel: 'sonnet',    // modelo de la pestaña de voz ('' = el del preset o el general)
  voiceEffort: 'low',      // effort de la pestaña de voz ('' = el del preset o el general)
  whatsappView: 'hidden',  // ventana de WhatsApp en segundo plano: 'hidden' | 'second' (se ve en la segunda pantalla, sin foco)
  autoStart: true,
  claudePath: '',          // vacío = el Claude Code que trae el SDK
  systemPrompt: '',
  theme: 'system',         // 'system' | 'light' | 'dark'
  appearance: {},          // tamaño de letra, ancho, tipografías y zoom (ver applyAppearance en app.js; {} = por defecto)
  userName: '',            // para el saludo
  presets: null,           // perfiles de inicio de pestaña (ver DEFAULT_PRESETS)
  presetsSeeded: null,     // ids de DEFAULT_PRESETS ya incorporados alguna vez
  tokenDiet: 0,            // versión ya aplicada de la migración de ahorro de tokens
  githubSeeded: false,     // cuenta de GitHub de Trabajo ya puesta
  setupDone: false,        // asistente de primer arranque ya visto (#setup en la interfaz)
  sidebar: { open: true, pinned: [], titles: {}, groups: {}, closed: [] }, // barra lateral: fijados, nombres y grupos propios (id de sesión -> preset), grupos plegados
  notify: { done: true, ask: true, scheduled: true, sound: true }, // avisos del sistema por tipo (terminado, preguntas y permisos, tareas programadas) y con sonido
  schedules: [],           // tareas programadas (ver schedules.mjs)
  blankBare: true,         // pestañas en blanco (sin preset, para dudas generales): sin conectores MCP ni plugins
  autoPreview: true,       // los documentos que Claude crea o cambia (Word, Excel, PDF, HTML…) se abren solos en el panel lateral
  ext: {},                 // conectores, skills y plugins apagados en todas las pestañas: { mcp|skills|plugins: { nombre: false } } (ver extOff)
};

const HOME = os.homedir();
// Presets iniciales (los propios, en personal.mjs; sin él, ninguno). Cada uno: carpeta, modelo y modo
// propios (vacío = el general), carpetas extra, Claude in Chrome, instrucciones añadidas y un mensaje de arranque opcional.
const personal = fs.existsSync(path.join(__dirname, 'personal.mjs')) ? await import('./personal.mjs') : {};
const DEFAULT_PRESETS = personal.DEFAULT_PRESETS || [];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

const savedConfig = readJson(CONFIG_FILE, null);
let config = { ...DEFAULTS, ...savedConfig };
// Quien ya usaba la app antes del asistente de primer arranque no lo ve
if (savedConfig && savedConfig.setupDone === undefined) config.setupDone = true;
const saveConfig = () => writeJson(CONFIG_FILE, config);
if (!Array.isArray(config.presets)) {
  config.presets = structuredClone(DEFAULT_PRESETS);
  saveConfig();
}
// Presets por defecto añadidos en versiones posteriores: se incorporan una sola vez,
// así que si el usuario borra uno no vuelve a aparecer.
{
  const seeded = new Set(config.presetsSeeded || ['trabajo', 'servidores', 'local', 'assist']);
  const nuevos = DEFAULT_PRESETS.filter((p) => !seeded.has(p.id));
  for (const p of nuevos) {
    if (!config.presets.some((q) => q.id === p.id)) config.presets.push(structuredClone(p));
  }
  if (nuevos.length || !config.presetsSeeded) {
    config.presetsSeeded = DEFAULT_PRESETS.map((p) => p.id).concat([...seeded]).filter((v, i, a) => a.indexOf(v) === i);
    saveConfig();
  }
}
// Ahorro de tokens (una sola vez): WhatsApp tiene su propio interruptor, separado del control
// de Windows (Windows-MCP, lo más caro con diferencia); Trabajo se queda sin Windows-MCP;
// Assist pasa a Sonnet con effort bajo; Assist y Local, sin plugins de programación.
if ((config.tokenDiet || 0) < 1) {
  for (const p of config.presets) {
    if (p.whatsapp === undefined) p.whatsapp = !!p.desktop;
    if (p.plugins === undefined) p.plugins = !['assist', 'local'].includes(p.id);
    if (p.effort === undefined) p.effort = '';
    if (p.id === 'trabajo') p.desktop = false;
    if (p.id === 'assist') {
      if (!p.model) p.model = 'sonnet';
      if (!p.effort) p.effort = 'low';
    }
  }
  config.tokenDiet = 1;
  saveConfig();
}
if (personal.migrate?.(config)) saveConfig();
// Ajustes dejados por las herramientas (p. ej. copiar la apariencia de la app de pruebas): se aplican una vez al arrancar
{
  const PATCH_FILE = path.join(DATA_DIR, 'config-patch.json');
  const patch = readJson(PATCH_FILE, null);
  if (patch) {
    Object.assign(config, patch);
    saveConfig();
    try { fs.unlinkSync(PATCH_FILE); } catch {}
  }
}

function encrypt(str) {
  if (!str) return '';
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(str).toString('base64')
    : 'raw:' + Buffer.from(str).toString('base64');
}
function decrypt(val) {
  if (!val) return '';
  const [kind, data] = [val.slice(0, 4), val.slice(4)];
  try {
    return kind === 'enc:' ? safeStorage.decryptString(Buffer.from(data, 'base64')) : Buffer.from(data, 'base64').toString();
  } catch { return ''; }
}

// Lo que ve la interfaz: nunca los secretos, solo si están puestos
function publicConfig() {
  const { secrets, ...rest } = config;
  // Próxima ejecución de cada tarea programada (para Configuración › Programadas)
  const schedNext = Object.fromEntries((config.schedules || []).map((s) => [s.id, s.enabled ? nextRun(s, Math.max(s.lastRun || 0, s.created || 0) || Date.now()) : null]));
  return { ...rest, schedNext, hasApiKey: !!secrets.apiKey, hasOauthToken: !!secrets.oauthToken, profile: TEST_PROFILE, platform: process.platform };
}

// ---------- Ventana, bandeja y atajo ----------
// `win` es la ventana principal (bandeja, atajo, reinicios). Como en Windows Terminal, arrastrar una
// pestaña fuera de la barra abre otra ventana con ella; soltarla en la barra de otra la devuelve.
let win = null;
const appWins = new Set();
const winTabs = new Map(); // ventana -> { order, active }: orden de sus pestañas (para reiniciar)
const owner = new Map();   // convId -> ventana que la muestra (si no está, la principal)
const paneOf = new Map(); // webContents.id -> mitad derecha de una ventana dividida (ver Pane)
const senderWin = (e) => paneOf.get(e.sender.id) || BrowserWindow.fromWebContents(e.sender) || win;
const hostOf = (w) => w?.host || w; // la ventana de verdad (para diálogos, mover, mostrar…)
// Una ventana que se está cerrando sigue un instante en appWins: enviarle algo lanza «Object has been destroyed»
const alive = (w) => !!w && !w.isDestroyed() && !w.webContents.isDestroyed();
const post = (w, ...args) => { if (alive(w)) w.webContents.send(...args); };
const winOf = (id) => { const w = owner.get(id); return alive(w) ? w : win; };
// Cuenta de Claude de cada ventana (la de sus pestañas); sin entrada, la activa de Claude Code (~/.claude).
// Cada pestaña guarda la suya en conv.account (null: la activa).
const winAccount = new Map();
const accountOfWin = (w) => winAccount.get(w) || null;
let tray = null;
let quitting = false;
// macOS no pasa argumentos al abrir al iniciar sesión: se pregunta si la ha abierto el sistema
const startHidden = process.argv.includes('--hidden') || (IS_MAC && (() => { try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; } })());
const iconPath = path.join(__dirname, 'assets', 'icon.png');
const icoPath = path.join(__dirname, 'assets', 'icon.ico'); // varios tamaños: Windows elige el adecuado
// Fuera de Windows, Electron no lee los .ico (la bandeja y las ventanas salían sin icono o rotas): el PNG
const winIcon = IS_WIN ? icoPath : iconPath;
// macOS: la barra de título nativa no se tiñe (no hay titleBarOverlay) y la ventana no lleva icono propio
const setOverlay = (w, t) => { if (!IS_MAC) w.setTitleBarOverlay(t); };

// Colores de la barra de título nativa (botones de Windows) a juego con el tema
const TITLEBAR = {
  light: { color: '#ebe9e0', symbolColor: '#3d3d3a', height: 44 },
  dark: { color: '#1b1a19', symbolColor: '#c2c0b6', height: 44 },
};
const currentScheme = () => (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');

// Ventanas marcadas con el color de su cuenta (como los perfiles de Chrome): la barra de título se tiñe
// (igual que --titlebar con color-mix en styles.css, así los botones de Windows quedan a juego)
const winTint = new Map(); // ventana -> color de su cuenta
const TINT = { light: 0.16, dark: 0.2 };
const mixHex = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
function titlebarFor(w) {
  const scheme = currentScheme();
  const t = TITLEBAR[scheme];
  const c = winTint.get(w);
  return c ? { ...t, color: mixHex(t.color, c, TINT[scheme]) } : t;
}

function applyTheme() {
  nativeTheme.themeSource = config.theme || 'system';
  for (const w of appWins) {
    if (!alive(w)) continue;
    const t = titlebarFor(w);
    setOverlay(w, t);
    w.setBackgroundColor(t.color);
  }
}
nativeTheme.on('updated', applyTheme);

function createWindow(bounds) {
  nativeTheme.themeSource = config.theme || 'system';
  const t = TITLEBAR[currentScheme()];
  const w = new BrowserWindow({
    width: 1180,
    height: 800,
    ...bounds,
    minWidth: 600,
    minHeight: 520,
    show: false,
    title: TEST_PROFILE ? 'Claude Assistant (pruebas)' : 'Claude Assistant',
    ...(IS_MAC ? {} : { icon: winIcon }),
    backgroundColor: t.color,
    titleBarStyle: 'hidden',
    // macOS: los botones de la ventana (semáforo) a la izquierda, centrados en la barra de 44 px
    ...(IS_MAC ? { trafficLightPosition: { x: 14, y: 15 } } : { titleBarOverlay: t }),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true, // el panel de artefactos (vista previa de HTML aislada; ver will-attach-webview)
    },
  });
  appWins.add(w);
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!win) {
    win = w;
    w.once('ready-to-show', () => { if (!startHidden) w.show(); });
    w.on('close', (e) => {
      if (!quitting) { e.preventDefault(); w.hide(); }
    });
  } else {
    w.once('ready-to-show', () => w.show());
    // Al cerrar otra ventana, sus pestañas vuelven a la principal sin perder la conversación
    w.on('close', () => {
      if (quitting) return;
      for (const [id, o] of owner) {
        if (o !== w) continue;
        owner.delete(id);
        const conv = terminals.get(id);
        if (conv) post(win, 'ui:take-tab', { conv });
      }
      appWins.delete(w); // desde aquí ya no recibe nada
    });
  }
  w.on('closed', () => { appWins.delete(w); winTabs.delete(w); winAccount.delete(w); winTint.delete(w); });
  // Enlaces externos al navegador, nunca dentro de la app
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  return w;
}

// ---------- Ventana dividida (Ctrl+Shift+D con la misma cuenta) ----------
// La mitad derecha es otra interfaz completa, con sus pestañas, dentro de la misma ventana. Para el resto
// del código es una ventana más (appWins, owner, winTabs…): lo que es de la ventana de verdad lo hace su host.
// La interfaz de la izquierda se estrecha sola ('ui:split'): la vista principal de una ventana no se puede mover.
class Pane extends EventEmitter {
  constructor(host) {
    super();
    this.host = host;
    this.destroyed = false;
    this.view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true } });
    this.view.setBackgroundColor(titlebarFor(host).color);
    this.webContents = this.view.webContents;
    paneOf.set(this.webContents.id, this);
    host.pane = this;
    host.contentView.addChildView(this.view);
    this.layout = () => this.place();
    this.onHostLoad = () => post(host, 'ui:split', { fraction: SPLIT });
    // Al cerrar su ventana (la principal no se cierra, se oculta), antes que el de la ventana
    this.onHostClose = () => { if (host !== win) this.close(); };
    host.on('resize', this.layout);
    host.webContents.on('did-finish-load', this.onHostLoad);
    host.prependListener('close', this.onHostClose);
    this.place();
    this.onHostLoad();
    this.webContents.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { pane: '1' } });
    this.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    this.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); });
    this.webContents.on('did-finish-load', () => this.webContents.focus());
  }
  place() {
    const [width, height] = this.host.getContentSize();
    const x = Math.round(width * SPLIT);
    this.view.setBounds({ x, y: 0, width: width - x, height });
  }
  close() {
    if (this.destroyed) return;
    this.destroyed = true;
    const { host } = this;
    // Si se cierra con pestañas (al cerrar su ventana), vuelven a la principal sin perder la conversación
    if (!quitting) {
      for (const [id, o] of owner) {
        if (o !== this) continue;
        owner.delete(id);
        const conv = terminals.get(id);
        if (conv) post(win, 'ui:take-tab', { conv });
      }
    }
    appWins.delete(this);
    paneOf.delete(this.webContents.id);
    if (!host.isDestroyed()) {
      host.off('resize', this.layout);
      host.off('close', this.onHostClose);
      host.webContents.off('did-finish-load', this.onHostLoad);
      host.contentView.removeChildView(this.view);
      post(host, 'ui:split', { fraction: null });
      host.webContents.focus();
    }
    host.pane = null;
    this.webContents.close();
    this.emit('closed');
  }
  // Lo de ventana, a la de verdad
  isDestroyed() { return this.destroyed || this.host.isDestroyed(); }
  isVisible() { return this.host.isVisible(); }
  isMinimized() { return this.host.isMinimized(); }
  isFocused() { return this.host.isFocused() && this.webContents.isFocused(); }
  isFullScreen() { return this.host.isFullScreen(); }
  isMaximized() { return this.host.isMaximized(); }
  show() { this.host.show(); }
  showInactive() { this.host.showInactive(); }
  hide() { this.host.hide(); }
  restore() { this.host.restore(); }
  focus() { this.host.focus(); this.webContents.focus(); }
  getBounds() { return this.host.getBounds(); }
  getSize() { return this.host.getSize(); }
  getPosition() { return this.host.getPosition(); }
  getContentBounds() { const b = this.host.getContentBounds(); const v = this.view.getBounds(); return { x: b.x + v.x, y: b.y, width: v.width, height: b.height }; }
  // La barra de título, el icono y el tinte son de la ventana
  setTitleBarOverlay() {}
  setBackgroundColor(c) { this.view.setBackgroundColor(c); }
  setIcon() {}
  setAppDetails() {}
}
const SPLIT = 0.5; // parte de la ventana que queda a la izquierda
// Zona de una ventana en pantalla: si está dividida, solo su mitad izquierda
function areaOf(w) {
  const b = w.getContentBounds();
  return w.pane && !w.pane.isDestroyed() ? { ...b, width: Math.round(b.width * SPLIT) } : b;
}
function splitPane(host) {
  const p = new Pane(host);
  appWins.add(p);
  if (accountOfWin(host)) winAccount.set(p, accountOfWin(host));
  p.on('closed', () => { winTabs.delete(p); winAccount.delete(p); winTint.delete(p); });
  return p;
}

function showWindow(w = win) {
  if (!w || w.isDestroyed()) return;
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  post(w, 'ui:focus-input');
}
// Atajo y bandeja: si alguna ventana de la app tiene el foco, oculta todas; si no, muestra las que ocultó
// (o la principal) y devuelve el foco a la que lo tenía
let hiddenWins = [];
let hiddenFocus = null;
function toggleWindow() {
  const wins = [...appWins].filter(alive);
  const focused = wins.find((w) => w.isFocused());
  if (focused) {
    hiddenWins = wins.filter((w) => w.isVisible());
    hiddenFocus = focused;
    for (const w of hiddenWins) w.hide();
    return;
  }
  const back = hiddenWins.filter(alive);
  const main = alive(hiddenFocus) ? hiddenFocus : win;
  hiddenWins = []; hiddenFocus = null;
  const targets = back.length ? back : [win, ...wins.filter((w) => w.isVisible())];
  for (const w of new Set(targets)) if (w !== main) { if (w.isMinimized()) w.restore(); w.showInactive(); }
  showWindow(main);
}

// Menú de la bandeja; con varias cuentas, una entrada para abrir una ventana con cada una (como los perfiles de Chrome)
function refreshTray(list = []) {
  if (!tray) return;
  const multi = list.length > 1;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: () => showWindow() },
    { label: 'Nueva pestaña', click: () => { showWindow(); post(win, 'ui:new-conv'); } },
    ...(multi ? [{ label: 'Nueva ventana con', submenu: list.map((a) => ({ label: a.email, enabled: !a.locked, click: () => newAccountWindow(a.key) })) }] : []),
    { label: 'Configuración', click: () => { showWindow(); post(win, 'ui:settings'); } },
    { label: 'WhatsApp en segundo plano', click: () => whatsapp.showForLogin() },
    { type: 'separator' },
    { label: 'Salir', click: () => { quitting = true; app.quit(); } },
  ]));
  // macOS: el menú del icono del Dock (clic derecho), su equivalente de la lista de saltos
  if (IS_MAC) {
    try {
      app.dock?.setMenu(Menu.buildFromTemplate([
        { label: 'Nueva pestaña', click: () => { showWindow(); post(win, 'ui:new-conv'); } },
        ...(multi ? [{ label: 'Nueva ventana con', submenu: list.map((a) => ({ label: a.email, enabled: !a.locked, click: () => newAccountWindow(a.key) })) }] : []),
        { label: 'Configuración', click: () => { showWindow(); post(win, 'ui:settings'); } },
      ]));
    } catch {}
    return;
  }
  // Lista de saltos de la barra de tareas (clic derecho en su icono): lo mismo. La de pruebas no la toca:
  // es de las dos apps (mismo exe) y se lanzaría sin CA_PROFILE
  if (!IS_WIN || TEST_PROFILE) return;
  const base = process.argv.slice(1).filter((a) => !a.startsWith('--')).map((a) => `"${a}" `).join('');
  try {
    app.setUserTasks(multi ? list.filter((a) => !a.locked).map((a) => ({
      program: process.execPath, arguments: `${base}--account=${a.key}`,
      title: `Nueva ventana · ${a.email}`, description: `Abrir una ventana con la cuenta ${a.email}`,
      iconPath: icoPath, iconIndex: 0,
    })) : []);
  } catch {}
}

function createTray() {
  // macOS: imagen de plantilla (silueta que el sistema pinta en blanco o negro según la barra de menús)
  // Linux: un PNG pequeño (la bandeja de GNOME, con AppIndicator, lo pinta a su tamaño; con el de 256 px salía mal)
  tray = new Tray(IS_MAC ? nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'))
    : IS_WIN ? nativeImage.createFromPath(icoPath)
    : nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32, quality: 'best' }));
  tray.setToolTip(TEST_PROFILE ? 'Claude Assistant (pruebas)' : 'Claude Assistant');
  refreshTray();
  tray.on('click', toggleWindow);
}

// Lo que hace cada atajo, también desde la línea de órdenes (claude-assistant --toggle, --voice, --snip)
const HOTKEY_ACTIONS = { hotkey: ['--toggle', 'Mostrar u ocultar'], voiceHotkey: ['--voice', 'Voz'], shotHotkey: ['--snip', 'Recorte'] };
const runHotkeyFlag = (argv) => {
  const k = Object.keys(HOTKEY_ACTIONS).find((k) => argv.includes(HOTKEY_ACTIONS[k][0]));
  if (k) ({ hotkey: toggleWindow, voiceHotkey: assist.hotkey, shotHotkey: assist.snipHotkey })[k]();
  return !!k;
};

// GNOME con Wayland no deja a las aplicaciones capturar teclas fuera de su ventana (globalShortcut no
// recibe nada): los atajos se dan de alta como atajos personalizados de GNOME que lanzan la app con
// --toggle/--voice/--snip, y la instancia que ya corre los recibe en second-instance
const GNOME_WAYLAND = process.platform === 'linux' && !TEST_PROFILE
  && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY)
  && /gnome/i.test(process.env.XDG_CURRENT_DESKTOP || '');
const GNOME_KEYS = 'org.gnome.settings-daemon.plugins.media-keys';
const GNOME_PATH = '/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/';
const gsettings = (...args) => execFileSync('gsettings', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
// «Control+Shift+Space» → «<Control><Shift>space»
function gnomeAccel(accel) {
  const MODS = { control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control', alt: 'Alt', option: 'Alt', altgr: 'Mod5', shift: 'Shift', super: 'Super', meta: 'Super', command: 'Super', cmd: 'Super' };
  const KEYS = { space: 'space', enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'BackSpace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', pageup: 'Page_Up', pagedown: 'Page_Down', up: 'Up', down: 'Down', left: 'Left', right: 'Right', plus: 'plus', '-': 'minus', '=': 'equal', ',': 'comma', '.': 'period', '/': 'slash', ';': 'semicolon', "'": 'apostrophe', '`': 'grave', '[': 'bracketleft', ']': 'bracketright', '\\': 'backslash', printscreen: 'Print' };
  const parts = accel.split('+').map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const k = KEYS[key.toLowerCase()] || (/^f\d+$/i.test(key) ? key.toUpperCase() : key.length === 1 ? key.toLowerCase() : key);
  return parts.map((m) => `<${MODS[m.toLowerCase()] || m}>`).join('') + k;
}
// La orden que abre esta app (con AppImage, la ruta del archivo y no la de su copia montada)
const launchCmd = () => [process.env.APPIMAGE || process.execPath, ...process.argv.slice(1).filter((a) => !a.startsWith('--'))].map((a) => `"${a}"`).join(' ');
function registerGnomeHotkeys() {
  const base = launchCmd();
  const list = [...gsettings('get', GNOME_KEYS, 'custom-keybindings').matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const ours = (k) => `${GNOME_PATH}claude-assistant-${HOTKEY_ACTIONS[k][0].slice(2)}/`;
  const next = list.filter((p) => !Object.keys(HOTKEY_ACTIONS).some((k) => p === ours(k)));
  for (const k of Object.keys(HOTKEY_ACTIONS)) {
    if (!config[k]) continue;
    const schema = `${GNOME_KEYS}.custom-keybinding:${ours(k)}`;
    gsettings('set', schema, 'name', `Claude Assistant · ${HOTKEY_ACTIONS[k][1]}`);
    gsettings('set', schema, 'command', `${base} ${HOTKEY_ACTIONS[k][0]}`);
    gsettings('set', schema, 'binding', gnomeAccel(config[k]));
    next.push(ours(k));
  }
  gsettings('set', GNOME_KEYS, 'custom-keybindings', `[${next.map((p) => `'${p}'`).join(', ')}]`);
}

// Devuelve los nombres de config de los atajos que no se han podido registrar
function registerHotkey() {
  globalShortcut.unregisterAll();
  if (GNOME_WAYLAND) {
    try { registerGnomeHotkeys(); return []; } catch (e) { logError('atajos de GNOME')(e); } // sin gsettings: lo de siempre
  }
  const reg = (key, fn) => { try { return globalShortcut.register(key, fn); } catch { return false; } };
  const failed = [];
  // La de pruebas no se queda el de mostrar/ocultar (es de la app en uso), pero sí el de voz, para probarlo
  if (!TEST_PROFILE && config.hotkey && !reg(config.hotkey, toggleWindow)) failed.push('hotkey');
  if (config.voiceHotkey && !reg(config.voiceHotkey, assist.hotkey)) failed.push('voiceHotkey');
  if (config.shotHotkey && !reg(config.shotHotkey, assist.snipHotkey)) failed.push('shotHotkey');
  return failed;
}

function applyAutoStart() {
  if (TEST_PROFILE) return;
  if (process.platform === 'linux') {
    // Linux: una entrada en ~/.config/autostart (con AppImage, la ruta del archivo y no la de su copia montada)
    const file = path.join(process.env.XDG_CONFIG_HOME || path.join(HOME, '.config'), 'autostart', 'claude-assistant.desktop');
    if (!config.autoStart) { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const exe = process.env.APPIMAGE || process.execPath;
    fs.writeFileSync(file, ['[Desktop Entry]', 'Type=Application', 'Name=Claude Assistant', `Exec="${exe}" --hidden`, 'Icon=claude-assistant', 'X-GNOME-Autostart-enabled=true', ''].join('\n'));
    return;
  }
  // macOS: desde el código (Electron.app) se apuntaría «Electron» como elemento de inicio y avisaría al abrir
  if (IS_MAC) { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.autoStart }); return; }
  // Con «Claude Assistant.exe» Electron cree que está empaquetada (app.isPackaged), pero el código
  // sigue en esta carpeta: solo se omite la ruta si la app va de verdad dentro de resources\.
  const insideResources = path.resolve(__dirname).startsWith(path.resolve(process.resourcesPath));
  const args = insideResources ? ['--hidden'] : [path.resolve(__dirname), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: !!config.autoStart, path: process.execPath, args });
}

// kind: 'done' | 'ask' | 'scheduled' (cada uno se apaga en Configuración › General)
function notify(kind, title, body, convId) {
  const opts = { ...DEFAULTS.notify, ...config.notify };
  if (opts[kind] === false) return;
  const w = convId ? winOf(convId) : win;
  if (w?.isVisible() && w.isFocused()) return;
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath, silent: opts.sound === false });
  n.on('click', () => { showWindow(convId ? winOf(convId) : win); if (convId) send('ui:open-tab', { convId }); });
  n.show();
}

// ---------- Pestañas ----------
// Lo de una pestaña va a su ventana; lo demás (uso, cuentas, comandos…), a todas
const convOf = (id) => (id ? terminals.get(id) : null);
function send(channel, payload) {
  const id = payload?.convId ?? payload?.id;
  if (typeof id === 'string') { post(winOf(id), channel, payload); return; }
  for (const w of appWins) post(w, channel, payload);
}

function buildEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Lo que más gasta son las conversaciones largas: cada llamada vuelve a leer todo el contexto.
  // Con la ventana de 1M, Claude Code no compacta hasta casi llenarla (llamadas de 800k tokens)
  // Vacío: el máximo del modelo (sin heredar el de otra app, p. ej. la de pruebas lanzada desde una pestaña)
  if (config.compactWindow > 0) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(config.compactWindow * 1000);
  else delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  if (config.authMode === 'api-key') {
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    env.ANTHROPIC_API_KEY = decrypt(config.secrets.apiKey);
  } else if (config.authMode === 'oauth-token') {
    delete env.ANTHROPIC_API_KEY;
    env.CLAUDE_CODE_OAUTH_TOKEN = decrypt(config.secrets.oauthToken);
  }
  return env;
}

// Cuenta de GitHub del preset: git la usa sin abrir el selector de cuentas de Git Credential
// Manager, y gh recibe su token (si no, gh usa la cuenta activa de `gh auth switch`)
const ghTokens = new Map();
function githubEnv(user) {
  if (!user) return {};
  if (!ghTokens.has(user)) {
    try {
      ghTokens.set(user, execFileSync('gh', ['auth', 'token', '-u', user], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim());
    } catch { ghTokens.set(user, ''); }
  }
  const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
  const env = { GIT_CONFIG_COUNT: String(n + 1), [`GIT_CONFIG_KEY_${n}`]: 'credential.https://github.com.username', [`GIT_CONFIG_VALUE_${n}`]: user };
  if (ghTokens.get(user)) env.GH_TOKEN = ghTokens.get(user);
  return env;
}

// Control de aplicaciones del equipo (preset con «desktop»): Windows-MCP en Windows y macOS-MCP en macOS,
// de los mismos autores. En Linux no hay: Wayland no deja a una aplicación leer ni manejar las demás.
const DESKTOP_MCP = IS_WIN ? 'Windows-MCP' : IS_MAC ? 'macOS-MCP' : '';
// Para gastar menos: las herramientas propias de WhatsApp cuestan una fracción de lo que cuesta
// manejar WhatsApp Desktop con el control de aplicaciones (cada Snapshot de pantalla completa son ~10k tokens)
const WHATSAPP_NOTE = `Para WhatsApp usa siempre las herramientas mcp__whatsapp__* (buscar, leer, enviar, enviar archivo).${DESKTOP_MCP ? ` No abras ni manejes la aplicación de WhatsApp con ${DESKTOP_MCP}.` : ''}`;
// Todas las pestañas, sea cual sea el preset (también los ya guardados en la configuración)
const LANGUAGE_NOTE = 'Responde siempre en castellano (español de España), en todas las conversaciones, aunque te escriban, citen o pasen material en otro idioma. El código, los comandos y los nombres técnicos se quedan como son.';
const DESKTOP_NOTE = IS_WIN
  ? 'Windows-MCP gasta mucho contexto: úsalo solo cuando no haya otra forma. Antes de un Snapshot, prueba con App, Click o Type; si lo necesitas, limítalo con region a la zona que te interesa y usa use_vision solo si el árbol de la interfaz no basta.'
  : 'macOS-MCP gasta mucho contexto: úsalo solo cuando no haya otra forma. Antes de un Snapshot, prueba con App, Shortcut, Click o Type. Para comandos y AppleScript usa tu herramienta Bash (osascript), no su Shell. Si no responde o falla por permisos, dile al usuario que active Claude Assistant en Ajustes del Sistema › Privacidad y seguridad › Accesibilidad (y Grabación de pantalla para el Snapshot).';

// Plugins activados en la configuración de usuario de Claude Code (~/.claude/settings.json)
function userPlugins() {
  return Object.keys(readJson(path.join(HOME, '.claude', 'settings.json'), {}).enabledPlugins || {});
}

// Opciones de las sondas del SDK (getProbe): sesiones sin mensajes que no gastan tokens
function probeOptions() {
  const options = { env: buildEnv(), settingSources: ['user', 'project', 'local'] };
  if (config.claudePath) options.pathToClaudeCodeExecutable = config.claudePath;
  return options;
}

function sessionEvent(event, payload) {
  assist.onEvent(event, payload);
  if (event === 'chat:done') {
    // Las de una tarea programada avisan con su propio texto (y su interruptor)
    if (!schedules.done(payload.convId, terminals.get(payload.convId)) && !assist.owns(payload.convId)) notify('done', 'Claude ha terminado', payload.title, payload.convId);
    refreshUsageSoon(payload.convId);
  } else if (event === 'usage:rate') {
    onRateLimit(payload.info, payload.convId);
    return;
  } else if (event === 'usage:turn') {
    logUsage({ kind: 'turn', ...payload });
    return;
  } else if (event === 'prompt:new') {
    const what = { question: 'tiene una pregunta', plan: 'tiene un plan listo', permission: 'necesita tu permiso' }[payload.kind];
    if (!assist.owns(payload.convId)) notify('ask', `Claude ${what}`, payload.title, payload.convId);
  } else if (event === 'meta:commands') {
    meta.commands = payload.commands;
    meta.terminal = payload.terminal;
  }
  send(event, payload);
}

const findPreset = (id) => (id ? config.presets.find((p) => p.id === id) : null);

// ---------- Modo terminal: el `claude` interactivo en cada pestaña (sin SDK) ----------
const CHROME_ASK_NOTE = 'Usa Claude in Chrome (el navegador) solo si el usuario lo pide expresamente o después de preguntarle.';
// Vista de chat de esas pestañas: lee su transcripción y responde a sus preguntas y permisos (termchat.mjs)
const termchat = createTermChat({ emit: sessionEvent, write: (id, data) => terminals.write(id, data), ctxLimits });
// Ventana de contexto y umbral de compactado de cada pestaña, según su modelo (Opus 5.5: 1M; Haiku: 200k…)
// y el límite de Configuración (vacío: el máximo del modelo). Se piden una vez por modelo a una sonda
// que se cierra al responder (sin llamadas a la API); mientras, 200k
const ctxCache = new Map(); // cuenta|modelo -> { max, compactAt } (o null mientras se pide)
function ctxLimits(conv) {
  const acc = accKey(conv.account);
  const key = `${acc}|${conv.model || ''}`;
  if (!ctxCache.has(key)) {
    ctxCache.set(key, null);
    let close;
    const idle = (async function* () { await new Promise((r) => (close = r)); })();
    const options = probeOptions();
    const q = query({ prompt: idle, options: { ...options, ...(conv.model ? { model: conv.model } : {}), env: withAccount(options.env, acc || null), cwd: os.homedir() } });
    q.getContextUsage({ detail: 'summary' })
      .then((c) => {
        if (!ctxCache.has(key)) return; // la configuración cambió mientras tanto
        ctxCache.set(key, { max: c.rawMaxTokens || c.maxTokens || 200000, compactAt: c.isAutoCompactEnabled ? c.autoCompactThreshold ?? null : null });
        // Las que ya se leyeron usaban los valores provisionales
        for (const t of terminals.list()) {
          if (!t.context || `${accKey(t.account)}|${t.model || ''}` !== key) continue;
          const l = ctxLimits(t);
          t.context = { ...t.context, max: l.max, compactAt: l.compactAt ?? null, pct: Math.min(100, Math.round((t.context.used / l.max) * 100)) };
          send('conv:update', { convId: t.id, conv: t });
        }
      })
      .catch(() => ctxCache.delete(key))
      .finally(() => { close?.(); try { q.close(); } catch {} });
  }
  return ctxCache.get(key) || { max: 200000, compactAt: null };
}
// Pestañas de terminal trabajando (o esperando una respuesta o con mensajes en cola)
const terminalsBusy = () => terminals.list().filter((c) => c.busy || c.prompts?.length || c.queue?.length).length;
const terminals = createTerminals({
  command: terminalCommand,
  send,
  jobs: { add: (k, p) => jobs.add(k, p), kill: (k) => jobs.kill(k), collect: (k) => jobs.collect?.(k) },
  on: {
    start: (id) => termchat.start(id),
    exit: (id) => termchat.stop(id),
    // No arranca (en el chat y en errores.log) o arranca sin título (solo en errores.log)
    fail: (id, err, { silent } = {}) => {
      logError('pestaña')(err.message);
      if (!silent) termchat.fail(id, `No se pudo abrir Claude Code: ${err.message}`);
    },
    // Primera vez en el modo de acceso total: Claude Code espera a que se acepte su aviso
    notice: (id, kind) => {
      termchat.hold(id);
      if (kind === 'bypass') termchat.fail(id, 'Claude Code pide confirmar el acceso total (solo la primera vez en este equipo): con él, Claude ejecuta y modifica sin preguntar. Acéptalo en Menú › Puesta a punto, o en la terminal de esta pestaña (Ctrl+º › «Yes, I accept»). Si prefieres que pregunte, cambia el modo en Configuración.');
    },
    // «✳ Tema» en espera y un spinner delante mientras trabaja; otros títulos («claude») no cuentan
    title: (id, title) => {
      const m = /^([\p{S}\p{P}\u2800-\u28ff])\s+/u.exec(title);
      if (!m) return;
      const busy = m[1] !== '✳';
      termchat.setBusy(id, busy);
      if (!busy && pendingRelaunch.delete(id)) terminals.restart(id); // cambió de cuenta mientras trabajaba
    },
  },
});

// Cómo se lanza el `claude` de una pestaña: su preset, la configuración y la cuenta
function terminalCommand(conv) {
  const preset = findPreset(conv.preset?.id);
  const args = [];
  // El id de la pestaña es el de la sesión: así se puede retomar tras salir o reiniciar (tras /clear, la nueva)
  const sid = conv.sessionId || conv.id;
  if (conv.resume && sessionExists(sid)) args.push('--resume', sid);
  else args.push('--session-id', conv.id);
  if (conv.model) args.push('--model', conv.model);
  if (conv.effort) args.push('--effort', conv.effort);
  if (conv.permissionMode) args.push('--permission-mode', conv.permissionMode);
  args.push('--exclude-dynamic-system-prompt-sections');
  const notes = [preset?.whatsapp && WHATSAPP_NOTE, DESKTOP_MCP && preset?.desktop && DESKTOP_NOTE, preset?.chrome && preset?.chromeAsk && CHROME_ASK_NOTE];
  const append = [LANGUAGE_NOTE, config.systemPrompt?.trim(), preset?.instructions?.trim(), ...notes].filter(Boolean).join('\n\n');
  if (append) args.push('--append-system-prompt', append);
  for (const d of (preset?.addDirs || []).filter((x) => x && fs.existsSync(x))) args.push('--add-dir', d);
  if (preset?.chrome) args.push('--chrome');
  const settings = {};
  const off = extOff(preset, conv.ext);
  const pluginsOff = preset?.plugins === false ? userPlugins() : off.plugins;
  if (pluginsOff.length) settings.enabledPlugins = Object.fromEntries(pluginsOff.map((id) => [id, false]));
  if (off.mcp.length) settings.deniedMcpServers = off.mcp.map((serverName) => ({ serverName }));
  // En blanco sin ninguno encendido a mano: ni los de claude.ai ni los de ~/.claude.json (aunque aún no se conozca la lista)
  const bare = off.bare && !Object.values(conv.ext?.mcp || {}).includes(true);
  if (bare) { settings.disableClaudeAiConnectors = true; args.push('--strict-mcp-config'); }
  if (off.skills.length) settings.skillOverrides = Object.fromEntries(off.skills.map((n) => [n, 'off']));
  const hooks = termchat.hookSettings(conv.id);
  if (hooks) settings.hooks = hooks;
  settings.permissions = { allow: ['mcp__claude-assistant__vista_previa'] }; // solo enseña una página local
  if (Object.keys(settings).length) args.push('--settings', JSON.stringify(settings));
  const mcpServers = {};
  const pm = presetsMcp.config();
  if (pm) mcpServers.presets = pm;
  const am = appMcp.config();
  if (am) mcpServers['claude-assistant'] = { ...am, url: `${am.url}&tab=${encodeURIComponent(conv.id)}` };
  // WhatsApp en segundo plano (whatsapp.mjs), por HTTP desde la app
  const wa = preset?.whatsapp && whatsapp.mcpConfig();
  if (wa) mcpServers.whatsapp = wa;
  if (DESKTOP_MCP && preset?.desktop) {
    // Control de aplicaciones: abrir apps, leer la pantalla, clic, escribir… Sin telemetría.
    // Windows: sin lo que ya tiene Claude Code (PowerShell, archivos) ni el registro, y sin Screenshot (Snapshot con use_vision ya la da)
    if (IS_WIN) mcpServers['windows-mcp'] = { type: 'stdio', command: uvxPath(), args: ['windows-mcp', 'serve', '--exclude-tools', 'Registry,PowerShell,FileSystem,Screenshot'], env: { ANONYMIZED_TELEMETRY: 'false' } };
    // macOS: los permisos de Accesibilidad y Grabación de pantalla son los de la app (la que lo lanza)
    else mcpServers['macos-mcp'] = { type: 'stdio', command: uvxPath(), args: ['macos-mcp'], env: { ANONYMIZED_TELEMETRY: 'false' } };
  }
  if (Object.keys(mcpServers).length) args.push('--mcp-config', JSON.stringify({ mcpServers }));
  const env = withAccount({ ...buildEnv(), ...githubEnv(preset?.github), COLORTERM: 'truecolor', ...(bare ? { ENABLE_CLAUDEAI_MCP_SERVERS: 'false' } : {}) }, conv.account);
  // Si la app se abrió desde otra sesión de Claude Code, que no se crea anidada
  for (const k of ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN']) delete env[k];
  const cwd = fs.existsSync(conv.cwd) ? conv.cwd : HOME;
  const file = terminalClaude(config.claudePath, __dirname);
  return { ...(jobs.wrap ? jobs.wrap(conv.id, file, args) : { file, args }), cwd, env };
}

// uvx (de uv, https://docs.astral.sh/uv/): lanza Windows-MCP o macOS-MCP sin instalarlos aparte
function uvxPath() {
  const exe = IS_WIN ? 'uvx.exe' : 'uvx';
  return [path.join(HOME, '.local', 'bin', exe), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map((d) => path.join(d, exe))].find((p) => fs.existsSync(p)) || 'uvx';
}

// Entorno para lanzar Claude Code con la cuenta de la pestaña: su perfil (accounts.mjs), salvo la activa
function withAccount(env, key) {
  const dir = key && accounts.profile(key);
  if (!dir) return env;
  const out = { ...env, CLAUDE_CONFIG_DIR: dir };
  delete out.ANTHROPIC_API_KEY;
  delete out.CLAUDE_CODE_OAUTH_TOKEN;
  return out;
}

// Una pestaña nueva: con preset (su carpeta, modelo, modo e instrucciones) o en blanco
function createTerminalTab({ presetId, cwd, id = crypto.randomUUID(), restore, model, effort, account = null } = {}) {
  const preset = findPreset(presetId);
  if (preset?.cwd) fs.mkdirSync(preset.cwd, { recursive: true });
  const dir = [restore?.cwd, cwd, preset?.cwd, config.cwd].find((d) => d && fs.existsSync(d)) || os.homedir();
  const conv = terminals.create({
    id,
    terminal: true,
    title: restore?.title || preset?.name || 'Claude Code',
    preset: preset ? { id: preset.id, name: preset.name, emoji: preset.emoji, color: preset.color } : null,
    cwd: dir,
    // Al reabrir tras un reinicio, lo que tenía la pestaña
    model: restore?.model ?? (model || preset?.model || config.model || ''),
    effort: restore?.effort ?? (effort || preset?.effort || config.effort || ''),
    permissionMode: restore?.permissionMode ?? (preset?.permissionMode || config.permissionMode || ''),
    resume: !!restore?.resume,
    sessionId: restore?.sessionId || '',
    account: restore ? restore.account || null : account,
    busy: false,
    messages: [], prompts: [], queue: [], tasks: [],
  });
  termchat.attach(conv);
  return conv;
}

const whatsapp = createWhatsApp({ icon: winIcon, getConfig: () => config });
// Si ya se vinculó alguna vez, se carga al arrancar (oculta) para que esté sincronizada cuando haga falta
const WHATSAPP_LINKED = () => fs.existsSync(path.join(DATA_DIR, 'Partitions', 'whatsapp'));
whatsapp.mcpConfig(); // su servidor MCP ya escuchando cuando se abra la primera pestaña

const assist = createAssist({
  dir: __dirname,
  getConfig: () => config,
  getConv: (id) => terminals.get(id),
  createTab: (opts) => {
    const conv = createTerminalTab(opts);
    terminals.start(conv.id); // en segundo plano: la interfaz la pinta si se abre
    return conv;
  },
  send: (id, payload) => termchat.send(id, payload),
  adoptTab: (conv) => post(win, 'ui:adopt-tab', { conv }),
  openTab: (convId) => { showWindow(winOf(convId)); send('ui:open-tab', { convId }); },
});

// ---------- Tareas programadas ----------
// Se lanzan en la ventana principal, con su cuenta, en una pestaña nueva en segundo plano
const schedules = createSchedules({
  list: () => config.schedules || [],
  update: (id, patch) => {
    const s = config.schedules?.find((x) => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    saveConfig();
    for (const w of appWins) post(w, 'config:changed', publicConfig());
  },
  launch: (s) => {
    const conv = createTerminalTab({ presetId: s.presetId, account: accountOfWin(win) });
    conv.title = s.name;
    conv.fixedTitle = true;
    terminals.start(conv.id);
    post(win, 'ui:adopt-tab', { conv });
    termchat.send(conv.id, { text: s.prompt, images: [] });
    return conv;
  },
  finished: (s, conv) => {
    const msg = [...(conv?.messages || [])].reverse().find((m) => m.role === 'assistant');
    const text = (msg?.blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
    notify('scheduled', `Tarea programada: ${s.name}`, text.slice(0, 180) || 'Terminada', conv?.id);
  },
});
const cleanSchedules = (list) => (Array.isArray(list) ? list.slice(0, 100).map((x) => cleanSchedule(x, (config.presets || []).map((p) => p.id))) : []);
ipcMain.handle('sched:run', (_e, id) => {
  const s = config.schedules?.find((x) => x.id === id);
  if (!s?.prompt?.trim()) return null;
  return schedules.run(s)?.id || null;
});

// ---------- Reiniciar con las pestañas abiertas ----------
// Al aplicar cambios desde la copia de pruebas (tools/apply.cjs) o al reiniciar la de pruebas
// (tools/dev.cjs restart), la app guarda sus pestañas, se cierra y tools/watchdog.cjs la vuelve
// a abrir con --restore. Si la versión nueva no llega a arrancar, el watchdog vuelve a la anterior.
const RESTORE_FILE = path.join(DATA_DIR, 'restore.json');
const READY_FILE = path.join(DATA_DIR, 'ready.json');   // lo escribe cada arranque que llega a la interfaz
const UPDATE_FILE = path.join(DATA_DIR, 'update.json'); // { prev }: commit anterior, lo deja tools/apply.cjs
const NOTE_FILE = path.join(DATA_DIR, 'update-note.json');
let restoreData = process.argv.includes('--restore') ? readJson(RESTORE_FILE, null) : null;
let idleWait = null;

function restartApp() {
  clearInterval(idleWait);
  // Se reabren todas en la ventana principal: primero las suyas y luego las de las demás
  const tabOrder = [win, ...[...appWins].filter((w) => w !== win)].flatMap((w) => winTabs.get(w)?.order || []);
  const tabActive = winTabs.get(win)?.active || null;
  const all = terminals.list().map((c) => c.id);
  const ordered = [...tabOrder.filter((id) => terminals.has(id)), ...all.filter((id) => !tabOrder.includes(id))];
  // El chat se vuelve a leer de la transcripción al reabrir
  const tabs = ordered.map((id) => {
    const c = terminals.get(id);
    return { presetId: c.preset?.id || null, terminal: true, conv: { ...c, messages: [], prompts: [], queue: [], tasks: [] } };
  });
  const update = readJson(UPDATE_FILE, null);
  // También la cuenta de la ventana principal: si no, al volver mostraría la activa mientras sus pestañas siguen con otra
  writeJson(RESTORE_FILE, { at: Date.now(), active: tabActive, updated: !!update, account: accountOfWin(win), tabs });
  const args = process.argv.slice(1).filter((a) => !['--restore', '--hidden'].includes(a) && !a.startsWith('--account='));
  if (IS_WIN) {
    const watch = { pid: process.pid, exe: process.execPath, args: [...args, '--restore'], appDir: __dirname, dataDir: DATA_DIR, prev: update?.prev || null };
    spawn(process.execPath, [path.join(__dirname, 'tools', 'watchdog.cjs')], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CA_WATCH: JSON.stringify(watch) },
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } else {
    // Fuera de Windows no hay watchdog (las copias repartidas no se actualizan desde dev): la reabre Electron
    app.relaunch({ execPath: process.env.APPIMAGE || process.execPath, args: [...args, '--restore'] });
  }
  quitting = true;
  app.quit();
}

// Cambios aplicados: se ofrece reiniciar (ahora, cuando terminen las pestañas o más tarde)
function offerRestart() {
  showWindow();
  post(win, 'update:ready', { busy: terminalsBusy() });
}

// tools/apply.cjs y tools/dev.cjs piden el reinicio dejando este archivo ({ mode: 'offer' | 'now' }).
// Así avisar no ejecuta el código nuevo, que podría estar roto.
const REQUEST_FILE = path.join(DATA_DIR, 'restart-request.json');
function checkRestartRequest() {
  const req = readJson(REQUEST_FILE, null);
  if (!req) return;
  fs.rmSync(REQUEST_FILE, { force: true });
  if (req.mode === 'now') restartApp(); else offerRestart();
}
fs.rmSync(REQUEST_FILE, { force: true });
fs.watchFile(REQUEST_FILE, { interval: 700 }, checkRestartRequest);

ipcMain.handle('update:restart', (_e, { whenIdle } = {}) => {
  if (!whenIdle) return restartApp();
  clearInterval(idleWait);
  idleWait = setInterval(() => {
    if (!terminalsBusy()) restartApp();
  }, 2000);
});
ipcMain.on('tabs:order', (e, order, active) => { winTabs.set(senderWin(e), { order, active }); });

// La interfaz ha arrancado: pestañas que reabrir (tras un reinicio) o las que ya hay (si se recargó)
ipcMain.handle('tabs:boot', (e) => {
  const w = senderWin(e);
  const { order: tabOrder = [], active: tabActive = null } = winTabs.get(w) || {};
  // Otra ventana: solo sus pestañas (la que se arrastró al crearla)
  if (w !== win) {
    const ids = [...owner].filter(([, o]) => o === w).map(([id]) => id);
    const sorted = [...tabOrder.filter((id) => ids.includes(id)), ...ids.filter((id) => !tabOrder.includes(id))];
    return { convs: sorted.map((id) => terminals.get(id)).filter(Boolean), active: tabActive || sorted[0], secondary: true };
  }
  writeJson(READY_FILE, { at: Date.now(), pid: process.pid });
  fs.rmSync(UPDATE_FILE, { force: true });
  let note = readJson(NOTE_FILE, null);
  fs.rmSync(NOTE_FILE, { force: true });
  let convs = [];
  let active = tabActive;
  if (restoreData) {
    for (const t of restoreData.tabs || []) {
      // Todas vuelven a esta ventana, y con su cuenta (también las que venían de otra ventana)
      const restore = { ...t.conv, account: accountOfWin(w) };
      // Las de antes del modo terminal (SDK) se retoman también en la terminal
      if (!t.terminal) Object.assign(restore, { resume: !!t.conv.sessionId, messages: [], prompts: [], queue: [], tasks: [] });
      try { convs.push(createTerminalTab({ id: t.conv.id, presetId: t.presetId, restore })); } catch {}
    }
    active = restoreData.active;
    if (!note && restoreData.updated) note = { applied: true };
    restoreData = null;
    fs.rmSync(RESTORE_FILE, { force: true });
  } else if (terminals.list().length) {
    const known = (id) => terminals.has(id) && winOf(id) === win;
    const all = terminals.list().map((c) => c.id).filter(known);
    const ids = [...tabOrder.filter(known), ...all.filter((id) => !tabOrder.includes(id))];
    convs = ids.map((id) => terminals.get(id));
  }
  return { convs, active, note };
});

// ---------- Procesos de cada pestaña (Job Objects de Windows) ----------
// Todo lo que lance una pestaña (shells, servidores de desarrollo…) vive en su job;
// al cerrar la pestaña se termina entero. Ver jobhelper.ps1.
// Linux y macOS: scope de systemd o grupos de procesos (unix-jobs.mjs)
const jobs = !IS_WIN ? createUnixJobs({ log: logError('scopes de systemd') }) : (() => {
  let helper = null;
  let ready = null;
  let chain = Promise.resolve();
  const waiting = [];
  function start() {
    helper = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'jobhelper.ps1')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const rl = readline.createInterface({ input: helper.stdout });
    ready = new Promise((resolve) => {
      rl.once('line', () => {
        rl.on('line', (l) => waiting.shift()?.(l));
        resolve();
      });
    });
    helper.on('exit', () => { helper = null; while (waiting.length) waiting.shift()('err salida'); });
  }
  function cmd(line) {
    chain = chain.then(async () => {
      if (!helper) start();
      await ready;
      return new Promise((resolve) => { waiting.push(resolve); helper.stdin.write(line + '\n'); });
    }).catch(() => 'err');
    return chain;
  }
  return {
    add: (key, pid) => cmd(`add ${key} ${pid}`),
    kill: (key) => cmd(`kill ${key}`),
  };
})();

// ---------- Metadatos: modelos y comandos disponibles ----------
// Se consultan con una sesión sin mensajes, que no gasta tokens. Esa misma sesión se
// queda abierta para consultar el uso del plan (como /usage) sin gastar nada.
const meta = { models: [], commands: [], terminal: [] };
// Una por cuenta ('' la activa): la de cada otra cuenta, solo para su uso del plan
const probes = new Map();
const accKey = (k) => (k && k !== accounts.activeKey() ? k : '');
function getProbe(acc = '') {
  if (probes.has(acc)) return probes.get(acc);
  let close;
  const idle = (async function* () { await new Promise((r) => (close = r)); })();
  const options = probeOptions();
  const q = query({ prompt: idle, options: { ...options, env: withAccount(options.env, acc || null), cwd: fs.existsSync(config.cwd) ? config.cwd : os.homedir() } });
  const probe = { q, close: () => { close?.(); try { q.close(); } catch {} if (probes.get(acc) === probe) probes.delete(acc); } };
  probes.set(acc, probe);
  return probe;
}
const closeProbes = () => { for (const p of [...probes.values()]) p.close(); };

async function loadMeta() {
  try {
    const { q } = getProbe();
    const [models, commands] = await Promise.all([q.supportedModels(), q.supportedCommands()]);
    meta.models = models;
    meta.commands = commands;
  } catch (err) {
    console.error('No se pudieron cargar modelos/comandos:', err?.message || err);
    probes.get('')?.close();
  }
  send('meta:update', meta);
}

// ---------- Conectores, skills y plugins (Configuración › Conectores y cada preset) ----------
// Se leen de la sonda (como /mcp y /skills) y de los plugins instalados; se apagan por pestaña
// con --settings (deniedMcpServers, skillOverrides, enabledPlugins), sin tocar los ajustes de Claude Code
const EXT_KINDS = ['mcp', 'skills', 'plugins'];
function installedPlugins() {
  const dir = path.join(HOME, '.claude', 'plugins');
  const installed = readJson(path.join(dir, 'installed_plugins.json'), {}).plugins || {};
  const enabled = readJson(path.join(HOME, '.claude', 'settings.json'), {}).enabledPlugins || {};
  return Object.entries(installed).map(([id, list]) => {
    const inst = list.find((x) => x.scope === 'user') || list[0] || {};
    const man = readJson(path.join(inst.installPath || '', '.claude-plugin', 'plugin.json'), {});
    return { id, name: id.split('@')[0], marketplace: id.split('@')[1] || '', version: inst.version || man.version || '', description: man.description || '', enabled: enabled[id] === true };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
let extCache = null;
async function listExtensions(fresh) {
  if (extCache && !fresh) return extCache;
  // Claude Code pide los conectores de claude.ai al arrancar: para ver los recién conectados, sonda nueva
  if (fresh) probes.get('')?.close();
  // accounts: los conectores de claude.ai son de cada cuenta (los de la activa también van en mcp, con account)
  const out = { mcp: [], skills: [], plugins: installedPlugins(), accounts: [], error: '' };
  const toItem = (account) => (s) => ({
    name: s.name, status: s.status, scope: s.scope || '',
    source: s.config?.type === 'claudeai-proxy' ? 'claudeai' : s.name.startsWith('plugin:') ? 'plugin' : 'local',
    tools: s.tools?.length || 0, account,
  });
  // Los servidores conectan (y los de claude.ai aparecen) en segundo plano: se espera a que se asienten
  const settled = async (q) => {
    let list = await q.mcpServerStatus();
    for (const end = Date.now() + 12000; Date.now() < end; ) {
      await new Promise((r) => setTimeout(r, 800));
      const next = await q.mcpServerStatus();
      const still = next.length === list.length && !next.some((s) => s.status === 'pending');
      list = next;
      if (still) break;
    }
    return list;
  };
  // Las demás cuentas, cada una con su sonda (como la del uso del plan); la que se abre solo para esto, se cierra
  let others = [];
  try { others = config.authMode === 'claude-code' ? accountList().filter((a) => !a.active && !a.locked) : []; } catch {}
  const othersDone = Promise.all(others.map(async (a) => {
    const had = probes.has(a.key);
    if (fresh && had) probes.get(a.key).close();
    const probe = getProbe(a.key);
    const entry = { key: a.key, email: a.email, color: a.color, active: false, mcp: [], error: '' };
    try { entry.mcp = (await settled(probe.q)).filter((s) => s.config?.type === 'claudeai-proxy').map(toItem(a.key)); } catch (err) { entry.error = String(err?.message || err); }
    if (!had || fresh) probe.close();
    return entry;
  }));
  try {
    const { q } = getProbe();
    const [servers, skills] = await Promise.all([settled(q), q.reloadSkills().then((r) => r.skills).catch(() => [])]);
    const me = (() => { try { return accountList().find((a) => a.active); } catch { return null; } })();
    out.mcp = servers.map(toItem(me?.key || ''));
    if (me) out.accounts.push({ key: me.key, email: me.email, color: me.color, active: true, mcp: out.mcp.filter((s) => s.source === 'claudeai'), error: '' });
    // Las de los plugins (plugin:skill) van con su plugin
    out.skills = skills.filter((s) => !s.name.includes(':')).map((s) => ({ name: s.name, description: s.description || '' })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    out.error = String(err?.message || err);
    probes.get('')?.close();
  }
  out.accounts.push(...await othersDone);
  extCache = out;
  return out;
}
// Lo apagado para una pestaña: lo general (config.ext), encima lo de su preset y encima lo de la
// propia pestaña (menú + del chat, conv.ext)
function extOff(preset, own) {
  const off = {};
  // En blanco (sin preset): nada de conectores ni plugins, salvo lo que se encienda en la propia pestaña
  if (!preset && config.blankBare !== false) {
    const keep = (k) => (n) => own?.[k]?.[n] !== true;
    const skills = { ...(config.ext?.skills || {}), ...(own?.skills || {}) };
    return {
      mcp: (extCache?.mcp || []).map((s) => s.name).filter(keep('mcp')),
      skills: Object.keys(skills).filter((n) => skills[n] === false),
      plugins: userPlugins().filter(keep('plugins')),
      bare: true,
    };
  }
  for (const k of EXT_KINDS) {
    const merged = { ...(config.ext?.[k] || {}), ...(preset?.ext?.[k] || {}), ...(own?.[k] || {}) };
    off[k] = Object.keys(merged).filter((n) => merged[n] === false);
  }
  return off;
}
const cleanExt = (ext) => Object.fromEntries(EXT_KINDS.map((k) => [k, Object.fromEntries(Object.entries(ext?.[k] || {}).filter(([, v]) => typeof v === 'boolean').map(([n, v]) => [String(n).slice(0, 200), v]))]));
ipcMain.handle('ext:list', (_e, fresh) => listExtensions(fresh));
// Encender o apagar un conector o una skill solo en esta pestaña: se vuelve a lanzar retomando la conversación
ipcMain.handle('tab:ext', (_e, id, kind, name, on) => {
  const conv = convOf(id);
  if (!conv || !EXT_KINDS.includes(kind)) return null;
  conv.ext = { ...conv.ext, [kind]: { ...conv.ext?.[kind], [String(name).slice(0, 200)]: !!on } };
  if (conv.busy) pendingRelaunch.add(id);
  else terminals.restart(id);
  return conv.ext;
});
ipcMain.handle('tab:ext-off', async (_e, id) => {
  const conv = convOf(id);
  if (!conv) return null;
  await listExtensions(); // la pestaña en blanco necesita la lista para saber qué tiene apagado
  return extOff(findPreset(conv.preset?.id), conv.ext);
});
// Menú + del chat: archivos para mencionarlos con @ y una captura de pantalla (el recorte del asistente)
ipcMain.handle('dialog:paths', async (e, cwd) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Añadir archivos a la conversación', defaultPath: cwd && fs.existsSync(cwd) ? cwd : os.homedir(),
    properties: ['openFile', 'multiSelections'],
  });
  return r.canceled ? [] : r.filePaths;
});
// /export: guarda la conversación (Markdown que arma la interfaz) donde se elija
// Guardar texto en un archivo: la conversación exportada (.md) o un artefacto del panel (.html, .svg, …)
ipcMain.handle('dialog:export', async (e, { name, text, cwd, title }) => {
  const ext = (/\.(\w+)$/.exec(name)?.[1] || 'md').toLowerCase();
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    title: title || 'Exportar la conversación', defaultPath: path.join(cwd && fs.existsSync(cwd) ? cwd : app.getPath('documents'), name),
    filters: ext === 'md' || ext === 'txt' ? [{ name: 'Markdown', extensions: ['md'] }, { name: 'Texto', extensions: ['txt'] }]
      : [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Todos los archivos', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, text, 'utf8');
  return r.filePath;
});
ipcMain.handle('shot:take', async (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  const wasVisible = w?.isVisible();
  if (wasVisible) { w.hide(); await new Promise((r) => setTimeout(r, 250)); } // que no salga en la captura
  try { return await assist.snipFor(); } finally { if (wasVisible) { w.show(); w.focus(); } }
});
// MCP propios (ámbito usuario, como `claude mcp add-json -s user`)
ipcMain.handle('ext:mcp-add', async (_e, name, json) => {
  name = String(name || '').trim();
  if (!/^[\w.-]{1,64}$/.test(name)) return { ok: false, error: 'Nombre no válido: letras, números, guiones y puntos.' };
  let cfg;
  try { cfg = JSON.parse(json); } catch { return { ok: false, error: 'El JSON no es válido.' }; }
  if (!cfg || typeof cfg !== 'object' || (!cfg.command && !cfg.url)) return { ok: false, error: 'Falta "command" (stdio) o "url" (http/sse).' };
  if (cfg.url && !cfg.type) cfg.type = 'http';
  try {
    execFileSync(terminalClaude(config.claudePath, __dirname), ['mcp', 'add-json', name, JSON.stringify(cfg), '-s', 'user'], { env: buildEnv(), encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { return { ok: false, error: String(err.stderr || err.message).trim().split('\n')[0] }; }
  probes.get('')?.close(); // la sonda nueva ya lo ve
  return { ok: true, list: await listExtensions(true) };
});
ipcMain.handle('ext:mcp-remove', async (_e, name) => {
  try {
    execFileSync(terminalClaude(config.claudePath, __dirname), ['mcp', 'remove', String(name), '-s', 'user'], { env: buildEnv(), encoding: 'utf8', windowsHide: true, timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) { return { ok: false, error: String(err.stderr || err.message).trim().split('\n')[0] }; }
  probes.get('')?.close();
  return { ok: true, list: await listExtensions(true) };
});

// ---------- Uso del plan (ventana de 5 horas y semanal), por cuenta ----------
const usages = new Map(); // cuenta ('' la activa) -> uso
let usageTimer = null;
let lastPolled = null;
const pickWindow = (w) => (w && w.utilization != null ? { used: w.utilization, resetsAt: w.resets_at } : null);
const usageOfWin = (w) => usages.get(accKey(accountOfWin(w))) || null;
// Cada ventana ve el de su cuenta
function sendUsage() {
  for (const w of appWins) post(w, 'usage:update', usageOfWin(w));
}
const accountsInUse = () => new Set(['', ...[...appWins].map((w) => accKey(accountOfWin(w)))]);
// Sin cuenta: las de todas las ventanas. Las sondas de cuentas que ya no usa ninguna ventana se cierran.
async function refreshUsage(acc) {
  if (acc === undefined) {
    clearTimeout(usageTimer);
    usageTimer = setTimeout(refreshUsage, 90 * 1000);
    const used = accountsInUse();
    for (const [k, p] of probes) if (!used.has(k)) { p.close(); usages.delete(k); }
    await Promise.all([...used].map((k) => refreshUsage(k)));
    return;
  }
  let usage = usages.get(acc) || null;
  try {
    const u = await getProbe(acc).q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    if (!u.rate_limits_available || !u.rate_limits) {
      usage = { available: false, plan: u.subscription_type };
    } else {
      const rl = u.rate_limits;
      usage = {
        available: true,
        plan: u.subscription_type,
        session: pickWindow(rl.five_hour),
        week: pickWindow(rl.seven_day),
        models: (rl.model_scoped || []).filter((m) => m.utilization != null).map((m) => ({ name: m.display_name, used: m.utilization, resetsAt: m.resets_at })),
        updatedAt: Date.now(),
      };
      const polled = { kind: 'poll', session: usage.session?.used ?? null, week: usage.week?.used ?? null, resetsAt: usage.session?.resetsAt || null };
      if (!acc && JSON.stringify(polled) !== lastPolled) { lastPolled = JSON.stringify(polled); logUsage(polled); }
    }
  } catch (err) {
    // La función es experimental: si cambia, nos quedamos con lo que llegue en los avisos de límite
    console.error('Uso del plan no disponible:', err?.message || err);
    probes.get(acc)?.close();
  }
  usages.set(acc, usage);
  sendUsage();
}
// Tras un turno: el de la cuenta de esa pestaña
const usageSoon = new Map();
const refreshUsageSoon = (convId) => {
  const acc = accKey(convOf(convId)?.account);
  clearTimeout(usageSoon.get(acc));
  usageSoon.set(acc, setTimeout(() => refreshUsage(acc), 2500));
};

// Registro de consumo (usage-log.jsonl en la carpeta de datos): cada turno con sus tokens y su
// coste equivalente, y cada aviso de límite con el % de la ventana. Con los dos se calcula cuánto
// gasta la app por cada 1 % de la ventana de 5 h (tools/usage-report.cjs) y se compara con la terminal.
const USAGE_LOG = path.join(DATA_DIR, 'usage-log.jsonl');
function logUsage(entry) {
  try { fs.appendFileSync(USAGE_LOG, JSON.stringify({ at: Date.now(), ...entry }) + '\n'); } catch {}
}

// Avisos de límite que llegan con cada respuesta: actualizan al momento la ventana afectada
function onRateLimit(info, convId) {
  if (!info?.rateLimitType || info.utilization == null) return;
  const acc = accKey(convOf(convId)?.account);
  if (!acc) logUsage({ kind: 'rate', type: info.rateLimitType, utilization: info.utilization, resetsAt: info.resetsAt });
  const key = info.rateLimitType === 'five_hour' ? 'session' : info.rateLimitType === 'seven_day' ? 'week' : null;
  if (!key) return;
  const usage = usages.get(acc);
  usages.set(acc, { available: true, ...(usage || {}), [key]: { used: Math.round(info.utilization * (info.utilization <= 1 ? 100 : 1)), resetsAt: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : usage?.[key]?.resetsAt }, updatedAt: Date.now() });
  sendUsage();
}

// ---------- Sugerencias de archivos para @ ----------
const SKIP_DIRS = new Set(['node_modules', '.git', '$Recycle.Bin', 'AppData', '.cache', '.npm', '.gradle', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'target']);
const fileIndex = new Map(); // cwd -> { at, entries: [{ rel, dir }] }

function indexDir(root) {
  const cached = fileIndex.get(root);
  if (cached && Date.now() - cached.at < 60000) return cached.entries;
  const entries = [];
  const queue = [{ abs: root, rel: '', depth: 0 }];
  while (queue.length && entries.length < 25000) {
    const { abs, rel, depth } = queue.shift();
    let items;
    try { items = fs.readdirSync(abs, { withFileTypes: true }); } catch { continue; }
    for (const it of items) {
      if (it.name.startsWith('.') && depth === 0 && it.name !== '.claude') continue;
      const r = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        entries.push({ rel: r, dir: true });
        if (depth < 6) queue.push({ abs: path.join(abs, it.name), rel: r, depth: depth + 1 });
      } else {
        entries.push({ rel: r, dir: false });
      }
    }
  }
  fileIndex.set(root, { at: Date.now(), entries });
  return entries;
}

function suggestFiles(cwd, q) {
  const needle = q.toLowerCase().replace(/\\/g, '/');
  const entries = indexDir(cwd);
  const scored = [];
  for (const e of entries) {
    const low = e.rel.toLowerCase();
    const base = low.slice(low.lastIndexOf('/') + 1);
    let score = 0;
    if (!needle) score = e.rel.includes('/') ? 0 : 1;
    else if (base.startsWith(needle)) score = 4;
    else if (base.includes(needle)) score = 3;
    else if (low.startsWith(needle)) score = 2;
    else if (low.includes(needle)) score = 1;
    if (score) scored.push({ ...e, score });
  }
  scored.sort((a, b) => b.score - a.score || a.rel.length - b.rel.length);
  return scored.slice(0, 14).map(({ rel, dir }) => ({ rel, dir }));
}

// ---------- IPC ----------
ipcMain.handle('tab:create', (e, opts = {}) => {
  const w = senderWin(e);
  // Preset con su cuenta: la pestaña va a una ventana de esa cuenta (la que haya abierta o una nueva)
  const target = opts.resume || opts.here ? null : presetWindow(w, findPreset(opts.presetId));
  const dest = target || w;
  opts = { ...opts, account: accountOfWin(dest) };
  // Retomar una conversación del historial: como al reabrir tras un reinicio, con la cuenta de la ventana
  if (opts.resume) opts.restore = { resume: true, sessionId: opts.resume, cwd: opts.cwd, title: opts.title, account: opts.account };
  const conv = createTerminalTab(opts);
  if (dest !== win) owner.set(conv.id, dest);
  if (!target) return conv;
  // Una ventana recién creada la recoge al arrancar (tabs:boot); una abierta, como si se la arrastrara
  if (!target.fresh) post(target, 'ui:take-tab', { conv });
  delete target.fresh;
  if (target.isMinimized()) target.restore();
  target.show();
  target.focus();
  const a = accountList().find((x) => sameAccount(x.key, accountOfWin(target)));
  return { ...conv, elsewhere: a?.email || true };
});
// La ventana para un preset con cuenta propia (preset.account), si no es la de esta. Si esa cuenta ya no
// está o hay que volver a iniciar sesión con ella, se queda en esta. Luego se puede cambiar como cualquier otra.
function presetWindow(from, preset) {
  const key = preset?.account;
  if (!key || config.authMode !== 'claude-code' || sameAccount(key, accountOfWin(from))) return null;
  const a = accounts.list().find((x) => x.key === key);
  if (!a || a.locked) return null;
  const open = [...appWins].find((w) => !w.host && alive(w) && sameAccount(accountOfWin(w), key));
  if (open) return open;
  const nw = newAccountWindow(key);
  nw.fresh = true;
  return nw;
}

// ---------- Historial de conversaciones (Ctrl+H o /resume) ----------
// Las de ~/.claude/projects, como el selector de /resume: título (el que pone Claude Code o /rename),
// primer mensaje, carpeta y fecha. Solo se leen el principio y el final de cada .jsonl.
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const HISTORY_MAX = 400;
const historyCache = new Map(); // archivo -> { mtime, size, item }

async function readSlice(fh, pos, len) {
  const buf = Buffer.alloc(len);
  const { bytesRead } = await fh.read(buf, 0, len, pos);
  return buf.toString('utf8', 0, bytesRead);
}
const promptText = (content) => (typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '');

async function historyItem(file, st) {
  const SLICE = 64 * 1024;
  const fh = await fs.promises.open(file, 'r');
  let text;
  try {
    text = await readSlice(fh, 0, Math.min(st.size, SLICE));
    if (st.size > SLICE) text += '\n' + await readSlice(fh, Math.max(SLICE, st.size - SLICE), Math.min(SLICE, st.size - SLICE));
  } finally { await fh.close(); }
  let cwd = '', prompt = '', aiTitle = '', customTitle = '', summary = '';
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!cwd && o.cwd) cwd = o.cwd;
    // Al aprobar un plan Claude Code renombra la sesión con un slug («add-adios-line-to-file»): se deja legible
    if (o.type === 'ai-title' && o.aiTitle) aiTitle = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(o.aiTitle) ? o.aiTitle[0].toUpperCase() + o.aiTitle.slice(1).replace(/-/g, ' ') : o.aiTitle;
    else if (o.type === 'custom-title' && o.customTitle) customTitle = o.customTitle;
    else if (o.type === 'summary' && o.summary) summary = o.summary;
    else if (!prompt && o.type === 'user' && !o.isSidechain && !o.isMeta) {
      const t = unwrapPasted(promptText(o.message?.content));
      // Sin los avisos internos (<command-name>, <local-command-caveat>…)
      if (t && !t.startsWith('<')) prompt = t.replace(/\s+/g, ' ').slice(0, 300);
    }
  }
  if (!prompt && !aiTitle && !customTitle) return null; // vacía: nunca se llegó a escribir nada
  return { id: path.basename(file, '.jsonl'), cwd, title: customTitle || aiTitle || summary || prompt, prompt, mtime: st.mtimeMs };
}

ipcMain.handle('history:list', async () => {
  const files = [];
  let dirs = [];
  try { dirs = await fs.promises.readdir(PROJECTS_DIR); } catch {}
  await Promise.all(dirs.map(async (d) => {
    let names = [];
    try { names = await fs.promises.readdir(path.join(PROJECTS_DIR, d)); } catch { return; }
    await Promise.all(names.filter((n) => n.endsWith('.jsonl')).map(async (n) => {
      const file = path.join(PROJECTS_DIR, d, n);
      try { files.push({ file, st: await fs.promises.stat(file) }); } catch {}
    }));
  }));
  files.sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
  const items = await Promise.all(files.slice(0, HISTORY_MAX).map(async ({ file, st }) => {
    const hit = historyCache.get(file);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.item;
    let item = null;
    try { item = await historyItem(file, st); } catch {}
    historyCache.set(file, { mtime: st.mtimeMs, size: st.size, item });
    return item;
  }));
  // Las que ya están abiertas en alguna pestaña
  const open = new Map(terminals.list().map((c) => [c.sessionId || c.id, c.id]));
  return items.filter(Boolean).map((it) => ({ ...it, openIn: open.get(it.id) || null }));
});

// Barra lateral › Eliminar: la transcripción va a la papelera del sistema (se puede recuperar)
ipcMain.handle('history:trash', async (_e, id) => {
  id = String(id);
  if (!/^[\w-]+$/.test(id) || terminals.list().some((c) => (c.sessionId || c.id) === id)) return false;
  let dirs = [];
  try { dirs = await fs.promises.readdir(PROJECTS_DIR); } catch {}
  const file = dirs.map((d) => path.join(PROJECTS_DIR, d, `${id}.jsonl`)).find((f) => fs.existsSync(f));
  if (!file) return false;
  try { await shell.trashItem(file); } catch { return false; }
  historyCache.delete(file);
  if (config.sidebar?.pinned?.includes(id)) { config.sidebar.pinned = config.sidebar.pinned.filter((x) => x !== id); saveConfig(); }
  return true;
});

// ---------- Configuración › Memoria: la memoria automática de Claude Code (~/.claude/projects/<proyecto>/memory/*.md)
// y las instrucciones globales (~/.claude/CLAUDE.md). Carpeta '~' = la global.
const GLOBAL_MD = path.join(HOME, '.claude', 'CLAUDE.md');
function memFile(dir, name) {
  dir = String(dir || ''); name = path.basename(String(name || ''));
  if (dir === '~') return name === 'CLAUDE.md' ? GLOBAL_MD : null;
  if (!dir || /[\\/]|^\.\.?$/.test(dir) || !name.endsWith('.md')) return null;
  return path.join(PROJECTS_DIR, dir, 'memory', name);
}
async function projectCwd(dir) {
  let names = [];
  try { names = (await fs.promises.readdir(path.join(PROJECTS_DIR, dir))).filter((n) => n.endsWith('.jsonl')); } catch {}
  for (const n of names.slice(0, 5)) {
    try {
      const fh = await fs.promises.open(path.join(PROJECTS_DIR, dir, n), 'r');
      let text;
      try { text = await readSlice(fh, 0, 16 * 1024); } finally { await fh.close(); }
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(text);
      if (m) return JSON.parse(`"${m[1]}"`);
    } catch {}
  }
  return '';
}
ipcMain.handle('memory:list', async () => {
  const out = [];
  let st = null;
  try { st = await fs.promises.stat(GLOBAL_MD); } catch {}
  out.push({ dir: '~', label: 'Todas las conversaciones (~/.claude/CLAUDE.md)', files: [{ name: 'CLAUDE.md', size: st?.size || 0, mtime: st?.mtimeMs || 0 }] });
  let dirs = [];
  try { dirs = await fs.promises.readdir(PROJECTS_DIR); } catch {}
  const projects = await Promise.all(dirs.map(async (dir) => {
    let names = [];
    try { names = (await fs.promises.readdir(path.join(PROJECTS_DIR, dir, 'memory'))).filter((n) => n.endsWith('.md')); } catch { return null; }
    if (!names.length) return null;
    const files = (await Promise.all(names.map(async (name) => {
      try { const s = await fs.promises.stat(path.join(PROJECTS_DIR, dir, 'memory', name)); return { name, size: s.size, mtime: s.mtimeMs }; } catch { return null; }
    }))).filter(Boolean);
    // MEMORY.md (el índice) primero; luego por fecha
    files.sort((a, b) => (b.name === 'MEMORY.md') - (a.name === 'MEMORY.md') || b.mtime - a.mtime);
    return { dir, label: await projectCwd(dir) || dir, files, mtime: Math.max(...files.map((f) => f.mtime)) };
  }));
  out.push(...projects.filter(Boolean).sort((a, b) => b.mtime - a.mtime));
  return out;
});
ipcMain.handle('memory:read', async (_e, dir, name) => {
  const file = memFile(dir, name);
  if (!file) return null;
  try { return await fs.promises.readFile(file, 'utf8'); } catch { return dir === '~' ? '' : null; }
});
ipcMain.handle('memory:write', async (_e, dir, name, text) => {
  const file = memFile(dir, name);
  if (!file || typeof text !== 'string' || text.length > 1024 * 1024) return false;
  try { await fs.promises.mkdir(path.dirname(file), { recursive: true }); await fs.promises.writeFile(file, text, 'utf8'); return true; } catch { return false; }
});
// A la papelera del sistema (se puede recuperar)
ipcMain.handle('memory:delete', async (_e, dir, name) => {
  const file = memFile(dir, name);
  if (!file || !fs.existsSync(file)) return false;
  try { await shell.trashItem(file); return true; } catch { return false; }
});

// Pregunta de sí o no en una ventana (con los diálogos de la app); false si se cierra sin contestar
function askWindow(w, payload) {
  return new Promise((resolve) => {
    const rid = crypto.randomUUID();
    const done = (ok) => { ipcMain.removeAllListeners(`ui:answer:${rid}`); w.off('closed', onClosed); resolve(!!ok); };
    const onClosed = () => done(false);
    ipcMain.once(`ui:answer:${rid}`, (_e, ok) => done(ok));
    w.once('closed', onClosed);
    w.focus();
    post(w, 'ui:ask', { rid, ...payload });
  });
}

// Pestaña soltada tras arrastrarla: en la barra de otra ventana pasa a esa; fuera de la barra de la
// suya, a una ventana nueva (o, si era la única, se mueve la ventana). Sus procesos siguen igual.
// id null: una pestaña nueva sin usar (solo el selector de presets, sin sesión)
const TAB_GRAB = { x: 170, y: 22 }; // dónde queda el cursor respecto a la ventana nueva (sobre su pestaña)
ipcMain.handle('tab:drop', async (e, id, { alone, at } = {}) => {
  const from = senderWin(e);
  const conv = id ? terminals.get(id) : null;
  if (id && !conv) return null;
  const p = at || screen.getCursorScreenPoint(); // at: solo para probarlo por CDP
  const inside = (w, strip) => {
    const b = areaOf(w);
    return p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + (strip ? TITLEBAR.dark.height : b.height);
  };
  if (inside(from, true)) return null; // dentro de su barra: solo se reordena
  const target = [...appWins].find((w) => w !== from && alive(w) && w.isVisible() && !w.isMinimized() && inside(w, true));
  if (target) {
    // A una ventana con otra cuenta: se pregunta allí; si no se acepta, la pestaña se queda donde estaba
    const acc = accountOfWin(target);
    if (conv && !sameAccount(conv.account, acc)) {
      const a = accounts.list().find((x) => x.key === (acc || accounts.activeKey()));
      if (!(await askWindow(target, { kind: 'account', email: a?.email || 'la de esa ventana', title: conv.title }))) return null;
    }
    if (conv) {
      owner.set(id, target);
      setTabAccount(id, acc); // después de cambiarla de ventana: la vuelve a abrir la de destino
    }
    post(target, conv ? 'ui:take-tab' : 'ui:new-conv', { conv, x: p.x - target.getContentBounds().x });
    target.focus();
  } else if (alone && !from.host) {
    from.setPosition(p.x - TAB_GRAB.x, p.y - TAB_GRAB.y);
    return null;
  } else {
    const [width, height] = hostOf(from).getSize();
    const nw = createWindow({ x: p.x - TAB_GRAB.x, y: p.y - TAB_GRAB.y, width, height });
    if (accountOfWin(from)) winAccount.set(nw, accountOfWin(from)); // con la misma cuenta
    if (conv) {
      owner.set(id, nw);
      winTabs.set(nw, { order: [id], active: id });
    }
  }
  // La ventana que se queda sin pestañas se cierra (la principal no: se queda con una nueva)
  if (from !== win && alone) setImmediate(() => from.close());
  return 'moved';
});
ipcMain.handle('win:close', (e) => { const w = senderWin(e); if (w !== win) w.close(); });

// ---------- Dividir: dos ventanas lado a lado ----------
// Con la misma cuenta, la ventana se parte en dos (Pane); con otra, ventanas de verdad para que cada una
// tenga su cuenta. Se reparten en columnas la pantalla de la ventana de origen (que queda a la izquierda).
function tileWindows(ws, area) {
  const width = Math.floor(area.width / ws.length);
  ws.forEach((w, i) => {
    if (w.isMinimized()) w.restore();
    if (w.isFullScreen()) w.setFullScreen(false);
    if (w.isMaximized()) w.unmaximize();
    w.setBounds({ x: area.x + i * width, y: area.y, width: i === ws.length - 1 ? area.width - i * width : width, height: area.height });
    w.show();
  });
}
// id: pestaña que pasa a la ventana nueva (sin él, la nueva empieza con el selector de presets).
// account: cuenta de la ventana nueva (undefined: la de la ventana de origen; null: la de Claude Code)
ipcMain.handle('win:split', (e, { id, account } = {}) => {
  const from = senderWin(e);
  const acc = account === undefined ? accountOfWin(from) : account;
  // Con la misma cuenta, la ventana se parte en dos (si no lo está ya)
  const host = hostOf(from);
  if (sameAccount(acc, accountOfWin(host)) && !host.pane) {
    const p = splitPane(host);
    if (id && convOf(id)) {
      owner.set(id, p);
      winTabs.set(p, { order: [id], active: id });
    }
    showWindow(host);
    return id ? 'moved' : 'ok';
  }
  const area = screen.getDisplayMatching(from.getBounds()).workArea;
  if (acc) accounts.profile(acc); // comprueba que se puede usar: si no, el error llega a la interfaz
  const nw = createWindow({ width: Math.floor(area.width / 2), height: area.height });
  if (acc) winAccount.set(nw, acc);
  if (id && convOf(id)) {
    owner.set(id, nw);
    winTabs.set(nw, { order: [id], active: id });
    setTabAccount(id, acc); // con otra cuenta, se vuelve a abrir con ella retomando la conversación
  }
  tileWindows([host, nw], area);
  refreshUsage(accKey(acc));
  return id ? 'moved' : 'ok';
});
// Todas las ventanas abiertas lado a lado (empezando por esta)
ipcMain.handle('win:tile', (e) => {
  const from = hostOf(senderWin(e));
  const ws = [from, ...[...appWins].filter((w) => !w.host && w !== from && alive(w) && w.isVisible())];
  if (ws.length > 1) tileWindows(ws, screen.getDisplayMatching(from.getBounds()).workArea);
  return ws.length;
});
ipcMain.handle('pty:start', (_e, id, size) => terminals.start(id, size));
ipcMain.on('pty:write', (_e, id, data) => terminals.write(id, data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => terminals.resize(id, cols, rows));
ipcMain.handle('tab:close', (_e, id) => {
  owner.delete(id);
  termchat.detach(id);
  terminals.close(id); // también todo lo que lanzó la pestaña (shells, servidores…)
});

// ---------- Presets ----------
ipcMain.handle('presets:save', (e, preset) => {
  savePreset(preset);
  presetsChanged(e.sender);
  return config.presets;
});
// Las demás ventanas (o todas, si lo cambia Claude) vuelven a pintar sus presets
function presetsChanged(except) {
  for (const w of appWins) if (w.webContents !== except) post(w, 'config:changed', publicConfig());
}
function savePreset(preset) {
  const clean = {
    id: preset.id || `p-${crypto.randomUUID().slice(0, 8)}`,
    name: String(preset.name || 'Sin nombre').slice(0, 40),
    emoji: String(preset.emoji || '').slice(0, 8),
    color: /^#[0-9a-f]{6}$/i.test(preset.color) ? preset.color : '#c96442',
    description: String(preset.description || '').slice(0, 120),
    cwd: String(preset.cwd || ''),
    github: String(preset.github || ''),
    account: String(preset.account || ''), // cuenta con la que se abre (vacío: la de la ventana)
    addDirs: (preset.addDirs || []).map(String).filter(Boolean),
    model: String(preset.model || ''),
    effort: String(preset.effort || ''),
    permissionMode: String(preset.permissionMode || ''),
    chrome: !!preset.chrome,
    chromeAsk: !!preset.chromeAsk,
    desktop: !!preset.desktop,
    whatsapp: !!preset.whatsapp,
    plugins: preset.plugins !== false,
    ext: cleanExt(preset.ext),
    instructions: String(preset.instructions || ''),
    startupPrompt: String(preset.startupPrompt || ''),
  };
  const i = config.presets.findIndex((p) => p.id === clean.id);
  if (i >= 0) config.presets[i] = clean; else config.presets.push(clean);
  saveConfig();
  return clean;
}

// Claude puede ver y crear presets desde cualquier pestaña (MCP por HTTP, como WhatsApp): así los
// genera quien no tiene el código. Borrar se deja a la interfaz.
const presetFields = (p) => {
  const { id, name, emoji, color, description, cwd, addDirs, model, effort, permissionMode, chrome, chromeAsk, desktop, whatsapp, plugins, instructions } = p;
  return { id, name, emoji, color, description, cwd, addDirs, model, effort, permissionMode, chrome, chromeAsk, ...(DESKTOP_MCP ? { desktop } : {}), whatsapp, plugins, instructions };
};
const presetsMcp = createHttpMcp({
  name: 'presets',
  instructions: [
    'Presets de Claude Assistant (la app desde la que corre esta sesión): perfiles con los que se abren las pestañas. Usa estas herramientas cuando el usuario pida crear, ver o cambiar un preset; no edites a mano la configuración de la app (la sobrescribe).',
    'Antes de cambiar uno, míralo con presets_list. Si falta algo importante (sobre todo la carpeta de trabajo), pregunta. Al terminar, di que ya aparece al abrir una pestaña nueva.',
  ].join('\n'),
  tools: [
    {
      name: 'presets_list',
      description: 'Lista los presets de Claude Assistant con todos sus campos.',
      shape: {},
      run: () => ({ content: [{ type: 'text', text: JSON.stringify(config.presets.map(presetFields), null, 2) }] }),
    },
    {
      name: 'presets_save',
      description: 'Crea un preset de Claude Assistant o, con id, cambia uno existente (solo los campos que pases). Se aplica al momento, sin reiniciar.',
      shape: {
        id: z.string().optional().describe('Para cambiar uno existente; sin id se crea uno nuevo'),
        name: z.string().max(40).optional().describe('Nombre corto (obligatorio al crear)'),
        emoji: z.string().max(8).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Color del preset, #rrggbb'),
        description: z.string().max(120).optional(),
        cwd: z.string().optional().describe('Carpeta de trabajo, ruta absoluta existente (obligatoria al crear)'),
        addDirs: z.array(z.string()).optional().describe('Carpetas extra a las que tiene acceso (rutas absolutas)'),
        model: z.string().optional().describe('Modelo (opus, sonnet, haiku, o un id; con [1m] usa la ventana de 1M); vacío: el general'),
        effort: z.enum(['', 'low', 'medium', 'high', 'xhigh']).optional().describe('Vacío: el general'),
        permissionMode: z.enum(['', 'default', 'acceptEdits', 'plan', 'bypassPermissions']).optional().describe('Vacío: el general. bypassPermissions = acceso total sin preguntar'),
        chrome: z.boolean().optional().describe('Claude in Chrome (manejar el navegador)'),
        chromeAsk: z.boolean().optional().describe('Con chrome: usarlo solo si el usuario lo pide'),
        ...(DESKTOP_MCP ? { desktop: z.boolean().optional().describe(`Control de aplicaciones del equipo (${DESKTOP_MCP})`) } : {}),
        whatsapp: z.boolean().optional().describe('WhatsApp en segundo plano'),
        plugins: z.boolean().optional().describe('Plugins del usuario activados (por defecto sí)'),
        instructions: z.string().optional().describe('Instrucciones que se añaden al prompt de sistema de sus pestañas'),
      },
      run: (args) => {
        const old = args.id && config.presets.find((p) => p.id === args.id);
        if (args.id && !old) throw new Error(`No hay ningún preset con id «${args.id}». Usa presets_list.`);
        const p = { ...old, ...Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined)) };
        if (!old && !p.name?.trim()) throw new Error('Falta el nombre.');
        if (!p.cwd?.trim()) throw new Error('Falta la carpeta de trabajo (cwd).');
        p.cwd = path.resolve(p.cwd.trim());
        if (!fs.existsSync(p.cwd)) throw new Error(`La carpeta no existe: ${p.cwd}`);
        const missing = (p.addDirs || []).filter((d) => !fs.existsSync(d));
        if (missing.length) throw new Error(`No existen: ${missing.join(', ')}`);
        if (!old && !p.color) {
          const colors = ['#c96442', '#3b6fd4', '#2f8a5b', '#c58a1e', '#8a6fd1', '#d14d72', '#2d9bb0', '#6b6a64']; // los del editor
          p.color = colors[config.presets.length % colors.length];
        }
        const saved = savePreset(p);
        presetsChanged();
        return { content: [{ type: 'text', text: `${old ? 'Preset cambiado' : 'Preset creado'}:\n${JSON.stringify(presetFields(saved), null, 2)}` }] };
      },
    },
  ],
});
app.on('will-quit', () => presetsMcp.close());
ipcMain.handle('presets:delete', (_e, id) => {
  config.presets = config.presets.filter((p) => p.id !== id);
  saveConfig();
  return config.presets;
});
ipcMain.handle('presets:reorder', (_e, ids) => {
  config.presets.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  saveConfig();
  return config.presets;
});
ipcMain.handle('tab:get', (_e, id) => terminals.get(id) || null);
// Vista previa de un bloque HTML del chat (como los artefactos de claude.ai): ventana aparte, aislada
// (URL data:, sin preload, sandbox y sesión en memoria propia); los enlaces, al navegador
ipcMain.handle('preview:html', (e, html) => {
  const parent = BrowserWindow.fromWebContents(e.sender);
  const pw = new BrowserWindow({
    width: 1000, height: 760, title: 'Vista previa', autoHideMenuBar: true,
    ...(IS_MAC ? {} : { icon: winIcon }),
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'vista-previa', spellcheck: false },
  });
  if (parent) { const [x, y] = parent.getPosition(); pw.setPosition(x + 60, y + 60); }
  const outside = (url) => { if (/^https?:/.test(url)) shell.openExternal(url); };
  pw.webContents.setWindowOpenHandler(({ url }) => { outside(url); return { action: 'deny' }; });
  pw.webContents.on('will-navigate', (ev, url) => { ev.preventDefault(); outside(url); });
  pw.webContents.on('page-title-updated', (ev, title) => { ev.preventDefault(); pw.setTitle(title && !title.startsWith('data:') ? `Vista previa · ${title}` : 'Vista previa'); });
  pw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(String(html).slice(0, 1500000))}`);
});
// Documentos en el panel lateral (Word, Excel, PDF, HTML, imágenes…): los sirve docview.mjs en
// 127.0.0.1 y cada ventana vigila el que enseña para recargarlo al cambiar
const docView = createDocView({ log: logError('vista previa') });
const docWatch = new Map(); // webContents.id -> dejar de vigilar
app.on('will-quit', () => docView.close());
ipcMain.handle('preview:file', (_e, file, cwd) => (file && fs.existsSync(file) ? docView.urlFor(file, cwd) : null));
ipcMain.handle('preview:watch', (e, file) => {
  const wc = e.sender;
  docWatch.get(wc.id)?.();
  docWatch.delete(wc.id);
  if (!file) return;
  if (!wc.docWatched) { wc.docWatched = true; wc.once('destroyed', () => { docWatch.get(wc.id)?.(); docWatch.delete(wc.id); }); }
  docWatch.set(wc.id, docView.watch(file, () => { if (!wc.isDestroyed()) wc.send('preview:changed', file); }));
});
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
// El panel de artefactos pinta el HTML en un <webview>: siempre aislado como la ventana de arriba
// (sin preload ni Node, sandbox, sesión en memoria propia; solo URL data: o un servidor de este equipo,
// como una vista previa en vivo); los demás enlaces, al navegador
const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i;
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (ev, prefs, params) => {
    delete prefs.preload;
    Object.assign(prefs, { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, spellcheck: false, plugins: true });
    params.partition = 'vista-previa';
    const src = String(params.src || '');
    if (!src.startsWith('data:text/html') && !LOCAL_URL.test(src)) ev.preventDefault();
  });
  wc.on('did-attach-webview', (_ev, guest) => {
    const outside = (url) => { if (/^https?:/.test(url)) shell.openExternal(url); };
    guest.setWindowOpenHandler(({ url }) => { outside(url); return { action: 'deny' }; });
    guest.on('will-navigate', (ev, url) => { if (!url.startsWith('data:') && !LOCAL_URL.test(url)) { ev.preventDefault(); outside(url); } });
  });
});
// Claude abre él mismo una página local en el panel de su pestaña (p. ej., la vista previa en vivo que acaba
// de arrancar), sin que haya que pulsar el enlace. Espera a que el servidor conteste.
const appMcp = createHttpMcp({
  name: 'claude-assistant',
  instructions: 'Herramientas de Claude Assistant, la app desde la que corre esta sesión. Si arrancas un servidor local para que el usuario vea algo (vista previa, web en desarrollo), ábrelo con vista_previa en vez de solo dar el enlace.',
  tools: [{
    name: 'vista_previa',
    description: 'Abre una página de este equipo (http://localhost:<puerto>/…) en el panel lateral de esta pestaña de Claude Assistant, junto al chat. Se ve en vivo: si la página se recarga sola, el usuario ve los cambios al momento. Espera unos segundos a que el servidor conteste.',
    shape: { url: z.string().describe('http://localhost:<puerto>/… o http://127.0.0.1:<puerto>/…') },
    run: async ({ url }, { tab }) => {
      if (!LOCAL_URL.test(url)) throw new Error('Solo páginas de este equipo: http://localhost:<puerto>/… o http://127.0.0.1:<puerto>/…');
      if (!tab || !terminals.get(tab)) throw new Error('No sé desde qué pestaña llamas: da el enlace en el chat para que lo abra con un clic.');
      let err;
      for (let i = 0; i < 16; i++) {
        try { await fetch(url, { signal: AbortSignal.timeout(2000) }); err = null; break; } catch (e) { err = e; await new Promise((r) => setTimeout(r, 500)); }
      }
      if (err) throw new Error(`${url} no contesta: ¿está en marcha el servidor?`);
      send('ui:art-url', { convId: tab, url });
      return { content: [{ type: 'text', text: `Abierta en el panel lateral: ${url}. Se actualiza sola si la página lo hace; el usuario puede cerrarla o abrirla en el navegador con ↗.` }] };
    },
  }],
});
app.on('will-quit', () => appMcp.close());
ipcMain.handle('tab:rename', (_e, id, title) => {
  const c = terminals.get(id);
  if (!c) return;
  c.title = String(title).slice(0, 120) || c.title;
  send('conv:update', { convId: id, conv: c });
});
// Modelo y esfuerzo con sus comandos; el modo lo cambia la interfaz con Shift+Tab y aquí solo se anota
// /model y /effort guardan además el valor como predeterminado de Claude Code (~/.claude/settings.json):
// desde la app solo se quiere cambiar la pestaña, así que se devuelve lo que había (la sesión conserva el suyo)
const CLAUDE_SETTINGS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude'), 'settings.json');
// (se vigila un rato: el cambio llega cuando se confirma «Switch model?» en la terminal)
let keepDefaults = null;
function keepClaudeDefaults(keys) {
  if (keepDefaults) clearInterval(keepDefaults.timer);
  const before = keepDefaults?.before || readJson(CLAUDE_SETTINGS, null);
  if (!before) return (keepDefaults = null);
  let ticks = 0;
  const timer = setInterval(() => {
    if (++ticks >= 30) { clearInterval(timer); keepDefaults = null; }
    const now = readJson(CLAUDE_SETTINGS, null);
    if (!now) return;
    const changed = keys.filter((k) => JSON.stringify(now[k]) !== JSON.stringify(before[k]));
    if (!changed.length) return;
    for (const k of changed) { if (k in before) now[k] = before[k]; else delete now[k]; }
    try { fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(now, null, 2) + '\n'); } catch {}
  }, 1000);
  keepDefaults = { before, timer };
}
function terminalSet(id, key, value, command) {
  const c = terminals.get(id);
  if (!c) return;
  c[key] = value || '';
  if (command && terminals.running(id)) {
    keepClaudeDefaults(['model', 'effortLevel', 'modelSettings']);
    terminals.write(id, command);
    setTimeout(() => terminals.write(id, '\r'), 120);
  }
  send('conv:update', { convId: id, conv: c });
}
ipcMain.handle('tab:set-model', (_e, id, model) => terminalSet(id, 'model', model, `/model ${model || 'default'}`));
ipcMain.handle('tab:set-mode', (_e, id, mode) => terminalSet(id, 'permissionMode', mode));
ipcMain.handle('tab:set-effort', (_e, id, effort) => terminalSet(id, 'effort', effort, `/effort ${effort || 'auto'}`));
ipcMain.handle('tab:set-cwd', async (e, id, dir) => {
  const c = terminals.get(id);
  // Claude Code ya está abierto desde que se abre la pestaña: hasta el primer mensaje se relanza en la carpeta nueva
  if (!c || c.busy || sessionExists(c.sessionId || c.id)) return false;
  if (!dir) {
    const r = await dialog.showOpenDialog(hostOf(senderWin(e)), { properties: ['openDirectory'], defaultPath: c.cwd, title: 'Carpeta de trabajo de esta pestaña' });
    if (r.canceled) return false;
    dir = r.filePaths[0];
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (dir === c.cwd) return false;
  c.cwd = dir;
  send('conv:update', { convId: id, conv: c });
  terminals.restart(id);
  return true;
});

ipcMain.handle('chat:send', (_e, id, payload) => termchat.send(id, payload));
ipcMain.handle('chat:interrupt', (_e, id) => termchat.interrupt(id));
ipcMain.handle('chat:sendNow', (_e, id) => termchat.sendNow(id));
ipcMain.handle('chat:rewind', (_e, id, msgId) => termchat.rewind(id, msgId));
ipcMain.handle('chat:unqueue', (_e, id, uuid) => termchat.unqueue(id, uuid));
// /tasks: salida de lo que sigue en segundo plano y detenerlo (bgtasks.mjs)
const bgTask = (id, taskId) => terminals.get(id)?.background?.find((x) => x.id === taskId);
ipcMain.handle('bg:output', (_e, id, taskId) => readOutput(bgTask(id, taskId)));
ipcMain.handle('bg:stop', async (_e, id, taskId) => {
  const task = bgTask(id, taskId);
  if (!task || task.agent) return false;
  const ok = await stopTask(terminals.pid(id), task).catch((e) => { logError('detener tarea')(e); return false; });
  if (ok) termchat.backgroundStopped(id, taskId);
  return ok;
});
ipcMain.handle('prompt:respond', (_e, id, promptId, payload) => termchat.respond(id, promptId, payload));

ipcMain.handle('meta:get', () => meta);

// ---------- Indicador de contexto: desglose por categorías, como /context (sin pestaña empezada, el de la configuración general)
ipcMain.handle('cmd:context', async (_e, id) => {
  // Lo que ocupa la conversación según la transcripción (sin desglose)
  const tc = terminals.get(id)?.context;
  if (tc) {
    const buffer = tc.compactAt ? Math.max(0, tc.max - tc.compactAt) : 0;
    return {
      live: true, model: terminals.get(id).model, used: tc.used, max: tc.max, pct: tc.pct, compactAt: tc.compactAt,
      categories: [
        { name: 'En uso (instrucciones, herramientas y mensajes)', tokens: tc.used, kind: 'used' },
        ...(buffer ? [{ name: 'Autocompact buffer', tokens: buffer, kind: 'buffer' }] : []),
        { name: 'Free space', tokens: Math.max(0, tc.max - tc.used - buffer), kind: 'free' },
      ],
    };
  }
  const c = await getProbe().q.getContextUsage();
  return {
    live: false,
    model: c.model,
    used: c.totalTokens,
    max: c.rawMaxTokens || c.maxTokens,
    pct: c.percentage,
    compactAt: c.isAutoCompactEnabled ? c.autoCompactThreshold ?? null : null,
    categories: c.categories.filter((x) => x.tokens > 0).map(({ name, tokens, kind }) => ({ name, tokens, kind })),
  };
});
ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
// /hooks y /permissions en la app: los ajustes de Claude Code por ámbito (usuario, proyecto y local), solo para leer
ipcMain.handle('claude:settings', (_e, cwd) => {
  const files = [['Usuario', CLAUDE_SETTINGS]];
  if (cwd) files.push(['Proyecto', path.join(cwd, '.claude', 'settings.json')], ['Local', path.join(cwd, '.claude', 'settings.local.json')]);
  return files.map(([scope, file]) => {
    let data = null, error = null;
    try { if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { error = err.message; }
    return { scope, file, exists: !!data || !!error, error, hooks: data?.hooks || {}, permissions: data?.permissions || {} };
  });
});
// La interfaz no encuentra algo que esperaba de Claude Code (ver SCREEN en terminal.js)
ipcMain.on('log:error', (_e, kind, text) => logError(String(kind).slice(0, 40))(String(text).slice(0, 4000)));
ipcMain.handle('usage:get', (e) => usageOfWin(senderWin(e)));
ipcMain.handle('usage:refresh', async (e) => {
  const w = senderWin(e);
  await refreshUsage(accKey(accountOfWin(w)));
  return usageOfWin(w);
});
ipcMain.handle('files:suggest', (_e, id, q) => {
  const c = convOf(id);
  return c?.cwd ? suggestFiles(c.cwd, q || '') : [];
});

ipcMain.handle('config:get', () => publicConfig());
ipcMain.handle('config:set', (e, patch) => {
  const { apiKey, oauthToken, clearApiKey, clearOauthToken, ...rest } = patch;
  const allowed = Object.keys(DEFAULTS).filter((k) => k !== 'secrets');
  const before = { compactWindow: config.compactWindow, hotkey: config.hotkey, voiceHotkey: config.voiceHotkey, shotHotkey: config.shotHotkey };
  for (const k of allowed) if (k in rest) config[k] = rest[k];
  if ('ext' in rest) config.ext = cleanExt(rest.ext);
  if ('schedules' in rest) config.schedules = cleanSchedules(rest.schedules);
  const cw = parseInt(config.compactWindow, 10) || 0;
  config.compactWindow = cw > 0 ? Math.min(1000, Math.max(100, cw)) : 0; // Claude Code admite de 100k a 1M; 0, el máximo del modelo
  if (config.compactWindow !== before.compactWindow) ctxCache.clear();
  config.secrets = { ...config.secrets };
  if (apiKey) config.secrets.apiKey = encrypt(apiKey.trim());
  if (oauthToken) config.secrets.oauthToken = encrypt(oauthToken.trim());
  if (clearApiKey) delete config.secrets.apiKey;
  if (clearOauthToken) delete config.secrets.oauthToken;
  saveConfig();
  applyTheme();
  // Solo se avisa de los atajos que se acaban de cambiar: uno que ya estaba ocupado (p. ej. en la app
  // de pruebas, por la app en uso) no debe salir cada vez que se guarda otra cosa
  const badKeys = registerHotkey().filter((k) => config[k] !== before[k]).map((k) => config[k]);
  applyAutoStart();
  for (const w of appWins) if (w.webContents !== e.sender) post(w, 'config:changed', publicConfig()); // apariencia en las demás ventanas
  return { config: publicConfig(), hotkeyOk: !badKeys.length, badKeys };
});
ipcMain.handle('whatsapp:show', () => whatsapp.showForLogin());

// ---------- Cuentas de Claude (/login) ----------
// Se guardan en la carpeta de la app en uso, también desde la de pruebas: la cuenta de Claude Code es una sola
const accounts = createAccounts({
  file: path.join(app.getPath('appData'), 'claude-assistant', 'accounts.json'),
  legacyDecrypt: decrypt, // las guardadas antes con safeStorage
  env: buildEnv,
  claudeExe: () => terminalClaude(config.claudePath, __dirname),
});
// La cuenta activa de Claude Code (~/.claude, la de la terminal) ha cambiado: solo al iniciar sesión
// por primera vez. Las pestañas pasan a ella en su siguiente mensaje, sin perder la conversación.
function accountChanged() {
  if (config.authMode !== 'claude-code') { config.authMode = 'claude-code'; saveConfig(); }
  closeProbes();
  extCache = null; // los conectores de claude.ai de la activa cambian
  ctxCache.clear();
  usages.clear();
  sendUsage();
  loadMeta().then(() => refreshUsage());
}
const sameAccount = (a, b) => accKey(a) === accKey(b);
const tabIdsOf = (w) => terminals.list().map((c) => c.id).filter((id) => winOf(id) === w);

// Pestaña que pasa a otra cuenta: se vuelve a lanzar con ella retomando la conversación
// (si está trabajando, al terminar el turno)
const pendingRelaunch = new Set();
function setTabAccount(id, key) {
  const conv = convOf(id);
  if (!conv) return;
  const changed = !sameAccount(conv.account, key);
  conv.account = key || null;
  if (!changed) return;
  if (conv.busy) pendingRelaunch.add(id);
  else terminals.restart(id);
}

// La cuenta de una ventana: la de sus pestañas, también las abiertas
function setWinAccount(w, key) {
  if (key) accounts.profile(key); // comprueba que se puede usar: si no, el error llega a la interfaz
  winAccount.set(w, key || null);
  if (config.authMode !== 'claude-code') { config.authMode = 'claude-code'; saveConfig(); }
  for (const id of tabIdsOf(w)) setTabAccount(id, key);
  post(w, 'usage:update', usageOfWin(w));
  refreshUsage(accKey(key));
}

// Lista de cuentas para una ventana: current es la suya; active, la de Claude Code (la de la terminal)
function accountsFor(w) {
  const mine = accountOfWin(w);
  return accountList().map((a) => ({ ...a, current: mine ? a.key === mine : a.active }));
}
// Color de cada cuenta para marcar sus ventanas: a cada una nueva, el menos usado; se cambia en Configuración › Cuenta
const ACCOUNT_COLORS = ['#d97757', '#4f7fd9', '#3f9d6b', '#8a63d2', '#c9971c', '#cf5f8f', '#2b9aa0', '#7a7f8c'];
function accountList() {
  const list = accounts.list();
  const colors = config.accountColors || (config.accountColors = {});
  let changed = false;
  for (const a of list) {
    if (colors[a.key]) continue;
    const uses = (c) => list.filter((x) => colors[x.key] === c).length;
    colors[a.key] = ACCOUNT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) saveConfig();
  const out = list.map((a) => ({ ...a, color: colors[a.key] }));
  refreshTray(out);
  return out;
}
// Ventana nueva con una cuenta (bandeja, lista de saltos), un poco desplazada sobre la principal
function newAccountWindow(key) {
  const acc = key && key !== accounts.activeKey() ? key : null;
  if (acc) accounts.profile(acc); // comprueba que se puede usar
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  const nw = createWindow({ x: x + 32, y: y + 32, width, height });
  if (acc) winAccount.set(nw, acc);
  refreshUsage(accKey(acc));
  return nw;
}
const accountsInTabs = () => [...new Set([...appWins].map(accountOfWin).concat(terminals.list().map((c) => c.account)).filter(Boolean))];

ipcMain.handle('accounts:list', (e) => accountsFor(senderWin(e)));
ipcMain.handle('accounts:color', (_e, key, color) => {
  if (!ACCOUNT_COLORS.includes(color)) return;
  config.accountColors = { ...config.accountColors, [key]: color };
  saveConfig();
  for (const w of appWins) post(w, 'accounts:changed');
});
ipcMain.handle('accounts:new-window', (_e, key) => { newAccountWindow(key); });
// La interfaz marca la ventana con su cuenta: barra de título teñida y la inicial de la cuenta sobre el
// icono de la barra de tareas, como Chrome con los perfiles. mark: { color, email, icon } o null
ipcMain.on('win:mark', (e, mark) => {
  const w = senderWin(e);
  if (mark?.color) winTint.set(w, mark.color); else winTint.delete(w);
  const t = titlebarFor(w);
  setOverlay(w, t);
  w.setBackgroundColor(t.color);
  if (IS_MAC) return; // ni icono por ventana ni agrupación: el Dock tiene uno solo
  // El icono de Claude en el color de la cuenta (un .ico con todos los tamaños, para que se vea nítido)
  const icon = mark?.icons ? colorIcon(mark.color, mark.icons) : winIcon;
  w.setIcon(icon);
  if (!IS_WIN) return;
  // Windows agrupa en la barra de tareas las ventanas con el mismo AppUserModelID y les pone un solo icono:
  // con una propia, cada cuenta tiene su botón con su color
  const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
  const insideResources = path.resolve(__dirname).startsWith(path.resolve(process.resourcesPath));
  w.setAppDetails({
    appId: mark?.group ? `${APP_ID}.${hash(mark.group)}` : APP_ID,
    appIconPath: icon,
    relaunchCommand: `"${process.execPath}"${insideResources ? '' : ` "${path.resolve(__dirname)}"`}`,
    relaunchDisplayName: mark?.group ? `Claude Assistant · ${mark.email}` : 'Claude Assistant',
  });
});
// pngs: [{ size, data (base64) }] → ruta de un .ico en la carpeta de datos (uno por color); fuera de Windows, el PNG mayor
function colorIcon(color, pngs) {
  if (!IS_WIN) {
    const big = pngs.reduce((a, b) => (b.size > a.size ? b : a));
    const png = path.join(DATA_DIR, 'iconos', `${String(color).replace(/[^0-9a-z]/gi, '')}-${big.size}.png`);
    if (!fs.existsSync(png)) { fs.mkdirSync(path.dirname(png), { recursive: true }); fs.writeFileSync(png, Buffer.from(big.data, 'base64')); }
    return png;
  }
  const file = path.join(DATA_DIR, 'iconos', `${String(color).replace(/[^0-9a-z]/gi, '')}.ico`);
  if (fs.existsSync(file)) return file;
  const datas = pngs.map((p) => ({ size: p.size, data: Buffer.from(p.data, 'base64') }));
  const header = Buffer.alloc(6 + 16 * datas.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(datas.length, 4);
  let offset = header.length;
  datas.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, ...datas.map((d) => d.data)]));
  return file;
}
ipcMain.handle('accounts:use', (e, key) => {
  const w = senderWin(e);
  setWinAccount(w, key);
  return accountsFor(w).find((a) => a.current);
});
// Otra cuenta pasa a ser la principal: la de Claude Code (~/.claude), la de la terminal y la de las ventanas
// nuevas. Las ventanas y pestañas que iban con la principal pasan a la nueva, igual que las que ya la tenían.
// Sus procesos se paran antes de cambiar ~/.claude: al renovar los tokens de la anterior los escribirían allí.
ipcMain.handle('accounts:make-main', (_e, key) => {
  const prev = accounts.activeKey();
  if (!key || key === prev) return;
  const follows = (k) => !k || k === key || k === prev;
  const ids = terminals.list().map((c) => c.id).filter((id) => follows(convOf(id)?.account));
  const busy = ids.filter((id) => convOf(id)?.busy).length;
  if (busy) throw new Error(`Espera a que terminen las pestañas que están trabajando (${busy}).`);
  for (const id of ids) {
    convOf(id).account = null;
    terminals.restart(id); // se reabre cuando el proceso ha salido: ya con la nueva
  }
  for (const w of appWins) if (follows(accountOfWin(w))) winAccount.set(w, null);
  closeProbes();
  const a = accounts.makeMain(key);
  accountChanged();
  for (const w of appWins) post(w, 'accounts:changed');
  return a;
});
ipcMain.handle('accounts:remove',(_e, key) => accounts.remove(key, accountsInTabs()));
ipcMain.handle('accounts:login', async (e) => {
  const w = senderWin(e);
  try {
    const a = await accounts.login({ onUrl: (url) => post(w, 'accounts:login-url', url) });
    // La primera cuenta pasa a ser la de Claude Code; las demás, solo la de esta ventana
    if (!accounts.activeKey()) { accounts.use(a.key); accountChanged(); }
    else setWinAccount(w, a.key);
    return { ok: true, account: a };
  } catch (err) {
    return { ok: false, cancelled: err.message === 'cancelled', error: err.message };
  }
});
ipcMain.handle('accounts:login-code', (_e, code) => accounts.sendCode(code));
ipcMain.handle('accounts:login-cancel', () => accounts.cancelLogin());
ipcMain.handle('config:pick-dir', async (e, defaultPath) => {
  const r = await dialog.showOpenDialog(hostOf(senderWin(e)), { properties: ['openDirectory'], defaultPath: defaultPath && fs.existsSync(defaultPath) ? defaultPath : config.cwd });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('config:pick-file', async (e) => {
  const r = await dialog.showOpenDialog(hostOf(senderWin(e)), { properties: ['openFile'], ...(IS_WIN ? { filters: [{ name: 'Ejecutable', extensions: ['exe', 'cmd', 'js'] }] } : {}) });
  return r.canceled ? null : r.filePaths[0];
});

// Imagen de fondo (Configuración → Apariencia): se copia a la carpeta de datos para que no dependa del original.
// Cada una con su nombre (la vista previa no pisa la guardada) y se borran las que ya no usa la configuración.
ipcMain.handle('look:pick-bg', async (e) => {
  const r = await dialog.showOpenDialog(hostOf(senderWin(e)), { properties: ['openFile'], filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'] }] });
  if (r.canceled) return null;
  const dir = path.join(app.getPath('userData'), 'fondos');
  fs.mkdirSync(dir, { recursive: true });
  const keep = config.appearance?.bgImage;
  for (const f of fs.readdirSync(dir)) if (path.join(dir, f) !== keep) fs.rmSync(path.join(dir, f), { force: true });
  const dest = path.join(dir, 'fondo-' + Date.now() + path.extname(r.filePaths[0]).toLowerCase());
  fs.copyFileSync(r.filePaths[0], dest);
  return dest;
});

// ---------- Dictado por voz (Whisper en local, sin clave ni coste) ----------
// El modelo se descarga una vez (~550 MB) a una carpeta común a la app en uso y la de pruebas.
const WHISPER_MODEL = 'onnx-community/whisper-small';
const WHISPER_DIR = path.join(process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'claude-assistant-whisper');
let whisper = null;
function loadWhisper() {
  whisper ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = WHISPER_DIR;
    const files = new Map();
    return pipeline('automatic-speech-recognition', WHISPER_MODEL, {
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
      progress_callback: (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files.set(p.file, p);
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        send('voice:progress', { loaded, total });
      },
    });
  })().catch((e) => { whisper = null; throw e; });
  return whisper;
}
ipcMain.handle('voice:prepare', () => loadWhisper().then(() => true));
// De una en una: la ventana principal y la del asistente comparten el modelo
let whisperQueue = Promise.resolve();
ipcMain.handle('voice:transcribe', (_e, audio) => {
  const run = whisperQueue.then(async () => {
    const asr = await loadWhisper();
    const r = await asr(audio, { language: 'spanish', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
    return (r.text || '').trim();
  });
  whisperQueue = run.catch(() => {});
  return run;
});

// ---------- Asistente de primer arranque: qué falta para que todo funcione ----------
function toolVersion(file, args = ['--version']) {
  try { return execFileSync(file, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n')[0]; } catch { return ''; }
}
ipcMain.handle('setup:check', async () => {
  const claude = terminalClaude(config.claudePath, __dirname);
  let account = null;
  try { account = accounts.list().find((a) => a.active)?.email || null; } catch {}
  return {
    platform: process.platform,
    desktop: process.env.XDG_CURRENT_DESKTOP || '',
    wayland: process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY,
    pkg: process.platform === 'linux' ? linuxPkg() : '',
    // Linux: la orden para los atajos y el arranque de Hyprland/Sway, que se configuran en su archivo
    launch: process.platform === 'linux' ? launchCmd() : '',
    // Wayland: el recorte usa el portal Screenshot desde python3 con Gio (en Arch no viene python-gobject)
    portal: process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY) ? !!toolVersion('python3', ['-c', 'import gi; print(1)']) : null,
    claude: { path: claude, version: toolVersion(claude).replace(/\s*\(.*\)$/, ''), bundled: claude.startsWith(__dirname) },
    authMode: config.authMode,
    account,
    hasKey: config.authMode === 'api-key' ? !!config.secrets.apiKey : config.authMode === 'oauth-token' ? !!config.secrets.oauthToken : false,
    git: toolVersion('git'),
    gh: toolVersion('gh'),
    whisper: fs.existsSync(path.join(WHISPER_DIR, WHISPER_MODEL)),
    whatsapp: WHATSAPP_LINKED(),
    // Linux: Claude Code lee las imágenes del portapapeles con wl-paste (Wayland) o xclip (X11)
    clipboard: process.platform !== 'linux' || ['wl-paste', 'xclip'].some(onPath),
    macPerms: IS_MAC ? macPerms() : null,
    // Control de aplicaciones (Windows-MCP / macOS-MCP): se lanza con uvx, de uv
    desktopApps: DESKTOP_MCP && (config.presets || []).some((p) => p.desktop) ? { uv: uvxPath() !== 'uvx' || onPath(IS_WIN ? 'uvx.exe' : 'uvx') } : null,
    // Acceso total: Claude Code pide aceptarlo una vez por equipo (se guarda en su settings.json)
    bypass: {
      used: config.permissionMode === 'bypassPermissions' || (config.presets || []).some((p) => p.permissionMode === 'bypassPermissions'),
      accepted: readJson(CLAUDE_SETTINGS, {})?.skipDangerousModePermissionPrompt === true,
    },
  };
});
ipcMain.handle('setup:accept-bypass', () => {
  const settings = readJson(CLAUDE_SETTINGS, {}) || {};
  settings.skipDangerousModePermissionPrompt = true;
  fs.mkdirSync(path.dirname(CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  terminals.acceptBypass();
  return true;
});
// macOS: permisos de micrófono (dictado, asistente), de grabación de pantalla (recorte) y de accesibilidad
// (control de aplicaciones con macOS-MCP): 'granted', 'denied', 'restricted' o 'not-determined' (aún no se ha preguntado)
const macPerms = () => ({
  microphone: systemPreferences.getMediaAccessStatus('microphone'),
  screen: systemPreferences.getMediaAccessStatus('screen'),
  accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied',
});
const MAC_PANES = { microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility' };
// Pide el permiso; con settings, si ya estaba denegado (macOS no vuelve a preguntar), abre su panel de Ajustes
ipcMain.handle('mac:permission', async (_e, kind, settings = false) => {
  if (!IS_MAC || !MAC_PANES[kind]) return null;
  try {
    if (kind === 'microphone') await systemPreferences.askForMediaAccess('microphone');
    // Accesibilidad: macOS no la concede con un diálogo propio, solo avisa y lleva a Ajustes
    else if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
    // La primera captura es la que hace que macOS pregunte y ponga la app en la lista
    else if (macPerms().screen !== 'granted') await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
  } catch {}
  const status = macPerms()[kind];
  if (settings && status !== 'granted') shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${MAC_PANES[kind]}`);
  return status;
});
// Gestor de paquetes de la distribución, según /etc/os-release (ID e ID_LIKE)
function linuxPkg() {
  let os = '';
  try { os = fs.readFileSync('/etc/os-release', 'utf8'); } catch {}
  const ids = [...os.matchAll(/^(?:ID|ID_LIKE)="?([^"\n]*)/gm)].flatMap((m) => m[1].split(/\s+/));
  return ids.some((i) => ['debian', 'ubuntu'].includes(i)) ? 'apt' : ids.includes('arch') ? 'pacman' : ids.some((i) => /suse/.test(i)) ? 'zypper' : 'dnf';
}
const onPath = (cmd) => (process.env.PATH || '').split(path.delimiter).some((d) => d && fs.existsSync(path.join(d, cmd)));

// ---------- Arranque ----------
// --account=<clave>: desde la lista de saltos de la barra de tareas, ventana nueva con esa cuenta
app.on('second-instance', (_e, argv) => {
  if (runHotkeyFlag(argv)) return;
  const key = argv.find((a) => a.startsWith('--account='))?.slice(10);
  if (!key) return showWindow();
  try { newAccountWindow(key); } catch { showWindow(); }
});
// Fuera de Windows no hay Job Object que se cierre con la app: se termina aquí lo de cada pestaña
app.on('before-quit', () => { quitting = true; jobs.killAll?.(); terminals.closeAll(); closeProbes(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());
// macOS: clic en el icono del Dock con la ventana oculta
app.on('activate', () => { if (win) showWindow(); });

// macOS: sin menú no funcionarían Cmd+C/V/X/A/Z ni Cmd+Q. Solo lo imprescindible, para que
// Cmd+T, Cmd+W, Cmd+H… lleguen a la interfaz de pestañas
function macMenu() {
  return Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: 'Acerca de Claude Assistant' },
      { type: 'separator' },
      { label: 'Configuración…', click: () => { showWindow(); post(win, 'ui:settings'); } },
      { type: 'separator' },
      // Sin ⌘H (lo usa la interfaz) ni ⌘M (dictar)
      { label: 'Ocultar Claude Assistant', click: () => app.hide() },
      { role: 'hideOthers', label: 'Ocultar otros' },
      { role: 'unhide', label: 'Mostrar todo' },
      { type: 'separator' },
      { role: 'quit', label: 'Salir de Claude Assistant' },
    ] },
    { label: 'Edición', submenu: [
      { role: 'undo', label: 'Deshacer' }, { role: 'redo', label: 'Rehacer' }, { type: 'separator' },
      { role: 'cut', label: 'Cortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Pegar' }, { role: 'selectAll', label: 'Seleccionar todo' },
    ] },
  ]);
}

app.whenReady().then(() => {
  // Sin menú: así Ctrl+W, Ctrl+T o Ctrl+R llegan a la interfaz de pestañas
  Menu.setApplicationMenu(IS_MAC ? macMenu() : null);
  if (IS_MAC && !app.isPackaged) app.dock?.setIcon(path.join(__dirname, 'assets', 'icon-mac.png'));
  createWindow();
  // Abierta desde la lista de saltos con --account=<clave>: la ventana empieza con esa cuenta
  // (o, tras un reinicio, con la que tenía)
  const startAccount = process.argv.find((a) => a.startsWith('--account='))?.slice(10) || restoreData?.account;
  if (startAccount && startAccount !== accounts.activeKey()) try { accounts.profile(startAccount); winAccount.set(win, startAccount); } catch {}
  createTray();
  schedules.start();
  registerHotkey();
  applyAutoStart();
  assist.preload();
  if (WHATSAPP_LINKED()) whatsapp.open();
  loadMeta().then(refreshUsage);
});
