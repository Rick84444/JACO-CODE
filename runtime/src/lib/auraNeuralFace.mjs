// Audio2Face skin blendshapes are retargeted by name, never by vertex index.
// Eye direction, eyelids and brows remain owned by the existing behavior director.
export const FACE_CHANNELS=Object.freeze(['jawOpen','jawForward','jawLeft','jawRight','mouthClose','mouthFunnel','mouthPucker','mouthLeft','mouthRight','mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight','mouthDimpleLeft','mouthDimpleRight','mouthStretchLeft','mouthStretchRight','mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper','mouthPressLeft','mouthPressRight','mouthLowerDownLeft','mouthLowerDownRight','mouthUpperUpLeft','mouthUpperUpRight','cheekPuff','cheekSquintLeft','cheekSquintRight','tongueOut']);
const names=new Map(FACE_CHANNELS.map((n,i)=>[n.toLowerCase(),i]));
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function parseNeuralTimeline(raw,duration){
  if(!raw||raw.protocol!=='jaco-a2f/1'||!Array.isArray(raw.names)||raw.names.length>128||!Array.isArray(raw.frames)||raw.frames.length<2||raw.frames.length>2700||!Number.isFinite(duration)||duration<=0||duration>20)return null;
  const indices=raw.names.map(n=>typeof n==='string'?names.get(n.toLowerCase())??-1:-1);
  const known=indices.filter(i=>i>=0);
  if(new Set(known).size!==known.length||known.length<8||!known.includes(0)||!known.includes(4))return null;
  const times=new Float32Array(raw.frames.length),weights=new Float32Array(times.length*FACE_CHANNELS.length);
  let prior=-1;
  for(let i=0;i<times.length;i++){
    const f=raw.frames[i];
    if(!Array.isArray(f)||f.length!==raw.names.length+1||!Number.isFinite(f[0])||f[0]<0||f[0]<=prior||f[0]>duration+.08||i>0&&f[0]-prior>.15)return null;
    prior=f[0];times[i]=prior;
    for(let k=0;k<indices.length;k++){
      const v=f[k+1];if(!Number.isFinite(v)||Math.abs(v)>4)return null;
      if(indices[k]>=0)weights[i*FACE_CHANNELS.length+indices[k]]=clamp(v,0,1);
    }
  }
  if(times[0]>.15||prior<duration-.16)return null;
  return {times,weights,duration};
}
export function sampleNeuralFace(t,seconds,out){
  out.fill(0);
  if(!t||!Number.isFinite(seconds)||seconds<t.times[0]||seconds>t.times[t.times.length-1])return false;
  let lo=0,hi=t.times.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(t.times[mid]<=seconds)lo=mid;else hi=mid;}
  const a=t.times[lo],b=t.times[hi],mix=b>a?clamp((seconds-a)/(b-a),0,1):0,n=FACE_CHANNELS.length;
  for(let i=0;i<n;i++)out[i]=t.weights[lo*n+i]*(1-mix)+t.weights[hi*n+i]*mix;
  return true;
}
export function createNeuralMixer(){
  const target=new Float32Array(FACE_CHANNELS.length),pose=new Float32Array(FACE_CHANNELS.length);let blend=0;
  return {update(t,seconds,dt,enabled){
    const ready=enabled&&sampleNeuralFace(t,seconds,target);
    if(!ready)target.fill(0);
    const step=1-Math.exp(-clamp(Number.isFinite(dt)?dt:0,0,.1)/.07);
    blend+=(Number(ready)-blend)*step;
    for(let i=0;i<pose.length;i++)pose[i]+=(target[i]-pose[i])*step;
    if(!enabled){pose.fill(0);blend=0;}
    return {pose,blend:blend<.001?0:blend,active:ready};
  }};
}
