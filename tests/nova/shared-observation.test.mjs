import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedObservation } from '../../runtime/src/server/connected/sharedObservation.mjs';

test('concurrent observers share work; TTL starts when observation finishes', async () => {
  let clock = 0, calls = 0, finish;
  const read = sharedObservation(() => { calls++; return new Promise(resolve => { finish = resolve; }); }, { ttlMs: 10, now: () => clock });
  const a = read(), b = read();
  assert.equal(a, b);
  await Promise.resolve();
  clock = 100; finish('observed');
  assert.equal(await a, 'observed');
  clock = 109; assert.equal(await read(), 'observed');
  assert.equal(calls, 1);
  clock = 110; const next = read(); await Promise.resolve();
  assert.equal(calls, 2); finish('new'); await next;
});

test('failed reads can retry and invalidated pending reads cannot overwrite new observations', async () => {
  let calls = 0;
  const retry = sharedObservation(async () => { if (++calls === 1) throw Error('offline'); return 'ok'; });
  await assert.rejects(retry(), /offline/);
  assert.equal(await retry(), 'ok');
  const finish = [];
  const read = sharedObservation(() => new Promise(resolve => finish.push(resolve)));
  const old = read(); await Promise.resolve();
  read.invalidate();
  const fresh = read(); await Promise.resolve();
  finish[1]('fresh'); await fresh;
  finish[0]('old'); await old;
  assert.equal(await read(), 'fresh');
});

test('stale mode answers at once with the last observation while a slow refresh runs', async () => {
  let clock = 0, calls = 0; const finish = [];
  const read = sharedObservation(() => { calls++; return new Promise(resolve => finish.push(resolve)); }, { ttlMs: 10, now: () => clock, stale: true });
  const first = read(); await Promise.resolve(); finish[0]('first');
  assert.equal(await first, 'first', 'the first read waits: there is nothing to serve yet');
  clock = 50;
  assert.equal(await read(), 'first', 'an expired value is served without waiting');
  assert.equal(await read(), 'first'); await Promise.resolve();
  assert.equal(calls, 2, 'one background refresh, not one per read');
  finish[1]('second'); await new Promise(r => setImmediate(r));
  assert.equal(await read(), 'second');
});
