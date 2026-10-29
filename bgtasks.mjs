// Tareas en segundo plano de una pestaña (lo que /tasks enseña en Claude Code): su salida y detenerlas.
// - Comandos: Claude Code escribe la salida en tasks\<id>.output; el proceso es un shell que cuelga del
//   `claude` de la pestaña y lleva en su línea de órdenes esa ruta (PowerShell) o el comando (Bash).
// - Agentes: su transcripción, en <sesión>\subagents\agent-<id>.jsonl. Corren dentro de Claude Code:
//   no hay proceso que detener.
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const TAIL = 64 * 1024; // lo último de la salida que se enseña

function tail(file, max = TAIL) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, max);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return { text: buf.toString('utf8'), cut: size > len, size };
  } finally { fs.closeSync(fd); }
}

// Del agente: lo que va contando y las herramientas que usa, como en el detalle de /tasks
function agentLines(text) {
  const lines = [];
  for (const l of text.split('\n')) {
    let rec;
    try { rec = JSON.parse(l); } catch { continue; }
    const content = rec.message?.content;
    if (rec.type !== 'assistant' || !Array.isArray(content)) continue;
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) lines.push(b.text.trim());
      else if (b.type === 'tool_use') {
        const i = b.input || {};
        const what = i.description || i.command || i.file_path || i.pattern || i.url || i.query || '';
        lines.push(`● ${b.name}${what ? `(${String(what).split('\n')[0].slice(0, 160)})` : ''}`);
      }
    }
  }
  return lines.join('\n');
}

export function readOutput(task) {
  if (!task?.output) return { text: '', missing: true };
  try {
    const r = tail(task.output, task.agent ? 512 * 1024 : TAIL);
    // Sin códigos de color ni retornos de carro que reescriben la línea
    const text = task.agent ? agentLines(r.text) : r.text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[^\n]*\r(?!\n)/g, '');
    return { text: text.slice(-TAIL), cut: r.cut, size: r.size };
  } catch { return { text: '', missing: true }; }
}

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', timeout: 15000, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, out) => resolve(err ? null : out));
  });
}

async function processes() {
  if (IS_WIN) {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress']);
    try { return [].concat(JSON.parse(out)).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, cmd: p.CommandLine || '' })); } catch { return []; }
  }
  const out = await run('ps', ['-A', '-ww', '-o', 'pid=,ppid=,args=']);
  return (out || '').split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
}

// Sin comillas, barras ni espacios: así coincide aunque el shell lo haya escapado a su manera
const flat = (s) => String(s).replace(/['"`^\\/\s]/g, '').toLowerCase();

// El proceso de la tarea: el más alto, entre los descendientes del `claude` de la pestaña, que la nombra
function findTask(list, rootPid, task) {
  const kids = new Map();
  for (const p of list) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  const keys = [`${task.id}.output`, task.command && `eval${flat(task.command)}`, task.command && flat(task.command)].filter(Boolean).map(flat);
  for (const key of keys) {
    // A lo ancho: el primero que aparece es el más cercano al `claude`
    const queue = [...(kids.get(rootPid) || [])];
    const seen = new Set();
    while (queue.length) {
      const p = queue.shift();
      if (seen.has(p.pid)) continue;
      seen.add(p.pid);
      if (key.length > 3 && flat(p.cmd).includes(key)) return { proc: p, kids };
      queue.push(...(kids.get(p.pid) || []));
    }
  }
  return null;
}

export async function stopTask(rootPid, task) {
  if (!rootPid || !task || task.agent) return false;
  const found = findTask(await processes(), rootPid, task);
  if (!found) return false;
  const { proc, kids } = found;
  if (IS_WIN) return (await run('taskkill', ['/PID', String(proc.pid), '/T', '/F'])) !== null;
  // Linux y macOS: el árbol entero, de las hojas hacia arriba
  const all = [];
  const stack = [proc.pid];
  while (stack.length) { const p = stack.pop(); all.push(p); stack.push(...(kids.get(p) || []).map((k) => k.pid)); }
  for (const p of all.reverse()) { try { process.kill(p, 'SIGTERM'); } catch {} }
  setTimeout(() => { for (const p of all) { try { process.kill(p, 'SIGKILL'); } catch {} } }, 3000);
  return true;
}
