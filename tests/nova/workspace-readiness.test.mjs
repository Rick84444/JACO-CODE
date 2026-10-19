import test from 'node:test';
import assert from 'node:assert/strict';
import { activationReadiness, liveWorkspaceStatus } from '../../runtime/src/lib/cognitiveEvents.mjs';

const ready = () => ({ ok:true, runtime:{up:true}, tools:{toolCount:4}, providers:[{active:true}], planner:{reachable:true} });
const status = (activation, extra = {}) => liveWorkspaceStatus({connection:'live',runtimeRunning:true,missions:[],activation,...extra});

test('a connected workspace is never ready without verified model and execution readiness', () => {
  assert.equal(status(undefined).label,'Kontrollerar vad som är redo');
  const report=ready(); report.providers=[]; report.ok=false;
  assert.equal(status({report}).action,'connect');
  report.providers=[{active:true}]; report.planner.reachable=false;
  assert.equal(status({report}).label,'Välj en modell som svarar');
  report.planner.reachable=true; report.tools.toolCount=0;
  assert.equal(status({report}).action,'activate');
  report.tools.toolCount=4;
  assert.equal(status({report}).action,'details');
  assert.equal(status({report:ready()}).label,'Redo för ditt uppdrag');
});

test('failed, loading and stale activation observations never appear ready', () => {
  assert.equal(activationReadiness({error:'offline'}).label,'Status kunde inte hämtas');
  assert.equal(activationReadiness({report:ready(),error:'offline'}).action,'retry');
  assert.equal(activationReadiness({report:ready(),loading:true}).action,'wait');
});

test('required decisions and actual execution remain visible independently of model setup', () => {
  assert.equal(status({report:ready()},{approvalCount:2,busy:'chat'}).label,'Ett beslut behöver dig');
  assert.equal(status(undefined,{missions:[{status:'ACTIVE',phase:'EXECUTING'}]}).label,'Arbetar');
  assert.equal(status(undefined,{missions:[{status:'BLOCKED'}]}).label,'Ett uppdrag har ett hinder');
  assert.equal(status({report:ready()},{connection:'reconnecting'}).label,'Anslutningen behöver återställas');
});
