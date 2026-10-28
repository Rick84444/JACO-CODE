import { nowIso } from './util.mjs';
import { assertLocalModelEndpoint, validateInferenceText } from './localInferenceTrust.mjs';

function outputTextResponses(raw){if(typeof raw?.output_text==='string')return raw.output_text;const t=[];for(const item of raw?.output||[])for(const part of item?.content||[])if(part?.type==='output_text'&&typeof part.text==='string')t.push(part.text);return t.join('\n');}
function outputTextChat(raw){return String(raw?.choices?.[0]?.message?.content||'');}
function outputTextAnthropic(raw){return (raw?.content||[]).filter(x=>x?.type==='text').map(x=>x.text).join('\n');}
function outputTextGemini(raw){return (raw?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('\n');}
function headersFor(p){const h={'content-type':'application/json'};const secret=p.secretEnv?String(process.env[p.secretEnv]||''):'';if(p.protocol.startsWith('openai-')&&secret)h.authorization=`Bearer ${secret}`;if(p.protocol==='anthropic-messages'&&secret){h['x-api-key']=secret;h['anthropic-version']='2023-06-01';}return h;}

export class ContinuumModelRouter {
  constructor({events,economic,operator,providers}){this.events=events;this.economic=economic;this.operator=operator;this.providers=providers;this.localProbeActive=false;}
  listProviders(){return this.providers.list();}
  registerProvider(input,actor='operator'){return this.providers.register(input,actor);}
  updateProviderPolicy(input,actor='operator'){return this.providers.updatePolicy(input,actor);}
  async listLocalModels(){
    const locals=this.providers.list().filter(p=>{if(!p.local||p.protocol!=='ollama')return false;try{assertLocalModelEndpoint(p);return true}catch{return false}});const out=[];
    for(const p of locals){try{const r=await fetch(`${p.baseUrl}/api/tags`,{signal:AbortSignal.timeout(3000),redirect:'error'});if(r.ok){const data=await r.json();for(const m of data.models||[])out.push({...m,providerId:p.id});}}catch{}}
    return out;
  }
  async reason(input={}){
    this.operator.assertExecutionAllowed();
    const localOnly=input.localOnly===true || process.env.JACO_LOCAL_ONLY==='1';
    const forced=String(input.providerId||'').trim();
    const target=forced?this.providers.publicView(this.providers.get(forced)):null;
    if(target?.enabled===false)throw Error('PROVIDER_DISABLED');
    const candidates=(target?[{provider:target,score:Infinity,estimatedCostUsd:Number(input.estimatedUsd||0)}]:this.providers.candidates(input)).filter(c=>!localOnly||c.provider.local);
    if(!candidates.length)throw new Error(localOnly?'NO_ELIGIBLE_LOCAL_PROVIDER':'NO_ELIGIBLE_PROVIDER');
    const failures=[];
    for(const candidate of candidates){const p=candidate.provider;const started=Date.now();
      try{
        assertLocalModelEndpoint(p);
        const estimatedUsd=Number(input.estimatedUsd??candidate.estimatedCostUsd??0);let reservation=null;
        // Every remote request must cross the economic gate, including a forced provider
        // and a provider with missing or zero pricing. The governor rejects unknown cost.
        if(!p.local){reservation=this.economic.authorizeCloud({missionId:input.missionId||null,taskId:input.taskId||null,estimatedUsd,expectedValueUsd:input.expectedValueUsd??null,purpose:input.purpose||'reasoning'});if(!reservation.allowed){failures.push({providerId:p.id,error:`CLOUD_BUDGET_REFUSED:${reservation.reason}`});continue;}}
        try{const result=await this.#call(p,input);const latencyMs=Date.now()-started;this.providers.markSuccess(p.id,latencyMs);if(reservation?.reservationId)this.economic.settleCloud(reservation.reservationId,Number(input.actualUsd??estimatedUsd),result.usage||{});const out={...result,providerId:p.id,provider:p.id,protocol:p.protocol,latencyMs,routeScore:candidate.score,finishedAt:nowIso()};this.events.append({stream:'model',type:'model.provider_completed',entityId:result.responseId||null,actor:'model-router',data:{providerId:p.id,protocol:p.protocol,model:out.model,latencyMs,usage:out.usage,costUsd:out.costUsd||0}});return out;}catch(error){if(reservation?.reservationId){const message=error instanceof Error?error.message:String(error);if(/^(PROVIDER_HTTP_|MODEL_NOT_CONFIGURED|PROVIDER_SECRET_NOT_CONFIGURED|UNSUPPORTED_PROVIDER_PROTOCOL)/.test(message))this.economic.releaseReservation(reservation.reservationId,'confirmed_request_failure');else this.economic.markCloudOutcomeUnknown(reservation.reservationId,message);}throw error;}
      }catch(error){const message=error instanceof Error?error.message:String(error);this.providers.markFailure(p.id,message);failures.push({providerId:p.id,error:message});this.events.append({stream:'model',type:'model.provider_failed',entityId:p.id,actor:'model-router',data:{error:message}});if(forced)break;}
    }
    const e=new Error(`ALL_PROVIDERS_FAILED:${failures.map(x=>`${x.providerId}:${x.error}`).join(' | ').slice(0,2000)}`);e.failures=failures;throw e;
  }
  /** An explicit, real inference check; health/tags alone cannot establish model usability. */
  async probeLocalModel({providerId=null,timeoutMs=90000}={}) {
    const timeout=Number(timeoutMs);
    if(!Number.isSafeInteger(timeout)||timeout<5000||timeout>180000)throw Error('LOCAL_PROBE_TIMEOUT_INVALID');
    const started=Date.now();
    if(this.localProbeActive)return {schema:'jaco.local-inference-probe/v1',status:'INFERENCE_BUSY',providerId:providerId||null,systemReady:false,agentToolsVerified:false,cloudUsed:false};
    this.localProbeActive=true;
    try {
      const result=await this.reason({
        providerId:providerId||undefined,localOnly:true,requiredCapabilities:['text'],
        prompt:'Respond with one short word that confirms you can generate text.',
        maxOutputTokens:128,timeoutMs:timeout,purpose:'on-device-inference-probe',
      });
      return {schema:'jaco.local-inference-probe/v1',status:'INFERENCE_VERIFIED',
        providerId:result.providerId,model:result.model,latencyMs:Date.now()-started,
        cloudUsed:false,agentToolsVerified:false,systemReady:false};
    } catch(error) {
      return {schema:'jaco.local-inference-probe/v1',status:'INFERENCE_FAILED',
        providerId:providerId||null,model:null,latencyMs:Date.now()-started,
        cloudUsed:false,agentToolsVerified:false,systemReady:false,
        errorCode:String(error?.message||error).split(':')[0].slice(0,80)};
    } finally {this.localProbeActive=false;}
  }
  async #call(p,input){
    assertLocalModelEndpoint(p);
    const prompt=String(input.prompt||'');const instructions=input.instructions?String(input.instructions):null;const max=Math.max(16,Math.min(Number(input.maxOutputTokens||1200),8192));const timeout=Math.max(5_000,Math.min(Number(input.timeoutMs||180_000),600_000));const model=String(input.model||p.model||'').trim();if(!model)throw new Error('MODEL_NOT_CONFIGURED');const headers=headersFor(p);const redirect=p.local?'error':'follow';
    if(p.protocol==='ollama'){
      const configuredCtx=Number(process.env.JACO_OLLAMA_NUM_CTX||4096);
      const numCtx=Number.isSafeInteger(configuredCtx)&&configuredCtx>=1024&&configuredCtx<=32768?configuredCtx:4096;
      const numPredict=Math.min(max,Math.max(128,Math.floor(numCtx/4)));
      const response=await fetch(`${p.baseUrl}/api/generate`,{method:'POST',headers,redirect,body:JSON.stringify({model,prompt,system:instructions||undefined,stream:false,options:{num_ctx:numCtx,num_predict:numPredict}}),signal:AbortSignal.timeout(timeout)});const raw=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}:${JSON.stringify(raw).slice(0,400)}`);if(raw.done!==true)throw Error('OLLAMA_INFERENCE_NOT_COMPLETE');return {model,text:validateInferenceText(raw.response,'OLLAMA'),responseId:null,usage:{inputTokens:raw.prompt_eval_count||null,outputTokens:raw.eval_count||null},costUsd:0,raw:{done:raw.done,doneReason:raw.done_reason}};
    }
    if(p.protocol==='openai-responses'){
      const response=await fetch(`${p.baseUrl}/responses`,{method:'POST',headers,redirect,body:JSON.stringify({model,input:prompt,max_output_tokens:max,...(instructions?{instructions}:{})}),signal:AbortSignal.timeout(timeout)});const raw=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}:${JSON.stringify(raw).slice(0,400)}`);return {model:raw.model||model,text:validateInferenceText(outputTextResponses(raw)),responseId:raw.id||null,usage:raw.usage||null,costUsd:Number(input.actualUsd||0)};
    }
    if(p.protocol==='openai-chat'){
      const messages=[...(instructions?[{role:'system',content:instructions}]:[]),{role:'user',content:prompt}];const response=await fetch(`${p.baseUrl}/chat/completions`,{method:'POST',headers,redirect,body:JSON.stringify({model,messages,max_tokens:max,temperature:input.temperature??0.2,...(input.reasoningEffort?{reasoning_effort:String(input.reasoningEffort)}:{})}),signal:AbortSignal.timeout(timeout)});const raw=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}:${JSON.stringify(raw).slice(0,400)}`);
      const text=outputTextChat(raw);
      // Reasoning models (DeepSeek, o-series) spend the token budget on reasoning_content first. When
      // max_tokens runs out there the answer is empty, which must fail loudly instead of looking like
      // a successful empty result — the call was still billed.
      if(!text && raw?.choices?.[0]?.message?.reasoning_content)throw new Error(`PROVIDER_REASONING_TRUNCATED:${model} spent ${raw?.usage?.completion_tokens||max} output tokens on reasoning and returned no answer; raise maxOutputTokens`);
      return {model:raw.model||model,text:validateInferenceText(text),responseId:raw.id||null,usage:raw.usage||null,costUsd:Number(input.actualUsd||0)};
    }
    if(p.protocol==='anthropic-messages'){
      const body={model,max_tokens:max,messages:[{role:'user',content:prompt}],...(instructions?{system:instructions}:{})};const response=await fetch(`${p.baseUrl}/v1/messages`,{method:'POST',headers,redirect,body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const raw=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}:${JSON.stringify(raw).slice(0,400)}`);return {model:raw.model||model,text:validateInferenceText(outputTextAnthropic(raw)),responseId:raw.id||null,usage:raw.usage||null,costUsd:Number(input.actualUsd||0)};
    }
    if(p.protocol==='google-generate-content'){
      const secret=p.secretEnv?String(process.env[p.secretEnv]||''):'';if(!secret)throw new Error('PROVIDER_SECRET_NOT_CONFIGURED');const url=`${p.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(secret)}`;const body={contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:max},...(instructions?{systemInstruction:{parts:[{text:instructions}]}}:{})};const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},redirect,body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});const raw=await response.json().catch(()=>({}));if(!response.ok)throw new Error(`PROVIDER_HTTP_${response.status}:${JSON.stringify(raw).slice(0,400)}`);return {model,text:validateInferenceText(outputTextGemini(raw)),responseId:raw.responseId||null,usage:raw.usageMetadata||null,costUsd:Number(input.actualUsd||0)};
    }
    throw new Error(`UNSUPPORTED_PROVIDER_PROTOCOL:${p.protocol}`);
  }
}
