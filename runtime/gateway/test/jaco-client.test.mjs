import test from 'node:test';
import assert from 'node:assert/strict';
import { JacoClient, JacoApiError } from '../../src/sdk/jaco-client.mjs';
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('chat sends message and text; normalizes reply', async () => {
  let req;
  const client = new JacoClient({ fetchImpl: async (_url, init) => { req = init; return response({ reply: 'Hej' }); } });
  const result = await client.chat.send('Hallå');
  assert.equal(req.method, 'POST');
  assert.deepEqual(JSON.parse(req.body), { message: 'Hallå', text: 'Hallå' });
  assert.equal(result.response, 'Hej');
});

test('failed mutation is never retried; error is propagated', async () => {
  let calls = 0;
  const client = new JacoClient({ retries: 3, retryDelayMs: 0, fetchImpl: async () => { calls++; return response({ success: false, error: 'GATE_BLOCKED' }, 503); } });
  await assert.rejects(() => client.missions.startGoal('Test'), e => e instanceof JacoApiError && e.code === 'GATE_BLOCKED');
  assert.equal(calls, 1);
});

test('GET retries transient errors but not denied requests', async () => {
  let calls = 0;
  const client = new JacoClient({ retries: 2, retryDelayMs: 0, fetchImpl: async () => { calls++; return response(calls === 1 ? { error: 'BUSY' } : { ok: true }, calls === 1 ? 503 : 200); } });
  assert.equal((await client.workbench.status()).ok, true);
  assert.equal(calls, 2);
  let denied = 0;
  const forbidden = new JacoClient({ fetchImpl: async () => { denied++; return response({ error: 'FORBIDDEN' }, 403); } });
  await assert.rejects(() => forbidden.workbench.status(), /FORBIDDEN/);
  assert.equal(denied, 1);
});

test('token stays on configured origin and is never sent to arbitrary URL', async () => {
  let target, auth;
  const client = new JacoClient({ endpoint: 'http://127.0.0.1:3000', token: 'dummy-secret', fetchImpl: async (url, init) => { target = url; auth = init.headers['x-gateway-token']; return response({ success: true }); } });
  await client.request('/api/aura/workbench');
  assert.equal(auth, 'dummy-secret');
  assert.equal(target, 'http://127.0.0.1:3000/api/aura/workbench');
  await assert.rejects(() => client.request('https://example.org/secret'), /relative/);
  await assert.rejects(() => client.request('//example.org/secret'), /relative/);
});

test('provider and approval contracts', async () => {
  const calls = [];
  const client = new JacoClient({ fetchImpl: async (_url, init) => {
    calls.push(init);
    return response(init.method === 'GET' ? { providers: { active: [{ id: 'ollama' }] }, approvals: { items: [{ id: 'ap1' }] } } : { success: true });
  } });
  assert.equal((await client.providers.list())[0].id, 'ollama');
  assert.equal((await client.approvals.list())[0].id, 'ap1');
  await client.approvals.decide('ap1', 'approved');
  assert.equal(JSON.parse(calls.at(-1).body).decision, 'approve');
  assert.throws(() => client.approvals.decide('ap1', 'invalid'), /Invalid approval/);
});

test('external cancellation aborts the request', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = new JacoClient({ retries: 0, fetchImpl: (_url, init) => {
    assert.equal(init.signal.aborted, true);
    return Promise.reject(init.signal.reason);
  } });
  await assert.rejects(() => client.request('/test', { signal: controller.signal }));
});
