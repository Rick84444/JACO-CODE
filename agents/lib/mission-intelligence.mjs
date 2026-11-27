// Read-only metrics derived from the canonical mission reflection journal.
// No authority, raw tool arguments, goals, credentials or inferred success.
export function summarizeMissionOutcomes(records,{scopeKey,revision}={}){
  if(typeof scopeKey!=='string'||! /^[a-f0-9]{64}$/.test(scopeKey))throw new TypeError('VALID_SCOPE_REQUIRED');
  if(!Array.isArray(records))throw new TypeError('RECORDS_REQUIRED');
  const latest=new Map();
  let duplicates=0,invalid=0;
  for(const row of records){
    if(row?.scopeKey!==scopeKey)continue;
    if(row.schema!=='jaco.mission-reflection/v1'||typeof row.missionId!=='string'||!row.missionId||!Number.isFinite(Date.parse(row.at))){invalid++;continue;}
    const old=latest.get(row.missionId);
    if(old){duplicates++; if(Date.parse(row.at)<=Date.parse(old.at))continue;}
    latest.set(row.missionId,row);
  }
  const counts={verified:0,stale:0,unverified:0,failed:0,other:0};
  let unresolved=0,withEvidence=0;
  for(const row of latest.values()){
    const unknown=Array.isArray(row.unexpected)&&row.unexpected.length>0;
    const evidence=Array.isArray(row.evidence)&&row.evidence.some(x=>typeof x==='string'&&x.length>0);
    if(unknown)unresolved++;
    if(evidence)withEvidence++;
    if(row.status==='DONE'){
      if(row.verificationStatus==='VERIFIED'&&!unknown&&evidence){
        if(typeof revision==='string'&&revision&&row.repositoryRevision===revision)counts.verified++;
        else if(row.repositoryRevision&&revision&&row.repositoryRevision!==revision)counts.stale++;
        else counts.unverified++;
      }else counts.unverified++;
    }else if(row.status==='FAILED')counts.failed++;
    else counts.other++;
  }
  const total=latest.size;
  return {schema:'jaco.mission-intelligence/v1',authority:'advisory_only',total,counts,unresolved,withEvidence,duplicates,invalid,
    verifiedFraction:total?counts.verified/total:null,
    denominator:'unique scoped mission reflections; not all executions or product readiness',
    revisionMatchedOnly:true};
}
