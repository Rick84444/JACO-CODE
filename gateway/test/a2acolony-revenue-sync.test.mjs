import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStrategicKernel } from '../src/seer-strategy.mjs';
import { createA2AColonyRevenueSync } from '../src/a2acolony-revenue-sync.mjs';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => Math.floor(Date.now() / 1000);

function makeStrategy() {
  const db = new DatabaseSync(':memory:');
  return createStrategicKernel({ db, uid, now });
}

test('sync is a no-op without an API key and never fabricates revenue', async () => {
  const strategy = makeStrategy();
  const dir = mkdtempSync(join(tmpdir(), 'a2acolony-sync-'));
  const sync = createA2AColonyRevenueSync({
    strategy,
    apiKey: '',
    statePath: join(dir, 'state.json'),
    fetchImpl: async () => { throw new Error('must not be called without an API key'); },
  });
  const result = await sync.syncOnce();
  assert.equal(result.skipped, 'NO_API_KEY');
  assert.equal(strategy.economy.summary().revenue, 0);
});

test('records new verified acquisitions into strategy.economy and dedupes on replay', async () => {
  const strategy = makeStrategy();
  const dir = mkdtempSync(join(tmpdir(), 'a2acolony-sync-'));
  const statePath = join(dir, 'state.json');
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        acquisitions: [
          { id: 'acq-1', amount_usd: 12.5, skill: 'a2a-smart-contract-auditor' },
          { id: 'acq-2', amount_usd: 4, skill: 'a2a-smart-contract-auditor' },
        ],
      }),
    };
  };
  const sync = createA2AColonyRevenueSync({ strategy, apiKey: 'test-key', statePath, fetchImpl });

  const first = await sync.syncOnce();
  assert.equal(first.recorded.length, 2);
  assert.equal(strategy.economy.summary().revenue, 16.5);
  assert.ok(existsSync(statePath));
  assert.deepEqual(JSON.parse(readFileSync(statePath, 'utf8')).syncedIds.sort(), ['acq-1', 'acq-2']);

  // Same two acquisitions come back on a second poll (API is not itself deduped) — must not double-count.
  const second = await sync.syncOnce();
  assert.equal(second.recorded.length, 0);
  assert.equal(strategy.economy.summary().revenue, 16.5);
  assert.equal(calls, 2);
});

test('a bad HTTP response is a hard error, not a silently swallowed zero', async () => {
  const strategy = makeStrategy();
  const dir = mkdtempSync(join(tmpdir(), 'a2acolony-sync-'));
  const sync = createA2AColonyRevenueSync({
    strategy,
    apiKey: 'test-key',
    statePath: join(dir, 'state.json'),
    fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(() => sync.syncOnce(), /A2ACOLONY_HTTP_401/);
});
