import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
test('authoritative evidence survives context eviction and an old finish retry',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'aura-proof-'));
 const bus=new DurableMissionBus(dir);
 t.after(()=>{bus.close();fs.rmSync(dir,{recursive:true,force:true});});
 const control=new NovaMissionControl(bus,{allowedTasks:['health-check']});
 const m=control.create({goal:'Verify long mission',idempotencyKey:'long-proof'});
 let first=null;
 for(let i=0;i<45;i++){
  const {token}=control.claim(m.id,'nova');
  const a=control.begin(m.id,{owner:'nova',token,task:{type:'health-check',data:{}}});
  const body={owner:'nova',token,actionId:a.id,receipt:{ok:true,verified:true,result:{index:i}}};
  control.finish(m.id,body);if(!first)first=body;
 }
 assert.equal(control.get(m.id).receipts.length,40);
 assert.equal(control.evidenceReceipts(m.id).length,45);
 assert.equal(control.evidenceReceipts(m.id)[0].actionId,first.actionId);
 control.finish(m.id,first);
 assert.equal(control.evidenceReceipts(m.id).length,45);
});
