import test from 'node:test';
import assert from 'node:assert/strict';
import { remoteReport, formatReport } from '../../agents/lib/activate.mjs';

const routes = map => async url => {
  const hit = Object.entries(map).find(([prefix]) => url.startsWith(prefix));
  if (!hit) throw new Error('fetch failed');
  const [status, body] = hit[1];
  return { status, ok: status < 400, json: async () => body };
};

test('a local-only install is not reported as a remote problem', async () => {
  const r = await remoteReport({ env: {}, fetchImpl: async () => { throw Error('MUST_NOT_CALL'); } });
  assert.deepEqual([r.configured, r.problems.length], [false, 0]);
});

test('the IDE address, the gateway and its browser are checked when remote access is configured', async () => {
  const env = { JACO_IDE_PUBLIC_HOST: 'ide.example.com', JACO_ENABLE_CHATGPT_GATEWAY: '1', JACO_GATEWAY_PUBLIC_URL: 'https://api.example.com' };
  const r = await remoteReport({ env, fetchImpl: routes({
    'https://ide.example.com/ide-login': [200, {}],
    'http://127.0.0.1:4250/health': [503, { ok: false, nova: { ok: false, state: 'CDP_UNREACHABLE' } }],
    'https://api.example.com/health': [503, { ok: false }],
  }) });
  assert.equal(r.ide.reachable, true);
  assert.deepEqual([r.gateway.up, r.gateway.healthy, r.gateway.browser, r.gateway.publicReachable], [true, false, 'CDP_UNREACHABLE', true]);
  assert.equal(r.problems.length, 1); assert.match(r.problems[0], /CDP_UNREACHABLE/);
  assert.match(formatReport({ ok: false, runtime: { up: true }, tools: { toolCount: 0, ready: 0, servers: [] }, providers: [], remote: r, problems: r.problems }), /Fjärråtkomst:[\s\S]*IDE[\s\S]*Gateway/);
});

test('missing addresses and an unreachable gateway become concrete problems', async () => {
  const r = await remoteReport({ env: { JACO_ENABLE_CHATGPT_GATEWAY: '1' }, fetchImpl: routes({}) });
  assert.ok(r.problems.some(p => /JACO_IDE_PUBLIC_HOST/.test(p)));
  assert.ok(r.problems.some(p => /svarar inte lokalt/.test(p)));
  assert.ok(r.problems.some(p => /JACO_GATEWAY_PUBLIC_URL/.test(p)));
});
