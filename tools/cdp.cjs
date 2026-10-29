// Inspeccionar la app de pruebas por CDP. Por defecto, la ventana principal; con --overlay, la del
// asistente por voz; con --snip, la del recorte; con --whatsapp, la de WhatsApp en segundo plano;
// con --vista-previa, la de un bloque HTML del chat; con --secundaria, la primera ventana sacada arrastrando una pestaña. Con --mac, la app de pruebas
// del Mac (node tools/mac.cjs start), por un túnel SSH.
//   node tools/cdp.cjs eval "<expresión JS>"   ejecuta en la interfaz (admite promesas) y muestra el resultado
//   node tools/cdp.cjs shot [archivo.png]      captura de la ventana (por defecto, captura.png en %TEMP%)
//   node tools/cdp.cjs key "Meta+T"            pulsa esa combinación (Alt, Control, Meta, Shift + tecla)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { devtoolsPort } = require('./common.cjs');

const args = process.argv.slice(2);
const TARGETS = { '--overlay': 'overlay.html', '--snip': 'snip.html', '--whatsapp': 'web.whatsapp.com', '--vista-previa': 'data:text/html' };
const flag = args.find((a) => a in TARGETS);
const secondary = args.includes('--secundaria');
const mac = args.includes('--mac');
const [cmd, arg] = args.filter((a) => !(a in TARGETS) && a !== '--secundaria' && a !== '--mac');

// Túnel al puerto CDP de la app del Mac (9223, el de tools/mac.cjs) mientras dura la orden
async function macTunnel() {
  const local = 19223;
  const t = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-N', '-L', `${local}:127.0.0.1:9223`, process.env.CA_MAC || 'mac'], { stdio: 'ignore' });
  t.unref();
  process.on('exit', () => t.kill());
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${local}/json/version`); return local; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error('No llego a la app del Mac (node tools/mac.cjs start).');
}

// ¿Es una ventana secundaria? (las de pestañas arrastradas fuera cargan el mismo index.html)
async function isSecondary(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const r = await new Promise((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(m.data));
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: '!!state.secondary', returnByValue: true } }));
  });
  ws.close();
  return !!r.result?.result?.value;
}

(async () => {
  const port = mac ? await macTunnel() : devtoolsPort();
  if (!port) throw new Error('La app de pruebas no está abierta (node tools/dev.cjs start).');
  const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((p) => ['page', 'webview'].includes(p.type) && p.url.includes(TARGETS[flag] || 'index.html'));
  let page = pages[0];
  if (!flag && pages.length > 1) {
    page = null;
    for (const p of pages) if (await isSecondary(p) === secondary) { page = p; break; }
  } else if (secondary) page = null;
  if (!page) throw new Error(`No encuentro esa ventana (${flag || (secondary ? 'secundaria' : 'principal')}).`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
  const call = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });

  if (cmd === 'eval') {
    const r = (await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) { console.error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); process.exitCode = 1; }
    else console.log(JSON.stringify(r.result.value, null, 2) ?? String(r.result.description));
  } else if (cmd === 'shot') {
    const file = path.resolve(arg || path.join(os.tmpdir(), 'captura.png'));
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log(file);
  } else if (cmd === 'key') {
    // Pulsación real (no un evento sintético): «Meta+T», «Control+Shift+Tab», «Escape», «Control+º»
    const parts = arg.split('+');
    const key = parts.pop() || '+';
    const modifiers = parts.reduce((m, p) => m | ({ Alt: 1, Control: 2, Meta: 4, Shift: 8 }[p] || 0), 0);
    const named = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ' ': 32, F1: 112, F3: 114 };
    const code = named[key] ?? key.toUpperCase().charCodeAt(0);
    const text = key.length === 1 && !(modifiers & 6) ? (modifiers & 8 ? key.toUpperCase() : key) : key === 'Enter' ? '\r' : undefined;
    const base = { key: key.length === 1 && modifiers & 8 ? key.toUpperCase() : key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : /^[0-9]$/.test(key) ? `Digit${key}` : { 'º': 'Backquote', ',': 'Comma', '=': 'Equal', '-': 'Minus', '/': 'Slash', ' ': 'Space' }[key] || key, windowsVirtualKeyCode: code, modifiers };
    await call('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', text, ...base });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  } else {
    console.error('Uso: node tools/cdp.cjs eval "<js>" | shot [archivo.png] | key "<Meta+T>"');
    process.exitCode = 1;
  }
  ws.close();
})().catch((e) => { console.error(e.message || e); process.exit(1); });
