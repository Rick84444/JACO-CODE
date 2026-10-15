import { AgentEvent } from '@a2a-js/sdk/server';
import { principalFromContext } from './a2a-task-store.mjs';
import { HUB_TERMINAL, hubTaskIdFor, receiptArtifact, resultArtifact, statusFor, taskState, wireMessage } from './a2a-continuum-state.mjs';

const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

function messageText(message){return (message?.parts||[]).map(p=>p.text??(p.data!==undefined?JSON.stringify(p.data):p.url||'')).filter(Boolean).join('\n').slice(0,20000);}
function requirementFor(metadata={}){const skill=String(metadata?.skillId||'jaco_continuum_task');if(skill==='jaco_review_request')return {requirement:'REVIEW',roles:['verifier','seer','forge']};if(skill==='jaco_forecast_request')return {requirement:'FORECAST',roles:['seer','verifier']};return {requirement:'A2A_INBOUND',roles:['seer','forge']};}
function taskSnapshot({id,contextId,userMessage,hub}){return {id,contextId,status:{state:taskState(hub?.status),timestamp:new Date().toISOString(),message:undefined},artifacts:[],history:[userMessage],metadata:{jacoRuntime:'continuum',hubTaskId:hub.id}};}

// Bridges A2A tasks to Continuum Runtime Hub execution. The hub decides what happens; this class only reports it.
export class ContinuumAgentExecutor {
  constructor({core,taskStore,pollMs=Number(process.env.JACO_A2A_POLL_MS||1000)}={}){this.core=core;this.taskStore=taskStore;this.pollMs=Math.max(50,Number(pollMs)||1000);this.cancelled=new Set();}

  cancelTask=async(taskId,_eventBus)=>{
    const hubTaskId=await this.taskStore.hubTaskIdOf(taskId);if(!hubTaskId)throw new Error('A2A_TASK_NOT_BOUND_TO_HUB');
    const hub=await this.core.cancelTask(hubTaskId,{actor:'a2a-cancel'});
    if(!['CANCELLED','CANCELED'].includes(String(hub?.status)))throw new Error(`A2A_CANCEL_NOT_CONFIRMED:${hub?.status||'unknown'}`);
    this.cancelled.add(String(taskId));
  };

  async execute(ctx,eventBus){
    const principal=principalFromContext(ctx.context),userMessage=ctx.userMessage,messageId=String(userMessage.messageId||'');
    try{
      if(!ctx.task){const prior=await this.taskStore.findByMessage(messageId,ctx.context);if(prior){eventBus.publish(AgentEvent.task(prior));return;}}
      const requestMetadata=ctx.request?.metadata&&typeof ctx.request.metadata==='object'?ctx.request.metadata:{};
      let hub;
      if(ctx.task){hub=await this.core.getTask(await this.taskStore.hubTaskIdOf(ctx.taskId));}else{
        const routing=requirementFor(requestMetadata),message=wireMessage(userMessage);
        // Only request content goes into the hub payload, so a retry produces the same fingerprint and replays
        // the same hub task instead of creating a second execution. A2A ids live in the task store mapping.
        hub=await this.core.createTask({id:hubTaskIdFor(principal,messageId),title:`A2A inbound: ${messageText(message).slice(0,160)||messageId}`,kind:'A2A_INBOUND',payload:{message,metadata:requestMetadata,external:true,principalId:principal},requirements:[routing.requirement],preferredRoles:routing.roles,consequence:'REVERSIBLE',maxAttempts:2,idempotencyKey:`a2a:${principal}:${messageId}`});
        const peerId=await this.core.registerPeer(principal);
        await this.core.recordInbound({peerId,taskId:hub.id,contextId:ctx.contextId,message,metadata:requestMetadata});
        // A demand signal is advisory input to the revenue engine; failing to record it must not fail the task.
        if(requestMetadata.demandSignal)await this.core.recordDemandSignal({peerId,principal,signal:requestMetadata.demandSignal,fallbackNeed:messageText(message)}).catch(()=>{});
      }
      const taskId=ctx.taskId,contextId=ctx.contextId;
      const initial=ctx.task||taskSnapshot({id:taskId,contextId,userMessage,hub});eventBus.publish(AgentEvent.task(initial));
      let lastState=initial.status?.state;
      for(;;){
        if(this.cancelled.has(taskId)){eventBus.publish(AgentEvent.statusUpdate({taskId,contextId,status:statusFor({status:'CANCELLED'},taskId,contextId),metadata:{}}));return;}
        hub=await this.core.getTask(hub.id);const next=taskState(hub.status);
        if(String(hub.status)==='COMPLETED'){
          const answer=resultArtifact(hub);if(answer)eventBus.publish(AgentEvent.artifactUpdate({taskId,contextId,artifact:answer,append:false,lastChunk:true,metadata:{}}));
          eventBus.publish(AgentEvent.artifactUpdate({taskId,contextId,artifact:receiptArtifact(hub),append:false,lastChunk:true,metadata:{}}));
          eventBus.publish(AgentEvent.statusUpdate({taskId,contextId,status:statusFor(hub,taskId,contextId),metadata:{evidenceRefs:(hub.evidenceRefs||[]).map(String)}}));return;
        }
        if(next!==lastState){eventBus.publish(AgentEvent.statusUpdate({taskId,contextId,status:statusFor(hub,taskId,contextId),metadata:{}}));lastState=next;}
        if(HUB_TERMINAL.has(String(hub.status)))return;
        await sleep(this.pollMs);
      }
    } finally {this.cancelled.delete(String(ctx.taskId));}
  }
}

