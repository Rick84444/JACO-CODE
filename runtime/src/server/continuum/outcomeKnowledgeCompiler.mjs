import { makeId, nowIso, deepClone, redactSensitive, sha256, canonicalJson } from './util.mjs';
import { receiptPromotionEligibility } from '../../../../agents/lib/effect-evidence.mjs';

const TERMINAL = new Set(['VERIFIED','FALSIFIED']);
const OUTCOMES = new Set(['SUCCESS','FAILURE','PARTIAL','UNKNOWN']);
function uniq(values){return [...new Set((Array.isArray(values)?values:[]).map(String).filter(Boolean))];}
function stableIdPart(value){return String(value||'').replace(/[^a-zA-Z0-9_.-]/g,'_').slice(0,80);}
function compactReceipt(receipt){
  const native=receipt?.result?.receipt;
  const result=receipt?.result;
  return redactSensitive({
    ok:receipt?.ok===true,
    verified:receipt?.verified===true,
    outcomeUnknown:Boolean(receipt?.outcomeUnknown),
    before:receipt?.before??null,
    after:receipt?.after??null,
    native:native&&typeof native==='object'?{
      action_id:native.action_id??native.actionId??null,
      action_type:native.action_type??native.actionType??null,
      success:native.success??null,
      verified:native.verified??null,
      before_hash:native.before_hash??native.beforeHash??native.screen_before_hash??null,
      after_hash:native.after_hash??native.afterHash??native.screen_after_hash??null,
      package_name:native.package_name??native.packageName??null,
      observed_at:native.observed_at??native.observedAt??null,
    }:null,
    transport:result&&typeof result==='object'?{
      httpStatus:result.httpStatus??null,
      transportError:Boolean(result.transportError),
    }:null,
  });
}

function transitionTargets(contradictsKnowledgeIds,supersedesKnowledgeIds,selfId=null){
  const contradicted=uniq(contradictsKnowledgeIds),superseded=uniq(supersedesKnowledgeIds);const supersededSet=new Set(superseded);
  const overlap=contradicted.filter(id=>supersededSet.has(id));if(overlap.length)throw new Error(`knowledge target cannot be both CONTRADICTED and SUPERSEDED: ${overlap.join(', ')}`);
  if(selfId&&(contradicted.includes(selfId)||superseded.includes(selfId)))throw new Error('compiled outcome cannot invalidate itself');
  return {contradicted,superseded};
}

export class OutcomeKnowledgeCompiler {
  constructor({events,evidence,knowledge,hypotheses=null}){this.events=events;this.evidence=evidence;this.knowledge=knowledge;this.hypotheses=hypotheses;}

  compileHypothesis({setId,candidateId,missionId=null,confidence=null,contradictsKnowledgeIds=[],supersedesKnowledgeIds=[],actor='outcome-compiler'}={}){
    if(!this.hypotheses)throw new Error('hypothesis engine unavailable');
    const set=this.hypotheses.get(setId);const candidate=set.candidates.find(item=>item.id===candidateId);if(!candidate)throw new Error('candidate not found');
    if(!TERMINAL.has(candidate.status))throw new Error('hypothesis outcome must be VERIFIED or FALSIFIED');
    const terminalRefs=uniq(candidate.terminalEvidenceRefs?.length?candidate.terminalEvidenceRefs:candidate.evidenceRefs);
    if(!terminalRefs.length)throw new Error('terminal hypothesis outcome requires evidence');
    this.evidence.assertRefs(terminalRefs,{verified:true});
    const falsified=candidate.status==='FALSIFIED';
    const knowledgeId=`outcome_${String(set.id).replace(/[^a-zA-Z0-9_.-]/g,'_')}_${String(candidate.id).replace(/[^a-zA-Z0-9_.-]/g,'_')}`;
    const targets=transitionTargets(contradictsKnowledgeIds,supersedesKnowledgeIds,knowledgeId);
    const knowledge=this.knowledge.put({
      id:knowledgeId,
      kind:falsified?'falsified-hypothesis-outcome':'verified-hypothesis-outcome',
      purpose:falsified?`Verified falsification of hypothesis: ${candidate.label}`:`Verified outcome for hypothesis: ${candidate.label}`,
      confidence:confidence==null?(falsified?0.95:0.9):Math.max(0,Math.min(1,Number(confidence))),
      evidenceRefs:terminalRefs,
      usedIn:uniq([missionId,set.missionId]),
      dependencies:uniq([set.id,candidate.id]),
      alternatives:set.candidates.filter(item=>item.id!==candidate.id).slice(0,20).map(item=>({id:item.id,label:item.label,status:item.status})),
      failureModes:falsified?[candidate.rejectionReason||'hypothesis falsified by verified evidence']:[],
      reusable:true,
      implementation:{setId:set.id,candidateId:candidate.id,label:candidate.label,proposal:redactSensitive(candidate.proposal??null),metrics:redactSensitive(candidate.metrics||{}),terminalStatus:candidate.status,terminalEvidenceRefs:terminalRefs},
      reasoningSummary:falsified?`The hypothesis was rejected by verified terminal evidence. This object records the failure as reusable engineering knowledge; it does not preserve the rejected proposal as a true claim.`:`The hypothesis reached VERIFIED using terminal evidence. Historical preliminary observations remain provenance but do not define terminal truth.`,
      metrics:{terminalStatus:candidate.status,compiledAt:nowIso()},
      verificationStatus:'VERIFIED',
    },actor);
    const transitions=[];
    for(const id of targets.contradicted){const item=this.knowledge.setStatus(id,'CONTRADICTED',{reason:`Contradicted by verified hypothesis outcome ${knowledge.id}`,evidenceRefs:terminalRefs},actor);transitions.push({id:item.id,status:item.verificationStatus});}
    for(const id of targets.superseded){const item=this.knowledge.setStatus(id,'SUPERSEDED',{reason:`Superseded by verified hypothesis outcome ${knowledge.id}`,evidenceRefs:terminalRefs},actor);transitions.push({id:item.id,status:item.verificationStatus});}
    this.events.append({stream:'knowledge',type:'knowledge.outcome_compiled',entityId:knowledge.id,actor,data:{source:'hypothesis',setId:set.id,candidateId:candidate.id,missionId:missionId||set.missionId||null,status:candidate.status,evidenceRefs:terminalRefs,transitions}});
    return {knowledge,transitions};
  }


  promoteVerifiedReceipt({missionId,actionId,taskType,receipt,actor='nova-evidence-promoter'}={}){
    const mission=String(missionId||'').trim(),action=String(actionId||'').trim(),task=String(taskType||'').trim();
    if(!mission)throw new Error('receipt promotion requires missionId');
    if(!action)throw new Error('receipt promotion requires actionId');
    if(!task)throw new Error('receipt promotion requires taskType');
    const assessment=receiptPromotionEligibility(task,receipt);
    if(!assessment.allowed)throw new Error(`RECEIPT_PROMOTION_REJECTED:${assessment.reason}`);

    // Recompute provenance at the canonical knowledge sink: the caller cannot
    // forge an INDEPENDENTLY_VERIFIED marker in the submitted receipt.
    const compact={...compactReceipt(receipt),effectEvidence:assessment.evidence};
    const receiptHash=sha256(canonicalJson({missionId:mission,actionId:action,taskType:task,receipt:compact}));
    const evidenceId=`nova_receipt_${receiptHash.slice(0,40)}`;
    let evidenceItem;
    if(this.evidence.exists(evidenceId)){
      evidenceItem=this.evidence.get(evidenceId);
      if(evidenceItem?.data?.receiptHash!==receiptHash)throw new Error('receipt evidence hash collision');
      if(evidenceItem.verified!==false)throw new Error('existing receipt evidence provenance mismatch');
    }else{
      evidenceItem=this.evidence.record({
        id:evidenceId,
        kind:'nova-action-receipt',
        claim:`Durable Nova reported successful observation for task ${task}; external truth has not been independently verified`,
        source:`nova:${mission}`,
        refs:[`mission:${mission}`,`action:${action}`],
        data:{missionId:mission,actionId:action,taskType:task,receiptHash,receipt:compact},
        verified:false,
        verificationMethod:'durable_nova_tool_attestation',
      },actor);
    }

    const knowledgeId=`receipt_outcome_${stableIdPart(task)}_${receiptHash.slice(0,32)}`;
    try{
      const existing=this.knowledge.get(knowledgeId);
      if(existing.verificationStatus!=='UNVERIFIED')throw new Error('existing observation provenance mismatch');
      if(!existing.evidenceRefs.includes(evidenceId))throw new Error('existing receipt knowledge evidence mismatch');
      return deepClone({evidence:evidenceItem,knowledge:existing,idempotent:true});
    }catch(error){
      if(!/not found/.test(String(error?.message||error)))throw error;
    }

    const knowledge=this.knowledge.put({
      id:knowledgeId,
      kind:'tool-attested-observation',
      purpose:`Historically reported successful observation (not independent proof): ${task}`,
      confidence:0.6,
      evidenceRefs:[evidenceId],
      usedIn:[mission],
      dependencies:[`task:${task}`],
      failureModes:[],
      reusable:false,
      implementation:{missionId:mission,actionId:action,taskType:task,receiptHash},
      reasoningSummary:'Single tool-attested observational result from Durable Nova. Its existence is recorded, but the external facts have not been independently verified. Never use as a reusable capability or conclusive postcondition.',
      metrics:{outcome:'TOOL_ATTESTED',source:'durable-nova',evidenceLevel:assessment.evidence.level,compiledAt:nowIso()},
      verificationStatus:'UNVERIFIED',
    },actor);
    this.events.append({stream:'knowledge',type:'knowledge.receipt_observation_recorded',entityId:knowledge.id,actor,data:{missionId:mission,actionId:action,taskType:task,evidenceRef:evidenceId,receiptHash,evidenceLevel:assessment.evidence.level,reusable:false}});
    return deepClone({evidence:evidenceItem,knowledge,idempotent:false});
  }

  promoteVerifiedDecision({claim,kind='verified-decision',missionId=null,evidenceRefs=[],confidence=0.95,dependencies=[],alternatives=[],failureModes=[],implementation=null,reusable=false,actor='helix-verifier'}={}){
    const purpose=String(claim||'').trim();
    if(!purpose)throw new Error('verified decision requires claim');
    const refs=uniq(evidenceRefs);
    if(!refs.length)throw new Error('verified decision requires evidenceRefs');
    this.evidence.assertRefs(refs,{verified:true});
    const payloadHash=sha256(canonicalJson({claim:purpose,kind:String(kind),missionId:missionId||null,evidenceRefs:refs,dependencies:uniq(dependencies)}));
    const knowledgeId=`decision_${payloadHash.slice(0,40)}`;
    try{
      const existing=this.knowledge.get(knowledgeId);
      if(existing.verificationStatus!=='VERIFIED')throw new Error('existing decision knowledge is not VERIFIED');
      return deepClone({knowledge:existing,idempotent:true});
    }catch(error){
      if(!/not found/.test(String(error?.message||error)))throw error;
    }
    const knowledge=this.knowledge.put({
      id:knowledgeId,
      kind:String(kind||'verified-decision').slice(0,100),
      purpose:purpose.slice(0,2000),
      confidence:Math.max(0,Math.min(1,Number(confidence))),
      evidenceRefs:refs,
      usedIn:uniq([missionId]),
      dependencies:uniq(dependencies),
      alternatives:redactSensitive(Array.isArray(alternatives)?alternatives:[]),
      failureModes:uniq(failureModes),
      reusable:Boolean(reusable),
      implementation:redactSensitive(implementation),
      reasoningSummary:'Evidence-backed decision promoted through the canonical OutcomeKnowledgeCompiler. The decision is only as general as its explicit evidence and dependencies.',
      metrics:{source:'helix-decision',compiledAt:nowIso()},
      verificationStatus:'VERIFIED',
    },actor);
    this.events.append({stream:'knowledge',type:'knowledge.decision_promoted',entityId:knowledge.id,actor,data:{missionId:missionId||null,evidenceRefs:refs,reusable:Boolean(reusable)}});
    return deepClone({knowledge,idempotent:false});
  }

  compileOutcome({outcome,claim,missionId=null,evidenceRefs=[],confidence=0.8,kind='mission-outcome',dependencies=[],usedIn=[],failureModes=[],implementation=null,contradictsKnowledgeIds=[],supersedesKnowledgeIds=[],actor='outcome-compiler'}={}){
    const normalized=String(outcome||'').toUpperCase();if(!OUTCOMES.has(normalized))throw new Error('outcome must be SUCCESS, FAILURE, PARTIAL or UNKNOWN');
    if(!String(claim||'').trim())throw new Error('outcome claim required');
    const refs=uniq(evidenceRefs);const verified=normalized!=='UNKNOWN';
    if(verified){if(!refs.length)throw new Error('verified outcome requires evidenceRefs');this.evidence.assertRefs(refs,{verified:true});}else if(refs.length)this.evidence.assertRefs(refs,{verified:false});
    if(!verified&&(uniq(contradictsKnowledgeIds).length||uniq(supersedesKnowledgeIds).length))throw new Error('UNKNOWN outcome cannot contradict or supersede knowledge');
    const id=makeId('outcome');const targets=transitionTargets(contradictsKnowledgeIds,supersedesKnowledgeIds,id);
    const knowledge=this.knowledge.put({id,kind,purpose:String(claim).slice(0,2000),confidence:Math.max(0,Math.min(1,Number(confidence))),evidenceRefs:refs,usedIn:uniq([missionId,...usedIn]),dependencies:uniq(dependencies),failureModes:normalized==='FAILURE'?uniq(failureModes.length?failureModes:['verified mission failure']):uniq(failureModes),reusable:normalized!=='UNKNOWN',implementation:redactSensitive(implementation),reasoningSummary:normalized==='UNKNOWN'?'Outcome is intentionally UNKNOWN; no successful or failed execution claim is inferred.':`Outcome ${normalized} compiled from verified evidence.`,metrics:{outcome:normalized,compiledAt:nowIso()},verificationStatus:verified?'VERIFIED':'UNVERIFIED'},actor);
    const transitions=[];
    if(verified){for(const target of targets.contradicted){const item=this.knowledge.setStatus(target,'CONTRADICTED',{reason:`Contradicted by verified outcome ${id}`,evidenceRefs:refs},actor);transitions.push({id:item.id,status:item.verificationStatus});}for(const target of targets.superseded){const item=this.knowledge.setStatus(target,'SUPERSEDED',{reason:`Superseded by verified outcome ${id}`,evidenceRefs:refs},actor);transitions.push({id:item.id,status:item.verificationStatus});}}
    this.events.append({stream:'knowledge',type:'knowledge.outcome_compiled',entityId:id,actor,data:{source:'runtime',missionId,outcome:normalized,evidenceRefs:refs,transitions}});
    return deepClone({knowledge,transitions});
  }
}
