// Servidor MCP mínimo por HTTP (en local) para las pestañas de terminal: Claude Code se conecta
// con --mcp-config { type: 'http', url }. Solo herramientas, con respuestas JSON (sin SSE).
import http from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';

/**
 * @param {object} o
 * @param {string} o.name
 * @param {string} [o.instructions]
 * @param {{ name, description, shape, run }[]} o.tools  shape: campos zod; run(args, { tab }) → { content }
 *   (tab: el ?tab= que se añade a la url de config(), para saber desde qué pestaña llaman)
 * @returns {{ config: () => object | null, close }}  config: la entrada de mcpServers (null hasta que escucha)
 */
export function createHttpMcp({ name, version = '1.0.0', instructions = '', tools }) {
  const token = crypto.randomBytes(16).toString('hex');
  const byName = new Map(tools.map((t) => [t.name, { ...t, schema: z.object(t.shape) }]));
  let port = 0;

  async function call(msg, ctx) {
    const { method, params = {} } = msg;
    if (method === 'initialize') {
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name, version },
        ...(instructions ? { instructions } : {}),
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') {
      return {
        tools: [...byName.values()].map((t) => {
          const { $schema, ...inputSchema } = z.toJSONSchema(t.schema, { io: 'input' });
          return { name: t.name, description: t.description, inputSchema };
        }),
      };
    }
    if (method === 'tools/call') {
      const t = byName.get(params.name);
      if (!t) throw Object.assign(new Error(`Herramienta desconocida: ${params.name}`), { code: -32602 });
      const args = t.schema.safeParse(params.arguments || {});
      if (!args.success) return { content: [{ type: 'text', text: `Argumentos no válidos: ${args.error.message}` }], isError: true };
      try {
        return await t.run(args.data, ctx);
      } catch (err) {
        return { content: [{ type: 'text', text: err?.message || String(err) }], isError: true };
      }
    }
    throw Object.assign(new Error(`Método no admitido: ${method}`), { code: -32601 });
  }

  const reply = async (msg, ctx) => {
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await call(msg, ctx) };
    } catch (err) {
      return { jsonrpc: '2.0', id: msg.id, error: { code: err.code || -32603, message: err.message } };
    }
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.searchParams.get('k') !== token) { res.writeHead(403).end(); return; }
    // Sin flujo SSE del servidor ni sesiones que cerrar
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido' } }));
        return;
      }
      const batch = Array.isArray(msg) ? msg : [msg];
      // Las notificaciones (sin id) no llevan respuesta
      const out = await Promise.all(batch.filter((m) => m && m.id != null && m.method).map((m) => reply(m, { tab: url.searchParams.get('tab') || null })));
      if (!out.length) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(Array.isArray(msg) ? out : out[0]));
    });
  });
  server.requestTimeout = 0;
  server.listen(0, '127.0.0.1', () => { port = server.address().port; });

  return {
    config: () => (port ? { type: 'http', url: `http://127.0.0.1:${port}/mcp?k=${token}` } : null),
    close: () => server.close(),
  };
}
