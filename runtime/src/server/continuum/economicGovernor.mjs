import path from 'node:path';
import fs from 'node:fs';
import { atomicWriteJson, readJson, nowIso, makeId, safeNumber, deepClone } from './util.mjs';
import {
  defaultGeminiQuotaProfile, validGeminiQuotaProfile, canonicalGeminiQuotaModels, inspectGeminiQuota,
  recordGeminiQuotaReservation, reconcileGeminiQuotaUsage, markGeminiQuotaBackoff, geminiQuotaSnapshot,
} from '../aura/geminiQuota.mjs';

const DEFAULT_POLICY = {
  schema:'jaco.continuum.economic-policy.v1',
  // Operator decision 2026-10-22: cost limits are something the operator turns on, not built in. Cloud
  // models are allowed and every cap is off (null) until the operator sets one in the budget panel.
  // Outgoing payments and financial commitments are a separate, always-on rule (spendGuard, approval policy).
  cloudEnabled:true,
  manualAuraCloudEnabled:true,
  novaOllamaCloudEnabled:true,
  currency:'USD',
  dailyCloudUsd:null,
  monthlyCloudUsd:null,
  maxCloudUsdPerTask:null,
  // Independent runaway fuse for autonomous SEER/Nova inference. Monetary caps remain the operator's choice.
  // The manual Aura conversation is exempt; a runaway graph cannot generate unlimited calls in a burst.
  maxAutonomousCloudCallsPer15m:12,
  warningAtPercent:70,
  hardStopAtPercent:100,
  requirePositiveExpectedValueForRevenueMissions:true,
  financialCommitmentRequiresOperatorApproval:true,
  disallowUnboundedRetries:true,
  disallowUnboundedAgentSpawn:true,
};

// Longer than any planner or chat call (the slowest allow a few minutes).
const RESERVATION_TTL_MS=30*60_000;

const providerKey=r=>String((r&&r.metadata&&(r.metadata.providerId||r.metadata.provider))||(r&&r.purpose)||'unknown');

function periodKey(kind,date=new Date()){
  if(kind==='day')return date.toISOString().slice(0,10);
  return date.toISOString().slice(0,7);
}

export class EconomicGovernor {
  constructor(root,events,evidence=null){
    this.policyFile=path.join(root,'economic-policy.json');
    this.stateFile=path.join(root,'economic-state.json');
    this.events=events;this.evidence=evidence;
    this.geminiQuotaFile=path.join(root,'gemini-quota-profile.json');
    this.geminiQuotaProfile=readJson(this.geminiQuotaFile,defaultGeminiQuotaProfile());
    if(!validGeminiQuotaProfile(this.geminiQuotaProfile)) throw new Error('GEMINI_QUOTA_PROFILE_INVALID');
    // Safely migrate a previously persisted alias profile; conflicting aliases are
    // rejected rather than choosing arbitrary limits for a paid model.
    const loadedModels=canonicalGeminiQuotaModels(this.geminiQuotaProfile.models);
    if(Object.keys(loadedModels).some(id=>!Object.hasOwn(this.geminiQuotaProfile.models,id))){
      this.geminiQuotaProfile={...this.geminiQuotaProfile,models:loadedModels};
      atomicWriteJson(this.geminiQuotaFile,this.geminiQuotaProfile);
    }
    this.policy={...DEFAULT_POLICY,...(readJson(this.policyFile,{})||{})};
    if(!fs.existsSync(this.policyFile)&&process.env.JACO_CLOUD_ENABLED==='true')this.policy.cloudEnabled=true;
    this.state=readJson(this.stateFile,{day:periodKey('day'),month:periodKey('month'),dailySpentUsd:0,monthlySpentUsd:0,reservedUsd:0,reservations:{},autonomousCloudCalls:[],revenueUsd:0,updatedAt:nowIso()});
    if(!this.state.tally||typeof this.state.tally!=='object')this.state.tally={days:{},buckets:{}};
    this.#rollPeriods();this.#persist();
  }
  snapshot(){this.#rollPeriods();return {policy:deepClone(this.policy),state:deepClone(this.state),headroom:this.headroom(),geminiQuota:this.geminiQuotaSnapshot()};}
  geminiQuotaSnapshot(){return geminiQuotaSnapshot(this.state,this.geminiQuotaProfile);}
  updateGeminiQuotaProfile(patch,actor='operator'){
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||!patch.models||typeof patch.models!=='object'||Array.isArray(patch.models)||
       Object.keys(patch.models).length===0) throw new Error('GEMINI_QUOTA_PROFILE_INVALID');
    const requested=canonicalGeminiQuotaModels(patch.models);
    const profile={...this.geminiQuotaProfile,source:'operator-ai-studio-snapshot',observedAt:patch.observedAt||this.geminiQuotaProfile.observedAt,
      projectAssociationVerified:false,
      models:{...this.geminiQuotaProfile.models,...requested}};
    if(!validGeminiQuotaProfile(profile)) throw new Error('GEMINI_QUOTA_PROFILE_INVALID');
    atomicWriteJson(this.geminiQuotaFile,profile);this.geminiQuotaProfile=profile;
    this.events.append({stream:'economic',type:'gemini.quota_profile_updated',actor,data:{observedAt:profile.observedAt,models:Object.keys(patch.models).length,source:profile.source}});
    return this.geminiQuotaSnapshot();
  }
  updatePolicy(patch,actor='operator'){
    if(!patch||typeof patch!=='object'||Array.isArray(patch))throw new Error('ECONOMIC_POLICY_INVALID');
    const next={...this.policy};
    for(const key of ['cloudEnabled','manualAuraCloudEnabled','novaOllamaCloudEnabled','requirePositiveExpectedValueForRevenueMissions','financialCommitmentRequiresOperatorApproval','disallowUnboundedRetries','disallowUnboundedAgentSpawn'])if(key in patch){if(typeof patch[key]!=='boolean')throw new Error(`ECONOMIC_POLICY_BOOLEAN_REQUIRED:${key}`);next[key]=patch[key];}
    // A cap is a finite amount >= 0, or null to turn that cap off.
    for(const key of ['dailyCloudUsd','monthlyCloudUsd','maxCloudUsdPerTask'])if(key in patch){if(patch[key]!==null&&(typeof patch[key]!=='number'||!Number.isFinite(patch[key])||patch[key]<0))throw new Error(`ECONOMIC_POLICY_NUMBER_INVALID:${key}`);next[key]=patch[key];}
    if('maxAutonomousCloudCallsPer15m' in patch){
      const limit=patch.maxAutonomousCloudCallsPer15m;
      if(limit!==null&&(!Number.isInteger(limit)||limit<1||limit>10000))throw new Error('ECONOMIC_POLICY_AUTONOMOUS_CALL_LIMIT_INVALID');
      next.maxAutonomousCloudCallsPer15m=limit;
    }
    for(const key of ['warningAtPercent','hardStopAtPercent'])if(key in patch){if(typeof patch[key]!=='number'||!Number.isFinite(patch[key])||patch[key]<0)throw new Error(`ECONOMIC_POLICY_NUMBER_INVALID:${key}`);next[key]=patch[key];}
    if(next.warningAtPercent>next.hardStopAtPercent||next.hardStopAtPercent>100)throw new Error('ECONOMIC_POLICY_PERCENT_INVALID');
    atomicWriteJson(this.policyFile,next);this.policy=next;this.events.append({stream:'economic',type:'economic.policy_updated',actor,data:this.policy});return this.snapshot();
  }
  headroom(){
    this.#rollPeriods();
    return {
      // null = no cap set, so no limit on headroom.
      dailyUsd:this.policy.dailyCloudUsd==null?null:Math.max(0,this.policy.dailyCloudUsd-this.state.dailySpentUsd-this.state.reservedUsd),
      monthlyUsd:this.policy.monthlyCloudUsd==null?null:Math.max(0,this.policy.monthlyCloudUsd-this.state.monthlySpentUsd-this.state.reservedUsd),
      cloudEnabled:this.policy.cloudEnabled,
    };
  }
  authorizeCloud({missionId=null,taskId=null,estimatedUsd=0,expectedValueUsd=null,purpose='reasoning',metadata=null}={}){
    this.#rollPeriods();const estimate=Math.max(0,safeNumber(estimatedUsd,0));
    // Master switch is fail-closed. Legacy channel enable flags can further restrict
    // spending, but must never override an operator's explicit CLOUD OFF decision.
    if(!this.policy.cloudEnabled)return {allowed:false,reason:'CLOUD_DISABLED_BY_POLICY'};
    if(purpose==='manual-aura-chat'&&!this.policy.manualAuraCloudEnabled)return {allowed:false,reason:'CLOUD_DISABLED_BY_POLICY'};
    if(purpose==='nova-ollama-cloud'&&!this.policy.novaOllamaCloudEnabled)return {allowed:false,reason:'CLOUD_DISABLED_BY_POLICY'};
    if(estimate<=0)return {allowed:false,reason:'COST_ESTIMATE_REQUIRED'};
    if(this.policy.maxCloudUsdPerTask!=null&&estimate>this.policy.maxCloudUsdPerTask)return {allowed:false,reason:'TASK_COST_LIMIT',limitUsd:this.policy.maxCloudUsdPerTask};
    const headroom=this.headroom();
    if(headroom.dailyUsd!=null&&estimate>headroom.dailyUsd)return {allowed:false,reason:'DAILY_BUDGET_LIMIT',headroomUsd:headroom.dailyUsd};
    if(headroom.monthlyUsd!=null&&estimate>headroom.monthlyUsd)return {allowed:false,reason:'MONTHLY_BUDGET_LIMIT',headroomUsd:headroom.monthlyUsd};
    if(this.policy.requirePositiveExpectedValueForRevenueMissions&&expectedValueUsd!==null&&safeNumber(expectedValueUsd,0)<estimate)return {allowed:false,reason:'NEGATIVE_EXPECTED_VALUE'};
    // Durable circuit breaker: a graph can keep spending even when the operator deliberately removes
    // daily/monthly/per-call USD ceilings. Count successful reservations, not merely provider replies,
    // including calls whose outcome later became unknown. Single-writer runtime serializes reservations.
    // Also count native Gemini Continuum routing as autonomous work. Otherwise the
    // historical 2600-call SEER/Continuum loop could bypass the 12/15m emergency fuse.
    const autonomous=purpose==='nova-ollama-cloud' ||
      (purpose!=='manual-aura-chat' && metadata?.providerId==='gemini');
    const geminiQuotaCheck = metadata?.providerId==='gemini'
      ? inspectGeminiQuota(this.state,this.geminiQuotaProfile,
          {model:metadata.model,inputTokenBudget:metadata?.auraCostQuote?.maxInputTokens ?? metadata?.promptBytes}) : null;
    if(geminiQuotaCheck && !geminiQuotaCheck.allowed) return geminiQuotaCheck;
    const cutoff=Date.now()-15*60_000;
    const recent=(Array.isArray(this.state.autonomousCloudCalls)?this.state.autonomousCloudCalls:[])
      .filter(at=>Number.isFinite(at)&&at>cutoff&&at<=Date.now());
    const burstLimit=this.policy.maxAutonomousCloudCallsPer15m;
    if(autonomous&&burstLimit!=null&&recent.length>=burstLimit)
      return {allowed:false,reason:'AUTONOMOUS_CLOUD_BURST_LIMIT',limit:burstLimit,windowMinutes:15};
    const reservationId=makeId('costres');
    this.state.reservations[reservationId]={reservationId,missionId,taskId,estimatedUsd:estimate,expectedValueUsd,purpose,...(metadata?{metadata}:{}),createdAt:nowIso()};
    this.state.reservedUsd+=estimate;
    if(autonomous)this.state.autonomousCloudCalls=[...recent,Date.now()];
    if(geminiQuotaCheck)recordGeminiQuotaReservation(this.state,geminiQuotaCheck,reservationId);
    this.#persist();
    this.events.append({stream:'economic',type:'cloud.cost_reserved',entityId:reservationId,actor:'economic-governor',data:this.state.reservations[reservationId]});
    const after=[headroom.dailyUsd,headroom.monthlyUsd].filter(v=>v!=null).map(v=>v-estimate);
    return {allowed:true,reservationId,estimatedUsd:estimate,headroomAfterUsd:after.length?Math.min(...after):null};
  }
  settleCloud(reservationId,actualUsd,usage={}){
    this.#rollPeriods();const r=this.state.reservations[reservationId];if(!r)throw new Error(`unknown cost reservation '${reservationId}'`);
    const actual=Math.max(0,safeNumber(actualUsd,r.estimatedUsd));
    if(r.metadata?.providerId==='gemini')
      reconcileGeminiQuotaUsage(this.state,reservationId,Number(usage?.prompt_tokens));
    this.#book('settled',providerKey(r),{actualUsd:actual,estimatedUsd:r.estimatedUsd});
    this.state.reservedUsd=Math.max(0,this.state.reservedUsd-r.estimatedUsd);
    delete this.state.reservations[reservationId];
    this.state.dailySpentUsd+=actual;this.state.monthlySpentUsd+=actual;this.#persist();
    this.events.append({stream:'economic',type:'cloud.cost_settled',entityId:reservationId,actor:'economic-governor',data:{...r,actualUsd:actual,usage}});
    return this.snapshot();
  }
  markCloudOutcomeUnknown(reservationId,reason='provider outcome unknown'){
    const r=this.state.reservations[reservationId];if(!r)throw new Error(`unknown cost reservation '${reservationId}'`);
    r.status='UNKNOWN_OUTCOME';r.outcomeReason=String(reason).slice(0,500);r.outcomeUnknownAt=nowIso();
    this.#persist();this.events.append({stream:'economic',type:'cloud.cost_outcome_unknown',entityId:reservationId,actor:'economic-governor',data:{reason:r.outcomeReason,estimatedUsd:r.estimatedUsd}});
    return this.snapshot();
  }
  releaseReservation(reservationId,reason='not_used'){
    const r=this.state.reservations[reservationId];if(!r)return this.snapshot();
    if(r.metadata?.providerId==='gemini' && /\b429\b/.test(String(reason)))
      markGeminiQuotaBackoff(this.state,r.metadata.model);
    this.state.reservedUsd=Math.max(0,this.state.reservedUsd-r.estimatedUsd);delete this.state.reservations[reservationId];this.#persist();this.events.append({stream:'economic',type:'cloud.cost_released',entityId:reservationId,actor:'economic-governor',data:{reason}});return this.snapshot();
  }
  // Sets the conservative counters to what was measured (settled provider usage), dropping the part that came from
  // reservations that expired unconfirmed. Recorded as an event with before and after.
  recalibrateToMeasured(actor='operator'){
    this.#rollPeriods();
    const live=this.liveSnapshot();
    const before={dailySpentUsd:this.state.dailySpentUsd,monthlySpentUsd:this.state.monthlySpentUsd};
    this.state.dailySpentUsd=live.today.usd;
    this.state.monthlySpentUsd=live.month.usd;
    this.#persist();
    const after={dailySpentUsd:this.state.dailySpentUsd,monthlySpentUsd:this.state.monthlySpentUsd};
    this.events.append({stream:'economic',type:'economic.recalibrated',actor,data:{before,after,basis:'settled provider usage',expiredExcludedUsd:live.month.expiredUsd}});
    return {before,after,economic:this.snapshot()};
  }
  // The operator knows those calls cost nothing (e.g. a stopped provider): free what they hold.
  releaseUnknownReservations(actor='operator'){
    this.#rollPeriods();let released=0,usd=0;
    for(const [id,r] of Object.entries(this.state.reservations)){
      if(r.status!=='UNKNOWN_OUTCOME')continue;
      this.state.reservedUsd=Math.max(0,this.state.reservedUsd-r.estimatedUsd);usd+=r.estimatedUsd;released++;delete this.state.reservations[id];
      this.events.append({stream:'economic',type:'cloud.cost_released',entityId:id,actor,data:{reason:'operator released an unknown-outcome reservation'}});
    }
    if(released)this.#persist();
    return {released,usd,economic:this.snapshot()};
  }
  recordRevenue({missionId=null,amountUsd,source,verified=false,evidenceRef=null}={}){
    const amount=Math.max(0,safeNumber(amountUsd,0));if(!verified)throw new Error('revenue must be verified before it is credited');if(this.evidence)this.evidence.assertRefs(evidenceRef?[evidenceRef]:[],{verified:true,kinds:['payment-settlement','commerce-settlement']});
    this.state.revenueUsd+=amount;this.#persist();this.events.append({stream:'economic',type:'revenue.verified',entityId:missionId,actor:'economic-governor',data:{amountUsd:amount,source,evidenceRef}});return this.snapshot();
  }
  assertFinancialCommitmentAllowed({operatorApproved=false}={}){
    if(this.policy.financialCommitmentRequiresOperatorApproval&&!operatorApproved)throw new Error('OPERATOR_APPROVAL_REQUIRED_FOR_FINANCIAL_COMMITMENT');
    return true;
  }
  #rollPeriods(){const d=periodKey('day'),m=periodKey('month');if(this.state.month!==m){this.state.month=m;this.state.monthlySpentUsd=0;this.state.dailySpentUsd=0;this.state.day=d;this.state.reservedUsd=0;this.state.reservations={};}else if(this.state.day!==d){this.state.day=d;this.state.dailySpentUsd=0;}this.#expireStale();}
  // A reservation nobody settled (outcome unknown, or the caller restarted mid-call) is counted as spent
  // at its estimate once it is older than any model call can be: the money may have been charged, so it is
  // not released, but it no longer holds today's headroom forever (2026-10-09: 57 such reservations,
  // 4.28 USD, some from the day before, stopped every cloud planner). It counts for the day it was made.
  #expireStale(){
    const now=Date.now();let changed=false;
    for(const [id,r] of Object.entries(this.state.reservations||{})){
      const at=Date.parse(r.createdAt);
      if(Number.isFinite(at)&&now-at<RESERVATION_TTL_MS)continue;
      const usd=safeNumber(r.estimatedUsd,0);
      this.#book('expired',providerKey(r),{estimatedUsd:usd,at:Number.isFinite(at)?at:now});
      this.state.reservedUsd=Math.max(0,this.state.reservedUsd-usd);
      this.state.monthlySpentUsd+=usd;
      if(String(r.createdAt||'').slice(0,10)===this.state.day)this.state.dailySpentUsd+=usd;
      delete this.state.reservations[id];changed=true;
      this.events.append({stream:'economic',type:'cloud.cost_expired',entityId:id,actor:'economic-governor',data:{...r,countedUsd:usd}});
    }
    if(changed)this.#persist();
  }
  // What was really settled (provider usage x price), kept apart from the governor's conservative accounting so the
  // operator can see both: "settled" is measured, "expired" is a reservation nobody confirmed that is counted at its estimate.
  #book(kind,provider,{actualUsd=0,estimatedUsd=0,at=Date.now()}={}){
    const t=this.state.tally;const iso=new Date(at).toISOString();
    const day=t.days[iso.slice(0,10)]||(t.days[iso.slice(0,10)]={providers:{},expiredUsd:0,expiredCalls:0});
    if(kind==='settled'){
      const p=day.providers[provider]||(day.providers[provider]={calls:0,usd:0,estUsd:0});
      p.calls+=1;p.usd+=actualUsd;p.estUsd+=estimatedUsd;
      const bucket=iso.slice(0,15);t.buckets[bucket]=(t.buckets[bucket]||0)+actualUsd;
    }else{day.expiredUsd+=estimatedUsd;day.expiredCalls+=1;}
    const dayCut=new Date(Date.now()-45*86400e3).toISOString().slice(0,10);
    for(const k of Object.keys(t.days))if(k<dayCut)delete t.days[k];
    const bucketCut=new Date(Date.now()-48*3600e3).toISOString().slice(0,15);
    for(const k of Object.keys(t.buckets))if(k<bucketCut)delete t.buckets[k];
  }
  // Live view for the operator UI. Nothing here is estimated except fields named estimated*/expired*.
  liveSnapshot(now=Date.now()){
    this.#rollPeriods();
    const t=this.state.tally;const iso=new Date(now).toISOString();const today=iso.slice(0,10),month=iso.slice(0,7);
    const sum=(prefix)=>{const out={usd:0,calls:0,estimatedUsd:0,expiredUsd:0,expiredCalls:0,byProvider:{}};
      for(const [k,d] of Object.entries(t.days)){if(!k.startsWith(prefix))continue;
        out.expiredUsd+=d.expiredUsd||0;out.expiredCalls+=d.expiredCalls||0;
        for(const [name,p] of Object.entries(d.providers||{})){out.usd+=p.usd;out.calls+=p.calls;out.estimatedUsd+=p.estUsd;
          const o=out.byProvider[name]||(out.byProvider[name]={usd:0,calls:0});o.usd+=p.usd;o.calls+=p.calls;}}
      return out;};
    const since=new Date(now-60*60e3).toISOString().slice(0,15);
    let lastHourUsd=0;for(const [k,v] of Object.entries(t.buckets))if(k>=since)lastHourUsd+=v;
    const unknown={count:0,usd:0};let pendingCount=0,pendingUsd=0;
    for(const r of Object.values(this.state.reservations||{})){
      if(r.status==='UNKNOWN_OUTCOME'){unknown.count+=1;unknown.usd+=safeNumber(r.estimatedUsd,0);}
      else{pendingCount+=1;pendingUsd+=safeNumber(r.estimatedUsd,0);}
    }
    return {
      observedAt:new Date(now).toISOString(),seededAt:t.seededAt||null,
      today:sum(today),month:sum(month),lastHourUsd,
      pending:{count:pendingCount,usd:pendingUsd},unknown,
      governor:{dailySpentUsd:this.state.dailySpentUsd,monthlySpentUsd:this.state.monthlySpentUsd,reservedUsd:this.state.reservedUsd},
      policy:{dailyCloudUsd:this.policy.dailyCloudUsd,monthlyCloudUsd:this.policy.monthlyCloudUsd,maxCloudUsdPerTask:this.policy.maxCloudUsdPerTask,cloudEnabled:this.policy.cloudEnabled,maxAutonomousCloudCallsPer15m:this.policy.maxAutonomousCloudCallsPer15m},
      autonomousCloudCallsLast15m:(Array.isArray(this.state.autonomousCloudCalls)?this.state.autonomousCloudCalls:[]).filter(at=>Number.isFinite(at)&&at>Date.now()-15*60_000).length,
      billingVerification:'UNRECONCILED_ESTIMATE_FROM_PROVIDER_TOKENS_AND_CONFIGURED_OR_REFERENCE_RATE',
    };
  }
  // Fills the tally from the ledger once (history before the tally existed). Events at or after the cutoff are
  // counted live, so nothing is counted twice.
  async seedFromLedger(file,{fsImpl=fs}={}){
    const t=this.state.tally;if(t.seededAt||!file||!fsImpl.existsSync(file))return {seeded:false};
    const cutoff=nowIso();const readline=await import('node:readline');
    const since=new Date(Date.now()-45*86400e3).toISOString();
    const rows=[];
    const rl=readline.createInterface({input:fsImpl.createReadStream(file),crlfDelay:Infinity});
    for await(const line of rl){
      if(!line.includes('cloud.cost_settled')&&!line.includes('cloud.cost_expired'))continue;
      let e;try{e=JSON.parse(line)}catch{continue}
      if(e.type!=='cloud.cost_settled'&&e.type!=='cloud.cost_expired')continue;
      if(!(e.timestamp>=since&&e.timestamp<cutoff))continue;
      rows.push(e);
    }
    for(const e of rows){const d=e.data||{};const at=Date.parse(e.timestamp);
      if(e.type==='cloud.cost_settled')this.#book('settled',providerKey(d),{actualUsd:safeNumber(d.actualUsd,0),estimatedUsd:safeNumber(d.estimatedUsd,0),at});
      else this.#book('expired',providerKey(d),{estimatedUsd:safeNumber(d.countedUsd??d.estimatedUsd,0),at});}
    t.seededAt=cutoff;this.#persist();
    return {seeded:true,events:rows.length};
  }
  #persist(){this.state.updatedAt=nowIso();atomicWriteJson(this.stateFile,this.state);}
}


export { DEFAULT_POLICY as DEFAULT_ECONOMIC_POLICY };
