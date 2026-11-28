import {speechParts} from './speechParts.mjs';
import {extractWorkspaceActions,workspaceReplyText,STAGE_PANELS,STAGE_MOTIONS} from './workspaceActions.mjs';
export const PRESENTATION_TONES=Object.freeze(['neutral','warm','focused','concerned']);
export const PERFORMANCE_INSTRUCTION='For natural presentation, put an optional [[jaco:expression warm|focused|concerned|neutral]] on its own line immediately before the sentence it describes (choose one value, not the list). Put focus and motion directives immediately before the relevant spoken sentence. Use at most two focus/expression cues and one motion per answer, only when useful. Never use these inside examples or code. These cues describe presentation only, not feelings, facts, tool permissions or completion.';
// A speech plan is transient. A directive is a cue for the next spoken segment,
// never a shell action, free-form animation or permission to operate the device.
export function createPerformancePlan(raw,{allowStage=true,enabled=true}={}){
  const source=String(raw||'');
  const text=workspaceReplyText(source);
  const parts=[];
  let buffer=[],pending=[],fence=false,focusCount=0,toneCount=0,motionCount=0,total=0;
  function flush(){
    const spoken=speechParts(extractWorkspaceActions(buffer.join('\n')).text);
    buffer=[];
    if(!spoken.length)return;
    for(let i=0;i<spoken.length;i++)parts.push({text:spoken[i],cues:i===0?pending:[]});
    pending=[];
  }
  for(const line of source.split(/\r?\n/)){
    if(/^\s*```/.test(line)){fence=!fence;buffer.push(line);continue;}
    const match=!fence&&/^\s*\[\[jaco:(focus|motion|expression)\s+([a-z-]+)\]\]\s*$/i.exec(line);
    if(!match){buffer.push(line);continue;}
    flush();
    if(!enabled||total>=3)continue;
    const kind=match[1].toLowerCase(),value=match[2].toLowerCase();
    let cue=null;
    if(kind==='focus'&&allowStage&&STAGE_PANELS.includes(value)&&focusCount<2){focusCount++;cue={type:'focus',value};}
    if(kind==='motion'&&STAGE_MOTIONS.includes(value)&&motionCount<1){motionCount++;cue={type:'motion',value};}
    if(kind==='expression'&&PRESENTATION_TONES.includes(value)&&toneCount<2){toneCount++;cue={type:'expression',value};}
    if(cue){pending.push(cue);total++;}
  }
  flush();
  // A dangling cue has no corresponding spoken text. Never execute it.
  return {text,parts:parts.length?parts:speechParts(text).map(text=>({text,cues:[]}))};
}
const cache=new Map();
export function rememberPerformancePlan(id,raw,enabled=true){
  if(typeof id!=='string'||!id)return;
  cache.delete(id);cache.set(id,{plan:createPerformancePlan(raw,{allowStage:false,enabled}),at:Date.now()});
  while(cache.size>16)cache.delete(cache.keys().next().value);
}
export function takePerformancePlan(id,text){
  const entry=cache.get(id);cache.delete(id);
  if(entry&&Date.now()-entry.at<120000&&entry.plan.text===text)return entry.plan;
  return createPerformancePlan(text,{allowStage:false,enabled:false});
}
export function createCueGate(dispatch){
  let generation=0,seen=new Set();
  return {begin(){seen=new Set();return ++generation;},cancel(){generation++;seen.clear();},
    play(token,index,cues){
      if(token!==generation||seen.has(index)||!Number.isInteger(index)||index<0)return false;
      seen.add(index);for(const cue of cues||[])dispatch(cue);return true;
    }};
}
