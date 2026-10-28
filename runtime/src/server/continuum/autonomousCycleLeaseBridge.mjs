/**
 * Canonical Continuum -> deterministic Cognitive Lab adapter.
 * This is intentionally NOT a generic shell agent or LLM code editor. The lease
 * covers only the fixed, isolated TaskEngine lab under .jaco/autonomous-cycles.
 * Its single writer is the existing Continuum runtime process.
 */
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { inspectCycles, MAX_CYCLES } from '../../../../agents/cognitive-lab/autonomous-cycles/cycle-runtime.mjs';
import { readAutonomousCycleBoard } from '../connected/autonomousCycleBoard.mjs';

export const CYCLE_AGENT_ID = 'jaco-cognitive-lab-executor';
export const CYCLE_MISSION_ID = 'jaco-cognitive-lab';
export const CYCLE_ACTION = 'COGNITIVE_LAB_RUN';
const RUNNER = fileURLToPath(new URL('../../../../agents/cognitive-lab/autonomous-cycles/run.mjs', import.meta.url));
const MAX_LEASE_MS = 15 * 60_000;
const MAX_STEP_MS = 45_000;
const MAX_OUTPUT = 16_384;

function positiveInteger(value, max, name) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw Error(`${name}_INVALID`);
  return value;
}
function requiredOperationId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][\w:-]{0,119}$/.test(value)) throw Error('CYCLE_OPERATION_ID_REQUIRED');
  return value;
}
function codeOf(error){return String(error instanceof Error?error.message:error).slice(0,350)}

export class AutonomousCycleLeaseBridge {
  constructor({workspaceRoot,leases,operator,events,spawnChild=spawn,runScript=RUNNER}) {
    this.workspaceRoot=path.resolve(workspaceRoot);
    this.stateRoot=path.join(this.workspaceRoot,'.jaco','autonomous-cycles');
    this.leases=leases;this.operator=operator;this.events=events;
    this.spawnChild=spawnChild;this.runScript=runScript;
    this.active=null;this.last=null;
  }
  issueLease({durationMs=MAX_LEASE_MS}={},actor='operator'){
    positiveInteger(durationMs,MAX_LEASE_MS,'CYCLE_LEASE_DURATION');
    if (this.active) throw Error('CYCLE_RUN_ALREADY_ACTIVE');
    return this.leases.issue({
      missionId:CYCLE_MISSION_ID,agentId:CYCLE_AGENT_ID,
      allowedActions:[CYCLE_ACTION],forbiddenActions:[],durationMs,
      maxActions:1,maxCloudUsd:0,operatorApprovalForHighConsequence:false,
    },actor);
  }
  #unknown(){
    return this.leases.list().flatMap(l=>Object.values(l.operations||{}).filter(op=>op.action===CYCLE_ACTION&&op.status==='UNKNOWN_OUTCOME').map(op=>({leaseId:l.id,operationId:op.operationId,status:op.status})));
  }
  status(){
    // The IDE's existing projector is untrusted for attestations, but validates
    // format/chain and is sufficient to display local deterministic progress.
    const board=readAutonomousCycleBoard(this.workspaceRoot);
    const unknown=this.#unknown();
    return {schema:'jaco.continuum.cognitive-lab-lease.v1',simulation:'DETERMINISTIC',
      state:this.active?(this.active.stopRequested?'STOPPING':'RUNNING'):unknown.length?'RECONCILIATION_REQUIRED':this.last?.state||board.state,
      run:this.active?this.#public(this.active):this.last?this.#public(this.last):null,
      unresolved:unknown.slice(0,10),board,
      remoteMainUpdated:false,independentModelDecisions:false};
  }
  #public(run){return {state:run.state,leaseId:run.leaseId,operationId:run.operationId,
    targetCycle:run.until,lastCompletedCycle:run.lastCompletedCycle,startedAt:run.startedAt,
    endedAt:run.endedAt||null,error:run.error||null,receiptRef:run.receiptRef||null};}
  start({leaseId,operationId,until}={}){
    if (this.active) throw Error('CYCLE_RUN_ALREADY_ACTIVE');
    if (this.#unknown().length) throw Error('CYCLE_RECONCILIATION_REQUIRED');
    const target=positiveInteger(until,MAX_CYCLES,'CYCLE_TARGET');
    const opId=requiredOperationId(operationId);
    if (typeof leaseId!=='string'||!leaseId.trim()) throw Error('CYCLE_LEASE_ID_REQUIRED');
    const lease=this.leases.get(leaseId);
    if (lease.agentId!==CYCLE_AGENT_ID||lease.missionId!==CYCLE_MISSION_ID ||
        !lease.allowedActions.includes(CYCLE_ACTION)) throw Error('CYCLE_LEASE_SCOPE_DENIED');
    this.operator.assertExecutionAllowed();
    const board=readAutonomousCycleBoard(this.workspaceRoot);
    const previous=board.summary?.cycles||0;
    if (target<=previous) throw Error('CYCLE_TARGET_ALREADY_COMPLETED');
    // Reserve once, on the actual single-writer Continuum lease manager.
    const reservation=this.leases.beginAction(leaseId,{operationId:opId,action:CYCLE_ACTION,
      consequence:'REVERSIBLE',cloudUsd:0,agentId:CYCLE_AGENT_ID,missionId:CYCLE_MISSION_ID});
    const job={state:'RUNNING',leaseId,operationId:opId,until:target,
      generation:reservation.generation,lastCompletedCycle:previous,
      startedAt:new Date().toISOString(),stopRequested:false,child:null};
    this.active=job;
    this.events?.append({stream:'cognitive-cycle',type:'cycle.bridge_started',entityId:opId,actor:CYCLE_AGENT_ID,
      data:{leaseId,operationId:opId,until:target,fromCycle:previous,simulation:'DETERMINISTIC'}});
    queueMicrotask(()=>{void this.#drive(job)});
    return this.status();
  }
  async #drive(job){
    try{
      for(let cycle=job.lastCompletedCycle+1;cycle<=job.until;cycle++){
        if(job.stopRequested)throw Error('CYCLE_RUN_STOP_REQUESTED');
        this.operator.assertExecutionAllowed();
        const l=this.leases.get(job.leaseId);
        if(l.revoked||l.generation!==job.generation||Date.now()>=Date.parse(l.expiresAt))throw Error('CYCLE_LEASE_FENCED');
        await this.#oneCycle(job,cycle,Date.parse(l.expiresAt));
        if(job.stopRequested)throw Error('CYCLE_RUN_STOP_REQUESTED');
        const proof=inspectCycles(this.stateRoot); // verifies HMAC reviewer receipts and hash chain
        if(proof.cycles!==cycle)throw Error('CYCLE_RECEIPT_COUNT_MISMATCH');
        job.lastCompletedCycle=cycle;
      }
      const verified=inspectCycles(this.stateRoot);
      if(verified.cycles!==job.until)throw Error('CYCLE_FINAL_ATTESTATION_MISMATCH');
      const receiptRef=`cycle-ledger-sha256:${verified.ledgerTip}`;
      this.leases.finishAction(job.leaseId,{operationId:job.operationId,generation:job.generation,receiptRef});
      job.state='COMPLETED';job.receiptRef=receiptRef;
      this.events?.append({stream:'cognitive-cycle',type:'cycle.bridge_completed',entityId:job.operationId,
        actor:CYCLE_AGENT_ID,data:{leaseId:job.leaseId,until:job.until,receiptRef,localCommits:verified.actualGitCommits,simulation:'DETERMINISTIC'}});
    }catch(e){
      job.state='UNKNOWN_OUTCOME';job.error=codeOf(e);
      try{this.leases.markUnknown(job.leaseId,{operationId:job.operationId,reason:job.error})}catch{}
      this.events?.append({stream:'cognitive-cycle',type:'cycle.bridge_unknown',entityId:job.operationId,
        actor:CYCLE_AGENT_ID,data:{leaseId:job.leaseId,reason:job.error,completedThrough:job.lastCompletedCycle}});
    }finally{
      job.endedAt=new Date().toISOString();job.child=null;
      if(this.active===job){this.last=job;this.active=null}
    }
  }
  #oneCycle(job,cycle,leaseDeadline){return new Promise((resolve,reject)=>{
    const timeoutMs=Math.min(MAX_STEP_MS,leaseDeadline-Date.now());
    if(timeoutMs<100) return reject(Error('CYCLE_LEASE_EXPIRED'));
    const child=this.spawnChild(process.execPath,[this.runScript,'run','--state',this.stateRoot,'--until',String(cycle)],{
      cwd:this.workspaceRoot,stdio:['ignore','pipe','pipe'],
      env:{PATH:process.env.PATH||'',HOME:process.env.HOME||os.tmpdir(),TMPDIR:process.env.TMPDIR||os.tmpdir(),LANG:'C.UTF-8'},
    });
    job.child=child;
    let ended=false,output=0;const settle=(err)=>{
      if(ended)return;ended=true;clearTimeout(timer);job.child=null;
      err?reject(err):resolve();
    };
    const timer=setTimeout(()=>{child.kill('SIGKILL');settle(Error('CYCLE_STEP_TIMEOUT'))},timeoutMs);
    for(const stream of [child.stdout,child.stderr])stream?.on('data',chunk=>{
      output+=chunk.length;if(output>MAX_OUTPUT){child.kill('SIGKILL');settle(Error('CYCLE_CHILD_OUTPUT_LIMIT'))}
    });
    child.once('error',e=>settle(Error(`CYCLE_CHILD_START_FAILED:${codeOf(e)}`)));
    child.once('close',code=>settle(code===0?null:Error(`CYCLE_CHILD_EXIT_${code??'UNKNOWN'}`)));
    if(job.stopRequested){child.kill('SIGKILL');settle(Error('CYCLE_RUN_STOP_REQUESTED'))}
  })}
  stop({leaseId,reason='operator stop'}={}){
    const job=this.active;
    if(!job) return this.status();
    if(leaseId!==job.leaseId)throw Error('CYCLE_STOP_LEASE_MISMATCH');
    job.stopRequested=true;job.state='STOPPING';
    job.child?.kill('SIGKILL');
    // Revocation increments the fencing generation; the result cannot be marked
    // as successfully completed, even if the child exits during cancellation.
    this.leases.revoke(job.leaseId,'operator',String(reason).slice(0,200));
    return this.status();
  }
  stopForOperator(reason='operator pause'){
    // Emergency stop MUST NOT depend on the health of the local lab journal or
    // IDE projector. A broken/unreadable journal cannot veto canonical e-stop.
    const job=this.active;
    if(!job)return {stopRequested:false};
    job.stopRequested=true;job.state='STOPPING';
    try { job.child?.kill('SIGKILL') } catch {}
    try { this.leases.revoke(job.leaseId,'operator',String(reason).slice(0,200)) }
    catch { /* parent Continuum operator STOP still must execute */ }
    return {stopRequested:true};
  }
}
