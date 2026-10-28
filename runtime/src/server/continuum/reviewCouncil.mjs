import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, makeId, deepClone, sha256, canonicalJson, safeNumber } from './util.mjs';

const BASE_REWARD={SELF_ERROR:1.0,PEER_ERROR:2.0,IDLE_STALL:1.5,CODE_QUALITY:2.0,GOAL_DRIFT:2.0,RISK_FOUND:2.5,FIX_VERIFIED:1.5};
function scorecard(id){return {agentId:id,verifiedFindings:0,falsePositives:0,duplicateFindings:0,selfFindings:0,peerFindings:0,fixesVerified:0,rewardCredits:0,executionSuccesses:0,executionFailures:0,forecastCount:0,brierSum:0,updatedAt:nowIso()};}
function fingerprint(input){return sha256(canonicalJson({targetAgentId:input.targetAgentId||null,targetType:input.targetType||null,targetId:input.targetId||null,kind:input.kind||null,claim:String(input.claim||'').trim().toLowerCase().slice(0,1200)}));}

export class ReviewCouncil {
  constructor(root,events,evidence,hub){this.file=path.join(root,'review-council.json');this.events=events;this.evidence=evidence;this.hub=hub;this.riskRouter=null;this.state=readJson(this.file,{reviews:{},scorecards:{},fingerprints:{},updatedAt:nowIso()});}
  setRiskRouter(riskRouter){this.riskRouter=riskRouter;}
  submit(input,actor=input?.reviewerAgentId||'reviewer'){
    const reviewer=String(input.reviewerAgentId||actor).slice(0,180);if(!reviewer)throw new Error('reviewerAgentId required');
    const refs=Array.isArray(input.evidenceRefs)?[...new Set(input.evidenceRefs.map(String).filter(Boolean))]:[];if(refs.length)this.evidence.assertRefs(refs,{verified:false});
    const id=input.id?String(input.id).slice(0,180):makeId('review');const fp=fingerprint(input);const duplicate=Boolean(this.state.fingerprints[fp]);
    const item={schema:'jaco.continuum.review.v1',id,reviewerAgentId:reviewer,targetAgentId:input.targetAgentId?String(input.targetAgentId).slice(0,180):null,targetType:String(input.targetType||'task').slice(0,80),targetId:input.targetId?String(input.targetId).slice(0,180):null,kind:String(input.kind||'PEER_ERROR').slice(0,80),severity:String(input.severity||'MEDIUM').slice(0,40),claim:String(input.claim||'').slice(0,4000),evidenceRefs:refs,proposedFix:input.proposedFix?String(input.proposedFix).slice(0,4000):null,status:duplicate?'DUPLICATE':'PENDING',fingerprint:fp,createdAt:nowIso(),validatedAt:null,validatorAgentId:null,rewardCredits:0};
    this.state.reviews[id]=item;if(!duplicate)this.state.fingerprints[fp]=id;else this.#card(reviewer).duplicateFindings+=1;this.#save();this.events.append({stream:'review',type:duplicate?'review.duplicate':'review.submitted',entityId:id,actor:reviewer,data:{targetAgentId:item.targetAgentId,kind:item.kind,severity:item.severity,fingerprint:fp}});return deepClone(item);
  }
  validate(id,{validatorAgentId,evidenceRefs=[],valid=true,fixVerified=false}={}){
    const r=this.state.reviews[id];if(!r)throw new Error('review not found');if(r.status==='DUPLICATE')return deepClone(r);const validator=String(validatorAgentId||'').slice(0,180);if(!validator)throw new Error('validatorAgentId required');if(validator===r.reviewerAgentId&&validator!=='system-deterministic')throw new Error('reviewer cannot validate own reward');
    const added=(evidenceRefs||[]).map(String).filter(Boolean);const refs=[...new Set([...(r.evidenceRefs||[]),...added])];if(valid){this.evidence.assertRefs(refs,{verified:true});if(validator!=='system-deterministic'&&!added.some(x=>!(r.evidenceRefs||[]).includes(x)))throw new Error('independent validation requires new verified evidence');}
    r.status=valid?'VALIDATED':'REJECTED';r.validatorAgentId=validator;r.validatedAt=nowIso();r.evidenceRefs=refs;
    const c=this.#card(r.reviewerAgentId);
    if(valid){let reward=BASE_REWARD[r.kind]??1;const self=r.targetAgentId===r.reviewerAgentId;if(self){reward*=0.65;c.selfFindings+=1;}else c.peerFindings+=1;c.verifiedFindings+=1;if(fixVerified){reward+=BASE_REWARD.FIX_VERIFIED;c.fixesVerified+=1;}r.rewardCredits=Number(reward.toFixed(3));c.rewardCredits=Number((c.rewardCredits+reward).toFixed(3));}
    else{r.rewardCredits=-1;c.falsePositives+=1;c.rewardCredits=Number((c.rewardCredits-1).toFixed(3));}
    c.updatedAt=nowIso();this.#save();this.events.append({stream:'review',type:valid?'review.validated':'review.rejected',entityId:id,actor:validator,data:{reviewerAgentId:r.reviewerAgentId,rewardCredits:r.rewardCredits,fixVerified}});if(valid&&r.targetAgentId&&['HIGH','CRITICAL'].includes(r.severity)&&['RISK_FOUND','GOAL_DRIFT','CODE_QUALITY','PEER_ERROR'].includes(r.kind)&&this.riskRouter){try{this.riskRouter.enforce(r.targetAgentId,{actor:'review-council'});}catch{}}return deepClone(r);
  }
  recordExecution(agentId,{success=true,quality=1}={}){const c=this.#card(agentId);if(success)c.executionSuccesses+=1;else c.executionFailures+=1;c.lastQuality=Math.max(0,Math.min(1,safeNumber(quality,0)));c.updatedAt=nowIso();this.#save();}
  recordForecastScore(agentId,brier){const c=this.#card(agentId);const v=Math.max(0,Math.min(2,safeNumber(brier,2)));c.forecastCount+=1;c.brierSum+=v;c.updatedAt=nowIso();this.#save();return this.agentScore(agentId);}
  agentScore(agentId){const c=this.#card(agentId);const execution=(c.executionSuccesses+1)/(c.executionSuccesses+c.executionFailures+2);const forecast=c.forecastCount?Math.max(0,1-(c.brierSum/c.forecastCount)/2):0.5;const reviewUtility=Math.max(0,Math.min(1,0.5+c.rewardCredits/20));const score=0.45*execution+0.25*reviewUtility+0.30*forecast;return {agentId,score:Number(score.toFixed(4)),execution:Number(execution.toFixed(4)),reviewUtility:Number(reviewUtility.toFixed(4)),forecastCalibration:Number(forecast.toFixed(4)),card:deepClone(c)};}
  scores(){return Object.keys(this.state.scorecards).map(id=>this.agentScore(id)).sort((a,b)=>b.score-a.score);}
  list({status=null,targetAgentId=null,reviewerAgentId=null}={}){return Object.values(this.state.reviews).filter(r=>!status||r.status===status).filter(r=>!targetAgentId||r.targetAgentId===targetAgentId).filter(r=>!reviewerAgentId||r.reviewerAgentId===reviewerAgentId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(deepClone);}
  auditIdle(reviewerAgentId='jaco-seer',{staleAfterMs=120_000}={}){
    const now=Date.now(),findings=[];const agents=this.hub.listAgents();const tasks=this.hub.listTasks();
    for(const a of agents){if(a.id===reviewerAgentId||a.liveness!=='LIVE'||a.executionMode==='SANDBOX_ONLY')continue;const active=tasks.find(t=>t.assignedAgentId===a.id&&t.status==='ACTIVE');const capableQueued=tasks.filter(t=>['QUEUED','RETRY'].includes(t.status)&&(t.requirements||[]).every(r=>(a.capabilities||[]).includes(r)));
      let reason=null,targetId=null;
      if(active&&now-Date.parse(a.progressAt||active.updatedAt||active.createdAt)>staleAfterMs){reason='Active task has no verified progress heartbeat';targetId=active.id;}
      else if(!active&&capableQueued.length&&now-Date.parse(a.progressAt||a.lastHeartbeatAt||a.registeredAt)>staleAfterMs&&!a.idleJustification){reason='Live capable agent is idle while runnable work exists without justification';targetId=capableQueued[0].id;}
      if(!reason)continue;
      const ev=this.evidence.recordInternal({kind:'agent-stall-detection',claim:reason,source:'review-council',verified:true,verificationMethod:'deterministic runtime-hub liveness/task audit',data:{agentId:a.id,targetTaskId:targetId,staleAfterMs}},'review-council');
      const review=this.submit({reviewerAgentId,targetAgentId:a.id,targetType:'agent-runtime',targetId,kind:'IDLE_STALL',severity:'MEDIUM',claim:reason,evidenceRefs:[ev.id]},reviewerAgentId);const validated=this.validate(review.id,{validatorAgentId:'system-deterministic',evidenceRefs:[ev.id],valid:true});findings.push(validated);
    }
    return findings;
  }
  #card(id){const key=String(id||'unknown').slice(0,180);if(!this.state.scorecards[key])this.state.scorecards[key]=scorecard(key);return this.state.scorecards[key];}
  #save(){this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
}
