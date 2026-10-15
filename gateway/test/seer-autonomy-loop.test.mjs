import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutonomyLoop, parseModelJson, shouldAutoConfirmNova } from '../src/seer-autonomy-loop.mjs';

function graphFixture(initial) {
  let graph = structuredClone(initial);
  const dispatches = [];
  return {
    api: {
      list() { return [structuredClone(graph)]; },
      ready() { return graph.nodes.filter(node => node.status === 'READY').map(node => structuredClone(node)); },
      replan(graphId, input) {
        assert.equal(graphId, graph.id);
        const failed = graph.nodes.find(node => node.key === input.failed_key);
        failed.status = 'SUPERSEDED';
        const replacement = {
          key: input.replacement.key,
          title: input.replacement.title,
          objective: input.replacement.objective,
          contract: input.replacement.contract || {},
          dependencies: input.replacement.dependencies || [],
          evidence_refs: [],
          failure_reason: null,
          status: 'READY',
          attempt: 0,
        };
        graph.nodes.push(replacement);
        graph.replans.push({
          failed_node_key: input.failed_key,
          replacement_node_key: replacement.key,
          reason: input.reason,
        });
        graph.status = 'ACTIVE';
        return structuredClone(graph);
      },
    },
    dispatch: async (graphId, key) => {
      const missionId = 'nova-' + (dispatches.length + 1);
      dispatches.push({ graphId, key, missionId });
      const node = graph.nodes.find(item => item.key === key);
      node.status = 'DISPATCHED';
      node.nova_mission_id = missionId;
      return { graph: structuredClone(graph), nova: { id: missionId } };
    },
    dispatches,
    snapshot: () => structuredClone(graph),
  };
}

test('model JSON parser accepts canonical callLLM response envelope', () => {
  assert.deepEqual(
    parseModelJson({ ok: true, text: '{"objective":"repair"}' }),
    { objective: 'repair' },
  );
});

test('failed dispatch attempts respect the per-turn budget across graphs', async () => {
  let attempts = 0;
  const loop = createAutonomyLoop({
    missionGraph: {
      list: () => [{ id: 'a', status: 'ACTIVE' }, { id: 'b', status: 'ACTIVE' }],
      ready: () => Array.from({ length: 5 }, (_, i) => ({ key: String(i) })),
      replan() { throw new Error('unexpected replan'); },
    },
    dispatch: async () => { attempts++; throw new Error('PROVIDER_UNAVAILABLE'); },
    maxDispatchPerTurn: 2,
  });
  const report = await loop.turn();
  assert.equal(attempts, 2);
  assert.equal(report.errors.length, 2);
  assert.equal(report.dispatched.length, 0);
  assert.equal(loop.state().in_flight, false);
});

test('closed loop automatically dispatches READY nodes', async () => {
  const fixture = graphFixture({
    id: 'g1',
    title: 'Autonomous graph',
    objective: 'Finish work',
    status: 'ACTIVE',
    policy: {},
    replans: [],
    nodes: [{ key: 'a', title: 'A', objective: 'Do A', dependencies: [], status: 'READY', attempt: 0 }],
  });
  const loop = createAutonomyLoop({
    missionGraph: fixture.api,
    dispatch: fixture.dispatch,
    maxDispatchPerTurn: 1,
  });

  const report = await loop.turn();
  assert.equal(report.dispatched.length, 1);
  assert.equal(report.dispatched[0].node_key, 'a');
  assert.equal(fixture.snapshot().nodes[0].status, 'DISPATCHED');
});

test('known failure is replanned from LLM evidence and replacement dispatches in the same turn', async () => {
  const fixture = graphFixture({
    id: 'g2',
    title: 'Repair graph',
    objective: 'Pass acceptance',
    status: 'NEEDS_REPLAN',
    policy: {},
    replans: [],
    nodes: [{
      key: 'build',
      title: 'Build',
      objective: 'Implement feature',
      dependencies: [],
      contract: { schema: 'jaco.coding-contract/v1', scope: { allowed: ['src/**'] } },
      evidence_refs: ['nova:failed'],
      failure_reason: 'acceptance test failed',
      status: 'FAILED',
      attempt: 1,
    }],
  });

  const loop = createAutonomyLoop({
    missionGraph: fixture.api,
    dispatch: fixture.dispatch,
    callLLM: async () => ({
      ok: true,
      text: JSON.stringify({
        title: 'Repair implementation',
        objective: 'Inspect failing acceptance evidence, correct root cause, rerun tests and return verified evidence',
        reason: 'Previous implementation violated acceptance',
        reversible: true,
        external_spend: 0,
      }),
    }),
  });

  const report = await loop.turn();
  assert.equal(report.replanned.length, 1);
  assert.equal(report.replanned[0].replacement_node_key, 'build.repair.1');
  assert.equal(report.replanned[0].model_candidate_accepted, true);
  assert.equal(report.dispatched.length, 1);
  const replacement = fixture.snapshot().nodes.find(node => node.key === 'build.repair.1');
  assert.equal(replacement.status, 'DISPATCHED');
  assert.deepEqual(replacement.contract.scope.allowed, ['src/**']);
});

test('repair planner cannot expand authority through spend or irreversible candidate', async () => {
  const fixture = graphFixture({
    id: 'g3',
    title: 'Guarded repair',
    objective: 'Repair safely',
    status: 'NEEDS_REPLAN',
    policy: {},
    replans: [],
    nodes: [{
      key: 'x',
      title: 'X',
      objective: 'Safe objective',
      dependencies: [],
      contract: { guard: 'preserve-me' },
      evidence_refs: [],
      failure_reason: 'known failure',
      status: 'FAILED',
      attempt: 1,
    }],
  });

  const loop = createAutonomyLoop({
    missionGraph: fixture.api,
    dispatch: fixture.dispatch,
    callLLM: async () => ({
      ok: true,
      text: JSON.stringify({
        title: 'Unsafe idea',
        objective: 'Spend money and mutate authority',
        reason: 'unsafe',
        reversible: false,
        external_spend: 100,
      }),
    }),
  });

  const report = await loop.turn();
  assert.equal(report.replanned[0].model_candidate_accepted, false);
  const replacement = fixture.snapshot().nodes.find(node => node.key === 'x.repair.1');
  assert.match(replacement.objective, /AUTONOMOUS REPAIR CONTEXT/);
  assert.deepEqual(replacement.contract, { guard: 'preserve-me' });
});

test('replan budget stops infinite repair loops', async () => {
  const fixture = graphFixture({
    id: 'g4',
    title: 'Exhausted graph',
    objective: 'Do not loop forever',
    status: 'NEEDS_REPLAN',
    policy: {},
    replans: [
      { failed_node_key: 'a', replacement_node_key: 'a.repair.1' },
      { failed_node_key: 'a.repair.1', replacement_node_key: 'a.repair.2' },
    ],
    nodes: [{
      key: 'a.repair.2',
      title: 'A repair 2',
      objective: 'Try again',
      dependencies: [],
      contract: {},
      evidence_refs: [],
      failure_reason: 'still failing',
      status: 'FAILED',
      attempt: 1,
    }],
  });

  const loop = createAutonomyLoop({
    missionGraph: fixture.api,
    dispatch: fixture.dispatch,
    maxReplans: 2,
  });

  const exhausted = [];
  fixture.api.exhaust = (graphId, input) => {
    exhausted.push({ graphId, ...input });
    return fixture.snapshot();
  };

  const report = await loop.turn();
  assert.equal(report.exhausted.length, 1);
  assert.equal(report.replanned.length, 0);
  assert.equal(report.dispatched.length, 0);
  assert.equal(exhausted.length, 1);
  assert.equal(exhausted[0].graphId, 'g4');
  assert.equal(exhausted[0].node_key, 'a.repair.2');
  assert.match(exhausted[0].reason, /still failing/);
});


test('SEER auto-confirm is limited to explicit closed-loop graphs with verified evidence', () => {
  const graph = { policy: { autonomy: 'closed-loop' } };
  const mission = {
    source: 'seer-mission-graph',
    status: 'AWAITING_VERIFICATION',
    receipts: [{ ok: true, verified: true, outcomeUnknown: false }],
    contract: null,
  };
  assert.equal(shouldAutoConfirmNova(graph, mission), true);
  assert.equal(shouldAutoConfirmNova({ policy: {} }, mission), false);
  assert.equal(shouldAutoConfirmNova({ policy: { autonomy: 'closed-loop', operator_confirmation_required_for_release: true } }, mission), false);
  assert.equal(shouldAutoConfirmNova(graph, { ...mission, receipts: [{ ok: true, verified: false, outcomeUnknown: true }] }), false);
  assert.equal(shouldAutoConfirmNova(graph, { ...mission, contract: {}, contractStatus: { machineVerified: false } }), false);
});

test('Nova structured subgoals refine the existing graph without calling another model',async()=>{
 let applied;
 const request={reason:'Two independently verifiable outcomes',subgoals:[{title:'Inspect',objective:'Inspect actual contracts'},{title:'Integrate',objective:'Implement and verify'}]};
 const failed={key:'large',title:'Large',objective:'Original goal',status:'FAILED',dependencies:[],failure_reason:'NOVA_REPLAN_REQUEST:'+JSON.stringify(request)};
 const graph={id:'g',status:'NEEDS_REPLAN',nodes:[failed],replans:[]};
 const loop=createAutonomyLoop({missionGraph:{list:()=>[graph],ready:()=>[],replan:(id,input)=>{applied=input;graph.status='ACTIVE';return graph;}},callLLM:()=>assert.fail('Existing Nova plan must be reused'),dispatch:()=>assert.fail('No ready fixture nodes')});
 const r=await loop.turn();assert.equal(r.replanned.length,1);assert.equal(applied.failed_key,'large');assert.equal(applied.replacements.length,2);assert.deepEqual(applied.replacements[1].dependencies,[applied.replacements[0].key]);assert.equal(graph.id,'g');
});
