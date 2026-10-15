import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DurableMissionBus} from '../../runtime/src/server/connected/durableMissionBus.mjs';
import {NovaMissionControl} from '../../runtime/src/server/connected/novaMissionControl.mjs';
import {DeviceRegistry, mountDeviceRoutes} from '../../runtime/src/server/connected/deviceAccess.mjs';
import {MissionClient, processMissionTurn} from '../../agents/lib/mission-client.mjs';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-test-'));
  const bus = new DurableMissionBus(dir);
  const control = new NovaMissionControl(bus, {allowedTasks: ['health-check']});
  const registry = new DeviceRegistry(path.join(dir, 'devices.json'));
  t.after(() => { bus.close(); fs.rmSync(dir, {recursive: true, force: true}); });
  const routes = new Map();
  const operatorAuth = (req, res, next) => (req.headers['x-gateway-token'] === 'op' ? next() : res.status(401).json({success: false}));
  const reg = method => (p, ...handlers) => routes.set(`${method} ${p}`, handlers);
  mountDeviceRoutes({get: reg('GET'), post: reg('POST'), delete: reg('DELETE')}, operatorAuth, control, registry);
  // Express-like dispatch: the device routes are reached through /v1/device/* on the gateway, which
  // forwards to /api/connected/device/* on the runtime.
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    let p = u.pathname.replace(/^\/v1\/device/, '/api/connected/device');
    const m = p.match(/^(\/api\/connected\/device\/missions\/)([^/]+)(\/.*)?$/);
    const key = m ? `${m[1]}:id${m[3] || ''}` : p;
    const handlers = routes.get(`${opts.method} ${key}`);
    assert.ok(handlers, `route ${opts.method} ${key}`);
    const headers = Object.fromEntries(Object.entries(opts.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const req = {headers, body: opts.body ? JSON.parse(opts.body) : undefined, params: {id: m?.[2], name: p.split('/').pop()}, query: {}};
    let status = 200, data;
    const res = {status(n) { status = n; return this; }, json(v) { data = v; }};
    let i = 0;
    const next = () => { const h = handlers[i++]; h(req, res, next); };
    next();
    return {ok: status === 200, status, json: async () => data};
  };
  return {control, registry, fetchImpl};
}

test('a device key is shown once, stored only as a hash, and stops working when revoked', t => {
  const s = setup(t);
  assert.throws(() => s.registry.add('Laptop!'), /INVALID_DEVICE_NAME/);
  const {device, key} = s.registry.add('laptop');
  assert.equal(device.executor, 'nova@laptop');
  assert.match(key, /^jdev_/);
  assert.ok(!fs.readFileSync(s.registry.file, 'utf8').includes(key));
  assert.equal(s.registry.verify(key).name, 'laptop');
  assert.equal(s.registry.verify('jdev_wrong'), null);
  assert.equal(s.registry.verify(process.env.JACO_GATEWAY_TOKEN || 'gateway-token'), null);
  s.registry.revoke('laptop');
  assert.equal(s.registry.verify(key), null);
});

test('a device Nova runs only the missions routed to it, through its key', async t => {
  const s = setup(t);
  const {key} = s.registry.add('laptop');
  const hub = s.control.create({goal: 'Kontrollera hubbens hälsa och rapportera', idempotencyKey: 'hub-1'});
  const mine = s.control.create({goal: 'Kontrollera laptopens hälsa och rapportera', idempotencyKey: 'dev-1', executor: 'nova@laptop'});
  const client = new MissionClient('https://hub.example', key, s.fetchImpl, 'nova@laptop', {device: true});
  assert.equal((await client.current()).id, mine.id);
  await assert.rejects(client.get(hub.id), /MISSION_EXECUTOR_MISMATCH/);
  await assert.rejects(client.claim(hub.id, 'nova-laptop'), /MISSION_EXECUTOR_MISMATCH/);
  let ran = 0;
  const r = await processMissionTurn({client, owner: 'nova-laptop', acceptMission: m => m.metadata.executor === client.executor,
    plan: async () => ({task: {type: 'health-check', data: {}}}), execute: async () => { ran++; return {ok: true}; }});
  assert.equal(ran, 1);
  assert.equal(r.receipt.ok, true);
  assert.equal(s.control.get(mine.id).receipts.length, 1);
  assert.equal(s.control.get(hub.id).receipts.length, 0);
});

test('without a valid device key nothing is readable, and the gateway token is not a device key', async t => {
  const s = setup(t);
  s.registry.add('phone');
  s.control.create({goal: 'Kontrollera telefonens hälsa och rapportera', idempotencyKey: 'dev-2', executor: 'nova@phone'});
  for (const key of ['', 'jdev_guess', 'op']) {
    const client = new MissionClient('https://hub.example', key, s.fetchImpl, 'nova@phone', {device: true});
    await assert.rejects(client.current(), /DEVICE_KEY_INVALID|MISSION_HTTP_401/);
  }
  const {key} = s.registry.add('phone');
  const phone = new MissionClient('https://hub.example', key, s.fetchImpl, 'nova@phone', {device: true});
  assert.ok(await phone.current());
});

test('a pairing code works once, only before it expires, and wrong guesses lock pairing', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-pair-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  let clock = Date.parse('2026-10-04T12:00:00Z');
  const registry = new DeviceRegistry(path.join(dir, 'devices.json'), {now: () => new Date(clock).toISOString()});
  const invite = registry.invite('laptop');
  assert.match(invite.code, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
  assert.ok(!fs.readFileSync(registry.file, 'utf8').includes(invite.code.replace('-', '')));
  const {device, key} = registry.redeem(invite.code.toLowerCase().replace('-', ' '));
  assert.equal(device.executor, 'nova@laptop');
  assert.equal(registry.verify(key).name, 'laptop');
  assert.throws(() => registry.redeem(invite.code), /PAIRING_CODE_INVALID_OR_EXPIRED/);
  const late = registry.invite('phone');
  clock += 10 * 60_000 + 1;
  assert.throws(() => registry.redeem(late.code), /PAIRING_CODE_INVALID_OR_EXPIRED/);
  const fresh = registry.invite('phone');
  // The wrong guess at the old code is outside the 10-minute window now; the late code counts: 1 + 19 = 20.
  for (let i = 0; i < 19; i++) assert.throws(() => registry.redeem('AAAAA-AAAAA'), /PAIRING_CODE_INVALID_OR_EXPIRED/);
  assert.throws(() => registry.redeem(fresh.code), /PAIRING_LOCKED_TRY_LATER/);
  clock += 10 * 60_000 + 1;
  assert.throws(() => registry.redeem(fresh.code), /PAIRING_CODE_INVALID_OR_EXPIRED/);
  assert.equal(registry.redeem(registry.invite('phone').code).device.name, 'phone');
});

test('the pairing route turns a code into a working device key, and operators cannot read keys', async t => {
  const s = setup(t);
  const invite = s.registry.invite('laptop');
  const pair = await s.fetchImpl('https://hub.example/v1/device/pair', {method: 'POST', headers: {}, body: JSON.stringify({code: invite.code})});
  const paired = await pair.json();
  assert.equal(paired.success, true);
  const client = new MissionClient('https://hub.example', paired.key, s.fetchImpl, 'nova@laptop', {device: true});
  assert.equal(await client.current(), null);
  const list = await s.fetchImpl('https://hub.example/api/connected/devices', {method: 'GET', headers: {'x-gateway-token': 'op'}});
  const listed = JSON.stringify(await list.json());
  assert.ok(!listed.includes(paired.key));
  assert.ok(!listed.includes('keyHash'));
});

test('joining a hub updates only the three device lines of .env', async () => {
  const {updateEnv} = await import('../../tools/join-hub.mjs');
  const before = 'DEEPSEEK_API_KEY=abc\r\nJACO_DEVICE_KEY=jdev_old\r\n# note\r\n';
  const after = updateEnv(before, {JACO_HUB_URL: 'https://hub.example', JACO_DEVICE_KEY: 'jdev_new', JACO_NOVA_EXECUTOR: 'nova@laptop'});
  assert.equal(after, 'DEEPSEEK_API_KEY=abc\r\nJACO_DEVICE_KEY=jdev_new\r\n# note\r\nJACO_HUB_URL=https://hub.example\r\nJACO_NOVA_EXECUTOR=nova@laptop\r\n');
  assert.equal(updateEnv('', {A: '1'}), 'A=1\n');
});
