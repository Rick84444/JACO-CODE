import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createMissionGraph } from '../src/seer-mission-graph.mjs';

function fixture() {
  const db = new DatabaseSync(':memory:');
  let seq = 0;
  let clock = 1_700_000_000;
  const events = [];
  const graph = createMissionGraph({
    db,
    uid: () => `id-${++seq}`,
    now: () => ++clock,
    emit: (type, payload) => events.push({ type, payload }),
    js: JSON.stringify,
    jp: (value, fallback = {}) => {
      if (value == null) return fallback;
      if (typeof value !== 'string') return value;
      try { return JSON.parse(value); } catch { return fallback; }
    },
  });
  return { db, graph, events };
}

test('mission DAG blocks downstream work until verified evidence unlocks it', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Auth migration',
      objective: 'Migrate authentication without losing verification',
      nodes: [
        { key: 'model', title: 'Model repo', objective: 'Build repository model' },
        { key: 'backend', title: 'Backend', objective: 'Migrate backend', dependencies: ['model'] },
        { key: 'frontend', title: 'Frontend', objective: 'Migrate frontend', dependencies: ['backend'] },
      ],
    });

    assert.equal(created.nodes.find(x => x.key === 'model').status, 'READY');
    assert.equal(created.nodes.find(x => x.key === 'backend').status, 'BLOCKED');
    assert.deepEqual(graph.ready(created.id).map(x => x.key), ['model']);

    const spec = graph.dispatchSpec(created.id, 'model');
    assert.equal(spec.parent.graphId,created.id);
    assert.equal(spec.parent.nodeKey,'model');
    assert.equal(spec.parent.mainGoal,created.objective);
    assert.match(spec.idempotencyKey, /^seer-graph:/);
    graph.bindNova(created.id, 'model', 'nova-model-1');
    graph.running(created.id, 'model', 'nova-model-1');

    assert.throws(
      () => graph.verify(created.id, 'model', { verified: true, evidence_refs: [] }),
      /EVIDENCE_REFS_REQUIRED/,
    );

    const after = graph.verify(created.id, 'model', {
      verified: true,
      evidence_refs: ['receipt:model:verified'],
      checkpoint_label: 'repository-model-verified',
    });
    assert.equal(after.nodes.find(x => x.key === 'model').status, 'VERIFIED');
    assert.equal(after.nodes.find(x => x.key === 'backend').status, 'READY');
    assert.equal(after.nodes.find(x => x.key === 'frontend').status, 'BLOCKED');
    assert.equal(after.checkpoints.length, 1);
  } finally {
    db.close();
  }
});

test('failed branch is selectively replanned and downstream dependencies are rewired', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Long mission',
      objective: 'Complete dependent workstreams',
      nodes: [
        { key: 'a', objective: 'Foundation' },
        { key: 'b', objective: 'Implementation', dependencies: ['a'] },
        { key: 'c', objective: 'Integration', dependencies: ['b'] },
      ],
    });

    graph.bindNova(created.id, 'a', 'nova-a');
    graph.verify(created.id, 'a', { verified: true, evidence_refs: ['ev-a'] });

    graph.fail(created.id, 'b', { reason: 'acceptance test failed', evidence_refs: ['ev-b-fail'] });
    assert.equal(graph.get(created.id).status, 'NEEDS_REPLAN');

    const replanned = graph.replan(created.id, {
      failed_key: 'b',
      replacement: { key: 'b2', objective: 'Correct implementation' },
      reason: 'replace only failed implementation branch',
    });

    assert.equal(replanned.nodes.find(x => x.key === 'b').status, 'SUPERSEDED');
    assert.equal(replanned.nodes.find(x => x.key === 'b2').status, 'READY');
    assert.deepEqual(replanned.nodes.find(x => x.key === 'c').dependencies, ['b2']);
    assert.equal(replanned.nodes.find(x => x.key === 'c').status, 'BLOCKED');
    assert.equal(replanned.replans.length, 1);

    graph.bindNova(created.id, 'b2', 'nova-b2');
    graph.verify(created.id, 'b2', { verified: true, evidence_refs: ['ev-b2'] });
    assert.equal(graph.get(created.id).nodes.find(x => x.key === 'c').status, 'READY');
  } finally {
    db.close();
  }
});

test('graph verification requires every active branch to reach verified terminal state', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Two-stage',
      objective: 'Finish both stages',
      nodes: [
        { key: 'one', objective: 'First' },
        { key: 'two', objective: 'Second', dependencies: ['one'] },
      ],
    });
    graph.bindNova(created.id, 'one', 'nova-one');
    graph.verify(created.id, 'one', { verified: true, evidence_refs: ['ev-one'] });
    assert.equal(graph.get(created.id).status, 'ACTIVE');

    graph.bindNova(created.id, 'two', 'nova-two');
    const done = graph.verify(created.id, 'two', { verified: true, evidence_refs: ['ev-two'] });
    assert.equal(done.status, 'VERIFIED');
    assert.equal(done.summary.verified, 2);
  } finally {
    db.close();
  }
});

test('cycles and unknown dependencies are rejected before persistence', () => {
  const { db, graph } = fixture();
  try {
    assert.throws(() => graph.create({
      title: 'Cycle',
      objective: 'Must fail',
      nodes: [
        { key: 'a', objective: 'A', dependencies: ['b'] },
        { key: 'b', objective: 'B', dependencies: ['a'] },
      ],
    }), /MISSION_GRAPH_CYCLE/);

    assert.throws(() => graph.create({
      title: 'Unknown',
      objective: 'Must fail',
      nodes: [{ key: 'a', objective: 'A', dependencies: ['missing'] }],
    }), /UNKNOWN_DEPENDENCY:missing/);
  } finally {
    db.close();
  }
});

test('recovery never rolls back already verified truth', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Recovery',
      objective: 'Recover without invalidating evidence',
      nodes: [
        { key: 'a', objective: 'A' },
        { key: 'b', objective: 'B', dependencies: ['a'] },
      ],
    });
    graph.bindNova(created.id, 'a', 'nova-a');
    graph.verify(created.id, 'a', {
      verified: true,
      evidence_refs: ['ev-a'],
      checkpoint_label: 'a-verified',
    });
    const checkpoint = graph.get(created.id).checkpoints[0];

    graph.bindNova(created.id, 'b', 'nova-b');
    graph.running(created.id, 'b', 'nova-b');
    const recovered = graph.recover(created.id, checkpoint.id);

    assert.equal(recovered.nodes.find(x => x.key === 'a').status, 'VERIFIED');
    assert.notEqual(recovered.nodes.find(x => x.key === 'a').status, 'READY');
  } finally {
    db.close();
  }
});


test('known repeated Nova failures become a replannable graph failure', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Known failure',
      objective: 'Recover from verified failure',
      nodes: [{ key: 'a', objective: 'Attempt work' }],
    });
    graph.bindNova(created.id, 'a', 'nova-known-failure');

    const result = graph.reconcileNova(created.id, 'a', {
      id: 'nova-known-failure',
      status: 'BLOCKED',
      phase: 'BLOCKED',
      failures: 3,
      receipts: [
        { actionId: 'one', ok: false, verified: false, outcomeUnknown: false, error: 'test failed' },
        { actionId: 'two', ok: false, verified: false, outcomeUnknown: false, error: 'test failed' },
        { actionId: 'three', ok: false, verified: false, outcomeUnknown: false, error: 'test failed' },
      ],
    });

    assert.equal(result.outcome, 'failed');
    assert.equal(result.graph.status, 'NEEDS_REPLAN');
    assert.equal(result.graph.nodes.find(node => node.key === 'a').status, 'FAILED');
    assert.match(result.graph.nodes.find(node => node.key === 'a').failure_reason, /NOVA_KNOWN_FAILURE/);
  } finally {
    db.close();
  }
});

test('uncertain blocked Nova outcome is never retried autonomously', () => {
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Uncertain outcome',
      objective: 'Do not duplicate side effects',
      nodes: [{ key: 'a', objective: 'Act once' }],
    });
    graph.bindNova(created.id, 'a', 'nova-uncertain');

    const result = graph.reconcileNova(created.id, 'a', {
      id: 'nova-uncertain',
      status: 'BLOCKED',
      phase: 'INTERRUPTED',
      failures: 1,
      receipts: [
        { actionId: 'one', ok: true, verified: false, outcomeUnknown: true },
      ],
    });

    assert.equal(result.outcome, 'quarantined');
    assert.equal(result.graph.status, 'EXHAUSTED');
    assert.equal(result.reason, 'NOVA_BLOCKED_OUTCOME_UNCERTAIN');
    assert.equal(result.graph.nodes.find(node => node.key === 'a').status, 'DISPATCHED');
    assert.notEqual(result.graph.status, 'NEEDS_REPLAN');
  } finally {
    db.close();
  }
});

test('repeated uncertain Nova outcomes stay quarantined and never become known failures', () => {
  // Found live 2026-09-29: unlike known failures (test above), an uncertain outcome had no exit at
  // all -- it stayed 'operator_required' no matter how many turns passed, which combined with
  // governorAdmission's single active-work slot could block all other autonomous work indefinitely.
  const { db, graph } = fixture();
  try {
    const created = graph.create({
      title: 'Stuck uncertain outcome',
      objective: 'Never resolves on its own',
      nodes: [{ key: 'a', objective: 'Act repeatedly' }],
    });
    graph.bindNova(created.id, 'a', 'nova-stuck-uncertain');

    const uncertainReceipt = i => ({ actionId: `turn-${i}`, ok: true, verified: false, outcomeUnknown: true });
    const missionState = extraReceipts => ({
      id: 'nova-stuck-uncertain', status: 'BLOCKED', phase: 'BLOCKED', failures: 0,
      receipts: [uncertainReceipt(1), uncertainReceipt(2), uncertainReceipt(3)].slice(0, extraReceipts),
    });

    const first = graph.reconcileNova(created.id, 'a', missionState(2));
    assert.equal(first.outcome, 'quarantined');
    const third = graph.reconcileNova(created.id, 'a', missionState(3));
    assert.equal(third.outcome, 'quarantined');
    assert.equal(third.graph.status, 'EXHAUSTED');
    assert.equal(third.graph.nodes.find(node => node.key === 'a').status, 'DISPATCHED');
    assert.equal(third.graph.policy.outcome_unknown.reason, 'NOVA_BLOCKED_OUTCOME_UNCERTAIN');
    assert.deepEqual(graph.ready(created.id), []);
    assert.throws(() => graph.fail(created.id, 'a', { reason: 'convert unknown' }), /GRAPH_OUTCOME_UNKNOWN/);
    assert.throws(() => graph.recover(created.id, 'any'), /GRAPH_OUTCOME_UNKNOWN/);
    assert.throws(() => graph.replan(created.id, { failed_key: 'a' }), /GRAPH_OUTCOME_UNKNOWN/);

  } finally {
    db.close();
  }
});

test('exhausted graph is terminal, keeps its failure and frees the governor slot', async () => {
  const { governorAdmission } = await import('../src/seer-development-cycle.mjs');
  const { db, graph, events } = fixture();
  try {
    const created = graph.create({
      title: 'Budget spent',
      objective: 'Stop repairing after the budget',
      nodes: [
        { key: 'a', objective: 'Try once' },
        { key: 'b', objective: 'Depends on a', dependencies: ['a'] },
      ],
    });
    graph.bindNova(created.id, 'a', 'nova-a');
    graph.fail(created.id, 'a', { reason: 'NOVA_MISSION_CANCELLED' });
    assert.equal(governorAdmission(graph.list()).reason, 'active_work_limit');

    const exhausted = graph.exhaust(created.id, { node_key: 'a', reason: 'replan budget 3/3 spent' });
    assert.equal(exhausted.status, 'EXHAUSTED');
    assert.equal(graph.get(created.id).status, 'EXHAUSTED');
    const failed = exhausted.nodes.find(node => node.key === 'a');
    assert.equal(failed.status, 'FAILED');
    assert.equal(failed.failure_reason, 'NOVA_MISSION_CANCELLED');
    assert.equal(governorAdmission(graph.list()).allowed, true);
    assert.ok(events.some(event => event.type === 'mission_graph.exhausted'));
    assert.throws(() => graph.exhaust(created.id, { reason: 'again' }), /GRAPH_NOT_EXHAUSTIBLE:EXHAUSTED/);
  } finally {
    db.close();
  }
});

test('refinement keeps the same graph and rewires downstream work to final integration',()=>{
 const {db,graph}=fixture();try{
 const contract={scope:{allowed:['src']},budget:{max_steps:40,max_tool_calls:120,max_failures:4,max_duration_ms:10000},verification:{tests_required:true}};
 const g=graph.create({title:'Large goal',objective:'Original goal',nodes:[{key:'large',objective:'Deliver original acceptance',contract},{key:'downstream',objective:'Release',dependencies:['large']}]});
 graph.fail(g.id,'large',{reason:'Needs decomposition'});
 const split=graph.replan(g.id,{failed_key:'large',replacements:[{key:'inspect',objective:'Inspect',contract:{scope:{allowed:['/']}}},{key:'integrate',objective:'Integrate',dependencies:['inspect']}],reason:'Split'});
 assert.equal(split.id,g.id);assert.equal(split.nodes.find(n=>n.key==='large').status,'SUPERSEDED');
 assert.deepEqual(split.nodes.find(n=>n.key==='downstream').dependencies,['integrate']);
 const a=split.nodes.find(n=>n.key==='inspect');const b=split.nodes.find(n=>n.key==='integrate');
 assert.deepEqual(a.contract.scope,contract.scope);assert.equal(a.contract.budget.max_steps+b.contract.budget.max_steps,40);assert.match(b.objective,/Deliver original acceptance/);
 assert.deepEqual(graph.ready(g.id).map(n=>n.key),['inspect']);
 graph.bindNova(g.id,'inspect','m1');graph.running(g.id,'inspect','m1');graph.verify(g.id,'inspect',{verified:true,evidence_refs:['real:inspect']});
 assert.deepEqual(graph.ready(g.id).map(n=>n.key),['integrate']);assert.equal(graph.get(g.id).status,'ACTIVE');
 }finally{db.close();}
});
test('a cyclic split rolls back atomically and leaves the failed graph unchanged',()=>{
 const{db,graph}=fixture();try{const g=graph.create({title:'Goal',objective:'Original',nodes:[{key:'a',objective:'A'}]});graph.fail(g.id,'a',{reason:'split'});
 assert.throws(()=>graph.replan(g.id,{failed_key:'a',replacements:[{key:'b',dependencies:['c']},{key:'c',dependencies:['b']}]}),/MISSION_GRAPH_CYCLE/);
 assert.equal(graph.get(g.id).nodes.length,1);assert.equal(graph.get(g.id).status,'NEEDS_REPLAN');
 }finally{db.close();}
});

test('missing binding is quarantined without retry or fabricated success and frees admission',()=>{
 const{db,graph}=fixture();try{const g=graph.create({title:'Goal',objective:'Original',nodes:[{key:'a',objective:'A'}]});graph.bindNova(g.id,'a','missing-id');
 const r=graph.reconcileNova(g.id,'a',{id:'missing-id',status:'MISSING',observedMissing:true,observedAt:'2026-10-06'});
 assert.equal(r.outcome,'quarantined');assert.equal(r.graph.status,'EXHAUSTED');assert.equal(r.graph.nodes[0].status,'FAILED');assert.equal(graph.ready(g.id).length,0);assert.equal(r.graph.replans.length,0);
 }finally{db.close();}
});
