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
  latestEvent=null,runtimeBlocker=null,
}={}){
  const streamAge=ageInSeconds(lastObservedAt,now);
  const snapshotAge=ageInSeconds(snapshotObservedAt,now);
  const streamLive=connection==='live' && streamAge!==null && streamAge<15;
  const snapshotLive=snapshotAge!==null && snapshotAge<20;
  const connected=streamLive && snapshotLive && runtimeRunning===true;
  const workingSessions=Array.isArray(agents)?agents.reduce((count,a)=>count+(Array.isArray(a?.sessions)?a.sessions.filter(s=>s?.status==='BUSY').length:0),0):0;
  const connectedAgents=Array.isArray(agents)?agents.filter(a=>a?.status==='READY'||Number(a?.liveSessions)>0).length:0;
  const state=String(mission?.status||'');
  const phase=String(mission?.phase||state);
  const active=state==='ACTIVE';
  const blocking=state==='BLOCKED'||state==='AWAITING_VERIFICATION'||approvals>0||Boolean(runtimeBlocker);
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
  }else if(blocking){mode='blocked';title=approvals>0?'Ditt godkännande behövs':runtimeBlocker?'Körningen är blockerad':friendlyPhase(phase);detail=bounded(mission?.goal)||'Ett registrerat uppdrag väntar på åtgärd.';}
  else if(active && unconfirmedProgress){mode='stalled';title='Uppdraget står still';detail='Uppdraget är markerat aktivt, men det saknas färsk observerad framdrift.';}
  else if(active && phase==='READY' && !lastAction){mode='queued';title='Registrerat – väntar på körning';detail='Inget verktygssteg har startat ännu.';}
  else if(active){mode='working';title=friendlyPhase(phase);detail=bounded(mission?.goal)||'Ett uppdrag är aktivt.';}
  else if(connectedAgents>0){mode='observed';title='Agentanslutning observerad';detail='Agenter är anslutna, men inget aktivt uppdrag är bekräftat i uppdragslistan.';}
  else {mode='ready';title='Aura är ansluten';detail='Inget aktivt uppdrag rapporterat. Be Aura visa eller skapa något.';}
  let step=lastAction?.text ? bounded(lastAction.text) : '';
  if(!step && active) step='Inget verktygssteg rapporterat ännu';
  if(!step && latestEvent?.text) step=bounded(latestEvent.text);
  // Unrelated chat/MCP events must never reset the apparent age of a stalled mission.
  const stepAt=active?lastAction?.at||null:latestEvent?.at||null;
  const blocker=runtimeBlocker?bounded(runtimeBlocker):approvals>0?'Ett beslut väntar på dig.':
    state==='AWAITING_VERIFICATION'?'Resultatet väntar på verifiering.':
    state==='BLOCKED'?bounded(lastAction?.result?.text)||'Uppdraget är blockerat. Orsaken har inte rapporterats.':
    active&&unconfirmedProgress?(lastAction?'Ingen ny framdrift har rapporterats. Orsaken är ännu inte verifierad.':'Inget verktygssteg har startat. Runtime har inte rapporterat varför.'):
    active&&phase==='READY'&&!lastAction?'Väntar på att exekveraren tar uppdraget.':'Inget hinder rapporterat.';
  const nextAction=!connected?'Återställ anslutningen innan uppdragets status bedöms.':
    approvals>0?'Öppna beslutspanelen och granska det väntande beslutet.':
    blocking?'Granska uppdragets belägg och den rapporterade orsaken före återupptagning.':
    active&&unconfirmedProgress?'Kontrollera exekverare och modell. Starta inte en kopia av uppdraget.':
    active?'Följ nästa rapporterade steg. Du kan stoppa eller styra uppdraget i chatten.':'Ge Aura ett uppdrag.';
  const verified=Number.isFinite(mission?.verifiedReceipts)?mission.verifiedReceipts:null;
  const stepCount=Number.isFinite(mission?.step)?mission.step:null;
  const maxSteps=Number.isFinite(mission?.maxSteps)&&mission.maxSteps>0?mission.maxSteps:null;
  return {
    mode,title,detail,connected,streamLive,snapshotLive,blocker,nextAction,missionId:mission?.id||null,
    connectionLabel:!snapshotLive?'Status föråldrad':!streamLive?'Ström saknas':runtimeRunning===false?'Runtime stoppad':'JACO ansluten',
    modelLabel:provider&&model?bounded(provider)+' / '+bounded(model):provider?bounded(provider):'Modell ej observerad',
    cdpLabel:cdpState==='VERIFIED'?'CDP verifierad':cdpState==='OBSERVED'?'CDP ansluten':'CDP ej observerad',
    connectedAgents,workingSessions,approvals,missionGoal:bounded(mission?.goal),
    phaseLabel:active?friendlyPhase(phase):state||'Inget uppdrag',step,stepAge:ageInSeconds(stepAt,now),
    streamAge,snapshotAge,verified,stepCount,maxSteps,
    latestAt:stepAt,
  };
}
