import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS=15000;

function stablePeerId(principal){return `a2a_${crypto.createHash('sha256').update(String(principal)).digest('hex').slice(0,20)}`;}

export class ContinuumA2ACoreClient {
  constructor({baseUrl,token,isContinuum=true,timeoutMs=DEFAULT_TIMEOUT_MS}={}){this.base=String(baseUrl||'http://127.0.0.1:3020').replace(/\/$/,'');this.token=String(token||'');this.isContinuum=Boolean(isContinuum);this.timeoutMs=Math.max(1000,Number(timeoutMs)||DEFAULT_TIMEOUT_MS);}
  async request(path,{method='GET',body=null,timeoutMs=this.timeoutMs}={}){const response=await fetch(`${this.base}${path}`,{method,headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(this.token?(this.isContinuum?{'x-jaco-continuum-token':this.token}:{'x-gateway-token':this.token}):{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeoutMs)});const data=await response.json().catch(()=>({}));if(!response.ok||data?.success===false){const detail=data?.error?.message||data?.error||JSON.stringify(data).slice(0,600);throw new Error(`CORE_${response.status}:${detail}`);}return data;}
  async registerPeer(principal){const id=stablePeerId(principal);await this.request('/api/continuum/hub/agents',{method:'POST',body:{id,name:`A2A peer ${String(principal).slice(0,120)}`,role:'external-peer',provider:'a2a',model:'external',capabilities:['A2A_PEER'],tools:[],permissions:['submit_tasks'],metadata:{principalId:String(principal).slice(0,240)}}});return id;}
  async recordInbound({peerId,taskId,contextId,message,metadata={}}){return this.request('/api/continuum/hub/messages',{method:'POST',body:{from:peerId,to:'broadcast',type:'a2a.inbound',missionId:null,taskId,content:{a2aTaskId:taskId,contextId,message,metadata},stateRefs:[],evidenceRefs:[]}});}
  async recordDemandSignal({peerId,principal,signal,fallbackNeed}){return this.request('/api/continuum/revenue/signals',{method:'POST',body:{source:`a2a:${principal}`,requester:peerId,need:signal?.need||fallbackNeed,tags:signal?.tags||[],offeredRevenueUsd:signal?.offeredRevenueUsd??null,verified:Boolean(signal?.verified),evidenceRefs:signal?.evidenceRefs||[]}});}
  async createTask(input){const out=await this.request('/api/continuum/hub/tasks',{method:'POST',body:input});return out.task;}
  async getTask(taskId){const out=await this.request(`/api/continuum/hub/tasks/${encodeURIComponent(taskId)}`);return out.task;}
  // Uses the hub cancel transition; it never impersonates the assigned agent through /complete.
  async cancelTask(taskId,{actor='a2a-peer',reason='A2A CancelTask'}={}){const out=await this.request(`/api/continuum/hub/tasks/${encodeURIComponent(taskId)}/cancel`,{method:'POST',body:{actor,reason}});return out.task;}
}

export { stablePeerId };
