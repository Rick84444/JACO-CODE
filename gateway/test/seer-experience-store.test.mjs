import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createExperienceStore,
  fingerprintExperience,
  tokenizeExperienceText,
} from '../src/seer-experience-store.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE experiences (
      id TEXT PRIMARY KEY,
      blueprint TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      uses INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 1.0,
      promoted_at INTEGER DEFAULT (unixepoch())
    );
  `);
  let sequence = 0;
  let clock = 1_700_000_000;
  const events = [];
  const store = createExperienceStore({
    db,
    uid: () => `exp-${++sequence}`,
    now: () => ++clock,
    emit: (type, payload) => events.push({ type, payload }),
  });
  return { db, store, events };
}

function action(overrides = {}) {
  return {
    id: overrides.id || 'action-1',
    type: overrides.type || 'http_retry',
    input: overrides.input || JSON.stringify({ client: 'fetch', retries: 4 }),
    precondition: overrides.precondition || JSON.stringify({ idempotent: true }),
    expected: overrides.expected || JSON.stringify({ tests_passed: true }),
    delta: overrides.delta ?? 0.02,
    ...overrides,
  };
}

test('startup migrates the legacy experiences table without dropping existing rows', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE experiences (
      id TEXT PRIMARY KEY,
      blueprint TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      uses INTEGER DEFAULT 0,
      success_rate REAL DEFAULT 1.0,
      promoted_at INTEGER DEFAULT (unixepoch())
    );
    INSERT INTO experiences(id,blueprint,tags)
    VALUES('legacy-1','{"type":"rollback","expected":{"safe":true}}','["rollback"]');
  `);
  const store = createExperienceStore({ db, uid: () => 'unused', now: () => 10 });
  const row = store.get('legacy-1');
  assert.equal(row.id, 'legacy-1');
  assert.equal(row.evidence_count, 1);
  assert.equal(row.mean_delta, 0);
  assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
  db.close();
});

test('search uses the query instead of returning the same global top list', () => {
  const { db, store } = fixture();
  const retry = store.promote(
    action({ id: 'retry-1', type: 'http_retry' }),
    { title: 'Gateway reliability', goal: 'Build a robust HTTP retry client with abort handling' },
    { tests_passed: true, coverage: 98 },
  );
  const rollback = store.promote(
    action({
      id: 'rollback-1',
      type: 'safe_rollback',
      input: JSON.stringify({ strategy: 'git worktree checkpoint' }),
      expected: JSON.stringify({ restored: true }),
      delta: 0.01,
    }),
    { title: 'Safe deploy rollback', goal: 'Restore the previous verified release without data loss' },
    { restored: true },
  );

  assert.equal(store.search('HTTP client retry', 3)[0].id, retry);
  assert.equal(store.search('safest rollback release', 3)[0].id, rollback);
  assert.deepEqual(store.search('quantum banana', 3), []);
  db.close();
});

test('repeated verified evidence reinforces one reusable experience instead of duplicating it', () => {
  const { db, store, events } = fixture();
  const first = store.promote(
    action({ id: 'a-1', delta: 0.02 }),
    { title: 'Gateway A', goal: 'Retry HTTP requests' },
    { tests_passed: true },
  );
  const second = store.promote(
    action({ id: 'a-2', delta: 0.08 }),
    { title: 'Gateway B', goal: 'Retry HTTP requests in another project' },
    { tests_passed: true, latency_ms: 40 },
  );

  assert.equal(second, first);
  const row = store.get(first);
  assert.equal(row.evidence_count, 2);
  assert.ok(Math.abs(row.mean_delta - 0.05) < 1e-9);
  assert.equal(row.blueprint.evidence.history.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM experiences').get().count, 1);
  assert.ok(events.some(event => event.type === 'experience.reinforced'));
  db.close();
});

test('usage outcomes update empirical success rate without being confused with evidence count', () => {
  const { db, store } = fixture();
  const id = store.promote(action(), { title: 'Gateway', goal: 'HTTP retry' }, { tests_passed: true });
  const success = store.recordUse(id, { success: true });
  const failure = store.recordUse(id, { success: false });

  assert.equal(success.uses, 1);
  assert.equal(success.success_rate, 1);
  assert.equal(failure.uses, 2);
  assert.equal(failure.success_rate, 0.5);
  assert.equal(failure.evidence_count, 1);
  db.close();
});

test('fingerprints are stable across object key ordering and tokenization bridges code identifiers', () => {
  const left = fingerprintExperience({
    type: 'safe_rollback',
    input: { retries: 3, client: 'fetch' },
    precondition: { b: 2, a: 1 },
    expected: { ok: true },
  });
  const right = fingerprintExperience({
    expected: { ok: true },
    precondition: { a: 1, b: 2 },
    input: { client: 'fetch', retries: 3 },
    type: 'safe_rollback',
  });
  assert.equal(left, right);
  assert.deepEqual(tokenizeExperienceText('safe_rollback HTTP-client'), ['safe', 'rollback', 'http', 'client']);
});
