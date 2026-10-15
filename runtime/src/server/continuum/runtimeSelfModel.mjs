import { nowIso, deepClone } from './util.mjs';

function ratio(a,b){return b>0?Number((a/b).toFixed(4)):null;}
function wilsonLower(successes,total,z=1.96){if(total<=0)return null;const p=successes/total;const z2=z*z;const denominator=1+z2/total;const centre=p+z2/(2*total);const margin=z*Math.sqrt((p*(1-p)+z2/(4*total))/total);return Number(((centre-margin)/denominator).toFixed(4));}
function mean(values){const nums=values.map(Number).filter(Number.isFinite);return nums.length?Number((nums.reduce((a,b)=>a+b,0)/nums.length).toFixed(4)):null;}
function uniq(values){return [...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];}
function evidenceSetKey(refs){return uniq(refs).sort().join('|');}

export class RuntimeSelfModel {
  constructor({events,capabilities,knowledge,providers=null,repository=null,browser=null,scheduler=null,operator=null}){
    this.events=events;this.capabilities=capabilities;this.knowledge=knowledge;this.providers=providers;this.repository=repository;this.browser=browser;this.scheduler=scheduler;this.operator=operator;
  }

  capabilitySummary(){
    const trajectories=Object.values(this.capabilities.state?.trajectories||{});
    const compiled=this.capabilities.list();
    const workflows=[...new Set([...trajectories.map(t=>t.workflowKey),...compiled.map(c=>c.workflowKey)])].filter(Boolean).sort();
    return workflows.map(workflowKey=>{
      const attempts=trajectories.filter(t=>t.workflowKey===workflowKey);
      const verified=attempts.filter(t=>t.verified);
      const successes=verified.filter(t=>t.success);
      const failures=verified.filter(t=>!t.success);
      const caps=compiled.filter(c=>c.workflowKey===workflowKey);
      const evidenceBacked=verified.filter(t=>Array.isArray(t.evidenceRefs)&&t.evidenceRefs.length>0);
      const distinctEvidenceRefs=uniq(verified.flatMap(t=>t.evidenceRefs||[]));
      const independentEvidenceSets=uniq(verified.map(t=>evidenceSetKey(t.evidenceRefs||[])).filter(Boolean));
      const independentEnough=verified.length>=3&&independentEvidenceSets.length>=3;
      const successRate=ratio(successes.length,verified.length);
      return {
        capability:workflowKey,
        attempts:attempts.length,
        verifiedAttempts:verified.length,
        verifiedSuccesses:successes.length,
        verifiedFailures:failures.length,
        distinctEvidenceCount:distinctEvidenceRefs.length,
        independentEvidenceSetCount:independentEvidenceSets.length,
        successRate,
        conservativeReliability:wilsonLower(successes.length,verified.length),
        evidenceCoverage:ratio(evidenceBacked.length,verified.length),
        compiledVariants:caps.length,
        activeVariants:caps.filter(c=>c.status==='ACTIVE').length,
        confidence:mean(caps.map(c=>c.confidence)),
        state:!independentEnough?'INSUFFICIENT_INDEPENDENT_EVIDENCE':failures.length===0&&successes.length>=3?'PROVISIONALLY_RELIABLE':successRate>=0.8?'MIXED_RELIABLE':'UNRELIABLE',
      };
    });
  }

  eventSummary({limit=5000}={}){
    const events=this.events.list({limit:Math.min(5000,Number(limit)||5000)});
    const byStream={};const byType={};
    for(const event of events){byStream[event.stream]=(byStream[event.stream]||0)+1;byType[event.type]=(byType[event.type]||0)+1;}
    return {observedEvents:events.length,byStream,byType};
  }

  knowledgeSummary(){
    const all=this.knowledge.list({limit:1000});const byStatus={};const byKind={};
    for(const item of all){byStatus[item.verificationStatus||'UNVERIFIED']=(byStatus[item.verificationStatus||'UNVERIFIED']||0)+1;byKind[item.kind||'general']=(byKind[item.kind||'general']||0)+1;}
    return {count:all.length,verified:byStatus.VERIFIED||0,inactive:(byStatus.STALE||0)+(byStatus.SUPERSEDED||0)+(byStatus.CONTRADICTED||0)+(byStatus.INVALID||0),byStatus,byKind};
  }

  snapshot(){
    const repository=this.repository?.snapshot?.()||null;
    const providers=this.providers?.list?.()||[];
    const capabilities=this.capabilitySummary();
    const unknowns=[];
    if(!repository||repository.status!=='SCANNED')unknowns.push(repository?.status==='PARTIAL'?'semantic_repository_partial':'semantic_repository_not_scanned');
    if(!capabilities.some(c=>c.independentEvidenceSetCount>=3&&c.verifiedAttempts>=3))unknowns.push('no_capability_has_three_independent_verified_attempts');
    if(!providers.length)unknowns.push('no_registered_model_providers');
    const snapshot={
      schema:'jaco.runtime-self-model.v1',
      generatedAt:nowIso(),
      epistemicPolicy:'derived_projection_from_canonical_runtime_evidence',
      capabilities,
      knowledge:this.knowledgeSummary(),
      events:this.eventSummary(),
      providers:{count:providers.length,items:providers.map(provider=>({id:provider.id||provider.name||null,type:provider.type||provider.kind||null,enabled:provider.enabled!==false}))},
      repository:repository?{status:repository.status,snapshotHash:repository.snapshotHash||null,summary:repository.summary||null,updatedAt:repository.updatedAt||null}:null,
      browser:this.browser?.status?.()||null,
      scheduler:this.scheduler?.snapshot?.()||null,
      operator:this.operator?.snapshot?.()||null,
      unknowns,
    };
    return deepClone(snapshot);
  }
}
