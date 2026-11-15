import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBrowserMcp, bridgeConfig } from '../../runtime/tools/jaco-browser-mcp.mjs';
import { defaultServers } from '../../runtime/src/server/mcp/stdioMcpHost.mjs';

const env = { JACO_GATEWAY_TOKEN: 't'.repeat(32), JACO_CDP_BRIDGE_PORT: '2999' };

test('the browser adapter forwards tools/list and tools/call to the loopback CDP bridge with the token', async () => {
  const seen = [];
  const fetchFn = async (url, init) => {
    seen.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    const { method } = JSON.parse(init.body);
    return Response.json({ jsonrpc: '2.0', id: 1, result: method === 'tools/list'
      ? { tools: [{ name: 'nova_navigate', annotations: { readOnlyHint: false } }] }
      : { content: [{ type: 'text', text: 'navigated' }] } });
  };
  const listed = await handleBrowserMcp({ id: 1, method: 'tools/list' }, { env, fetchFn });
  assert.deepEqual(listed.result.tools.map(t => t.name), ['nova_navigate']);
  const called = await handleBrowserMcp({ id: 2, method: 'tools/call', params: { name: 'nova_navigate', arguments: { url: 'https://example.com', actionId: 'a1' } } }, { env, fetchFn });
  assert.equal(called.result.content[0].text, 'navigated');
  assert.equal(seen[1].url, 'http://127.0.0.1:2999/mcp');
  assert.equal(seen[1].auth, `Bearer ${env.JACO_GATEWAY_TOKEN}`);
  assert.deepEqual(seen[1].body.params, { name: 'nova_navigate', arguments: { url: 'https://example.com', actionId: 'a1' } });
});

test('without a token or a running bridge the adapter reports why instead of pretending', async () => {
  const noToken = await handleBrowserMcp({ id: 1, method: 'tools/call', params: { name: 'nova_targets' } }, { env: {}, fetchFn: async () => assert.fail('no call without a token') });
  assert.match(noToken.result.content[0].text, /GATEWAY_TOKEN_REQUIRED/);
  const down = await handleBrowserMcp({ id: 2, method: 'tools/call', params: { name: 'nova_targets' } }, { env, fetchFn: async () => { throw new TypeError('fetch failed'); } });
  assert.equal(down.result.isError, true);
  assert.match(down.result.content[0].text, /BROWSER_BRIDGE_UNREACHABLE/);
  assert.equal(bridgeConfig({}).url, 'http://127.0.0.1:2996/mcp');
});

test('the full runtime offers the browser server to agents, and JACO_ENABLE_CDP=0 removes it', () => {
  const roots = { repoRoot: '/repo', runtimeRoot: '/repo/runtime' };
  const before = process.env.JACO_ENABLE_CDP;
  try {
    delete process.env.JACO_ENABLE_CDP;
    assert.equal(defaultServers(roots).browser?.agentAccess, 'write');
    process.env.JACO_ENABLE_CDP = '0';
    assert.equal(defaultServers(roots).browser, undefined);
  } finally { if (before === undefined) delete process.env.JACO_ENABLE_CDP; else process.env.JACO_ENABLE_CDP = before; }
});
