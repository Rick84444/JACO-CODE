import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {desktopTakeoverState} from '../../runtime/src/server/desktop/desktopTakeover.mjs';

const mission={id:'mission-test',status:'ACTIVE',metadata:{executor:'desktop-agentos'},
  phase:'READY',executionLeaseActive:false,activeTask:null,paused:{at:'2026-11-21T18:00:00.000Z'},cancelRequested:false};
const read=relative=>fs.readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('pause acknowledgement never grants takeover until original mission lease and UIA/relay action settle',()=>{
  assert.deepEqual(desktopTakeoverState(mission),{ready:true,reason:'JACO_DESKTOP_MISSION_QUIESCENT'});
  for (const notReady of [
    {...mission,paused:null},
    {...mission,phase:'EXECUTING'},
    {...mission,phase:'PLANNING'},
    {...mission,executionLeaseActive:true},
    {...mission,executionLeaseActive:undefined},
    {...mission,executionLeaseActive:null},
    {...mission,activeTask:{type:'mouse-click'}},
    {...mission,cancelRequested:true},
  ]) assert.equal(desktopTakeoverState(notReady).ready,false);
  assert.equal(desktopTakeoverState(mission,{desktopBusy:true}).reason,'DESKTOP_ACTION_STILL_IN_FLIGHT');
  assert.equal(desktopTakeoverState(mission,{relayLease:{holder:'aura'}}).ready,false);
  assert.equal(desktopTakeoverState({...mission,status:'BLOCKED'}).ready,false);
  assert.equal(desktopTakeoverState({...mission,metadata:{executor:'nova'}}).ready,false);
  assert.equal(desktopTakeoverState({...mission,executor:'desktop-agentos',metadata:{executor:'nova'}}).ready,false);
});

test('one in-flight DesktopHandsOff instance is shared between the direct API and ModelRelay',()=>{
  const server=read('../../runtime/server.ts');
  const route=read('../../runtime/src/server/desktop/router.ts');
  const desktop=read('../../runtime/src/server/desktop/desktopHandsOff.ts');
  const relay=read('../../runtime/src/server/relay/modelRelay.ts');
  assert.match(server,/createDesktopRouter\(WORKSPACE_ROOT, RELEASE_ROOT, requireAuth, event => \{[\s\S]{0,350}desktopHandsOff, modelRelay\.mandates\)/);
  assert.match(route,/const client = canonicalClient \?\? new DesktopHandsOffClient/);
  assert.match(desktop,/private inFlight = false/);
  assert.match(desktop,/if \(this\.inFlight\)/);
  assert.match(desktop,/DESKTOP_ACTUATOR_BUSY/);
  assert.match(desktop,/finally \{ this\.inFlight = false; \}/);
  assert.match(relay,/finally \{[\s\S]{0,320}actuatorLeases\.release\(surface, modelId\)/);
});

test('manual control requires operator pause and a separate quiescence check, not remote viewer authority',()=>{
  const server=read('../../runtime/server.ts');
  const ui=read('../../runtime/src/components/AuraDesktopMonitor.tsx');
  assert.match(server,/app\.get\('\/api\/aura\/desktop\/takeover\/:id\/status', requireLocalUi/);
  assert.match(server,/desktopTakeoverState\(mission, \{/);
  assert.match(server,/actuatorLeases\.get\('DESKTOP'\)/);
  assert.match(ui,/onClick=\{\(\) => \{ void setOperatorPause\(takeover === 'idle'\)/);
  assert.match(ui,/takeover === 'pending'/);
  assert.match(ui,/takeoverBusy \|\| takeover === 'pending'/);
  assert.match(ui,/\/pause' : '\/resume'/);
  assert.match(ui,/remotedesktop\.google\.com\/access/);
  assert.ok(!/SendInput|mouse_click|powershell/.test(ui),'Viewer must not dispatch its own Windows input');
});

test('takeover requires a real token-free lease state from canonical Nova control',()=>{
  const control=read('../../runtime/src/server/connected/novaMissionControl.mjs');
  const takeover=read('../../runtime/src/server/desktop/desktopTakeover.mjs');
  assert.match(control,/executionLeaseActive: Boolean\(row\.token \|\| row\.owner/);
  assert.match(takeover,/mission\.executionLeaseActive !== false/);
  assert.equal(desktopTakeoverState({...mission,executionLeaseActive:true}).ready,false);
  assert.equal(desktopTakeoverState({...mission,executionLeaseActive:undefined}).ready,false);
  assert.equal(desktopTakeoverState({...mission,executionLeaseActive:false}).ready,true);
});
