import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutonomyLoop, parseModelJson, shouldAutoConfirmNova } from '../src/seer-autonomy-loop.mjs';
import { createAuraControlLoop } from '../src/aura-control-loop.mjs';
import { createAuraControlLease } from '../src/aura-control-lease.mjs';
import { createAuraCoreController } from '../../runtime/src/server/connected/auraCoreController.mjs';

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

test('Aura owns one serialized control turn: reconcile receipts before dispatching any plan', async () => {
  const phases = [];
  const loop = createAuraControlLoop({
    reconcile: async () => { phases.push('reconcile'); },
    plan: async () => { phases.push('plan'); return { dispatched: [{id:'mission-1'}], replanned: [], errors: [] }; },
  });
  const result = await loop.tick();
  assert.deepEqual(phases, ['reconcile', 'plan']);
  assert.equal(result.ok, true);
  assert.equal(result.dispatched, 1);
  assert.equal(loop.state().owner, 'aura');
  assert.equal(loop.state().inFlight, false);
  assert.equal(loop.state().runtimeConsolidated, false, 'OS processes have not been merged');
});

test('Aura never overlaps two scheduler ticks or duplicates a pending dispatch', async () => {
  let release;
  let reconciled = 0;
  let planned = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const loop = createAuraControlLoop({
    reconcile: async () => { reconciled++; await gate; },
    plan: async () => { planned++; return {}; },
  });
  const first = loop.tick();
  const second = await loop.tick();
  assert.equal(second.skipped, 'in_flight');
  release();
  assert.equal((await first).ok, true);
  assert.equal(reconciled, 1);
  assert.equal(planned, 1);
});

test('failed execution reconciliation prevents planning on unverified state, but remains retryable', async () => {
  let fails = true, planned = 0;
  const events = [];
  const loop = createAuraControlLoop({
    reconcile: async () => { if (fails) throw Error('EXECUTOR_UNAVAILABLE'); },
    plan: async () => { planned++; return {}; },
    emit: (type, payload) => events.push({type,payload}),
  });
  const first = await loop.tick();
  assert.equal(first.ok, false);
  assert.equal(first.phase, 'reconcile');
  assert.equal(planned, 0);
  assert.equal(events[0].type, 'aura.control.turn_failed');
  fails = false;
  assert.equal((await loop.tick()).ok, true);
  assert.equal(planned, 1);
});

test('Aura stops before planning when the operator revokes execution during reconciliation', async () => {
  let release, planned = 0;
  const barrier = new Promise(resolve => { release = resolve; });
  const loop = createAuraControlLoop({
    reconcile: () => barrier,
    plan: async () => {planned++;},
  });
  const active = loop.tick();
  loop.stop();
  release();
  const done = await active;
  assert.equal(done.skipped, 'stopped_after_reconcile');
  assert.equal(planned, 0);
  assert.equal((await loop.tick()).skipped, 'stopped');
});

test('disabled planning still reconciles the durable execution ledger', async () => {
  let reconciled=0, planned=0;
  const loop = createAuraControlLoop({
    reconcile: async () => { reconciled++; },
    plan: async () => {planned++;},
  });
  const report = await loop.tick({planningEnabled:false});
  assert.equal(report.ok,true);
  assert.deepEqual(report.phases,['reconcile']);
  assert.equal(reconciled,1);
  assert.equal(planned,0);
});

test('Aura Core obtains exclusive ownership and stale lease tokens cannot run work',()=>{
  let clock=1000;
  const lease=createAuraControlLease({now:()=>clock,ttlMs:500});
  const a=lease.claim();
  assert.equal(lease.state().owner,'aura-core');
  assert.equal(lease.state().externalActive,true);
  assert.equal(JSON.stringify(lease.state()).includes(a.token),false,'no secret in public status');
  assert.throws(()=>lease.claim(),/AURA_CONTROL_LEASE_HELD/);
  assert.throws(()=>lease.renew('invalid'),/AURA_CONTROL_LEASE_INVALID/);
  clock+=400;
  lease.renew(a.token);
  clock+=400;
  assert.equal(lease.state().externalActive,true,'renewed Core retains ownership');
  clock+=200;
  assert.equal(lease.state().owner,'aura-fallback');
  assert.throws(()=>lease.renew(a.token),/AURA_CONTROL_LEASE_INVALID/);
  const replacement=lease.claim();
  assert.notEqual(replacement.token,a.token);
  assert.throws(()=>lease.release(a.token),/AURA_CONTROL_LEASE_INVALID/);
  lease.release(replacement.token);
  assert.equal(lease.state().owner,'aura-fallback');
});

test('Aura Core delegates a single ordered tick and never allows another active owner',async()=>{
  let reconciled=0, planned=0;
  const control=createAuraControlLoop({
    reconcile:async()=>{reconciled++;},
    plan:async()=>{planned++;return {dispatched:[{}]};},
  });
  const lease=createAuraControlLease({ttlMs:10000});
  const request=async(action,body)=>{
    if(action==='claim') return lease.claim();
    if(action==='release') return lease.release(body.token);
    if(action==='tick'){
      lease.renew(body.token);
      return control.tick();
    }
    throw Error('unexpected adapter action');
  };
  const core=createAuraCoreController({request});
  // Simulate start without scheduler timers to drive a deterministic controller.
  assert.equal((await core.tick()).skipped,'stopped');
  core.start();
  const result=await core.tick();
  assert.ok(result.ok===true||result.skipped==='in_flight');
  for(let i=0;i<30 && !core.state().ticks;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(lease.state().owner,'aura-core');
  assert.ok(reconciled>=1);
  assert.equal(reconciled,planned);
  assert.equal(core.state().executionHost,'core');
  assert.equal(core.state().runtimeConsolidated,false);
  await core.stop();
  assert.equal(lease.state().owner,'aura-fallback');
  assert.equal((await core.tick()).skipped,'stopped');
});

test('Aura Core surfaces unavailable adapters without creating phantom receipts or claiming success',async()=>{
  const core=createAuraCoreController({request:async()=>{throw Error('STRATEGY_UNAVAILABLE');}});
  core.start();
  await core.tick();
  for(let i=0;i<30 && !core.state().lastError;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(core.state().leased,false);
  assert.match(core.state().lastError||'',/STRATEGY_UNAVAILABLE/);
  assert.equal(core.state().ticks,0);
  await core.stop();
});

test('Core shutdown during an async lease claim releases it and never starts a planning turn',async()=>{
  let finishClaim;
  let ticks=0, released=0;
  const waiting=new Promise(resolve=>{finishClaim=resolve;});
  const core=createAuraCoreController({request:async(action)=>{
    if(action==='claim') return waiting;
    if(action==='tick'){ticks++;return {ok:true};}
    if(action==='release'){released++;return {ok:true};}
  }});
  core.start();
  await core.stop();
  finishClaim({token:'late-lease'});
  for(let i=0;i<30 && !released;i++) await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(released,1);
  assert.equal(ticks,0);
});

test('Aura never labels a failed tool dispatch as a completed control turn',async()=>{
  const loop=createAuraControlLoop({
    reconcile:async()=>{},
    plan:async()=>({dispatched:[],errors:[{phase:'dispatch',error:'TOOL_NOT_AVAILABLE'}]}),
  });
  const report=await loop.tick();
  assert.equal(report.ok,false);
  assert.equal(report.error,'AURA_PLANNER_REPORTED_ERRORS');
  assert.equal(report.errors,1);
  assert.equal(loop.state().last.ok,false);
});

test('an evidence-backed stuck graph node requests an automatically contracted repair, not operator resume', async () => {
  const original = { scope: { allowed: ['src/**'] }, budget: { max_steps: 8, max_tool_calls: 20, max_duration_ms: 300000 } };
  const fixture = graphFixture({
    id: 'graph-stuck-rescue', title: 'Finish product', objective: 'Ship verified product',
    policy: { autonomy: 'closed-loop' }, status: 'NEEDS_REPLAN',
    nodes: [{
      key: 'build', status: 'FAILED', title: 'Build product',
      objective: 'Complete build and acceptance',
      failure_reason: 'NOVA_REPLAN_REQUEST:{"reason":"STUCK:repeat","subgoals":[]}',
      dependencies: [], contract: original, evidence_refs: ['nova:receipt:1'], attempt: 1,
    }],
    replans: [],
  });
  const loop = createAutonomyLoop({ missionGraph: fixture.api, dispatch: fixture.dispatch, maxReplans: 3 });
  const result = await loop.turn();
  assert.equal(result.replanned.length, 1);
  assert.equal(result.dispatched.length, 1);
  assert.match(result.replanned[0].replacement_node_key, /^build\.repair\.1$/);
  const after = fixture.snapshot();
  const replacement = after.nodes.find(node => node.key === result.replanned[0].replacement_node_key);
  assert.deepEqual(replacement.contract, original);
  assert.match(replacement.objective, /Diagnose the concrete root cause/);
  assert.equal(after.status, 'ACTIVE');
});
