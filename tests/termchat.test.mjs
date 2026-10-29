// Pruebas de termchat.mjs con transcripciones de ejemplo: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Una carpeta de Claude Code de mentira (termchat lee ~/.claude/projects al importarse)
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'termchat-test-'));
const DIR = path.join(ROOT, 'projects', 'C--prueba');
fs.mkdirSync(DIR, { recursive: true });
process.env.CLAUDE_CONFIG_DIR = ROOT;
const { createTermChat } = await import('../termchat.mjs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];
const typed = [];
let tc;
let n = 0;

before(() => {
  tc = createTermChat({
    emit: (ev, p) => events.push([ev, p]),
    write: (id, data) => typed.push([id, data]),
    ctxLimits: () => ({ max: 200000, compactAt: 167000 }),
  });
});
after(() => {
  tc.close();
  fs.rmSync(ROOT, { recursive: true, force: true });
});

// Una pestaña con su transcripción (líneas JSON)
function tab(records = []) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const file = path.join(DIR, `${id}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r) + '\n').join(''));
  const conv = { id, title: 'Prueba', busy: false, messages: [], prompts: [], queue: [], tasks: [] };
  tc.attach(conv);
  tc.start(id);
  return { id, conv, file, append: (r) => fs.appendFileSync(file, JSON.stringify(r) + '\n') };
}
const user = (content) => ({ type: 'user', message: { role: 'user', content } });
const assistant = (content, extra = {}) => ({ type: 'assistant', message: { id: `msg_${Math.random()}`, role: 'assistant', model: 'claude-x', content, ...extra } });
const until = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('No ha pasado a tiempo');
    await sleep(25);
  }
};

test('pregunta, herramienta con su resultado y respuesta', () => {
  const { id, conv } = tab([
    user('Hola'),
    assistant([{ type: 'thinking', thinking: 'Pienso' }, { type: 'text', text: 'Miro' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
      { usage: { input_tokens: 10, cache_creation_input_tokens: 1000, cache_read_input_tokens: 19000, output_tokens: 5 } }),
    user([{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }]),
    assistant([{ type: 'text', text: 'Hay un archivo.' }]),
    { type: 'system', subtype: 'turn_duration', durationMs: 1234 },
  ]);
  assert.equal(conv.messages.length, 2);
  assert.deepEqual(conv.messages[0], { ...conv.messages[0], role: 'user', text: 'Hola' });
  const r = conv.messages[1];
  assert.equal(r.role, 'assistant');
  assert.equal(r.done, true);
  assert.deepEqual(r.blocks.map((b) => b.type), ['thinking', 'text', 'tool', 'text']);
  assert.equal(r.blocks[2].result, 'a.txt');
  assert.equal(r.stats.durationMs, 1234);
  assert.equal(r.stats.cacheRead, 19000);
  // Contexto: lo que entró en la última llamada al modelo
  assert.deepEqual(conv.context, { used: 20010, max: 200000, pct: 10, compactAt: 167000 });
  tc.detach(id);
});

test('comandos, modo bash, avisos del sistema e interrupción', () => {
  const { id, conv } = tab([
    user('<command-name>/model</command-name>\n<command-args>haiku</command-args>'),
    user('<local-command-stdout>Set model to Haiku and saved as your default for new sessions</local-command-stdout>'),
    user('<bash-input>echo hola</bash-input>'),
    user('<bash-stdout>hola</bash-stdout><bash-stderr></bash-stderr>'),
    user('<system-reminder>nada</system-reminder>'),
    user('Haz algo largo'),
    user([{ type: 'text', text: '[Request interrupted by user]' }]),
  ]);
  const texts = conv.messages.filter((m) => m.role === 'user').map((m) => m.text);
  assert.deepEqual(texts, ['/model haiku', '! echo hola', 'Haz algo largo']);
  const note = conv.messages[1].blocks[0];
  assert.equal(note.type, 'note');
  assert.match(note.text, /solo en esta pestaña/);
  const bash = conv.messages[3].blocks[0];
  assert.deepEqual([bash.name, bash.input.command, bash.result], ['Bash', 'echo hola', 'hola']);
  assert.equal(conv.messages.at(-1).blocks.at(-1).type, 'interrupted');
  tc.detach(id);
});

test('/clear deja el chat en blanco y las tareas se siguen', () => {
  const { id, conv } = tab([
    user('Antes'),
    assistant([{ type: 'tool_use', id: 'k1', name: 'TaskCreate', input: { subject: 'Uno', activeForm: 'Haciendo uno' } }]),
    user([{ type: 'tool_result', tool_use_id: 'k1', content: 'Task #1 created' }]),
    assistant([{ type: 'tool_use', id: 'k2', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }]),
    user([{ type: 'tool_result', tool_use_id: 'k2', content: 'ok' }]),
  ]);
  assert.deepEqual(conv.tasks.map((x) => [x.id, x.status]), [['1', 'completed']]);
  tc.detach(id);
  const b = tab([user('Antes'), user('<command-name>/clear</command-name>'), user('Después')]);
  assert.deepEqual(b.conv.messages.filter((m) => m.role === 'user').map((m) => m.text), ['Después']);
  assert.equal(b.conv.tasks.length, 0);
  tc.detach(b.id);
});

test('lo añadido a la transcripción se lee al momento', async () => {
  const { id, conv, append } = tab([user('Uno')]);
  append(assistant([{ type: 'text', text: 'Respuesta' }]));
  await until(() => conv.messages[1]?.blocks.length === 1);
  assert.equal(conv.messages[1].blocks[0].text, 'Respuesta');
  tc.detach(id);
});

test('a la interfaz solo viajan los mensajes que han podido cambiar', async () => {
  const { id, conv, append } = tab([user('Uno'), assistant([{ type: 'text', text: 'A' }]), { type: 'system', subtype: 'turn_duration', durationMs: 1 }, user('Dos')]);
  const updates = () => events.filter(([ev, p]) => ev === 'conv:update' && p.convId === id).map(([, p]) => p);
  // La interfaz: empalma lo que llega
  let ui = [];
  const sync = () => { for (const p of updates().splice(0)) ui = ui.slice(0, p.from).concat(p.conv.messages); };
  append(assistant([{ type: 'tool_use', id: 'z1', name: 'Bash', input: { command: 'ls' } }]));
  await until(() => updates().length >= 1);
  await sleep(100);
  sync();
  events.length = 0;
  append(user([{ type: 'tool_result', tool_use_id: 'z1', content: 'hecho' }]));
  await until(() => updates().length >= 1);
  await sleep(100);
  const last = updates().at(-1);
  assert.ok(last.from > 0, 'no se reenvía todo');
  assert.ok(last.conv.messages.length < conv.messages.length);
  ui = ui.slice(0, last.from).concat(last.conv.messages);
  assert.deepEqual(ui, conv.messages);
  assert.equal(ui.at(-1).blocks[0].result, 'hecho');
  tc.detach(id);
});

test('cola: espera a que Claude Code esté listo y se envía al quedar libre', async () => {
  const { id, conv } = tab();
  typed.length = 0;
  tc.send(id, { text: 'Primero' });
  assert.equal(conv.queue.length, 1, 'aún sin título de la terminal: a la cola');
  tc.setBusy(id, false); // ✳: lista
  await until(() => typed.length > 0);
  assert.deepEqual(typed[0], [id, '\x1b[200~Primero\x1b[201~']);
  await until(() => typed.some(([, d]) => d === '\r'));
  assert.equal(conv.queue.length, 0);

  // Trabajando: a la cola; con Esc vuelve al cuadro de texto
  tc.setBusy(id, true);
  tc.send(id, { text: 'Dos' });
  tc.send(id, { text: 'Tres' });
  assert.equal(tc.unqueue(id, conv.queue[0].id), 'Dos');
  assert.equal(tc.interrupt(id), 'Tres');
  assert.equal(conv.queue.length, 0);

  // Al terminar el turno, lo que quede en cola se envía
  typed.length = 0;
  tc.send(id, { text: '/cost' });
  tc.setBusy(id, false);
  await until(() => typed.some(([, d]) => d === '/cost'), 3000);
  assert.ok(events.some(([ev, p]) => ev === 'chat:done' && p.convId === id));
  tc.detach(id);
});

test('permiso por el hook HTTP: se pregunta en la app y se contesta', async () => {
  const { id, conv } = tab();
  await until(() => tc.hookSettings(id));
  const url = tc.hookSettings(id).PermissionRequest[0].hooks[0].url;
  const res = fetch(url, {
    method: 'POST',
    body: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'rm x' }, permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }] }] }),
  });
  await until(() => conv.prompts.length === 1);
  const p = conv.prompts[0];
  assert.equal(p.kind, 'permission');
  assert.equal(p.alwaysLabel, 'Sí, y no volver a preguntar por Bash(rm:*)');
  tc.respond(id, p.id, { decision: 'allow' });
  const out = await (await res).json();
  assert.deepEqual(out.hookSpecificOutput.decision, { behavior: 'allow' });
  assert.equal(conv.prompts.length, 0);
  // Sin la clave, nada
  assert.equal((await fetch(url.replace(/k=\w+/, 'k=mal'), { method: 'POST', body: '{}' })).status, 403);
  tc.detach(id);
});

test('tras /rewind sigue la rama nueva de la transcripción (parentUuid)', () => {
  const r = (uuid, parentUuid, rec) => ({ ...rec, uuid, parentUuid });
  const { conv } = tab([
    r('u1', null, user('Primero')),
    r('a1', 'u1', assistant([{ type: 'text', text: 'Uno' }])),
    r('d1', 'a1', { type: 'system', subtype: 'turn_duration', durationMs: 1 }),
    r('u2', 'd1', user('Segundo')),
    r('a2', 'u2', assistant([{ type: 'text', text: 'Dos' }])),
    r('d2', 'a2', { type: 'system', subtype: 'turn_duration', durationMs: 1 }),
    // Vuelta atrás al punto anterior a «Segundo»: cuelga de d1
    r('u3', 'd1', user('Otro segundo')),
    r('a3', 'u3', assistant([{ type: 'text', text: 'Otro dos' }])),
  ]);
  assert.deepEqual(conv.messages.map((m) => m.text || m.blocks[0].text), ['Primero', 'Uno', 'Otro segundo', 'Otro dos']);
});

test('/rewind desde el chat corta antes del mensaje elegido', () => {
  const { id, conv } = tab([user('Primero'), assistant([{ type: 'text', text: 'Uno' }]), user('Segundo'), assistant([{ type: 'text', text: 'Dos' }])]);
  assert.equal(tc.rewind(id, conv.messages[2].id), true);
  assert.deepEqual(conv.messages.map((m) => m.text || m.blocks[0].text), ['Primero', 'Uno']);
  assert.equal(conv.messages[1].done, true);
});

test('la versión que se deja atrás al editar queda colgada del mensaje nuevo (‹ 1/2 ›)', () => {
  const r = (uuid, parentUuid, rec) => ({ ...rec, uuid, parentUuid });
  const { conv } = tab([
    r('u1', null, user('Primero')),
    r('a1', 'u1', assistant([{ type: 'text', text: 'Uno' }])),
    r('d1', 'a1', { type: 'system', subtype: 'turn_duration', durationMs: 1 }),
    r('u2', 'd1', user('Segundo')),
    r('a2', 'u2', assistant([{ type: 'text', text: 'Dos' }])),
    r('d2', 'a2', { type: 'system', subtype: 'turn_duration', durationMs: 1 }),
    r('u3', 'd1', user('Otro segundo')),
    r('a3', 'u3', assistant([{ type: 'text', text: 'Otro dos' }])),
  ]);
  const prev = conv.messages[2].prev;
  assert.equal(prev.length, 1);
  assert.deepEqual(prev[0].map((m) => m.text || m.blocks[0].text), ['Segundo', 'Dos']);
});

test('comandos en segundo plano: se siguen hasta su aviso, que sale en el chat', () => {
  const now = new Date().toISOString();
  const { conv } = tab([
    user('Lánzalo'),
    { ...assistant([{ type: 'tool_use', id: 'tb1', name: 'Bash', input: { command: 'sleep 9', description: 'Espera', run_in_background: true } }]), timestamp: now },
    { ...user([{ type: 'tool_result', tool_use_id: 'tb1', content: 'Command running in background with ID: bx1. Output is being written to: x.output' }]), timestamp: now },
  ]);
  assert.deepEqual(conv.background.map((x) => [x.id, x.label]), [['bx1', 'Espera']]);
  const rest = tab([
    user('Lánzalo'),
    { ...assistant([{ type: 'tool_use', id: 'tb2', name: 'Bash', input: { command: 'sleep 9', description: 'Espera', run_in_background: true } }]), timestamp: now },
    { ...user([{ type: 'tool_result', tool_use_id: 'tb2', content: 'Command running in background with ID: bx2. Output is being written to: x.output' }]), timestamp: now },
    user('<task-notification>\n<task-id>bx2</task-id>\n<status>completed</status>\n<summary>Background command "Espera" completed (exit code 1)</summary>\n</task-notification>'),
  ]).conv;
  assert.deepEqual(rest.background, []);
  assert.ok(rest.messages.at(-1).blocks.some((b) => b.type === 'note' && b.text === 'Comando en segundo plano «Espera» terminado (código 1)'));
  // Los de una sesión anterior (Claude Code los cierra al salir) no cuentan
  const old = tab([
    { ...assistant([{ type: 'tool_use', id: 'tb3', name: 'Bash', input: { command: 'sleep 9', run_in_background: true } }]), timestamp: '2020-01-01T00:00:00Z' },
    { ...user([{ type: 'tool_result', tool_use_id: 'tb3', content: 'Command running in background with ID: bx3.' }]), timestamp: '2020-01-01T00:00:00Z' },
  ]).conv;
  assert.deepEqual(old.background, []);
});
