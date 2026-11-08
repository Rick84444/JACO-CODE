import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { QuickTunnel, phoneName, pairingLink } from '../../runtime/src/server/connected/jacocloud.mjs';
import { createIdeRemoteGate, tunnelHosts, LOGIN_SCRIPT } from '../../runtime/src/server/connected/ideAccess.mjs';
import { DEVICE_NAME } from '../../runtime/src/server/connected/deviceAccess.mjs';

// A cloudflared that prints what the real one prints when the address is ready.
function fakeSpawn(output) {
  const children = [];
  const spawn = (cmd, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.killed = false; child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', 0)); };
    child.cmd = cmd; child.args = args; children.push(child);
    if (output) setImmediate(() => child.stderr.emit('data', Buffer.from(output)));
    return child;
  };
  return { spawn, children };
}

test('the tunnel reports the temporary address Cloudflare gives and opens only that host to the IDE gate', async () => {
  const hosts = new Set();
  const { spawn, children } = fakeSpawn('INF |  https://calm-river-example.trycloudflare.com  |\n');
  const tunnel = new QuickTunnel({ spawn, hosts, env: {} });
  const status = await tunnel.start('http://127.0.0.1:3000');
  assert.equal(status.state, 'on');
  assert.equal(status.url, 'https://calm-river-example.trycloudflare.com');
  assert.deepEqual([...hosts], ['calm-river-example.trycloudflare.com']);
  assert.deepEqual(children[0].args, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:3000']);
  tunnel.stop();
  assert.equal(children[0].killed, true);
  assert.equal(tunnel.status().state, 'off');
  assert.equal(hosts.size, 0, 'the host is closed again when the tunnel stops');
});

test('only a local address can be tunnelled, and a second start is refused', async () => {
  const { spawn } = fakeSpawn('https://a-b.trycloudflare.com');
  const tunnel = new QuickTunnel({ spawn, hosts: new Set(), env: {} });
  for (const target of ['http://192.168.1.5:3000', 'https://example.com', 'http://127.0.0.1.evil.test']) await assert.rejects(tunnel.start(target), /TUNNEL_TARGET_MUST_BE_LOCAL/);
  await tunnel.start('http://localhost:3000');
  await assert.rejects(tunnel.start('http://127.0.0.1:3000'), /TUNNEL_ALREADY_RUNNING/);
  tunnel.stop();
});

test('a missing cloudflared and a tunnel that never answers end in a clear error, not a hang', async () => {
  const missing = new QuickTunnel({ hosts: new Set(), env: { JACO_CLOUDFLARED: 'definitely-not-installed-cloudflared' } });
  await assert.rejects(missing.start('http://127.0.0.1:3000'), /CLOUDFLARED_MISSING/);
  assert.equal(missing.status().error, 'CLOUDFLARED_MISSING');
  const { spawn } = fakeSpawn('');
  const silent = new QuickTunnel({ spawn, hosts: new Set(), env: {}, timeoutMs: 30 });
  await assert.rejects(silent.start('http://127.0.0.1:3000'), /TUNNEL_START_TIMEOUT/);
});

test('a tunnel that dies leaves no open host behind', async () => {
  const hosts = new Set();
  const { spawn, children } = fakeSpawn('https://x-y.trycloudflare.com');
  const tunnel = new QuickTunnel({ spawn, hosts, env: {} });
  await tunnel.start('http://127.0.0.1:3000');
  children[0].emit('close', 1);
  assert.equal(tunnel.status().state, 'off');
  assert.equal(hosts.size, 0);
});

// The gate as the tunnel sees it.
const res = () => { const r = { code: 200, headers: {}, body: null, redirected: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, setHeader(k, v) { r.headers[k] = v; }, end(b) { r.body = b; return r; }, redirect(c, to) { r.code = c; r.redirected = to; return r; } }; return r; };
const request = (host, extra = {}) => ({ method: 'GET', path: '/', headers: { host, 'cf-connecting-ip': '203.0.113.9', ...extra.headers }, ...extra });

test('through a quick tunnel the IDE gate serves only the running tunnel host and still demands a paired device', () => {
  const gate = createIdeRemoteGate({ verify: () => null, redeem: () => { throw new Error('PAIRING_CODE_INVALID_OR_EXPIRED'); } }, { env: {} });
  const host = 'quiet-lake-example.trycloudflare.com';
  const before = res(); gate(request(host), before, () => assert.fail('must not pass'));
  assert.equal(before.code, 403); assert.equal(before.body.error, 'HOST_NOT_SERVED');
  tunnelHosts.add(host);
  try {
    const login = res(); gate({ ...request(host), path: '/ide-login' }, login, () => assert.fail('login is served by the gate'));
    assert.equal(login.code, 200);
    const app = res(); gate(request(host), app, () => assert.fail('no session, no IDE'));
    assert.equal(app.code, 302); assert.equal(app.redirected, '/ide-login');
    const other = res(); gate(request('someone-else.trycloudflare.com'), other, () => assert.fail('another host'));
    assert.equal(other.code, 403);
  } finally { tunnelHosts.delete(host); }
});

test('a change through the tunnel must come from the page of the host that was asked', () => {
  const host = 'bright-field-example.trycloudflare.com';
  const session = { name: 'phone-abc' };
  const gate = createIdeRemoteGate({ verify: () => session, redeem: () => ({}) }, { env: {} });
  tunnelHosts.add(host);
  try {
    const wrong = res(); gate({ ...request(host, { headers: { host, origin: 'https://evil.example', 'cf-connecting-ip': '203.0.113.9' } }), method: 'POST', path: '/api/aura/chat' }, wrong, () => assert.fail('cross origin'));
    assert.equal(wrong.body.error, 'CROSS_ORIGIN_DENIED');
    let passed = false;
    gate({ ...request(host, { headers: { host, origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.9' } }), method: 'POST', path: '/api/aura/chat' }, res(), () => { passed = true; });
    assert.equal(passed, true);
  } finally { tunnelHosts.delete(host); }
});

test('the QR link carries the code in the fragment, which the sign-in page reads once and removes', () => {
  assert.equal(pairingLink('https://a-b.trycloudflare.com', 'ABCDE-FGHJK'), 'https://a-b.trycloudflare.com/ide-login#code=ABCDE-FGHJK');
  assert.match(LOGIN_SCRIPT, /location\.hash/);
  assert.match(LOGIN_SCRIPT, /history\.replaceState/);
  assert.doesNotThrow(() => new Function('document', 'location', 'history', 'fetch', 'setTimeout', LOGIN_SCRIPT.replace(/f\.addEventListener[\s\S]*$/, '')));
  assert.match(phoneName(), DEVICE_NAME);
});

test('only the interface on this computer can start JacoCloud or pair a phone: not a paired phone, not the agent shell', async () => {
  const server = fs.readFileSync(new URL('../../runtime/server.ts', import.meta.url), 'utf8');
  for (const route of ["post('/api/aura/jacocloud/start'", "post('/api/aura/jacocloud/invite'", "post('/api/aura/jacocloud/stop'", "delete('/api/aura/jacocloud/devices/:name'"])
    assert.match(server, new RegExp(`app\\.${route.replace(/[()/:]/g, '\\$&')}, requireJacoCloudLocal`), route);
  assert.match(server, /ideSession\) return res\.status\(403\)\.json\(\{ success: false, error: 'JACOCLOUD_LOCAL_ONLY'/);
  const { operatorApprovalCheck } = await import('../../agents/lib/operator-action-guard.mjs');
  for (const command of ['curl -X POST http://127.0.0.1:3000/api/aura/jacocloud/invite', 'curl -X POST http://127.0.0.1:3000/api/connected/devices/invite -d "{}"'])
    for (const sandbox of [false, true]) assert.match(String(operatorApprovalCheck({ type: 'shell', data: { command } }, { sandbox })?.reason), /operator-only setting/, command);
});
