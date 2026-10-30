import test from 'node:test';
import assert from 'node:assert/strict';
import { submitAuraAcceptance, safeAuraAcceptanceLines, AURA_ACCEPTANCE_GOAL } from '../src/aura-operator-command.mjs';

test('Aura sends canonical fixed operator goal over local Core and never targets Nova API',async()=>{
  const calls=[];
  const core={
    baseUrl:'http://127.0.0.1:3000',
    async request(path, options) {
      calls.push({path,options});
      return {success:true,schema:'jaco.operator-goal/v1',goal:{id:'goal-live-123'},
        development_cycle:{private:'SECRET_CYCLE'}};
    },
  };
  const result=await submitAuraAcceptance(core);
  assert.equal(result.status,'ACCEPTED');
  assert.equal(result.goalId,'goal-live-123');
  assert.equal(result.execution,'NOT_VERIFIED');
  assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/api/aura/workbench/start-goal');
  assert.equal(calls[0].options.method,'POST');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.goal,AURA_ACCEPTANCE_GOAL);
  assert.equal(body.horizon,'short');
  assert.match(body.goal,/Aura: assess/);
  assert.doesNotMatch(JSON.stringify(calls),/\/api\/connected\/nova\/missions|\/api\/connected\/goals/);
  const lines=safeAuraAcceptanceLines(result).join('\n');
  assert.match(lines,/goal-live-123/);
  assert.match(lines,/NOT_VERIFIED/);
  assert.doesNotMatch(lines,/SECRET_CYCLE|Aura: assess/);
});

test('remote or credentialed Core URLs cannot receive operator control',async()=>{
  for(const baseUrl of ['https://api.example.com','http://10.0.0.2:3000',
    'http://127.0.0.1:3000?token=secret',
    'http://operator:password@localhost:3000']) {
    let called=false;
    await assert.rejects(submitAuraAcceptance({baseUrl,
      request:async()=>{called=true;return {}}}),/AURA_OPERATOR_LOOPBACK_REQUIRED/);
    assert.equal(called,false);
  }
});

test('Core failure or missing real goal ID can never be reported as accepted',async()=>{
  for(const reply of [{success:false,schema:'jaco.operator-goal/v1',goal:{id:'a'}},
    {success:true,schema:'jaco.operator-goal/v1',goal:{}},
    {success:true,schema:'jaco.operator-goal/v1',goal:{id:'a\nsecret'}},
    {success:true,schema:'jaco.connected-goal/v1',goal:{id:'safe'}}]) {
    await assert.rejects(submitAuraAcceptance({baseUrl:'http://localhost:3000',request:async()=>reply}),
      /AURA_CANONICAL_GOAL_RECEIPT_INVALID/);
  }
});

test('public projection is fully bounded and never prints source or private details',()=>{
  const value={schema:'jaco.aura-operator-command/v1',status:'ACCEPTED',
    goalId:'\x1b[31mprivate',goal:'OPERATOR_SECRET',stderr:'C:/Users/secret'};
  const result=safeAuraAcceptanceLines(value).join('\n');
  assert.match(result,/UNVERIFIED/);
  assert.doesNotMatch(result,/SECRET|Users|private|31m/);
});

test('the only first-command prompt is observation-oriented and disallows mutations',()=>{
  assert.match(AURA_ACCEPTANCE_GOAL,/observation-only/);
  assert.match(AURA_ACCEPTANCE_GOAL,/do not change files/);
  assert.match(AURA_ACCEPTANCE_GOAL,/Do not create a parallel Nova/);
});
