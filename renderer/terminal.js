// Pestañas en modo terminal: xterm.js pinta el `claude` que corre en el proceso principal (terminals.mjs).
// Se carga antes que app.js; usa sus funciones (current, renderTabs…) solo cuando ya existen.
const terms = new Map(); // id -> { term, fit, el, started, exited, busy }
const termHost = document.getElementById('terms');

// Paleta ANSI a juego con los colores de la app (Claude Code usa sobre todo color directo)
const TERM_PALETTE = {
  light: { black: '#3d3d3a', red: '#b3261e', green: '#3d7a52', yellow: '#98581a', blue: '#3a5d96', magenta: '#7b4b98', cyan: '#2a7a80', white: '#d8d6cc',
    brightBlack: '#73726c', brightRed: '#c9472f', brightGreen: '#4a8f5f', brightYellow: '#b56d22', brightBlue: '#4a73b5', brightMagenta: '#9560b5', brightCyan: '#3a939a', brightWhite: '#141413' },
  dark: { black: '#1f1e1d', red: '#f2867c', green: '#7cc495', yellow: '#e9b872', blue: '#93b6ea', magenta: '#cda5e3', cyan: '#7cc7c9', white: '#c2c0b6',
    brightBlack: '#75736c', brightRed: '#f5a59d', brightGreen: '#9ad6ad', brightYellow: '#f0cb94', brightBlue: '#b0caf0', brightMagenta: '#dcbdeb', brightCyan: '#9ad7d8', brightWhite: '#faf9f5' },
};
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function termTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return {
    ...TERM_PALETTE[darkQuery.matches ? 'dark' : 'light'],
    background: v('--bg'),
    foreground: v('--text'),
    cursor: v('--accent'),
    cursorAccent: v('--bg'),
    selectionBackground: darkQuery.matches ? 'rgba(217, 119, 87, 0.35)' : 'rgba(201, 100, 66, 0.25)',
  };
}
darkQuery.addEventListener('change', () => { for (const t of terms.values()) t.term.options.theme = termTheme(); });

// Letra de la terminal (Configuración → Apariencia, ver applyAppearance en app.js)
const TERM_MONO = "'Cascadia Mono', 'Cascadia Code', Consolas, ui-monospace, 'SF Mono', Menlo, 'Adwaita Mono', 'Noto Sans Mono', 'DejaVu Sans Mono', monospace";
const termLook = { fontSize: 14, fontFamily: TERM_MONO };
function setTermLook(fontSize, font) {
  const fontFamily = font ? `${font}, ${TERM_MONO}` : TERM_MONO;
  if (termLook.fontSize === fontSize && termLook.fontFamily === fontFamily) return;
  Object.assign(termLook, { fontSize, fontFamily });
  for (const t of terms.values()) {
    t.term.options.fontSize = fontSize;
    t.term.options.fontFamily = fontFamily;
    if (!t.el.hidden) try { t.fit.fit(); } catch {}
  }
}

const quotePath = (p) => (/\s/.test(p) ? `"${p}"` : p);
// La tecla de la izquierda del 1 (º): en los Mac con teclado ISO llega como IntlBackslash
const isToggleKey = (e) => e.code === 'Backquote' || (api.platform === 'darwin' && e.code === 'IntlBackslash');
// Teclas de la app (pestañas, configuración): no las procesa la terminal
const APP_KEYS = new Set(['t', 'w', 'tab', 'pageup', 'pagedown', ',', '+', '=', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

function ensureTerm(conv) {
  if (terms.has(conv.id)) return terms.get(conv.id);
  const el = document.createElement('div');
  el.className = 'term-pane';
  el.hidden = true;
  termHost.appendChild(el);
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: termLook.fontFamily,
    fontSize: termLook.fontSize,
    lineHeight: 1.1,
    cursorBlink: true,
    scrollback: 10000,
    theme: termTheme(),
    // Claude Code con su tema oscuro pinta en blanco directo (el ● de las respuestas): con la app en claro
    // no se vería. Solo se oscurece lo que no llega a este contraste
    minimumContrastRatio: 3,
    rightClickSelectsWord: false, // en macOS viene activado: el clic derecho copiaría la palabra en vez de pegar
    ...(api.platform === 'win32' ? { windowsPty: { backend: 'conpty' } } : {}),
  });
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon.Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => window.open(uri)));
  term.open(el);
  const t = { id: conv.id, term, fit, el, started: false, exited: false, busy: false };
  terms.set(conv.id, t);

  term.onData((data) => {
    if (t.exited) {
      if (data === '\r') startTerm(t, true);
      return;
    }
    api.ptyWrite(conv.id, data);
  });
  term.onResize(({ cols, rows }) => api.ptyResize(conv.id, cols, rows));
  term.onTitleChange((title) => onTermTitle(t, title));

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const k = e.key.toLowerCase();
    // macOS: Cmd es de la app (y Cmd+C/V del menú Edición); Ctrl, entero para Claude Code
    if (api.platform === 'darwin') {
      if (e.metaKey) return false;
      if (e.ctrlKey && (k === 'tab' || isToggleKey(e))) return false;
      // Option como Meta para los atajos de Claude Code (⌥P modelo, ⌥T pensamiento, ⌥Enter salto de línea):
      // si no, macOS escribe π o †. El resto de Option sigue escribiendo sus caracteres (@, #, €…)
      if (e.altKey && !e.ctrlKey && (e.code === 'KeyP' || e.code === 'KeyT' || k === 'enter')) {
        api.ptyWrite(conv.id, '\x1b' + (k === 'enter' ? '\r' : e.code.slice(3).toLowerCase()));
        return false;
      }
      if (e.ctrlKey || e.altKey) return true; // el resto, a Claude Code (Shift+Enter sigue abajo)
    }
    if (e.ctrlKey && !e.altKey && !e.shiftKey && APP_KEYS.has(k)) return false;
    if (e.ctrlKey && k === 'tab') return false;
    if (e.ctrlKey && e.shiftKey && k === 'd') return false; // dividir en dos ventanas (si no, llegaría un Ctrl+D)
    if (e.ctrlKey && isToggleKey(e)) return false; // Ctrl+º: volver al chat
    if (e.key === 'F1') return false; // lista de atajos de la app
    // Ctrl+C con texto seleccionado copia (como Windows Terminal); si no, interrumpe
    if (e.ctrlKey && !e.shiftKey && k === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      term.clearSelection();
      return false;
    }
    if (e.ctrlKey && e.shiftKey && k === 'c') { if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()); return false; }
    // Ctrl+V: pegado normal del navegador (llega como evento paste)
    if (e.ctrlKey && (k === 'v')) return false;
    // Shift+Enter: salto de línea en el mensaje, como tras /terminal-setup
    if (e.shiftKey && !e.ctrlKey && k === 'enter') { api.ptyWrite(conv.id, '\x1b\r'); return false; }
    return true;
  });

  // Imagen en el portapapeles: que la pegue Claude Code (Alt+V en Windows, Ctrl+V en Linux)
  const pasteImage = api.platform === 'win32' ? '\x1bv' : '\x16';
  el.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])];
    const hasText = items.some((i) => i.kind === 'string' && i.type === 'text/plain');
    if (!hasText && items.some((i) => i.type.startsWith('image/'))) {
      e.preventDefault();
      e.stopPropagation();
      api.ptyWrite(conv.id, pasteImage);
    }
  }, true);
  // Clic derecho: copia la selección o pega
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); term.clearSelection(); return; }
    const text = await navigator.clipboard.readText().catch(() => '');
    if (text) term.paste(text);
    else api.ptyWrite(conv.id, pasteImage);
  });
  // Archivos arrastrados: su ruta, como en la terminal
  el.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const paths = [...(e.dataTransfer?.files || [])].map((f) => api.pathForFile(f)).filter(Boolean);
    if (paths.length) term.paste(paths.map(quotePath).join(' ') + ' ');
    term.focus();
  });
  return t;
}

// Tamaño de la última terminal visible (se guarda para las pestañas que se reabren al reiniciar)
let lastDims = (() => { try { return JSON.parse(localStorage.getItem('termDims')); } catch { return null; } })();
function fitTerm(t) {
  try { t.fit.fit(); } catch { return; }
  if (t.el.hidden || termHost.hidden) return;
  const { cols, rows } = t.term;
  if (cols === lastDims?.cols && rows === lastDims?.rows) return;
  lastDims = { cols, rows };
  try { localStorage.setItem('termDims', JSON.stringify(lastDims)); } catch {}
}

async function startTerm(t, again = false) {
  t.started = true;
  t.exited = false;
  if (again) t.term.write('\r\n');
  try { t.fit.fit(); } catch {}
  const r = await api.ptyStart(t.id, { cols: t.term.cols, rows: t.term.rows });
  if (r?.buffer) t.term.write(r.buffer); // la interfaz se recargó con el proceso en marcha
}

// Claude Code pone en el título el tema de la conversación, con un spinner mientras trabaja.
// Si está ocupado o no, y el aviso al terminar, lo lleva el proceso principal (termchat.mjs).
// Al aprobar un plan Claude Code renombra la sesión con un slug («add-adios-line-to-file»): se deja legible
const humanTitle = (s) => (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(s) ? s[0].toUpperCase() + s.slice(1).replace(/-/g, ' ') : s);
function onTermTitle(t, raw) {
  const c = state.convs.get(t.id);
  if (!c) return;
  // Los títulos de Claude Code empiezan por ✳ (en espera) o por un spinner (◐◑◒◓, braille…) mientras trabaja
  const m = /^([\p{S}\p{P}⠀-⣿])\s+(.*)$/u.exec(raw);
  if (!m) return; // «claude» y demás títulos del proceso
  const title = humanTitle(m[2].trim());
  // Un nombre puesto a mano (barra lateral) o el de una tarea programada no se pisa
  const fixed = c.fixedTitle || state.config?.sidebar?.titles?.[c.sessionId || c.id];
  if (title && !fixed && title !== 'Claude Code' && title !== c.title) {
    c.title = title;
    api.renameTab(t.id, title);
    renderTabs();
  }
}

// ---------- Chat o terminal ----------
// Cada pestaña se ve como chat (lo que Claude explica, el trabajo plegado) o como la terminal tal cual
const termViews = new Map(); // id -> 'chat' | 'terminal'
const termViewOf = (id) => termViews.get(id) || 'chat';
function setTermView(id, view) {
  if (termViewOf(id) === view) return;
  termViews.set(id, view);
  if (id === state.activeId) { showView(); focusInput(); }
}
const toggleTermView = () => {
  const c = current();
  if (c?.terminal) setTermView(c.id, termViewOf(c.id) === 'chat' ? 'terminal' : 'chat');
};
document.getElementById('term-back').addEventListener('click', toggleTermView);
document.getElementById('term-view').addEventListener('click', toggleTermView);

// Con la vista de chat la terminal sigue funcionando por detrás, oculta
function runTermHidden(c) {
  const t = ensureTerm(c);
  if (t.started) return;
  // Oculta no se puede medir: el tamaño de la última terminal que se vio (así no hay que repintar al abrirla)
  t.term.resize(lastDims?.cols || 120, lastDims?.rows || 40);
  startTerm(t);
}

// Textos de Claude Code que la app lee en la pantalla de la terminal. Si una versión nueva los cambia,
// la app no los encuentra y lo apunta en errores.log (termScreenMiss) para saber qué actualizar aquí.
const SCREEN = {
  switchModel: /[❯>]\s*1\.\s*Yes, switch/, // confirmar el cambio de modelo a mitad de conversación
  planAsk: /would you like to proceed/i, // diálogo del plan
  option: /^\s*(?:[❯›>↑↓]\s*)?(\d+)\.\s+(.+?)\s*$/, // «❯ 1. Opción» (↑/↓ si la lista se desplaza)
  rewindList: /restore the code and\/or conversation to the point before/i, // /rewind: elegir mensaje
  rewindConfirm: /confirm you want to restore/i, // /rewind: qué restaurar
  selected: /^\s*[❯>]\s+(.+?)\s*$/, // la línea marcada de un selector (❯ o >, según la versión)
  field: /^[❯>]\s/, // el campo de la terminal: la línea justo debajo de una raya
  rule: /^─{10,}/, // esa raya (puede llevar el nombre de la sesión: «──── mi-sesión ─»)
  modes: [ // pie de la terminal → modo de permisos
    [/bypass permissions on/i, 'bypassPermissions'],
    [/accept edits on/i, 'acceptEdits'],
    [/plan mode on/i, 'plan'],
    [/auto mode on/i, 'auto'],
  ],
};
const screenMissed = new Set();
function termScreenMiss(what, id) {
  if (screenMissed.has(what)) return;
  screenMissed.add(what);
  const tail = termScreen(id).filter((l) => l.trim()).slice(-12).join('\n');
  api.logError('pantalla', `No se ha encontrado en la terminal: ${what}. Últimas líneas:
${tail}`);
}

// Cambiar de modelo a mitad de conversación pide confirmación en la terminal («Switch model?»):
// ya se eligió en el selector, así que se acepta (la opción 1, marcada por defecto)
async function termConfirmSwitch(id) {
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (termScreen(id).some((l) => SCREEN.switchModel.test(l))) return api.ptyWrite(id, '\r');
  }
}

// Lo que se ve ahora mismo en la terminal (para leer sus diálogos y el pie)
function termScreen(id) {
  const t = terms.get(id);
  if (!t) return [];
  const b = t.term.buffer.active;
  const lines = [];
  for (let i = b.viewportY; i < b.viewportY + t.term.rows; i++) lines.push(b.getLine(i)?.translateToString(true) || '');
  return lines;
}

// Lo escrito en el campo de Claude Code (la línea «❯ …» bajo una raya), o null si no está en pantalla.
// La sugerencia que pinta en tenue («Di cuatro») no cuenta
function termField(id) {
  const t = terms.get(id);
  if (!t) return null;
  const b = t.term.buffer.active;
  for (let i = b.viewportY + t.term.rows - 1; i > b.viewportY; i--) {
    const l = b.getLine(i);
    if (!l || !SCREEN.field.test(l.translateToString(true)) || !SCREEN.rule.test(b.getLine(i - 1)?.translateToString(true) || '')) continue;
    let s = '';
    for (let x = 2; x < l.length; x++) {
      const cell = l.getCell(x);
      if (cell && !cell.isDim()) s += cell.getChars() || ' ';
    }
    return s.trim();
  }
  return null;
}

// La sugerencia del siguiente prompt: el campo vacío salvo un texto en tenue (se acepta con Tab)
function termSuggestion(id) {
  const t = terms.get(id);
  if (!t) return '';
  const b = t.term.buffer.active;
  for (let i = b.viewportY + t.term.rows - 1; i > b.viewportY; i--) {
    const l = b.getLine(i);
    if (!l || !SCREEN.field.test(l.translateToString(true)) || !SCREEN.rule.test(b.getLine(i - 1)?.translateToString(true) || '')) continue;
    let s = '';
    for (let x = 2; x < l.length; x++) {
      const cell = l.getCell(x);
      const ch = cell?.getChars() || ' ';
      if (ch.trim() && !cell.isDim()) return '';
      s += ch;
    }
    return s.trim();
  }
  return '';
}

// Opciones del diálogo del plan («Would you like to proceed?»), traducidas
const PLAN_LABELS = [
  [/clear context/i, 'Sí, vaciar el contexto y aceptar ediciones automáticamente'],
  [/bypass/i, 'Sí, con acceso total'],
  [/auto mode/i, 'Sí, en modo automático'],
  [/auto-accept|accept edits/i, 'Sí, y aceptar ediciones automáticamente'],
  [/manually/i, 'Sí, pero preguntar antes de cada cambio'],
  [/tell claude|keep planning|^no\b/i, 'No, dile a Claude qué cambiar', true],
];
function termPlanOptions(id) {
  const lines = termScreen(id);
  const at = lines.findLastIndex((l) => SCREEN.planAsk.test(l));
  if (at < 0) return null;
  const opts = [];
  for (const l of lines.slice(at + 1)) {
    const m = SCREEN.option.exec(l);
    if (!m) continue;
    const known = PLAN_LABELS.find(([re]) => re.test(m[2]));
    opts.push({ n: Number(m[1]), label: known ? known[1] : m[2], keep: !!known?.[2] });
  }
  return opts.length ? opts : null;
}

// Modo de permisos según el pie de la terminal
function termMode(id) {
  const foot = termScreen(id).slice(-8).join('\n');
  return SCREEN.modes.find(([re]) => re.test(foot))?.[1] || 'default';
}

// Al aprobar un plan Claude Code cambia de modo sin dejarlo en la transcripción: se lee del pie
function termSyncMode(c, tries = 6) {
  setTimeout(() => {
    const lines = termScreen(c.id);
    const mode = lines.some((l) => SCREEN.planAsk.test(l)) ? null : termMode(c.id);
    if (mode && mode !== 'plan') {
      if (c.permissionMode !== mode) { c.permissionMode = mode; api.setMode(c.id, mode); renderChips(); }
    } else if (tries > 1) termSyncMode(c, tries - 1);
  }, 700);
}

// Shift+Tab hasta llegar al modo pedido (o, sin destino, una sola vez)
let modeBusy = false;
async function termSetMode(c, target) {
  if (modeBusy || !terms.get(c.id)?.started) return;
  modeBusy = true;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    for (let i = 0; i < 6; i++) {
      api.ptyWrite(c.id, '\x1b[Z');
      await wait(260);
      const mode = termMode(c.id);
      c.permissionMode = mode;
      if (!target || mode === target) break;
    }
    if (target && c.permissionMode !== target) termScreenMiss(`el modo «${target}» en el pie`, c.id);
  } finally {
    modeBusy = false;
  }
  api.setMode(c.id, c.permissionMode);
  renderChips();
}

// /rewind (o Esc dos veces) en el chat: se elige el mensaje en un menú de la app y se maneja el
// selector de Claude Code con el teclado. Si algo no cuadra, se termina en la terminal.
const REWIND_LABELS = [
  [/code and conversation/i, 'Restaurar el código y la conversación', 'conv'],
  [/^restore conversation/i, 'Restaurar la conversación', 'conv'],
  [/^restore code/i, 'Restaurar el código', 'code'],
  [/summarize from here/i, 'Resumir desde aquí', 'sum'],
  [/summarize up to here/i, 'Resumir hasta aquí', 'sum'],
  [/never mind/i, 'Cancelar', 'cancel'],
];
const rewindText = (s) => String(s || '').replace(/\s+/g, ' ').replace(/…$/, '').trim();
const rewindable = (m) => m.role === 'user' && m.text?.trim() && !/^[/!]/.test(m.text.trim());

function openRewind() {
  const c = current();
  if (!c?.terminal || !terms.get(c.id)?.started) return;
  if (c.busy) { toast('Espera a que Claude termine (o interrúmpelo con Esc) para volver atrás.'); return; }
  const msgs = c.messages.filter(rewindable);
  if (!msgs.length) { toast('Todavía no hay mensajes a los que volver.'); return; }
  const line = (s) => { const t = rewindText(s); return t.length > 90 ? t.slice(0, 89) + '…' : t; };
  openPopover($('#composer'), 'Rewind · volver al punto anterior a…', [
    ...msgs.map((m) => ({ title: line(m.text), msg: m })),
    { title: '(actual)', selected: true },
  ], (it) => { if (it.msg) termRewind(c, it.msg); }, 'above');
}

// Editar un mensaje enviado: /rewind a ese mensaje restaurando solo la conversación (el texto queda en el cuadro)
// Si Claude está trabajando, antes se le interrumpe (como Esc) y se espera a que pare
const editing = new Set();
async function editMessage(c, m) {
  const id = c?.id;
  if (!c?.terminal || !m || !terms.get(id)?.started || editing.has(id)) return;
  editing.add(id);
  document.body.classList.add('rewinding'); // /rewind tarda unos segundos: el cuadro se atenúa mientras
  try {
    let queued = '';
    if (c.busy) {
      // Lo que estaba en cola vuelve al cuadro, detrás del mensaje que se edita
      queued = await api.interrupt(id);
      for (let i = 0; i < 50 && state.convs.get(id)?.busy; i++) await new Promise((r) => setTimeout(r, 200));
      c = state.convs.get(id);
      if (!c) return;
      if (c.busy) { toast('Claude no ha parado; inténtalo otra vez.'); return; }
      m = c.messages.find((x) => x.id === m.id);
      if (!m) { if (queued) { input.value = queued; autosize(); } return; }
      // Interrumpido antes de responder, Claude Code devuelve el mensaje a su campo y lo quita de
      // la conversación (ni sale en /rewind): basta con vaciar su campo y volver atrás en el chat
      const want = rewindText(m.text).slice(0, 30);
      await new Promise((r) => setTimeout(r, 300));
      if (want && rewindText(termField(id)).startsWith(want)) {
        api.ptyWrite(id, '\x03');
        await api.rewind(id, m.id);
        input.value = [m.text, queued].filter(Boolean).join('\n\n');
        autosize();
        focusInput();
        return;
      }
    }
    await termRewind(c, m, 'conv-only', queued);
  } finally { editing.delete(id); document.body.classList.remove('rewinding'); }
}

async function termRewind(c, m, pick, extra = '') {
  const id = c.id;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Las líneas que siguen al texto buscado, o null si no aparece
  const after = async (re, tries = 20) => {
    for (let i = 0; i < tries; i++) {
      const lines = termScreen(id);
      const at = lines.findLastIndex((l) => re.test(l));
      if (at >= 0) return lines.slice(at + 1);
      await wait(150);
    }
    return null;
  };
  const toTerminal = (what) => {
    termScreenMiss(what, id);
    setTermView(id, 'terminal');
    toast('Termina de volver atrás en la terminal; luego vuelve al chat con Ctrl+º.');
    if (extra && !input.value) { input.value = extra; autosize(); }
  };
  const fieldUsed = () => !!termField(id);
  // Al interrumpir, Claude Code puede devolver el mensaje a su campo: se borra antes de escribir /rewind
  if (fieldUsed()) { api.ptyWrite(id, '\x03'); await wait(300); }
  api.ptyWrite(id, '/rewind');
  await wait(150);
  api.ptyWrite(id, '\r');
  if (!await after(SCREEN.rewindList)) return toTerminal('el selector de /rewind («Restore the code and/or conversation»)');

  // Empieza en «(current)»: se sube hasta el mensaje (si hay varios iguales, el que toca contando desde abajo)
  const want = rewindText(m.text);
  const same = (s) => { const n = Math.min(s.length, want.length, 40); return n > 0 && s.slice(0, n) === want.slice(0, n); };
  const msgs = c.messages.filter(rewindable);
  let skip = msgs.slice(msgs.indexOf(m) + 1).filter((x) => same(rewindText(x.text))).length;
  const selected = () => {
    const lines = termScreen(id);
    const from = lines.findLastIndex((l) => SCREEN.rewindList.test(l));
    const at = from < 0 ? -1 : lines.findIndex((l, j) => j > from && SCREEN.selected.test(l));
    return at < 0 ? null : { text: rewindText(SCREEN.selected.exec(lines[at])[1]), info: rewindText(lines[at + 1]) };
  };
  let info = null;
  let prev = selected()?.text;
  for (let i = 0; i < msgs.length + 6 && info === null; i++) {
    api.ptyWrite(id, '\x1b[A');
    // Claude Code tarda en repintar: se espera a que se mueva la marca (o 1,5 s si hay dos mensajes iguales seguidos)
    let sel = null;
    for (let j = 0; j < 15; j++) {
      await wait(100);
      sel = selected();
      if (sel && sel.text !== prev) break;
    }
    if (!sel) break;
    // Sin moverse y sin ser el buscado: se ha llegado arriba del todo
    if (sel.text === prev && !same(sel.text)) break;
    prev = sel.text;
    if (same(sel.text) && skip-- === 0) info = sel.info;
  }
  if (info === null) return toTerminal(`el mensaje «${want.slice(0, 40)}» en el selector de /rewind`);
  api.ptyWrite(id, '\r');
  const lines = await after(SCREEN.rewindConfirm);
  if (!lines) return toTerminal('las opciones de /rewind («Confirm you want to restore»)');
  const opts = [];
  for (const l of lines) {
    const o = SCREEN.option.exec(l);
    if (!o) continue;
    const known = REWIND_LABELS.find(([re]) => re.test(o[2]));
    opts.push({ n: o[1], title: known ? known[1] : o[2], kind: known?.[2] || 'other' });
  }
  if (!opts.length) return toTerminal('las opciones de /rewind');
  const cancel = async () => {
    // Esc vuelve a la lista y otro Esc la cierra
    api.ptyWrite(id, '\x1b');
    await wait(250);
    if (termScreen(id).some((l) => SCREEN.rewindList.test(l))) api.ptyWrite(id, '\x1b');
  };
  const cancelOpt = opts.find((o) => o.kind === 'cancel');
  const items = opts.filter((o) => o.kind !== 'cancel');
  items.push({ title: 'Cancelar', kind: 'cancel', n: cancelOpt?.n });
  const code = /no code changes/i.test(info) ? 'Sin cambios en el código' : info;
  const choose = async (o) => {
    if (o.kind === 'cancel') return o.n ? api.ptyWrite(id, o.n) : cancel();
    api.ptyWrite(id, o.n);
    if (o.kind !== 'conv') return;
    // Como en la terminal: la conversación vuelve atrás y el mensaje queda en el cuadro para editarlo.
    // Claude Code también lo deja escrito en su campo: se borra allí (Ctrl+C) para no enviarlo dos veces.
    await api.rewind(id, m.id);
    input.value = [m.text, extra].filter(Boolean).join('\n\n');
    autosize();
    focusInput();
    for (let i = 0; i < 15; i++) {
      await wait(150);
      const scr = termScreen(id);
      if (scr.some((l) => SCREEN.rewindConfirm.test(l))) continue;
      if (fieldUsed()) { api.ptyWrite(id, '\x03'); break; }
    }
  };
  // Al editar se elige sola la opción de restaurar solo la conversación (el código no se toca)
  const auto = pick === 'conv-only' && (items.find((o) => /^Restaurar la conversación/.test(o.title)) || items.find((o) => o.kind === 'conv'));
  if (auto) return choose(auto);
  openPopover($('#composer'), `Rewind · ${code || 'qué restaurar'}`, items, choose, 'above', cancel);
}

// Claude Code enseña algo que el chat no sabe mostrar: a la terminal
api.onTermAttention(({ convId }) => {
  if (termViewOf(convId) === 'terminal') return;
  setTermView(convId, 'terminal');
  if (convId === state.activeId) toast('Claude Code te pregunta algo en la terminal. Al terminar, vuelve al chat con Ctrl+º.');
  else { state.unread.add(convId); renderTabs(); }
});

function showTerminal(c) {
  const t = ensureTerm(c);
  for (const x of terms.values()) x.el.hidden = x !== t;
  requestAnimationFrame(() => {
    const cols = t.term.cols;
    fitTerm(t);
    if (!t.started) startTerm(t);
    // Se perdió el dibujo (ventana oculta) o se ha estrechado (lo ya impreso no se reajusta y se cortaría
    // por la derecha): que Claude Code lo repinte entero al ancho nuevo (Ctrl+L)
    // (tras el cambio de tamaño: si llega a la vez, Claude Code repinta al ancho viejo)
    else if (!t.exited && termBlank(t)) api.ptyWrite(t.id, '\x0c');
    else if (!t.exited && t.term.cols < cols) setTimeout(() => { if (!t.exited && terms.get(t.id) === t) api.ptyWrite(t.id, '\x0c'); }, 400);
    t.term.focus();
  });
}

function termBlank(t) {
  const b = t.term.buffer.active;
  for (let i = 0; i < b.length; i++) if (b.getLine(i)?.translateToString().trim()) return false;
  return true;
}

function focusTerm() {
  const t = terms.get(state.activeId);
  if (t && !document.querySelector('dialog[open]')) t.term.focus();
}

function disposeTerm(id) {
  const t = terms.get(id);
  if (!t) return;
  terms.delete(id);
  t.term.dispose();
  t.el.remove();
}

new ResizeObserver(() => {
  const t = terms.get(state.activeId);
  if (t && !termHost.hidden) fitTerm(t);
}).observe(termHost);

api.onPtyData(({ id, data }) => terms.get(id)?.term.write(data));
// Se ha vuelto a lanzar (cambio de cuenta): pantalla limpia y se reabre retomando la conversación
api.onPtyRestart(({ id }) => {
  const t = terms.get(id);
  if (!t?.started) return; // aún no se ha abierto: ya arrancará con lo nuevo
  t.term.reset();
  startTerm(t);
});
api.onPtyExit(({ id }) => {
  const t = terms.get(id);
  if (!t) return;
  t.exited = true;
  t.busy = false;
  const c = state.convs.get(id);
  if (c) c.busy = false;
  t.term.write(`\r\n\x1b[2m[Claude Code se ha cerrado · Enter para volver a abrir esta conversación · ${K('Ctrl+W')} para cerrar la pestaña]\x1b[0m\r\n`);
  renderTabs();
  setTermView(id, 'terminal');
});
