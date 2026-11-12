import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { auraPresence } from '../../runtime/src/lib/auraPresence.mjs';

const NOW=Date.parse('2026-10-21T19:22:00Z');
const at=seconds=>new Date(NOW-seconds*1000).toISOString();
const live={
  now:NOW,connection:'live',lastObservedAt:at(2),snapshotObservedAt:at(3),runtimeRunning:true,
  agents:[{status:'READY',liveSessions:1}],provider:'local',model:'gemma4-e2b',cdpState:'OBSERVED'
};
const active=(actionAt=8)=>({
  id:'mission-1',status:'ACTIVE',phase:'EXECUTING',goal:'Bygg klart Aura Live Workspace',
  updatedAt:at(actionAt),step:4,maxSteps:12,verifiedReceipts:2,
  lastAction:{text:'Kör tester',at:at(actionAt),running:false},
});

test('SSE and snapshot both fresh are required to report a connected runtime',()=>{
  const p=auraPresence(live);
  assert.equal(p.mode,'observed');
  assert.equal(p.connected,true);
  assert.equal(p.connectionLabel,'JACO connected');
  assert.match(p.modelLabel,/gemma4-e2b/);
  assert.equal(p.connectedAgents,1);
  assert.equal(p.workingSessions,0,'a READY connection is not a working session');
  assert.equal(p.cdpLabel,'CDP connected');
  assert.notEqual(p.mode,'working','live sockets and sessions are not mission proof');
});
test('An active mission with a recent actual action exposes progress',()=>{
  const p=auraPresence({...live,mission:active()});
  assert.equal(p.mode,'working');
  assert.equal(p.step,'Kör tester');
  assert.equal(p.stepAge,8);
  assert.equal(p.verified,2);
  assert.equal(p.stepCount,4);
  assert.equal(p.maxSteps,12);
});
test('A responsive connection cannot conceal a stale or stuck mission',()=>{
  const p=auraPresence({...live,mission:active(185)});
  assert.equal(p.connected,true);
  assert.equal(p.mode,'stalled');
  assert.match(p.title,/has stalled/);
});
test('A newly registered mission with no executed step is queued even when phase says EXECUTING',()=>{
  const mission={id:'mission-no-steps',goal:'Build demo',status:'ACTIVE',phase:'EXECUTING',updatedAt:at(8),step:0,lastAction:null};
  const p=auraPresence({...live,mission,latestEvent:{at:at(1),text:'Separate chat tool succeeded'}});
  assert.equal(p.mode,'queued');
  assert.equal(p.missionId,mission.id);
  assert.equal(p.stepCount,0);
  assert.match(p.blocker,/Waiting for the executor/);
  assert.match(p.nextAction,/Do not start a copy/);
});

test('A short interruption reconnects quietly and never claims progress; silence or a stop is red',()=>{
  for(const state of [{lastObservedAt:at(25)},{snapshotObservedAt:at(28)},{connection:'reconnecting'}]){
    const p=auraPresence({...live,...state,mission:active()});
    assert.equal(p.mode,'reconnecting');assert.equal(p.connected,false);assert.equal(p.connectionLabel,'Reconnecting…');
  }
  const silent=auraPresence({...live,lastObservedAt:at(90),snapshotObservedAt:at(90),connection:'reconnecting',mission:active()});
  assert.equal(silent.mode,'offline');assert.equal(silent.title,'Connection lost');
  assert.equal(auraPresence({...live,runtimeRunning:false,mission:active()}).mode,'offline');
});
test('An observation newer than the display clock is fresh, so the status does not flap',()=>{
  const p=auraPresence({...live,lastObservedAt:at(-3),snapshotObservedAt:at(-1),mission:active()});
  assert.equal(p.connected,true);assert.equal(p.mode,'working');assert.equal(p.streamAge,0);
  assert.equal(auraPresence({...live,lastObservedAt:at(-120),snapshotObservedAt:at(-120)}).connected,false,'a far-future time is not trusted');
});
test('Before anything has been heard a new page is connecting, not lost',()=>{
  const first={now:NOW,connection:'live',lastObservedAt:null,snapshotObservedAt:null,runtimeRunning:null};
  assert.equal(auraPresence(first).mode,'connecting');
  assert.equal(auraPresence({...first,connection:'reconnecting'}).mode,'connecting');
  assert.equal(auraPresence({...first,connection:'unavailable'}).mode,'offline');
});
test('Approvals and blocked missions are not labeled working',()=>{
  assert.equal(auraPresence({...live,mission:active(),approvals:2}).mode,'blocked');
  assert.equal(auraPresence({...live,mission:{...active(),status:'BLOCKED',phase:'BLOCKED'}}).mode,'blocked');
});
test('Missing provider and idle mission are visible, never inferred',()=>{
  const p=auraPresence({...live,model:null,provider:null,agents:[],cdpState:'UNOBSERVED'});
  assert.equal(p.mode,'ready');
  assert.equal(p.modelLabel,'Model not observed');
  assert.equal(p.cdpLabel,'CDP not observed');
  assert.equal(p.verified,null);
});

test('an unstarted mission exposes missing execution and unrelated MCP activity cannot refresh its progress',()=>{
  const p=auraPresence({...live,mission:{id:'queued',goal:'Read Git status',status:'ACTIVE',phase:'READY',createdAt:at(600),step:0},latestEvent:{at:at(1),text:'MCP git status succeeded'}});
  assert.equal(p.mode,'stalled');
  assert.equal(p.missionId,'queued');
  assert.match(p.blocker,/No tool step has started/);
  assert.match(p.blocker,/has not reported why/);
  assert.match(p.nextAction,/Do not start a copy/);
  assert.equal(p.stepAge,null,'an unrelated tool call is not mission progress');
  assert.equal(p.latestAt,null);
});

test('fresh queued work and actual BUSY sessions are distinct from connected agents',()=>{
  const p=auraPresence({...live,mission:{id:'queued',status:'ACTIVE',phase:'READY',createdAt:at(5)},agents:[{status:'READY',liveSessions:2,sessions:[{status:'READY'},{status:'BUSY'},{status:'OFFLINE'}]}]});
  assert.equal(p.mode,'queued');
  assert.equal(p.workingSessions,1);
  assert.equal(p.connectedAgents,1);
  assert.match(p.blocker,/executor/);
});

test('a reported runtime blocker is visible without inventing a different cause or enabling permissions',()=>{
  const p=auraPresence({...live,mission:active(),runtimeBlocker:'CLOUD_DISABLED_BY_POLICY'});
  assert.equal(p.mode,'blocked');
  assert.equal(p.blocker,'CLOUD_DISABLED_BY_POLICY');
  assert.match(p.nextAction,/before resuming/);
});
test('The real IDE wires fresh runtime, SSE, mission and model information to the same stage',()=>{
  const root=new URL('../../runtime/src/components/',import.meta.url);
  const ide=fs.readFileSync(new URL('JacoAuraComputeIDE.tsx',root),'utf8');
  const ui=fs.readFileSync(new URL('AuraLiveStage.tsx',root),'utf8');
  const status=fs.readFileSync(new URL('AuraPresence.tsx',root),'utf8');
  assert.match(ide,/auraPresence\(/);
  assert.match(ide,/snapshotObservedAt:snapshot\?\.observedAt/);
  assert.match(ide,/connection:cognitiveLive\.connection/);
  assert.match(ide,/lastObservedAt:cognitiveLive\.lastObservedAt/);
  assert.match(ide,/mission:currentMission/);
  assert.match(ide,/presence=\{presence\}/);
  assert.match(ui,/<AuraPresence data=\{presence\} language=\{language\}\/>/);
  assert.match(status,/data-mode=\{data\.mode\}/);
  assert.doesNotMatch(ui,/cognitive-view-tabs/);
});
