// Pruebas del servidor MCP por HTTP (mcp-http.mjs): npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { createHttpMcp } from '../mcp-http.mjs';

test('initialize, tools/list y tools/call', async () => {
  const mcp = createHttpMcp({
    name: 'prueba',
    instructions: 'Instrucciones',
    tools: [{ name: 'eco', description: 'Repite', shape: { text: z.string(), n: z.number().int().default(1) }, run: ({ text, n }) => ({ content: [{ type: 'text', text: text.repeat(n) }] }) }],
  });
  while (!mcp.config()) await new Promise((r) => setTimeout(r, 10));
  const { url } = mcp.config();
  const rpc = async (body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
    return res.status === 202 ? null : res.json();
  };
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(init.result.serverInfo.name, 'prueba');
  assert.equal(init.result.instructions, 'Instrucciones');
  assert.equal(await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools[0].inputSchema.required, ['text']);
  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'eco', arguments: { text: 'ab', n: 2 } } });
  assert.equal(call.result.content[0].text, 'abab');
  const bad = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'eco', arguments: {} } });
  assert.equal(bad.result.isError, true);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'nada' })).error.code, -32601);
  assert.equal((await fetch(url.replace(/k=\w+/, 'k=mal'), { method: 'POST', body: '{}' })).status, 403);
  mcp.close();
});
