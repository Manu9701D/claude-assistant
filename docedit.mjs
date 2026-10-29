// Guardar lo que se edita en la vista previa (docview.mjs): cambios mínimos sobre el archivo original,
// sin pasar por un conversor que perdería el formato.
// - Word: solo el texto de los párrafos cambiados (los <w:t> de cada uno; formato, imágenes y lo demás, intacto).
// - Excel: solo las celdas cambiadas (con su estilo); Excel recalcula al abrir.
// - CSV/TSV: solo las filas cambiadas (las demás, tal cual).

const decodeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi, (m, e) => {
  const l = e.toLowerCase();
  if (l === 'lt') return '<'; if (l === 'gt') return '>'; if (l === 'amp') return '&'; if (l === 'quot') return '"'; if (l === 'apos') return "'";
  return String.fromCodePoint(l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10));
});
const encXml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const encAttr = (s) => encXml(s).replace(/"/g, '&quot;');
const attr = (attrs, name) => { const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs); return m ? decodeXml(m[1]) : null; };
const short = (s) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

// ---------- Word ----------
// Párrafos de document.xml en orden, con los trozos de texto (<w:t>) de cada uno. Un párrafo dentro de
// otro (cuadros de texto) es aparte: su texto no cuenta para el de fuera
export function docxParagraphs(xml) {
  const paras = [];
  const stack = [];
  const re = /<(\/?)(w:p|w:t)(?=[\s>/])([^>]*)>/g;
  let m;
  while ((m = re.exec(xml))) {
    const [tag, close, name, attrs] = m;
    const empty = attrs.endsWith('/');
    if (name === 'w:p') {
      if (close) { const p = stack.pop(); if (p) paras.push(p); } else if (!empty) stack.push({ segs: [], order: paras.length + stack.length });
      continue;
    }
    if (close || empty || !stack.length) continue;
    const end = xml.indexOf('</w:t>', re.lastIndex);
    if (end < 0) break;
    stack[stack.length - 1].segs.push({ open: m.index, openEnd: re.lastIndex, attrs, end, text: decodeXml(xml.slice(re.lastIndex, end)) });
    re.lastIndex = end + 6;
  }
  // En el orden en que empiezan (el de fuera antes que los de dentro), como los lee mammoth
  return paras.sort((a, b) => (a.segs[0]?.open ?? Infinity) - (b.segs[0]?.open ?? Infinity) || a.order - b.order)
    .map((p) => ({ segs: p.segs, text: p.segs.map((s) => s.text).join('') }));
}

// Cambios de un párrafo: lo común del principio y del final se queda; lo de en medio se cambia en los
// trozos que tocaba, y lo nuevo va en el trozo donde estaba el cursor (así hereda su formato)
function paraOps(p, next) {
  const old = p.text;
  if (old === next) return [];
  let a = 0;
  while (a < old.length && a < next.length && old[a] === next[a]) a++;
  let b = 0;
  while (b < old.length - a && b < next.length - a && old[old.length - 1 - b] === next[next.length - 1 - b]) b++;
  const ins = next.slice(a, next.length - b);
  const cut = old.length - b;
  let pos = 0;
  let host = -1;
  const spans = p.segs.map((s, i) => {
    const r = { s, start: pos, end: pos + s.text.length };
    pos = r.end;
    if (host < 0 && (a > 0 ? r.start < a && a <= r.end : true)) host = i;
    return r;
  });
  const ops = [];
  for (const [i, { s, start, end }] of spans.entries()) {
    const keepA = old.slice(start, Math.max(start, Math.min(end, a)));
    const keepB = old.slice(Math.min(end, Math.max(start, cut)), end);
    const text = keepA + (i === host ? ins : '') + keepB;
    if (text === s.text) continue;
    const space = /^\s|\s$|\s\s/.test(text) && !/xml:space=/.test(s.attrs) ? ' xml:space="preserve"' : '';
    ops.push({ from: s.open, to: s.end, text: `<w:t${s.attrs}${space}>${encXml(text)}` });
  }
  return ops;
}

// edits: [{ o: texto original, k: cuántos párrafos iguales hay antes, t: texto nuevo }]
export function patchDocxXml(xml, edits) {
  const paras = docxParagraphs(xml);
  const norm = (s) => s.replace(/\t/g, '');
  const ops = [];
  for (const e of edits) {
    const same = paras.filter((p) => norm(p.text) === norm(e.o));
    const p = same[e.k] || (same.length === 1 ? same[0] : null);
    if (!p) throw new Error(`No encuentro el párrafo «${short(e.o)}» en el documento`);
    if (!p.segs.length) throw new Error(`El párrafo «${short(e.o)}» no tiene texto que cambiar`);
    ops.push(...paraOps(p, e.t));
  }
  ops.sort((x, y) => y.from - x.from);
  for (const op of ops) xml = xml.slice(0, op.from) + op.text + xml.slice(op.to);
  return xml;
}

export async function patchDocx(buf, edits) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('No es un documento de Word');
  zip.file('word/document.xml', patchDocxXml(await f.async('string'), edits));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- Excel ----------
const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const splitAddr = (a) => { const m = /^\$?([A-Z]{1,3})\$?(\d+)$/.exec(String(a).toUpperCase()); return m ? { c: colNum(m[1]), r: +m[2] } : null; };
const inRange = (ref, { c, r }) => {
  const [s, e = s] = String(ref).split(':').map(splitAddr);
  return s && e && c >= s.c && c <= e.c && r >= s.r && r <= e.r;
};

// Lo que se escribe en una celda, como lo entiende Excel
export function cellXml(ref, raw, style) {
  const s = style ? ` s="${style}"` : '';
  const v = String(raw ?? '');
  if (v === '') return `<c r="${ref}"${s}/>`;
  if (v.startsWith('=') && v.length > 1) return `<c r="${ref}"${s}><f>${encXml(v.slice(1))}</f></c>`;
  const t = v.trim();
  const num = /^[-+]?(\d+([.,]\d*)?|[.,]\d+)(e[-+]?\d+)?%?$/i.test(t) ? parseFloat(t.replace(',', '.')) / (t.endsWith('%') ? 100 : 1) : NaN;
  if (Number.isFinite(num) && !/^0\d/.test(t)) return `<c r="${ref}"${s}><v>${num}</v></c>`;
  if (/^(true|false|verdadero|falso)$/i.test(t)) return `<c r="${ref}"${s} t="b"><v>${/^(true|verdadero)$/i.test(t) ? 1 : 0}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${encXml(v)}</t></is></c>`;
}

// cells: { A1: 'texto' | '12' | '=SUM(A1:A3)' | '' }. formulas: las fórmulas de la hoja ya expandidas
// (para deshacer una fórmula compartida si se cambia la celda que la define). headers: rangos de
// encabezados de tabla (no se tocan: Excel daría el archivo por dañado)
export function patchSheetXml(xml, cells, { formulas = {}, headers = [] } = {}) {
  const P = /<(\w+:)?worksheet[\s>]/.exec(xml)?.[1] || '';
  const tag = (n) => `${P}${n}`;
  const edits = Object.entries(cells).map(([ref, raw]) => ({ ref: ref.toUpperCase(), raw, ...splitAddr(ref) })).filter((e) => e.c);
  if (!edits.length) return xml;
  // Fórmulas matriciales: no se puede cambiar una celda suya
  for (const m of xml.matchAll(new RegExp(`<${tag('f')}\\b[^>]*\\bt="array"[^>]*\\bref="([^"]+)"`, 'g'))) {
    const hit = edits.find((e) => inRange(m[1], e));
    if (hit) throw new Error(`${hit.ref} forma parte de una fórmula matricial (${m[1]}): cámbiala en Excel`);
  }
  for (const h of headers) {
    const hit = edits.find((e) => inRange(h, e));
    if (hit) throw new Error(`${hit.ref} es el encabezado de una tabla: cámbialo en Excel`);
  }
  // Fórmulas compartidas cuya celda principal se cambia: las demás pasan a llevar la suya entera
  const unshare = new Set();
  const cellRe = new RegExp(`<${tag('c')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('c')}>)`, 'g');
  for (const m of xml.matchAll(cellRe)) {
    const ref = attr(m[1], 'r');
    const f = m[2] && new RegExp(`<${tag('f')}\\b([^>]*)`).exec(m[2]);
    if (ref && f && /\bt="shared"/.test(f[1]) && /\bref="/.test(f[1]) && edits.some((e) => e.ref === ref.toUpperCase())) unshare.add(attr(f[1], 'si'));
  }
  if (unshare.size) {
    xml = xml.replace(cellRe, (whole, attrs, inner) => {
      const ref = attr(attrs, 'r');
      if (!inner || !ref) return whole;
      const fm = new RegExp(`<${tag('f')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('f')}>)`).exec(inner);
      if (!fm || !/\bt="shared"/.test(fm[1]) || !unshare.has(attr(fm[1], 'si'))) return whole;
      const full = formulas[ref.toUpperCase()];
      if (!full) throw new Error(`No puedo deshacer la fórmula compartida de ${ref}`);
      return whole.replace(fm[0], `<${tag('f')}>${encXml(full)}</${tag('f')}>`);
    });
  }
  // sheetData: filas y celdas en orden; las que faltan se añaden en su sitio
  const sd = new RegExp(`<${tag('sheetData')}\\s*/>|<${tag('sheetData')}>([\\s\\S]*?)</${tag('sheetData')}>`).exec(xml);
  if (!sd) throw new Error('La hoja no tiene datos que cambiar');
  const rowRe = new RegExp(`<${tag('row')}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag('row')}>)`, 'g');
  const rows = [...(sd[1] || '').matchAll(rowRe)].map((m) => ({ r: +attr(m[1], 'r'), attrs: m[1], inner: m[2] || '', whole: m[0], dirty: false }));
  if (rows.some((r) => !r.r)) throw new Error('Esta hoja no se puede editar aquí (filas sin número)');
  const byRow = new Map(rows.map((r) => [r.r, r]));
  for (const e of edits) {
    let row = byRow.get(e.r);
    if (!row) { row = { r: e.r, attrs: ` r="${e.r}"`, inner: '', dirty: true }; byRow.set(e.r, row); rows.push(row); }
    row.dirty = true;
    const cells = [...row.inner.matchAll(cellRe)].map((m) => ({ attrs: m[1], whole: m[0], ref: (attr(m[1], 'r') || '').toUpperCase() }));
    if (cells.some((c) => !c.ref)) throw new Error('Esta hoja no se puede editar aquí (celdas sin referencia)');
    const i = cells.findIndex((c) => c.ref === e.ref);
    const old = cells[i];
    const next = { ref: e.ref, whole: cellXml(e.ref, e.raw, old ? attr(old.attrs, 's') : null).replace(/<(\/?)(c|f|v|is|t)\b/g, `<$1${P}$2`) };
    if (old) cells[i] = next;
    else { const at = cells.findIndex((c) => splitAddr(c.ref).c > e.c); cells.splice(at < 0 ? cells.length : at, 0, next); }
    row.inner = cells.map((c) => c.whole).join('');
  }
  rows.sort((a, b) => a.r - b.r);
  const body = rows.map((r) => (r.dirty ? `<${tag('row')}${r.attrs.replace(/\/$/, '').replace(/\s+spans="[^"]*"/, '')}>${r.inner}</${tag('row')}>` : r.whole)).join('');
  xml = xml.slice(0, sd.index) + `<${tag('sheetData')}>${body}</${tag('sheetData')}>` + xml.slice(sd.index + sd[0].length);
  // El rango usado, para que incluya lo nuevo
  xml = xml.replace(new RegExp(`(<${tag('dimension')}\\b[^>]*\\bref=")([^"]*)(")`), (m, a, ref, b) => {
    const [s, e = s] = ref.split(':').map(splitAddr);
    if (!s) return m;
    const lo = { c: Math.min(s.c, ...edits.map((x) => x.c)), r: Math.min(s.r, ...edits.map((x) => x.r)) };
    const hi = { c: Math.max(e.c, ...edits.map((x) => x.c)), r: Math.max(e.r, ...edits.map((x) => x.r)) };
    return `${a}${colName(lo.c)}${lo.r}:${colName(hi.c)}${hi.r}${b}`;
  });
  return xml;
}

const relTarget = (base, target) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
  return parts.join('/');
};
const relsOf = (part) => part.replace(/([^/]+)$/, '_rels/$1.rels');
const readRels = (xml) => [...(xml || '').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => ({ id: attr(m[1], 'Id'), type: attr(m[1], 'Type') || '', target: attr(m[1], 'Target') || '', whole: m[0] }));

// sheets: { 'Hoja1': { A1: '…' } }
export async function patchXlsx(buf, sheets) {
  const JSZip = (await import('jszip')).default;
  const XLSX = await import('xlsx');
  const zip = await JSZip.loadAsync(buf);
  const wbPart = 'xl/workbook.xml';
  let wbXml = await zip.file(wbPart)?.async('string');
  if (!wbXml) throw new Error('No es un libro de Excel');
  const wbRelsPart = relsOf(wbPart);
  let wbRels = await zip.file(wbRelsPart)?.async('string') || '';
  const rels = readRels(wbRels);
  const parsed = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellStyles: false, cellDates: false });
  for (const [name, cells] of Object.entries(sheets)) {
    const sh = [...wbXml.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)].find((m) => attr(m[1], 'name') === name);
    const rid = sh && /\br:id="([^"]+)"|\b\w+:id="([^"]+)"/.exec(sh[1]);
    const rel = rid && rels.find((r) => r.id === (rid[1] || rid[2]));
    if (!rel) throw new Error(`No encuentro la hoja «${name}»`);
    const part = relTarget(wbPart, rel.target);
    const xml = await zip.file(part)?.async('string');
    if (!xml) throw new Error(`No encuentro la hoja «${name}»`);
    const ws = parsed.Sheets[name] || {};
    const formulas = {};
    for (const k of Object.keys(ws)) if (k[0] !== '!' && ws[k]?.f) formulas[k] = ws[k].f;
    // Encabezados de sus tablas
    const headers = [];
    for (const r of readRels(await zip.file(relsOf(part))?.async('string'))) {
      if (!/\/table$/.test(r.type)) continue;
      const t = await zip.file(relTarget(part, r.target))?.async('string');
      const ref = t && /<(?:\w+:)?table\b[^>]*\bref="([^"]+)"/.exec(t)?.[1];
      if (!ref || /\bheaderRowCount="0"/.test(t)) continue;
      const [s, e = s] = ref.split(':');
      headers.push(`${s}:${e.replace(/\d+$/, '')}${s.replace(/^[A-Z]+/, '')}`);
    }
    zip.file(part, patchSheetXml(xml, cells, { formulas, headers }));
  }
  // Los resultados guardados ya no valen: fuera la cadena de cálculo y que Excel recalcule al abrir
  const chain = rels.find((r) => /calcChain\.xml$/i.test(r.target));
  if (chain) {
    zip.remove(relTarget(wbPart, chain.target));
    zip.file(wbRelsPart, wbRels.replace(chain.whole, ''));
    const ct = await zip.file('[Content_Types].xml')?.async('string');
    if (ct) zip.file('[Content_Types].xml', ct.replace(/<Override\b[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/i, ''));
  }
  if (/<(\w+:)?calcPr\b/.test(wbXml)) {
    wbXml = wbXml.replace(/<((?:\w+:)?calcPr)\b([^>]*?)(\/?)>/, (m, n, a, sl) => `<${n}${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${sl}>`);
  } else {
    const P = /<(\w+:)?workbook[\s>]/.exec(wbXml)?.[1] || '';
    const after = new RegExp(`<${P}(oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\\b|</${P}workbook>`).exec(wbXml);
    if (after) wbXml = `${wbXml.slice(0, after.index)}<${P}calcPr fullCalcOnLoad="1"/>${wbXml.slice(after.index)}`;
  }
  zip.file(wbPart, wbXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ---------- CSV / TSV ----------
// Registros con su texto original: los que no cambian se escriben tal cual
export function csvRecords(text, FS = ',') {
  const recs = [];
  let i = 0;
  while (i < text.length) {
    const start = i;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (;;) {
      if (i >= text.length) { cells.push(cell); break; }
      const ch = text[i];
      if (quoted) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i += 2; } else { quoted = false; i++; } } else { cell += ch; i++; }
      } else if (ch === '"' && cell === '') { quoted = true; i++; }
      else if (ch === FS) { cells.push(cell); cell = ''; i++; }
      else if (ch === '\r' || ch === '\n') { cells.push(cell); break; }
      else { cell += ch; i++; }
    }
    const end = i;
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    recs.push({ cells, raw: text.slice(start, end) });
  }
  return recs;
}

// El separador, como lo adivina SheetJS al leerlo (el que más sale fuera de comillas al principio)
export function sniffCsv(text) {
  const head = text.replace(/^﻿/, '').slice(0, 1024);
  const n = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let quoted = false;
  for (const ch of head) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in n) n[ch]++;
  }
  return Object.keys(n).reduce((a, b) => (n[b] > n[a] ? b : a), ',');
}

export function patchCsv(text, cells, FS = ',') {
  const bom = text.startsWith('﻿') ? '﻿' : '';
  const body = text.slice(bom.length);
  const eol = /\r\n/.test(body) ? '\r\n' : '\n';
  const trailing = /\r?\n$/.test(body);
  const recs = csvRecords(trailing ? body.replace(/\r?\n$/, '') : body, FS);
  const q = (v) => (/["\r\n]/.test(v) || v.includes(FS) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  for (const [ref, raw] of Object.entries(cells)) {
    const a = splitAddr(ref);
    if (!a) continue;
    while (recs.length < a.r) recs.push({ cells: [''], raw: '' });
    const rec = recs[a.r - 1];
    while (rec.cells.length < a.c) rec.cells.push('');
    rec.cells[a.c - 1] = String(raw ?? '');
    rec.raw = null;
  }
  return bom + recs.map((r) => (r.raw ?? r.cells.map(q).join(FS))).join(eol) + (trailing ? eol : '');
}
