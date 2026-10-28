import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, makeId, deepClone } from './util.mjs';

const HIGH_CONSEQUENCE = new Set(['FINANCIAL_COMMITMENT','DELETE','PUBLISH','PERMISSION_ESCALATION','CREDENTIAL_CHANGE']);
const MAX_DURATION_MS = 8 * 60 * 60_000;
function boundedPositive(value, fallback, maximum, label) {
  const n = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) throw new Error(`INVALID_LEASE_${label}`);
  return n;
}
function boundedMoney(value, label) {
  const n = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error(`INVALID_LEASE_${label}`);
  return n;
}
function distinctActions(value, name) {
  if (!Array.isArray(value) || value.length > 200) throw new Error(`INVALID_LEASE_${name}`);
  const items = [...new Set(value.map(v => String(v).trim()))];
  if (items.some(v => !v || v.length > 120)) throw new Error(`INVALID_LEASE_${name}`);
  return items;
}
function requiredId(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${name}_REQUIRED`);
  return value.trim();
}

/**
 * Single-writer durable lease authority. Reservations are written BEFORE side effects.
 * This class must be invoked by the canonical Continuum owner only: its JSON store
 * is NOT a multi-process transaction database. For distributed workers, move state
 * to transactional storage and pass fencing generations to the actuator as well.
 */
export class ExecutionLeaseManager {
  constructor(root, events, operator, economic, { approvalVerifier = null } = {}) {
    this.file = path.join(root, 'execution-leases.json');
    this.events = events; this.operator = operator; this.economic = economic;
    this.approvalVerifier = approvalVerifier;
    this.state = readJson(this.file, { leases: {}, updatedAt: nowIso() });
    if (!this.state || typeof this.state.leases !== 'object' || !this.state.leases) throw new Error('LEASE_STATE_INVALID');
    // Conservatively quarantine every action whose side effect may have occurred
    // before the previous process died. Never silently retry it.
    let changed = false;
    for (const lease of Object.values(this.state.leases)) {
      for (const op of Object.values(lease.operations || {})) {
        if (op.status === 'RESERVED') { op.status = 'UNKNOWN_OUTCOME'; op.recoveredAt = nowIso(); changed = true; }
      }
    }
    if (changed) { this.#save(); this.events?.append({ stream:'lease', type:'lease.recovered_unknown_outcomes',actor:'runtime',data:{reason:'nonterminal reservations at startup'} }); }
  }
  issue(input = {}, actor = 'operator') {
    this.operator.assertExecutionAllowed();
    const id = input.id == null ? makeId('lease') : requiredId(input.id, 'LEASE_ID');
    if (this.state.leases[id]) throw new Error('LEASE_DUPLICATE_ID');
    const durationMs = boundedPositive(input.durationMs,15*60_000,MAX_DURATION_MS,'DURATION');
    const allowedActions = distinctActions(input.allowedActions,'ALLOWED_ACTIONS');
    if (!allowedActions.length) throw new Error('allowedActions is required');
    const forbiddenActions = distinctActions(input.forbiddenActions ?? [],'FORBIDDEN_ACTIONS');
    const maxActions = boundedPositive(input.maxActions,20,1000,'MAX_ACTIONS');
    const maxCloudUsd = boundedMoney(input.maxCloudUsd,'MAX_CLOUD_USD');
    const lease = {schema:'jaco.continuum.execution-lease.v2',id,
      missionId:input.missionId ? requiredId(input.missionId,'MISSION_ID') : null,
      agentId:input.agentId ? requiredId(input.agentId,'AGENT_ID') : null,
      allowedActions,forbiddenActions,maxActions,actionsUsed:0,maxCloudUsd,cloudUsdUsed:0,
      generation:1,operations:{},issuedAt:nowIso(),expiresAt:new Date(Date.now()+durationMs).toISOString(),
      revoked:false,operatorApprovalForHighConsequence:Boolean(input.operatorApprovalForHighConsequence),issuedBy:actor};
    this.state.leases[id]=lease;this.#save();this.#event('lease.issued',lease,actor,lease);return this.#public(lease);
  }
  get(id) { const l=this.#get(id);return this.#public(l); }
  list({activeOnly=false}={}) { return Object.values(this.state.leases).filter(l=>!activeOnly||this.#isActive(l)).map(l=>this.#public(l)); }
  authorize(id,{action,consequence='REVERSIBLE',cloudUsd=0,agentId=null,missionId=null,approvalRef=null}={}) {
    this.operator.assertExecutionAllowed();const l=this.#get(id);
    if (!this.#isActive(l)) throw new Error('EXECUTION_LEASE_EXPIRED_OR_REVOKED');
    const a=requiredId(action,'LEASE_ACTION');
    if (l.agentId && agentId !== l.agentId) throw new Error(agentId == null ? 'LEASE_AGENT_ID_REQUIRED' : 'LEASE_AGENT_MISMATCH');
    if (l.missionId && missionId !== l.missionId) throw new Error(missionId == null ? 'LEASE_MISSION_ID_REQUIRED' : 'LEASE_MISSION_MISMATCH');
    if (!l.allowedActions.includes(a) && !l.allowedActions.includes('*')) throw new Error(`LEASE_ACTION_NOT_ALLOWED:${a}`);
    if (l.forbiddenActions.includes(a)) throw new Error(`LEASE_ACTION_FORBIDDEN:${a}`);
    if (l.actionsUsed >= l.maxActions) throw new Error('LEASE_ACTION_BUDGET_EXHAUSTED');
    const amount=boundedMoney(cloudUsd,'CLOUD_USD');
    if (l.cloudUsdUsed+amount > l.maxCloudUsd+1e-9) throw new Error('LEASE_CLOUD_BUDGET_EXHAUSTED');
    if (HIGH_CONSEQUENCE.has(consequence)) {
      if (!l.operatorApprovalForHighConsequence || !approvalRef || typeof this.approvalVerifier !== 'function' || this.approvalVerifier({approvalRef,lease:l,action:a,consequence,agentId,missionId})!==true)
        throw new Error(`LEASE_OPERATOR_CHECKPOINT_REQUIRED:${consequence}`);
    }
    return {allowed:true,lease:this.#public(l)};
  }
  /** Make a durable, idempotent reservation BEFORE an external side effect. */
  beginAction(id,{operationId,action,consequence='REVERSIBLE',cloudUsd=0,agentId=null,missionId=null,approvalRef=null}={}) {
    const operation=requiredId(operationId,'LEASE_OPERATION_ID');
    const l=this.#get(id), existing=l.operations?.[operation];
    if (existing) {
      if (existing.action!==action || existing.agentId!==agentId || existing.missionId!==missionId || existing.consequence!==consequence) throw new Error('LEASE_OPERATION_ID_CONFLICT');
      if (existing.status!=='RESERVED') throw new Error(`LEASE_OPERATION_${existing.status}`);
      // Repeated request MUST NOT trigger the same external action twice.
      throw new Error('LEASE_OPERATION_ALREADY_RESERVED');
    }
    if ((l.agentId && agentId !== l.agentId) || (l.missionId && missionId !== l.missionId)) throw new Error('LEASE_RESERVATION_IDENTITY_REQUIRED');
    this.authorize(id,{action,consequence,cloudUsd,agentId,missionId,approvalRef});
    const cost=boundedMoney(cloudUsd,'CLOUD_USD');
    const reservation={operationId:operation,action,consequence,agentId,missionId,
      reservedCloudUsd:cost,status:'RESERVED',generation:l.generation,issuedAt:nowIso()};
    l.operations ||= {};l.operations[operation]=reservation;
    l.actionsUsed++;l.cloudUsdUsed+=cost;this.#save();
    this.#event('lease.action_reserved',l,agentId||'runtime',{operationId:operation,action,generation:l.generation,cloudUsd:cost});
    return deepClone(reservation);
  }
  finishAction(id,{operationId,generation,receiptRef=null,observedCloudUsd=0}={}) {
    const l=this.#get(id),op=l.operations?.[requiredId(operationId,'LEASE_OPERATION_ID')];
    if (!op) throw new Error('LEASE_RESERVATION_NOT_FOUND');
    if (op.status==='COMPLETED') return deepClone(op); // idempotent receipt handling
    if (op.status!=='RESERVED') throw new Error(`LEASE_OPERATION_${op.status}`);
    if (l.revoked || Date.now()>=Date.parse(l.expiresAt) || Number(generation)!==l.generation || generation!==op.generation) throw new Error('LEASE_FENCING_REJECTED');
    const cost=boundedMoney(observedCloudUsd,'ACTUAL_CLOUD_USD');
    if (cost>op.reservedCloudUsd+1e-9) throw new Error('LEASE_ACTUAL_COST_EXCEEDS_RESERVATION');
    op.status='COMPLETED';op.completedAt=nowIso();op.receiptRef=receiptRef?String(receiptRef):null;op.observedCloudUsd=cost;
    // Reserve charged in advance. Refund only the known-unused portion.
    l.cloudUsdUsed=Math.max(0,l.cloudUsdUsed-(op.reservedCloudUsd-cost));
    this.#save();this.#event('lease.action_completed',l,op.agentId||'runtime',{operationId:op.operationId,receiptRef:op.receiptRef});return deepClone(op);
  }
  markUnknown(id,{operationId,reason='execution outcome unknown'}={}) {
    const l=this.#get(id),op=l.operations?.[requiredId(operationId,'LEASE_OPERATION_ID')];
    if (!op) throw new Error('LEASE_RESERVATION_NOT_FOUND');
    if (op.status==='UNKNOWN_OUTCOME') return deepClone(op);
    if (op.status!=='RESERVED') throw new Error(`LEASE_OPERATION_${op.status}`);
    op.status='UNKNOWN_OUTCOME';op.reason=String(reason).slice(0,500);op.changedAt=nowIso();
    this.#save();this.#event('lease.action_unknown',l,'runtime',{operationId:op.operationId,reason:op.reason});return deepClone(op);
  }
  /** Legacy accounting only: new side-effecting adapters MUST use beginAction/finishAction. */
  consume(id,{action,consequence='REVERSIBLE',cloudUsd=0,agentId=null,missionId=null,verified=false,receiptRef=null}={}) {
    this.authorize(id,{action,consequence,cloudUsd,agentId,missionId});const l=this.#get(id);
    l.actionsUsed+=1;l.cloudUsdUsed+=boundedMoney(cloudUsd,'CLOUD_USD');l.lastActionAt=nowIso();this.#save();
    this.#event('lease.legacy_consumed',l,l.agentId||'runtime',{action,consequence,cloudUsd,reportedVerified:Boolean(verified),receiptRef,actionsUsed:l.actionsUsed});return this.#public(l);
  }
  extend(id,{durationMs=15*60_000,extraActions=0}={},actor='operator') {
    this.operator.assertExecutionAllowed();const l=this.#get(id);
    if(l.revoked)throw new Error('CANNOT_EXTEND_REVOKED_LEASE');
    if(Date.now()>=Date.parse(l.expiresAt))throw new Error('CANNOT_EXTEND_EXPIRED_LEASE');
    const duration=boundedPositive(durationMs,15*60_000,MAX_DURATION_MS,'DURATION');
    const actions=Number(extraActions);
    if(!Number.isSafeInteger(actions)||actions<0||l.maxActions+actions>1000)throw new Error('INVALID_LEASE_EXTRA_ACTIONS');
    l.expiresAt=new Date(Math.min(Date.now()+MAX_DURATION_MS,Date.parse(l.expiresAt)+duration)).toISOString();
    l.maxActions+=actions;
    // Prior outstanding reservations remain fenced out, not silently reissued.
    l.generation=(l.generation||1)+1;
    for(const op of Object.values(l.operations||{}))if(op.status==='RESERVED'){op.status='UNKNOWN_OUTCOME';op.reason='lease extended during execution';}
    this.#save();this.#event('lease.extended',l,actor,{expiresAt:l.expiresAt,maxActions:l.maxActions,generation:l.generation});return this.#public(l);
  }
  revoke(id,actor='operator',reason='revoked') {
    const l=this.state.leases[id];if(!l)return null;
    if(l.revoked)return this.#public(l);
    l.revoked=true;l.generation=(l.generation||1)+1;l.revokedAt=nowIso();l.revokedBy=actor;l.revokeReason=String(reason).slice(0,500);
    for(const op of Object.values(l.operations||{}))if(op.status==='RESERVED'){op.status='UNKNOWN_OUTCOME';op.reason='lease revoked during execution';}
    this.#save();this.#event('lease.revoked',l,actor,{reason:l.revokeReason});return this.#public(l);
  }
  revokeAll(actor='operator',reason='operator stop'){for(const id of Object.keys(this.state.leases))if(!this.state.leases[id].revoked)this.revoke(id,actor,reason);return this.list();}
  #isActive(l){return !l.revoked&&Date.parse(l.expiresAt)>Date.now()&&l.actionsUsed<l.maxActions;}
  #get(id){const l=this.state.leases[id];if(!l)throw new Error(`lease '${id}' not found`);return l;}
  #public(l){return deepClone(l);}
  #event(type,l,actor,data){this.events?.append({stream:'lease',type,entityId:l.id,actor,data});}
  #save(){this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
}
