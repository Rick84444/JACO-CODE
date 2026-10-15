// Integration test using the REAL createMissionGraph + createAutonomyLoop together (not mocked),
// covering the bug found live on 2026-09-29: a graph whose replan attempts are exhausted used to
// stay in NEEDS_REPLAN forever, permanently occupying the governor's single active-work admission
// slot and silently blocking all future autonomous work.
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';
import { createAutonomyLoop } from '../src/seer-autonomy-loop.mjs';
import { governorAdmission } from '../src/seer-development-cycle.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const now = () => Math.floor(Date.now() / 1000);

function makeGraph() {
  const db = new DatabaseSync(':memory:');
  return createMissionGraph({ db, uid, now });
}

test('a graph with no path forward is exhausted by the real autonomy loop, not stuck in NEEDS_REPLAN forever', async () => {
  const missionGraph = makeGraph();
  const graph = missionGraph.create({
    title: 'Doomed mission',
    objective: 'This will never succeed',
    nodes: [{ key: 'step-1', title: 'Step 1', objective: 'Do the thing' }],
  });
  missionGraph.fail(graph.id, 'step-1', { reason: 'NOVA_KNOWN_FAILURE', evidence_refs: ['ev-1'] });
  assert.equal(missionGraph.get(graph.id).status, 'NEEDS_REPLAN');

  const loop = createAutonomyLoop({
    missionGraph,
    dispatch: async () => { throw new Error('should not dispatch an exhausted graph'); },
    callLLM: async () => ({ ok: true, text: '{}' }), // model proposes nothing useful every time
    maxReplans: 1,
  });

  // Turn 1: repairCount is 0 (<1), so it replans once — creates step-1.repair.1 (READY), not FAILED.
  const first = await loop.turn();
  assert.equal(first.replanned.length, 1);
  assert.equal(missionGraph.get(graph.id).status, 'ACTIVE');

  // Simulate the repair attempt also failing.
  missionGraph.fail(graph.id, 'step-1.repair.1', { reason: 'NOVA_KNOWN_FAILURE', evidence_refs: ['ev-2'] });
  assert.equal(missionGraph.get(graph.id).status, 'NEEDS_REPLAN');

  // Turn 2: repairCount for the root key is now 1 (>=maxReplans=1) -> exhausted -> must reach EXHAUSTED.
  const second = await loop.turn();
  assert.equal(second.exhausted.length, 1);

  const finalGraph = missionGraph.get(graph.id);
  assert.equal(finalGraph.status, 'EXHAUSTED');
  // The failed node keeps its real failure reason; exhaustion claims no success.
  assert.equal(finalGraph.nodes.find(n => n.key === 'step-1.repair.1').failure_reason, 'NOVA_KNOWN_FAILURE');

  // The whole point: an EXHAUSTED graph must not occupy the governor's admission slot.
  const admission = governorAdmission([finalGraph], { maxActive: 1 });
  assert.equal(admission.allowed, true);

  // And refresh() must never resurrect an EXHAUSTED graph back to ACTIVE/NEEDS_REPLAN/VERIFIED —
  // calling get() again (which calls refresh internally) must be a no-op on the terminal state.
  assert.equal(missionGraph.get(graph.id).status, 'EXHAUSTED');
});

test('cancel() is idempotent and requires the graph to exist', () => {
  const missionGraph = makeGraph();
  const graph = missionGraph.create({
    title: 'X', objective: 'Y', nodes: [{ key: 'step-1', title: 'S', objective: 'O' }],
  });
  const first = missionGraph.cancel(graph.id, { reason: 'operator abort' });
  assert.equal(first.status, 'CANCELLED');
  const second = missionGraph.cancel(graph.id, { reason: 'ignored second reason' });
  assert.equal(second.status, 'CANCELLED');
  assert.equal(second.policy.cancelled_reason, 'operator abort');
  assert.throws(() => missionGraph.cancel('does-not-exist'), /MISSION_GRAPH_NOT_FOUND/);
});

test('Nova cancellation stops the graph across database restart and never creates a repair', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-cancel-'));
  const filename = path.join(dir, 'state.sqlite');
  let db = new DatabaseSync(filename);
  try {
    let graph = createMissionGraph({ db, uid, now });
    const created = graph.create({ title: 'Operator stop', objective: 'Keep stopped', nodes: [
      { key: 'a', title: 'A', objective: 'A' },
      { key: 'b', title: 'B', objective: 'B', dependencies: ['a'] },
    ] });
    graph.bindNova(created.id, 'a', 'nova-a');
    const checkpoint = graph.checkpoint(created.id, { label: 'before stop' });
    const result = graph.reconcileNova(created.id, 'a', { id: 'nova-a', status: 'CANCELLED', receipts: [] });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.graph.status, 'CANCELLED');
    assert.ok(result.graph.policy.cancelled_at);
    db.close(); db = new DatabaseSync(filename);
    graph = createMissionGraph({ db, uid, now });
    const loop = createAutonomyLoop({ missionGraph: graph,
      dispatch: async () => { assert.fail('cancelled work dispatched'); },
      callLLM: async () => { assert.fail('cancelled work replanned'); },
    });
    for (let i = 0; i < 4; i++) await loop.turn();
    assert.deepEqual(graph.ready(created.id), []);
    assert.equal(graph.get(created.id).replans.length, 0);
    assert.equal(graph.reconcileNova(created.id, 'a', { id: 'nova-a', status: 'ACTIVE' }).outcome, 'cancelled');
    assert.throws(() => graph.fail(created.id, 'a', { reason: 'late result' }), /GRAPH_CANCELLED/);
    assert.throws(() => graph.recover(created.id, checkpoint.id), /GRAPH_CANCELLED/);
    assert.throws(() => graph.replan(created.id, { failed_key: 'a' }), /GRAPH_CANCELLED/);
    assert.equal(graph.get(created.id).status, 'CANCELLED');
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('legacy cancellation failures are stopped before the repair model is called', async () => {
  const graph = makeGraph();
  const created = graph.create({ title: 'Legacy stop', objective: 'Stop', nodes: [{ key: 'a', title: 'A', objective: 'A' }] });
  graph.fail(created.id, 'a', { reason: 'NOVA_MISSION_CANCELLED' });
  const loop = createAutonomyLoop({ missionGraph: graph, dispatch: async () => assert.fail('dispatch'), callLLM: async () => assert.fail('model') });
  await loop.turn();
  assert.equal(graph.get(created.id).status, 'CANCELLED');
  assert.equal(graph.get(created.id).replans.length, 0);
});

test('operator stop while repair planning is in flight cannot resurrect the graph', async () => {
  const graph = makeGraph();
  const created = graph.create({ title: 'Concurrent stop', objective: 'Stop', nodes: [{ key: 'a', title: 'A', objective: 'A' }] });
  graph.fail(created.id, 'a', { reason: 'NOVA_KNOWN_FAILURE' });
  const loop = createAutonomyLoop({ missionGraph: graph,
    dispatch: async () => assert.fail('dispatch after stop'),
    callLLM: async () => {
      graph.cancel(created.id, { reason: 'operator stop', actor: 'operator' });
      return { ok: true, text: JSON.stringify({ objective: 'Try again', reversible: true }) };
    },
  });
  await loop.turn();
  assert.equal(graph.get(created.id).status, 'CANCELLED');
  assert.equal(graph.get(created.id).replans.length, 0);
});
