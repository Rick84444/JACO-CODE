import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStartupServices, optionalStartupService, optionalOwnershipFailure, processBirth, pendingProcess, configuration, resolveServicePorts } from './local-stack.mjs';
const ready = id => ({ id, state: 'READY' });
const failed = id => ({ id, state: 'UNAVAILABLE' });
const core = ['runtime', 'workplace', 'seer', 'nova-supervisor', 'nova-session'].map(ready);
test('optional helper failure does not block core', () => {
  for (const id of ['remote', 'a2a', 'novaBridge', 'cdp', 'gateway', 'tunnel']) {
    assert.equal(optionalStartupService(id), true);
    assert.equal(classifyStartupServices([...core, failed(id)]), 'DEGRADED');
  }
});
test('required failure and missing core cannot report ready', () => {
  for (const item of core) assert.equal(classifyStartupServices(core.map(s => s.id === item.id ? failed(s.id) : s)), 'BLOCKED');
  assert.equal(classifyStartupServices([ready('remote')]), 'BLOCKED');
  assert.equal(classifyStartupServices([]), 'BLOCKED');
  assert.equal(classifyStartupServices([...core, failed('unknown')]), 'BLOCKED');
  assert.equal(classifyStartupServices(core), 'READY');
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('missing ownership evidence degrades optional bridges, never required Core',()=>{
  for(const id of ['novaBridge','cdp','chrome','gateway'])assert.equal(optionalOwnershipFailure(id,Error('PROCESS_OWNER_NOT_VERIFIED:'+id)),true);
  for(const id of ['runtime','workplace','seer'])assert.equal(optionalOwnershipFailure(id,Error('PROCESS_OWNER_NOT_VERIFIED:'+id)),false);
});
test('Linux process identity is stable and legacy live receipt is not trusted', {skip:process.platform!=='linux'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-linux-owner-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const dir=path.join(root,'logs','startup');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'novaBridge.process.json');
  const birth=processBirth(process.pid);assert.match(birth,/^linux:[0-9a-f-]{36}:[0-9]+$/);
  assert.equal(processBirth(process.pid),birth);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,birth}));
  assert.equal(pendingProcess({root},'novaBridge'),process.pid);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,birth:null}));
  assert.throws(()=>pendingProcess({root},'novaBridge'),/PROCESS_OWNER_NOT_VERIFIED/);
  assert.equal(fs.existsSync(file),true);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,birth:birth+'0'}));
  assert.equal(pendingProcess({root},'novaBridge'),null);
});
test('port resolver leaves occupied legacy bridge alone and keeps Core port',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-optional-owner-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const runtime=path.join(root,'runtime');fs.mkdirSync(runtime);
  fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify({version:'1.0.0'}));
  fs.writeFileSync(path.join(runtime,'server.ts'),"app.get('/api/runtime/identity',()=>{});");
  const c=configuration(root,{JACO_ENABLE_CDP:'1',JACO_GATEWAY_TOKEN:'x'.repeat(32)});
  const skipped=[],original=c.ports.novaBridge;
  const moves=await resolveServicePorts(c,{probe:async s=>({state:s.id==='novaBridge'?'UNAVAILABLE':'READY'}),occupied:async p=>p===original,owns:async()=>{throw Error('PROCESS_OWNER_NOT_VERIFIED:novaBridge');},onOptionalBlocked:id=>skipped.push(id)});
  assert.deepEqual(moves,[]);assert.deepEqual(skipped,['novaBridge']);assert.equal(c.ports.novaBridge,original);
});
