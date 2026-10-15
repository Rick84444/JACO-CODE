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

test('shared graph projection preserves SEER simulation and separate receipts', () => {
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
