// Prueba de la automejora en una copia instalada (la usa «Probar en macOS» tras mac-smoke.cjs; vale en
// cualquier sistema). Hace lo que haría el preset «Mejorar Claude Assistant»: cambia la copia editable, la
// prueba en la instancia de pruebas, la aplica y reinicia; luego aplica una versión rota y comprueba que la
// app vuelve sola a la original. Deja capturas e informe-automejora.json en la carpeta de salida.
//   node tools/mac-automejora.cjs [carpeta]   (CA_CDP_PORT: la app abierta, 9223; CA_DATA: su carpeta de datos)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PORT = Number(process.env.CA_CDP_PORT) || 9223;
const OUT = path.resolve(process.argv[2] || 'mac-test');
const DATA = process.env.CA_DATA || (process.platform === 'darwin'
  ? path.join(os.homedir(), 'Library', 'Application Support', 'claude-assistant')
  : process.platform === 'win32' ? path.join(process.env.APPDATA, 'claude-assistant') : path.join(os.homedir(), '.config', 'claude-assistant'));
const SELF = path.join(DATA, 'mejoras', 'app');
const STATE = path.join(DATA, 'mejoras.json');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const results = [];
let finished = false;
// Si el script se queda sin nada pendiente antes de acabar, es un fallo (no un 0 silencioso)
process.on('beforeExit', () => {
  if (finished) return;
  console.error('✘ La prueba se ha quedado a medias (nada pendiente)');
  fs.writeFileSync(path.join(OUT, 'informe-automejora.json'), JSON.stringify({ results, error: 'a medias' }, null, 2));
  process.exit(1);
});
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`); return ok; };

// La herramienta del preset, con el Node de la app (como mejorar/ca)
function ca(...args) {
  const env = read(path.join(SELF, 'mejorar', 'entorno.json'));
  const r = spawnSync(env.exe, [path.join(SELF, 'mejorar', 'herramienta.mjs'), ...args], { cwd: SELF, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 180000 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
const git = (...args) => spawnSync('git', args, { cwd: SELF, encoding: 'utf8' });

// CDP con la ventana principal; se vuelve a conectar tras cada reinicio
async function connect(ms = 120000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(1000)) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (!page) continue;
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
      let seq = 0;
      const pending = new Map();
      ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
// Sin respuesta (la app se ha cerrado o colgado) falla: una promesa que no se resuelve nunca dejaría a
      // Node sin nada pendiente y saldría con 0, como si todo hubiera ido bien
      const call = (method, params) => new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP sin respuesta: ${method}`)); }, 15000);
        pending.set(id, (d) => { clearTimeout(timer); pending.delete(id); resolve(d); });
        ws.send(JSON.stringify({ id, method, params }));
      });
      ws.onclose = () => { for (const [id, done] of pending) done({ id, error: { message: 'CDP cerrado' } }); };
      const evaluate = async (expression) => {
        const d = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (d.error) throw new Error(d.error.message);
        const r = d.result;
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result.value;
      };
      const waitFor = async (expression, wait) => {
        for (const stop = Date.now() + wait; Date.now() < stop; await sleep(500)) {
          try { const v = await evaluate(expression); if (v) return v; } catch {}
        }
        return null;
      };
      const shot = async (name) => {
        const r = await call('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
      };
      if (await waitFor('typeof state !== "undefined" && !!state.config', 60000)) return { ws, evaluate, waitFor, shot, fire: (expression) => ws.send(JSON.stringify({ id: ++seq, method: 'Runtime.evaluate', params: { expression } })) };
      ws.close();
    } catch {}
  }
  throw new Error('La app no ha vuelto a abrir su ventana.');
}

// Acepta el diálogo «Cambios listos» y espera a que la app vuelva a abrirse (otro proceso)
async function restartFromDialog(app, label) {
  const offered = await app.waitFor('document.querySelector("#update-dialog")?.open', 20000);
  check(`${label}: la app ofrece reiniciarse`, offered);
  const before = read(path.join(DATA, 'ready.json'))?.at || 0;
  // Sin esperar respuesta: la app se cierra al momento
  app.fire('document.querySelector("#upd-now").click()');
  await sleep(500);
  app.ws.close();
  for (const end = Date.now() + 90000; Date.now() < end && (read(path.join(DATA, 'ready.json'))?.at || 0) <= before; await sleep(1000));
  check(`${label}: la app vuelve a abrirse`, (read(path.join(DATA, 'ready.json'))?.at || 0) > before);
  await sleep(3000);
  return connect();
}

(async () => {
  let app = await connect();

  // 1. El preset y su copia editable
  check('El preset «Mejorar Claude Assistant» está sembrado', await app.evaluate('state.config.presets.some((p) => p.id === "mejorar-app")'));
  for (let i = 0; i < 60 && !fs.existsSync(path.join(SELF, 'mejorar', 'entorno.json')); i++) await sleep(1000);
  check('Copia editable preparada', fs.existsSync(path.join(SELF, 'main.mjs')) && fs.existsSync(path.join(SELF, 'CLAUDE.md')), SELF);
  check('Con git y rama original', git('log', '-1', '--format=%s', 'original').stdout.includes('Versión original'));
  const estado = ca('estado');
  check('ca estado', estado.ok && /Versión instalada/.test(estado.out), estado.out.split('\n')[0]);
  const comprobar = ca('comprobar');
  check('ca comprobar', comprobar.ok, comprobar.out.split('\n').pop());

  // 2. Un cambio, probado en la instancia de pruebas
  fs.appendFileSync(path.join(SELF, 'renderer', 'app.js'), '\nwindow.MEJORADA = 1; // prueba de la automejora\n');
  const prueba = ca('prueba');
  check('ca prueba abre la instancia de pruebas', prueba.ok, prueba.out.split('\n').pop());
  const ev = ca('eval', 'window.MEJORADA');
  check('ca eval ve el cambio en la instancia de pruebas', ev.ok && ev.out.trim() === '1', ev.out);
  const captura = ca('captura', path.join(OUT, '10-instancia-pruebas.png'));
  check('ca captura', captura.ok && fs.existsSync(path.join(OUT, '10-instancia-pruebas.png')));
  check('ca parar', ca('parar').ok);

  // 3. Aplicar y reiniciar con la mejorada
  const aplicar = ca('aplicar', 'Prueba de la automejora');
  check('ca aplicar', aplicar.ok, aplicar.out.split('\n').pop());
  check('Versión aplicada congelada', fs.existsSync(path.join(DATA, 'mejoras', 'aplicada', 'main.mjs')));
  app = await restartFromDialog(app, 'Aplicar');
  check('Tras reiniciar corre la mejorada', await app.waitFor('window.MEJORADA === 1', 15000));
  check('mejoras.json: activa y arrancada', read(STATE)?.activa && (read(path.join(DATA, 'ready.json'))?.at || 0) >= (read(STATE)?.intento || 0), JSON.stringify(read(STATE)));
  await app.shot('11-mejorada');

  // 4. Una versión rota: la app vuelve sola a la original
  const main = path.join(SELF, 'main.mjs');
  fs.writeFileSync(main, fs.readFileSync(main, 'utf8').replace(/^const APP_ID = /m, 'throw new Error("fallo de prueba");\nconst APP_ID = '));
  check('ca aplicar (versión rota)', ca('aplicar', 'Versión rota').ok);
  app = await restartFromDialog(app, 'Versión rota');
  check('Vuelve sola a la original', !(await app.evaluate('window.MEJORADA === 1')));
  const s = read(STATE);
  check('mejoras.json: desactivada con el motivo', s && !s.activa && /no arrancaba/.test(s.motivo || ''), s?.motivo?.split(' · ')[0]);
  await app.shot('12-vuelta-a-la-original');

  // 5. Parche para compartir los cambios
  const parche = ca('parche');
  const file = parche.out.split('\n').pop().trim();
  check('ca parche', parche.ok && fs.existsSync(file) && /window\.MEJORADA/.test(fs.readFileSync(file, 'utf8')), file);

  app.ws.close();
  fs.writeFileSync(path.join(OUT, 'informe-automejora.json'), JSON.stringify({ results }, null, 2));
  finished = true;
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\nFallan ${failed.length}: ${failed.map((r) => r.name).join(', ')}` : '\nAutomejora: todo bien.');
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'informe-automejora.json'), JSON.stringify({ results, error: String(e.stack || e) }, null, 2));
  process.exit(1);
});
