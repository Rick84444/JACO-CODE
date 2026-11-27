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

// 2026-11-27: the IDE polls every 3 s and the connector observation expired after 2.5 s, so every poll waited
// ~0.7 s for the bridges to be asked again. A slightly older observation is answered at once while it refreshes.
test('a recently expired observation is answered at once and refreshed behind it', async () => {
  let clock = 0; const finish = [];
  const read = sharedObservation(() => new Promise(resolve => finish.push(resolve)), { ttlMs: 10, staleMs: 100, now: () => clock });
  const first = read(); await Promise.resolve(); finish[0]('one'); await first;
  clock = 50;
  assert.equal(await read(), 'one', 'answered without waiting for the refresh');
  assert.equal(await read(), 'one');
  assert.equal(finish.length, 2, 'one refresh at a time');
  finish[1]('two'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await read(), 'two');
});

test('an observation older than the stale limit, or invalidated, is waited for', async () => {
  let clock = 0; const finish = [];
  const read = sharedObservation(() => new Promise(resolve => finish.push(resolve)), { ttlMs: 10, staleMs: 100, now: () => clock });
  const first = read(); await Promise.resolve(); finish[0]('one'); await first;
  clock = 200;
  const late = read(); await Promise.resolve(); finish[1]('two');
  assert.equal(await late, 'two');
  read.invalidate();
  const changed = read(); await Promise.resolve(); finish[2]('three');
  assert.equal(await changed, 'three', 'a configuration change is never answered with the old observation');
});

test('a failed background refresh keeps the last observation and is reported once it is too old', async () => {
  let clock = 0, calls = 0;
  const read = sharedObservation(async () => { if (++calls > 1) throw Error('offline'); return 'one'; }, { ttlMs: 10, staleMs: 100, now: () => clock });
  await read(); clock = 50;
  assert.equal(await read(), 'one');
  await new Promise(resolve => setImmediate(resolve));
  clock = 200;
  await assert.rejects(read(), /offline/);
});

test('the runtime answers connector polls from a recent observation', async () => {
  const fs = await import('node:fs');
  const server = fs.readFileSync(new URL('../../runtime/server.ts', import.meta.url), 'utf8');
  const start = server.indexOf('const getAuraMcpFabric = sharedObservation(');
  const end = server.indexOf('const getAuraWorkbenchWorkplace', start);
  assert.match(server.slice(start, end), /\}, \{ staleMs: 15_000 \}\);/);
});
