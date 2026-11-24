import { TargetTractionEngine } from '../../runtime/src/server/nova/tractionCore.mjs';

// Shared browser-side identity. Deliberately excludes form values and secret-bearing attributes.
export const DOM_IDENTITY_FN = String.raw`function(){const e=this;return {text:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.name||'').trim().replace(/\s+/g,' ').slice(0,100),role:(e.getAttribute('role')||e.tagName.toLowerCase()).toLowerCase()};}`;
// Picks the one visible page element a model means by a name. Models quote a link from memory ("Learn more" for a
// page whose link reads "More information..."), so an exact match alone failed with NO_TARGET and the model had no way
// to correct itself. Exact (ignoring case, spacing and a trailing ellipsis) first; then a unique partial match; and when
// nothing fits, the names that ARE on the page come back with the error.
const normal = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.…:;,!?]+$/g, '').trim();

export function pickTarget(targets, name) {
  const wanted = normal(name);
  const visible = (Array.isArray(targets) ? targets : []).filter(t => t?.visible && normal(t.text));
  const available = [...new Set(visible.map(t => String(t.text).replace(/\s+/g, ' ').trim().slice(0, 80)))].slice(0, 15);
  if (!wanted) return { error: 'NO_TARGET', available };
  const exact = visible.filter(t => normal(t.text) === wanted);
  if (exact.length === 1) return { target: exact[0], matched: 'exact' };
  if (exact.length > 1) return { error: 'AMBIGUOUS_TARGET', available };
  const partial = visible.filter(t => normal(t.text).includes(wanted) || (normal(t.text).length >= 4 && wanted.includes(normal(t.text))));
  if (partial.length === 1) return { target: partial[0], matched: 'partial' };
  // A model sometimes describes the element instead of naming it ("click the link"). When the description names a
  // kind and the page has exactly one visible element of that kind, that is the one it means (2026-11-07: a
  // mission gave up and answered wrongly after "click the link" on a page with a single link).
  const kind = /\b(?:link|länk(?:en)?)\b/.test(wanted) ? ['a', 'link'] : /\b(?:button|knapp(?:en)?)\b/.test(wanted) ? ['button'] : null;
  if (!partial.length && kind) {
    const ofKind = visible.filter(t => kind.includes(String(t.role || '').toLowerCase()));
    if (ofKind.length === 1) return { target: ofKind[0], matched: 'only-one-of-kind' };
  }
  return { error: partial.length ? 'AMBIGUOUS_TARGET' : 'NO_TARGET', available };
}


// Target Track's browser/CDP adapter acquires and re-identifies live semantic targets.
// Saved routes are hypotheses: the current CDP observations must independently resolve the same semantic object.
export async function trackDomTarget(observe,name,{roles=null,now=Date.now}={}){
  const refusal=(error,available=[])=>({ok:false,verified:false,outcomeUnknown:false,error,available,domTraction:{engine:'Target Track',state:'REIDENTIFYING'}});
  const candidates=page=>(page.targets||[]).filter(t=>!roles||roles.includes(t.role));
  const usable=page=>{const age=now()-Date.parse(page?.at||'');return page?.ok===true&&typeof page.url==='string'&&page.url&&Array.isArray(page.targets)&&Number.isFinite(age)&&age>=0&&age<=5000;};
  let first,second;
  try{first=await observe();}catch{return refusal('DOM_OBSERVATION_FAILED');}
  if(!usable(first))return refusal('DOM_OBSERVATION_STALE_OR_UNAVAILABLE');
  const initial=pickTarget(candidates(first),name);
  if(!initial.target)return refusal(initial.error,initial.available);
  const engine=new TargetTractionEngine();
  const app=JSON.stringify([first.url,first.targetId||null]);
  engine.beginIntent(String(name),'input receipt');
  engine.acquireTarget({semanticPurpose:String(name),text:initial.target.text,role:initial.target.role,bbox:initial.target.bbox,confidence:1,source:'dom'});
  engine.observe({app,timestamp:first.at,semanticTargets:[{...initial.target,confidence:1}]});
  try{second=await observe();}catch{return refusal('DOM_OBSERVATION_FAILED');}
  if(!usable(second))return refusal('DOM_OBSERVATION_STALE_OR_UNAVAILABLE');
  if(first.url!==second.url||first.targetId!==second.targetId)return refusal('DOM_TARGET_PAGE_CHANGED');
  const current=pickTarget(candidates(second),name);
  if(!current.target)return refusal(current.error,current.available);
  if(normal(initial.target.text)!==normal(current.target.text)||initial.target.role!==current.target.role||typeof current.target.selector!=='string'||!current.target.selector)return refusal('DOM_TARGET_IDENTITY_CHANGED');
  // Do not confuse a selector change with a lost target: a DOM insertion may move the same unique control.
  const lock=engine.observe({app,timestamp:second.at,semanticTargets:[{...current.target,confidence:1}]});
  if(lock.state!=='LOCKED'||engine.beforeAction('browser-input').state!=='VERIFYING')return refusal('DOM_TARGET_LOCK_LOST');
  return {ok:true,target:current.target,url:second.url,targetId:second.targetId,traction:{engine:'Target Track',trackId:lock.trackId,state:lock.state,reidentified:initial.target.selector!==current.target.selector,observedAt:second.at,matched:current.matched,drift:lock.drift}};
}
