import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorldState,
  createTransition,
  createExperienceReceipt,
  canReplayTransition,
} from '../../runtime/src/server/continuum/cognitiveExecutionContracts.mjs';

test('accepted world state requires observation evidence', () => {
  assert.throws(() => createWorldState({ id: 'A', status: 'ACCEPTED', confidence: .99 }), /REQUIRES_EVIDENCE/);
});

test('verified transition requires a verification receipt', () => {
  assert.throws(() => createTransition({ id: 't1', fromStateId: 'A', intent: 'focus-terminal', expectedStateId: 'B', status: 'VERIFIED' }), /REQUIRES_RECEIPT/);
});

test('evidence cannot be promoted from an unverified outcome', () => {
  assert.throws(() => createExperienceReceipt({
    id: 'r1', missionId: 'm1', evidenceLevel: 'TARGET_HOST_VERIFIED', createdAt: new Date(0).toISOString(),
    verification: { expectedStateId: 'B', observedStateId: 'P', preconditionsVerified: true, postconditionsVerified: false, outcome: 'FAILED' },
  }), /PROMOTION_REQUIRES_VERIFIED_OUTCOME/);
});

test('blind replay is refused after popup/state divergence', () => {
  const stateA = createWorldState({ id: 'A', observationIds: ['o1'], status: 'ACCEPTED', confidence: .99 });
  const popup = createWorldState({ id: 'P', observationIds: ['o2'], status: 'ACCEPTED', confidence: .99 });
  const transition = createTransition({
    id: 't1', fromStateId: 'A', intent: 'focus-terminal', expectedStateId: 'B',
    status: 'VERIFIED', evidenceReceiptIds: ['r1'],
  });
  assert.deepEqual(canReplayTransition({ transition, currentState: stateA }), { ok: true, reason: 'VERIFIED_ROUTE_AVAILABLE' });
  assert.deepEqual(canReplayTransition({ transition, currentState: popup }), { ok: false, reason: 'STATE_MISMATCH' });
});

test('low-confidence localization cannot authorize replay', () => {
  const uncertain = createWorldState({ id: 'A', observationIds: ['o1'], status: 'ACCEPTED', confidence: .71 });
  const transition = createTransition({
    id: 't1', fromStateId: 'A', intent: 'focus-terminal', expectedStateId: 'B',
    status: 'VERIFIED', evidenceReceiptIds: ['r1'],
  });
  assert.deepEqual(canReplayTransition({ transition, currentState: uncertain }), { ok: false, reason: 'LOCALIZATION_CONFIDENCE_TOO_LOW' });
});
