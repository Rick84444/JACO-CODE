import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HandsOffAction, HandsOffClient, HandsOffReceipt, HandsOffSelector } from './handsOffClient.js';
import { IntuitionContractStore } from '../autonomy/intuitionContractStore.js';

export type HandsOffPlanStep =
  | { kind:'action'; action:HandsOffAction; require_verified?:boolean }
  | { kind:'wait_for'; selector:HandsOffSelector; timeout_ms?:number; poll_interval_ms?:number }
  | { kind:'delay'; ms:number };
export type HandsOffPlanStatus='queued'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted';
export interface HandsOffPlanResult { index:number;kind:HandsOffPlanStep['kind'];started_at:string;finished_at:string;success:boolean;receipt?:HandsOffReceipt;error?:string; }
export interface HandsOffPlan { plan_id:string;contract_id:string;label:string|null;created_at:string;updated_at:string;status:HandsOffPlanStatus;cursor:number;step_count:number;results:HandsOffPlanResult[];error?:string;resume_requires_operator?:boolean; }
interface StoredPlan extends HandsOffPlan { steps:HandsOffPlanStep[]; }

type ObservedNode={class_name?:string;view_id?:string;text?:string;content_description?:string;editable?:boolean;children?:ObservedNode[]};
const MAX_STEPS=50; const SECRET_TEXT=/(password|passcode|one.?time|otp|verification code|api.?key|secret|private.?key|seed phrase)/i;
const NON_IDEMPOTENT=new Set(['tap','type_text','run_intent']);
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function validId(id:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);}
function publicPlan(plan:StoredPlan):HandsOffPlan{const {steps:_steps,...visible}=plan;return visible;}
function find(root:ObservedNode|undefined,selector:HandsOffSelector):boolean{
  if(!root)return false;const queue=[root];while(queue.length){const node=queue.shift()!;const match=(!selector.view_id||node.view_id===selector.view_id)&&(!selector.text||(node.text||'').toLowerCase().includes(selector.text.toLowerCase()))&&(!selector.content_description||(node.content_description||'').toLowerCase().includes(selector.content_description.toLowerCase()))&&(!selector.class_name||node.class_name===selector.class_name)&&(selector.editable===undefined||node.editable===selector.editable);if(match)return true;queue.push(...(node.children||[]));}return false;
}
function validate(steps:HandsOffPlanStep[]){
  if(!Array.isArray(steps)||!steps.length)throw new Error('plan requires at least one step');if(steps.length>MAX_STEPS)throw new Error(`plan exceeds ${MAX_STEPS} step limit`);
  for(const [index,step] of steps.entries()){
    if(!step||typeof step!=='object')throw new Error(`step ${index} is invalid`);
    if(step.kind==='delay'){if(!Number.isFinite(step.ms)||step.ms<100||step.ms>10_000)throw new Error(`step ${index}: delay must be 100-10000ms`);continue;}
    if(step.kind==='wait_for'){const s=step.selector;if(!s||![s.view_id,s.text,s.content_description,s.class_name,s.editable].some(v=>v!==undefined))throw new Error(`step ${index}: wait_for requires a semantic selector`);const timeout=step.timeout_ms??15_000;if(timeout<500||timeout>60_000)throw new Error(`step ${index}: timeout must be 500-60000ms`);continue;}
    if(step.kind!=='action'||!step.action)throw new Error(`step ${index}: unsupported step kind`);
    const action=step.action; if(!['observe_screen','open_app','run_intent','tap','type_text','scroll','back','home'].includes(action.type))throw new Error(`step ${index}: unsupported action type`);
    if(action.type==='open_app'&&!action.package_name)throw new Error(`step ${index}: open_app requires package_name`);
    if(action.type==='type_text'){if(!action.text||action.text.length>2_000)throw new Error(`step ${index}: type_text requires 1-2000 characters`);if(SECRET_TEXT.test(action.text)||SECRET_TEXT.test(action.selector?.text||'')||SECRET_TEXT.test(action.selector?.content_description||''))throw new Error(`step ${index}: secrets and authentication codes require direct human entry`);}
    if(action.type==='tap'&&!action.selector&&!(Number.isFinite(action.x)&&Number.isFinite(action.y)))throw new Error(`step ${index}: tap requires a selector or coordinates`);
  }
}

export function createHandsOffPlanRunner(client:HandsOffClient,workspaceRoot:string){
  const directory=path.join(workspaceRoot,'.jaco','state','hands-off','plans');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const contracts=new IntuitionContractStore(workspaceRoot);const live=new Map<string,StoredPlan>();const cancelled=new Set<string>();let serial=Promise.resolve();
  const file=(id:string)=>{if(!validId(id))throw new Error('invalid plan id');return path.join(directory,`${id}.json`);};
  const persist=(plan:StoredPlan)=>{plan.updated_at=new Date().toISOString();live.set(plan.plan_id,plan);const target=file(plan.plan_id);const temp=`${target}.${process.pid}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(plan,null,2),{encoding:'utf8',mode:0o600});fs.renameSync(temp,target);};
  const load=(id:string):StoredPlan|null=>{if(live.has(id))return live.get(id)!;try{const plan=JSON.parse(fs.readFileSync(file(id),'utf8')) as StoredPlan;live.set(id,plan);return plan;}catch{return null;}};
  const assertContract=(id:string)=>{if(!contracts.isActive(id))throw new Error('an active signed Intuition Contract is required');};
  const waitFor=async(plan:StoredPlan,step:Extract<HandsOffPlanStep,{kind:'wait_for'}>)=>{const timeout=step.timeout_ms??15_000;const poll=Math.max(250,Math.min(step.poll_interval_ms??500,5_000));const deadline=Date.now()+timeout;while(Date.now()<deadline){if(cancelled.has(plan.plan_id))return {success:false,error:'cancelled'};try{const observed=await client.observe() as {root?:ObservedNode};if(find(observed.root,step.selector))return {success:true};}catch{}await sleep(poll);}return {success:false,error:`selector not found within ${timeout}ms`};};
  const execute=async(plan:StoredPlan)=>{
    assertContract(plan.contract_id);plan.status='running';plan.error=undefined;plan.resume_requires_operator=false;persist(plan);
    for(let index=plan.cursor;index<plan.steps.length;index+=1){
      if(cancelled.has(plan.plan_id)){plan.status='cancelled';persist(plan);cancelled.delete(plan.plan_id);return;}
      const step=plan.steps[index];const started_at=new Date().toISOString();let result:HandsOffPlanResult;
      try{
        if(step.kind==='delay'){let remaining=step.ms;while(remaining>0&&!cancelled.has(plan.plan_id)){const chunk=Math.min(remaining,250);await sleep(chunk);remaining-=chunk;}result={index,kind:'delay',started_at,finished_at:new Date().toISOString(),success:!cancelled.has(plan.plan_id),error:cancelled.has(plan.plan_id)?'cancelled':undefined};}
        else if(step.kind==='wait_for'){const outcome=await waitFor(plan,step);result={index,kind:'wait_for',started_at,finished_at:new Date().toISOString(),success:outcome.success,error:outcome.error};}
        else{const receipt=await client.executeVerified({...step.action,action_id:crypto.randomUUID()});const success=receipt.success&&(step.require_verified===false||receipt.verified);result={index,kind:'action',started_at,finished_at:new Date().toISOString(),success,receipt,error:success?undefined:(receipt.error||'action did not produce a verified state transition')};}
      }catch(error){result={index,kind:step.kind,started_at,finished_at:new Date().toISOString(),success:false,error:error instanceof Error?error.message:String(error)};}
      plan.results.push(result);plan.cursor=index+1;persist(plan);if(!result.success){plan.status=cancelled.has(plan.plan_id)?'cancelled':'failed';plan.error=result.error||`step ${index} failed`;persist(plan);cancelled.delete(plan.plan_id);return;}
    }
    plan.status='succeeded';persist(plan);
  };
  const enqueueExecution=(plan:StoredPlan)=>{serial=serial.then(()=>execute(plan)).catch(error=>{plan.status='failed';plan.error=error instanceof Error?error.message:String(error);persist(plan);});};

  for(const name of fs.readdirSync(directory).filter(name=>name.endsWith('.json'))){try{const plan=JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')) as StoredPlan;if(plan.status==='running'||plan.status==='queued'){plan.status='interrupted';const next=plan.steps[plan.cursor];plan.resume_requires_operator=next?.kind==='action'&&NON_IDEMPOTENT.has(next.action.type);plan.error='runtime stopped before plan completion';persist(plan);}}catch{}}

  return {
    submit(steps:HandsOffPlanStep[],options:{contractId:string;label?:string}){assertContract(options.contractId);validate(steps);const now=new Date().toISOString();const plan:StoredPlan={plan_id:crypto.randomUUID(),contract_id:options.contractId,label:options.label?.trim().slice(0,500)||null,created_at:now,updated_at:now,status:'queued',cursor:0,step_count:steps.length,results:[],steps};persist(plan);enqueueExecution(plan);return publicPlan(plan);},
    get(id:string){const plan=load(id);return plan?publicPlan(plan):null;},
    list(limit=20){return fs.readdirSync(directory).filter(name=>name.endsWith('.json')).map(name=>({name,mtime:fs.statSync(path.join(directory,name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime).slice(0,Math.max(1,Math.min(limit,100))).map(entry=>publicPlan(JSON.parse(fs.readFileSync(path.join(directory,entry.name),'utf8'))));},
    cancel(id:string){const plan=load(id);if(!plan||!['queued','running'].includes(plan.status))return false;cancelled.add(id);if(plan.status==='queued'){plan.status='cancelled';persist(plan);}return true;},
    resume(id:string,operatorConfirmed=false){const plan=load(id);if(!plan||plan.status!=='interrupted')throw new Error('only interrupted plans can resume');assertContract(plan.contract_id);if(plan.resume_requires_operator&&!operatorConfirmed)throw new Error('OPERATOR_CONFIRMATION_REQUIRED: interrupted non-idempotent Android action may have partially executed');plan.status='queued';plan.error=undefined;persist(plan);enqueueExecution(plan);return publicPlan(plan);},
  };
}
