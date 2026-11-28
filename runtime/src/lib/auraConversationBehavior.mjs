// Pure presentation controller. Conversation floor is independent of mission state.
// Timing and amplitudes are authoring defaults; not measured human behavior.
export function conversationFloor(state={}){
  if(state.speechPlaying===true)return 'speaking';
  if(state.listening===true)return state.userSpeaking===true?'user-speaking':'receptive';
  if(state.preparingSpeech===true)return 'preparing';
  if(state.awaitingReply===true)return 'awaiting';
  return 'idle';
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
const keys=['attention','pitch','roll','brow','gesture','motion'];
const targets={
  idle:[0,0,0,0,0,1],
  receptive:[.80,.018,.018,.025,0,.32],
  'user-speaking':[1,.025,.025,.045,0,.20],
  awaiting:[.35,-.015,.018,.018,0,.28],
  preparing:[.85,.008,0,.025,0,.28],
  speaking:[.78,0,0,.025,0,.35],
  yielding:[.9,.012,.008,0,0,.25]
};
export function createConversationBehavior(){
  const out={floor:'idle',attention:0,pitch:0,roll:0,brow:0,gesture:0,motion:1};
  let previous=null,base='idle',yieldUntil=-1,lastAccent=-Infinity,accentStart=-Infinity;
  return {sample(t,state={},reduced=false){
    if(reduced||!Number.isFinite(t)||t<0){
      previous=null;base='idle';yieldUntil=-1;lastAccent=accentStart=-Infinity;
      Object.assign(out,{floor:conversationFloor(state),attention:0,pitch:0,roll:0,brow:0,gesture:0,motion:0});
      return out;
    }
    const next=conversationFloor(state),reset=previous===null||t<previous||t-previous>1.2;
    const dt=reset?0:clamp(t-previous,0,.12);previous=t;
    if(reset){
      base=next;yieldUntil=-1;lastAccent=accentStart=-Infinity;
      for(let i=0;i<keys.length;i++)out[keys[i]]=targets[next][i];
    }else if(next!==base){
      yieldUntil=base==='speaking'&&next==='idle'?t+.30:-1;
      base=next;
      accentStart=-Infinity;
      if(next==='speaking'&&t-lastAccent>2.5)lastAccent=accentStart=t;
    }
    const floor=base==='idle'&&t<yieldUntil?'yielding':base;
    const target=targets[floor];
    // Single small turn-opening gesture, never a repeated loop or a claim of semantic alignment.
    // Refractory time also prevents rapid chunk restarts from triggering more accents.
    const since=t-accentStart;
    const accent=floor==='speaking'&&since>=0&&since<.8?smooth(since/.23)*(1-smooth((since-.23)/.57)):0;
    for(let i=0;i<keys.length;i++){
      const key=keys[i];
      let value=target[i];
      if(floor==='speaking'&&state.speechAct==='question'){
        if(key==='brow')value+=.055;
        if(key==='roll')value+=.022;
      }
      if(key==='gesture')value=.045*accent;
      const rate=key==='gesture'?9:key==='attention'?8:5;
      out[key]+=(value-out[key])*(1-Math.exp(-rate*dt));
    }
    out.floor=floor;
    return out;
  }};
}
