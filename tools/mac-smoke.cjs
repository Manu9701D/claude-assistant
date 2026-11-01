// Prueba de humo de la app instalada en un Mac (la usa la acción «Probar en macOS» en los Mac virtuales
// de GitHub). Se conecta por CDP a la app abierta con --remote-debugging-port, recorre lo principal y deja
// capturas y un informe en la carpeta de salida. Sale con error si falla algo imprescindible.
//   node tools/mac-smoke.cjs [carpeta]      (CA_CDP_PORT, por defecto 9223; con CLAUDE_CODE_OAUTH_TOKEN, también un turno de chat)
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.CA_CDP_PORT) || 9223;
const OUT = path.resolve(process.argv[2] || 'mac-test');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === 'page' && p.url.includes('index.html'));
      if (page) return page;
    } catch {}
    await sleep(1000);
  }
  throw new Error('La app no ha abierto su ventana en 2 minutos.');
}

(async () => {
  const page = await connect();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    pending.get(d.id)?.(d);
  };
  const call = (method, params) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = (await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
      try { const v = await evaluate(expression); if (v) return v; } catch {}
    }
    return null;
  };
  const shot = async (name) => {
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  await call('Runtime.enable');

  // 1. Arranque y puesta a punto del primer arranque
  check('La interfaz arranca', await waitFor('typeof state !== "undefined" && !!state.config', 60000));
  await sleep(1500);
  check('Plataforma macOS en la interfaz', await evaluate('IS_MAC'));
  check('Sale la puesta a punto', await waitFor('document.querySelector("#setup")?.open', 15000));
  await sleep(2000);
  await shot('01-puesta-a-punto');
  const setup = await evaluate('api.setupCheck()');
  fs.writeFileSync(path.join(OUT, 'setup-check.json'), JSON.stringify(setup, null, 2));
  check('Encuentra Claude Code', setup.claude?.version, `${setup.claude?.path} ${setup.claude?.version || ''}`);
  check('Lee los permisos de macOS', setup.macPerms, JSON.stringify(setup.macPerms));
  check('Encuentra git', setup.git, setup.git);
  await evaluate('document.querySelector("#setup-done").click()');
  check('Se cierra la puesta a punto', await waitFor('!document.querySelector("#setup")?.open && state.config.setupDone', 10000));
  await sleep(1000);
  await shot('02-inicio');

  // 2. Una pestaña: el claude interactivo en node-pty
  const tabs0 = await evaluate('state.tabs.length');
  const conv = await evaluate('openSession({}).then((c) => ({ id: c.id, terminal: !!c.terminal, cwd: c.cwd }))');
  check('Abre una pestaña nueva', conv?.id && (await evaluate('state.tabs.length')) > tabs0, JSON.stringify(conv));
  const id = JSON.stringify(conv.id);
  const screen = await waitFor(`(() => { const l = termScreen(${id}).filter((x) => x.trim()); return l.length > 2 && l.join('\\n'); })()`, 45000);
  check('La terminal de Claude Code pinta algo (node-pty)', screen, screen ? `${screen.split('\n').length} líneas` : 'pantalla vacía');
  fs.writeFileSync(path.join(OUT, 'pantalla-terminal.txt'), screen || '');
  await sleep(3000);
  await shot('03-pestana-chat');
  await evaluate(`setTermView(${id}, 'terminal')`);
  await sleep(2500);
  check('Vista de terminal (Ctrl+º)', await evaluate(`termViewOf(${id}) === 'terminal' && !document.querySelector('#terms').hidden`));
  await shot('04-terminal');
  fs.writeFileSync(path.join(OUT, 'pantalla-terminal.txt'), (await evaluate(`termScreen(${id}).join('\\n')`)) || '');
  await evaluate(`setTermView(${id}, 'chat')`);
  await sleep(800);

  // 3. Un turno de chat de verdad (solo con cuenta: secreto CLAUDE_CODE_OAUTH_TOKEN de la acción)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const ready = await waitFor(`termField(${id}) !== null`, 60000);
    check('Claude Code listo para escribir', ready !== null);
    await evaluate(`api.send(${id}, { text: 'Responde solo con la palabra: Hola' })`);
    const reply = await waitFor(`(() => { const c = state.convs.get(${id}); const m = c?.messages?.filter((x) => x.role === 'assistant' || x.type === 'assistant'); return !c.busy && m?.length && JSON.stringify(m.at(-1)).slice(0, 300); })()`, 120000);
    check('Responde en el chat', reply, reply || '');
    await sleep(1500);
    await shot('05-respuesta');
  } else check('Turno de chat (sin cuenta: se omite)', true, 'añade el secreto CLAUDE_CODE_OAUTH_TOKEN para probarlo');

  // 4. Configuración, atajos y segunda pestaña
  await evaluate('openSettings()');
  await sleep(1500);
  const settingsOpen = await evaluate('!!document.querySelector("#settings")?.open');
  check('Abre Configuración', settingsOpen);
  if (settingsOpen) await shot('06-configuracion');
  await evaluate('document.querySelectorAll("dialog[open]").forEach((d) => d.close())');
  const conv2 = await evaluate('openSession({}).then((c) => c.id)');
  await sleep(2000);
  check('Dos pestañas a la vez', (await evaluate('state.tabs.length')) >= 2 && conv2);
  await shot('07-dos-pestanas');
  check('Atajos con ⌘ en macOS', await evaluate('K("Ctrl+T") === "⌘T"'));

  check('Sin excepciones en la interfaz', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify({ results, errors }, null, 2));
  ws.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones bien`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e.message || e); fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify({ results, fatal: String(e.message || e) }, null, 2)); process.exit(1); });
