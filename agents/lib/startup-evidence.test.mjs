import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateStartupEvidence, reconcileStartupActivation } from './startup-evidence.mjs';

const full = {
  schema:'jaco.local-startup/v1',
  state:'READY',
  phase:'complete',
  expected:{browserAttachment:true},
  browserAttachment:'ATTACHED',
};
const core = { schema:'jaco.activation/v2', ok:true, problems:[], runtime:{up:true} };

test('Windows READY requires final startup checkpoint and attached browser', () => {
  const r = evaluateStartupEvidence(full);
  assert.equal(r.ok,true);
  assert.equal(reconcileStartupActivation(core,r).ok,true);
});
test('browser attachment BLOCKED is never concealed by healthy Core/Workplace/providers', () => {
  const r = evaluateStartupEvidence({...full,state:'BLOCKED',phase:'browser-attachment',browserAttachment:'UNVERIFIED',error:'private'});
  const combined = reconcileStartupActivation(core,r);
  assert.equal(combined.ok,false);
  assert.equal(combined.startup.phase,'browser-attachment');
  assert.equal(JSON.stringify(combined).includes('private'),false);
});
test('optional Chrome failure preserves partially usable Core as DEGRADED', () => {
  const r = evaluateStartupEvidence({...full,state:'DEGRADED',browserAttachment:'FAILED'});
  assert.equal(r.ok,false);
  assert.equal(reconcileStartupActivation(core,r).ok,false);
});
test('no startup file or unverified legacy browser evidence fails closed', () => {
  assert.equal(evaluateStartupEvidence(null).ok,false);
  assert.equal(evaluateStartupEvidence({...full,browserAttachment:undefined}).ok,false);
  assert.equal(evaluateStartupEvidence({...full,phase:'service:runtime'}).ok,false);
});
test('CDP explicitly disabled may be READY without browser attachment', () => {
  const r = evaluateStartupEvidence({...full,expected:{browserAttachment:false},browserAttachment:'NOT_REQUIRED'});
  assert.equal(r.ok,true);
});
