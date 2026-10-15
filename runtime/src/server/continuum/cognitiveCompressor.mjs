import { nowIso, sha256, canonicalJson } from './util.mjs';

function uniq(values){return [...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];}
function intersection(lists){if(!lists.length)return [];return [...new Set(lists[0])].filter(value=>lists.every(list=>new Set(list).has(value)));}
function keyTerms(items){const stop=new Set(['the','and','for','with','from','that','this','into','verified','outcome','knowledge','mission','hypothesis']);const counts=new Map();for(const item of items){for(const token of String(item.purpose||'').toLowerCase().match(/[a-z0-9_-]{3,}/g)||[]){if(stop.has(token))continue;counts.set(token,(counts.get(token)||0)+1);}}return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,20).map(([term,count])=>({term,count}));}
function evidenceSetKey(refs){return uniq(refs).sort().join('|');}

export class CognitiveCompressor {
  constructor({events,knowledge,capabilities,evidence=null}){this.events=events;this.knowledge=knowledge;this.capabilities=capabilities;this.evidence=evidence;}

  compressTrajectories({workflowKey,minimum=5,actor='cognitive-compressor'}={}){
    const all=Object.values(this.capabilities.state?.trajectories||{}).filter(t=>!workflowKey||t.workflowKey===workflowKey);
    if(all.length<minimum)throw new Error(`not enough trajectories to compress: ${all.length}/${minimum}`);
    const byWorkflow=new Map();for(const t of all){const list=byWorkflow.get(t.workflowKey)||[];list.push(t);byWorkflow.set(t.workflowKey,list);}
    const outputs=[];
    for(const [key,list] of byWorkflow){
      const verified=list.filter(t=>t.verified),successes=verified.filter(t=>t.success),failures=verified.filter(t=>!t.success),unverified=list.filter(t=>!t.verified);
      if(verified.length<minimum)throw new Error(`trajectory compression requires ${minimum} verified trajectories; found ${verified.length}`);
      const independentEvidenceSets=uniq(verified.map(t=>evidenceSetKey(t.evidenceRefs||[])).filter(Boolean));
      if(independentEvidenceSets.length<minimum)throw new Error(`trajectory compression requires ${minimum} independent evidence sets; found ${independentEvidenceSets.length}`);
      const signatures={};for(const t of successes)signatures[t.signature]=(signatures[t.signature]||0)+1;
      const topSignatures=Object.entries(signatures).sort((a,b)=>b[1]-a[1]).slice(0,10);
      const evidenceRefs=uniq(verified.flatMap(t=>t.evidenceRefs||[])).slice(0,500);
      if(this.evidence)this.evidence.assertRefs(evidenceRefs,{verified:true});
      const summary={workflowKey:key,trajectoryCount:list.length,verifiedAttempts:verified.length,verifiedSuccesses:successes.length,verifiedFailures:failures.length,unverifiedAttempts:unverified.length,distinctEvidenceCount:evidenceRefs.length,independentEvidenceSetCount:independentEvidenceSets.length,verifiedSuccessRate:verified.length?Number((successes.length/verified.length).toFixed(4)):null,topSignatures,representativeTrajectoryIds:successes.slice(0,5).map(t=>t.id),failureTrajectoryIds:failures.slice(0,10).map(t=>t.id),compressedAt:nowIso()};
      const ko=this.knowledge.put({id:`compressed_${key.replace(/[^a-zA-Z0-9_-]/g,'_')}_${sha256(canonicalJson(summary)).slice(0,8)}`,kind:'trajectory-compression-candidate',purpose:`Compression candidate for workflow ${key}`,confidence:summary.verifiedSuccessRate??0,evidenceRefs,reusable:false,implementation:{summary,sourceTrajectoryIds:list.map(t=>t.id)},failureModes:['abstraction_not_holdout_verified','selector_or_environment_drift'],reasoningSummary:`Deterministic compression of ${list.length} trajectories backed by ${independentEvidenceSets.length} independent evidence sets. Supporting observations are verified, but the abstraction itself remains UNVERIFIED until independent holdout validation.`,verificationStatus:'UNVERIFIED'},actor);
      outputs.push(ko);
    }
    this.events.append({stream:'knowledge',type:'knowledge.compression_completed',actor,data:{mode:'trajectories',workflows:outputs.length,knowledgeIds:outputs.map(x=>x.id)}});return outputs;
  }

  compressKnowledge({knowledgeIds=[],kind=null,minimum=3,actor='cognitive-compressor'}={}){
    const requested=uniq(knowledgeIds);
    const source=requested.length?requested.map(id=>this.knowledge.get(id)):this.knowledge.list({kind,limit:1000}).filter(item=>item.verificationStatus==='VERIFIED');
    const verified=source.filter(item=>item.verificationStatus==='VERIFIED');
    if(verified.length<minimum)throw new Error(`not enough verified knowledge objects to compress: ${verified.length}/${minimum}`);
    const independentEvidenceSets=uniq(verified.map(item=>evidenceSetKey(item.evidenceRefs||[])).filter(Boolean));
    if(independentEvidenceSets.length<minimum)throw new Error(`knowledge compression requires ${minimum} independent evidence sets; found ${independentEvidenceSets.length}`);
    const evidenceRefs=uniq(verified.flatMap(item=>item.evidenceRefs||[])).slice(0,500);
    if(this.evidence)this.evidence.assertRefs(evidenceRefs,{verified:true});
    const commonDependencies=intersection(verified.map(item=>item.dependencies||[]));
    const commonFailureModes=intersection(verified.map(item=>item.failureModes||[]));
    const terms=keyTerms(verified);
    const summary={sourceKnowledgeIds:verified.map(item=>item.id),sourceKinds:uniq(verified.map(item=>item.kind)),commonDependencies,commonFailureModes,keyTerms:terms,sourceCount:verified.length,distinctEvidenceCount:evidenceRefs.length,independentEvidenceSetCount:independentEvidenceSets.length,compressedAt:nowIso()};
    const id=`pattern_candidate_${sha256(canonicalJson(summary)).slice(0,16)}`;
    const pattern=this.knowledge.put({id,kind:'cognitive-pattern-candidate',purpose:`Candidate abstraction from ${verified.length} verified knowledge objects${kind?` of kind ${kind}`:''}`,confidence:Number((verified.reduce((sum,item)=>sum+Number(item.confidence||0),0)/verified.length).toFixed(4)),evidenceRefs,usedIn:uniq(verified.flatMap(item=>item.usedIn||[])),dependencies:commonDependencies,failureModes:commonFailureModes,reusable:false,implementation:{summary},reasoningSummary:'This object is a deterministic abstraction candidate over verified source knowledge with independent evidence sets. Source truth does not automatically prove the abstraction; independent replay/holdout evidence is required before promotion.',metrics:{sourceCount:verified.length,distinctEvidenceCount:evidenceRefs.length,independentEvidenceSetCount:independentEvidenceSets.length,keyTermCount:terms.length},verificationStatus:'UNVERIFIED'},actor);
    this.events.append({stream:'knowledge',type:'knowledge.pattern_candidate_created',entityId:pattern.id,actor,data:{sourceKnowledgeIds:summary.sourceKnowledgeIds,evidenceRefs}});
    return pattern;
  }

  validatePattern(id,{evidenceRefs=[]}={},actor='verifier'){
    const pattern=this.knowledge.get(id);if(pattern.kind!=='cognitive-pattern-candidate'&&pattern.kind!=='trajectory-compression-candidate')throw new Error('knowledge object is not a compression candidate');
    const refs=uniq(evidenceRefs);if(!refs.length)throw new Error('pattern validation requires holdout evidence');if(!this.evidence)throw new Error('pattern validation requires evidence ledger');this.evidence.assertRefs(refs,{verified:true});
    const sourceRefs=new Set(pattern.evidenceRefs||[]);if(refs.some(ref=>sourceRefs.has(ref)))throw new Error('holdout evidence must be independent of source evidence');
    const updated=this.knowledge.put({...pattern,reusable:true,evidenceRefs:uniq([...(pattern.evidenceRefs||[]),...refs]),verificationStatus:'VERIFIED',reasoningSummary:`${pattern.reasoningSummary} Independent holdout/replay validation evidence has now been attached.`},actor);
    this.events.append({stream:'knowledge',type:'knowledge.pattern_validated',entityId:id,actor,data:{holdoutEvidenceRefs:refs}});return updated;
  }
}
