import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, makeId, deepClone, redactSensitive, sha256, canonicalJson } from './util.mjs';

const HEARTBEAT_SAVE_MS=10_000;
const DEFINITION_FIELDS=['name','role','provider','model','capabilities','tools','permissions','status','executionMode','sandboxId','metadata'];
function agentDefinition(a){return canonicalJson(Object.fromEntries(DEFINITION_FIELDS.map(k=>[k,a?.[k]??null])));}
const TERMINAL_TASK_STATES=new Set(['COMPLETED','FAILED','CANCELLED','CANCELED','REJECTED']);
function normalizeTaskInput(input={}){
  return {
    missionId:String(input.missionId||'').slice(0,180)||null,
    commitmentId:String(input.commitmentId||'').slice(0,180)||null,
    title:String(input.title||'').slice(0,500),
    kind:String(input.kind||'GENERIC').slice(0,120),
    payload:input.payload&&typeof input.payload==='object'?redactSensitive(input.payload):{},
    requirements:Array.isArray(input.requirements)?input.requirements.map(String).slice(0,100):[],
    preferredRoles:Array.isArray(input.preferredRoles)?input.preferredRoles.map(String).slice(0,20):[],
    consequence:String(input.consequence||'REVERSIBLE').slice(0,80),
    leaseId:input.leaseId?String(input.leaseId).slice(0,180):null,
    idempotencyKey:input.idempotencyKey?String(input.idempotencyKey).slice(0,240):null,
    maxAttempts:Math.max(1,Math.min(Number(input.maxAttempts||3),20)),
    notBefore:input.notBefore?String(input.notBefore):null,
  };
}
function executionFingerprint(value={}){
  return `sha256:${sha256(canonicalJson({
    missionId:value.missionId||null,
    commitmentId:value.commitmentId||null,
    kind:value.kind||'GENERIC',
    payload:value.payload||{},
    requirements:Array.isArray(value.requirements)?value.requirements:[],
    preferredRoles:Array.isArray(value.preferredRoles)?value.preferredRoles:[],
    consequence:value.consequence||'REVERSIBLE',
    maxAttempts:Number(value.maxAttempts||3),
    notBefore:value.notBefore||null,
  }))}`;
}

export class RuntimeHub {
  constructor(root,events,evidence=null){this.file=path.join(root,'runtime-hub.json');this.events=events;this.evidence=evidence;this.state=readJson(this.file,{agents:{},messages:[],tasks:{},updatedAt:nowIso()});}
  registerAgent(input,actor='operator'){
    const id=String(input.id||makeId('agent')).slice(0,180);const existing=this.state.agents[id];
    const agent={schema:'jaco.continuum.agent.v2',id,name:String(input.name||id).slice(0,240),role:String(input.role||existing?.role||'worker').slice(0,120),provider:String(input.provider||existing?.provider||'router').slice(0,120),model:String(input.model||existing?.model||'dynamic').slice(0,180),capabilities:Array.isArray(input.capabilities)?[...new Set(input.capabilities.map(String))].slice(0,200):(existing?.capabilities||[]),tools:Array.isArray(input.tools)?[...new Set(input.tools.map(String))].slice(0,300):(existing?.tools||[]),permissions:Array.isArray(input.permissions)?[...new Set(input.permissions.map(String))].slice(0,200):(existing?.permissions||[]),status:String(input.status||existing?.status||'ONLINE').slice(0,40),executionMode:String(existing?.executionMode||input.executionMode||'NORMAL').slice(0,40),sandboxId:existing?.sandboxId||null,registeredAt:existing?.registeredAt||nowIso(),lastHeartbeatAt:nowIso(),progressAt:existing?.progressAt||nowIso(),lastProgressHash:existing?.lastProgressHash||null,currentMissionId:existing?.currentMissionId||null,currentTaskId:existing?.currentTaskId||null,idleJustification:existing?.idleJustification||null,metadata:input.metadata&&typeof input.metadata==='object'?redactSensitive(input.metadata):(existing?.metadata||{}),revision:Number(existing?.revision||0)+1};
    // The scheduler re-registers its built-in workers every tick. An unchanged definition is only a heartbeat:
    // writing the full agent to the ledger and rewriting the hub file each time produced ~160 events/min while idle.
    if(existing&&agentDefinition(existing)===agentDefinition(agent)){existing.lastHeartbeatAt=agent.lastHeartbeatAt;existing.status=agent.status;this.#saveSoon();return deepClone(existing);}
    this.state.agents[id]=agent;this.#save();this.events.append({stream:'hub',type:existing?'agent.updated':'agent.registered',entityId:id,actor,data:agent});return deepClone(agent);
  }
  heartbeat(id,input={}){const a=this.state.agents[id];if(!a)throw new Error(`agent '${id}' not registered`);a.status=input.status?String(input.status).slice(0,40):'ONLINE';a.lastHeartbeatAt=nowIso();if(input.currentMissionId!==undefined)a.currentMissionId=input.currentMissionId?String(input.currentMissionId).slice(0,180):null;if(input.currentTaskId!==undefined)a.currentTaskId=input.currentTaskId?String(input.currentTaskId).slice(0,180):null;if(input.idleJustification!==undefined)a.idleJustification=input.idleJustification?String(input.idleJustification).slice(0,1000):null;if(input.progressHash!==undefined){const ph=input.progressHash?String(input.progressHash).slice(0,240):null;if(ph!==a.lastProgressHash){a.lastProgressHash=ph;a.progressAt=nowIso();}}if(input.progress===true)a.progressAt=nowIso();this.#saveSoon();return deepClone(a);}
  setExecutionMode(id,{mode='NORMAL',sandboxId=null,reason=null}={}){const a=this.state.agents[id];if(!a)throw new Error(`agent '${id}' not registered`);a.executionMode=String(mode).slice(0,40);a.sandboxId=sandboxId?String(sandboxId).slice(0,180):null;a.executionModeReason=reason?String(reason).slice(0,1000):null;a.revision=Number(a.revision||0)+1;this.#save();this.events.append({stream:'hub',type:'agent.execution_mode',entityId:id,actor:'risk-router',data:{mode:a.executionMode,sandboxId:a.sandboxId,reason:a.executionModeReason}});return deepClone(a);}
  listAgents(){const now=Date.now();return Object.values(this.state.agents).map(a=>({...deepClone(a),liveness:now-Date.parse(a.lastHeartbeatAt)<120_000?'LIVE':'STALE'}));}
  sendMessage(input,actor='system'){
    const from=String(input.from||actor).slice(0,180),to=String(input.to||'broadcast').slice(0,180);if(from!=='operator'&&!this.state.agents[from]&&from!=='system')throw new Error(`sender '${from}' is not registered`);if(to!=='broadcast'&&!this.state.agents[to]&&to!=='operator')throw new Error(`recipient '${to}' is not registered`);
    const msg={schema:'jaco.continuum.hub-message.v1',id:makeId('msg'),type:String(input.type||'message').slice(0,80),from,to,missionId:input.missionId?String(input.missionId).slice(0,180):null,taskId:input.taskId?String(input.taskId).slice(0,180):null,content:redactSensitive(input.content??null),stateRefs:Array.isArray(input.stateRefs)?input.stateRefs.map(String).slice(0,100):[],evidenceRefs:Array.isArray(input.evidenceRefs)?input.evidenceRefs.map(String).slice(0,100):[],createdAt:nowIso(),acknowledgedBy:[]};
    this.state.messages.push(msg);if(this.state.messages.length>5000)this.state.messages=this.state.messages.slice(-5000);this.#save();this.events.append({stream:'hub',type:`message.${msg.type}`,entityId:msg.id,actor:from,data:{to,missionId:msg.missionId,taskId:msg.taskId}});return deepClone(msg);
  }
  inbox(agentId,{after=null,limit=100}={}){const list=this.state.messages.filter(m=>m.to===agentId||m.to==='broadcast').filter(m=>!after||Date.parse(m.createdAt)>Date.parse(after));return list.slice(-Math.min(500,Number(limit)||100)).map(deepClone);}
  acknowledge(agentId,messageId){const m=this.state.messages.find(x=>x.id===messageId);if(!m)throw new Error('message not found');if(!m.acknowledgedBy.includes(agentId))m.acknowledgedBy.push(agentId);this.#save();return deepClone(m);}
  createTask(input,actor='planner'){
    const normalized=normalizeTaskInput(input);const fingerprint=executionFingerprint(normalized);
    if(normalized.idempotencyKey){
      const replay=Object.values(this.state.tasks).find(t=>t.idempotencyKey===normalized.idempotencyKey);
      if(replay){
        const existingFingerprint=replay.idempotencyFingerprint||executionFingerprint(replay);
        if(existingFingerprint!==fingerprint)throw new Error('IDEMPOTENCY_CONFLICT: key already exists for a different task payload');
        this.events.append({stream:'hub',type:'task.idempotent_replay',entityId:replay.id,actor,data:{idempotencyKey:normalized.idempotencyKey}});
        return deepClone(replay);
      }
    }
    const id=input.id?String(input.id).slice(0,180):makeId('task');
    if(this.state.tasks[id]){
      const existing=this.state.tasks[id];const existingFingerprint=existing.idempotencyFingerprint||executionFingerprint(existing);
      if(normalized.idempotencyKey&&existing.idempotencyKey===normalized.idempotencyKey&&existingFingerprint===fingerprint){
        this.events.append({stream:'hub',type:'task.idempotent_replay',entityId:id,actor,data:{idempotencyKey:normalized.idempotencyKey}});
        return deepClone(existing);
      }
      throw new Error(`TASK_ID_CONFLICT: task '${id}' already exists`);
    }
    const t={schema:'jaco.continuum.hub-task.v2',id,...normalized,status:'QUEUED',assignedAgentId:null,idempotencyFingerprint:fingerprint,createdAt:nowIso(),updatedAt:nowIso(),attempts:0};this.state.tasks[id]=t;this.#save();this.events.append({stream:'hub',type:'task.created',entityId:id,actor,data:t});return deepClone(t);
  }
  claimTask(taskId,agentId,leaseId){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(t.status!=='QUEUED'&&t.status!=='RETRY')throw new Error(`task is ${t.status}`);const a=this.state.agents[agentId];if(!a)throw new Error('agent not registered');const missing=t.requirements.filter(r=>!a.capabilities.includes(r));if(missing.length)throw new Error(`agent missing capabilities: ${missing.join(', ')}`);if(a.executionMode==='SANDBOX_ONLY'&&t.consequence!=='SANDBOX_ONLY')throw new Error('AGENT_RESTRICTED_TO_SANDBOX');t.status='ACTIVE';t.assignedAgentId=agentId;t.leaseId=leaseId||t.leaseId||null;t.attempts+=1;t.updatedAt=nowIso();a.currentTaskId=taskId;a.currentMissionId=t.missionId||null;a.progressAt=nowIso();a.idleJustification=null;this.#save();this.events.append({stream:'hub',type:'task.claimed',entityId:taskId,actor:agentId,data:{leaseId}});return deepClone(t);}
  cancelTask(taskId,{actor='system',reason='canceled'}={}){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(TERMINAL_TASK_STATES.has(t.status))return deepClone(t);const prevAgent=t.assignedAgentId||null;t.status='CANCELLED';t.cancelRequestedAt=nowIso();t.cancelRequestedBy=String(actor||'system').slice(0,180);t.cancelReason=String(reason||'canceled').slice(0,1000);t.assignedAgentId=null;t.updatedAt=nowIso();if(prevAgent&&this.state.agents[prevAgent]){this.state.agents[prevAgent].currentTaskId=null;this.state.agents[prevAgent].progressAt=nowIso();}this.#save();this.events.append({stream:'hub',type:'task.cancelled',entityId:taskId,actor:t.cancelRequestedBy,data:{reason:t.cancelReason,previousAgentId:prevAgent}});return deepClone(t);}
  completeTask(taskId,{agentId,status='COMPLETED',evidenceRefs=[],result=null}={}){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(TERMINAL_TASK_STATES.has(t.status)){if(t.status===status)return deepClone(t);throw new Error(`TASK_TERMINAL:${t.status}`);}if(t.status==='UNKNOWN_OUTCOME')throw new Error('UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED');if(t.assignedAgentId&&agentId!==t.assignedAgentId)throw new Error('task agent mismatch');if(status==='COMPLETED'&&(!Array.isArray(evidenceRefs)||!evidenceRefs.length))throw new Error('task completion requires evidence');t.status=status;t.evidenceRefs=evidenceRefs;if(typeof result?.text==='string')t.result={text:result.text.slice(0,32000),truncated:result.text.length>32000,providerId:result.providerId?String(result.providerId).slice(0,120):null,model:result.model?String(result.model).slice(0,160):null};t.updatedAt=nowIso();const a=agentId?this.state.agents[agentId]:null;if(a){a.currentTaskId=null;a.progressAt=nowIso();a.status='ONLINE';}this.#save();this.events.append({stream:'hub',type:`task.${String(status).toLowerCase()}`,entityId:taskId,actor:agentId||'system',data:{evidenceRefs}});return deepClone(t);}
  failTask(taskId,{agentId,error,retry=true}={}){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(TERMINAL_TASK_STATES.has(t.status))throw new Error(`TASK_TERMINAL:${t.status}`);if(t.status==='UNKNOWN_OUTCOME'&&retry)throw new Error('UNKNOWN_OUTCOME_RECONCILIATION_REQUIRED');if(t.assignedAgentId&&agentId&&agentId!==t.assignedAgentId)throw new Error('task agent mismatch');const canRetry=retry&&t.attempts<t.maxAttempts;t.status=canRetry?'RETRY':'FAILED';t.lastError=String(error||'task failed').slice(0,2000);const prevAgent=t.assignedAgentId?t.assignedAgentId:null;t.assignedAgentId=null;t.updatedAt=nowIso();if(prevAgent&&this.state.agents[prevAgent]){this.state.agents[prevAgent].currentTaskId=null;this.state.agents[prevAgent].progressAt=nowIso();}this.#save();this.events.append({stream:'hub',type:canRetry?'task.retry':'task.failed',entityId:taskId,actor:agentId||'system',data:{error:t.lastError,attempts:t.attempts,maxAttempts:t.maxAttempts}});return deepClone(t);}
  markUnknownOutcome(taskId,{agentId,error,evidenceRefs=[]}={}){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(t.status!=='ACTIVE')throw new Error(`TASK_NOT_ACTIVE:${t.status}`);if(t.assignedAgentId&&agentId!==t.assignedAgentId)throw new Error('task agent mismatch');const refs=[...new Set((Array.isArray(evidenceRefs)?evidenceRefs:[]).map(String))];if(refs.length)this.evidence?.assertRefs(refs,{verified:false,kinds:['browser-action-receipt']});t.status='UNKNOWN_OUTCOME';t.lastError=String(error||'execution outcome unconfirmed').slice(0,2000);t.uncertainEvidenceRefs=refs;t.assignedAgentId=null;t.updatedAt=nowIso();if(agentId&&this.state.agents[agentId])this.state.agents[agentId].currentTaskId=null;this.#save();this.events.append({stream:'hub',type:'task.outcome_unknown',entityId:taskId,actor:agentId||'system',data:{error:t.lastError,evidenceRefs:refs,requiresReconciliation:true}});return deepClone(t);}
  reconcileUnknownTask(taskId,{resolution,evidenceRefs=[],actor='operator'}={}){const t=this.state.tasks[taskId];if(!t)throw new Error('task not found');if(t.status!=='UNKNOWN_OUTCOME')throw new Error(`TASK_NOT_UNKNOWN:${t.status}`);if(!this.evidence)throw new Error('EVIDENCE_LEDGER_REQUIRED');const refs=[...new Set((Array.isArray(evidenceRefs)?evidenceRefs:[]).map(String))];this.evidence.assertRefs(refs,{verified:true});if(resolution==='COMPLETED'){const expected=Array.isArray(t.payload?.actions)?t.payload.actions.length:0;const captured=t.uncertainEvidenceRefs||[];if(t.kind!=='BROWSER_BATCH'||expected===0||refs.length!==expected||captured.length!==expected||refs.some(id=>!captured.includes(id)))throw new Error('COMPLETE_REQUIRES_ALL_CAPTURED_ACTION_RECEIPTS');this.evidence.assertRefs(refs,{verified:true,kinds:['browser-action-receipt']});t.status='COMPLETED';t.evidenceRefs=refs;}else if(resolution==='ABORTED'){t.status='FAILED';t.evidenceRefs=refs;}else throw new Error('INVALID_UNKNOWN_OUTCOME_RESOLUTION');t.reconciledAt=nowIso();t.reconciledBy=String(actor).slice(0,180);t.updatedAt=nowIso();this.#save();this.events.append({stream:'hub',type:'task.outcome_reconciled',entityId:taskId,actor:t.reconciledBy,data:{resolution,evidenceRefs:refs}});return deepClone(t);}
  recoverStaleTasks({staleAfterMs=120000,recoverAllActive=false}={}){const cutoff=Date.now()-Math.max(10000,Number(staleAfterMs)||120000);const recovered=[];for(const t of Object.values(this.state.tasks)){if(t.status==='ACTIVE'&&(recoverAllActive||Date.parse(t.updatedAt||t.createdAt)<cutoff)){const previousAgentId=t.assignedAgentId;t.status='UNKNOWN_OUTCOME';t.lastError='STALE_TASK_OUTCOME_UNCONFIRMED_AFTER_RUNTIME_RESTART';t.assignedAgentId=null;t.updatedAt=nowIso();if(previousAgentId&&this.state.agents[previousAgentId])this.state.agents[previousAgentId].currentTaskId=null;recovered.push(t.id);}}if(recovered.length){this.#save();this.events.append({stream:'hub',type:'task.recovery_sweep',actor:'runtime',data:{recovered,status:'UNKNOWN_OUTCOME',requiresReconciliation:true}});}return recovered;}

  eligibleAgents(task,{excludeAgentIds=[]}={}){const excluded=new Set(excludeAgentIds.map(String));const now=Date.now();return Object.values(this.state.agents).filter(a=>!excluded.has(a.id)).filter(a=>now-Date.parse(a.lastHeartbeatAt)<120000).filter(a=>!['OFFLINE','BLOCKED'].includes(a.status)).filter(a=>a.executionMode!=='SANDBOX_ONLY'||task.consequence==='SANDBOX_ONLY').filter(a=>(task.requirements||[]).every(r=>(a.capabilities||[]).includes(r))).map(deepClone);}
  selectAgentForTask(task,{scoreFn=null,excludeAgentIds=[]}={}){const eligible=this.eligibleAgents(task,{excludeAgentIds});if(!eligible.length)return null;const active=this.listTasks({status:'ACTIVE'});return eligible.map(a=>{const load=active.filter(t=>t.assignedAgentId===a.id).length;const reputation=scoreFn?Number(scoreFn(a.id)?.score??0.5):0.5;const roleBonus=(task.preferredRoles||[]).includes(a.role)?0.15:0;const score=reputation+roleBonus-Math.min(0.4,load*0.2);return {agent:a,score:Number(score.toFixed(4)),load,reputation};}).sort((x,y)=>y.score-x.score||x.load-y.load)[0];}
  nextRunnableTask(capabilities=[]){const now=Date.now();const caps=new Set(capabilities);return Object.values(this.state.tasks).filter(t=>['QUEUED','RETRY'].includes(t.status)).filter(t=>!t.notBefore||Date.parse(t.notBefore)<=now).filter(t=>(t.requirements||[]).every(r=>caps.has(r))).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))[0]||null;}
  listTasks({missionId=null,status=null}={}){return Object.values(this.state.tasks).filter(t=>!missionId||t.missionId===missionId).filter(t=>!status||t.status===status).map(deepClone);}
  #save(){if(this.saveTimer){clearTimeout(this.saveTimer);this.saveTimer=null;}this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
  // Liveness-only changes (heartbeats) are coalesced; any real state change still saves immediately via #save.
  #saveSoon(){if(this.saveTimer)return;this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.#save();},HEARTBEAT_SAVE_MS);this.saveTimer.unref?.();}
  flush(){if(this.saveTimer)this.#save();}
}
