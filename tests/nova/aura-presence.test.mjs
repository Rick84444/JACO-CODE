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
  assert.equal(p.connectionLabel,'JACO ansluten');
  assert.match(p.modelLabel,/gemma4-e2b/);
  assert.equal(p.connectedAgents,1);
  assert.equal(p.workingSessions,1);
  assert.equal(p.cdpLabel,'CDP ansluten');
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
  assert.match(p.title,/Inga nya arbetsresultat/);
});
test('Stale transport or runtime STOP always overrides an active mission',()=>{
  assert.equal(auraPresence({...live,lastObservedAt:at(25),mission:active()}).mode,'offline');
  assert.equal(auraPresence({...live,snapshotObservedAt:at(28),mission:active()}).mode,'offline');
  assert.equal(auraPresence({...live,connection:'reconnecting',mission:active()}).mode,'offline');
  assert.equal(auraPresence({...live,runtimeRunning:false,mission:active()}).mode,'offline');
});
test('Approvals and blocked missions are not labeled working',()=>{
  assert.equal(auraPresence({...live,mission:active(),approvals:2}).mode,'blocked');
  assert.equal(auraPresence({...live,mission:{...active(),status:'BLOCKED',phase:'BLOCKED'}}).mode,'blocked');
});
test('Missing provider and idle mission are visible, never inferred',()=>{
  const p=auraPresence({...live,model:null,provider:null,agents:[],cdpState:'UNOBSERVED'});
  assert.equal(p.mode,'ready');
  assert.equal(p.modelLabel,'Modell ej observerad');
  assert.equal(p.cdpLabel,'CDP ej observerad');
  assert.equal(p.verified,null);
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
  assert.match(ui,/<AuraPresence data=\{presence\}\/>/);
  assert.match(status,/data-mode=\{data\.mode\}/);
  assert.doesNotMatch(ui,/cognitive-view-tabs/);
});
