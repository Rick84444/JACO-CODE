// Existing clock + Nova queue + Continuum memory; no new scheduler or store.
export const COMMERCIAL_CLOCK = 'Autonomi-klocka företagande';
export const COMMERCIAL_SOURCE = 'aura-commercial-clock';
export const COMMERCIAL_SKILL = 'commercial-opportunity-cycle';
export const COMMERCIAL_TASKS = Object.freeze(['health-check','web-fetch','mcp-call','mcp-write','skill-load']);
const HOUR = 3600000;
export function commercialAuthorized(mission, mandates, operator, task=null, capabilities=null) {
  if (mission?.source !== COMMERCIAL_SOURCE) return true;
  const id = mission.metadata?.mandateId;
  const mandate = mandates.get(id);
  const state = operator.snapshot();
  return Boolean(mandate?.name === COMMERCIAL_CLOCK && mandates.isActive(id) &&
    state.mode === 'RUNNING' && !state.emergencyLatched && mandate.decisions?.READ === 'ALLOW' &&
    (!capabilities || capabilities.isSkillEnabled(COMMERCIAL_SKILL)) &&
    (task?.type !== 'mcp-write' || mandate.decisions?.EXTERNAL_MUTATION === 'ALLOW'));
}
export function commercialTaskAllowed(task) {
  if (!COMMERCIAL_TASKS.includes(task?.type)) return false;
  if (task.type === 'skill-load') return [COMMERCIAL_SKILL,'external-agent-employment','buyer-tailored-proposal'].includes(task.data?.id);
  if (task.type !== 'mcp-call' && task.type !== 'mcp-write') return true;
  const server = task.data?.server, raw = String(task.data?.tool || '');
  const name = raw.startsWith(server + '.') ? raw.slice(server.length + 1) : raw;
  if (task.type === 'mcp-write') return server === 'agentgigs' && name === 'apply';
  return (server === 'jobbi' && ['list_gigs','get_gig','list_sources'].includes(name)) ||
    (server === 'frantic' && ['read_board','get_bounty','get_agent_status','read_ledger'].includes(name)) ||
    (server === 'agentgigs' && ['list_available','job_status','list_attempted','list_applications','estimate_payout'].includes(name));
}
export function seedCommercialKnowledge(knowledge) {
  const id = 'commercial-opportunity-policy-v1';
  try { const existing=knowledge.get(id); if(existing.implementation?.version===2)return existing; } catch (e) { if(!String(e.message).includes('not found')) throw e; }
  return knowledge.put({id,kind:'commercial-procedure',purpose:'Find funded, lawful, profitable work for Aura within an explicitly signed commercial clock.',
    reusable:true,confidence:0,verificationStatus:'UNVERIFIED',dependencies:['RevenueOpportunityEngine','EconomicGovernor','Nova','external-agent-employment'],
    reasoningSummary:'Policy, not proven profitability. Start with existing means and affordable loss; check demand, free alternatives, AI permission, assignment, fees, downside, time to cash and capacity. Compare estimated contribution per total hour and prioritize funded obligations. Verify delivery and payment separately; never credit listing rewards, proposals or provider aggregates.',
    failureModes:['unfunded application','ambiguous write','fees exceed reward','expired mandate','unverified payout'],
    implementation:{skill:COMMERCIAL_SKILL,source:COMMERCIAL_SOURCE,version:2}},'operator-commercial-policy');
}
// Versioned procedural knowledge: not verified market outcomes or a capability grant.
export function seedCommercialOperatorKnowledge(knowledge) {
  const id = 'commercial-operator-knowledge-v2';
  try { return knowledge.get(id); } catch (e) { if(!String(e.message).includes('not found')) throw e; }
  return knowledge.put({id,kind:'commercial-procedure',
    purpose:'Prioritize external user outcomes, funded demand, low irreversible cost and independently verified paid delivery.',
    confidence:0,verificationStatus:'UNVERIFIED',reusable:true,
    dependencies:['RevenueOpportunityEngine','EconomicGovernor','Nova','commercial-opportunity-cycle'],
    reasoningSummary:'Demand before building; compare free alternatives; rank probability-adjusted contribution, effort and collection time. Distinguish market signal, qualified buyer, assignment, accepted delivery and settlement. Product activation is separate from revenue. Follow channel rules; no unsupported performance claims. Record falsifiers and actual receipts; no unknown values treated as success.',
    failureModes:['speculative feature work','unverified buyer','unsupported benchmark claim','prohibited outreach','unapproved spend','uncollected revenue'],
    implementation:{skill:COMMERCIAL_SKILL,relatedOperatorSkill:'product-validation',reference:'docs/commercial/operating-knowledge-v2.md'}},'operator-commercial-policy');
}
export function reconcileCommercialClock({mandates,operator,bus,nova,knowledge,capabilities,now=Date.now()}) {
  const clocks = mandates.list().filter(m=>m.name===COMMERCIAL_CLOCK && mandates.isActive(m.id));
  const m = clocks.sort((a,b)=>Date.parse(b.signedAt)-Date.parse(a.signedAt))[0];
  const state=operator.snapshot();
  if(!m || state.mode!=='RUNNING' || state.emergencyLatched) return {state:'INACTIVE'};
  if(!Number.isFinite(Date.parse(m.signedAt)) || m.decisions?.READ!=='ALLOW') return {state:'INVALID_MANDATE'};
  if(capabilities && !capabilities.isSkillEnabled(COMMERCIAL_SKILL)) return {state:'SKILL_DISABLED'};
  const slot=Math.floor((now-Date.parse(m.signedAt))/HOUR);
  if(slot<0 || now>=Date.parse(m.expiresAt)) return {state:'INACTIVE'};
  const missions=bus.listMissions(500);
  const history=missions.filter(x=>x.source===COMMERCIAL_SOURCE);
  // Expired windows cannot claim or begin; only cancel cleanly stopped missions. Preserve uncertain writes.
  for(const old of history.filter(x=>x.metadata?.mandateId!==m.id && x.status==='ACTIVE')){
    const detail=nova.get(old.id);
    if(!detail.hasUncertainOutcome && !detail.activeTask && !detail.pendingOperatorAction && !detail.spendApprovalPending) nova.requestCancel(old.id,'Previous commercial clock expired');
  }
  const unresolved=history.filter(x=>x.metadata?.mandateId===m.id && !['DONE','CANCELLED'].includes(x.status));
  const active=unresolved.find(x=>x.status==='ACTIVE');
  if(active) return {state:'OUTSTANDING',missionId:active.id};
  // A pending decision must not halt independent read-only commercial work or grant new writes.
  const readOnly=unresolved.length>0;
  if(nova.current()) return {state:'OTHER_WORK_ACTIVE'};
  const recent=history.find(x=>x.metadata?.mandateId===m.id);
  if(recent && now-Date.parse(recent.createdAt)<HOUR) return {state:'COOLDOWN'};
  seedCommercialKnowledge(knowledge);
  seedCommercialOperatorKnowledge(knowledge);
  const allowedTasks=COMMERCIAL_TASKS.filter(t=>t!=='mcp-write' || m.decisions?.EXTERNAL_MUTATION==='ALLOW').filter(t=>!capabilities || capabilities.isTaskEnabled(t));
  if(!allowedTasks.includes('mcp-call') || !allowedTasks.includes('skill-load')) return {state:'REQUIRED_TOOLS_DISABLED'};
  const recall=knowledge.list({kind:'commercial-outcome',limit:1000}).sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,5).map(k=>({missionId:k.implementation?.missionId,status:k.implementation?.status,applications:k.implementation?.applications||[],verifiedReceipts:k.metrics?.verifiedReceipts||0}));
  const goal='Skill '+COMMERCIAL_SKILL+': run one bounded evidence-led revenue opportunity cycle before the signed clock expires. Find or reconcile paid AI-agent and human buyer work; verify original source and estimate payout before recommending; no outgoing spend, do not accept new legal terms or binding financial obligations without operator review. Review previous attempts before discovery. Read-only work can continue when marketplace credentials are missing. Record observations, IDs, blockers and next action, never invented earnings. Clock '+m.id+' cycle '+slot+'. Prior observations (unverified, recheck live): '+JSON.stringify(recall).slice(0,3000);
  const result=nova.create({goal,source:COMMERCIAL_SOURCE,mandateId:m.id,idempotencyKey:'commercial-clock:'+m.id+':'+slot,allowedTasks});
  if(result.source!==COMMERCIAL_SOURCE || result.metadata?.mandateId!==m.id) return {state:'DEDUPLICATED_OTHER_WORK',missionId:result.id};
  return {state:'QUEUED',missionId:result.id,mandateId:m.id};
}
export function archiveCommercialOutcome({mission,nova,knowledge}) {
  if(mission.source!==COMMERCIAL_SOURCE || !['DONE','CANCELLED'].includes(mission.status)) return null;
  const id='commercial-outcome-'+mission.id;
  try { knowledge.get(id); return null; } catch(e){if(!String(e.message).includes('not found')) throw e;}
  const receipts=nova.evidenceReceipts(mission.id);
  const applications=[],quotes=[],deliveries=[];
  const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for(const r of receipts){
    const result=r.result||r; // Nova's actual receipt envelope, legacy top-level accepted for older records.
    if(r.ok!==true||r.verified!==true||result.truncated||result.server!=='agentgigs')continue;
    const name=String(result.tool).replace(/^agentgigs\./,'');
    if(r.input?.server && (r.input.server!==result.server || String(r.input.tool).replace(/^agentgigs\./,'')!==name))continue;
    try {
      const x=JSON.parse(result.output);
      if(['job_status','list_applications','apply'].includes(name)){
        const rows=Array.isArray(x.applications)?x.applications:[{job_id:x.job_id||x.job?.id,status:x.application?.status,proposed_price:x.application?.proposed_price,job_status:x.job?.status}];
        for(const row of rows){if(!idPattern.test(row?.job_id||''))continue;
          const status=['pending','accepted','funded','rejected'].includes(row.status)?row.status:'unknown';
          applications.push({job_id:row.job_id,status,proposed_price:Number.isSafeInteger(row.proposed_price)?row.proposed_price:null});
        }
      }
      if(name==='quote_economics'&&x.settlement_verified===false&&Number.isSafeInteger(x.expected_contribution_cents)&&Number.isSafeInteger(x.expected_cents_per_hour)&&Number.isSafeInteger(x.price_cents)&&x.price_cents>0){
        quotes.push({price_cents:x.price_cents,expected_contribution_cents:x.expected_contribution_cents,expected_cents_per_hour:x.expected_cents_per_hour,settled:false});
      }
      if(name==='deliver_staged_text'&&idPattern.test(x.job_id||'')&&x.submitted===true&&x.settlement_verified===false&&['delivered','pending_proof','completed'].includes(x.status)){
        deliveries.push({job_id:x.job_id,status:x.status,settled:false});
      }
    }catch{/* transport receipt is not proof of marketplace or payment truth */}
  }
  return knowledge.put({id,kind:'commercial-outcome',purpose:'Observed commercial mission outcome '+mission.status,
    confidence:0,verificationStatus:'UNVERIFIED',reusable:false,usedIn:[mission.id],
    reasoningSummary:'Mission state, receipt-indexed proposals, forecast contribution and observed delivery metadata only; never settled revenue. Independent provider evidence is required.',
    metrics:{receipts:receipts.length,verifiedReceipts:receipts.filter(r=>r.ok===true&&r.verified===true).length},
    implementation:{missionId:mission.id,status:mission.status,applications:applications.slice(-20),quotes:quotes.slice(-10),deliveries:deliveries.slice(-10),receiptIds:receipts.map(r=>String(r.actionId)).slice(-100)}},'commercial-outcome');
}

// Durable mission rows are the retry source, not the unrelated learned marker.
export function archiveCommercialBatch({bus,nova,knowledge,after='',limit=50,onError=()=>{}}) {
  const rows=bus.listTerminalMissionsBySource(COMMERCIAL_SOURCE,after,limit);
  for(const base of rows){
    try { archiveCommercialOutcome({mission:nova.get(base.id),nova,knowledge}); }
    catch(error){onError(error,base.id);}
  }
  return rows.length>=limit?rows[rows.length-1].id:'';
}
