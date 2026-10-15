import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DurableMissionBus} from '../../runtime/src/server/connected/durableMissionBus.mjs';

test('operator decisions remain discoverable behind hundreds of newer completed missions',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-approval-')),bus=new DurableMissionBus(dir);
  t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
  const blocked=bus.createMission({goal:'Old blocked mission'}),review=bus.createMission({goal:'Old review'});
  bus.db.prepare('UPDATE missions SET status=?,created_at=? WHERE id=?').run('BLOCKED','2020-01-01',blocked.id);
  bus.db.prepare('UPDATE missions SET status=?,created_at=? WHERE id=?').run('AWAITING_VERIFICATION','2020-01-02',review.id);
  for(let i=0;i<510;i++){const m=bus.createMission({goal:'Completed '+i});bus.db.prepare('UPDATE missions SET status=? WHERE id=?').run('DONE',m.id);}
  assert.equal(bus.listMissions(100).some(m=>m.id===blocked.id),false);
  assert.deepEqual(new Set(bus.missionsAwaitingResolution().map(m=>m.id)),new Set([blocked.id,review.id]));
  bus.db.prepare('UPDATE missions SET status=? WHERE id=?').run('CANCELLED',blocked.id);
  assert.deepEqual(bus.missionsAwaitingResolution().map(m=>m.id),[review.id]);
});
