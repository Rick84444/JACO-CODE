import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ExecutionLeaseManager } from '../../runtime/src/server/continuum/leaseManager.mjs';
import { OperatorControl } from '../../runtime/src/server/continuum/operatorControl.mjs';
import { AutonomousCycleLeaseBridge, CYCLE_ACTION, CYCLE_AGENT_ID, CYCLE_MISSION_ID } from '../../runtime/src/server/continuum/autonomousCycleLeaseBridge.mjs';

const setup=()=>{
  const workspaceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-lease-bridge-'));
  const root=path.join(workspaceRoot,'.jaco','continuum');fs.mkdirSync(root,{recursive:true});
  const events=[];const eventStore={append:e=>events.push(e)};
  const operator=new OperatorControl(root,eventStore);
  const leases=new ExecutionLeaseManager(root,eventStore,operator,null);
  const bridge=new AutonomousCycleLeaseBridge({workspaceRoot,leases,operator,events:eventStore});
  return {workspaceRoot,root,events,operator,leases,bridge,dispose:()=>fs.rmSync(workspaceRoot,{recursive:true,force:true})};
};
const wait=async(bridge,timeout=100000)=>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const status=bridge.status();if(status.state!=='RUNNING'&&status.state!=='STOPPING')return status;await new Promise(r=>setTimeout(r,75));}
  throw new Error('TEST_RUN_TIMEOUT');
};

test('operator-issued lease is limited to a single, local, zero-cloud Cognitive Lab operation',()=>{
 const e=setup();try{
  const l=e.bridge.issueLease({durationMs:120000});
  assert.equal(l.agentId,CYCLE_AGENT_ID);assert.equal(l.missionId,CYCLE_MISSION_ID);
  assert.deepEqual(l.allowedActions,[CYCLE_ACTION]);assert.equal(l.maxCloudUsd,0);assert.equal(l.maxActions,1);
  assert.throws(()=>e.bridge.issueLease({durationMs:900001}),/CYCLE_LEASE_DURATION_INVALID/);
  assert.throws(()=>e.bridge.start({until:1,leaseId:'missing',operationId:'operation-1'}),/not found/);
  const scope=e.leases.issue({agentId:'not-this-agent',missionId:CYCLE_MISSION_ID,allowedActions:[CYCLE_ACTION],maxActions:1});
  assert.throws(()=>e.bridge.start({until:1,leaseId:scope.id,operationId:'operation-1'}),/CYCLE_LEASE_SCOPE_DENIED/);
  assert.throws(()=>e.bridge.start({until:0,leaseId:l.id,operationId:'operation-1'}),/CYCLE_TARGET_INVALID/);
  assert.throws(()=>e.bridge.start({until:1,leaseId:l.id,operationId:'bad op'}),/CYCLE_OPERATION_ID_REQUIRED/);
  assert.equal(Object.keys(e.leases.get(l.id).operations).length,0);
 }finally{e.dispose()}
});

test('a real Continuum lease drives isolated runner one cycle per child, with a durable receipt and no replay',async()=>{
 const e=setup();try{
  const l=e.bridge.issueLease({durationMs:180000});
  const s=e.bridge.start({leaseId:l.id,operationId:'cycle-op-1',until:3});
  assert.equal(s.state,'RUNNING');
  assert.throws(()=>e.bridge.start({leaseId:l.id,operationId:'cycle-op-2',until:3}),/CYCLE_RUN_ALREADY_ACTIVE/);
  const ended=await wait(e.bridge);
  assert.equal(ended.state,'COMPLETED',JSON.stringify(ended.run));
  assert.equal(ended.board.summary.cycles,3);
  assert.ok(ended.run.receiptRef.startsWith('cycle-ledger-sha256:'));
  assert.equal(e.leases.get(l.id).operations['cycle-op-1'].status,'COMPLETED');
  assert.throws(()=>e.bridge.start({leaseId:l.id,operationId:'cycle-op-1',until:4}),/LEASE_OPERATION_COMPLETED|EXECUTION_LEASE_EXPIRED_OR_REVOKED|LEASE_ACTION_BUDGET_EXHAUSTED/);
  assert.equal(e.events.filter(x=>x.type==='cycle.bridge_completed').length,1);
 }finally{e.dispose()}
});

test('operator stop revokes fencing and forbids replay of uncertain operation',async()=>{
 const e=setup();try{
  const l=e.bridge.issueLease({durationMs:180000});
  e.bridge.start({leaseId:l.id,operationId:'stop-op',until:33});
  const out=e.bridge.stop({leaseId:l.id,reason:'test emergency'});
  assert.equal(out.state,'STOPPING');
  const ended=await wait(e.bridge);
  assert.equal(ended.state,'RECONCILIATION_REQUIRED');
  assert.equal(e.leases.get(l.id).operations['stop-op'].status,'UNKNOWN_OUTCOME');
  assert.equal(e.leases.get(l.id).revoked,true);
  const second=e.bridge.issueLease({durationMs:180000});
  assert.throws(()=>e.bridge.start({leaseId:second.id,operationId:'second-op',until:1}),/CYCLE_RECONCILIATION_REQUIRED/);
  const reopened=new ExecutionLeaseManager(e.root,{append(){}},e.operator,null);
  const afterRestart=new AutonomousCycleLeaseBridge({workspaceRoot:e.workspaceRoot,leases:reopened,operator:e.operator,events:{append(){}}});
  assert.equal(afterRestart.status().state,'RECONCILIATION_REQUIRED');
 }finally{e.dispose()}
});

test('paused canonical operator rejects lease issuance, and nonmatching stop cannot kill active job',async()=>{
 const e=setup();try{
  const l=e.bridge.issueLease({durationMs:180000});
  e.operator.pause('test');
  assert.throws(()=>e.bridge.issueLease(),/RUNTIME_PAUSED/);
  assert.throws(()=>e.bridge.start({leaseId:l.id,operationId:'paused',until:1}),/RUNTIME_PAUSED/);
  e.operator.resume('test');
  e.bridge.start({leaseId:l.id,operationId:'actual',until:33});
  assert.throws(()=>e.bridge.stop({leaseId:'other',reason:'nope'}),/CYCLE_STOP_LEASE_MISMATCH/);
  e.bridge.stopForOperator('operator emergency stop');
  const ended=await wait(e.bridge);
  assert.equal(ended.state,'RECONCILIATION_REQUIRED');
 }finally{e.dispose()}
});

test('emergency-stop path does not depend on a readable Cognitive Lab journal',()=>{
 const e=setup();try{
  const state=path.join(e.workspaceRoot,'.jaco','autonomous-cycles');fs.mkdirSync(state,{recursive:true});
  fs.writeFileSync(path.join(state,'events.jsonl'),'{broken\n');
  assert.throws(()=>e.bridge.status(),/CYCLE_LEDGER_INTEGRITY_FAILED/);
  assert.doesNotThrow(()=>e.bridge.stopForOperator('emergency stop'));
  const stopped=e.operator.emergencyStop('operator','test');
  assert.equal(stopped.emergencyLatched,true);
 }finally{e.dispose()}
});

test('Lite-style installation without ESM lab files remains startable and reports unavailable',()=>{
 const e=setup();try{
  const bridge=new AutonomousCycleLeaseBridge({workspaceRoot:e.workspaceRoot,leases:e.leases,operator:e.operator,events:{append(){}},runScript:path.join(e.workspaceRoot,'missing','run.mjs')});
  const status=bridge.status();
  assert.equal(status.state,'UNAVAILABLE');assert.equal(status.runtimeInstalled,false);
  assert.throws(()=>bridge.issueLease(),/CYCLE_RUNTIME_NOT_INSTALLED/);
  assert.equal(e.leases.list().length,0);
 }finally{e.dispose()}
});
