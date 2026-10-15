#!/usr/bin/env node
/**
 * JACO local semantic MCP adapter.
 *
 * This adapter never exposes raw CDP Runtime.evaluate, shell execution or direct
 * credential entry. It forwards semantic calls to the authenticated JACO runtime.
 */
const BASE = (process.env.JACO_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';
const MODEL_ID = process.env.JACO_MODEL_ID || 'mcp-client';
const PROTOCOL = '2024-11-05';

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (TOKEN) headers['x-gateway-token'] = TOKEN;
  headers['x-jaco-model-id'] = MODEL_ID;
  const response = await fetch(`${BASE}${path}`, { ...options, headers, signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(`${response.status} ${data?.error?.message || data?.error || text.slice(0, 300)}`);
  return data;
}

const TOOLS = [
  { name: 'jaco_identity', description: 'Read the canonical JACO runtime identity and active release.', inputSchema: { type: 'object', properties: {} } },
  { name: 'jaco_hands_off_status', description: 'Read Browser/Desktop/Android Hands-Off status, writer leases and SEER live state.', inputSchema: { type: 'object', properties: {} } },
  { name: 'jaco_browser_targets', description: 'List safe metadata for Chrome CDP page targets. Raw debugger WebSocket URLs are not returned.', inputSchema: { type: 'object', properties: { port: { type: 'number' } } } },
  { name: 'jaco_browser_attach', description: 'Attach Browser Hands-Off to one already-open Chrome tab by URL fragment.', inputSchema: { type: 'object', properties: { urlIncludes: { type: 'string' }, port: { type: 'number' } }, required: ['urlIncludes'] } },
  { name: 'jaco_browser_survey', description: 'Survey the attached page and persist reusable semantic routes.', inputSchema: { type: 'object', properties: { label: { type: 'string' } } } },
  { name: 'jaco_nova_begin', description: 'Begin a Nova traction intent before targeted actuation.', inputSchema: { type: 'object', properties: { intent: { type: 'string' }, expectedNextState: { type: 'string' } }, required: ['intent'] } },
  { name: 'jaco_nova_target', description: 'Acquire a semantic Nova target lock. Confidence >=0.7 is required for target-bearing mutations.', inputSchema: { type: 'object', properties: { semanticPurpose: { type: 'string' }, role: { type: 'string' }, text: { type: 'string' }, confidence: { type: 'number' }, source: { type: 'string', enum: ['accessibility','dom','vision','fusion'] } }, required: ['semanticPurpose'] } },
  { name: 'jaco_mandates', description: 'List operator-created autonomy mandates. This MCP adapter cannot sign its own mandate.', inputSchema: { type: 'object', properties: {} } },
  { name: 'jaco_relay_action', description: 'Execute one semantic action through the JACO autonomy contract, single-writer lease, Nova and verified receipt pipeline.', inputSchema: { type: 'object', properties: { surface: { type: 'string', enum: ['BROWSER','DESKTOP','ANDROID'] }, mandateId: { type: 'string' }, missionId: { type: 'string' }, consequence: { type: 'string', enum: ['READ','LOCAL_MUTATION','EXTERNAL_MUTATION','PUBLISH','FINANCIAL','AUTH','SECURITY','DESTRUCTIVE'] }, action: { type: 'object' } }, required: ['surface','mandateId','action'] } },
  { name: 'jaco_browser_receipts', description: 'Read recent Browser Hands-Off verified receipts and route-memory statistics.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
];

function content(value) { return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }; }
async function call(name, a = {}) {
  switch (name) {
    case 'jaco_identity': return content(await api('/api/runtime/identity'));
    case 'jaco_hands_off_status': return content(await api('/api/hands-off/unified/status'));
    case 'jaco_browser_targets': return content(await api(`/api/browser/hands-off/targets${a.port ? `?port=${encodeURIComponent(a.port)}` : ''}`));
    case 'jaco_browser_attach': return content(await api('/api/browser/hands-off/attach', { method: 'POST', body: JSON.stringify({ urlIncludes: a.urlIncludes, port: a.port }) }));
    case 'jaco_browser_survey': return content(await api('/api/browser/hands-off/survey', { method: 'POST', body: JSON.stringify({ label: a.label }) }));
    case 'jaco_nova_begin': return content(await api('/api/nova/traction/begin', { method: 'POST', body: JSON.stringify({ intent: a.intent, expectedNextState: a.expectedNextState }) }));
    case 'jaco_nova_target': return content(await api('/api/nova/traction/target', { method: 'POST', body: JSON.stringify(a) }));
    case 'jaco_mandates': return content(await api('/api/relay/mandates'));
    case 'jaco_relay_action': return content(await api('/api/relay/action', { method: 'POST', body: JSON.stringify({ modelId: MODEL_ID, surface: a.surface, mandateId: a.mandateId, missionId: a.missionId, consequence: a.consequence, action: a.action }) }));
    case 'jaco_browser_receipts': return content(await api(`/api/browser/hands-off/receipts?limit=${encodeURIComponent(a.limit || 20)}`));
    default: throw new Error(`unknown tool ${name}`);
  }
}
function ok(id, result) { return { jsonrpc: '2.0', id, result }; }
function err(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }
async function handle(msg) {
  if (msg.method === 'initialize') return ok(msg.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'jaco-autonomus-ide', version: '0.19.1-rc1' } });
  if (msg.method === 'notifications/initialized') return null;
  if (msg.method === 'tools/list') return ok(msg.id, { tools: TOOLS });
  if (msg.method === 'tools/call') {
    try { return ok(msg.id, await call(msg.params?.name, msg.params?.arguments || {})); }
    catch (e) { return ok(msg.id, { ...content({ error: e instanceof Error ? e.message : String(e) }), isError: true }); }
  }
  if (msg.method === 'ping') return ok(msg.id, {});
  return err(msg.id, -32601, `unknown method ${msg.method}`);
}
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', async chunk => {
  buffer += chunk;
  let cut;
  while ((cut = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, cut).trim(); buffer = buffer.slice(cut + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    const reply = await handle(msg).catch(e => err(msg.id, -32603, e instanceof Error ? e.message : String(e)));
    if (reply) process.stdout.write(JSON.stringify(reply) + '\n');
  }
});
