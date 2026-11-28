// Audio-clock driven facial speech. HeadAudio is vendored at a pinned revision.
export const VISEMES=Object.freeze(['viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U','viseme_PP','viseme_SS','viseme_TH','viseme_DD','viseme_FF','viseme_kk','viseme_nn','viseme_RR','viseme_CH']);
export const SILENCE=14;
export const FRAME_SECONDS=.016;
const clamp=(n,lo=0,hi=1)=>Number.isFinite(n)?Math.min(hi,Math.max(lo,n)):lo;
const jaw=[.19,.10,.045,.12,.065,0,.035,.045,.045,.025,.085,.035,.07,.07,0];
const gain=[.78,.76,.76,.78,.76,.90,.70,.70,.70,.80,.72,.72,.72,.70,0];
export const emptySpeechPose=()=>({weights:new Float32Array(14),jaw:0,close:0,press:0,level:0});
export function validSpeechTimeline(t){
  return !!t&&t.ids instanceof Uint8Array&&t.levels instanceof Float32Array&&t.ids.length===t.levels.length&&t.ids.length>0&&t.ids.length<=3000&&Number.isFinite(t.duration)&&t.duration>0&&t.duration<=45;
}
// Sample from the actual media clock, not frame count, wall clock or text timing.
// Short crossfades implement coarticulation; lip closure has precedence over jaw opening.
export function sampleSpeechPose(t,seconds,out=emptySpeechPose()){
  out.weights.fill(0);out.jaw=out.close=out.press=out.level=0;
  if(!validSpeechTimeline(t)||!Number.isFinite(seconds)||seconds<0||seconds>=t.duration)return out;
  const pos=clamp(seconds/FRAME_SECONDS,0,t.ids.length-1);
  const a=Math.floor(pos),b=Math.min(a+1,t.ids.length-1),mix=pos-a;
  const add=(id,w,level)=>{
    if(id>=SILENCE||id<0||level<=0)return;
    const strength=clamp(level*1.35+.24,0,1)*w;
    out.weights[id]+=gain[id]*strength;out.jaw+=jaw[id]*strength;
    if(id===5){out.close+=.10*strength;out.press+=.14*strength;}
  };
  const levelA=clamp(t.levels[a]),levelB=clamp(t.levels[b]);
  add(t.ids[a],1-mix,levelA);add(t.ids[b],mix,levelB);
  out.level=levelA*(1-mix)+levelB*mix;
  out.jaw*=1-clamp(out.weights[5]*1.3);
  return out;
}
export function approachSpeechPose(current,target,dt){
  const step=(a,b)=>a+(b-a)*(1-Math.exp(-clamp(dt,0,.1)/(b>a?.024:.036)));
  for(let i=0;i<14;i++)current.weights[i]=step(current.weights[i],target.weights[i]);
  for(const name of ['jaw','close','press','level'])current[name]=step(current[name],target[name]);
  // Explicit closure reduces any residual open mouth; no conflicting expression stacking.
  current.jaw*=1-clamp(current.weights[5]*.85);
  return current;
}
// Irregular deterministic blink schedule, independent of render FPS and speech audio.
export function createNaturalBlink(seed=0x5a17){
  let s=seed>>>0,last=-1,start=0,next=1.6;
  const rnd=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  return (time,level=0)=>{
    if(!Number.isFinite(time))return 0;
    if(last<0||time<last||time-last>5){start=-1;next=time+1.4+rnd()*2.2;}
    last=time;
    if(time>=next){start=time;next=time+2.4+rnd()*3.8+(level>.4?.45:0);}
    const age=time-start;
    if(start<0||age<0||age>.20)return 0;
    const x=age<.075?age/.075:1-(age-.075)/.125;
    return clamp(x)*clamp(x)*(3-2*clamp(x));
  };
}
