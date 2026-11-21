// Private, locally enabled ChatGPT mission bridge. Aura remains the only executor.
import * as z from 'zod/v4';
const ID=/^[a-zA-Z0-9_.:-]{1,160}$/;
const safeId=value=>typeof value==='string'&&ID.test(value)?value:null;
const STATES=new Set(['ACTIVE','PENDING','QUEUED','READY','PLANNING','EXECUTING','BLOCKED','DONE','CANCELLED','FAILED','AWAITING_VERIFICATION','RECONCILIATION_REQUIRED','INTERRUPTED','CLOSED']);
const state=value=>STATES.has(value)?value:'UNVERIFIED';
const noSecrets=value=>!(/\bBearer\s+[^\s,;]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[\w-]{24,}|(?:api.?key|password|token)\s*[:=]\s*\S+/i.test(value));
const noArgs=z.object({}).strict();
const missionId=z.string().regex(ID);
const goalSchema=z.object({goal:z.string().trim().min(1).max(8000)}).strict();
const androidBonsaiSchema=z.object({
  instruction:z.string().trim().min(4).max(2000),
  packageName:z.string().regex(/^[A-Za-z0-9_.]{3,200}$/),
  mandateId:z.string().regex(ID),
  missionId:z.string().regex(ID).optional(),
  maxSteps:z.number().int().min(1).max(20).optional(),
}).strict();
const steerSchema=z.object({missionId,instruction:z.string().trim().min(1).max(2000),requestId:z.string().regex(/^[0-9a-f]{8}-[0-9a-f-]{27,50}$/i)}).strict();
export function assertPrivateAuraBridge(core,env=process.env){
  if(env.JACO_MCP_ALLOW_AURA_MISSIONS!=='1')throw Error('JACO_PRIVATE_AURA_BRIDGE_DISABLED');
  const u=new URL(String(core?.baseUrl||''));
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('JACO_PRIVATE_AURA_LOOPBACK_REQUIRED');
  if(typeof core?.token!=='string'||core.token.length<24||typeof core.request!=='function')throw Error('JACO_PRIVATE_AURA_AUTH_REQUIRED');
}
function receiptView(m){
  if(!m)return null;
  const id=safeId(m.id);if(!id)throw Error('JACO_PRIVATE_AURA_MISSION_INVALID');
  const receipts=Array.isArray(m.receipts)?m.receipts:[];
  return {id,status:state(m.status),phase:state(m.phase),paused:Boolean(m.paused),pendingOperatorAction:Boolean(m.pendingOperatorAction),spendApprovalPending:Boolean(m.spendApprovalPending),hasUncertainOutcome:Boolean(m.hasUncertainOutcome),receiptCount:receipts.length,
    verifiedReceiptCount:receipts.filter(r=>r?.ok===true&&r?.verified===true).length,
    recentReceipts:receipts.slice(-20).map(r=>({step:Number.isSafeInteger(r?.n)?r.n:null,type:safeId(r?.type),ok:r?.ok===true,verified:r?.verified===true,outcomeUnknown:r?.outcomeUnknown===true}))};
}
export function privateAuraTools({core,env=process.env}){
  const call=async(path,options={})=>{
    assertPrivateAuraBridge(core,env);
    // Authenticate every call against the existing operator readiness endpoint.
    const ready=await core.request('/api/aura/workbench/readiness',{method:'GET',redirect:'error'});
    if(ready?.success!==true||ready?.schema!=='jaco.aura-readiness/v1'||ready.core?.authenticated!==true)throw Error('JACO_PRIVATE_AURA_AUTH_UNVERIFIED');
    if(path==='/api/aura/workbench/start-goal'&&ready.ready!==true)throw Error('JACO_PRIVATE_AURA_NOT_READY');
    return core.request(path,{...options,redirect:'error'});
  };
  const tool=(name,title,description,inputSchema,handler,readOnlyHint=false)=>({name,config:{title,description,inputSchema,annotations:{readOnlyHint,destructiveHint:false,idempotentHint:readOnlyHint,openWorldHint:!readOnlyHint}},handler});
  return [
    tool('jaco_aura_submit_goal','Send goal to Aura','Submit a goal explicitly requested by the operator to the canonical local Aura planner. Never send credentials, new authority, direct commands or approval decisions. Accepted is not completed. On unknown result inspect current work before retrying.',goalSchema,async args=>{
      const {goal}=goalSchema.parse(args);
      if(!noSecrets(goal))throw Error('JACO_PRIVATE_AURA_SECRET_REFUSED');
      const r=await call('/api/aura/workbench/start-goal',{method:'POST',body:JSON.stringify({goal,horizon:'short'})});
      const missionId=r?.lite===true?safeId(r?.mission?.id):null;
      const goalId=r?.schema==='jaco.operator-goal/v1'?safeId(r?.goal?.id):null;
      if(r?.success!==true||(!missionId&&!goalId))throw Error('JACO_PRIVATE_AURA_ADMISSION_UNVERIFIED');
      return {status:'ACCEPTED',goalId,missionId,execution:'NOT_VERIFIED',authority:'existing-Aura-policy'};
    }),
    tool('jaco_aura_current_mission','Observe Aura current mission','Read the currently active durable mission and bounded receipt status. No raw tool output, files or secret values.',noArgs,async args=>{
      noArgs.parse(args);
      const r=await call('/api/connected/nova/current',{method:'GET'});
      if(r?.success!==true||!Object.hasOwn(r,'mission'))throw Error('JACO_PRIVATE_AURA_STATUS_UNAVAILABLE');
      return {mission:receiptView(r.mission)};
    },true),
    tool('jaco_aura_mission_status','Observe Aura mission','Read bounded durable mission status and verified receipt counts by mission ID.',z.object({missionId}).strict(),async args=>{
      const id=missionId.parse(args?.missionId);
      const r=await call('/api/connected/nova/missions/'+encodeURIComponent(id),{method:'GET'});
      if(r?.success!==true||r.mission?.id!==id)throw Error('JACO_PRIVATE_AURA_STATUS_UNAVAILABLE');
      return {mission:receiptView(r.mission)};
    },true),
    tool('jaco_aura_android_bonsai','Control approved Android app via Bonsai','Run one bounded, operator-requested on-device Android task: ChatGPT private MCP -> authenticated Aura/Core relay -> local Bonsai 4B -> native Android Accessibility. Requires a signed mandate allowing the selected Android package and a local Android Native Engine. No direct system access, public Git relay, payment, login, arbitrary shell or permissions. A model completion is not proof unless the observed UI satisfies its postcondition.',androidBonsaiSchema,async args=>{
      const a=androidBonsaiSchema.parse(args);
      if(!noSecrets(a.instruction))throw Error('JACO_PRIVATE_AURA_SECRET_REFUSED');
      const r=await call('/api/relay/android-bonsai',{method:'POST',body:JSON.stringify(a),signal:AbortSignal.timeout(90_000*(a.maxSteps||8))});
      if(!r?.task || r.task.schema!=='jaco.bonsai-android-task/v1')throw Error('JACO_ANDROID_BONSAI_RECEIPT_UNAVAILABLE');
      // Return bounded evidence only, never screen content, user text or raw tool calls.
      return {taskId:r.task.taskId,missionId:r.task.missionId,
        status:r.task.status,verifiedSteps:r.task.verifiedSteps,attemptedSteps:r.task.attemptedSteps,
        actionReceipts:(r.task.receipts||[]).slice(0,20).map(x=>({id:x.action_id,type:x.action_type,verified:x.verified===true,success:x.success===true})),
        observedTextPostcondition:r.success===true};
    }),
    tool('jaco_aura_steer_mission','Adjust Aura mission','Queue an operator-requested change of strategy in an existing mission. Existing authority, scope and running action are unchanged.',steerSchema,async args=>{
      const a=steerSchema.parse(args);
      if(!noSecrets(a.instruction))throw Error('JACO_PRIVATE_AURA_SECRET_REFUSED');
      const r=await call('/api/aura/workbench/missions/'+encodeURIComponent(a.missionId)+'/steer',{method:'POST',body:JSON.stringify({instruction:a.instruction,requestId:a.requestId})});
      if(r?.success!==true||r.missionId!==a.missionId||r.queuedForNextPlanningBoundary!==true)throw Error('JACO_PRIVATE_AURA_STEER_UNVERIFIED');
      return {missionId:a.missionId,queued:true,executionInterrupted:false,revision:Number.isSafeInteger(r.steering?.revision)?r.steering.revision:null};
    }),
  ];
}
