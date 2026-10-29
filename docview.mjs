// Vista previa de archivos en el panel lateral: un servidor HTTP solo para este equipo (127.0.0.1, con
// un token en la ruta) que el <webview> aislado del panel carga como una página local.
// - HTML, PDF, imágenes, SVG y texto: tal cual (el HTML con sus archivos de al lado, que se sirven
//   desde su carpeta raíz: la de trabajo de la pestaña o la suya).
// - Word, Excel/CSV/ODS, Markdown y PowerPoint: convertidos a una página legible (sin scripts salvo
//   los propios de la vista, con nonce).
// - Word, Excel/CSV y PDF se pueden editar ahí mismo (docedit.mjs guarda los cambios; el PDF, con pdf.js:
//   texto, dibujo, resaltado y formularios).
// Dos orígenes (dos puertos): el del archivo tal cual (HTML con sus scripts) y el de las vistas, que
// llevan la clave para guardar; así una página HTML no puede leer esa clave ni guardar nada.
// Cada archivo que se enseña se vigila y la interfaz recarga la vista al cambiar (watch).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createRequire } from 'node:module';
import { patchDocx, patchXlsx, patchCsv, sniffCsv } from './docedit.mjs';

const IS_WIN = process.platform === 'win32';
const MAX_ROWS = 3000;
const MAX_COLS = 200;
const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  pdf: 'application/pdf', txt: 'text/plain', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', wasm: 'application/wasm',
};
// Lo que se edita en la vista
const EDITABLE = new Set(['docx', 'xlsx', 'xlsm', 'csv', 'tsv', 'pdf']);
// Lo que el origen de las vistas sirve tal cual (nada con scripts: HTML, SVG, JS)
const PLAIN = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'woff', 'woff2', 'ttf', 'otf']);
// pdf.js (visor y editor de PDF)
let PDFJS = null;
try { PDFJS = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')); } catch {}
// Lo que se convierte a página
const CONVERT = new Set(['docx', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'md', 'markdown', 'pptx']);
// Lo que se puede enseñar (la interfaz abre sola todo menos Markdown: AUTO_DOC en app.js)
export const PREVIEW_EXT = new Set([...CONVERT, 'html', 'htm', 'pdf', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp']);
export const extOf = (f) => path.extname(String(f)).slice(1).toLowerCase();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HOME = os.homedir();
const same = (a, b) => (IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (root, f) => {
  const rel = path.relative(root, f);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

// Estilo de las páginas convertidas: en claro, como el papel de Word o Excel
const BASE_CSS = `
:root { color-scheme: light; --bg: #ecebe6; --paper: #fff; --text: #1f1e1b; --muted: #74726a; --line: #e2e0d8; --head: #f6f5f1; --sel: #d97757; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.6 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
a { color: #c6613f; }
img { max-width: 100%; height: auto; }
.page { max-width: 820px; margin: 28px auto 60px; padding: 64px 72px; background: var(--paper); border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.06); }
@media (max-width: 700px) { .page { margin: 0; min-height: 100vh; padding: 28px 22px; border-radius: 0; box-shadow: none; } }
.page h1, .page h2, .page h3 { line-height: 1.25; margin: 1.2em 0 .5em; } .page h1:first-child, .page h2:first-child { margin-top: 0; }
.page table { border-collapse: collapse; margin: 1em 0; } .page td, .page th { border: 1px solid var(--line); padding: 4px 8px; vertical-align: top; }
.page pre { background: var(--head); padding: 12px 14px; border-radius: 8px; overflow: auto; font-size: 13px; }
.page code { font-family: "Cascadia Code", Consolas, ui-monospace, monospace; font-size: .9em; }
.page blockquote { margin: 1em 0; padding: 0 1em; border-left: 3px solid var(--line); color: var(--muted); }
.note { margin: 40px auto; max-width: 520px; text-align: center; color: var(--muted); }
`;

const SHEET_CSS = `
html, body { height: 100%; overflow: hidden; }
body { display: flex; flex-direction: column; background: var(--paper); font-size: 13px; }
.fx { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid var(--line); background: var(--head); font-size: 12.5px; flex: none; }
.fx .addr { min-width: 64px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); font-weight: 600; text-align: center; }
.fx .fxi { color: var(--muted); font-style: normal; }
.fx .val { flex: 1; min-width: 0; border: 0; outline: none; padding: 3px 6px; border-radius: 5px; background: transparent; color: var(--text); font: 12.5px "Cascadia Code", Consolas, ui-monospace, monospace; }
.fx .val:not([readonly]):focus { background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.grid { flex: 1; overflow: auto; }
.sheet { display: none; } .sheet.on { display: block; }
table { border-collapse: separate; border-spacing: 0; }
td, th { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 3px 7px; white-space: nowrap; max-width: 420px; overflow: hidden; text-overflow: ellipsis; height: 22px; }
th { position: sticky; top: 0; z-index: 2; background: var(--head); color: var(--muted); font-weight: 500; font-size: 11.5px; text-align: center; }
th.rn, td.rn { position: sticky; left: 0; z-index: 1; background: var(--head); color: var(--muted); font-size: 11.5px; text-align: center; min-width: 42px; }
th.rn { z-index: 3; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
td.b { font-weight: 600; }
td.cur { outline: 2px solid var(--sel); outline-offset: -2px; }
td:not(.rn) { cursor: cell; }
th:not(.rn) { min-width: 64px; }
td.editing { padding: 0; overflow: visible; }
.cell-in { display: block; width: 100%; min-width: 100%; height: 21px; border: 0; outline: none; padding: 3px 7px; font: inherit; color: inherit; background: var(--paper); }
td.pend { color: var(--muted); font-style: italic; }
.edbar { bottom: 48px; }
.tabs { display: flex; gap: 2px; padding: 0 8px; border-top: 1px solid var(--line); background: var(--head); flex: none; overflow-x: auto; }
.tabs button { font: inherit; font-size: 12.5px; padding: 6px 14px; border: 0; background: none; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; }
.tabs button.on { color: var(--text); border-bottom-color: var(--sel); background: var(--paper); }
.more { padding: 10px 14px; color: var(--muted); }
`;

const SLIDES_CSS = `
.slides { max-width: 900px; margin: 24px auto 60px; padding: 0 20px; display: grid; gap: 18px; }
.slide { aspect-ratio: 16 / 9; background: var(--paper); border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 8px 28px rgba(0,0,0,.06); padding: 5% 6%; overflow: hidden; position: relative; display: flex; flex-direction: column; gap: .4em; }
.slide .num { position: absolute; right: 14px; bottom: 10px; font-size: 12px; color: var(--muted); }
.slide h2 { margin: 0 0 .3em; font-size: 1.6em; line-height: 1.2; }
.slide p { margin: 0; }
.slide img { max-height: 45%; object-fit: contain; align-self: flex-start; }
`;

// edit: la página guarda (fetch a su origen); pdf: además carga pdf.js (módulos, worker y wasm de su origen)
function page(title, body, { css = '', script = '', nonce = '', edit = false, pdf = false, head = '' } = {}) {
  const csp = [
    "default-src 'none'", "img-src data: blob: 'self'", `style-src 'unsafe-inline'${pdf ? " 'self'" : ''}`, "font-src data: 'self'",
    `script-src ${nonce ? `'nonce-${nonce}'${pdf ? " 'self' 'wasm-unsafe-eval'" : ''}` : "'none'"}`,
    ...(edit || pdf ? ["connect-src 'self'"] : []), ...(pdf ? ["worker-src 'self'"] : []),
  ].join('; ');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>${head}<style>${pdf ? PDF_BASE_CSS : BASE_CSS}${edit ? EDIT_CSS : ''}${css}</style></head>
<body>${body}${script ? `<script${pdf ? ' type="module"' : ''} nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}
const nonceOf = () => crypto.randomBytes(12).toString('base64');

// ---------- Edición: lo común (barra «Cambios sin guardar · Descartar · Guardar», Ctrl+S, y lo que
// pregunta la interfaz antes de recargar la vista: window.__editor) ----------
const EDIT_CSS = `
.edbar { position: fixed; right: 14px; bottom: 14px; z-index: 50; display: flex; align-items: center; gap: 4px; max-width: calc(100% - 28px); padding: 5px 5px 5px 14px; background: #2b2a27; color: #f4f3ee; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.22); font: 12.5px/1.3 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
.edbar[hidden] { display: none; }
.edbar .msg { margin-right: 6px; min-width: 0; }
.edbar.ok { padding-right: 14px; }
.edbar.ok button { display: none; }
.edbar.err .msg { color: #ffb59c; }
.edbar button { font: inherit; border: 0; border-radius: 999px; padding: 5px 12px; cursor: pointer; background: transparent; color: inherit; white-space: nowrap; }
.edbar button:hover { background: rgba(255,255,255,.1); }
.edbar button.pri { background: #d97757; color: #fff; } .edbar button.pri:hover { background: #c6613f; }
.edbar button:disabled { opacity: .5; cursor: default; }
`;
// ed = { key, ver }. Cada formato pone fmt.collect() (lo que se envía, o null si no hay cambios) y fmt.saved()
const editScript = (ed) => `
const ED = ${JSON.stringify(ed)};
const fmt = {};
let dirty = false, savedAt = 0, busy = false;
const bar = document.createElement('div');
bar.className = 'edbar';
bar.hidden = true;
bar.innerHTML = '<span class="msg"></span><button type="button" data-ed="discard">Descartar</button><button type="button" class="pri" data-ed="save">Guardar</button>';
document.body.append(bar);
const SAVE_KEY = /Mac/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';
function showBar(text, kind = '') {
  bar.querySelector('.msg').textContent = text;
  bar.classList.toggle('err', kind === 'err');
  bar.classList.toggle('ok', kind === 'ok');
  bar.hidden = false;
}
function setDirty(v) {
  dirty = v;
  if (v) showBar('Cambios sin guardar · ' + SAVE_KEY);
  else if (!bar.classList.contains('err')) bar.hidden = true;
}
async function save() {
  if (busy || !dirty) return;
  busy = true;
  bar.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  showBar('Guardando…');
  try {
    const data = await fmt.collect();
    if (!data) { dirty = false; bar.hidden = true; return; }
    const r = await fetch(location.pathname + '?guardar', { method: 'POST', headers: { 'x-clave': ED.key, 'x-version': String(ED.ver), 'content-type': data.type }, body: data.body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || 'No se ha podido guardar');
    ED.ver = j.ver;
    savedAt = Date.now();
    dirty = false;
    showBar('Guardado', 'ok');
    setTimeout(() => { if (!dirty && bar.classList.contains('ok')) bar.hidden = true; }, 1400);
    fmt.saved?.();
  } catch (e) { showBar(e.message, 'err'); }
  finally { busy = false; bar.querySelectorAll('button').forEach((b) => { b.disabled = false; }); }
}
bar.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ed]');
  if (!b) return;
  if (b.dataset.ed === 'save') save();
  else { dirty = false; location.reload(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
}, true);
window.__editor = {
  // Mientras se guarda, el cambio que ve la interfaz es el propio: no se recarga
  estado: () => (busy || Date.now() - savedAt < 4000 ? 'guardado' : dirty ? 'sucio' : ''),
  fuera: () => showBar('Ha cambiado fuera de aquí. Descarta para ver la versión nueva.', 'err'),
};
`;

// Word: cada párrafo (título, elemento de lista, celda de tabla) se edita en su sitio y se guarda solo su
// texto. No se editan los que tienen imágenes, listas dentro o llamadas a notas (no se podrían guardar igual)
const DOCX_CSS = `
.ed { outline: none; border-radius: 3px; cursor: text; white-space: pre-wrap; transition: background-color .12s, box-shadow .12s; }
.ed:hover { background: rgba(217,119,87,.06); }
.ed:focus { background: rgba(217,119,87,.08); box-shadow: 0 0 0 4px rgba(217,119,87,.08); }
`;
const DOCX_SCRIPT = `
const SEL = 'article.page :is(p, h1, h2, h3, h4, h5, h6, li)';
const NOTE = 'li[id^="footnote-"], li[id^="endnote-"], li[id^="comment-"]';
const own = (el) => [...el.childNodes].filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map((n) => n.textContent).join('');
const norm = (s) => s.replace(/\\t/g, '');
let items = [];
// Cada párrafo con su texto y cuántos iguales hay antes: así lo encuentra quien guarda
function index() {
  const seen = new Map();
  items = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (el.closest(NOTE)) continue;
    const t = norm(own(el));
    const k = seen.get(t) || 0;
    seen.set(t, k + 1);
    el.dataset.o = t;
    el.dataset.k = k;
    items.push(el);
  }
}
index();
for (const el of items) {
  if (!el.dataset.o.trim() || el.querySelector('ul, ol, img, table, a[href^="#footnote"], a[href^="#endnote"], a[href^="#comment"]')) continue;
  el.contentEditable = 'plaintext-only';
  el.classList.add('ed');
}
const inEd = (e) => (e.target.nodeType === 1 ? e.target : e.target.parentElement)?.closest('.ed');
document.addEventListener('beforeinput', (e) => {
  if (inEd(e) && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) e.preventDefault();
});
document.addEventListener('paste', (e) => {
  if (!inEd(e)) return;
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\\s*[\\r\\n]+\\s*/g, ' '));
});
document.addEventListener('input', (e) => { if (inEd(e)) setDirty(true); });
fmt.collect = () => {
  const parrafos = items.filter((el) => el.classList.contains('ed')).map((el) => ({ o: el.dataset.o, k: +el.dataset.k, t: norm(own(el)) })).filter((p) => p.t !== p.o);
  return parrafos.length ? { type: 'application/json', body: JSON.stringify({ parrafos }) } : null;
};
fmt.saved = index;
`;

// ---------- Conversores ----------
async function docxPage(file, ed) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.convertToHtml({ path: file });
  const body = `<article class="page">${value || '<p class="note">El documento está vacío.</p>'}</article>`;
  if (!ed || !value) return page(path.basename(file), body);
  return page(path.basename(file), body, { css: DOCX_CSS, script: editScript(ed) + DOCX_SCRIPT, nonce: nonceOf(), edit: true });
}

async function markdownPage(file) {
  const { marked } = await import('marked');
  const html = marked.parse(fs.readFileSync(file, 'utf8'));
  // Sin scripts por la CSP; los enlaces relativos, desde su carpeta
  return page(path.basename(file), `<article class="page">${html}</article>`);
}

// Fórmulas sin resultado guardado (los Excel hechos con un script, p. ej. openpyxl o SheetJS, no lo
// calculan): se calculan aquí las habituales (aritmética, comparaciones, &, referencias y rangos,
// también de otra hoja, y SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, ROUND, ABS, IF, AND, OR, SUMIF, CONCAT…)
// fresh: recalcular también las que tienen resultado guardado (el libro pide recalcular al abrir, como los
// guardados desde aquí); si algo no se sabe calcular, vale el guardado
function evaluator(XLSX, wb, fresh = false) {
  const memo = new Map();
  const ERR = { err: '#¡VALOR!' };
  const UNSUP = { err: '#¿NOMBRE?', unsup: true };
  const serial = (d) => (d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5 + 25569;
  const flat = (a) => (Array.isArray(a) ? a.flat(Infinity) : [a]);
  const nums = (args) => args.flatMap(flat).filter((v) => typeof v === 'number');
  const num = (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? +v : v === '' || v == null ? 0 : Number.isFinite(+v) ? +v : NaN);
  const crit = (c) => {
    const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(c));
    const op = m[1] || '=';
    const rhs = m[2] !== '' && Number.isFinite(+m[2]) ? +m[2] : m[2].toLowerCase();
    return (v) => {
      const l = typeof rhs === 'number' ? num(v) : String(v ?? '').toLowerCase();
      return op === '=' ? l === rhs : op === '<>' ? l !== rhs : op === '<' ? l < rhs : op === '>' ? l > rhs : op === '<=' ? l <= rhs : l >= rhs;
    };
  };
  const FN = {
    SUM: (...a) => nums(a).reduce((s, x) => s + x, 0),
    AVERAGE: (...a) => { const n = nums(a); return n.length ? n.reduce((s, x) => s + x, 0) / n.length : ERR; },
    MIN: (...a) => Math.min(...nums(a), Infinity) === Infinity ? 0 : Math.min(...nums(a)),
    MAX: (...a) => Math.max(...nums(a), -Infinity) === -Infinity ? 0 : Math.max(...nums(a)),
    COUNT: (...a) => nums(a).length,
    COUNTA: (...a) => a.flatMap(flat).filter((v) => v !== '' && v != null).length,
    ROUND: (x, d = 0) => { const p = 10 ** num(d); return Math.round(num(x) * p) / p; },
    ABS: (x) => Math.abs(num(x)),
    IF: (c, a = true, b = false) => (c ? a : b),
    AND: (...a) => a.flatMap(flat).every(Boolean),
    OR: (...a) => a.flatMap(flat).some(Boolean),
    NOT: (x) => !x,
    SUMIF: (r, c, s = r) => { const t = crit(c); const rr = flat(r); const ss = flat(s); return rr.reduce((acc, v, i) => acc + (t(v) ? num(ss[i]) || 0 : 0), 0); },
    COUNTIF: (r, c) => { const t = crit(c); return flat(r).filter(t).length; },
    CONCAT: (...a) => a.flatMap(flat).join(''),
    CONCATENATE: (...a) => a.flatMap(flat).join(''),
    UPPER: (s) => String(s).toUpperCase(), LOWER: (s) => String(s).toLowerCase(),
  };
  // SUMA, PROMEDIO… (Excel en español guarda las fórmulas en inglés, pero por si acaso)
  Object.assign(FN, { SUMA: FN.SUM, PROMEDIO: FN.AVERAGE, CONTAR: FN.COUNT, REDONDEAR: FN.ROUND, SI: FN.IF, SUMAR_SI: FN.SUMIF, CONTAR_SI: FN.COUNTIF });

  function cellValue(sheet, addr, depth) {
    const key = `${sheet}!${addr}`;
    if (memo.has(key)) return memo.get(key);
    const ws = wb.Sheets[sheet];
    const cell = ws?.[addr];
    let v = '';
    if (cell) {
      const saved = cell.v instanceof Date ? serial(cell.v) : cell.v;
      if (cell.f && (saved === undefined || fresh)) {
        memo.set(key, ERR); // referencia circular
        v = depth > 50 ? ERR : calc(cell.f, sheet, depth + 1);
        if (v?.err && saved !== undefined) v = saved;
      } else v = saved ?? '';
    }
    memo.set(key, v);
    return v;
  }

  function calc(f, sheet, depth = 0) {
    const src = String(f);
    let i = 0;
    const ws = () => { while (src[i] === ' ') i++; };
    const peek = (re) => { ws(); const m = re.exec(src.slice(i)); return m; };
    const take = (re) => { const m = peek(re); if (m) i += m[0].length; return m; };
    const REF = /^(?:(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/;
    function primary() {
      let m;
      if ((m = take(/^\(/))) { const v = expr(); take(/^\)/); return v; }
      if ((m = take(/^"((?:[^"]|"")*)"/))) return m[1].replace(/""/g, '"');
      if ((m = take(/^\d+(\.\d+)?(e[+-]?\d+)?%?/i))) return m[0].endsWith('%') ? parseFloat(m[0]) / 100 : parseFloat(m[0]);
      if ((m = take(/^(TRUE|FALSE)\b/i))) return m[1].toUpperCase() === 'TRUE';
      if ((m = take(/^([A-Za-z_][\w.]*)\(/))) {
        const name = m[1].toUpperCase().replace(/^_XLFN\./, '');
        const args = [];
        if (!take(/^\)/)) { do args.push(expr()); while (take(/^[,;]/)); take(/^\)/); }
        const fn = FN[name];
        if (!fn) throw UNSUP;
        return fn(...args);
      }
      if ((m = take(REF))) {
        const sh = m[1]?.replace(/''/g, "'") || m[2] || sheet;
        if (!m[5]) return cellValue(sh, `${m[3]}${m[4]}`, depth);
        const s = XLSX.utils.decode_cell(`${m[3]}${m[4]}`);
        const e = XLSX.utils.decode_cell(`${m[5]}${m[6]}`);
        const rows = [];
        for (let r = Math.min(s.r, e.r); r <= Math.max(s.r, e.r) && rows.length < 20000; r++) {
          const row = [];
          for (let c = Math.min(s.c, e.c); c <= Math.max(s.c, e.c); c++) row.push(cellValue(sh, XLSX.utils.encode_cell({ r, c }), depth));
          rows.push(row);
        }
        return rows;
      }
      throw new Error(src.slice(i, i + 10));
    }
    function unary() { if (take(/^-/)) return -num(unary()); if (take(/^\+/)) return unary(); return primary(); }
    function power() { let v = unary(); while (take(/^\^/)) v = num(v) ** num(unary()); return v; }
    function mul() { let v = power(); let m; while ((m = take(/^[*/]/))) { const r = num(power()); v = m[0] === '*' ? num(v) * r : num(v) / r; } return v; }
    function add() { let v = mul(); let m; while ((m = take(/^[+-]/))) { const r = num(mul()); v = m[0] === '+' ? num(v) + r : num(v) - r; } return v; }
    function concat() { let v = add(); while (take(/^&/)) v = `${v ?? ''}${add() ?? ''}`; return v; }
    function expr() {
      let v = concat();
      let m;
      while ((m = take(/^(<=|>=|<>|<|>|=)/))) {
        const r = concat();
        const [a, b] = typeof v === 'number' || typeof r === 'number' ? [num(v), num(r)] : [String(v).toLowerCase(), String(r).toLowerCase()];
        v = m[1] === '=' ? a === b : m[1] === '<>' ? a !== b : m[1] === '<' ? a < b : m[1] === '>' ? a > b : m[1] === '<=' ? a <= b : a >= b;
      }
      return v;
    }
    try {
      const v = expr();
      return Array.isArray(v) ? v.flat()[0] ?? '' : v;
    } catch (e) { return e === UNSUP ? UNSUP : ERR; }
  }
  return (sheet, addr) => cellValue(sheet, addr, 0);
}
const showValue = (v) => (v?.err ? v.err : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)) : typeof v === 'boolean' ? (v ? 'VERDADERO' : 'FALSO') : String(v ?? ''));

// Hoja de cálculo como Excel: letras de columna, números de fila, celdas combinadas, pestañas de
// hojas y una barra que enseña la fórmula o el valor de la celda pulsada. Con ed (xlsx, xlsm, csv, tsv),
// también se edita como en Excel: escribir, F2 o doble clic, Intro, Tab, Supr, la barra de fórmulas y
// pegar un bloque copiado de otra hoja
const excelSerial = (d) => (d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5 + 25569;
async function sheetPage(file, ed) {
  const XLSX = await import('xlsx');
  const ext = extOf(file);
  const opts = { cellFormula: true, cellStyles: true, cellDates: true, dense: false };
  const wb = ext === 'csv' || ext === 'tsv'
    ? ((t) => XLSX.read(t, { ...opts, type: 'string', FS: ext === 'tsv' ? '\t' : sniffCsv(t) }))(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''))
    : XLSX.read(fs.readFileSync(file), { ...opts, type: 'buffer' });
  const editable = !!ed && /^(xlsx|xlsm|csv|tsv)$/.test(ext);
  const fresh = ['1', 'true', 1, true].includes(wb.Workbook?.CalcPr?.fullCalcOnLoad);
  const value = evaluator(XLSX, wb, fresh);
  const sheets = wb.SheetNames.map((name, si) => {
    const ws = wb.Sheets[name];
    const head = `<div class="sheet${si ? '' : ' on'}" data-s="${si}" data-name="${esc(name)}">`;
    if (!ws?.['!ref'] && !editable) return `${head}<p class="more">Hoja vacía.</p></div>`;
    const r = XLSX.utils.decode_range(ws?.['!ref'] || 'A1');
    // Para editar, desde A1 y con sitio alrededor para escribir más
    const v = editable ? { s: { r: 0, c: 0 }, e: { r: Math.max(r.e.r + 1, 29), c: Math.max(r.e.c + 1, 9) } } : r;
    const lastR = Math.min(v.e.r, v.s.r + MAX_ROWS - 1);
    const lastC = Math.min(v.e.c, v.s.c + MAX_COLS - 1);
    // Celdas combinadas: la primera se extiende, las demás no se pintan
    const span = new Map();
    const hidden = new Set();
    for (const m of ws?.['!merges'] || []) {
      span.set(`${m.s.r},${m.s.c}`, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]);
      for (let y = m.s.r; y <= m.e.r; y++) for (let x = m.s.c; x <= m.e.c; x++) if (y !== m.s.r || x !== m.s.c) hidden.add(`${y},${x}`);
    }
    const cols = ws?.['!cols'] || [];
    let html = '<table><thead><tr><th class="rn"></th>';
    for (let c = v.s.c; c <= lastC; c++) {
      const w = cols[c]?.wpx || (cols[c]?.wch ? cols[c].wch * 7 + 10 : 0);
      html += `<th${w ? ` style="min-width:${Math.min(w, 420)}px"` : ''}>${XLSX.utils.encode_col(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let y = v.s.r; y <= lastR; y++) {
      html += `<tr><td class="rn">${y + 1}</td>`;
      for (let x = v.s.c; x <= lastC; x++) {
        const key = `${y},${x}`;
        if (hidden.has(key)) continue;
        const addr = XLSX.utils.encode_cell({ r: y, c: x });
        const cell = ws?.[addr];
        const sp = span.get(key);
        const calc = cell?.f && (cell.v === undefined || fresh) ? value(name, addr) : undefined;
        const saved = cell?.v instanceof Date ? excelSerial(cell.v) : cell?.v;
        // Recalculada: si sale lo mismo que lo guardado, con su formato (fechas, moneda…)
        const useCalc = calc !== undefined && !(calc === saved && cell.w != null);
        const cls = [cell?.t === 'n' || cell?.t === 'd' || typeof calc === 'number' ? 'n' : '', cell?.s?.font?.bold || cell?.s?.bold ? 'b' : ''].filter(Boolean).join(' ');
        const fill = cell?.s?.fgColor?.rgb && cell.s.patternType === 'solid' ? ` style="background:#${String(cell.s.fgColor.rgb).slice(-6)}"` : '';
        const text = useCalc ? showValue(calc) : cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString('es-ES') : cell.v ?? '')) : '';
        const raw = cell ? (cell.f ? `=${cell.f}` : String(cell.v instanceof Date ? cell.w ?? cell.v.toLocaleDateString('es-ES') : cell.v ?? '')) : '';
        html += `<td data-a="${addr}"${raw ? ` data-v="${esc(raw)}"` : ''}${cls ? ` class="${cls}"` : ''}${fill}${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''}>${esc(text)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (lastR < v.e.r || lastC < v.e.c) html += `<p class="more">Se enseñan ${lastR - v.s.r + 1} filas y ${lastC - v.s.c + 1} columnas de ${r.e.r - r.s.r + 1} × ${r.e.c - r.s.c + 1}: ábrelo para ver el resto.</p>`;
    return `${head}${html}</div>`;
  });
  const tabs = wb.SheetNames.length > 1 ? `<nav class="tabs">${wb.SheetNames.map((n, i) => `<button data-s="${i}"${i ? '' : ' class="on"'}>${esc(n)}</button>`).join('')}</nav>` : '';
  const script = `${editable ? editScript(ed) : ''}
const EDIT = ${editable};
const fx = document.querySelector('.fx'), addr = fx.querySelector('.addr'), val = fx.querySelector('.val'), fxi = fx.querySelector('.fxi');
const grid = document.querySelector('.grid');
val.readOnly = !EDIT;
let cur = null, editing = null;
const edits = {};
const colN = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colS = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const parse = (a) => { const m = /^([A-Z]+)(\\d+)$/.exec(a); return { c: colN(m[1]), r: +m[2] }; };
const cellAt = (sh, c, r) => sh.querySelector('td[data-a="' + colS(c) + r + '"]');
const NUM = /^[-+]?(\\d+([.,]\\d*)?|[.,]\\d+)(e[-+]?\\d+)?%?$/i;
function showRaw(v) { val.value = v; val.title = v; fxi.hidden = !v.startsWith('='); }
function pick(td) {
  if (editing) commit();
  if (cur) cur.classList.remove('cur');
  cur = td;
  td.classList.add('cur');
  addr.textContent = td.dataset.a;
  showRaw(td.dataset.v || '');
}
// Más filas o columnas al escribir o moverse más allá del final (para editar se empieza en A1)
function grow(sh, c, r) {
  const table = sh.querySelector('table');
  if (!EDIT || !table || sh.querySelector('.more') || c > 16384 || r > 1048576) return;
  const head = table.tHead.rows[0], body = table.tBodies[0];
  const td = (a) => { const x = document.createElement('td'); x.dataset.a = a; return x; };
  let nc = head.cells.length - 1;
  while (nc < c) {
    nc++;
    const th = document.createElement('th');
    th.textContent = colS(nc);
    head.append(th);
    [...body.rows].forEach((tr, i) => tr.append(td(colS(nc) + (i + 1))));
  }
  while (body.rows.length < r) {
    const n = body.rows.length + 1;
    const tr = body.insertRow();
    const rn = document.createElement('td');
    rn.className = 'rn';
    rn.textContent = n;
    tr.append(rn);
    for (let x = 1; x <= nc; x++) tr.append(td(colS(x) + n));
  }
}
function move(dr, dc) {
  if (!cur) return;
  const sh = cur.closest('.sheet');
  let { c, r } = parse(cur.dataset.a);
  // Saltando las celdas tapadas por una combinada
  for (let i = 0; i < 60; i++) {
    c += dc; r += dr;
    if (c < 1 || r < 1) return;
    let td = cellAt(sh, c, r);
    if (!td) { grow(sh, c, r); td = cellAt(sh, c, r); }
    if (td) { pick(td); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; }
  }
}
function startEdit(text) {
  if (!EDIT || !cur) return;
  if (editing) commit();
  editing = cur;
  cur.dataset.shown = cur.textContent;
  const inp = document.createElement('input');
  inp.className = 'cell-in';
  inp.spellcheck = false;
  inp.value = text;
  cur.textContent = '';
  cur.append(inp);
  cur.classList.add('editing');
  inp.focus();
  inp.setSelectionRange(text.length, text.length);
  inp.addEventListener('input', () => showRaw(inp.value));
  showRaw(text);
}
function setCell(td, raw) {
  if (raw) td.dataset.v = raw; else delete td.dataset.v;
  td.textContent = raw;
  td.classList.toggle('n', NUM.test(raw.trim()));
  td.classList.toggle('pend', raw.startsWith('=') && raw.length > 1);
  td.title = td.classList.contains('pend') ? 'Se calcula al guardar' : '';
  (edits[td.closest('.sheet').dataset.name] ||= {})[td.dataset.a] = raw;
  setDirty(true);
  if (td === cur) showRaw(raw);
}
function commit(raw) {
  const td = editing;
  if (!td) return;
  const inp = td.querySelector('.cell-in');
  raw = raw ?? (inp ? inp.value : val.value);
  editing = null;
  td.classList.remove('editing');
  inp?.remove();
  if (raw === (td.dataset.v || '')) td.textContent = td.dataset.shown ?? '';
  else setCell(td, raw);
}
function cancel() {
  const td = editing;
  if (!td) return;
  editing = null;
  td.classList.remove('editing');
  td.textContent = td.dataset.shown ?? '';
  showRaw(td.dataset.v || '');
}
// La barra de fórmulas también edita la celda elegida
val.addEventListener('focus', () => { if (EDIT && cur && !editing) { editing = cur; cur.dataset.shown = cur.textContent; } });
val.addEventListener('input', () => { fxi.hidden = !val.value.startsWith('='); });
val.addEventListener('blur', () => { if (editing && !editing.querySelector('.cell-in')) commit(); });
document.addEventListener('click', (e) => {
  const td = e.target.closest('td[data-a]');
  if (td && td !== editing) pick(td);
  const b = e.target.closest('.tabs button');
  if (!b) return;
  if (editing) commit();
  document.querySelectorAll('.tabs button, .sheet').forEach((x) => x.classList.toggle('on', x.dataset.s === b.dataset.s));
  try { sessionStorage.setItem('hoja', b.dataset.s); } catch {}
});
document.addEventListener('dblclick', (e) => { const td = e.target.closest('td[data-a]'); if (td && td === cur && !editing) startEdit(td.dataset.v || ''); });
document.addEventListener('keydown', (e) => {
  if (e.isComposing || e.defaultPrevented) return;
  if (editing && (e.target === val || e.target.classList?.contains('cell-in'))) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); val.blur(); move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); val.blur(); move(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); val.blur(); }
    else if (e.target !== val && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); commit(); move(e.key === 'ArrowUp' ? -1 : 1, 0); }
    return;
  }
  if (!cur || e.target === val) return;
  const k = e.key;
  if (/^Arrow/.test(k)) { e.preventDefault(); move(k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0); return; }
  if (k === 'Enter') { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return; }
  if (k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return; }
  if (!EDIT || e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'F2') { e.preventDefault(); startEdit(cur.dataset.v || ''); }
  else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (cur.dataset.v) setCell(cur, ''); }
  else if (k.length === 1) { e.preventDefault(); startEdit(k); }
});
// Copiar la celda; pegar un bloque (filas y columnas separadas por saltos y tabuladores, como desde Excel)
document.addEventListener('copy', (e) => {
  if (editing || !cur || e.target === val) return;
  e.preventDefault();
  e.clipboardData.setData('text/plain', cur.textContent);
});
document.addEventListener('paste', (e) => {
  if (!EDIT || editing || !cur || e.target === val) return;
  e.preventDefault();
  const rows = (e.clipboardData.getData('text/plain') || '').replace(/\\r?\\n$/, '').split(/\\r?\\n/).slice(0, 2000).map((l) => l.split('\\t').slice(0, 200));
  const sh = cur.closest('.sheet');
  const { c, r } = parse(cur.dataset.a);
  rows.forEach((cells, y) => cells.forEach((v, x) => {
    let td = cellAt(sh, c + x, r + y);
    if (!td) { grow(sh, c + x, r + y); td = cellAt(sh, c + x, r + y); }
    if (td) setCell(td, v);
  }));
});
if (EDIT) {
  fmt.collect = () => (Object.keys(edits).length ? { type: 'application/json', body: JSON.stringify({ hojas: edits }) } : null);
  // Se vuelve a pintar con los resultados recalculados, en el mismo sitio
  fmt.saved = () => {
    try { sessionStorage.setItem('celda', JSON.stringify({ a: cur?.dataset.a, x: grid.scrollLeft, y: grid.scrollTop })); } catch {}
    location.reload();
  };
}
try {
  const s = sessionStorage.getItem('hoja');
  const b = s && document.querySelector('.tabs button[data-s="' + s + '"]');
  if (b) b.click();
  const p = JSON.parse(sessionStorage.getItem('celda') || 'null');
  sessionStorage.removeItem('celda');
  if (p) {
    grid.scrollLeft = p.x; grid.scrollTop = p.y;
    const td = p.a && document.querySelector('.sheet.on td[data-a="' + p.a + '"]');
    if (td) pick(td);
  }
} catch {}`;
  return page(path.basename(file), `<div class="fx"><span class="addr">—</span><i class="fxi" hidden>fx</i><input class="val" spellcheck="false" aria-label="Contenido de la celda"></div><div class="grid">${sheets.join('')}</div>${tabs}`, { css: SHEET_CSS, script, nonce: nonceOf(), edit: editable });
}

// PowerPoint: cada diapositiva con su título, su texto y sus imágenes (sin el diseño)
async function pptxPage(file) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const slides = [];
  for (const [i, n] of names.entries()) {
    const xml = await zip.file(n).async('string');
    const paras = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((m) => [...m[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decode(t[1])).join('')).filter((t) => t.trim());
    const isTitle = /type="(ctrTitle|title)"/.test(xml);
    // Imágenes de la diapositiva (sus relaciones)
    const imgs = [];
    const rels = zip.file(n.replace('slides/', 'slides/_rels/') + '.rels');
    if (rels) {
      const rx = await rels.async('string');
      for (const m of rx.matchAll(/Target="\.\.\/media\/([^"]+\.(png|jpe?g|gif))"/gi)) {
        const f = zip.file(`ppt/media/${m[1]}`);
        if (f && imgs.length < 2) imgs.push(`data:image/${m[2].toLowerCase().replace('jpg', 'jpeg')};base64,${await f.async('base64')}`);
      }
    }
    const [first, ...rest] = paras;
    slides.push(`<section class="slide">${first ? `<h2>${esc(first)}</h2>` : ''}${rest.map((p) => `<p>${esc(p)}</p>`).join('')}${imgs.map((s) => `<img src="${s}" alt="">`).join('')}<span class="num">${i + 1}${isTitle && i === 0 ? '' : ''}</span></section>`);
  }
  return page(path.basename(file), slides.length ? `<div class="slides">${slides.join('')}</div>` : '<p class="note">La presentación no tiene diapositivas.</p>', { css: SLIDES_CSS });
}

// PDF con pdf.js: se ve como en el visor de Firefox y se puede escribir texto, dibujar, resaltar y
// rellenar formularios; al guardar, pdf.js escribe los cambios en el PDF (una actualización al final)
const PDF_BASE_CSS = `
:root { color-scheme: light; --bg: #e9e8e3; --paper: #fff; --text: #1f1e1b; --muted: #74726a; --line: #dddbd2; --head: #f6f5f1; --sel: #d97757; }
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font: 13px/1.4 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
.note { margin: 40px auto; max-width: 520px; text-align: center; color: var(--muted); }
`;
const PDF_CSS = `
.pbar { position: absolute; inset: 0 0 auto 0; height: 42px; display: flex; align-items: center; gap: 10px; padding: 0 10px; background: var(--head); border-bottom: 1px solid var(--line); z-index: 10; overflow-x: auto; }
.pbar .grp { display: flex; gap: 2px; padding: 2px; background: var(--paper); border: 1px solid var(--line); border-radius: 8px; flex: none; }
.pbar button { display: flex; align-items: center; gap: 6px; font: inherit; border: 0; background: none; padding: 4px 10px; border-radius: 6px; cursor: pointer; color: var(--text); white-space: nowrap; }
.pbar button:hover { background: var(--head); }
.pbar button.on { background: #f6e4db; color: #a64b2a; }
.pbar button svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.pbar .zoom { min-width: 46px; text-align: center; font-variant-numeric: tabular-nums; color: var(--muted); align-self: center; }
.pbar .info { margin-left: auto; color: var(--muted); white-space: nowrap; }
.pbar { scrollbar-width: none; }
@media (max-width: 620px) { .pbar .tools span, .pbar .info { display: none; } .pbar button { padding: 4px 8px; } }
#vc { position: absolute; inset: 42px 0 0 0; overflow: auto; }
.pdfViewer { padding: 8px 0 40px; }
.pdfViewer .page { box-shadow: 0 1px 3px rgba(0,0,0,.1), 0 6px 20px rgba(0,0,0,.06); }
`;
const PDF_ICONS = {
  0: '<svg viewBox="0 0 20 20"><path d="M5 3l10 6-4.5 1.2L13 15.5l-2 1-2.5-5.3L5 14z"/></svg>',
  3: '<svg viewBox="0 0 20 20"><path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5"/></svg>',
  15: '<svg viewBox="0 0 20 20"><path d="M3 15c2-4 4-9 6-9s0 8 2 8 3-5 6-6"/></svg>',
  9: '<svg viewBox="0 0 20 20"><path d="M3 17h14M6 13l7-7 2.5 2.5-7 7H6z"/></svg>',
};
async function pdfPage(file, ed, base) {
  const tools = [[0, 'Seleccionar'], [3, 'Texto'], [15, 'Dibujar'], [9, 'Resaltar']];
  const body = `<div class="pbar">
<div class="grp tools">${tools.map(([m, t], i) => `<button type="button" data-m="${m}"${i ? '' : ' class="on"'} title="${t}">${PDF_ICONS[m]}<span>${t}</span></button>`).join('')}</div>
<div class="grp"><button type="button" data-z="-" title="Alejar">−</button><span class="zoom"></span><button type="button" data-z="+" title="Acercar">+</button></div>
<span class="info"></span></div>
<div id="vc"><div id="viewer" class="pdfViewer"></div></div>`;
  const script = `${editScript(ed)}
const B = ${JSON.stringify(base)};
const vc = document.getElementById('vc');
const info = document.querySelector('.pbar .info');
const zoom = document.querySelector('.pbar .zoom');
const POS = 'pdf:' + location.pathname;
let doc = null, viewer = null, lib = null;
try {
  lib = await import(B + 'build/pdf.mjs');
  const { PDFViewer, EventBus, PDFLinkService } = await import(B + 'web/pdf_viewer.mjs');
  lib.GlobalWorkerOptions.workerSrc = B + 'build/pdf.worker.mjs';
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  viewer = new PDFViewer({ container: vc, viewer: document.getElementById('viewer'), eventBus, linkService, annotationMode: lib.AnnotationMode.ENABLE_FORMS, annotationEditorMode: lib.AnnotationEditorType.NONE });
  linkService.setViewer(viewer);
  doc = await lib.getDocument({ url: location.pathname, cMapUrl: B + 'cmaps/', cMapPacked: true, standardFontDataUrl: B + 'standard_fonts/', wasmUrl: B + 'wasm/', iccUrl: B + 'iccs/', isEvalSupported: false, enableXfa: false }).promise;
  viewer.setDocument(doc);
  linkService.setDocument(doc);
  info.textContent = doc.numPages === 1 ? '1 página' : doc.numPages + ' páginas';
  eventBus.on('pagesinit', () => {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(POS) || 'null'); } catch {}
    viewer.currentScaleValue = p?.s || 'page-width';
    if (p) { vc.scrollTop = p.y; vc.scrollLeft = p.x; }
    // Sin permiso para cambiarlo (PDF protegido): solo se ve. El editor existe ya en este punto
    if (viewer.annotationEditorMode === lib.AnnotationEditorType.DISABLE) document.querySelector('.tools').hidden = true;
  });
  eventBus.on('scalechanging', ({ scale }) => { zoom.textContent = Math.round(scale * 100) + ' %'; });
  eventBus.on('annotationeditormodechanged', ({ mode }) => {
    document.querySelectorAll('.tools button').forEach((b) => b.classList.toggle('on', +b.dataset.m === (mode > 0 ? mode : 0)));
  });
  doc.annotationStorage.onSetModified = () => setDirty(true);
  addEventListener('pagehide', () => { try { sessionStorage.setItem(POS, JSON.stringify({ s: viewer.currentScaleValue, x: vc.scrollLeft, y: vc.scrollTop })); } catch {} });
} catch (e) {
  document.getElementById('viewer').innerHTML = '<p class="note"></p>';
  document.querySelector('#viewer .note').textContent = 'No se ha podido abrir el PDF: ' + (e?.message || e);
}
document.querySelector('.pbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !viewer) return;
  if (b.dataset.z) { if (b.dataset.z === '+') viewer.increaseScale(); else viewer.decreaseScale(); return; }
  try { viewer.annotationEditorMode = { mode: +b.dataset.m }; } catch { document.querySelector('.tools').hidden = true; }
});
document.addEventListener('keydown', (e) => {
  if (!viewer || !(e.ctrlKey || e.metaKey)) return;
  if (e.key === '+' || e.key === '=') { e.preventDefault(); viewer.increaseScale(); }
  else if (e.key === '-') { e.preventDefault(); viewer.decreaseScale(); }
  else if (e.key === '0') { e.preventDefault(); viewer.currentScaleValue = 'page-width'; }
});
fmt.collect = async () => ({ type: 'application/pdf', body: await doc.saveDocument() });
fmt.saved = () => doc.annotationStorage.resetModified();`;
  return page(path.basename(file), body, { css: PDF_CSS, script, nonce: nonceOf(), pdf: true, edit: true, head: `<link rel="stylesheet" href="${base}web/pdf_viewer.css">` });
}

async function convert(file, ed) {
  const ext = extOf(file);
  if (ext === 'docx') return docxPage(file, ed);
  if (ext === 'md' || ext === 'markdown') return markdownPage(file);
  if (ext === 'pptx') return pptxPage(file);
  return sheetPage(file, ed);
}

// Lo que pdf.js necesita de su paquete (nada más de node_modules)
const PDFJS_DIRS = new Set(['build', 'web', 'cmaps', 'standard_fonts', 'wasm', 'iccs']);
const PDFJS_MIME = { mjs: 'text/javascript', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', bcmap: 'application/octet-stream', pfb: 'application/octet-stream', ttf: 'font/ttf', wasm: 'application/wasm', icc: 'application/octet-stream', json: 'application/json' };
const MAX_SAVE = 300 * 1024 * 1024;
const BUSY = '¿Está abierto en otra aplicación (Word, Excel…)? Ciérralo y vuelve a guardar.';
const TEXT_EDIT = new Set(['md', 'markdown', 'html', 'htm', 'svg']);
// Escritura atómica: un archivo temporal en la misma carpeta y se renombra encima (sin dejarlo a medias)
function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.~${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    throw e;
  }
}

export function createDocView({ log = () => {} } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const secret = crypto.randomBytes(32);
  const roots = new Map(); // id -> carpeta raíz
  const rootIds = new Map(); // carpeta -> id
  const ports = { raw: 0, edit: 0 };
  // Clave para guardar un archivo: solo la llevan las vistas que se le sirven
  const keyFor = (f) => crypto.createHmac('sha256', secret).update(IS_WIN ? f.toLowerCase() : f).digest('hex');
  const keyOk = (f, k) => {
    const a = Buffer.from(keyFor(f));
    const b = Buffer.from(String(k || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  };
  const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on('data', (c) => {
        n += c.length;
        if (n > MAX_SAVE) { reject(new Error('Demasiado grande para guardarlo desde aquí')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  async function save(req, res, file) {
    const ext = extOf(file);
    if (!keyOk(file, req.headers['x-clave'])) return json(res, 403, { error: 'Sin permiso para guardar' });
    try {
      const body = await readBody(req);
      const st = fs.statSync(file);
      if (String(Math.floor(st.mtimeMs)) !== String(req.headers['x-version'])) return json(res, 409, { error: 'El archivo ha cambiado mientras lo editabas. Descarta para ver la versión nueva.' });
      let out;
      if (ext === 'pdf') {
        if (body.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('El PDF guardado no es válido');
        out = body;
      } else {
        const data = JSON.parse(body.toString('utf8'));
        if (ext === 'docx') out = await patchDocx(fs.readFileSync(file), data.parrafos || []);
        else if (ext === 'xlsx' || ext === 'xlsm') out = await patchXlsx(fs.readFileSync(file), data.hojas || {});
        else {
          const text = fs.readFileSync(file, 'utf8');
          const plain = text.replace(/^﻿/, '');
          const cells = Object.values(data.hojas || {})[0] || {};
          out = Buffer.from(patchCsv(text, cells, ext === 'tsv' ? '\t' : sniffCsv(plain)), 'utf8');
        }
      }
      writeAtomic(file, out);
      json(res, 200, { ok: true, ver: Math.floor(fs.statSync(file).mtimeMs) });
    } catch (e) {
      if (!/No encuentro|matricial|encabezado|no es válido|Demasiado/.test(e.message)) log(e);
      json(res, e.code === 'ENOENT' ? 404 : 500, { error: /^(EBUSY|EPERM|EACCES)$/.test(e.code) ? BUSY : e.message });
    }
  }

  function servePdfjs(res, rel, fail) {
    const parts = rel.split('/');
    if (!PDFJS || !PDFJS_DIRS.has(parts[0]) || parts.some((p) => !p || p === '..' || p === '.')) return fail(404, 'No');
    const file = path.join(PDFJS, ...parts);
    let st;
    try { st = fs.statSync(file); } catch { return fail(404, 'No'); }
    if (!st.isFile()) return fail(404, 'No');
    res.writeHead(200, { 'content-type': `${PDFJS_MIME[extOf(file)] || 'application/octet-stream'}${/^(m?js|css|json|svg)$/.test(extOf(file)) ? '; charset=utf-8' : ''}`, 'content-length': st.size, 'cache-control': 'max-age=3600' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  // edit: el origen de las vistas (convierte, guarda y sirve pdf.js); el otro, el archivo tal cual
  function serve(req, res, edit) {
    const fail = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/');
    if (parts[1] !== token) return fail(403, 'No');
    if (edit && parts[2] === '_pdfjs') return servePdfjs(res, parts.slice(3).join('/'), fail);
    if (!roots.has(parts[2])) return fail(403, 'No');
    const root = roots.get(parts[2]);
    let file;
    try { file = path.resolve(root, decodeURIComponent(parts.slice(3).join('/'))); } catch { return fail(400, 'Ruta no válida'); }
    if (!inside(root, file)) return fail(403, 'Fuera de la carpeta');
    // Un HTML o SVG con scripts puede pedir otros archivos de su raíz: nunca los ocultos (.ssh, .claude con
    // las credenciales, .env, .git…) ni, desde la carpeta personal, AppData
    const rel = path.relative(root, file).split(path.sep);
    if (rel.some((s) => s.startsWith('.')) || (same(root, HOME) && /^appdata$/i.test(rel[0]))) return fail(403, 'Archivo protegido');
    const ext = extOf(file);
    if (req.method === 'POST') {
      if (!edit || !url.searchParams.has('guardar') || !EDITABLE.has(ext)) return fail(405, 'No');
      save(req, res, file);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'No');
    let st;
    try { st = fs.statSync(file); } catch { return fail(404, 'No existe (¿se ha movido o borrado?)'); }
    if (!st.isFile()) return fail(404, 'No es un archivo');
    const headers = { 'cache-control': 'no-store' };
    const html = (p) => p.then((out) => {
      res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      res.end(out);
    }, (err) => {
      log(err);
      res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Error', `<p class="note">No se ha podido leer ${esc(path.basename(file))}: ${esc(err.message)}<br>Si se está escribiendo ahora mismo, se volverá a intentar al terminar.</p>`));
    });
    if (edit && url.searchParams.has('ver')) {
      const ed = EDITABLE.has(ext) ? { key: keyFor(file), ver: Math.floor(st.mtimeMs) } : null;
      if (CONVERT.has(ext)) return html(convert(file, ed));
      if (ext === 'pdf' && PDFJS) return html(pdfPage(file, ed, `/${token}/_pdfjs/`));
    }
    // El origen de las vistas no sirve nada que lleve scripts (HTML, SVG): leería la clave de al lado
    if (edit && !PLAIN.has(ext)) return fail(403, 'No');
    res.writeHead(200, { ...headers, 'content-type': `${MIME[ext] || 'application/octet-stream'}${/^(html?|css|js|mjs|json|txt|svg)$/.test(ext) ? '; charset=utf-8' : ''}`, 'content-length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const servers = { raw: http.createServer((q, s) => serve(q, s, false)), edit: http.createServer((q, s) => serve(q, s, true)) };
  const ready = Promise.all(Object.entries(servers).map(([k, srv]) => new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => { ports[k] = srv.address().port; resolve(); });
  })));

  // Dirección del archivo en el servidor. La raíz es la carpeta de trabajo si está dentro (así el HTML
  // encuentra ../css y compañía); si no, su propia carpeta
  async function urlFor(file, cwd) {
    await ready;
    const abs = path.resolve(file);
    // La carpeta personal o la raíz del disco, nunca como raíz si no hace falta (expondrían demasiado)
    const base = cwd && path.resolve(cwd);
    const root = base && inside(base, abs) && base !== path.parse(abs).root && !same(base, HOME) ? base : path.dirname(abs);
    const key = IS_WIN ? root.toLowerCase() : root;
    let id = rootIds.get(key);
    if (!id) {
      id = crypto.randomBytes(6).toString('hex');
      rootIds.set(key, id);
      roots.set(id, root);
    }
    const rel = path.relative(root, abs).split(path.sep).map(encodeURIComponent).join('/');
    const ext = extOf(abs);
    const view = CONVERT.has(ext) || (ext === 'pdf' && PDFJS);
    return `http://127.0.0.1:${view ? ports.edit : ports.raw}/${token}/${id}/${rel}${view ? '?ver' : ''}`;
  }

  // Vigilar un archivo (su carpeta: los programas suelen reemplazarlo en vez de escribir encima).
  // Para HTML, cualquier cambio de la carpeta (sus CSS, JS, imágenes)
  function watch(file, onChange) {
    const abs = path.resolve(file);
    const dir = path.dirname(abs);
    const base = path.basename(abs);
    const any = /^html?$/.test(extOf(abs));
    let timer = null;
    let w;
    try {
      w = fs.watch(dir, (_ev, name) => {
        if (!any && name && name !== base) return;
        clearTimeout(timer);
        timer = setTimeout(() => { if (fs.existsSync(abs)) onChange(); }, 350);
      });
      w.on('error', () => {});
    } catch (e) { log(e); return () => {}; }
    return () => { clearTimeout(timer); try { w.close(); } catch {} };
  }

  // Documentos de texto (Markdown, HTML, SVG): la pestaña Código del panel los edita
  function readText(file) {
    if (!TEXT_EDIT.has(extOf(file))) return { error: 'No se edita como texto' };
    try {
      const st = fs.statSync(file);
      if (st.size > 5 * 1024 * 1024) return { error: 'Demasiado grande para editarlo aquí' };
      return { text: fs.readFileSync(file, 'utf8'), ver: Math.floor(st.mtimeMs) };
    } catch (e) { return { error: e.code === 'ENOENT' ? 'No existe (¿se ha movido o borrado?)' : e.message }; }
  }
  function saveText(file, text, ver) {
    if (!TEXT_EDIT.has(extOf(file)) || typeof text !== 'string') return { error: 'No se edita como texto' };
    try {
      if (Math.floor(fs.statSync(file).mtimeMs) !== ver) return { error: 'El archivo ha cambiado mientras lo editabas. Descarta para ver la versión nueva.' };
      writeAtomic(file, Buffer.from(text, 'utf8'));
      return { ok: true, ver: Math.floor(fs.statSync(file).mtimeMs) };
    } catch (e) {
      if (!/^(EBUSY|EPERM|EACCES|ENOENT)$/.test(e.code)) log(e);
      return { error: /^(EBUSY|EPERM|EACCES)$/.test(e.code) ? BUSY : e.message };
    }
  }

  return { urlFor, watch, readText, saveText, close: () => { servers.raw.close(); servers.edit.close(); } };
}
