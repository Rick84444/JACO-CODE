import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, makeId, deepClone } from './util.mjs';

const HIGH_CONSEQUENCE = new Set(['FINANCIAL_COMMITMENT','DELETE','PUBLISH','PERMISSION_ESCALATION','CREDENTIAL_CHANGE']);

export class ExecutionLeaseManager {
  constructor(root,events,operator,economic){this.file=path.join(root,'execution-leases.json');this.events=events;this.operator=operator;this.economic=economic;this.state=readJson(this.file,{leases:{},updatedAt:nowIso()});}
  issue(input,actor='operator'){
    this.operator.assertExecutionAllowed();
    const id=input.id?String(input.id).slice(0,180):makeId('lease');
    const durationMs=Math.max(1_000,Math.min(Number(input.durationMs||15*60_000),8*60*60_000));
    const allowedActions=Array.isArray(input.allowedActions)?[...new Set(input.allowedActions.map(String))]:[];
    if(!allowedActions.length)throw new Error('allowedActions is required');
    const lease={schema:'jaco.continuum.execution-lease.v1',id,missionId:String(input.missionId||'').slice(0,180)||null,agentId:String(input.agentId||'').slice(0,180)||null,allowedActions,forbiddenActions:Array.isArray(input.forbiddenActions)?[...new Set(input.forbiddenActions.map(String))]:[],maxActions:Math.max(1,Math.min(Number(input.maxActions||20),1000)),actionsUsed:0,maxCloudUsd:Math.max(0,Number(input.maxCloudUsd||0)),cloudUsdUsed:0,issuedAt:nowIso(),expiresAt:new Date(Date.now()+durationMs).toISOString(),revoked:false,operatorApprovalForHighConsequence:Boolean(input.operatorApprovalForHighConsequence),issuedBy:actor};
    this.state.leases[id]=lease;this.#save();this.events.append({stream:'lease',type:'lease.issued',entityId:id,actor,data:lease});return deepClone(lease);
  }
  get(id){const l=this.state.leases[id];if(!l)throw new Error(`lease '${id}' not found`);return deepClone(l);}
  list({activeOnly=false}={}){return Object.values(this.state.leases).filter(l=>!activeOnly||this.#isActive(l)).map(deepClone);}
  authorize(id,{action,consequence='REVERSIBLE',cloudUsd=0}={}){
    this.operator.assertExecutionAllowed();const l=this.state.leases[id];if(!l)throw new Error('EXECUTION_LEASE_REQUIRED');if(!this.#isActive(l))throw new Error('EXECUTION_LEASE_EXPIRED_OR_REVOKED');
    if(!l.allowedActions.includes(action)&&!l.allowedActions.includes('*'))throw new Error(`LEASE_ACTION_NOT_ALLOWED:${action}`);
    if(l.forbiddenActions.includes(action))throw new Error(`LEASE_ACTION_FORBIDDEN:${action}`);
    if(l.actionsUsed>=l.maxActions)throw new Error('LEASE_ACTION_BUDGET_EXHAUSTED');
    if(Number(cloudUsd)>0&&l.cloudUsdUsed+Number(cloudUsd)>l.maxCloudUsd)throw new Error('LEASE_CLOUD_BUDGET_EXHAUSTED');
    if(HIGH_CONSEQUENCE.has(consequence)&&!l.operatorApprovalForHighConsequence)throw new Error(`LEASE_OPERATOR_CHECKPOINT_REQUIRED:${consequence}`);
    return {allowed:true,lease:deepClone(l)};
  }
  consume(id,{action,consequence='REVERSIBLE',cloudUsd=0,verified=false,receiptRef=null}={}){
    this.authorize(id,{action,consequence,cloudUsd});const l=this.state.leases[id];l.actionsUsed+=1;l.cloudUsdUsed+=Math.max(0,Number(cloudUsd)||0);l.lastActionAt=nowIso();this.#save();this.events.append({stream:'lease',type:'lease.consumed',entityId:id,actor:l.agentId||'runtime',data:{action,consequence,cloudUsd,verified,receiptRef,actionsUsed:l.actionsUsed}});return deepClone(l);
  }
  revoke(id,actor='operator',reason='revoked'){const l=this.state.leases[id];if(!l)return null;l.revoked=true;l.revokedAt=nowIso();l.revokedBy=actor;l.revokeReason=String(reason).slice(0,500);this.#save();this.events.append({stream:'lease',type:'lease.revoked',entityId:id,actor,data:{reason}});return deepClone(l);}
  revokeAll(actor='operator',reason='operator stop'){for(const id of Object.keys(this.state.leases))if(this.#isActive(this.state.leases[id]))this.revoke(id,actor,reason);return this.list();}
  #isActive(l){return !l.revoked&&Date.parse(l.expiresAt)>Date.now()&&l.actionsUsed<l.maxActions;}
  #save(){this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
}
