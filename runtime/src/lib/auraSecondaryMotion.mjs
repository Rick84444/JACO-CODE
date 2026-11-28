// Stable critically/under-damped secondary motion, in seconds and stage metres.
const clamp=(x,a,b)=>Number.isFinite(x)?Math.max(a,Math.min(b,x)):0;
function spring(){return {x:0,v:0};}
function advance(s,target,dt,k,d,bound){
  // Semi-implicit integration with bounded 120 Hz substeps.
  const n=Math.max(1,Math.ceil(dt*120)),h=dt/n;
  for(let i=0;i<n;i++){
    s.v+=((target-s.x)*k-s.v*d)*h;
    s.x+=s.v*h;
    if(Math.abs(s.x)>bound){s.x=clamp(s.x,-bound,bound);s.v=0;}
  }
  return s.x;
}
export function createSecondaryMotion(){
  const chain=Array.from({length:4},()=>({pitch:spring(),yaw:spring()}));
  const front=spring(),back=spring(),side=spring(),fabric=spring();
  const out={pitch:new Float32Array(4),yaw:new Float32Array(4),front:0,back:0,side:0,fabric:0};
  let previous=null,vYaw=0,vPitch=0,vZ=0;
  function reset(){
    previous=null;vYaw=vPitch=vZ=0;
    for(const s of [...chain.flatMap(p=>[p.pitch,p.yaw]),front,back,side,fabric])s.x=s.v=0;
    out.pitch.fill(0);out.yaw.fill(0);out.front=out.back=out.side=out.fabric=0;return out;
  }
  return {update(input={},delta=.033,reduced=false){
    if(reduced||!Number.isFinite(delta)||delta>.25)return reset();
    const dt=clamp(delta,0,.1);
    const current={yaw:clamp(input.yaw,-1,1),pitch:clamp(input.pitch,-1,1),z:clamp(input.z,-1,1)};
    if(!previous||dt===0){previous=current;return out;}
    const smooth=1-Math.exp(-dt/.08);
    vYaw+= (clamp((current.yaw-previous.yaw)/dt,-3,3)-vYaw)*smooth;
    vPitch+=(clamp((current.pitch-previous.pitch)/dt,-3,3)-vPitch)*smooth;
    vZ+=(clamp((current.z-previous.z)/dt,-1.5,1.5)-vZ)*smooth;
    previous=current;
    let pitch=clamp(-vPitch*.075-vZ*.12,-.16,.16),yaw=clamp(-vYaw*.075,-.15,.15);
    for(let i=0;i<4;i++){
      const c=chain[i];
      out.pitch[i]=advance(c.pitch,pitch,dt,100-i*15,12-i, .18);
      out.yaw[i]=advance(c.yaw,yaw,dt,100-i*15,12-i,.16);
      pitch=out.pitch[i]*1.12;yaw=out.yaw[i]*1.12;
    }
    out.front=advance(front,clamp(-vZ*.28-vPitch*.12,-.25,.25),dt,82,12,.28);
    out.back=advance(back,clamp(-vZ*.40-vPitch*.16,-.35,.35),dt,55,9,.38);
    out.side=advance(side,clamp(-vYaw*.23,-.35,.35),dt,70,10,.38);
    const flex=clamp(Math.abs(input.flex||0),0,1);
    out.fabric=advance(fabric,flex*.75,dt,105,19,.8);
    return out;
  },reset};
}
export function contactShadow(lift){
  const h=clamp(lift,0,.30);
  return {opacity:.33*Math.exp(-h*12),scale:1+h*3};
}
