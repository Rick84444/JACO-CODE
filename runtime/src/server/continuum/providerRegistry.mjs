import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, deepClone, redactSensitive, safeNumber } from './util.mjs';

const PROTOCOLS = new Set(['ollama','openai-responses','openai-chat','anthropic-messages','google-generate-content']);
const DEFAULT_POLICY = {
  schema:'jaco.continuum.provider-policy.v1',
  localPreference:0.35,
  privacyWeight:0.25,
  reliabilityWeight:0.30,
  latencyWeight:0.15,
  costWeight:0.20,
  priorityWeight:0.10,
  healthTtlMs:60_000,
  failureCooldownMs:30_000,
  requireCapabilityMatch:true,
};

function uniqueStrings(v,max=100){return Array.isArray(v)?[...new Set(v.map(String).map(x=>x.trim()).filter(Boolean))].slice(0,max):[];}
function secretAvailable(envName){return !envName || Boolean(String(process.env[envName]||'').trim());}
function normalizeBase(v){return String(v||'').trim().replace(/\/$/,'');}
function reliability(stats){const ok=Number(stats?.successes||0),bad=Number(stats?.failures||0);return (ok+1)/(ok+bad+2);}

export class ProviderRegistry {
  constructor(root,events){
    this.file=path.join(root,'providers.json');this.events=events;
    this.state=readJson(this.file,{schema:'jaco.continuum.provider-registry.v1',providers:{},policy:DEFAULT_POLICY,updatedAt:nowIso()});
    this.state.policy={...DEFAULT_POLICY,...(this.state.policy||{})};
    this.#seedEnvironmentProviders();this.#save();
  }
  register(input,actor='operator'){
    const id=String(input.id||'').trim().slice(0,120);if(!id)throw new Error('provider.id is required');
    const protocol=String(input.protocol||'').trim();if(!PROTOCOLS.has(protocol))throw new Error(`unsupported provider protocol '${protocol}'`);
    const existing=this.state.providers[id]||{};
    const item={
      schema:'jaco.continuum.provider.v1',id,
      name:String(input.name||existing.name||id).slice(0,200),protocol,
      baseUrl:normalizeBase(input.baseUrl||existing.baseUrl),model:String(input.model||existing.model||'').trim().slice(0,240),
      secretEnv:String(input.secretEnv||existing.secretEnv||'').trim().slice(0,180)||null,
      capabilities:uniqueStrings(input.capabilities??existing.capabilities??['reasoning','text']),
      local:Boolean(input.local??existing.local??false),enabled:input.enabled===undefined?existing.enabled!==false:Boolean(input.enabled),
      priority:Math.max(-100,Math.min(100,safeNumber(input.priority,existing.priority??0))),
      privacyClass:String(input.privacyClass||existing.privacyClass||(input.local?'LOCAL':'REMOTE')).slice(0,80),
      inputUsdPerMillion:Math.max(0,safeNumber(input.inputUsdPerMillion,existing.inputUsdPerMillion??0)),
      outputUsdPerMillion:Math.max(0,safeNumber(input.outputUsdPerMillion,existing.outputUsdPerMillion??0)),
      maxContextTokens:Math.max(0,safeNumber(input.maxContextTokens,existing.maxContextTokens??0)),
      metadata:redactSensitive(input.metadata??existing.metadata??{}),
      stats:existing.stats||{successes:0,failures:0,emaLatencyMs:null,lastSuccessAt:null,lastFailureAt:null,lastFailure:null},
      registeredAt:existing.registeredAt||nowIso(),updatedAt:nowIso(),revision:Number(existing.revision||0)+1,
    };
    if(!item.baseUrl)throw new Error('provider.baseUrl is required');
    this.state.providers[id]=item;this.#save();this.events.append({stream:'model',type:existing.id?'provider.updated':'provider.registered',entityId:id,actor,data:{...item,secretEnv:item.secretEnv}});return this.publicView(item);
  }
  remove(id,actor='operator'){if(!this.state.providers[id])return false;delete this.state.providers[id];this.#save();this.events.append({stream:'model',type:'provider.removed',entityId:id,actor,data:{}});return true;}
  updatePolicy(patch,actor='operator'){
    const next={...this.state.policy};
    for(const k of ['localPreference','privacyWeight','reliabilityWeight','latencyWeight','costWeight','priorityWeight'])if(k in patch)next[k]=Math.max(0,Math.min(1,safeNumber(patch[k],next[k])));
    for(const k of ['healthTtlMs','failureCooldownMs'])if(k in patch)next[k]=Math.max(1000,Math.min(3_600_000,safeNumber(patch[k],next[k])));
    if('requireCapabilityMatch' in patch)next.requireCapabilityMatch=Boolean(patch.requireCapabilityMatch);
    this.state.policy=next;this.#save();this.events.append({stream:'model',type:'provider.policy_updated',actor,data:next});return deepClone(next);
  }
  list(){return Object.values(this.state.providers).map(x=>this.publicView(x));}
  get(id){const p=this.state.providers[id];if(!p)throw new Error(`provider '${id}' not found`);return deepClone(p);}
  publicView(p){return {...deepClone(p),secretConfigured:secretAvailable(p.secretEnv),secretEnv:p.secretEnv||null,reliability:Number(reliability(p.stats).toFixed(4))};}
  candidates(input={}){
    const required=uniqueStrings(input.requiredCapabilities||[]);const now=Date.now();const policy=this.state.policy;
    const estimateInputTokens=Math.max(1,Math.ceil(String(input.prompt||'').length/4));const estimateOutputTokens=Math.max(16,Number(input.maxOutputTokens||1200));
    const items=[];
    for(const p of Object.values(this.state.providers)){
      if(!p.enabled)continue;if(!secretAvailable(p.secretEnv))continue;
      if(required.length&&policy.requireCapabilityMatch&&required.some(c=>!p.capabilities.includes(c)))continue;
      const lastFailureMs=p.stats?.lastFailureAt?Date.parse(p.stats.lastFailureAt):0;
      if(lastFailureMs&&now-lastFailureMs<policy.failureCooldownMs&&!p.stats?.lastSuccessAt)continue;
      const rel=reliability(p.stats);const latency=Math.max(1,Number(p.stats?.emaLatencyMs||1500));
      const estCost=(estimateInputTokens/1e6)*p.inputUsdPerMillion+(estimateOutputTokens/1e6)*p.outputUsdPerMillion;
      const costScore=1/(1+estCost*100);const latencyScore=1/(1+latency/1000);const privacyScore=p.local?1:(p.privacyClass==='PRIVATE_REMOTE'?0.7:0.35);
      const score=policy.reliabilityWeight*rel+policy.latencyWeight*latencyScore+policy.costWeight*costScore+policy.privacyWeight*privacyScore+policy.priorityWeight*((p.priority+100)/200)+policy.localPreference*(p.local?1:0);
      items.push({provider:this.publicView(p),score:Number(score.toFixed(6)),estimatedCostUsd:Number(estCost.toFixed(8)),reliability:rel,latencyMs:latency});
    }
    return items.sort((a,b)=>b.score-a.score||a.estimatedCostUsd-b.estimatedCostUsd);
  }
  markSuccess(id,latencyMs){const p=this.state.providers[id];if(!p)return;p.stats.successes=Number(p.stats.successes||0)+1;p.stats.lastSuccessAt=nowIso();const prev=Number(p.stats.emaLatencyMs||latencyMs);p.stats.emaLatencyMs=Math.round(prev*0.7+Number(latencyMs)*0.3);p.stats.lastFailure=null;p.updatedAt=nowIso();this.#save();}
  markFailure(id,error){const p=this.state.providers[id];if(!p)return;p.stats.failures=Number(p.stats.failures||0)+1;p.stats.lastFailureAt=nowIso();p.stats.lastFailure=String(error||'failure').slice(0,500);p.updatedAt=nowIso();this.#save();}
  #seedEnvironmentProviders(){
    const seeds=[];
    const ollama=process.env.JACO_OLLAMA_URL||'http://127.0.0.1:11434';seeds.push({id:'ollama-local',name:'Ollama Local',protocol:'ollama',baseUrl:ollama,model:process.env.JACO_OLLAMA_MODEL||'',local:true,priority:10,capabilities:['reasoning','text','code']});
    if(process.env.OPENAI_API_KEY&&process.env.JACO_OPENAI_MODEL)seeds.push({id:'openai-env',name:'OpenAI (env)',protocol:'openai-responses',baseUrl:process.env.JACO_OPENAI_BASE_URL||'https://api.openai.com/v1',model:process.env.JACO_OPENAI_MODEL,secretEnv:'OPENAI_API_KEY',capabilities:['reasoning','text','code','long-context'],priority:0});
    // llama.cpp's llama-server speaks the OpenAI chat protocol. JACO_LLAMACPP_URL is the same variable
    // jacoctl exports for SEER, so a local GGUF brain (e.g. Bonsai on Termux) also serves Continuum/A2A work.
    if(process.env.JACO_LLAMACPP_URL)seeds.push({id:'llamacpp-env',name:'llama.cpp (env)',protocol:'openai-chat',baseUrl:process.env.JACO_LLAMACPP_URL,model:String(process.env.JACO_LLAMACPP_MODEL||'').split(/[\\/]/).pop().replace(/\.gguf$/i,''),local:true,capabilities:['reasoning','text','code'],priority:0});
    if(process.env.JACO_LMSTUDIO_URL)seeds.push({id:'lmstudio-env',name:'LM Studio (env)',protocol:'openai-chat',baseUrl:process.env.JACO_LMSTUDIO_URL,model:process.env.JACO_LMSTUDIO_MODEL||'',local:true,capabilities:['reasoning','text','code'],priority:0});
    if(process.env.DEEPSEEK_API_KEY&&process.env.JACO_DEEPSEEK_MODEL&&process.env.JACO_DEEPSEEK_BASE_URL)seeds.push({id:'deepseek-env',name:'DeepSeek (env)',protocol:'openai-chat',baseUrl:process.env.JACO_DEEPSEEK_BASE_URL,model:process.env.JACO_DEEPSEEK_MODEL,secretEnv:'DEEPSEEK_API_KEY',capabilities:['reasoning','text','code']});
    if(process.env.ANTHROPIC_API_KEY&&process.env.JACO_ANTHROPIC_MODEL)seeds.push({id:'anthropic-env',name:'Anthropic (env)',protocol:'anthropic-messages',baseUrl:process.env.JACO_ANTHROPIC_BASE_URL||'https://api.anthropic.com',model:process.env.JACO_ANTHROPIC_MODEL,secretEnv:'ANTHROPIC_API_KEY',capabilities:['reasoning','text','code','long-context']});
    if(process.env.GEMINI_API_KEY&&process.env.JACO_GEMINI_MODEL)seeds.push({id:'gemini-env',name:'Gemini (env)',protocol:'google-generate-content',baseUrl:process.env.JACO_GEMINI_BASE_URL||'https://generativelanguage.googleapis.com/v1beta',model:process.env.JACO_GEMINI_MODEL,secretEnv:'GEMINI_API_KEY',capabilities:['reasoning','text','code','long-context']});
    for(const s of seeds)if(!this.state.providers[s.id]){try{this.register(s,'environment-bootstrap');}catch{}}
  }
  #save(){this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
}
