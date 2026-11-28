// Presentation-only motion. Distances are metres in V31's authored Y-up stage.
export const BODY_ACTIONS=Object.freeze(['present-left','present-right','explain','advance','return']);
export const WALK_DISTANCE=.48;
// Where a hand rests when she stands still: hanging a little out from the thigh and slightly forward, within the
// measured arm reach. The model's own rest pose holds the arms out like a mannequin (operator 2026-11-28).
export function relaxedHandTarget(shoulder,aPoseHand,reach){
  const out=Math.sign(aPoseHand.x-shoulder.x)||1;
  return {x:shoulder.x+out*.10,y:shoulder.y-.92*reach,z:shoulder.z+.05};
}
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
const ease=t=>{t=clamp(t);return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const STEP=.50,INTRO=.65;
const steps=[[.16,0],[.16,.32],[.48,.32],[.48,.48]];
export function sampleWalk(seconds,from=0,to=WALK_DISTANCE){
  const u=clamp((seconds-INTRO)/STEP,0,4),i=Math.min(3,Math.floor(u)),f=ease(u-i);
  const old=i?steps[i-1]:[0,0],next=steps[i];
  const left=mix(old[0],next[0],f)/WALK_DISTANCE,right=mix(old[1],next[1],f)/WALK_DISTANCE;
  const height=Math.sin(Math.PI*f)*.065;
  const l=from+(to-from)*left,r=from+(to-from)*right;
  // Continuous pelvis progression, independent of the foot swing easing.
  // The earlier midpoint-of-feet path stopped at every step boundary.
  const rootZ=mix(from,to,ease(u/4));
  // Transfer weight across double support with continuous first derivatives.
  let shift=(i%2===0?-1:1)*.035;
  const phase=u-i;
  if(i>0&&phase<.16)shift=mix(-shift,shift,ease((phase+.16)/.32));
  if(i<3&&phase>.84)shift=mix(shift,-shift,ease((phase-.84)/.32));
  if(i===3&&phase>.75)shift*=1-ease((phase-.75)/.25);
  if(u>=4)shift=0;
  const preparation=seconds<INTRO?-.035*ease(seconds/INTRO):0;
  return {rootZ,leftZ:l,rightZ:r,leftLift:next[0]!==old[0]?height:0,rightLift:next[1]!==old[1]?height:0,
    hipDrop:.045*Math.sin(Math.PI*clamp(u/4))**2,weightX:seconds<INTRO?preparation:shift,swing:Math.sin(Math.PI*u)*.12*Math.sin(Math.PI*u/4),wide:ease(seconds/INTRO),done:u>=4};
}
export function samplePresentation(seconds){
  return ease(seconds/.7)*(1-ease((seconds-2.25)/.8));
}
export function createBodyMotion(){
  let action=null,elapsed=0,position=0,wide=0;
  return {
    request(kind){
      if(!BODY_ACTIONS.includes(kind))return false;
      if(action&&(action==='advance'||action==='return'))return false;
      if(kind==='advance'&&position===WALK_DISTANCE||kind==='return'&&position===0)return false;
      action=kind;elapsed=0;return true;
    },
    reset(){action=null;elapsed=0;position=wide=0;},
    update(dt,reduced=false){
      if(reduced){this.reset();}
      elapsed+=Number.isFinite(dt)?clamp(dt,0,.1):0;
      let pose={action,rootZ:position,leftZ:position,rightZ:position,leftLift:0,rightLift:0,hipDrop:0,weightX:0,swing:0,gesture:0,side:0,wide};
      if(action==='advance'||action==='return'){
        const target=action==='advance'?WALK_DISTANCE:0;
        const walk=sampleWalk(elapsed,position,target);
        pose={...pose,...walk};
        wide=Math.max(wide,walk.wide);
        if(walk.done){position=target;action=null;}
      }else if(action){
        pose.gesture=samplePresentation(elapsed);
        pose.side=action==='present-left'?-1:action==='present-right'?1:0;
        if(elapsed>=3.05)action=null;
      }
      const targetWide=action||position>0?1:0;
      wide=mix(wide,targetWide,1-Math.exp(-clamp(dt||0,0,.1)*7));
      if(Math.abs(wide-targetWide)<.001)wide=targetWide;
      pose.wide=wide;return pose;
    }
  };
}
