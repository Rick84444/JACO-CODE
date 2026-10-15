import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';
import { createStrategicBoard, simulateStrategicBoard } from '../../agents/lib/aura-strategic-board.mjs';
import { rankStrategies } from '../src/seer-strategy.mjs';
import { readStrategicContext, workerStrategicPrompt } from '../../agents/lib/strategic-context.mjs';
import { brainSystemFor } from '../../agents/hands-off-agent.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  let seq = 0;
  const graph = createMissionGraph({ db, uid: () => `g-${++seq}`, now: () => ++seq });
  t.after(() => db.close());
  return { db, graph };
}

const plan = () => ({ title: 'Restore a failing capability', objective: 'Ship verified capability',
  nodes: [
    { key: 'polish', objective: 'Optional polish', strategy: { goalImpact: 0.1, verificationGain: 0.1 } },
    { key: 'repair', objective: 'Remove failing dependency', strategy: { goalImpact: 0.4, verificationGain: 1 } },
    { key: 'deliver', objective: 'Verify integration', strategy: { goalImpact: 1 } },
  ],
  obstacles: [{ id: 'failure', blocks: ['deliver'], clearBy: ['repair'], severity: 1 }],
});

test('Shack changes dispatch order, hard obstacles require VERIFIED evidence, and running work is preserved', t => {
  const { graph } = fixture(t);
  const created = graph.create(plan());
  assert.deepEqual(graph.ready(created.id).map(node => node.key), ['repair', 'polish']);
  assert.throws(() => graph.dispatchSpec(created.id, 'deliver'), /NODE_NOT_READY:BLOCKED/);
  const spec = graph.dispatchSpec(created.id, 'repair');
  assert.equal(spec.parent.selectedMove.metrics.blockerRemoval, 1);
  assert.equal(spec.parent.strategicBoard.activeObstacles[0].id, 'failure');
  graph.bindNova(created.id, 'repair', 'nova-repair');
  graph.running(created.id, 'repair', 'nova-repair');
  assert.deepEqual(graph.ready(created.id).map(node => node.key), ['polish']);
  assert.throws(() => graph.verify(created.id, 'repair', { verified: true, evidence_refs: [] }), /EVIDENCE_REFS_REQUIRED/);
  graph.verify(created.id, 'repair', { verified: true, evidence_refs: ['receipt:actual-test'] });
  assert.deepEqual(graph.ready(created.id).map(node => node.key), ['deliver', 'polish']);
  const board = graph.get(created.id).strategic_board;
  assert.equal(board.activeObstacles.length, 0);
  assert.equal(board.observations[0].status, 'VERIFIED');
  assert.equal(board.forecast.stepSuccess.repair, 1);
  graph.cancel(created.id, { reason: 'stop' });
  assert.deepEqual(graph.ready(created.id), []);
  assert.throws(() => graph.dispatchSpec(created.id, 'deliver'), /GRAPH_NOT_ACTIVE:CANCELLED/);
});

test('repair rewires obstacle resolvers and retains estimates after graph store reconstruction', t => {
  const { db, graph } = fixture(t);
  const created = graph.create(plan());
  graph.fail(created.id, 'repair', { reason: 'real test failed', evidence_refs: ['receipt:failure'] });
  const repaired = graph.replan(created.id, { failed_key: 'repair', replacement: { key: 'repair2' } });
  assert.deepEqual(repaired.strategic_board.activeObstacles[0].clearBy, ['repair2']);
  assert.equal(graph.ready(created.id)[0].key, 'repair2');
  const reopened = createMissionGraph({ db, uid: () => 'unused', now: () => 10 });
  assert.equal(reopened.ready(created.id)[0].strategic_move.metrics.blockerRemoval, 1);
  reopened.bindNova(created.id, 'repair2', 'nova-second');
  reopened.verify(created.id, 'repair2', { verified: true, evidence_refs: ['receipt:pass'] });
  assert.equal(reopened.ready(created.id)[0].key, 'deliver');
});

test('implicit obstacle cycles and ungrounded clearances are rejected before creating a graph', t => {
  const { graph } = fixture(t);
  assert.throws(() => graph.create({ ...plan(), obstacles: [
    { id: 'cycle', blocks: ['repair'], clearBy: ['deliver'] },
    { id: 'reverse', blocks: ['deliver'], clearBy: ['repair'] },
  ] }), /AURA_BOARD_CYCLE/);
  assert.throws(() => graph.create({ ...plan(), obstacles: [{ id: 'f', state: 'CLEARED', blocks: ['deliver'] }] }), /CLEARANCE_REQUIRES_EVIDENCE/);
  assert.equal(graph.list().length, 0);
});

test('forecast uses verified truth, shared ancestry once and impossible obstacles transitively', () => {
  const forecast = steps => simulateStrategicBoard(createStrategicBoard({ goalId: 'g', missionId: 'm', steps }));
  const diamond = forecast([
    { id: 'a', confidence: 0.5 }, { id: 'b', dependencies: ['a'], confidence: 0.5 },
    { id: 'c', dependencies: ['a'], confidence: 0.5 }, { id: 'd', dependencies: ['b', 'c'], confidence: 0.5 },
  ]);
  assert.equal(diamond.terminalProbability, 0.0625);
  const verified = forecast([{ id: 'a', status: 'VERIFIED', confidence: 0.01 }, { id: 'b', dependencies: ['a'], confidence: 0.8 }]);
  assert.equal(verified.terminalProbability, 0.8);
  const impossible = simulateStrategicBoard(createStrategicBoard({ goalId: 'g', missionId: 'm',
    steps: [{ id: 'a', obstacles: ['missing'], confidence: 1 }, { id: 'b', dependencies: ['a'], confidence: 1 }],
    obstacles: [{ id: 'missing', clearBy: [] }],
  }));
  assert.equal(impossible.stepSuccess.a, 0);
  assert.equal(impossible.stepSuccess.b, 0);
  assert.equal(impossible.terminalProbability, 0);
  assert.match(impossible.interpretation, /not execution evidence/);
});

test('candidate consequences participate in strategic decisions and impossible plans lose to baseline', () => {
  const base = { success_probability: 0.8, risk: 0.1, repeatability: 0.5, reversibility: 1 };
  const baseline = { id: 'baseline-no-new-mission', success_probability: 0 };
  const ranked = rankStrategies([
    { ...base, id: 'long', nodes: [{ key: 'a' }, { key: 'b', dependencies: ['a'] }, { key: 'c', dependencies: ['b'] }] },
    { ...base, id: 'short', nodes: [{ key: 'done' }] }, baseline,
  ], { scoring_model: 'shack' });
  assert.equal(ranked[0].id, 'short');
  assert.equal(ranked[0].strategic_score.model, 'shack');
  assert.equal(rankStrategies([{ ...base, id: 'blocked', nodes: [{ key: 'a' }], obstacles: [{ id: 'missing', blocks: ['a'] }] }, baseline], { scoring_model: 'shack' })[0].id, baseline.id);
});

test('executors and workers share reasoning instructions; unavailable SEER is explicitly stale', async t => {
  const { graph } = fixture(t);
  const created = graph.create(plan());
  const spec = graph.dispatchSpec(created.id, 'repair');
  const mission = { goal: spec.goal, metadata: { parent: spec.parent }, allowedTasks: ['repo-read'], contract: { scope: { allowed: ['src/**'] } } };
  const ctx = await readStrategicContext(mission, { seerUrl: 'http://seer.test', token: 'private', fetchImpl: async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer private');
    return { ok: true, json: async () => ({ status: 'ACTIVE', board: graph.get(created.id).strategic_board }) };
  } });
  assert.equal(ctx.fresh, true);
  assert.equal(ctx.selectedMove.stepId, 'repair');
  const stale = await readStrategicContext(mission, { seerUrl: 'http://seer.test', token: 'private', fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(stale.fresh, false);
  assert.equal(stale.source, 'dispatch-snapshot');
  assert.match(brainSystemFor(['repo-read'], true), /SEER owns the shared Shack/);
  const worker = workerStrategicPrompt('Inspect failure', mission);
  assert.match(worker, /receipt.*verify/);
  assert.match(worker, /"stepId":"repair"/);
  assert.match(worker, /"allowed":\["src\/\*\*"\]/);
});
