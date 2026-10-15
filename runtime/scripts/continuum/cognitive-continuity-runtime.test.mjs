import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ContinuumEventStore } from '../../src/server/continuum/eventStore.mjs';
import { CognitiveContinuityRuntime } from '../../src/server/continuum/cognitiveContinuityRuntime.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-cognitive-continuity-'));
const ledgerRoot = path.join(root, 'ledger');

const mission = {
  id: 'mission-connected-1',
  goal: 'Stabilize JACO runtime and prove restart continuity',
  status: 'ACTIVE',
  phase: 'EXECUTING',
  turn: 7,
  failures: 1,
  allowedTasks: ['repo-read', 'repo-write', 'repo-test'],
  receipts: [
    { type: 'repo-read', ok: true, verified: true, at: '2026-09-26T00:00:00.000Z' },
    { type: 'repo-test', ok: false, verified: false, error: 'TEST_FAILED', at: '2026-09-26T00:00:01.000Z' },
  ],
};

const missionSource = {
  current: () => mission,
  get: (id) => {
    if (id !== mission.id) throw new Error(`mission '${id}' not found`);
    return mission;
  },
};

const hypotheses = {
  get: (id) => {
    if (id !== 'hyp-1') throw new Error(`hypothesis set '${id}' not found`);
    return { id, status: 'OPEN' };
  },
  list: () => [{
    id: 'hyp-1',
    missionId: null,
    problem: 'Which restart recovery path preserves verified state?',
    status: 'OPEN',
    candidates: [{ id: 'candidate-1', label: 'event replay', status: 'EVALUATED' }],
  }],
};

const selfModel = {
  snapshot: () => ({
    unknowns: ['target_host_restart_not_yet_observed'],
    repository: { status: 'SCANNED', snapshotHash: 'repo-hash' },
    knowledge: { count: 4, verified: 3 },
    capabilities: [{
      capability: 'restart-recovery',
      state: 'PROVISIONALLY_RELIABLE',
      verifiedAttempts: 3,
      conservativeReliability: 0.4385,
    }],
  }),
};

try {
  const events1 = new ContinuumEventStore(ledgerRoot);
  const continuity1 = new CognitiveContinuityRuntime({
    events: events1,
    selfModel,
    hypotheses,
    continuityId: 'jaco:primary',
  });
  continuity1.setMissionSource(missionSource);

  const initial = continuity1.modelEnvelope();
  assert.equal(initial.missionAuthority, 'CONNECTED_DURABLE_NOVA');
  assert.equal(initial.objective, mission.goal);
  assert.equal(initial.focus.mission.id, mission.id);
  assert.equal(initial.revision, 0);

  const first = continuity1.applyDelta({
    focusMissionId: mission.id,
    focusHypothesisSetId: 'hyp-1',
    attention: 'Prove restart continuity before expanding autonomy.',
    openQuestions: ['Does restored working state survive a fresh runtime instance?'],
    nextActions: ['Create checkpoint', 'Re-open runtime over same ledger', 'Compare state'],
    workingRefs: ['mission:mission-connected-1', 'hypothesis:hyp-1'],
    lastModelId: 'test-model',
  }, 'test');

  assert.equal(first.revision, 1);
  assert.equal(first.focusMissionId, mission.id);
  assert.equal(first.focusHypothesisSetId, 'hyp-1');

  const checkpoint = continuity1.checkpoint('before-restart', 'test');
  assert.ok(checkpoint.id);
  assert.equal(checkpoint.state.revision, 1);

  continuity1.applyDelta({
    attention: 'Temporary divergent working state',
    openQuestions: ['This should disappear after restore'],
    nextActions: ['wrong branch'],
  }, 'test');

  const restored = continuity1.restoreCheckpoint(checkpoint.id, 'test');
  assert.equal(restored.revision, 3);
  assert.equal(restored.attention, 'Prove restart continuity before expanding autonomy.');
  assert.deepEqual(restored.openQuestions, ['Does restored working state survive a fresh runtime instance?']);
  assert.deepEqual(restored.nextActions, ['Create checkpoint', 'Re-open runtime over same ledger', 'Compare state']);

  // Simulated clean runtime shutdown: the canonical writer must release its
  // lock before a fresh process/runtime can become the next writer.
  assert.equal(events1.close(), true);
  assert.equal(fs.existsSync(path.join(ledgerRoot, 'events.lock')), false);

  // Simulated runtime restart: a fresh EventStore + fresh continuity object over
  // the same persisted hash-chain must reconstruct the same working state.
  const events2 = new ContinuumEventStore(ledgerRoot);
  const continuity2 = new CognitiveContinuityRuntime({
    events: events2,
    selfModel,
    hypotheses,
    continuityId: 'jaco:primary',
  });
  continuity2.setMissionSource(missionSource);

  const afterRestart = continuity2.state();
  assert.deepEqual(afterRestart, restored);

  const envelope = continuity2.modelEnvelope();
  assert.equal(envelope.objective, mission.goal);
  assert.equal(envelope.focus.mission.receiptsTotal, 2);
  assert.equal(envelope.workingState.attention, restored.attention);
  assert.equal(envelope.unresolved.hypotheses[0].id, 'hyp-1');
  assert.equal(envelope.invariants.missionStateOwnedExternally, true);
  assert.equal(envelope.invariants.continuityStateStoredInHashChainedEventLedger, true);

  assert.throws(
    () => continuity2.applyDelta({ focusMissionId: 'mission-missing' }, 'test'),
    /not found/,
  );
  assert.throws(
    () => continuity2.applyDelta({ inventedAuthority: true }, 'test'),
    /CONTINUITY_FIELD_NOT_ALLOWED/,
  );

  const integrity = events2.verify();
  assert.equal(integrity.valid, true);
  assert.ok(integrity.count >= 4);

  // Restoring cognitive working state must not mutate the canonical mission.
  assert.equal(mission.status, 'ACTIVE');
  assert.equal(mission.turn, 7);

  assert.equal(events2.close(), true);
  assert.equal(fs.existsSync(path.join(ledgerRoot, 'events.lock')), false);

  console.log('PASS cognitive continuity runtime restart/recovery');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
