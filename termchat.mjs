// Chat limpio sobre el `claude` de la terminal: la conversación se lee de su transcripción
// (~/.claude/projects/…/<sesión>.jsonl) y se pasa a mensajes con bloques (texto, razonamiento,
// herramientas) que pinta la interfaz; las preguntas y los permisos llegan por hooks HTTP y se
// contestan con los selectores de la app. Lo que se escribe en el chat se teclea en la terminal.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const PROJECTS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const POLL_MS = 250; // mientras no se conoce el archivo o tras /clear; con fs.watch, solo de respaldo (×4)
const MAX_IMAGE = 2 * 1024 * 1024; // imágenes del historial que se enseñan (en base64)
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const INTERRUPTED = 'Interrumpido. ¿Qué quieres que haga en su lugar?';
const MAX_FIELD = 6000;

// Recorta los campos largos para no mandar megas a la interfaz
function cap(value, max = MAX_FIELD) {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) + `\n… (${value.length - max} caracteres más)` : value;
  if (Array.isArray(value)) return value.map((v) => cap(v, max));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cap(v, max);
    return out;
  }
  return value;
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (b.type === 'text' ? b.text : `[${b.type}]`)).join('\n');
  return content == null ? '' : JSON.stringify(content);
}

// Lista de tareas como la de la terminal, a partir de TaskCreate / TaskUpdate
function applyTask(conv, t, structured) {
  const tasks = conv.tasks;
  if (t.name === 'TaskCreate') {
    const id = structured?.task?.id || String(t.result || '').match(/#(\d+)/)?.[1];
    if (id) tasks.push({ id: String(id), subject: t.input.subject, activeForm: t.input.activeForm, status: 'pending' });
  } else if (t.name === 'TaskUpdate') {
    const task = tasks.find((x) => x.id === String(t.input.taskId));
    if (!task) return;
    if (t.input.status === 'deleted') conv.tasks = tasks.filter((x) => x !== task);
    else Object.assign(task, Object.fromEntries(['status', 'subject', 'activeForm'].filter((k) => t.input[k]).map((k) => [k, t.input[k]])));
  }
}

// Texto de la opción «Sí, y no volver a preguntar…» de un permiso
function describeSuggestions(suggestions) {
  if (!suggestions?.length) return null;
  const rules = suggestions.flatMap((s) => s.rules || []);
  if (rules.length) {
    const r = rules[0];
    const what = r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName;
    return `Sí, y no volver a preguntar por ${what}`;
  }
  const mode = suggestions.find((s) => s.type === 'setMode');
  if (mode?.mode === 'acceptEdits') return 'Sí, y aceptar ediciones el resto de la sesión';
  const dirs = suggestions.find((s) => s.type === 'addDirectories');
  if (dirs) return `Sí, y permitir acceso a ${dirs.directories?.[0] || 'esa carpeta'}`;
  return 'Sí, y no volver a preguntar';
}

const between = (text, tag) => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m ? m[1] : null;
};
const clean = (s) => String(s || '').replace(ANSI, '').trim();

/**
 * @param {object} o
 * @param {(event, payload) => void} o.emit  eventos para la interfaz (conv:update, prompt:new…)
 * @param {(id, data) => void} o.write  teclear en la terminal de la pestaña
 * @param {(conv) => { max, compactAt } | null} [o.ctxLimits]  ventana de contexto y umbral de compactado
 */
export function createTermChat({ emit, write, ctxLimits = () => null }) {
  const token = crypto.randomBytes(16).toString('hex');
  const tabs = new Map(); // id -> estado (ver attach)
  let port = 0;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const id = url.pathname.split('/')[2];
    if (url.searchParams.get('k') !== token || !tabs.has(id)) { res.writeHead(403).end(); return; }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      let input = {};
      try { input = JSON.parse(body || '{}'); } catch {}
      onHook(tabs.get(id), input, res);
    });
  });
  server.requestTimeout = 0;
  server.listen(0, '127.0.0.1', () => { port = server.address().port; });

  // Hooks que se añaden al --settings de cada pestaña
  function hookSettings(id) {
    if (!port) return null;
    const hook = (timeout) => [{ matcher: '*', hooks: [{ type: 'http', url: `http://127.0.0.1:${port}/hook/${id}?k=${token}`, timeout }] }];
    return { PermissionRequest: hook(86400), UserPromptSubmit: hook(10), Stop: hook(10), Notification: hook(10) };
  }

  function attach(conv) {
    const t = {
      conv, file: null, offset: 0, partial: '', timer: null, flushTimer: null, clearAt: 0, drainTimer: null,
      ready: false, readyTimer: null, // Claude Code ya acepta mensajes (ha puesto su título)
      tmp: [], // imágenes pegadas (archivos temporales): se borran al cerrar la pestaña
      reply: null, tools: new Map(), keys: new Map(), usage: new Map(),
      toolAt: new Map(), // id de la herramienta -> índice de su mensaje (su resultado lo cambia)
      at: new Map(), lastUuid: null, // uuid de cada registro -> mensajes que había tras él (para seguir la rama tras /rewind)
      sent: null, sentLen: 0, dirty: Infinity, // lo último enviado a la interfaz, para mandar solo lo nuevo
      pending: new Map(), // promptId -> { res, toolName, key, suggestions, input }
    };
    tabs.set(conv.id, t);
    return t;
  }

  // ---------- Notificaciones a la interfaz ----------
  // Solo viajan los mensajes desde el primero que ha podido cambiar (from); la interfaz los empalma
  // con los que ya tiene. Una conversación larga no se copia entera cada 60 ms.
  function flush(t, now = false) {
    const send = () => {
      t.flushTimer = null;
      const { messages, ...rest } = t.conv;
      const from = messages === t.sent ? Math.max(0, Math.min(t.dirty, t.sentLen - 2, messages.length)) : 0;
      emit('conv:update', { convId: t.conv.id, conv: { ...rest, messages: messages.slice(from) }, from });
      t.sent = messages;
      t.sentLen = messages.length;
      t.dirty = Infinity;
    };
    if (now) { clearTimeout(t.flushTimer); send(); return; }
    if (!t.flushTimer) t.flushTimer = setTimeout(send, 60);
  }

  // ---------- Transcripción ----------
  function findTranscript(id) {
    try {
      for (const d of fs.readdirSync(PROJECTS)) {
        const f = path.join(PROJECTS, d, `${id}.jsonl`);
        if (fs.existsSync(f)) return f;
      }
    } catch {}
    return null;
  }

  function setTranscript(t, file) {
    if (!file || file === t.file) return;
    const first = !t.file;
    t.file = file;
    // Avisos del sistema de archivos: lo nuevo se lee al momento sin mirar el archivo cada 250 ms
    t.watcher?.close();
    try {
      t.watcher = fs.watch(file, () => { if (!t.readSoon) t.readSoon = setTimeout(() => { t.readSoon = null; if (t.timer) read(t); }, 15); });
      t.watcher.on('error', () => { t.watcher?.close(); t.watcher = null; });
    } catch { t.watcher = null; }
    // Tras /clear Claude Code sigue en otra sesión: es la que hay que retomar al reiniciar
    t.conv.sessionId = path.basename(file, '.jsonl');
    t.offset = 0;
    t.partial = '';
    // /clear: sesión nueva en la misma pestaña, el chat empieza de cero
    if (!first) {
      t.conv.messages = [];
      t.conv.tasks = [];
      t.conv.context = null;
      t.reply = null;
      t.tools.clear();
      t.toolAt.clear();
      t.keys.clear();
    }
    t.at.clear();
    t.lastUuid = null;
    read(t);
  }

  // /clear no avisa por ningún hook: la sesión nueva se busca en la misma carpeta (un .jsonl
  // reciente que empiece por ese /clear y que no sea de otra pestaña)
  function findCleared(t) {
    if (Date.now() - t.clearAt > 20000) { t.clearAt = 0; return; }
    const dir = path.dirname(t.file);
    const taken = new Set([...tabs.values()].map((x) => x.file));
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { return; }
    for (const n of names) {
      const file = path.join(dir, n);
      if (taken.has(file)) continue;
      try {
        // (algunos sistemas de archivos de Linux no dan la fecha de creación: birthtimeMs llega a 0)
        const st = fs.statSync(file);
        if ((st.birthtimeMs || st.ctimeMs) < t.clearAt - 2000) continue;
        if (!/<command-name>\/(clear|reset|new)<\/command-name>/.test(fs.readFileSync(file, 'utf8').slice(0, 20000))) continue;
      } catch { continue; }
      t.clearAt = 0;
      setTranscript(t, file);
      return;
    }
  }

  function read(t) {
    if (!t.file) { setTranscript(t, findTranscript(t.conv.sessionId || t.conv.id)); return; }
    if (t.clearAt) findCleared(t);
    let size;
    try { size = fs.statSync(t.file).size; } catch { return; }
    if (size < t.offset) { t.offset = 0; t.partial = ''; }
    if (size === t.offset) return;
    const fd = fs.openSync(t.file, 'r');
    const buf = Buffer.alloc(size - t.offset);
    try { fs.readSync(fd, buf, 0, buf.length, t.offset); } finally { fs.closeSync(fd); }
    t.offset = size;
    const lines = (t.partial + buf.toString('utf8')).split('\n');
    t.partial = lines.pop();
    let changed = false;
    for (const line of lines) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (branch(t, rec)) changed = true;
      if (onRecord(t, rec) !== false) changed = true;
      if (rec.uuid && !rec.isSidechain) { t.at.set(rec.uuid, t.conv.messages.length); t.lastUuid = rec.uuid; }
    }
    if (changed) flush(t);
  }

  // Tras /rewind, Claude Code sigue en el mismo .jsonl: el siguiente mensaje cuelga de un registro
  // anterior (parentUuid) y lo que había después queda en otra rama. El chat sigue la rama nueva.
  function branch(t, rec) {
    if (rec.type !== 'user' || rec.isSidechain || rec.isMeta || rec.isCompactSummary || !('parentUuid' in rec)) return false;
    const content = rec.message?.content;
    if (Array.isArray(content) ? content.some((b) => b.type === 'tool_result') : typeof content !== 'string') return false;
    const parent = rec.parentUuid;
    if (parent === t.lastUuid || !t.at.size) return false;
    const cut = parent ? t.at.get(parent) : 0;
    if (cut === undefined || cut >= t.conv.messages.length) return false;
    // Solo si se descarta algún mensaje tuyo (si no, no es otra rama)
    if (!t.conv.messages.slice(cut).some((m) => m.role === 'user')) return false;
    truncate(t, cut);
    return true;
  }

  function truncate(t, cut) {
    // Lo que se descarta es una versión anterior del mensaje que venga a ocupar su sitio
    // (como las ramas de claude.ai: «‹ 1/2 ›»); se guarda colgada de él
    const tail = t.conv.messages.slice(cut);
    if (tail[0]?.role === 'user') {
      const { prev = [], ...first } = tail[0];
      t.branchAt = { at: cut, prev: [...prev, [first, ...tail.slice(1)]].slice(-10) };
    }
    t.conv.messages = t.conv.messages.slice(0, cut);
    for (const [k, i] of t.toolAt) if (i >= cut) { t.toolAt.delete(k); t.tools.delete(k); t.keys.delete(k); }
    closeReply(t);
    t.reply = null;
  }

  // /rewind desde el chat: vuelve ya al punto anterior a ese mensaje (la transcripción no cambia
  // hasta que se envía otro, y entonces branch() llega al mismo sitio)
  function rewind(id, msgId) {
    const t = tabs.get(id);
    const i = t ? t.conv.messages.findIndex((m) => m.role === 'user' && m.id === msgId) : -1;
    if (i < 0) return false;
    truncate(t, i);
    flush(t, true);
    return true;
  }

  function ensureReply(t) {
    const last = t.conv.messages.at(-1);
    if (last?.role === 'assistant' && !last.done) return (t.reply = last);
    t.reply = { role: 'assistant', blocks: [], done: false };
    t.usage.clear();
    t.conv.messages.push(t.reply);
    return t.reply;
  }

  function closeReply(t) {
    const last = t.conv.messages.at(-1);
    if (last?.role === 'assistant') last.done = true;
  }

  function addUser(t, text, images = [], extra = {}) {
    closeReply(t);
    if (t.branchAt?.at === t.conv.messages.length) extra = { ...extra, prev: t.branchAt.prev };
    t.branchAt = null;
    t.conv.messages.push({ role: 'user', id: crypto.randomUUID(), text, images, ...extra });
    // Lo que estaba en la cola ya lo ha recogido Claude
    const i = t.conv.queue.findIndex((q) => q.text.trim() === text.trim());
    if (i >= 0) t.conv.queue.splice(i, 1);
    ensureReply(t);
  }

  function note(t, text, icon) {
    if (text) ensureReply(t).blocks.push({ type: 'note', text: cap(text, 3000), icon });
  }

  // Texto de un mensaje de usuario o de un comando local
  function onText(t, text) {
    if (text.includes('<command-name>')) {
      const name = clean(between(text, 'command-name'));
      const args = clean(between(text, 'command-args'));
      // /clear empieza una conversación nueva: el chat se queda en blanco
      if (name.replace(/^\//, '') === 'clear') { t.conv.messages = []; t.conv.tasks = []; t.conv.context = null; t.reply = null; return; }
      addUser(t, [name.startsWith('/') ? name : `/${name}`, args].filter(Boolean).join(' '));
      return;
    }
    const out = between(text, 'local-command-stdout') ?? between(text, 'local-command-stderr');
    // La app devuelve el predeterminado que /model y /effort guardan (main.mjs, keepClaudeDefaults)
    if (out !== null) { note(t, clean(out).replace(/ and saved as your default for new sessions/, ' (solo en esta pestaña)')); return; }
    if (text.includes('<bash-input>')) { addUser(t, `! ${clean(between(text, 'bash-input'))}`); return; }
    const so = between(text, 'bash-stdout');
    if (so !== null) {
      const res = [clean(so), clean(between(text, 'bash-stderr'))].filter(Boolean).join('\n');
      const prev = t.conv.messages.at(-2);
      ensureReply(t).blocks.push({ type: 'tool', id: crypto.randomUUID(), name: 'Bash', input: { command: prev?.text?.replace(/^! /, '') || '' }, result: cap(res) });
      return;
    }
    if (text.startsWith('<task-notification>')) { taskDone(t, text); return; }
    if (text.startsWith('<system-reminder>')) return;
    if (text.startsWith('[Request interrupted by user')) { interrupted(t); return; }
    addUser(t, text);
  }

  // Aviso de que ha acabado algo en segundo plano (Claude Code: «Background command … completed»)
  function taskDone(t, text) {
    const id = clean(between(text, 'task-id') || '');
    const status = clean(between(text, 'status') || '');
    const summary = clean(between(text, 'summary') || '');
    const task = t.conv.background?.find((x) => x.id === id);
    if (task) t.conv.background = t.conv.background.filter((x) => x !== task);
    const label = task?.label || /"(.+)"/.exec(summary)?.[1] || id;
    const code = /exit code (\d+)/.exec(summary)?.[1];
    const what = task?.agent || /agent/i.test(summary) ? 'Agente en segundo plano' : 'Comando en segundo plano';
    const verb = { completed: 'terminado', failed: 'ha fallado', killed: 'detenido', stopped: 'detenido' }[status] || status || 'terminado';
    note(t, `${what} «${label}» ${verb}${code && code !== '0' ? ` (código ${code})` : ''}`, status === 'completed' && (!code || code === '0') ? 'check' : 'x');
  }

  function interrupted(t) {
    const r = ensureReply(t);
    if (r.blocks.at(-1)?.type !== 'interrupted') r.blocks.push({ type: 'interrupted', text: INTERRUPTED });
    r.done = true;
    settleAll(t);
  }

  function onRecord(t, rec) {
    if (rec.isSidechain) return false;
    const conv = t.conv;
    switch (rec.type) {
      case 'permission-mode':
        if (rec.permissionMode) conv.permissionMode = rec.permissionMode;
        return true;
      case 'attachment': {
        const a = rec.attachment;
        if (a?.type === 'queued_command' && a.origin?.kind === 'human' && typeof a.prompt === 'string') { addUser(t, a.prompt); return true; }
        return false;
      }
      case 'system':
        if (rec.subtype === 'turn_duration') {
          const r = conv.messages.at(-1);
          if (r?.role === 'assistant') {
            let input = 0, cacheWrite = 0, cacheRead = 0, tokensOut = 0;
            for (const u of t.usage.values()) {
              input += u.input_tokens || 0; cacheWrite += u.cache_creation_input_tokens || 0;
              cacheRead += u.cache_read_input_tokens || 0; tokensOut += u.output_tokens || 0;
            }
            r.stats = { durationMs: rec.durationMs, input, cacheWrite, cacheRead, tokensOut };
            r.done = true;
          }
          settleAll(t);
          return true;
        }
        if (rec.subtype === 'compact_boundary') { note(t, 'Conversación compactada'); return true; }
        if (rec.subtype === 'local_command' && typeof rec.content === 'string') { onText(t, rec.content); return true; }
        if (rec.subtype === 'informational' && rec.content) { note(t, clean(rec.content)); return true; }
        return false;
      case 'user': {
        if (rec.isMeta || rec.isCompactSummary || rec.isVisibleInTranscriptOnly) return false;
        const content = rec.message?.content;
        if (typeof content === 'string') { onText(t, content); return true; }
        if (!Array.isArray(content)) return false;
        let text = '';
        const images = [];
        for (const b of content) {
          if (b.type === 'tool_result') onToolResult(t, b, rec.toolUseResult, rec.timestamp);
          else if (b.type === 'text') text += (text ? '\n' : '') + b.text;
          else if (b.type === 'image' && b.source?.type === 'base64' && b.source.data.length < MAX_IMAGE) {
            images.push(`data:${b.source.media_type};base64,${b.source.data}`);
          }
        }
        if (text.startsWith('[Request interrupted by user')) interrupted(t);
        else if (text.trim() || images.length) {
          if (text.includes('<command-name>') || text.includes('<local-command-stdout>')) onText(t, text);
          else if (text.startsWith('<task-notification>')) taskDone(t, text);
          else if (!text.startsWith('<system-reminder>')) addUser(t, text.replace(/\[Image #\d+\]\s*/g, '').trim(), images);
        }
        return true;
      }
      case 'assistant': {
        const msg = rec.message;
        if (!msg || !Array.isArray(msg.content)) return false;
        const r = ensureReply(t);
        if (msg.model === '<synthetic>') {
          const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
          if (text && text !== 'No response requested.') r.blocks.push({ type: rec.isApiErrorMessage ? 'error' : 'text', text });
          return true;
        }
        if (msg.id && msg.usage) { t.usage.set(msg.id, msg.usage); setContext(t, msg.usage); }
        for (const b of msg.content) {
          if (b.type === 'text' && b.text.trim()) r.blocks.push({ type: 'text', text: b.text });
          else if (b.type === 'thinking' && b.thinking?.trim()) r.blocks.push({ type: 'thinking', text: b.thinking });
          else if (b.type === 'tool_use') {
            if (b.name === 'TodoWrite') {
              conv.tasks = (b.input?.todos || []).map((x, i) => ({ id: String(i + 1), subject: x.content, activeForm: x.activeForm, status: x.status }));
            }
            const tool = { type: 'tool', id: b.id, name: b.name, input: cap(b.input) };
            t.tools.set(b.id, tool);
            t.toolAt.set(b.id, conv.messages.length - 1);
            t.keys.set(b.id, b.name + JSON.stringify(b.input));
            r.blocks.push(tool);
          }
        }
        return true;
      }
      default:
        return false;
    }
  }

  // Contexto ocupado: lo que entró en la última llamada al modelo (como el anillo del SDK)
  function setContext(t, u) {
    const used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const lim = ctxLimits(t.conv);
    if (!used || !lim?.max) return;
    t.conv.context = { used, max: lim.max, pct: Math.min(100, Math.round((used / lim.max) * 100)), compactAt: lim.compactAt ?? null };
  }

  function onToolResult(t, b, structured, timestamp) {
    const tool = t.tools.get(b.tool_use_id);
    if (!tool) return;
    t.dirty = Math.min(t.dirty, t.toolAt.get(b.tool_use_id) ?? 0);
    tool.result = cap(resultText(b.content));
    tool.isError = !!b.is_error;
    if (!tool.isError) applyTask(t.conv, tool, structured);
    // Comandos y agentes en segundo plano: siguen hasta su <task-notification>. Los de antes de
    // arrancar este Claude Code ya no corren (al salir los cierra)
    const bg = !tool.isError && /running in background with ID: (\S+?)\.?(\s|$)|agentId: (\w+)/.exec(tool.result);
    if (bg && Date.parse(timestamp || 0) >= t.startedAt - 5000) {
      const label = tool.input?.description || tool.input?.command || tool.name;
      t.conv.background = [...(t.conv.background || []).filter((x) => x.id !== (bg[1] || bg[3])), { id: bg[1] || bg[3], label: cap(label, 200), agent: !bg[1] }];
    }
    // Si el permiso se contestó en la terminal, la tarjeta sobra
    const key = t.keys.get(b.tool_use_id);
    for (const [pid, p] of t.pending) if (p.key === key) settle(t, pid, {});
  }

  // ---------- Hooks ----------
  function reply(res, out) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out || {}));
  }

  function onHook(t, input, res) {
    if (input.transcript_path) setTranscript(t, input.transcript_path);
    const ev = input.hook_event_name;
    if (ev === 'PermissionRequest') return onPermission(t, input, res);
    reply(res, {});
    if (ev === 'UserPromptSubmit') {
      t.conv.busy = true;
      flush(t, true);
    } else if (ev === 'Stop') {
      // El último texto llega a la transcripción después de este hook: la respuesta la cierra turn_duration
      read(t);
      settleAll(t);
      flush(t, true);
    } else if (ev === 'Notification' && ['permission_prompt', 'elicitation_dialog'].includes(input.notification_type)) {
      // Un diálogo que el chat no sabe enseñar: que la interfaz pase a la terminal
      setTimeout(() => {
        if (!t.pending.size && !t.conv.prompts.length) emit('termchat:attention', { convId: t.conv.id, message: input.message || '' });
      }, 800);
    }
    return undefined;
  }

  function onPermission(t, input, res) {
    const name = input.tool_name;
    const toolInput = input.tool_input || {};
    const kind = name === 'AskUserQuestion' ? 'question' : name === 'ExitPlanMode' ? 'plan' : 'permission';
    const prompt = { id: crypto.randomUUID(), kind, toolName: name, input: cap(toolInput, 8000), terminal: true };
    const suggestions = input.permission_suggestions || [];
    if (kind === 'permission') {
      prompt.canAlways = !!suggestions.length;
      prompt.alwaysLabel = describeSuggestions(suggestions);
    }
    // El plan no admite respuesta por el hook: se contesta tecleando en su diálogo
    if (kind === 'plan') reply(res, {});
    t.pending.set(prompt.id, { res: kind === 'plan' ? null : res, toolName: name, key: name + JSON.stringify(toolInput), suggestions, input: toolInput });
    res.on('close', () => { if (!res.writableEnded && kind !== 'plan') settle(t, prompt.id, null); });
    t.conv.prompts.push(prompt);
    t.conv.busy = true;
    flush(t, true);
    emit('prompt:new', { convId: t.conv.id, kind, title: t.conv.title });
  }

  function settle(t, promptId, out) {
    const p = t.pending.get(promptId);
    if (!p) return;
    t.pending.delete(promptId);
    t.conv.prompts = t.conv.prompts.filter((x) => x.id !== promptId);
    if (p.res && out) reply(p.res, out);
    flush(t, true);
  }
  function settleAll(t) { for (const id of [...t.pending.keys()]) settle(t, id, {}); }

  const decide = (decision) => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } });

  // Teclas con pausas, para que la interfaz de la terminal procese cada una
  function keys(id, seq) {
    let delay = 0;
    for (const k of seq) { setTimeout(() => write(id, k), delay); delay += 140; }
  }

  function respond(id, promptId, payload = {}) {
    const t = tabs.get(id);
    const p = t?.pending.get(promptId);
    const prompt = t?.conv.prompts.find((x) => x.id === promptId);
    if (!p || !prompt) return;
    if (prompt.kind === 'question') {
      if (payload.skip) return settle(t, promptId, decide({ behavior: 'deny', message: 'El usuario ha preferido no responder a las preguntas.' }));
      return settle(t, promptId, decide({ behavior: 'allow', updatedInput: { ...p.input, answers: payload.answers } }));
    }
    if (prompt.kind === 'plan') {
      // payload.option: número de la opción en el diálogo de la terminal
      const n = Math.max(1, Number(payload.option) || 1);
      const seq = Array(n - 1).fill('\x1b[B');
      if (payload.feedback?.trim()) seq.push(payload.feedback.trim().replace(/\r?\n/g, ' '));
      seq.push('\r');
      keys(id, seq);
      return settle(t, promptId, null);
    }
    if (payload.decision === 'allow') return settle(t, promptId, decide({ behavior: 'allow' }));
    if (payload.decision === 'always') {
      const mode = p.suggestions.find((s) => s.type === 'setMode')?.mode;
      if (mode) t.conv.permissionMode = mode;
      return settle(t, promptId, decide({ behavior: 'allow', updatedPermissions: p.suggestions }));
    }
    const fb = payload.feedback?.trim();
    return settle(t, promptId, decide({
      behavior: 'deny',
      message: fb ? `El usuario no lo permite y dice: ${fb}` : 'El usuario ha denegado el permiso.',
      interrupt: !fb,
    }));
  }

  // ---------- Ciclo de la pestaña ----------
  function start(id) {
    const t = tabs.get(id);
    if (!t || t.timer) return;
    // Lo que se envíe antes de que Claude Code esté listo espera en la cola (por si no llega el título, 15 s)
    t.ready = false;
    clearTimeout(t.readyTimer);
    t.readyTimer = setTimeout(() => markReady(t), 15000);
    t.startedAt = Date.now();
    t.conv.background = [];
    t.tick = 0;
    t.timer = setInterval(() => { if (t.watcher && !t.clearAt && ++t.tick % 4) return; read(t); }, POLL_MS);
    read(t);
  }

  // Claude Code no ha podido arrancar: se dice en el chat (lo que espera en la cola sigue ahí, con su ✕)
  function fail(id, text) {
    const t = tabs.get(id);
    if (!t) return;
    ensureReply(t).blocks.push({ type: 'error', text: cap(text, 3000) });
    closeReply(t);
    t.reply = null;
    flush(t, true);
  }

  // Claude Code espera una respuesta en su pantalla (p. ej. el aviso del acceso total): lo que se escriba
  // aguarda en la cola, porque su Intro contestaría a esa pregunta. Queda listo al poner su título
  function hold(id) {
    const t = tabs.get(id);
    if (!t) return;
    clearTimeout(t.readyTimer);
    clearTimeout(t.drainTimer);
    t.ready = false;
  }

  function stop(id) {
    const t = tabs.get(id);
    if (!t) return;
    clearInterval(t.timer);
    t.timer = null;
    t.ready = false;
    clearTimeout(t.readyTimer);
    read(t);
    settleAll(t);
    closeReply(t);
    t.conv.busy = false;
    t.conv.queue = [];
    t.conv.background = [];
    flush(t, true);
  }

  // Estado del título de la terminal: ✳ en espera, un spinner mientras trabaja. El título
  // parpadea a ✳ entre herramientas, así que el fin solo cuenta si dura; la respuesta la
  // cierran Stop, turn_duration o una interrupción
  function setBusy(id, busy) {
    const t = tabs.get(id);
    if (!t) return;
    clearTimeout(t.idleTimer);
    if (!t.ready) markReady(t, !busy);
    if (busy) {
      if (t.conv.busy) return;
      t.conv.busy = true;
      return flush(t, true);
    }
    if (!t.conv.busy) return;
    t.idleTimer = setTimeout(() => {
      if (!tabs.has(id) || !t.conv.busy) return;
      t.conv.busy = false;
      read(t);
      emit('chat:done', { convId: id, title: t.conv.title });
      flush(t, true);
      drain(t);
    }, 1500);
  }

  // La cola la guarda la app (no Claude Code) para poder quitar mensajes y devolverlos al cuadro
  // de texto con Esc: se envía uno a uno cuando la pestaña queda libre. Uno que no ponga a
  // trabajar a Claude (p. ej. /cost) no lo vuelve a liberar, así que se mira otra vez al rato
  function markReady(t, drainNow = true) {
    if (t.ready) return;
    t.ready = true;
    clearTimeout(t.readyTimer);
    if (drainNow) t.drainTimer = setTimeout(() => drain(t), 300);
  }

  function drain(t) {
    clearTimeout(t.drainTimer);
    t.drainTimer = null;
    if (t.conv.busy || !t.ready || !t.conv.queue.length || !tabs.has(t.conv.id)) return;
    const m = t.conv.queue.shift();
    deliver(t, m.text);
    flush(t, true);
    if (t.conv.queue.length) t.drainTimer = setTimeout(() => drain(t), 3000);
  }

  // Teclea un mensaje en la terminal y lo envía con Enter
  function deliver(t, full) {
    const id = t.conv.id;
    if (/^\/(clear|reset|new)\s*$/.test(full)) {
      // A veces la transcripción nueva no aparece hasta el siguiente mensaje: el chat se vacía ya
      t.clearAt = Date.now();
      t.conv.messages = [];
      t.conv.tasks = [];
      t.conv.context = null;
      t.reply = null;
      flush(t, true);
    }
    // Los comandos (/x) y el modo bash (!) se teclean; el resto se pega para conservar los saltos de línea
    if (/^[/!]/.test(full) && !full.includes('\n')) write(id, full);
    else write(id, `\x1b[200~${full}\x1b[201~`);
    setTimeout(() => write(id, '\r'), 120);
  }

  // Un mensaje del chat: se pega en la terminal y se envía con Enter
  function send(id, { text = '', images = [] } = {}) {
    const t = tabs.get(id);
    if (!t) return;
    // Las imágenes van a archivos temporales y se pega su ruta: Claude Code las adjunta
    const files = images.map(({ mediaType = '', data } = {}) => {
      const ext = mediaType.split('/')[1];
      if (!data || !ext) return null;
      const f = path.join(os.tmpdir(), `claude-assistant-${crypto.randomUUID().slice(0, 8)}.${ext === 'jpeg' ? 'jpg' : ext}`);
      fs.writeFileSync(f, Buffer.from(data, 'base64'));
      t.tmp.push(f);
      return /\s/.test(f) ? `"${f}"` : f;
    }).filter(Boolean);
    const full = [text, ...files].filter(Boolean).join(' ');
    if (!full) return;
    // Mientras trabaja (o mientras arranca), a la cola: se envía al terminar el turno
    if (t.conv.busy || !t.ready) {
      t.conv.queue.push({ id: crypto.randomUUID(), text: full });
      flush(t, true);
      return;
    }
    deliver(t, full);
  }

  // Retira un mensaje de la cola: su texto vuelve al cuadro de texto
  function unqueue(id, uuid) {
    const t = tabs.get(id);
    const m = t?.conv.queue.find((x) => x.id === uuid);
    if (!m) return null;
    t.conv.queue = t.conv.queue.filter((x) => x !== m);
    flush(t, true);
    return m.text;
  }

  // Enviar ya (Ctrl+Enter, como chat:sendNow de Claude Code): corta el turno y manda la cola
  // entera como un solo mensaje en cuanto la pestaña queda libre
  function sendNow(id) {
    const t = tabs.get(id);
    if (!t?.conv.queue.length) return false;
    clearTimeout(t.drainTimer);
    if (t.conv.queue.length > 1) t.conv.queue = [{ id: crypto.randomUUID(), text: t.conv.queue.map((m) => m.text).join('\n\n') }];
    if (t.conv.busy) write(id, '\x1b');
    else drain(t);
    flush(t, true);
    return true;
  }

  function interrupt(id) {
    const t = tabs.get(id);
    if (!t) return '';
    write(id, '\x1b');
    // Lo que estaba en cola vuelve al cuadro de texto, como en la terminal
    clearTimeout(t.drainTimer);
    const returned = t.conv.queue.splice(0).map((m) => m.text).filter(Boolean).join('\n\n');
    flush(t, true);
    return returned;
  }

  function detach(id) {
    const t = tabs.get(id);
    if (!t) return;
    clearInterval(t.timer);
    t.watcher?.close();
    clearTimeout(t.readSoon);
    clearTimeout(t.flushTimer);
    clearTimeout(t.idleTimer);
    clearTimeout(t.drainTimer);
    clearTimeout(t.readyTimer);
    settleAll(t);
    for (const f of t.tmp) fs.rm(f, { force: true }, () => {});
    tabs.delete(id);
  }

  // Imágenes pegadas que quedaron de otras veces (la app se cerró con la pestaña abierta)
  try {
    const old = Date.now() - 24 * 3600e3;
    for (const n of fs.readdirSync(os.tmpdir())) {
      if (!/^claude-assistant-[0-9a-f]{8}\.\w+$/.test(n)) continue;
      const f = path.join(os.tmpdir(), n);
      if (fs.statSync(f).mtimeMs < old) fs.rmSync(f, { force: true });
    }
  } catch {}

  function close() {
    for (const id of [...tabs.keys()]) detach(id);
    server.close();
  }

  return { hookSettings, attach, start, stop, fail, hold, setBusy, send, sendNow, interrupt, rewind, unqueue, respond, detach, close, has: (id) => tabs.has(id) };
}
