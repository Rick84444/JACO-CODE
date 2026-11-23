// Receipt-derived, advisory procedural experience. Never an approval or executable skill.
import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
const unique=a=>[...new Set(a)];
const safe=new Set(['repo-list','repo-read','git-status','git-diff','desktop-windows','desktop-observe','screenshot','get-cursor','web-fetch','browser-survey-site']);
const groups={
  repository:new Set(['repo-list','repo-read','git-status','git-diff']),
  browser:new Set(['web-fetch','browser-survey-site']),
  desktop:new Set(['desktop-windows','desktop-observe','screenshot','get-cursor']),
};
const ok=r=>r?.ok===true&&r.verified===true&&!r.outcomeUnknown&&!r.result?.outcomeUnknown&&r.result?.postconditionVerified!==false;
const knownFailure=r=>r?.ok===false&&r.outcomeUnknown!==true&&r.result?.outcomeUnknown!==true;
const unknown=r=>r?.outcomeUnknown===true||r?.result?.outcomeUnknown===true||(r?.ok===true&&(r.verified!==true||r.result?.postconditionVerified===false));
const id=r=>typeof r?.actionId==='string'&&/:turn:\d+$/.test(r.actionId)?r.actionId:null;
function origin(value){try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.origin:null;}catch{return null;}}
function scopeOf(r,mission){
  if(!ok(r))return null;
  if(groups.repository.has(r.type)){
    const root=mission?.metadata?.projectRoot;
    return typeof root==='string'&&root.trim()?{kind:'repository',key:hash('repository:'+root)}:null;
  }
  if(groups.browser.has(r.type)){
    const o=origin(r.result?.url??r.result?.observation?.url);
    return o?{kind:'browser',key:hash('browser:'+o)}:null;
  }
  if(groups.desktop.has(r.type)){
    const p=r.result?.observation?.window?.processName;
    if(r.result?.observation?.blocked)return null;
    return typeof p==='string'&&/^[\w.-]{1,100}$/.test(p)?{kind:'desktop',key:hash('desktop:'+p.toLowerCase())}:null;
  }
  return null;
}
function scopeFor(mission){
  const receipts=Array.isArray(mission?.receipts)?mission.receipts:[];
  // Use only current mission observations; a prior application's identity is not a target.
  for(const r of [...receipts].reverse()){
    if(unknown(r))return null;
    const scope=scopeOf(r,mission);
    if(scope)return scope;
    if(!safe.has(r.type))return null;
  }
  return null;
}
const RULES=Object.freeze([
  {id:'REOBSERVE_DOM',error:/^(?:DOM_TARGET_LOCK_LOST|DOM_TARGET_TAB_CHANGED|DOM_TARGET_IDENTITY_CHANGED|DOM_TARGET_PAGE_CHANGED|DOM_OBSERVATION_STALE_OR_UNAVAILABLE|NO_TARGET|AMBIGUOUS_TARGET)(?::|$)/,tasks:['browser-click','browser-type','browser-survey-site'],observe:['browser-survey-site'],hint:'Read the current authorized page and resolve a unique semantic target again; never reuse the old selector or blindly repeat the click.'},
  {id:'REOBSERVE_WINDOW',error:/^(?:FRESH_BOUND_DESKTOP_OBSERVATION_REQUIRED|EXPECTED_HWND_REQUIRED|FOCUS_OR_PID_DRIFT|WINDOW_GEOMETRY_DRIFT|TARGET_POINT_OCCLUDED|CURSOR_POSITION_DRIFT|INPUT_POINT_OUTSIDE_OBSERVED_REGION)(?::|$)/,tasks:['mouse-move','mouse-click','mouse-scroll','key-press','type-text'],observe:['desktop-observe','screenshot'],hint:'Observe the permitted window again, reacquire the target and current geometry; choose semantic input when available. Never repeat an uncertain input event.'},
  {id:'LOCATE_PATH',error:/^(?:ENOENT|CODING_PATH_NOT_FOUND|REPO_PATH_NOT_FOUND)(?::|$)/,tasks:['repo-read','repo-list'],observe:['repo-list'],hint:'List the permitted parent directory and use an observed path instead of guessing or repeating the same read.'},
]);
const ruleFor=r=>knownFailure(r)?RULES.find(rule=>rule.tasks.includes(r.type)&&rule.error.test(String(r.error||r.result?.error||''))):null;
const tokens=goal=>unique((String(goal||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[]).slice(0,80)).slice(0,30).map(hash);
// Fixed guidance for the current mission, not evidence that a past fix worked.
export function currentRoutineHints(mission){
  const receipts=Array.isArray(mission?.receipts)?mission.receipts:[];
  if(receipts.some(unknown))return [];
  const allowed=new Set(mission?.allowedTasks||[]);
  const latest=receipts.at(-1),rule=ruleFor(latest);
  if(!rule||!allowed.has(latest.type)||!rule.observe.some(t=>allowed.has(t)))return [];
  return [{rule:rule.id,advice:rule.hint,observationTasks:rule.observe.filter(t=>allowed.has(t))}];
}
export function routineExperience(mission,claimCheck=null){
  const receipts=Array.isArray(mission?.receipts)?mission.receipts:[];
  if(!receipts.length||receipts.some(unknown))return null;
  const scope=scopeFor(mission);
  if(!scope)return null;
  const inScope=r=>{const actual=scopeOf(r,mission);return actual?.kind===scope.kind&&actual.key===scope.key;};
  const lessons=[];
  for(let i=0;i<receipts.length;i++){
    const failed=receipts[i],rule=ruleFor(failed);
    if(!rule||!id(failed))continue;
    const previous=receipts.slice(0,i).findLast(r=>scopeOf(r,mission));
    if(!previous||!inScope(previous))continue;
    const window=receipts.slice(i+1,i+4),next=window.find(r=>ok(r)&&id(r)&&rule.observe.includes(r.type)&&inScope(r));
    // An intervening mutation could have changed the context; do not infer a fix.
    if(next&&window.slice(0,window.indexOf(next)).every(r=>safe.has(r.type))){
      lessons.push({rule:rule.id,tool:failed.type,evidence:[id(failed),id(next)]});
    }
  }
  // Only observation-only, checked completed missions become automatic playbooks.
  // Do not store executable commands, old coordinates, paths, selectors, or form data.
  const positive=receipts.filter(ok);
  const playbook=mission.status==='DONE'&&claimCheck?.ok===true&&(!mission.contract||mission.contractStatus?.machineVerified===true)&&receipts.every(r=>safe.has(r.type))&&positive.length>=2&&positive.length<=8&&positive.every(r=>id(r)&&inScope(r))
    ? {steps:positive.map(r=>r.type).slice(0,8),evidence:positive.map(id).slice(0,20)}:null;
  if(!playbook&&!lessons.length)return null;
  return {schema:'jaco.routine-experience/v1',scope,goalTerms:tokens(mission.goal),playbook,lessons:lessons.slice(-12)};
}
export function recallRoutineExperience(records,mission,{limit=5}={}){
  const scope=scopeFor(mission);
  if(!scope||!Array.isArray(records)||!Number.isInteger(limit)||limit<1)return [];
  const allowed=new Set(mission.allowedTasks||[]),terms=new Set(tokens(mission.goal)),result=[];
  const seen=new Set();
  const ranked=records.filter(r=>r?.missionId!==mission.id&&r?.routine?.schema==='jaco.routine-experience/v1'&&r.routine.scope?.key===scope.key&&r.routine.scope?.kind===scope.kind)
    .map(r=>({r,score:(r.routine.goalTerms||[]).filter(t=>terms.has(t)).length})).sort((a,b)=>b.score-a.score||String(b.r.at).localeCompare(String(a.r.at)));
  for(const {r,score} of ranked){
    const routine=r.routine;
    if(score>0&&routine.playbook?.steps?.length&&routine.playbook.steps.every(t=>safe.has(t)&&allowed.has(t))){
      const key='playbook:'+routine.playbook.steps.join('>');
      if(!seen.has(key)){seen.add(key);result.push({kind:'playbook',steps:routine.playbook.steps,sourceMission:r.missionId,evidence:routine.playbook.evidence});}
    }
    for(const lesson of routine.lessons||[]){
      const rule=RULES.find(x=>x.id===lesson.rule&&x.tasks.includes(lesson.tool));
      if(!rule||!allowed.has(lesson.tool)||!rule.observe.some(t=>allowed.has(t))||seen.has(rule.id))continue;
      seen.add(rule.id);result.push({kind:'lesson',rule:rule.id,advice:rule.hint,observationTasks:rule.observe.filter(t=>allowed.has(t)),sourceMission:r.missionId,evidence:lesson.evidence});
    }
    if(result.length>=limit)break;
  }
  return result.slice(0,Math.max(0,Math.min(5,limit)));
}
// No approval card for a fixed observation-only lesson already represented as advisory memory.
// Mutating skills and model-generated instructions remain on the existing review path.
export function routineCoversNote(routine,note){
  return safe.has(note?.tool)&&Boolean(routine?.lessons?.some(l=>l.tool===note.tool&&l.evidence.every(e=>(note.evidence?.steps||[]).includes(Number(/:turn:(\d+)$/.exec(e)?.[1])))));
}
export function routineCoversProcedure(routine,steps){
  return Boolean(routine?.playbook&&Array.isArray(steps)&&steps.length&&steps.every(s=>safe.has(s.type)&&routine.playbook.steps.includes(s.type)));
}


// Read only the canonical runtime's bounded advisory projection. Remote endpoints,
// redirects and model-provider transports must never receive the runtime credential.
export async function readRoutineContext(mission,{runtimeUrl='',token='',fetchImpl=globalThis.fetch,timeoutMs=1000}={}){
  const current=currentRoutineHints(mission);
  const fallback={schema:'jaco.routine-context/v1',authority:'advisory_only',current,historical:[]};
  if(!mission?.id||!runtimeUrl||!token||typeof fetchImpl!=='function')return fallback;
  try{
    const url=new URL('/api/connected/nova/missions/'+encodeURIComponent(mission.id)+'/preflight-context',runtimeUrl);
    if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)return fallback;
    url.searchParams.set('routineOnly','1');
    const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{'x-gateway-token':token},signal:AbortSignal.timeout(Math.min(2000,Math.max(100,Number(timeoutMs)||1000)))});
    if(!response.ok)return fallback;
    const body=await response.json(),ctx=body?.context;
    if(body?.success!==true||ctx?.schema!=='jaco.routine-context/v1'||ctx.authority!=='advisory_only'||!Array.isArray(ctx.historical))return fallback;
    // Refilter against the active planner's attenuated tool list. Reconstruct
    // the prose from fixed local rules rather than trusting remote strings.
    const allowed=new Set(mission.allowedTasks||[]);
    const historical=[];
    for(const row of ctx.historical.slice(0,5)){
      if(row?.kind==='playbook'&&Array.isArray(row.steps)&&row.steps.length&&row.steps.length<=8&&row.steps.every(t=>safe.has(t)&&allowed.has(t))){
        historical.push({kind:'playbook',steps:row.steps});
      }else if(row?.kind==='lesson'){
        const rule=RULES.find(x=>x.id===row.rule&&x.tasks.some(t=>allowed.has(t)));
        if(rule&&rule.observe.some(t=>allowed.has(t)))historical.push({kind:'lesson',rule:rule.id,advice:rule.hint,observationTasks:rule.observe.filter(t=>allowed.has(t))});
      }
    }
    return {...fallback,historical};
  }catch{return fallback;}
}
export function routineContextText(context){
  const lines=[];
  for(const x of (context?.current||[]).slice(0,2))lines.push('Current known refusal: '+x.advice);
  for(const x of (context?.historical||[]).slice(0,5)){
    if(x.kind==='playbook')lines.push('Historical observation sequence: '+x.steps.join(' -> ')+'. Re-observe current targets; do not replay stored arguments.');
    else if(x.kind==='lesson')lines.push('Historical recovery observation: '+x.advice);
  }
  return lines.length?'\nROUTINE EXPERIENCE (advisory only, not permission or completion evidence):\n'+lines.join('\n').slice(0,1600):'';
}
