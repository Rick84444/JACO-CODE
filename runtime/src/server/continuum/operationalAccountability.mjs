/**
 * Evidence-bound, read-only accountability projection. Never grants READY.
 * Historical penalties are derived from the canonical validated event ledger.
 */
const FAILURES = Object.freeze({
  'cycle.bridge_unknown':'execution',
  'lease.action_unknown':'execution',
  'lease.recovered_unknown_outcomes':'execution',
  'runtime.startup_failed':'startup',
  'runtime.startup_invalid':'startup',
  'runtime.calculation_invalid':'calculation',
  'runtime.integration_failed':'integration',
});
const short = v => typeof v === 'string' ? v.slice(0,160) : null;

export function assessOperationalAccountability({events=[],integrity=null,operator=null,leases=[]}={}) {
  if(!Array.isArray(events)||!Array.isArray(leases))throw Error('ACCOUNTABILITY_SOURCE_INVALID');
  const complete=integrity?.valid===true && integrity.count===events.length;
  const categories={startup:0,calculation:0,integration:0,execution:0};
  const incidents=[],seen=new Set();
  for(const event of events){
    const category=FAILURES[event?.type];
    if(!category || event.stream==='simulation' || event.data?.simulation==='DETERMINISTIC')continue;
    const operation=short(event.data?.operationId ?? event.entityId);
    const key=category==='execution' && operation?'execution:'+operation:'event:'+String(event.sequence);
    if(seen.has(key))continue;
    seen.add(key);categories[category]++;
    incidents.push({sequence:event.sequence??null,at:event.timestamp??null,
      category,eventType:event.type,operationId:operation,evidenceHash:short(event.hash)});
  }
  const unresolved=[];
  for(const lease of leases)for(const op of Object.values(lease?.operations??{})){
    if(op?.status==='UNKNOWN_OUTCOME')unresolved.push({leaseId:short(lease.id),operationId:short(op.operationId)});
  }
  const blockers=[
    ...(!complete?['EVENT_LEDGER_UNVERIFIED']:[]),
    ...(operator?.emergencyLatched===true?['EMERGENCY_STOP_LATCHED']:operator?.mode!=='RUNNING'?['OPERATOR_NOT_RUNNING']:[]),
    ...(unresolved.length?['UNRECONCILED_EXECUTION_OUTCOME']:[])
  ];
  return {schema:'jaco.continuum.operational-accountability.v1',source:'CANONICAL_EVENT_LEDGER',
    readiness:blockers.length?'BLOCKED':'NOT_VERIFIED',ready:false,
    reasons:blockers.length?blockers:['SYSTEM_STARTUP_PROBE_NOT_PROVIDED'],
    historicalPenaltyUnits:complete?incidents.length:null,
    categories:complete?categories:null,
    unresolvedCount:unresolved.length,unresolved:unresolved.slice(0,20),
    lastIncidents:complete?incidents.slice(-20):[],
    coverage:{eventCount:Number.isSafeInteger(integrity?.count)?integrity.count:null,
      returnedEvents:events.length,complete},
    evidence:{ledgerValid:complete,headHash:short(integrity?.headHash)},
    limits:['DOES_NOT_PROVE_DEVICE_READINESS','ONLY_INSTRUMENTED_FAILURES_ARE_COUNTED','EVENT_HISTORY_IS_NOT_EXTERNALLY_ANCHORED']};
}
