// Presentation director: one clock, bounded cues, no authority or tool execution.
// All channels describe animation, never claims about the runtime's actual reasoning.
const clamp=(v,a=0,b=1)=>Number.isFinite(v)?Math.max(a,Math.min(b,v)):0;
const damp=(a,b,dt,tau)=>a+(b-a)*(-Math.expm1(-dt/tau));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const pulse=(t,start,duration)=>{const u=(t-start)/duration;return u>0&&u<1?Math.sin(Math.PI*u)**2:0;};
export function createHumanBehavior(seed=0xa031){
  let s=seed>>>0;
  const random=()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};
  let time=0,mode='idle',age=0,attentionX=0,attentionY=0,nextGlance=3.5,glanceUntil=0,glanceX=0,glanceY=0;
  let cue=null,priorLevel=0,accent=0,accentPeak=0,nextAccent=0,accentAt=-10,breathPhase=0,headX=0,headY=0,oldHeadX=0,oldHeadY=0,hairX=0,hairY=0,weight=0,nextWeight=4,weightTarget=0;
  const out={mode:'idle',headYaw:0,headPitch:0,headRoll:0,eyeX:0,eyeY:0,brow:0,smile:0,cheek:0,breath:0,handBeat:0,weight:0,hairYaw:0,hairPitch:0,accent:0};
  function neutral(){for(const key of Object.keys(out))if(key!=='mode')out[key]=0;out.mode='idle';return out;}
  return {
    cue(action){
      if(!['present-left','present-right','explain','advance','return'].includes(action))return false;
      cue={action,until:time+2.7};return true;
    },
    update(input={},delta=.033,reduced=false){
      const dt=clamp(delta,0,.1);
      if(reduced){cue=null;mode='idle';age=0;accent=accentPeak=0;accentAt=-10;priorLevel=0;headX=headY=oldHeadX=oldHeadY=attentionX=attentionY=hairX=hairY=weight=0;weightTarget=0;glanceUntil=0;nextGlance=time+3;nextWeight=time+4;return neutral();}
      time+=dt;
      // Listening interrupts a presentation's attention, speaking wins over work telemetry.
      const next=input.listening?'listening':input.speaking?'speaking':input.phase==='awaiting_decision'?'decision':input.phase==='verifying'?'verifying':input.active||input.phase==='analyzing'?'thinking':'idle';
      if(next!==mode){mode=next;age=0;glanceUntil=0;nextGlance=time+2.8+random()*2.2;if(mode==='listening')cue=null;}
      else age+=dt;
      if(cue&&time>=cue.until)cue=null;
      const level=input.speaking&&!input.listening?clamp(input.level):0;
      const rise=Math.max(0,level-priorLevel);
      priorLevel=level;
      accent*=Math.exp(-dt/.19);
      if(mode==='speaking'&&rise>.085&&time>=nextAccent){accent=accentPeak=Math.min(1,rise*2.7);accentAt=time;nextAccent=time+.62+random()*.35;}
      if(mode!=='speaking'){accent=accentPeak=0;accentAt=-10;}
      const explicitX=clamp(input.x,-1,1),explicitY=clamp(input.y,-1,1);
      const hasTarget=Math.abs(explicitX)+Math.abs(explicitY)>.035;
      if(time>=nextGlance){
        const direction=random()<.5?-1:1;
        glanceX=direction*(.055+random()*.06);glanceY=(random()-.6)*.07;
        glanceUntil=time+.26+random()*.38;
        nextGlance=time+(mode==='listening'?4.4:2.9)+random()*3.2;
      }
      let tx=0,ty=0;
      if(mode!=='listening'&&hasTarget){tx=explicitX*.35;ty=-explicitY*.18;}
      else if(mode!=='listening'&&cue&&(cue.action==='present-left'||cue.action==='present-right'))tx=cue.action==='present-left'?-.28:.28;
      else if(mode==='thinking'&&age>.32&&age<1.65){tx=.11;ty=.055;}
      else if(time<glanceUntil&&!hasTarget){tx=glanceX;ty=glanceY;}
      attentionX=damp(attentionX,tx,dt,.065);attentionY=damp(attentionY,ty,dt,.075);
      headX=damp(headX,attentionX*.72,dt,.28);headY=damp(headY,attentionY*.75,dt,.27);
      const nod=mode==='listening'?pulse(age,.55,.72)*.045:mode==='speaking'?pulse(time,accentAt+.045,.4)*accent*.028:0;
      const breathRate=mode==='speaking'?.82:mode==='listening'?1.04:.94;
      breathPhase=(breathPhase+dt*breathRate)%(Math.PI*2);
      const breath=Math.sin(breathPhase)*.75+.16*Math.sin(2*breathPhase-.5);
      if(time>=nextWeight){weightTarget=(random()-.5)*.026;nextWeight=time+4+random()*5;}
      weight=damp(weight,weightTarget,dt,.95);
      // Secondary hair lag follows head acceleration; no constant wind oscillation.
      const dx=dt>0?(headX-oldHeadX)/dt:0,dy=dt>0?(headY-oldHeadY)/dt:0;
      oldHeadX=headX;oldHeadY=headY;
      hairX=damp(hairX,clamp(-dx*.06,-.07,.07),dt,.16);
      hairY=damp(hairY,clamp(-dy*.05,-.055,.055),dt,.18);
      out.mode=mode;out.headYaw=headX;out.headPitch=headY+nod;out.headRoll=clamp(-headX*.09+(mode==='listening'?.018:0),-.06,.06);
      out.eyeX=clamp((attentionX-headX)*1.6,-.38,.38);out.eyeY=clamp((attentionY-headY)*1.5,-.22,.22);
      out.brow=clamp((mode==='decision'?.075:mode==='listening'?.035:0)+accent*.065,0,.15);
      out.smile=mode==='listening'?.05:mode==='speaking'?.018+accent*.018:.028;
      out.cheek=clamp(out.smile*.4+accent*.027,0,.085);
      out.breath=breath;out.handBeat=mode==='speaking'?pulse(time,accentAt+.07,.65)*accentPeak:0;
      out.weight=weight;out.hairYaw=hairX;out.hairPitch=hairY;out.accent=accent;
      return out;
    }
  };
}
