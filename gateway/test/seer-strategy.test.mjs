import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOpportunityScore,
  rankStrategies,
  executionGate,
  computeSurprise,
  evaluateFalsifier,
  shouldReplan,
  updateBelief,
  createStrategicKernel,
  SEER_PURPOSE,
  goalTaskScope,
  SEER_STARTUP_GOALS,
} from '../src/seer-strategy.mjs';

test('purpose encodes Cognitive IDE, profitability and operator authority', () => {
  assert.match(SEER_PURPOSE.statement, /Cognitive IDE/i);
  assert.match(SEER_PURPOSE.statement, /profitable/i);
  assert.ok(SEER_PURPOSE.invariants.includes('operator_authority'));
  assert.ok(SEER_PURPOSE.invariants.includes('single_writer_execution'));
  assert.ok(SEER_PURPOSE.invariants.includes('outgoing_financial_commitment_requires_operator_approval'));
});

test('ranking favors repeatable evidence-backed low-risk engineering progress', () => {
  const ranked = rankStrategies([
    { id: 'flashy', expected_revenue: 1000, expected_cost: 900, success_probability: 0.4, repeatability: 0.2, information_gain: 0.3, strategic_fit: 0.4, reversibility: 0.3, evidence_quality: 0.2, risk: 0.9, human_intervention: 0.9 },
    { id: 'repeatable', expected_revenue: 100, expected_cost: 15, success_probability: 0.8, repeatability: 0.95, information_gain: 0.7, strategic_fit: 0.95, reversibility: 0.9, evidence_quality: 0.95, risk: 0.2, human_intervention: 0.1 },
  ]);
  assert.equal(ranked[0].id, 'repeatable');
  assert.ok(ranked[0].strategic_score.score > ranked[1].strategic_score.score);
});

test('financial execution remains gated behind ModelRelay signed mandate', () => {
  const gate = executionGate({ expected_external_spend: 12, consequence: 'FINANCIAL' });
  assert.equal(gate.allowed_by_strategy, false);
  assert.equal(gate.requires_signed_mandate, true);
  assert.equal(gate.reason, 'MODELRELAY_SIGNED_MANDATE_REQUIRED');
  assert.equal(executionGate({ expected_external_spend: 0 }).allowed_by_strategy, true);
});

test('prediction error creates strategic surprise and replan signal', () => {
  const surprise = computeSurprise({ metrics: { conversions: { min: 3 }, gross_margin: { min: 20 } } }, { metrics: { conversions: 0, gross_margin: -5 } });
  const falsification = evaluateFalsifier({ conversions: { lte: 0 } }, { metrics: { conversions: 0 } });
  const replan = shouldReplan({ surprise: surprise.score, falsified: falsification.falsified });
  assert.ok(surprise.score >= 0.5);
  assert.equal(falsification.falsified, true);
  assert.equal(replan.replan, true);
});

test('belief updates move with evidence instead of becoming immutable memory', () => {
  const supported = updateBelief(0.5, { direction: 'support', strength: 0.8, certainty: 1 });
  const contradicted = updateBelief(supported, { direction: 'contradict', strength: 1, certainty: 1 });
  assert.ok(supported > 0.5);
  assert.ok(contradicted < supported);
});

test('opportunity score stays normalized', () => {
  const result = computeOpportunityScore({ success_probability: 2, risk: -5, expected_revenue: 50, expected_cost: 0 });
  assert.ok(result.score >= 0 && result.score <= 1);
});

test('fresh strategic kernel seeds canonical user-value A2A startup goal', () => {
  const db = new DatabaseSync(':memory:');
  let sequence = 0;
  const kernel = createStrategicKernel({
    db,
    uid: () => `test-${++sequence}`,
    now: () => 1,
  });
  const goal = kernel.goals.get('jaco-user-value-a2a-v1');
  assert.ok(goal);
  assert.equal(goal.parent_id, SEER_PURPOSE.id);
  assert.equal(goal.priority, 0.95);
  assert.equal(goal.status, 'active');
  assert.equal(goal.success_criteria.external_user_value_verified, true);
  assert.equal(goal.success_criteria.verified_paid_outcome, true);
  assert.ok(goal.invariants.includes('user_value_before_revenue_optimization'));
  assert.ok(goal.invariants.includes('evidence_before_marketing_claim'));
  assert.equal(SEER_STARTUP_GOALS[0].id, goal.id);
  db.close();
});

// 2026-10-31: the missions of an observation-only Aura goal were allowed browser-click, mcp-write, github-create-repo,
// vault-* and email-inbox. The goal now carries invariant observation_only and its graphs get only observing tasks.
test('an observation-only goal scopes its graphs to observing tasks; other goals keep the default', () => {
  const scoped = goalTaskScope({ invariants: ['operator_authority', 'observation_only'] }).allowedTasks;
  for (const task of ['health-check', 'detect-surfaces', 'mcp-call']) assert.ok(scoped.includes(task), task);
  for (const task of ['repo-list', 'repo-read', 'git-status', 'git-diff', 'windows-wmi-read', 'browser-click', 'browser-type', 'desktop-action', 'mcp-write', 'github-create-repo', 'vault-get-secret', 'secret-store', 'email-inbox', 'repo-write', 'invoke-worker'])
    assert.equal(scoped.includes(task), false, task);
  assert.deepEqual(goalTaskScope({ invariants: ['operator_authority'] }), {});
  assert.deepEqual(goalTaskScope(null), {});
});
