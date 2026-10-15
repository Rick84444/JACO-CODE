#!/usr/bin/env node
// Narrow Cloudflare MCP surface. All tools are read-only and use the runtime's token.
import readline from 'node:readline';
import { SecretStore } from '../../agents/lib/secret-store.mjs';

const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim().replace(/^bearer\s+/i, '');
const tools = [
  { name: 'verify_connection', description: 'Verify the configured Cloudflare account API token.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'list_workers', description: 'List Worker script names and deployment metadata in the configured Cloudflare account.', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
];

export async function callCloudflareTool(name, { fetchImpl = fetch, accountId, apiToken, store = new SecretStore() } = {}) {
  const endpoint = name === 'verify_connection' ? 'tokens/verify' : name === 'list_workers' ? 'workers/scripts' : null;
  if (!endpoint) throw new Error('CLOUDFLARE_TOOL_UNKNOWN');
  accountId ??= account || store.get('CLOUDFLARE_ACCOUNT_ID');
  apiToken ??= token || store.get('CLOUDFLARE_READ_API_TOKEN') || store.get('CLOUDFLARE_API_TOKEN');
  accountId = String(accountId || '').trim();
  apiToken = String(apiToken || '').trim().replace(/^bearer\s+/i, '');
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !apiToken) throw new Error('CLOUDFLARE_CREDENTIALS_UNAVAILABLE');
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/${endpoint}`, {
    headers: { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000),
  }).catch(error => { throw new Error(error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'CLOUDFLARE_TIMEOUT' : 'CLOUDFLARE_NETWORK_UNAVAILABLE'); });
  const body = await response.json().catch(() => { throw new Error('CLOUDFLARE_RESPONSE_INVALID'); });
  if (!response.ok || body.success !== true) {
    const code = response.status === 401 ? 'CLOUDFLARE_AUTHENTICATION_FAILED' : response.status === 403 ? 'CLOUDFLARE_PERMISSION_DENIED' : response.status === 429 ? 'CLOUDFLARE_RATE_LIMITED' : `CLOUDFLARE_HTTP_${response.status}`;
    throw new Error(code);
  }
  if (name === 'verify_connection') return { connected: body.result?.status === 'active', status: body.result?.status || 'unknown', accountId };
  return { accountId, workers: (Array.isArray(body.result) ? body.result : []).slice(0, 500).map(w => ({ name: w.id, createdOn: w.created_on || null, modifiedOn: w.modified_on || null })) };
}

if (process.argv[1]?.endsWith('cloudflare-read-mcp.mjs')) {
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  for await (const line of readline.createInterface({ input: process.stdin })) {
    let request;
    try { request = JSON.parse(line); } catch { continue; }
    if (request.id === undefined) continue;
    try {
      let result;
      if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-cloudflare-read', version: '1.0.0' } };
      else if (request.method === 'tools/list') result = { tools };
      else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify(await callCloudflareTool(request.params?.name)) }] };
      else throw new Error('MCP_METHOD_UNSUPPORTED');
      send({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: String(error?.message || error).slice(0, 160) } });
    }
  }
}
