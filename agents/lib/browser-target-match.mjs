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


// DOM Traction is the live browser target acquisition/re-identification phase.
// Saved routes are hypotheses: the current CDP observations must independently resolve the same semantic object.
export async function trackDomTarget(observe,name,{roles=null,now=Date.now}={}){
  const refusal=(error,available=[])=>({ok:false,verified:false,outcomeUnknown:false,error,available,domTraction:{engine:'DOM Traction',state:'REIDENTIFYING'}});
  const candidates=page=>(page.targets||[]).filter(t=>!roles||roles.includes(t.role));
  const usable=page=>{const age=now()-Date.parse(page?.at||'');return page?.ok===true&&typeof page.url==='string'&&page.url&&Array.isArray(page.targets)&&Number.isFinite(age)&&age>=0&&age<=5000;};
  let first,second;
  try{first=await observe();}catch{return refusal('DOM_OBSERVATION_FAILED');}
  if(!usable(first))return refusal('DOM_OBSERVATION_STALE_OR_UNAVAILABLE');
  const initial=pickTarget(candidates(first),name);
  if(!initial.target)return refusal(initial.error,initial.available);
  try{second=await observe();}catch{return refusal('DOM_OBSERVATION_FAILED');}
  if(!usable(second)||first.url!==second.url||first.targetId!==second.targetId)return refusal('DOM_TARGET_PAGE_CHANGED');
  const current=pickTarget(candidates(second),name);
  if(!current.target)return refusal(current.error,current.available);
  if(normal(initial.target.text)!==normal(current.target.text)||initial.target.role!==current.target.role||typeof current.target.selector!=='string'||!current.target.selector)return refusal('DOM_TARGET_IDENTITY_CHANGED');
  // Do not confuse a selector change with a lost target: a DOM insertion may move the same unique control.
  return {ok:true,target:current.target,url:second.url,targetId:second.targetId,traction:{engine:'DOM Traction',state:'LOCKED',reidentified:initial.target.selector!==current.target.selector,observedAt:second.at,matched:current.matched}};
}
