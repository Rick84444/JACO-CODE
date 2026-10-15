import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TaskState } from '@a2a-js/sdk';
import { A2A_TERMINAL, HUB_TERMINAL, receiptArtifact, resultArtifact, statusFor } from './a2a-continuum-state.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const releaseRoot=path.resolve(here,'..','..');
const MAX_TASKS=5000;

function principalFromContext(context){const user=context?.user;const principal=String(user?.isAuthenticated?user.userName:'').trim();if(!principal)throw new Error('A2A_PRINCIPAL_REQUIRED');return principal.slice(0,240);}
function clone(value){return value===undefined?undefined:structuredClone(value);}
function ensureDir(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});return dir;}
function atomicWrite(file,value){ensureDir(path.dirname(file));const tmp=`${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,{encoding:'utf8',mode:0o600});fs.renameSync(tmp,file);}
function readState(file){try{const parsed=JSON.parse(fs.readFileSync(file,'utf8'));if(parsed&&typeof parsed==='object'&&parsed.tasks&&typeof parsed.tasks==='object')return parsed;}catch{}return {schema:'jaco.a2a.task-store.v1',tasks:{},updatedAt:new Date().toISOString()};}
function pageOffset(token){if(!token)return 0;try{const p=JSON.parse(Buffer.from(String(token),'base64url').toString('utf8'));return Number.isInteger(p?.offset)&&p.offset>=0?p.offset:0;}catch{return 0;}}
function nextToken(offset,total){return offset<total?Buffer.from(JSON.stringify({offset})).toString('base64url'):'';}
function statusMatches(task,status){const n=Number(status);return !Number.isFinite(n)||n===0||Number(task?.status?.state)===n;}
function timestampMatches(task,after){if(!after)return true;const cutoff=Date.parse(String(after)),current=Date.parse(String(task?.status?.timestamp||''));return Number.isFinite(cutoff)&&Number.isFinite(current)?current>cutoff:true;}
function shaped(task,{historyLength,includeArtifacts}={}){const out=clone(task);if(includeArtifacts===false)out.artifacts=[];if(Number.isInteger(historyLength)&&historyLength>=0&&Array.isArray(out.history))out.history=historyLength===0?[]:out.history.slice(-historyLength);return out;}

// Durable, principal-scoped A2A task store. The Continuum Runtime Hub stays the source of truth for execution:
// reads reconcile non-terminal tasks against the hub, and CANCELED is only persisted after the hub confirms it.
export class DurablePrincipalTaskStore {
  constructor({port=2998,stateDir=process.env.JACO_A2A_STATE_DIR,core=null}={}){const dir=stateDir?path.resolve(stateDir):path.join(releaseRoot,'.jaco','a2a',`port-${port}`);this.file=path.join(dir,'tasks.json');this.state=readState(this.file);this.core=core;}
  async save(task,context){
    if(!task?.id)throw new Error('A2A_TASK_ID_REQUIRED');
    const principal=principalFromContext(context),id=String(task.id),existing=this.state.tasks[id];
    if(existing&&existing.principalId!==principal)throw new Error('A2A_TASK_FORBIDDEN');
    const hubTaskId=String(task.metadata?.hubTaskId||existing?.hubTaskId||'')||null;
    // The SDK marks a task CANCELED by itself when no execution is attached (for example after a restart).
    // Refuse that unless the hub has actually cancelled the underlying work.
    if(task.status?.state===TaskState.TASK_STATE_CANCELED&&existing?.task?.status?.state!==TaskState.TASK_STATE_CANCELED&&hubTaskId&&this.core){
      const hub=await this.core.cancelTask(hubTaskId,{actor:`a2a:${principal}`,reason:'A2A CancelTask'});
      if(!['CANCELLED','CANCELED'].includes(String(hub?.status)))throw new Error(`A2A_CANCEL_NOT_CONFIRMED:${hub?.status||'unknown'}`);
    }
    const messageIds=[...new Set([...(existing?.messageIds||[]),...(Array.isArray(task.history)?task.history.map(m=>m?.messageId).filter(Boolean):[])].map(String))].slice(-200);
    this.state.tasks[id]={principalId:principal,hubTaskId,task:clone(task),messageIds,createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
    this.#trim();this.#persist();
  }
  async load(taskId,context){const principal=principalFromContext(context),record=this.state.tasks[String(taskId)];if(!record||record.principalId!==principal)return undefined;await this.#reconcile(record);return clone(record.task);}
  async list(params={},context){const principal=principalFromContext(context),pageSize=Math.max(1,Math.min(Number(params.pageSize)||50,100)),offset=pageOffset(params.pageToken);let records=Object.values(this.state.tasks).filter(r=>r.principalId===principal);for(const r of records)await this.#reconcile(r);records=records.filter(r=>!params.contextId||r.task?.contextId===params.contextId).filter(r=>statusMatches(r.task,params.status)).filter(r=>timestampMatches(r.task,params.statusTimestampAfter));records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));const totalSize=records.length,page=records.slice(offset,offset+pageSize),next=offset+page.length;return {tasks:page.map(r=>shaped(r.task,params)),nextPageToken:nextToken(next,totalSize),pageSize:page.length,totalSize};}
  async findByMessage(messageId,context){const principal=principalFromContext(context),mid=String(messageId||'').trim();if(!mid)return undefined;const record=Object.values(this.state.tasks).find(r=>r.principalId===principal&&Array.isArray(r.messageIds)&&r.messageIds.includes(mid));return record?clone(record.task):undefined;}
  async hubTaskIdOf(taskId){return this.state.tasks[String(taskId)]?.hubTaskId||null;}
  async ownerOf(taskId){return this.state.tasks[String(taskId)]?.principalId||null;}
  // The A2A record can lag the hub (process restart, lost poll loop). Pull the hub state into the A2A task.
  async #reconcile(record){
    const task=record.task;if(!this.core||!record.hubTaskId||A2A_TERMINAL.has(task?.status?.state))return;
    let hub;try{hub=await this.core.getTask(record.hubTaskId);}catch{return;}
    const status=statusFor(hub,task.id,task.contextId);if(status.state===task.status?.state)return;
    task.status=status;
    if(String(hub.status)==='COMPLETED'){const answer=resultArtifact(hub);if(answer&&!(task.artifacts||[]).some(a=>a.artifactId===answer.artifactId))task.artifacts=[...(task.artifacts||[]),answer];if(!(task.artifacts||[]).some(a=>a.artifactId===`continuum-receipt-${hub.id}`))task.artifacts=[...(task.artifacts||[]),receiptArtifact(hub)];}
    if(HUB_TERMINAL.has(String(hub.status)))task.metadata={...(task.metadata||{}),reconciledFromHub:true};
    record.updatedAt=new Date().toISOString();this.#persist();
  }
  #trim(){const records=Object.entries(this.state.tasks).sort((a,b)=>String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)));for(const [id] of records.slice(MAX_TASKS))delete this.state.tasks[id];}
  #persist(){this.state.updatedAt=new Date().toISOString();atomicWrite(this.file,this.state);}
}

export { principalFromContext };
