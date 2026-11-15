// Built-in stdio MCP adapter for Aura's own browser. It forwards tools/list and tools/call to the existing CDP MCP
// facade (agents/cdp-bridge.mjs on loopback, Bearer token), so the MCP host's access levels, deny lists and approval
// rules apply to browser actions like any other tool. Browser control and its origin policy stay in nova-bridge:
// reading any public page, clicking and typing only on JACO_BROWSER_ALLOWED_ORIGINS.
import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CALL_TIMEOUT_MS = 60_000;

export function bridgeConfig(env = process.env) {
  const port = Number(env.JACO_CDP_BRIDGE_PORT || 2996);
  return { url: `http://127.0.0.1:${port}/mcp`, token: env.JACO_GATEWAY_TOKEN || env.GATEWAY_TOKEN || '' };
}

async function forward(method, params, { env = process.env, fetchFn = globalThis.fetch } = {}) {
  const { url, token } = bridgeConfig(env);
  if (token.length < 24) throw Error('GATEWAY_TOKEN_REQUIRED_MIN_24');
  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) { throw Error(e?.name === 'TimeoutError' ? 'BROWSER_BRIDGE_TIMEOUT' : 'BROWSER_BRIDGE_UNREACHABLE'); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw Error(`BROWSER_BRIDGE_HTTP_${response.status}`);
  if (payload.error) throw Error(String(payload.error.message || 'BROWSER_BRIDGE_ERROR').slice(0, 240));
  return payload.result;
}

export async function handleBrowserMcp(msg, options = {}) {
  if (!msg || msg.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-browser', version: '1.0.0' } });
  if (msg.method === 'ping') return reply({});
  if (msg.method === 'tools/list') {
    try { return reply({ tools: (await forward('tools/list', {}, options))?.tools || [] }); }
    catch (e) { return { jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: String(e?.message || e) } }; }
  }
  if (msg.method !== 'tools/call') return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'METHOD_NOT_FOUND' } };
  try { return reply(await forward('tools/call', { name: msg.params?.name, arguments: msg.params?.arguments || {} }, options)); }
  catch (e) { return reply({ isError: true, content: [{ type: 'text', text: String(e?.message || e).slice(0, 240) }] }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const out = await handleBrowserMcp(msg); if (out) send(out);
  });
}
