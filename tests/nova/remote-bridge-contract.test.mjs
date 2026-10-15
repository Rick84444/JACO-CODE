import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRemoteBridge } from '../../agents/remote-bridge.mjs';

const remoteBridgeSource = readFileSync(new URL('../../agents/remote-bridge.mjs', import.meta.url), 'utf8');

const TOKEN = 'remote-bridge-test-token-1234567890';

function listen(server) {
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function postJson(base, path, body, token = TOKEN) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function rpc(method, params = undefined, id = 1) {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

test('remote bridge exposes health without claiming browser verification', async () => {
  const server = createRemoteBridge({ token: TOKEN, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'jaco-remote-bridge');
    assert.equal(body.browserVerified, false);
  } finally {
    server.close();
  }
});

test('remote bridge requires bearer auth for MCP tools', async () => {
  const server = createRemoteBridge({ token: TOKEN, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rpc('tools/list')),
    });
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test('remote bridge publishes a small semantic tool surface', async () => {
  const server = createRemoteBridge({ token: TOKEN, fetchImpl: async () => { throw new Error('unexpected fetch'); } });
  const port = await listen(server);
  try {
    const response = await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/list'));
    const body = await response.json();
    const names = body.result.tools.map(tool => tool.name).sort();
    assert.deepEqual(names, ['remote_action', 'remote_observe', 'remote_status', 'remote_windows']);
    const action = body.result.tools.find(tool => tool.name === 'remote_action');
    assert.deepEqual(action.inputSchema.required, ['surface', 'missionId', 'mandateId', 'action']);
  } finally {
    server.close();
  }
});

test('remote bridge fails closed for mutations until explicitly enabled', async () => {
  const server = createRemoteBridge({ token: TOKEN, allowMutations: false, fetchImpl: async () => { throw new Error('unexpected mutation fetch'); } });
  const port = await listen(server);
  try {
    const response = await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/call', {
      name: 'remote_action',
      arguments: {
        surface: 'DESKTOP',
        missionId: 'mission-1',
        mandateId: 'mandate-1',
        action: { type: 'focus', hwnd: 1 },
      },
    }));
    const body = await response.json();
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(body.result.isError, true);
    assert.equal(payload.error, 'REMOTE_MUTATIONS_DISABLED');
  } finally {
    server.close();
  }
});

test('remote status is ready only when relay and a real surface are observed', async () => {
  const fetchImpl = async url => {
    const payload = String(url).includes('/api/relay/status')
      ? { success: true, singleWriter: true }
      : String(url).includes('/api/desktop/hands-off/status')
        ? { success: true, status: { evidenceState: 'OBSERVED' } }
        : { success: true };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = createRemoteBridge({ token: TOKEN, fetchImpl });
  const port = await listen(server);
  try {
    const response = await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/call', { name: 'remote_status', arguments: {} }));
    const body = await response.json();
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.ready, true);
    assert.equal(payload.protocol, 'JACO-REMOTE-ACTUATOR/1');
  } finally {
    server.close();
  }
});



test('remote bridge uses canonical Android status and observation routes', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/api/hands-off/status')) {
      return new Response(JSON.stringify({ success: true, surface: 'ANDROID', status: { connected: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/api/nova/traction/android-action')) {
      return new Response(JSON.stringify({ success: true, receipt: { verified: true, action_type: 'observe_screen' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = createRemoteBridge({ token: TOKEN, fetchImpl });
  const port = await listen(server);
  try {
    await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/call', { name: 'remote_status', arguments: {} }));
    await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/call', { name: 'remote_observe', arguments: { surface: 'ANDROID', packageName: 'com.example.app' } }));
    assert.ok(calls.some(call => call.url.endsWith('/api/hands-off/status')));
    const observe = calls.find(call => call.url.endsWith('/api/nova/traction/android-action'));
    assert.equal(observe.body.action.type, 'observe_screen');
    assert.equal(observe.body.action.package_name, 'com.example.app');
  } finally {
    server.close();
  }
});

test('remote mutation preserves unknown outcome for runtime 409', async () => {
  const fetchImpl = async url => {
    if (String(url).endsWith('/api/relay/action')) {
      return new Response(JSON.stringify({
        success: false,
        error: 'unverified state transition',
        receipt: { verified: false, action_type: 'invoke' },
      }), { status: 409, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const server = createRemoteBridge({ token: TOKEN, allowMutations: true, fetchImpl });
  const port = await listen(server);
  try {
    const response = await postJson(`http://127.0.0.1:${port}`, '/mcp', rpc('tools/call', {
      name: 'remote_action',
      arguments: {
        surface: 'DESKTOP',
        missionId: 'mission-1',
        mandateId: 'mandate-1',
        action: { type: 'invoke', selector: { name: 'Save' } },
      },
    }));
    const body = await response.json();
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(body.result.isError, true);
    assert.equal(payload.outcomeUnknown, true);
  } finally {
    server.close();
  }
});

test('remote bridge registers with Workplace when run standalone', () => {
  assert.match(remoteBridgeSource, /joinWorkplace/);
  assert.match(remoteBridgeSource, /stableId: 'remote-bridge'/);
  assert.match(remoteBridgeSource, /name: 'Remote Bridge'/);
});
