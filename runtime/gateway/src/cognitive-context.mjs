// Private, authenticated MCP-only projection of canonical JACO Continuum context.
// This is not a public GitHub relay and does not replicate an independent memory.
const redactText=(value,n=1000)=>typeof value==='string'?value.slice(0,n)
  .replace(/\bBearer\s+[^\s,;]{8,}/gi,'[REDACTED]')
  .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/gi,'[REDACTED]'):null;
const clip=(value,n=1000)=>redactText(value,n);
const asFinite=(v)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const toList=(value,limit=12)=>Array.isArray(value)?value.slice(0,limit).map(v=>typeof v==='string'?v.slice(0,400):safeJson(v,2)):[];

function safeJson(value,depth=3){
  if(depth<=0)return '[depth-limit]';
  if(value===null||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return redactText(value,900);
  if(Array.isArray(value))return value.slice(0,16).map(v=>safeJson(v,depth-1));
  if(!value||typeof value!=='object')return null;
  const out={};
  for(const [key,v] of Object.entries(value).slice(0,35)){
    // No secrets, credentials, absolute paths or raw process diagnostics.
    if(/token|secret|password|api.?key|credential|private|environment|path|host|url/i.test(key))continue;
    out[key.slice(0,80)]=safeJson(v,depth-1);
  }
  return out;
}
const SAFE_STATES=new Set(['READY','DEGRADED','DOWN','RUNNING','STARTING','UNAVAILABLE','UNVERIFIED']);
const safeState=(v)=>SAFE_STATES.has(v)?v:'UNVERIFIED';
export function projectCognitiveContext({continuity,health,economic}={}){
  const e=continuity?.envelope;
  const p=economic?.economic?.policy || {};
  const s=economic?.economic?.state || {};
  const h=economic?.economic?.headroom || {};
  return {
    schema:'jaco.chatgpt-cognitive-context/v1',
    source:'authenticated-jaco-core',
    // A fresh Core response is required; a previously cached GitHub receipt is not host truth.
    continuity:e?.schema==='jaco.cognitive-continuity-envelope.v1' ? {
      schema:e.schema,
      continuityId:clip(e.continuityId,150),revision:Number.isSafeInteger(e.revision)?e.revision:null,
      missionAuthority:clip(e.missionAuthority,100),objective:safeJson(e.objective,3),
      focus:safeJson(e.focus,3),workingState:safeJson(e.workingState,3),
      // Continuum emits unresolved:{questions,hypotheses} and invariants:{...flags}, not arrays.
      unresolved:safeJson(e.unresolved,4),epistemic:safeJson(e.epistemic,3),invariants:safeJson(e.invariants,3),
    } : {state:'UNAVAILABLE'},
    service:{
      status:safeState(health?.status),
      core:health?.core?.up===true?'UP':health?.core?.up===false?'DOWN':'UNVERIFIED',
      workplace:safeState(health?.workplace?.state),
      durableNova:safeState(health?.workplace?.novaState),
      aura:'NOT_INDEPENDENTLY_PROBED',
    },
    economic:{
      cloudEnabled:typeof p.cloudEnabled==='boolean'?p.cloudEnabled:null,
      manualAuraCloudEnabled:typeof p.manualAuraCloudEnabled==='boolean'?p.manualAuraCloudEnabled:null,
      novaCloudEnabled:typeof p.novaOllamaCloudEnabled==='boolean'?p.novaOllamaCloudEnabled:null,
      dailyCapUsd:asFinite(p.dailyCloudUsd),monthlyCapUsd:asFinite(p.monthlyCloudUsd),
      perCallCapUsd:asFinite(p.maxCloudUsdPerTask),
      autonomousCallsPer15m:p.maxAutonomousCloudCallsPer15m==null?null:asFinite(p.maxAutonomousCloudCallsPer15m),
      dailySpentEstimateUsd:asFinite(s.dailySpentUsd),
      reservedEstimateUsd:asFinite(s.reservedUsd),
      dailyHeadroomEstimateUsd:asFinite(h.dailyUsd),
      providerInvoiceVerified:false,
    },
    authority:{
      auraSoleOperator:'EXPECTED_BY_POLICY_NOT_INDEPENDENTLY_PROBED',
      mayExecuteToolsDirectly:false,
      knowledgeWritePermission:'SEPARATE_OPERATOR_OPT_IN',
      sourceTrust:'runtime-reported; independent external verification required for consequential actions',
    },
  };
}
export function projectKnowledgeSearch(reply){
  const items=Array.isArray(reply?.knowledge)?reply.knowledge:[];
  return {schema:'jaco.chatgpt-knowledge-search/v1',source:'jaco.continuum.knowledge-store',
    results:items.slice(0,10).map(k=>({
      id:clip(k?.id,150),kind:clip(k?.kind,80),purpose:clip(k?.purpose,600),
      verificationStatus:clip(k?.verificationStatus,30),
      confidence:asFinite(k?.confidence),revision:Number.isSafeInteger(k?.revision)?k.revision:null,
      updatedAt:clip(k?.updatedAt,50),
      evidenceRefs:toList(k?.evidenceRefs,10),
      contentHash:clip(k?.contentHash,100),
      reasoningSummary:clip(k?.reasoningSummary,1200),
    }))};
}
export function validatedKnowledgeNote({topic,note}={}){
  const t=String(topic||'').trim(),n=String(note||'').trim();
  if(t.length<4||t.length>160||n.length<10||n.length>1200)throw Error('JACO_KNOWLEDGE_NOTE_INVALID');
  const text=t+'\n'+n;
  // Reject obvious credential material rather than persisting it in searchable memory.
  if(/\bBearer\s+[^\s,;]{8,}/i.test(text) ||
     /-----BEGIN [A-Z ]*PRIVATE KEY-----|AIza[\w-]{24,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:api.?key|password|bearer|token)\s*[:=]\s*\S+/i.test(text)) 
    throw Error('JACO_KNOWLEDGE_NOTE_SECRET_REFUSED');
  return {
    kind:'assistant-note',purpose:t,reasoningSummary:n,
    verificationStatus:'UNVERIFIED',confidence:0.2,
    evidenceRefs:[],reusable:false,
  };
}
