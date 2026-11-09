import test from 'node:test';
import assert from 'node:assert/strict';
import { gameboardNumericId, gameboardProjection, simulateGameboardScenario } from '../../agents/lib/gameboard-fabric.mjs';

test('stable numeric identities distinguish agents, MCP tools and missions', () => {
  const n = gameboardNumericId('tool','mcp:git:status');
  assert.equal(n, gameboardNumericId('tool','mcp:git:status'));
  assert.ok(Number.isSafeInteger(n));
  assert.notEqual(n, gameboardNumericId('agent','mcp:git:status'));
});

test('observed projection does not invent capabilities, probabilities or disconnected graphs', () => {
  const actual = gameboardProjection({graphs:null,graphError:'SEER_OFFLINE',
    workers:[{id:'worker-1',status:'READY'}],
    providers:[{id:'git',status:'STOPPED',tools:[{name:'git_status',readOnly:true}],stats:{calls:0,failures:0}}],
    missions:[{id:'m-1',goal:'Fix a bug',status:'ACTIVE'}]});
  assert.equal(actual.graphSource,'UNAVAILABLE');
  assert.equal(actual.plans.length,0);
  assert.equal(actual.tools[0].metrics.successProbability,null);
  assert.equal(actual.tools[0].status,'STOPPED');
  assert.equal(actual.agents.length,1);
  assert.equal(actual.missions.length,1);
});

test('Aura owns planning with or without a graph, independently of workers', () => {
  for (const graphs of [null, [], [{ id: 'existing', nodes: [] }]]) {
    const board = gameboardProjection({ graphs, workers: [{ id: 'worker-1' }] });
    assert.deepEqual(board.strategy, { ownerId: 'aura', functionId: 'plan' });
    assert.deepEqual(board.agents.map(agent => agent.identity), ['worker-1']);
  }
});

test('shared graph projection preserves strategy simulation and separate receipts', () => {
  const p = gameboardProjection({graphs:[{id:'mission-1',objective:'Ship Lite',status:'ACTIVE',
    nodes:[{key:'a',title:'Test Android',status:'READY',dependencies:[],evidence_refs:[]}],
    strategic_board:{forecast:{terminalProbability:0.42},recommendedMoves:[{stepId:'a',score:0.5,executable:true}]}
  }]});
  assert.equal(p.plans[0].simulation.status,'SIMULATED');
  assert.equal(p.plans[0].simulation.observedOutcome,false);
  assert.deepEqual(p.plans[0].nodes[0].evidenceRefs,[]);
  assert.equal(p.plans[0].moves[0].executable,true);
});

test('scenario rollout is deterministic and cannot create an execution receipt', () => {
  const data={goalId:'goal:lite',missionId:'mission:android',steps:[
    {id:'test',goalImpact:0.5,verificationGain:0.7,informationGain:0.3,confidence:0.8,risk:0.2,effort:0.3},
    {id:'deploy',dependencies:['test'],goalImpact:0.9,verificationGain:1,informationGain:0.1,confidence:0.75,risk:0.3,effort:0.6},
  ]};
  const a=simulateGameboardScenario(data), b=simulateGameboardScenario(data);
  assert.deepEqual(a,b);
  assert.equal(a.executed,false); assert.equal(a.verified,false);
  assert.equal(a.result.stepSuccess.deploy,0.6);
  assert.equal(a.result.terminalProbability,0.6);
  assert.throws(()=>simulateGameboardScenario({...data,steps:[{...data.steps[0],confidence:undefined}]}),/METRIC_REQUIRED/);
});


test('Gameboard keeps recorded Aura goals visible before a SEER graph exists', () => {
  const board = gameboardProjection({
    graphs: [],
    primaryGoal: 'Understand the local JACO source and learn its architecture',
    missions: [],
    events: [{seq:7,ts:'2026-11-09T16:23:00Z',type:'MISSION_CREATED',missionId:'mission-a',
      payload:{goal:'confidential operator instruction',secret:'private-do-not-leak'}}],
  });
  assert.equal(board.graphSource, 'OBSERVED_EMPTY', 'empty graph list is not an observed plan');
  assert.equal(board.operatorGoal.statement, 'Understand the local JACO source and learn its architecture');
  assert.equal(board.operatorGoal.status, 'RECORDED_NOT_EXECUTION_VERIFIED');
  assert.equal(board.next.code, 'GOAL_AWAITING_GRAPH');
  assert.equal(board.plans.length,0,'no invented strategy nodes');
  assert.equal(board.activity[0].id,'bus:7');
  assert.equal(board.activity[0].outcome,'OBSERVED','mission creation is not task success');
  assert.doesNotMatch(JSON.stringify(board.activity), /private-do-not-leak|confidential operator instruction/, 'raw event payload is not broadcast');
});

test('durable mission receipts and action events distinguish verified execution from registration', () => {
  const board = gameboardProjection({
    graphs:null, graphError:'SEER_OFFLINE',primaryGoal:'Build product',
    missions:[{id:'m1',goal:'Build product',status:'BLOCKED',phase:'PLANNING',
      receipts:[
        {type:'repo-write',ok:true,verified:true},
        {type:'repo-test',ok:false,verified:false,error:'Command failed'},
      ]}],
    events:[
      {seq:13,ts:'2026-11-09T16:23:05Z',type:'NOVA_ACTION_RESULT',missionId:'m1',payload:{type:'repo-write',ok:true,verified:true}},
      {seq:12,ts:'2026-11-09T16:23:04Z',type:'NOVA_PLANNING_RESULT',missionId:'m1',payload:{error:'PLANNER_BLOCKED:capability missing'}},
      {seq:11,ts:'2026-11-09T16:23:03Z',type:'NOVA_ACTION_RESULT',missionId:'m1',payload:{type:'repo-read',ok:true,verified:false}},
    ],
  });
  assert.equal(board.graphSource,'UNAVAILABLE');
  assert.equal(board.missions[0].verifiedActions,1);
  assert.equal(board.missions[0].actionCount,2);
  assert.equal(board.missions[0].lastError,'Command failed');
  assert.equal(board.next.code,'MISSION_NEEDS_RECOVERY');
  assert.deepEqual(board.activity.map(e=>e.outcome),['VERIFIED','BLOCKED','OBSERVED']);
  assert.ok(board.activity.every(e=>e.evidenceRef.startsWith('bus:')));
});

test('tool registration and simulated forecasts never become verified execution evidence', () => {
  const board = gameboardProjection({graphs:[],providers:[{id:'git',status:'READY',tools:[{name:'git_push'}]}]});
  assert.equal(board.tools[0].status,'READY');
  assert.equal(board.tools[0].availability,'ADVERTISED_NOT_EXECUTION_VERIFIED');
  assert.equal(board.missions.length,0);
  assert.equal(board.activity.length,0);
  assert.equal(board.next.code,'NO_ACTIVE_WORK_OBSERVED');
});
