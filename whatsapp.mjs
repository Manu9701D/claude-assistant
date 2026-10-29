// WhatsApp en segundo plano: WhatsApp Web dentro de una ventana propia de la app (oculta, o en la
// segunda pantalla sin activarse) que Claude maneja por dentro con herramientas MCP. Escribe y
// hace clic a través de CDP, sin pasar por el ratón ni el teclado de Windows, así que no te quita el
// foco. La sesión se guarda (partición persistente): el QR se escanea una sola vez.
import { app, BrowserWindow, screen } from 'electron';
import { createHttpMcp } from './mcp-http.mjs';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'https://web.whatsapp.com/';
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (name, description, shape, run) => ({ name, description, shape, run });

export function createWhatsApp({ icon, getConfig }) {
  let win = null;
  let loaded = null;
  let queue = Promise.resolve(); // una acción cada vez: comparten la misma ventana
  let quitting = false;
  app.on('before-quit', () => { quitting = true; });

  function open() {
    if (win && !win.isDestroyed()) return loaded;
    win = new BrowserWindow({
      width: 1200, height: 860, show: false, icon, title: 'WhatsApp · Claude',
      autoHideMenuBar: true, backgroundColor: '#111b21',
      webPreferences: { partition: 'persist:whatsapp', backgroundThrottling: false, contextIsolation: true, sandbox: true },
    });
    win.webContents.setUserAgent(UA);
    win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } }); // cerrarla solo la oculta: la sesión sigue viva
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    loaded = new Promise((res) => win.webContents.once('did-finish-load', res));
    win.loadURL(URL, { userAgent: UA });
    try {
      win.webContents.debugger.attach('1.3');
      // La página cree que tiene el foco aunque la ventana esté detrás u oculta
      win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch {}
    return loaded;
  }

  // Segunda pantalla si la hay, sin activar la ventana
  function placeSecond() {
    const primary = screen.getPrimaryDisplay();
    const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
    const wa = (other || primary).workArea;
    const w = Math.min(1200, wa.width - 40), h = Math.min(900, wa.height - 40);
    win.setBounds({ x: wa.x + Math.round((wa.width - w) / 2), y: wa.y + Math.round((wa.height - h) / 2), width: w, height: h });
  }
  function reveal() {
    if (getConfig().whatsappView === 'hidden' || win.isVisible()) return;
    placeSecond();
    win.showInactive();
  }
  // Para vincular el móvil: a la vista y delante, que hay que escanear el QR
  // Si era para vincular, en cuanto se vincula vuelve a ocultarse (en modo oculto)
  async function showForLogin() {
    await open();
    const linked = (await waitReady(8000)) === 'ready';
    if (!win.isVisible()) placeSecond();
    win.show();
    win.focus();
    if (linked) return;
    const t = setInterval(async () => {
      if (!win || win.isDestroyed() || !win.isVisible()) return clearInterval(t);
      if ((await state().catch(() => '')) !== 'ready') return;
      clearInterval(t);
      if (getConfig().whatsappView !== 'second') setTimeout(() => win.hide(), 2500);
    }, 1500);
  }

  const cdp = (method, params) => win.webContents.debugger.sendCommand(method, params);
  const js = (code) => win.webContents.executeJavaScript(code, true);

  async function state() {
    return js(`(() => {
      if (document.querySelector('#pane-side')) return 'ready';
      if (document.querySelector('canvas[aria-label], [data-ref] canvas, div[data-ref]')) return 'qr';
      return 'loading';
    })()`);
  }
  async function waitReady(ms = 25000) {
    const end = Date.now() + ms;
    let s;
    while (Date.now() < end) {
      s = await state().catch(() => 'loading');
      if (s === 'ready' || s === 'qr') return s;
      await sleep(500);
    }
    return s;
  }

  // Clic de verdad (eventos de ratón) en un punto de la página, sin mover tu ratón
  async function clickAt({ x, y }) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }
  async function click(selector) {
    const r = await js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
      const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!r) throw new Error(`No encuentro ${selector} en WhatsApp Web.`);
    await clickAt(r);
  }
  // keyDown con texto: así le llega a WhatsApp como una pulsación real (rawKeyDown no envía)
  async function key(k, code, vk, modifiers = 0, txt = '') {
    await cdp('Input.dispatchKeyEvent', { type: txt ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers, text: txt, unmodifiedText: txt });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  }
  const enter = (modifiers = 0) => key('Enter', 'Enter', 13, modifiers, '\r');
  async function typeText(text) {
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i) await key('Enter', 'Enter', 13, 8); // Shift+Enter: salto de línea sin enviar
      if (lines[i]) await cdp('Input.insertText', { text: lines[i] });
    }
  }
  async function clearFocused() {
    await key('a', 'KeyA', 65, 2); // Ctrl+A
    await key('Backspace', 'Backspace', 8);
  }

  const SEARCH = '#side input[type="text"], #side div[contenteditable="true"][role="textbox"]';
  const COMPOSER = '#main footer [contenteditable="true"]';
  const ROWS = '#pane-side [role="row"], #pane-side [role="listitem"]';
  // Expresiones que devuelven el elemento (se evalúan en la página)
  const SEARCH_EL = `document.querySelector('#side input[type="text"], #side div[contenteditable="true"][role="textbox"]')`;
  const COMPOSER_EL = `document.querySelector('#main footer [contenteditable="true"]')`;
  const CAPTION_EL = `[...document.querySelectorAll('[contenteditable="true"]')].find((e) => !e.closest('#main footer') && !e.closest('#side'))`;
  const PREVIEW_SEND_EL = `[...document.querySelectorAll('[data-icon*="send"], [aria-label^="Enviar"]')].find((e) => !e.closest('#main footer') && e.getBoundingClientRect().width > 0)`;

  // Pone el cursor en el elemento y lo comprueba; si no lo consigue, no se escribe nada en otro sitio
  async function focusEl(expr, what) {
    const pt = await js(`(() => { const el = ${expr}; if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    if (!pt) throw new Error(`No encuentro ${what} en WhatsApp Web. No he escrito nada.`);
    await clickAt(pt);
    const ok = await js(`(() => { const el = ${expr}; if (!el) return false; if (!el.contains(document.activeElement)) el.focus(); return el.contains(document.activeElement); })()`);
    if (!ok) throw new Error(`No he podido poner el cursor en ${what}. No he escrito nada.`);
  }

  const SEND_BTN = '#main footer [data-icon*="send"], #main footer [aria-label^="Enviar"]';

  // Para comparar nombres: sin «(Tú)», sin tildes ni mayúsculas; los teléfonos, solo sus cifras
  const norm = (s) => String(s).replace(/\(t[uú]\)/i, '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const digits = (s) => String(s).replace(/\D/g, '');
  const isPhone = (s) => /^[+\d\s().-]+$/.test(String(s).replace(/\(t[uú]\)/i, '').trim()) && digits(s).length >= 8;
  function same(a, b) {
    if (isPhone(a) || isPhone(b)) {
      const x = digits(a), y = digits(b);
      return x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x));
    }
    return norm(a) === norm(b);
  }

  const titles = () => js(`[...document.querySelectorAll(${JSON.stringify(ROWS)})].map((r) => r.querySelector('span[title]')?.getAttribute('title')).filter(Boolean)`);

  async function searchChats(query) {
    await focusEl(SEARCH_EL, 'el buscador');
    await clearFocused();
    await typeText(query);
    // Los resultados llegan poco a poco: se espera a que la lista deje de cambiar
    let prev = '', list = [];
    for (let i = 0; i < 16; i++) {
      await sleep(350);
      list = await titles();
      const sig = list.join('|');
      if (i >= 2 && sig === prev) break;
      prev = sig;
    }
    return [...new Set(list)].slice(0, 15);
  }

  // Nombre del chat abierto (el span[title] de la cabecera es el subtítulo, no el nombre)
  const headerName = () => js(`(document.querySelector('#main header [data-testid="conversation-info-header-chat-title"]') || document.querySelector('#main header span[dir="auto"]'))?.textContent.trim() || ''`);

  // Abre el chat y comprueba que es el que se pidió; si no, error y no se toca nada
  async function openChat(name) {
    const results = await searchChats(name);
    const matches = results.filter((r) => same(r, name));
    let pick = matches.length === 1 ? matches[0] : null;
    if (!pick && !matches.length && results.length === 1 && !isPhone(name)) pick = results[0];
    if (!pick && !matches.length && isPhone(name)) {
      // Un número que no está en tus chats: el enlace oficial abre el chat con ese número
      await win.webContents.loadURL(`${URL}send?phone=${digits(name)}`, { userAgent: UA });
      await waitReady(30000);
    } else if (!pick) {
      throw new Error(matches.length > 1 || results.length > 1
        ? `Hay varios chats que pueden ser «${name}»: ${results.join(' · ')}. Repite con el nombre exacto. No he hecho nada.`
        : `No encuentro ningún chat que coincida con «${name}». No he hecho nada.`);
    } else {
      // Se busca la fila por su nombre justo al hacer clic (la lista se redibuja y los índices cambian)
      const pt = await js(`(() => { const t = [...document.querySelectorAll(${JSON.stringify(ROWS.split(', ').map((r) => r + ' span[title]').join(', '))})].find((s) => s.getAttribute('title') === ${JSON.stringify(pick)});
        if (!t) return null; const b = t.closest('[role="row"], [role="listitem"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!pt) throw new Error(`No he podido abrir «${pick}». No he hecho nada.`);
      await clickAt(pt);
    }
    let header = '';
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      header = await headerName();
      if (header && (await js(`!!document.querySelector('#main footer')`))) break;
    }
    const ok = header && (same(header, pick || name) || (!pick && isPhone(name)));
    if (!ok) throw new Error(`Se ha abierto «${header || '¿?'}» en vez de «${pick || name}». No he escrito nada.`);
    return header;
  }

  // Datos de una fila de mensaje. WhatsApp marca los tuyos con la etiqueta «Tú:» y su estado
  // (Enviado, Entregado, Leído); los de otros, en grupos, con «Nombre:».
  const ROW_INFO = `const info = (r) => {
      const labels = [...r.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label').trim());
      const out = (r.querySelector('[data-id]')?.getAttribute('data-id') || '').startsWith('true_') || !!r.querySelector('.message-out')
        || labels.some((l) => /^(Tú:|Leído|Entregado|Enviado|Pendiente)/.test(l));
      const who = (labels.find((l) => /:$/.test(l)) || '').slice(0, -1);
      const txt = (e) => { const c = e.cloneNode(true); c.querySelectorAll('img[alt]').forEach((i) => i.replaceWith(i.alt)); c.querySelectorAll('br').forEach((b) => b.replaceWith('\\n')); return c.textContent; };
      const text = [...r.querySelectorAll('.selectable-text')].filter((e) => !e.parentElement.closest('.selectable-text')).map(txt).join(' ').trim();
      const media = !!r.querySelector('img:not(.emoji), video, [data-icon*="document"], [data-icon*="audio"], [data-icon*="ptt"]');
      const time = r.querySelector('[data-testid="msg-meta"]')?.innerText.trim() || '';
      return { out, who, text: text || (media ? '(foto, vídeo o archivo)' : ''), time };
    };`;

  const composerText = () => js(`(document.querySelector(${JSON.stringify(COMPOSER)})?.innerText || '').trim()`);

  async function sendMessage(chat, message) {
    const name = await openChat(chat);
    const ok = await writeAndSend(name, message);
    return text(ok ? `Enviado a «${name}».` : `He pulsado enviar en «${name}», pero no he podido confirmar que el mensaje aparezca en el chat.`);
  }

  // Escribe en la caja del chat abierto y envía; true si el mensaje aparece en el chat
  async function writeAndSend(name, message) {
    if (!(await js(`!!document.querySelector(${JSON.stringify(COMPOSER)})`))) throw new Error(`En «${name}» no se puede escribir. No he enviado nada.`);
    await focusEl(COMPOSER_EL, 'la caja de mensaje');
    await clearFocused();
    await typeText(message);
    await sleep(250);
    await enter();
    for (let i = 0; i < 12 && (await composerText()); i++) {
      await sleep(250);
      if (i === 4) await click(SEND_BTN).catch(() => {}); // si Enter no ha bastado, el botón de enviar
    }
    if (await composerText()) {
      await focusEl(COMPOSER_EL, 'la caja de mensaje').catch(() => {});
      await clearFocused(); // nunca dejar un borrador a medias
      throw new Error(`No he podido enviar el mensaje a «${name}». Lo he borrado de la caja: no queda ningún borrador.`);
    }
    // Comprobación: el último mensaje del chat es del usuario y contiene el texto
    await sleep(700);
    const last = await js(`(() => { ${ROW_INFO} const r = [...document.querySelectorAll('#main [role="row"]')].at(-1); return r ? info(r) : null; })()`);
    const plain = (t) => t.normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
    return !!last?.out && plain(last.text).includes(plain(message.split('\n')[0]).slice(0, 30));
  }

  async function readMessages(limit) {
    const rows = await js(`(() => { ${ROW_INFO} return [...document.querySelectorAll('#main [role="row"]')].map(info).filter((m) => m.text); })()`);
    return rows.slice(-limit).map((m) => `${m.time ? `[${m.time}] ` : ''}${m.out ? 'Tú' : m.who || 'Otro'}: ${m.text}`).join('\n');
  }

  // Cada herramienta: abre la ventana, comprueba la sesión y hace su trabajo de una en una
  function run(fn) {
    const job = queue.then(async () => {
      await open();
      reveal();
      const s = await waitReady();
      if (s === 'qr') {
        await showForLogin();
        return text('WhatsApp no está vinculado todavía. Le he abierto al usuario la ventana con el código QR: tiene que escanearlo desde el móvil (WhatsApp › Dispositivos vinculados › Vincular un dispositivo). Pídeselo y vuelve a intentarlo cuando te diga que ya está.');
      }
      if (s !== 'ready') return text('WhatsApp Web no ha terminado de cargar. Vuelve a intentarlo en unos segundos.');
      return fn();
    });
    queue = job.catch(() => {});
    return job.catch((e) => text(e.message || String(e)));
  }
  const text = (t) => ({ content: [{ type: 'text', text: t }] });

  // Servidor MCP por HTTP para las pestañas (se crea la primera vez que hace falta)
  let mcp = null;
  function mcpConfig() {
    mcp ??= createHttpMcp({
      name: 'whatsapp',
      version: '1.0.0',
      instructions: [
        'WhatsApp del usuario en segundo plano, a través de WhatsApp Web oculto dentro de Claude Assistant. Para CUALQUIER cosa de WhatsApp (buscar, leer, enviar mensajes o archivos) usa solo estas herramientas whatsapp_*.',
        'NUNCA uses para WhatsApp la aplicación de escritorio, el control de aplicaciones (windows-mcp o macos-mcp: Snapshot, Click, Type…), capturas de pantalla, la terminal ni enlaces whatsapp://: le quitan el foco al usuario y abren ventanas. Si una herramienta whatsapp_* falla, no busques otra vía: dile al usuario qué ha pasado, tal cual.',
        'Los chats se indican por su nombre exacto (el que devuelve whatsapp_search) o por número de teléfono (por ejemplo +34 600 000 000); el chat del propio usuario es su número. Si hay varios posibles, pregunta.',
      ].join(' '),
      tools: [
        tool('whatsapp_search', 'Busca chats o contactos de WhatsApp por nombre. Devuelve los nombres exactos.', { query: z.string() },
          ({ query }) => run(async () => {
            const r = await searchChats(query);
            return text(r.length ? r.join('\n') : 'Sin resultados.');
          })),
        tool('whatsapp_read', 'Lee los últimos mensajes de un chat de WhatsApp.', { chat: z.string().describe('Nombre del chat o contacto'), limit: z.number().int().min(1).max(60).default(20) },
          ({ chat, limit }) => run(async () => {
            const name = await openChat(chat);
            return text(`Chat: ${name}\n${await readMessages(limit) || '(sin mensajes visibles)'}`);
          })),
        tool('whatsapp_send', 'Envía un mensaje de texto por WhatsApp a un chat o contacto.', { chat: z.string().describe('Nombre del chat o contacto'), message: z.string() },
          ({ chat, message }) => run(() => sendMessage(chat, message))),
        tool('whatsapp_send_file', 'Envía una foto, vídeo o documento por WhatsApp, con un texto opcional.', { chat: z.string(), path: z.string().describe('Ruta absoluta del archivo'), caption: z.string().optional() },
          ({ chat, path: file, caption }) => run(async () => {
            if (!fs.existsSync(file)) return text(`No existe el archivo ${file}.`);
            const name = await openChat(chat);
            const media = /\.(jpe?g|png|gif|webp|mp4|mov|3gp)$/i.test(file);
            await click('#main footer [data-icon="plus"], #main footer [data-icon="plus-rounded"], #main footer button[title="Adjuntar"], #main footer [aria-label="Adjuntar"], #main footer [aria-label*="djunt"]');
            await sleep(500);
            const accept = media ? 'image' : '*';
            const { root } = await cdp('DOM.getDocument', { depth: -1, pierce: true });
            const inputs = (await cdp('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type="file"]' })).nodeIds;
            let target = null;
            for (const id of inputs) {
              const { attributes = [] } = await cdp('DOM.getAttributes', { nodeId: id });
              const acc = attributes[attributes.indexOf('accept') + 1] || '';
              if (attributes.includes('accept') ? (media ? acc.includes('image') : acc === '*' || !acc.includes('image')) : !media) { target = id; break; }
            }
            target ??= inputs[0];
            if (!target) throw new Error('No encuentro dónde adjuntar el archivo en WhatsApp Web.');
            await cdp('DOM.setFileInputFiles', { nodeId: target, files: [path.resolve(file)] });
            // Pantalla de vista previa: su caja para el texto y su botón de enviar (no los del chat)
            const before = await js(`document.querySelectorAll('#main [role="row"]').length`);
            for (let i = 0; i < 30 && !(await js(`!!(${PREVIEW_SEND_EL})`)); i++) await sleep(300);
            if (!(await js(`!!(${PREVIEW_SEND_EL})`))) throw new Error('WhatsApp Web no ha abierto la vista previa del archivo. No he enviado nada.');
            // Si la vista previa tiene caja para el texto, va con el archivo; si no, justo después
            let captionLater = false;
            if (caption) {
              if (await js(`!!(${CAPTION_EL})`)) { await focusEl(CAPTION_EL, 'la caja del texto de la foto'); await typeText(caption); await sleep(200); }
              else captionLater = true;
            }
            const pt = await js(`(() => { const b = (${PREVIEW_SEND_EL}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
            await clickAt(pt);
            // Espera a que se cierre la vista previa y aparezca el mensaje
            for (let i = 0; i < 40 && (await js(`!!(${PREVIEW_SEND_EL})`)); i++) await sleep(300);
            for (let i = 0; i < 20 && (await js(`document.querySelectorAll('#main [role="row"]').length`)) <= before; i++) await sleep(300);
            const last = await js(`(() => { ${ROW_INFO} const r = [...document.querySelectorAll('#main [role="row"]')].at(-1); return r ? info(r) : null; })()`);
            if (!last?.out) return text(`He pulsado enviar ${path.basename(file)} en «${name}», pero no he podido confirmar que aparezca en el chat.`);
            if (captionLater) {
              const ok = await writeAndSend(name, caption);
              return text(`Enviado ${path.basename(file)} a «${name}»${ok ? ' y, justo después, su texto en otro mensaje' : ', pero no he podido confirmar el envío del texto'}.`);
            }
            return text(`Enviado ${path.basename(file)} a «${name}»${caption ? ' con su texto' : ''}.`);
          })),
      ],
    });
    return mcp.config();
  }

  return { open, showForLogin, mcpConfig };
}
