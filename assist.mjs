// Asistente por voz: un atajo global (aunque la ventana esté cerrada en la bandeja) muestra la
// chispa de Claude arriba a la izquierda con un bocadillo que va transcribiendo lo que dices y,
// al callarte, lo envía a una pestaña «de voz» que trabaja en segundo plano. La respuesta aparece
// en el mismo bocadillo. Interfaz: renderer/overlay.*
// Otro atajo, para pedir cosas de la pantalla, deja antes recortar una zona (como Win+Mayús+S)
// y la adjunta a lo que pidas. Interfaz: renderer/snip.*
import { app, BrowserWindow, desktopCapturer, screen, globalShortcut, ipcMain, shell, systemPreferences, nativeImage, Notification } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WIDTH = 460;          // ancho de la ventana flotante (incluye margen para la sombra)
const REUSE_MS = 55 * 60e3; // tras 55 min sin usarla se empieza una conversación nueva (la caché dura 1 h)
const MAX_EDGE = 1024;      // lado largo de la imagen enviada: se lee bien y cuesta ~2,5 veces menos que a 1568
const IS_MAC = process.platform === 'darwin';
// Linux con Wayland: ninguna aplicación puede ver la pantalla ni poner ventanas encima de todo por su cuenta.
// El recorte lo hace el del escritorio (portal Screenshot) y Esc no se registra como atajo global (el
// escritorio pediría permiso para «Escape»; Esc sigue funcionando en el bocadillo y en el recorte con el foco)
const WAYLAND = process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

// Portal Screenshot (xdg-desktop-portal) con su selector de zona. Con python3 y Gio, porque la respuesta
// llega como señal y con gdbus, al terminar su llamada, el portal cancelaría la petición.
// Salida: la URI del archivo; código 1 si se cancela, 2 si no hay portal
const PORTAL_PY = [
  'import os, sys',
  'try:',
  '    import gi',
  "    gi.require_version('Gio', '2.0')",
  '    from gi.repository import Gio, GLib',
  '    bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)',
  'except Exception:',
  '    sys.exit(2)',
  "token = 'ca%d' % os.getpid()",
  "handle = '/org/freedesktop/portal/desktop/request/%s/%s' % (bus.get_unique_name()[1:].replace('.', '_'), token)",
  'loop = GLib.MainLoop()',
  "out = {'code': 1}",
  'def done(_c, _s, _p, _i, _n, params):',
  '    code, res = params.unpack()',
  "    if code == 0 and res.get('uri'):",
  "        out['code'] = 0",
  "        print(res['uri'])",
  '    loop.quit()',
  "bus.signal_subscribe('org.freedesktop.portal.Desktop', 'org.freedesktop.portal.Request', 'Response', handle, None, 0, done)",
  'try:',
  "    bus.call_sync('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop', 'org.freedesktop.portal.Screenshot', 'Screenshot',",
  "        GLib.Variant('(sa{sv})', ('', {'handle_token': GLib.Variant('s', token), 'interactive': GLib.Variant('b', True)})), None, 0, -1, None)",
  'except Exception:',
  '    sys.exit(2)',
  'GLib.timeout_add_seconds(300, loop.quit)',
  'loop.run()',
  "sys.exit(out['code'])",
].join('\n');
// { img } con la zona elegida, { cancelled } o null si no hay portal (entonces, el recorte propio)
function portalShot() {
  return new Promise((resolve) => {
    execFile('python3', ['-c', PORTAL_PY], { timeout: 310e3 }, (err, stdout) => {
      if (err) return resolve(err.code === 1 ? { cancelled: true } : null);
      try {
        const file = decodeURIComponent(new URL(stdout.trim()).pathname);
        const img = nativeImage.createFromPath(file);
        // El portal la deja en Imágenes: no es una captura que hayas pedido guardar
        try { fs.unlinkSync(file); } catch {}
        resolve(img.isEmpty() ? null : { img });
      } catch { resolve(null); }
    });
  });
}

const notify = (body) => { try { new Notification({ title: 'Claude Assistant', body }).show(); } catch {} };

export function createAssist({ dir, getConfig, getConv, createTab, send, adoptTab, openTab }) {
  let ov = null;
  let ready = null;
  let phase = 'idle';    // idle | listen | transcribe | review | edit | work | answer | error
  let shot = null;       // recorte de pantalla para adjuntar a lo que pidas
  let sn = null;         // ventana del recorte
  let snReady = null;
  let snip = null;       // recorte en curso: { img, display, loaded }
  let convId = null;
  let lastUse = 0;
  let escOn = false;

  const tell = (type, data = {}) => ov?.webContents.send('assist', type, data);
  // Al ocultar una ventana con el foco, Windows no se lo devuelve a la aplicación de antes. blur() se
  // lo da a la siguiente ventana: sin «siempre encima», esa es la aplicación de debajo y no la barra de tareas
  // En macOS, si no queda otra ventana de la app a la vista, se oculta la app para que el foco vuelva a la de antes
  const hide = (w) => {
    if (!w || w.isDestroyed()) return;
    const focused = w.isFocused();
    if (focused && !IS_MAC) { w.setAlwaysOnTop(false); w.blur(); }
    w.hide();
    // (con un margen: tras el recorte aparece enseguida el bocadillo, y entonces no hace falta)
    if (focused && IS_MAC) setTimeout(() => { if (!BrowserWindow.getAllWindows().some((o) => o.isVisible())) app.hide(); }, 300);
  };
  // macOS: paneles flotantes que se ven en todos los escritorios, también sobre apps a pantalla completa
  const floatMac = (w) => { if (IS_MAC) w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true }); };

  function overlay() {
    if (ov && !ov.isDestroyed()) return ready;
    ov = new BrowserWindow({
      width: WIDTH, height: 140, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, ...(IS_MAC ? { type: 'panel' } : {}),
      // Con focusable: false, Windows se come el mousedown y no funcionan los clics (ni la X);
      // no quita el foco al aparecer porque se muestra con showInactive
      webPreferences: { preload: path.join(dir, 'overlay-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    ov.setAlwaysOnTop(true, 'screen-saver'); // por encima también de ventanas «siempre visibles»
    floatMac(ov);
    ov.on('closed', () => { ov = null; phase = 'idle'; });
    ov.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    ready = new Promise((res) => ov.webContents.once('did-finish-load', res));
    ov.loadFile(path.join(dir, 'renderer', 'overlay.html'));
    return ready;
  }

  // Arriba a la izquierda de la pantalla en la que está el ratón
  function place() {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const [, h] = ov.getSize();
    ov.setBounds({ x: wa.x + 8, y: wa.y + 8, width: WIDTH, height: h });
  }

  // Pantalla completa (a resolución real) en la que está el ratón
  async function captureScreen() {
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const thumbnailSize = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
    const img = (sources.find((s) => s.display_id === String(d.id)) || sources[0])?.thumbnail;
    return img && !img.isEmpty() ? { img, display: d } : null;
  }

  // Lo que se envía: en PNG (el texto se lee mejor) y como mucho a MAX_EDGE
  function encode(img) {
    const { width, height } = img.getSize();
    const k = Math.min(1, MAX_EDGE / Math.max(width, height));
    if (k < 1) img = img.resize({ width: Math.round(width * k), height: Math.round(height * k), quality: 'best' });
    const thumb = img.getSize().height > 72 ? img.resize({ height: 72, quality: 'best' }) : img;
    return {
      mediaType: 'image/png',
      data: img.toPNG().toString('base64'),
      thumb: thumb.toDataURL(),
    };
  }

  // ---------- Recorte ----------
  function snipper() {
    if (sn && !sn.isDestroyed()) return snReady;
    sn = new BrowserWindow({
      show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, roundedCorners: false,
      enableLargerThanScreen: true, backgroundColor: '#000000', ...(IS_MAC ? { type: 'panel' } : {}),
      webPreferences: { preload: path.join(dir, 'snip-preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    floatMac(sn);
    sn.on('closed', () => { sn = null; endSnip(); });
    sn.on('blur', () => { if (snip?.loaded) finishSnip(null); }); // si cambias de ventana, se cancela
    snReady = new Promise((res) => sn.webContents.once('did-finish-load', res));
    sn.loadFile(path.join(dir, 'renderer', 'snip.html'));
    return snReady;
  }

  function endSnip() {
    snip?.to?.(null); // recorte para el chat cancelado
    snip = null;
    if (!WAYLAND) globalShortcut.unregister('Escape');
    escOn = false;
    syncEsc();
    hide(sn);
  }

  // El atajo de pantalla: congela la pantalla y deja recortar una zona; luego escucha.
  // Un clic sin arrastrar no recorta nada y sigue como el atajo de voz.
  // Con «to» (el menú + del chat), la imagen va ahí en vez de al asistente: to(imagen | null)
  async function snipHotkey(to) {
    if (snip) return to?.(null);
    snip = { loaded: false, to: typeof to === 'function' ? to : null };
    if (!snip.to && ['listen', 'transcribe', 'review', 'edit'].includes(phase)) tell('cancel');
    if (!WAYLAND) globalShortcut.unregister('Escape');
    escOn = false;
    if (ov?.isVisible()) { hide(ov); await new Promise((r) => setTimeout(r, 120)); } // que no salga en la captura
    // Wayland: la zona se elige con el recorte del escritorio; sin portal, se intenta como en el resto
    if (WAYLAND) {
      const p = await portalShot();
      if (p) {
        const s = snip;
        snip = null;
        if (s.to) s.to(p.cancelled ? null : encode(p.img));
        else if (!p.cancelled) listen(encode(p.img));
        return;
      }
    }
    // macOS: sin el permiso de grabación de pantalla solo se capturaría el fondo de escritorio
    if (IS_MAC && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
      await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }).catch(() => {}); // hace que macOS pregunte
      if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        snip.to?.(null);
        snip = null;
        notify('Para recortar la pantalla, activa Claude Assistant en Ajustes del Sistema › Privacidad y seguridad › Grabación de pantalla y vuelve a abrir la app.');
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        return;
      }
    }
    const [cap] = await Promise.all([captureScreen().catch(() => null), snipper()]);
    if (!cap && snip) notify('No se ha podido capturar la pantalla.');
    if (!cap || !snip) return endSnip();
    Object.assign(snip, cap);
    const { bounds } = cap.display;
    sn.setBounds(bounds);
    sn.setBounds(bounds); // la segunda, por si cambia de pantalla con otro escalado
    sn.webContents.send('snip', { src: `data:image/jpeg;base64,${cap.img.toJPEG(92).toString('base64')}` });
  }

  ipcMain.on('snip:ready', () => {
    if (!snip || !sn) return;
    snip.loaded = true;
    sn.setAlwaysOnTop(true, 'screen-saver');
    sn.show();
    sn.focus();
    if (!WAYLAND) { try { globalShortcut.register('Escape', () => finishSnip(null)); } catch {} }
  });
  ipcMain.on('snip:done', (_e, rect) => finishSnip(rect));

  function finishSnip(rect) {
    const s = snip;
    const to = s?.to;
    if (s) s.to = null; // lo entrega esta función, no endSnip
    endSnip();
    const give = to || listen;
    if (!s?.img || !rect) return to?.(null);
    if (rect.none) return to ? to(encode(s.img)) : listen(null); // clic sin arrastrar: para el chat, la pantalla entera
    const { width, height } = s.img.getSize();
    const kx = width / rect.viewW, ky = height / rect.viewH;
    const x = Math.max(0, Math.round(rect.x * kx)), y = Math.max(0, Math.round(rect.y * ky));
    const crop = {
      x, y,
      width: Math.max(1, Math.min(width - x, Math.round(rect.width * kx))),
      height: Math.max(1, Math.min(height - y, Math.round(rect.height * ky))),
    };
    give(encode(s.img.crop(crop)));
  }

  // Esc cancela mientras escuchas, revisas o corriges, aunque el foco esté en otra aplicación
  function syncEsc() {
    if (snip || WAYLAND) return; // durante el recorte, Esc es suyo
    const want = ['listen', 'transcribe', 'review', 'edit'].includes(phase);
    if (want === escOn) return;
    escOn = want;
    if (want) { try { globalShortcut.register('Escape', () => tell('cancel')); } catch { escOn = false; } }
    else globalShortcut.unregister('Escape');
  }
  function setPhase(p) {
    phase = p;
    syncEsc();
  }

  // El atajo de voz: empieza a escuchar; si ya escucha, termina; si está revisando, envía ya
  async function hotkey() {
    if (snip) return;
    if (phase === 'listen') return tell('stop');
    if (phase === 'review' || phase === 'edit') return tell('send');
    if (phase === 'transcribe') return;
    listen(null);
  }

  async function listen(withShot) {
    // macOS: la primera vez pregunta por el micrófono (después contesta al momento)
    if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone').catch(() => {});
    await overlay();
    if (ov.isVisible()) hide(ov);
    shot = withShot;
    setPhase('listen');
    place();
    tell('listen', { shot: shot?.thumb || null, follow: !!activeConv() });
    // Windows puede quitarle el «siempre encima» (p. ej. si se creó al arrancar el equipo, antes
    // que el escritorio): se vuelve a poner en cada aparición
    ov.setAlwaysOnTop(false);
    ov.setAlwaysOnTop(true, 'screen-saver');
    ov.showInactive(); // sin quitar el foco a la aplicación que estás usando
    ov.moveTop();
  }

  function activeConv() {
    const c = convId && getConv(convId);
    return c && Date.now() - lastUse < REUSE_MS ? c : null;
  }

  // La pestaña «de voz»: una de terminal que se abre en segundo plano
  function voiceConv() {
    let c = activeConv();
    if (!c) {
      const cfg = getConfig();
      const presetId = cfg.presets?.some((p) => p.id === cfg.voicePreset) ? cfg.voicePreset : null;
      c = createTab({ presetId, model: cfg.voiceModel || '', effort: cfg.voiceEffort || '' });
      convId = c.id;
      adoptTab(c);
    }
    lastUse = Date.now();
    return c;
  }

  // Respuesta final: el texto que Claude escribió después de su última herramienta
  function finalText(conv) {
    const msg = [...conv.messages].reverse().find((m) => m.role === 'assistant');
    const blocks = msg?.blocks || [];
    const out = [];
    for (let i = blocks.length - 1; i >= 0 && blocks[i].type !== 'tool'; i--) if (blocks[i].type === 'text') out.unshift(blocks[i].text);
    return out.join('\n\n').trim();
  }

  function status(conv) {
    const msg = conv.messages.at(-1);
    const b = msg?.role === 'assistant' ? msg.blocks?.at(-1) : null;
    if (b?.type === 'tool') return { tool: b.name };
    return {};
  }

  // Eventos de las pestañas (los reenvía main.mjs)
  function onEvent(event, p) {
    if (!ov || !convId || p?.convId !== convId || !['work', 'answer'].includes(phase)) return;
    const conv = getConv(convId);
    if (!conv) return;
    if (event === 'conv:update' && phase === 'work') tell('progress', status(conv));
    else if (event === 'chat:done') { setPhase('answer'); tell('answer', { text: finalText(conv) || 'Hecho.' }); }
    else if (event === 'prompt:new') tell('prompt', { kind: p.kind });
  }

  // Mientras el bocadillo está a la vista, no hace falta además la notificación de Windows
  const owns = (id) => id === convId && !!ov?.isVisible();

  ipcMain.on('assist:phase', (_e, p) => setPhase(p));
  ipcMain.on('assist:size', (_e, h) => {
    if (!ov) return;
    const b = ov.getBounds();
    ov.setBounds({ ...b, height: Math.max(60, Math.min(Math.ceil(h), 720)) });
  });
  ipcMain.on('assist:focus', () => { if (!ov) return; setPhase('edit'); ov.focus(); });
  ipcMain.handle('assist:send', (_e, { text, withShot }) => {
    const c = voiceConv();
    send(c.id, { text, images: withShot && shot ? [shot] : [] });
    shot = null;
    setPhase('work');
    return true;
  });
  ipcMain.on('assist:open', () => { if (convId) openTab(convId); hide(ov); setPhase('idle'); });
  ipcMain.on('assist:close', () => { hide(ov); shot = null; setPhase('idle'); });

  return { hotkey, snipHotkey, snipFor: () => new Promise((resolve) => snipHotkey(resolve)), onEvent, owns, preload: () => { overlay(); snipper(); } };
}
