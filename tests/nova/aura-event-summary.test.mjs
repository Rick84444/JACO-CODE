import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeMissionBlocker } from '../../runtime/src/lib/auraEventSummary.mjs';

const blocked = (id, text, missionId = 'mission-1') => ({
  id, missionId, category: 'blocked', text, title: 'Stopped',
  evidence: { outcome: 'failed', error: text },
});

test('identical failures are summarized per mission without losing the evidence pointer', () => {
  const items = [
    blocked('a', 'PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT'),
    blocked('b', 'PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT'),
    blocked('c', 'OTHER_FAILURE'),
    blocked('d', 'PLANNER_BLOCKED:AURA_SELECTED_MODEL_UNAVAILABLE:gemini:MONTHLY_BUDGET_LIMIT', 'mission-2'),
  ];
  const summary = summarizeMissionBlocker(items.slice(0, 2), 'mission-1');
  assert.equal(summary.count, 2);
  assert.equal(summary.event.id, 'b');
  assert.equal(summary.isBudgetLimit, true);
  assert.equal(summarizeMissionBlocker(items, 'mission-2').count, 1);
});

test('no blocker is fabricated from unrelated events or an unknown mission', () => {
  assert.equal(summarizeMissionBlocker([{ missionId: 'a', category: 'observation', evidence: { outcome: 'observed' } }], 'a'), null);
  assert.equal(summarizeMissionBlocker([blocked('x', 'failed')], null), null);
});
