import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { missionCardState } from '../../runtime/src/lib/missionCardState.mjs';

const mission = {id:'mission-1',status:'ACTIVE',goal:'Build a verified demo'};
const presence = (mode,id='mission-1') => ({mode,missionId:id});

test('mission card never calls a durable ACTIVE flag running without matching live evidence',()=>{
  assert.equal(missionCardState(mission), 'unconfirmed');
  assert.equal(missionCardState(mission,presence('working','other-mission')), 'unconfirmed');
  assert.equal(missionCardState(mission,presence('reconnecting')), 'unknown');
  assert.equal(missionCardState(mission,presence('offline')), 'unknown');
  assert.equal(missionCardState(mission,presence('queued')), 'queued');
  assert.equal(missionCardState(mission,presence('stalled')), 'stalled');
  assert.equal(missionCardState(mission,presence('blocked')), 'blocked');
  assert.equal(missionCardState(mission,presence('working')), 'working');
});

test('durable blocking and stop requests retain their own explicit status',()=>{
  assert.equal(missionCardState({...mission,status:'BLOCKED'},presence('working')),'blocked');
  assert.equal(missionCardState({...mission,status:'AWAITING_VERIFICATION'},presence('working')),'verifying');
  assert.equal(missionCardState({...mission,cancelRequested:true},presence('working')),'stopping');
});

test('IDE uses the identical canonical mission and presence for card, stage and tool surfaces',()=>{
  const base=new URL('../../runtime/src/components/',import.meta.url);
  const ide=fs.readFileSync(new URL('JacoAuraComputeIDE.tsx',base),'utf8');
  const card=fs.readFileSync(new URL('MissionCard.tsx',base),'utf8');
  const stage=fs.readFileSync(new URL('AuraLiveStage.tsx',base),'utf8');
  assert.match(ide,/const sideMission = currentMission;/);
  assert.match(ide,/<MissionCard mission=\{sideMission as any\} presence=\{presence\}/);
  assert.match(ide,/activeMission=\{sideMission \? \{/);
  assert.match(ide,/status:sideMission\.status/);
  assert.match(card,/missionCardState\(mission, presence\)/);
  assert.doesNotMatch(card,/<span>Running mission<\/span>/);
  assert.match(stage,/presence\.mode!=='working'/);
});
