// Vista previa de archivos en el panel lateral: un servidor HTTP solo para este equipo (127.0.0.1, con
// un token en la ruta) que el <webview> aislado del panel carga como una página local.
// - HTML, PDF, imágenes, SVG y texto: tal cual (el HTML con sus archivos de al lado, que se sirven
//   desde su carpeta raíz: la de trabajo de la pestaña o la suya).
// - Word, Excel/CSV/ODS, Markdown y PowerPoint: convertidos a una página legible (sin scripts salvo
//   los propios de la vista, con nonce).
// Cada archivo que se enseña se vigila y la interfaz recarga la vista al cambiar (watch).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const IS_WIN = process.platform === 'win32';
const MAX_ROWS = 3000;
const MAX_COLS = 200;
const MIME = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', bmp: 'image/bmp',
  pdf: 'application/pdf', txt: 'text/plain', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav',
};
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
.fx .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Cascadia Code", Consolas, ui-monospace, monospace; }
.fx .val i { color: var(--muted); font-style: normal; margin-right: 6px; }
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

function page(title, body, { css = '', script = '', nonce = '' } = {}) {
  const csp = `default-src 'none'; img-src data: blob: 'self'; style-src 'unsafe-inline'; font-src data: 'self'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${BASE_CSS}${css}</style></head>
<body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

// ---------- Conversores ----------
async function docxPage(file) {
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.convertToHtml({ path: file });
  return page(path.basename(file), `<article class="page">${value || '<p class="note">El documento está vacío.</p>'}</article>`);
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
function evaluator(XLSX, wb) {
  const memo = new Map();
  const ERR = { err: '#¡VALOR!' };
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
      if (cell.f && cell.v === undefined) {
        memo.set(key, ERR); // referencia circular
        v = depth > 50 ? ERR : calc(cell.f, sheet, depth + 1);
      } else v = cell.v instanceof Date ? cell.v.getTime() : cell.v ?? '';
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
        if (!fn) throw new Error(name);
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
    } catch { return ERR; }
  }
  return (sheet, addr) => cellValue(sheet, addr, 0);
}
const showValue = (v) => (v?.err ? v.err : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10)) : typeof v === 'boolean' ? (v ? 'VERDADERO' : 'FALSO') : String(v ?? ''));

// Hoja de cálculo como Excel: letras de columna, números de fila, celdas combinadas, pestañas de
// hojas y una barra que enseña la fórmula o el valor de la celda pulsada
async function sheetPage(file) {
  const XLSX = await import('xlsx');
  const ext = extOf(file);
  const opts = { cellFormula: true, cellStyles: true, cellDates: true, dense: false };
  const wb = ext === 'csv' || ext === 'tsv'
    ? XLSX.read(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''), { ...opts, type: 'string', FS: ext === 'tsv' ? '\t' : undefined })
    : XLSX.read(fs.readFileSync(file), { ...opts, type: 'buffer' });
  const value = evaluator(XLSX, wb);
  const sheets = wb.SheetNames.map((name, si) => {
    const ws = wb.Sheets[name];
    if (!ws?.['!ref']) return `<div class="sheet${si ? '' : ' on'}" data-s="${si}"><p class="more">Hoja vacía.</p></div>`;
    const r = XLSX.utils.decode_range(ws['!ref']);
    const lastR = Math.min(r.e.r, r.s.r + MAX_ROWS - 1);
    const lastC = Math.min(r.e.c, r.s.c + MAX_COLS - 1);
    // Celdas combinadas: la primera se extiende, las demás no se pintan
    const span = new Map();
    const hidden = new Set();
    for (const m of ws['!merges'] || []) {
      span.set(`${m.s.r},${m.s.c}`, [m.e.r - m.s.r + 1, m.e.c - m.s.c + 1]);
      for (let y = m.s.r; y <= m.e.r; y++) for (let x = m.s.c; x <= m.e.c; x++) if (y !== m.s.r || x !== m.s.c) hidden.add(`${y},${x}`);
    }
    const cols = ws['!cols'] || [];
    let html = '<table><thead><tr><th class="rn"></th>';
    for (let c = 0; c <= lastC; c++) {
      if (c < r.s.c) continue;
      const w = cols[c]?.wpx || (cols[c]?.wch ? cols[c].wch * 7 + 10 : 0);
      html += `<th${w ? ` style="min-width:${Math.min(w, 420)}px"` : ''}>${XLSX.utils.encode_col(c)}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (let y = r.s.r; y <= lastR; y++) {
      html += `<tr><td class="rn">${y + 1}</td>`;
      for (let x = r.s.c; x <= lastC; x++) {
        const key = `${y},${x}`;
        if (hidden.has(key)) continue;
        const addr = XLSX.utils.encode_cell({ r: y, c: x });
        const cell = ws[addr];
        const sp = span.get(key);
        const calc = cell?.f && cell.v === undefined ? value(name, addr) : undefined;
        const cls = [cell?.t === 'n' || cell?.t === 'd' || typeof calc === 'number' ? 'n' : '', cell?.s?.font?.bold || cell?.s?.bold ? 'b' : ''].filter(Boolean).join(' ');
        const fill = cell?.s?.fgColor?.rgb && cell.s.patternType === 'solid' ? ` style="background:#${String(cell.s.fgColor.rgb).slice(-6)}"` : '';
        const text = calc !== undefined ? showValue(calc) : cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString('es-ES') : cell.v ?? '')) : '';
        const raw = cell ? (cell.f ? `=${cell.f}` : String(cell.v ?? '')) : '';
        html += `<td data-a="${addr}"${raw ? ` data-v="${esc(raw)}"` : ''}${cls ? ` class="${cls}"` : ''}${fill}${sp ? ` rowspan="${sp[0]}" colspan="${sp[1]}"` : ''}>${esc(text)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (lastR < r.e.r || lastC < r.e.c) html += `<p class="more">Se enseñan ${lastR - r.s.r + 1} filas y ${lastC - r.s.c + 1} columnas de ${r.e.r - r.s.r + 1} × ${r.e.c - r.s.c + 1}: ábrelo para ver el resto.</p>`;
    return `<div class="sheet${si ? '' : ' on'}" data-s="${si}">${html}</div>`;
  });
  const tabs = wb.SheetNames.length > 1 ? `<nav class="tabs">${wb.SheetNames.map((n, i) => `<button data-s="${i}"${i ? '' : ' class="on"'}>${esc(n)}</button>`).join('')}</nav>` : '';
  const nonce = crypto.randomBytes(12).toString('base64');
  const script = `
const fx = document.querySelector('.fx'), addr = fx.querySelector('.addr'), val = fx.querySelector('.val');
let cur = null;
function pick(td) {
  if (cur) cur.classList.remove('cur');
  cur = td; td.classList.add('cur');
  addr.textContent = td.dataset.a;
  const v = td.dataset.v || '';
  val.innerHTML = '';
  if (v.startsWith('=')) { const i = document.createElement('i'); i.textContent = 'fx'; val.append(i); }
  val.append(v);
  val.title = v;
}
document.addEventListener('click', (e) => {
  const td = e.target.closest('td[data-a]'); if (td) pick(td);
  const b = e.target.closest('.tabs button'); if (!b) return;
  document.querySelectorAll('.tabs button, .sheet').forEach((x) => x.classList.toggle('on', x.dataset.s === b.dataset.s));
  sessionStorage.setItem('hoja', b.dataset.s);
});
document.addEventListener('keydown', (e) => {
  if (!cur || !/^Arrow/.test(e.key)) return;
  const tr = cur.parentElement, i = [...tr.children].indexOf(cur);
  const row = e.key === 'ArrowUp' ? tr.previousElementSibling : e.key === 'ArrowDown' ? tr.nextElementSibling : tr;
  const next = row?.children[e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : i];
  if (next?.dataset.a) { e.preventDefault(); pick(next); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
});
try { const s = sessionStorage.getItem('hoja'); const b = s && document.querySelector('.tabs button[data-s="' + s + '"]'); if (b) b.click(); } catch {}`;
  return page(path.basename(file), `<div class="fx"><span class="addr">—</span><span class="val"></span></div><div class="grid">${sheets.join('')}</div>${tabs}`, { css: SHEET_CSS, script, nonce });
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

async function convert(file) {
  const ext = extOf(file);
  if (ext === 'docx') return docxPage(file);
  if (ext === 'md' || ext === 'markdown') return markdownPage(file);
  if (ext === 'pptx') return pptxPage(file);
  return sheetPage(file);
}

export function createDocView({ log = () => {} } = {}) {
  const token = crypto.randomBytes(16).toString('hex');
  const roots = new Map(); // id -> carpeta raíz
  const rootIds = new Map(); // carpeta -> id
  let port = 0;
  function serve(req, res) {
    const fail = (code, text) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(text); };
    const url = new URL(req.url, 'http://x');
    const parts = url.pathname.split('/');
    if (parts[1] !== token || !roots.has(parts[2])) return fail(403, 'No');
    const root = roots.get(parts[2]);
    let file;
    try { file = path.resolve(root, decodeURIComponent(parts.slice(3).join('/'))); } catch { return fail(400, 'Ruta no válida'); }
    if (!inside(root, file)) return fail(403, 'Fuera de la carpeta');
    // Un HTML o SVG con scripts puede pedir otros archivos de su raíz: nunca los ocultos (.ssh, .claude con
    // las credenciales, .env, .git…) ni, desde la carpeta personal, AppData
    const rel = path.relative(root, file).split(path.sep);
    if (rel.some((s) => s.startsWith('.')) || (same(root, HOME) && /^appdata$/i.test(rel[0]))) return fail(403, 'Archivo protegido');
    let st;
    try { st = fs.statSync(file); } catch { return fail(404, 'No existe (¿se ha movido o borrado?)'); }
    if (!st.isFile()) return fail(404, 'No es un archivo');
    const ext = extOf(file);
    const headers = { 'cache-control': 'no-store' };
    // El archivo pedido como vista: convertido
    if (url.searchParams.has('ver') && CONVERT.has(ext)) {
      convert(file).then((html) => {
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
        res.end(html);
      }, (err) => {
        log(err);
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
        res.end(page('Error', `<p class="note">No se ha podido leer ${esc(path.basename(file))}: ${esc(err.message)}<br>Si se está escribiendo ahora mismo, se volverá a intentar al terminar.</p>`));
      });
      return;
    }
    res.writeHead(200, { ...headers, 'content-type': `${MIME[ext] || 'application/octet-stream'}${/^(html?|css|js|mjs|json|txt|svg)$/.test(ext) ? '; charset=utf-8' : ''}`, 'content-length': st.size });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
  const server = http.createServer(serve);
  const ready = new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
  });

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
    return `http://127.0.0.1:${port}/${token}/${id}/${rel}${CONVERT.has(extOf(abs)) ? '?ver' : ''}`;
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

  return { urlFor, watch, origin: () => `http://127.0.0.1:${port}`, close: () => server.close() };
}
