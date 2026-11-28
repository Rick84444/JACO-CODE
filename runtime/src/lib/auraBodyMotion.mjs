// Presentation only. No model calls, audio or mission changes.
// Values are local angular offsets in radians; callers apply them to the rig's rest pose.
export function bodyMotion(t,{speaking=false,listening=false,active=false,jaw=0,reduced=false}={}) {
  if(reduced||!Number.isFinite(t))return {hips:0,spine:0,breath:0,shoulder:0,gesture:0,elbow:0,wrist:0};
  const wave=(rate,phase=0)=>Math.sin(t*rate+phase);
  const energy=Math.max(0,Math.min(1,Number.isFinite(jaw)?jaw:0));
  const stance=.016*wave(.43)+.008*wave(.19,1.3);
  const breath=.010*wave(1.25)+.002*wave(2.5,.4);
  const gesture=speaking?(.008+.035*energy)*wave(1.65,.4):0;
  return {hips:stance,spine:-stance*.7,breath,
    shoulder:.004*wave(.85,1.8)+breath*.35,
    gesture,elbow:gesture*.65,wrist:gesture*.28+(listening?.008:0)*wave(.6),
    // Keep active work visually quiet rather than animating additional gestures.
    focus:active?.004*wave(.33):0};
}
export function approachAngle(current,target,dt,rate=7) {
  if(!Number.isFinite(current))current=0;
  if(!Number.isFinite(target))target=0;
  const delta=Math.max(0,Math.min(.1,Number.isFinite(dt)?dt:0));
  return current+(target-current)*(1-Math.exp(-rate*delta));
}
