// The overview reads the observed Gameboard only. It must say what is true: waiting on a model is not
// blocked, paused work needs the operator, and a missing observation is never shown as progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAuraWork, isModelWait } from '../../runtime/src/lib/auraOverview.mjs';

const mission = (over = {}) => ({ identity: 'mission-1', status: 'ACTIVE', verifiedActions: 0, lastError: null, paused: null, ...over });
const plan = (over = {}) => ({ identity: 'p1', status: 'ACTIVE', nodes: [], moves: [], ...over });

test('an idle runtime says so and claims no progress', () => {
  const s = summarizeAuraWork({ operatorGoal: { statement: 'skapa agenten' }, missions: [mission({ status: 'DONE', verifiedActions: 3 })], plans: [] });
  assert.equal(s.state, 'IDLE');
  assert.equal(s.activeMissions, 0);
  assert.equal(s.goal, 'skapa agenten');
  assert.equal(s.verifiedActions, 3, 'verified actions are counted from observed missions');
  assert.deepEqual(s.progress, { verified: 0, total: 0 });
});

test('a model that is temporarily limited is waiting, not blocked', () => {
  const s = summarizeAuraWork({ missions: [mission({ lastError: 'MODEL_TEMPORARILY_LIMITED:gemini:429' })], plans: [] });
  assert.equal(s.state, 'WAITING_MODEL');
  assert.equal(s.waitingForOperator.length, 0);
  assert.equal(isModelWait('MODEL_TEMPORARILY_LIMITED'), true);
});

test('a real blocker is shown and paused work is waiting for the operator', () => {
  const s = summarizeAuraWork({ missions: [mission({ lastError: 'CONTEXT_PACKET_BUDGET_EXCEEDED' }), mission({ identity: 'mission-2', paused: true })], plans: [] });
  assert.equal(s.state, 'BLOCKED');
  assert.equal(s.blockers[0].code, 'CONTEXT_PACKET_BUDGET_EXCEEDED');
  assert.equal(s.waitingForOperator.length, 1);
});

test('running work shows the running step and the next executable step from the observed plan', () => {
  const s = summarizeAuraWork({
    missions: [mission({ verifiedActions: 2 })],
    plans: [plan({
      nodes: [
        { identity: 'a', title: 'Läs koden', status: 'VERIFIED' },
        { identity: 'b', title: 'Skriv testet', status: 'ACTIVE' },
        { identity: 'c', title: 'Rätta felet', status: 'PENDING' },
      ],
      moves: [{ stepId: 'c', executable: true }],
    })],
  });
  assert.equal(s.state, 'WORKING');
  assert.equal(s.running, 'Skriv testet');
  assert.equal(s.nextStep, 'Rätta felet');
  assert.deepEqual(s.progress, { verified: 1, total: 3 });
});
