import test from 'node:test';
import assert from 'node:assert/strict';
import { projectAuraOversight } from '../../runtime/src/server/connected/auraOversight.mjs';

const services = {
  substrate:'READY (200)', workplace:'READY (200)', seer:'READY (200)',
  chromeCdp:'DISCOVERABLE (200)', novaBridge:'READY (200)', cdpBridge:'READY (200)',
  gateway:'NOT_SUPERVISED (TERMUX)', ollama:'DOWN',
};
test('Aura oversight shows recent browser evidence without conflating mission success',()=>{
  const result=projectAuraOversight({serviceHealth:services,statusCounts:{
    ACTIVE:2,BLOCKED:3,AWAITING_VERIFICATION:1,
  },missions:[{lastResult:{outcomeUnknown:true}},{lastResult:{ok:true,verified:true}}],
  truncated:true,now:'2026-10-30T18:00:00Z'});
  assert.equal(result.browser.state,'VERIFIED_RECENT');
  assert.equal(result.missions.active,2);
  assert.equal(result.missions.blocked,3);
  assert.equal(result.missions.awaitingVerification,1);
  assert.equal(result.missions.visibleUnknownOutcomes,1);
  assert.equal(result.missions.visibleWindowTruncated,true);
  assert.equal(result.runtimeConsolidated,false);
  assert.equal(result.schema,'jaco.aura-oversight/v1');
});
test('Lean-disabled adapters do not become faults or fake READY',()=>{
  const result=projectAuraOversight({serviceHealth:{
    ...services,novaBridge:'DISABLED (AURA_LEAN)',cdpBridge:'DISABLED (AURA_LEAN)',
  }});
  assert.equal(result.browser.state,'DISABLED');
  assert.equal(result.services.chromeCdp,'DISCOVERABLE (200)');
});
test('a missing service observation remains unknown, even with known missions',()=>{
  const result=projectAuraOversight({statusCounts:{ACTIVE:1}});
  assert.equal(result.browser.state,'UNOBSERVED');
  assert.equal(result.missions.active,1);
  assert.equal(result.missions.visibleUnknownOutcomes,null);
});
test('unverified or unauthorized bridges remain blocked and do not leak secrets',()=>{
  const result=projectAuraOversight({serviceHealth:{
    ...services,cdpBridge:'UNVERIFIED (200)',novaBridge:'AUTH_REQUIRED (401)',
    workplace:'Bearer eyJ-secret-token-raw',
  },statusCounts:{ACTIVE:'100',BLOCKED:-1}});
  assert.equal(result.browser.state,'BLOCKED');
  assert.equal(result.services.workplace,'UNOBSERVED');
  assert.equal(result.missions.active,null);
  assert.equal(result.missions.blocked,null);
  assert.ok(!JSON.stringify(result).includes('secret-token-raw'));
});
