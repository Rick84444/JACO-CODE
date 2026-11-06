import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { learningStore } from '../../agents/lib/skill-learning.mjs';
import { verifiedOutcomeHints } from '../../agents/lib/verified-outcome-context.mjs';
import { contextPacketIntro } from '../../agents/lib/agent-loop.mjs';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-outcomes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return learningStore(dir);
}
const contract = { scope: { allowed: ['src/**'] } };
const receipt = (id, type, ok = true) => ({
  actionId: id, type, ok, verified: ok,
  input: type === 'repo-write' ? { path: 'src/client.mjs', content: 'secrets-must-not-cross' } : { path: 'src/client.mjs' },
});

test('historical recall retains original verification and never promotes failed missions to stale knowledge', t => {
  const store = setup(t);
  store.recordOutcome({
    id: 'mission-good', status: 'DONE', contract,
    contractStatus: { machineVerified: true },
    preflight: { repository: { revision: 'sha-good' } },
    receipts: [receipt('mission-good:turn:1', 'repo-read'), receipt('mission-good:turn:2', 'repo-write')],
  });
  store.recordOutcome({
    id: 'mission-failed', status: 'BLOCKED', contract,
    contractStatus: { machineVerified: false },
    preflight: { repository: { revision: 'sha-good' } },
    receipts: [receipt('mission-failed:turn:1', 'repo-write', false)],
  });
  const recalled = store.recallOutcome(contract, 'new-sha', { limit: 10 });
  const good = recalled.find(o => o.missionId === 'mission-good');
  const failed = recalled.find(o => o.missionId === 'mission-failed');
  assert.equal(good.originalVerificationStatus, 'VERIFIED');
  assert.equal(good.verificationStatus, 'STALE');
  assert.equal(failed.originalVerificationStatus, 'UNVERIFIED');
  assert.equal(failed.verificationStatus, 'UNVERIFIED');
  const hints = JSON.parse(verifiedOutcomeHints(recalled, ['repo-read', 'repo-write', 'skill-load']));
  assert.deepEqual(hints.map(h => h.sourceMission), ['mission-good']);
  assert.equal(hints[0].verification, 'STALE_REQUIRES_REVALIDATION');
  assert.ok(hints[0].sequence.some(h => h.tool === 'repo-write'));
  assert.doesNotMatch(JSON.stringify(hints), /secrets-must-not-cross/);
});

test('verified evidence with an unchanged revision is labelled verified but never expands permitted tools', t => {
  const store = setup(t);
  store.recordOutcome({
    id: 'mission-executed', status: 'DONE', contract,
    contractStatus: { machineVerified: true },
    preflight: { repository: { revision: 'sha-good' } },
    receipts: [receipt('mission-executed:turn:1', 'repo-read'), receipt('mission-executed:turn:2', 'repo-write')],
  });
  const records = store.recallOutcome(contract, 'sha-good');
  const hints = JSON.parse(verifiedOutcomeHints(records, ['repo-read']));
  assert.equal(hints.length, 1);
  assert.equal(hints[0].verification, 'VERIFIED_FOR_RECORDED_REVISION');
  assert.deepEqual(hints[0].worked, ['repo-read']);
  assert.deepEqual(hints[0].sequence.map(item => item.tool), ['repo-read']);
  assert.doesNotMatch(JSON.stringify(hints), /repo-write/);
  assert.ok(hints[0].evidenceCount >= 1);
});

test('native context includes historical evidence with a revalidation warning but no new authority', t => {
  const store = setup(t);
  store.recordOutcome({
    id: 'past-mission', status: 'DONE', contract,
    contractStatus: { machineVerified: true },
    preflight: { repository: { revision: 'sha-good' } },
    receipts: [receipt('past-mission:turn:1', 'repo-read')],
  });
  const text = contextPacketIntro({ id: 'current', goal: 'Inspect code', allowedTasks: ['repo-read'] },
    { learnedOutcomes: store.recallOutcome(contract, 'different-revision') });
  assert.match(text, /Historical verified execution evidence/);
  assert.match(text, /STALE_REQUIRES_REVALIDATION/);
  assert.match(text, /ST[A]LE records MUST be retested/);
  assert.doesNotMatch(text, /secrets-must-not-cross/);
  assert.deepEqual(JSON.parse(verifiedOutcomeHints([], ['repo-read'] ) || '[]'), []);
});
