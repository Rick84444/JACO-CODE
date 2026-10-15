import crypto from 'node:crypto';
import { Role, TaskState } from '@a2a-js/sdk';

// Mapping between Continuum Runtime Hub task state and A2A v1 task state.
// Shared by the executor (live polling) and the task store (reconciliation on read).

export const HUB_TERMINAL=new Set(['COMPLETED','FAILED','CANCELLED','CANCELED','REJECTED']);
export const A2A_TERMINAL=new Set([TaskState.TASK_STATE_COMPLETED,TaskState.TASK_STATE_FAILED,TaskState.TASK_STATE_CANCELED,TaskState.TASK_STATE_REJECTED]);

export function taskState(status){switch(String(status||'')){case 'COMPLETED':return TaskState.TASK_STATE_COMPLETED;case 'FAILED':return TaskState.TASK_STATE_FAILED;case 'CANCELLED':case 'CANCELED':return TaskState.TASK_STATE_CANCELED;case 'REJECTED':return TaskState.TASK_STATE_REJECTED;case 'ACTIVE':return TaskState.TASK_STATE_WORKING;default:return TaskState.TASK_STATE_SUBMITTED;}}

export function agentMessage(taskId,contextId,text){return {role:Role.ROLE_AGENT,messageId:crypto.randomUUID(),taskId,contextId,parts:[{content:{$case:'text',value:String(text)},metadata:undefined,filename:'',mediaType:'text/plain'}],metadata:{},extensions:[],referenceTaskIds:[]};}

// A completed hub task becomes a receipt artifact: references to evidence, never a restated claim of success.
export function receiptArtifact(hub){const evidenceRefs=Array.isArray(hub?.evidenceRefs)?hub.evidenceRefs.map(String):[];return {artifactId:`continuum-receipt-${hub.id}`,name:'JACO Continuum execution receipt',description:'Durable execution result references produced by the JACO Continuum runtime.',parts:[{content:{$case:'data',value:{hubTaskId:hub.id,evidenceRefs,status:'COMPLETED'}},metadata:{verified:evidenceRefs.length>0},filename:'receipt.json',mediaType:'application/json'}],metadata:{evidenceBacked:evidenceRefs.length>0},extensions:[]};}

// The model's answer for the requesting peer, when the runtime recorded one; the receipt alone carries only evidence ids.
export function resultArtifact(hub){const text=hub?.result?.text;if(typeof text!=='string'||!text)return null;return {artifactId:`continuum-result-${hub.id}`,name:'JACO Continuum result',description:'Answer produced by the JACO Continuum runtime for this task.',parts:[{content:{$case:'text',value:text},metadata:{providerId:hub.result.providerId||null,model:hub.result.model||null,truncated:Boolean(hub.result.truncated)},filename:'',mediaType:'text/plain'}],metadata:{evidenceRefs:(hub.evidenceRefs||[]).map(String)},extensions:[]};}

export function statusFor(hub,taskId,contextId){
  const state=taskState(hub?.status),timestamp=new Date().toISOString();
  if(state===TaskState.TASK_STATE_COMPLETED)return {state,timestamp,message:agentMessage(taskId,contextId,`Continuum completed with ${(hub.evidenceRefs||[]).length} evidence reference(s).`)};
  if(state===TaskState.TASK_STATE_FAILED)return {state,timestamp,message:agentMessage(taskId,contextId,hub.lastError||'Continuum execution failed.')};
  if(state===TaskState.TASK_STATE_CANCELED)return {state,timestamp,message:agentMessage(taskId,contextId,'Canceled in the Continuum Runtime Hub. Work already started by an agent is not reported as completed.')};
  return {state,timestamp,message:undefined};
}

// Deterministic hub id: a retry of the same message by the same principal can only ever address one execution.
export function hubTaskIdFor(principal,messageId){return `a2a_${crypto.createHash('sha256').update(JSON.stringify([principal,messageId])).digest('hex').slice(0,40)}`;}

// Wire-shaped message for the hub payload: stable across retries and readable by the Continuum scheduler (parts[].text).
// contextId is left out: the SDK fills a fresh one when the client omits it, which would break retry fingerprints.
export function wireMessage(message){return {messageId:String(message?.messageId||''),role:'ROLE_USER',parts:(message?.parts||[]).map(p=>{const c=p?.content;if(c?.$case==='text')return {text:String(c.value||'')};if(c?.$case==='data')return {data:c.value??null};if(c?.$case==='url')return {url:String(c.value||''),mediaType:p.mediaType||undefined};return {unsupported:String(c?.$case||'part')};})};}
