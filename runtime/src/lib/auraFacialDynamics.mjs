// Time-domain facial controls. No model inference, browser APIs or external dependencies.
// Timing ranges are authored starting points, not individually measured physiology.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};

export function approachFacialWeight(current,target,dt,referenceAlpha){
  if(![current,target,dt,referenceAlpha].every(Number.isFinite))return 0;
  current=clamp(current,0,1);target=clamp(target,0,1);
  const a=clamp(referenceAlpha,0,1);
  if(dt<=0||a===0)return current;
  if(a===1)return target;
  return clamp(target+(current-target)*Math.pow(1-a,dt*30),0,1);
}

// The anatomical model's mouth shapes are full-strength targets: the jaw and several shapes at once opened her mouth
// into a round shout. Speech uses a part of each, and together the shapes stay within one bounded opening.
export function anatomicalMouth(weights){
  const w=name=>Number.isFinite(weights?.[name])?clamp(weights[name],0,1):0;
  const shapes={aa:w('aa')*.55,O:w('O')*.3,E:w('E')*.5,U:w('U')*.35};
  const total=shapes.aa+shapes.O+shapes.E+shapes.U,fit=total>.45?.45/total:1;
  return {jaw:w('jaw')*.3,aa:shapes.aa*fit,O:shapes.O*fit,E:shapes.E*fit,U:shapes.U*fit};
}

export function createBlinkController(seed=0x5ca1ab1e){
  let rng=seed>>>0;
  const rand=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  let previous=null,start=Infinity,close=.09,hold=.06,open=.14,amplitude=1;
  let initialized=false;
  const schedule=(t,phase,first=false)=>{
    // Longer fixations during visual verification, shorter gaps during speech.
    const range=first?[1.35,2.4]:phase==='verifying'?[3.5,6.6]:phase==='speaking'?[2.1,4.7]:[2.7,5.9];
    start=t+range[0]+rand()*(range[1]-range[0]);
    close=.075+rand()*.035;hold=.045+rand()*.04;open=.105+rand()*.075;
    amplitude=first||rand()>.20?1:.62+rand()*.23;
  };
  return {
    sample(t,phase='idle',reducedMotion=false){
      if(!Number.isFinite(t)||t<0||reducedMotion){
        initialized=false;previous=null;return 0;
      }
      if(!initialized||previous===null||t<previous||t-previous>1.2){
        schedule(t,phase,true);initialized=true;
      }
      previous=t;
      const duration=close+hold+open;
      if(t>=start+duration){
        schedule(start+duration,phase); // schedule from event end, not the sampled frame
        return 0;
      }
      if(t<start)return 0;
      const e=t-start;
      if(e<close)return amplitude*smooth(e/close);
      if(e<close+hold)return amplitude;
      return amplitude*(1-smooth((e-close-hold)/open));
    }
  };
}
