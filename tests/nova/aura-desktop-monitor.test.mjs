import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../../runtime/', import.meta.url);
const read=path=>fs.readFileSync(fileURLToPath(new URL(path,root)),'utf8');

test('Aura Live Stage renders a real authenticated Windows screen monitor rather than a mock or new actuator',()=>{
  const stage=read('src/components/AuraLiveStage.tsx');
  const monitor=read('src/components/AuraDesktopMonitor.tsx');
  assert.match(stage,/import \{ AuraDesktopMonitor \}/);
  assert.match(stage,/<AuraDesktopMonitor active=\{active\} missionId=/);
  assert.match(monitor,/fetch\('\/api\/aura\/desktop\/live-frame'/);
  assert.match(monitor,/credentials: 'same-origin'/);
  assert.match(monitor,/missionStatus !== 'ACTIVE'/);
  assert.match(monitor,/document.visibilityState !== 'visible'/);
  assert.match(monitor,/verified snapshots|verifierade stillbilder/i);
  assert.ok(!/SendInput|mouse_click|execFile|powershell/.test(monitor),'the viewer must never actuate the desktop');
});
test('desktop frame route is login-gated, read-only, no-store and bound to canonical mission',()=>{
  const server=read('server.ts');
  assert.match(server,/app.get\('\/api\/aura\/desktop\/live-frame', requireLocalUi/);
  assert.match(server,/readAuraDesktopLiveFrame\(\{ mission, file \}\)/);
  assert.match(server,/connectedRuntime.novaMissions.current\(\)/);
  assert.match(server,/private, no-store, max-age=0/);
  assert.match(server,/X-Content-Type-Options', 'nosniff'/);
  assert.match(server,/res.status\(200\).type\('png'\).send\(frame.png\)/);
  assert.ok(!/app.post\('\/api\/aura\/desktop\/live-frame'/.test(server),'must stay read-only');
});
