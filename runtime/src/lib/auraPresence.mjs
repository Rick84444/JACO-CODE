// Real observed health and work are different concepts.
// A responding event stream proves connection, not that an agent made progress.
const ageInSeconds=(time,now)=>{
  const value=Date.parse(String(time||''));
  return Number.isFinite(value) && now>=value ? Math.floor((now-value)/1000) : null;
};
const friendlyPhase=phase=>({
  PLANNING:'Planerar nästa åtgärd',EXECUTING:'Utför uppdraget',
  VERIFYING:'Verifierar resultat',READY:'Väntar på nästa steg',
  BLOCKED:'Blockerad',QUEUED:'I kö',AWAITING_VERIFICATION:'Väntar på verifiering',
})[String(phase||'').toUpperCase()]||'Uppdrag registrerat';
const bounded=s=>String(s||'').slice(0,220);
export function auraPresence({
  now=Date.now(),connection='connecting',lastObservedAt=null,
  snapshotObservedAt=null,runtimeRunning=null,mission=null,
  agents=[],provider=null,model=null,cdpState='UNOBSERVED',approvals=0,
  latestEvent=null,
}={}){
  const streamAge=ageInSeconds(lastObservedAt,now);
  const snapshotAge=ageInSeconds(snapshotObservedAt,now);
  const streamLive=connection==='live' && streamAge!==null && streamAge<15;
  const snapshotLive=snapshotAge!==null && snapshotAge<20;
  const connected=streamLive && snapshotLive && runtimeRunning===true;
  const workingSessions=Array.isArray(agents)?agents.reduce((count,a)=>count+Math.max(0,Number(a?.liveSessions)||0),0):0;
  const connectedAgents=Array.isArray(agents)?agents.filter(a=>a?.status==='READY'||Number(a?.liveSessions)>0).length:0;
  const state=String(mission?.status||'');
  const phase=String(mission?.phase||state);
  const active=state==='ACTIVE';
  const blocking=state==='BLOCKED'||state==='AWAITING_VERIFICATION'||approvals>0;
  const lastAction=mission?.lastAction||null;
  const actionAge=ageInSeconds(lastAction?.at,now);
  const missionAge=ageInSeconds(mission?.updatedAt||mission?.createdAt,now);
  // "running" can persist when a tool hangs. Mission timestamps, rather than
  // a provider's RUNNING flag, determine whether recent activity is evidenced.
  const unconfirmedProgress=active && (
    actionAge!==null ? actionAge>=90 : missionAge!==null && missionAge>=90);
  let mode='connecting',title='Ansluter till JACO',detail='Kontrollerar runtime och de observerade händelserna.';
  if(runtimeRunning===false){mode='offline';title='Runtime stoppad';detail='Serverns senaste tillstånd visar att exekveringen inte körs.';}
  else if(!connected){
    mode='offline';title='Status kan inte verifieras';
    detail=connection==='reconnecting'||connection==='unavailable'
      ? 'Händelseströmmen svarar inte. Senast visade resultat kan vara gamla.'
      : !snapshotLive ? 'Arbetsytans statusrapport är för gammal eller saknas.' : 'Väntar på en färsk händelseström.';
  }else if(blocking){mode='blocked';title=approvals>0?'Ditt godkännande behövs':friendlyPhase(phase);detail=bounded(mission?.goal)||'Ett registrerat uppdrag väntar på åtgärd.';}
  else if(active && unconfirmedProgress){mode='stalled';title='Inga nya arbetsresultat';detail='Uppdraget är markerat aktivt, men det saknas färsk observerad framdrift.';}
  else if(active){mode='working';title=friendlyPhase(phase);detail=bounded(mission?.goal)||'Ett uppdrag är aktivt.';}
  else if(workingSessions>0){mode='observed';title='Agentanslutning observerad';detail='Arbetssessioner finns, men inget aktivt uppdrag är bekräftat i uppdragslistan.';}
  else {mode='ready';title='Aura är ansluten';detail='Inget aktivt uppdrag rapporterat. Be Aura visa eller skapa något.';}
  let step=lastAction?.text ? bounded(lastAction.text) : '';
  if(!step && active) step='Inget verktygssteg rapporterat ännu';
  if(!step && latestEvent?.text) step=bounded(latestEvent.text);
  const verified=Number.isFinite(mission?.verifiedReceipts)?mission.verifiedReceipts:null;
  const stepCount=Number.isFinite(mission?.step)?mission.step:null;
  const maxSteps=Number.isFinite(mission?.maxSteps)&&mission.maxSteps>0?mission.maxSteps:null;
  return {
    mode,title,detail,connected,streamLive,snapshotLive,
    connectionLabel:!snapshotLive?'Status föråldrad':!streamLive?'Ström saknas':runtimeRunning===false?'Runtime stoppad':'JACO ansluten',
    modelLabel:provider&&model?bounded(provider)+' / '+bounded(model):provider?bounded(provider):'Modell ej observerad',
    cdpLabel:cdpState==='VERIFIED'?'CDP verifierad':cdpState==='OBSERVED'?'CDP ansluten':'CDP ej observerad',
    connectedAgents,workingSessions,approvals,missionGoal:bounded(mission?.goal),
    phaseLabel:active?friendlyPhase(phase):state||'Inget uppdrag',step,stepAge:actionAge,
    streamAge,snapshotAge,verified,stepCount,maxSteps,
    latestAt:lastAction?.at||latestEvent?.at||null,
  };
}
