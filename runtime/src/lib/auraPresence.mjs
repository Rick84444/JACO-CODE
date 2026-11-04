// Real observed health and work are different concepts.
// A responding event stream proves connection, not that an agent made progress.
const MAX_CLOCK_LEAD_MS=30_000;
const ageInSeconds=(time,now)=>{
  const value=Date.parse(String(time||''));
  if(!Number.isFinite(value)) return null;
  // The display clock ticks every few seconds, so an observation can be newer than "now". That is fresh, not unknown.
  if(now<value) return value-now<=MAX_CLOCK_LEAD_MS ? 0 : null;
  return Math.floor((now-value)/1000);
};
const friendlyPhase=phase=>({
  PLANNING:'Planning the next action',EXECUTING:'Executing the mission',
  VERIFYING:'Verifying results',READY:'Waiting for the next step',
  BLOCKED:'Blocked',QUEUED:'Queued',AWAITING_VERIFICATION:'Awaiting verification',
})[String(phase||'').toUpperCase()]||'Mission registered';
const bounded=s=>String(s||'').slice(0,220);
const LOST_AFTER_SECONDS=60;
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
  // One fresh source means JACO still answers, so a dropped stream or a slow status read is only a reconnect.
  // Red is kept for a stopped runtime or when nothing has been heard for a full minute.
  const heardRecently=streamLive||snapshotLive||(streamAge!==null&&streamAge<LOST_AFTER_SECONDS)||(snapshotAge!==null&&snapshotAge<LOST_AFTER_SECONDS);
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
  let mode='connecting',title='Connecting to JACO',detail='Checking the runtime and the observed events.';
  if(runtimeRunning===false){mode='offline';title='Runtime stopped';detail="The server's latest state shows that execution is not running.";}
  else if(!connected&&heardRecently){
    mode='reconnecting';title='Refreshing status';detail='JACO is reconnecting. Nothing is wrong with your work.';
  }
  else if(!connected&&connection!=='unavailable'&&streamAge===null&&snapshotAge===null){
    mode='connecting';
  }
  else if(!connected){
    mode='offline';title='Connection lost';
    detail=connection==='reconnecting'||connection==='unavailable'
      ? 'The event stream is not responding. The results last shown may be old.'
      : !snapshotLive ? "The workspace status report is too old or missing." : 'Waiting for a fresh event stream.';
  }else if(blocking){mode='blocked';title=approvals>0?'Your approval is needed':friendlyPhase(phase);detail=bounded(mission?.goal)||'A registered mission is waiting for action.';}
  else if(active && unconfirmedProgress){mode='stalled';title='No new work results';detail='The mission is marked active, but there is no fresh observed progress.';}
  else if(active){mode='working';title=friendlyPhase(phase);detail=bounded(mission?.goal)||'A mission is active.';}
  else if(workingSessions>0){mode='observed';title='Agent connection observed';detail='Work sessions exist, but no active mission is confirmed in the mission list.';}
  else {mode='ready';title='Aura is connected';detail='No active mission reported. Ask Aura to show or create something.';}
  let step=lastAction?.text ? bounded(lastAction.text) : '';
  if(!step && active) step='No tool step reported yet';
  if(!step && latestEvent?.text) step=bounded(latestEvent.text);
  const stepAt=lastAction?.at||latestEvent?.at||null;
  const verified=Number.isFinite(mission?.verifiedReceipts)?mission.verifiedReceipts:null;
  const stepCount=Number.isFinite(mission?.step)?mission.step:null;
  const maxSteps=Number.isFinite(mission?.maxSteps)&&mission.maxSteps>0?mission.maxSteps:null;
  return {
    mode,title,detail,connected,streamLive,snapshotLive,
    connectionLabel:runtimeRunning===false?'Runtime stopped':connected?'JACO connected':heardRecently?'Reconnecting…':'No answer from JACO',
    modelLabel:provider&&model?bounded(provider)+' / '+bounded(model):provider?bounded(provider):'Model not observed',
    cdpLabel:cdpState==='VERIFIED'?'CDP verified':cdpState==='OBSERVED'?'CDP connected':'CDP not observed',
    connectedAgents,workingSessions,approvals,missionGoal:bounded(mission?.goal),
    phaseLabel:active?friendlyPhase(phase):state||'No mission',step,stepAge:ageInSeconds(stepAt,now),
    streamAge,snapshotAge,verified,stepCount,maxSteps,
    latestAt:stepAt,
  };
}
