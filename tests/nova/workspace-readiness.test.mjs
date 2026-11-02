import test from 'node:test';
import assert from 'node:assert/strict';
import { activationReadiness, liveWorkspaceStatus } from '../../runtime/src/lib/cognitiveEvents.mjs';

const ready = () => ({ ok:true, runtime:{up:true}, tools:{toolCount:4}, providers:[{active:true}], planner:{reachable:true} });
const status = (activation, extra = {}) => liveWorkspaceStatus({connection:'live',runtimeRunning:true,missions:[],activation,...extra});

test('a connected workspace is never ready without verified model and execution readiness', () => {
  assert.equal(status(undefined).label,'Checking readiness');
  const report=ready(); report.providers=[]; report.ok=false;
  assert.equal(status({report}).action,'connect');
  report.providers=[{active:true}]; report.planner.reachable=false;
  assert.equal(status({report}).label,'Choose a working model');
  report.planner.reachable=true; report.tools.toolCount=0;
  assert.equal(status({report}).action,'activate');
  report.tools.toolCount=4;
  assert.equal(status({report}).action,'details');
  assert.equal(status({report:ready()}).label,'Ready for your mission');
});

test('failed, loading and stale activation observations never appear ready', () => {
  assert.equal(activationReadiness({error:'offline'}).label,'Status unavailable');
  assert.equal(activationReadiness({report:ready(),error:'offline'}).action,'retry');
  assert.equal(activationReadiness({report:ready(),loading:true}).action,'wait');
});

test('required decisions and actual execution remain visible independently of model setup', () => {
  assert.equal(status({report:ready()},{approvalCount:2,busy:'chat'}).label,'Decision required');
  assert.equal(status(undefined,{missions:[{status:'ACTIVE',phase:'EXECUTING'}]}).label,'Working');
  assert.equal(status(undefined,{missions:[{status:'BLOCKED'}]}).label,'Mission blocked');
  assert.equal(status({report:ready()},{connection:'reconnecting'}).label,'Connection needs recovery');
});
