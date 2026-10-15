import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {WorkplaceStore} from '../../gateway/src/workplace/workplace-store.mjs';
import {bootstrapJacoAgent,JacoWorkplaceClient} from '../../gateway/src/workplace/workplace-client.mjs';
import {joinWorkplace} from '../../agents/lib/workplace-session.mjs';
import {DeviceRegistry} from '../../runtime/src/server/connected/deviceAccess.mjs';
import {mountDeviceWorkplace} from '../../runtime/src/server/connected/deviceWorkplace.mjs';
const require=createRequire(new URL('../../runtime/package.json',import.meta.url));
const express=require('express');
const card=name=>({schema:'jaco.agent-card/v1',identity:{stable_id:name,requested_name:name,agent_type:'coding'},session:{environment:'test'},capabilities:{},communication:{}});
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-private-'));return dir;};
function boot(store,name){const r=store.registerAgent(card(name)),auth={sessionId:r.sessionId,sessionToken:r.sessionToken};const s=store.sync(auth);store.ack({...auth,cursor:s.scannedCursor});store.postEvent({...auth,kind:'STATUS',payload:{status:'READY'}});return {...auth,agentId:r.agentId};}
test('private events survive restart and new sessions without plaintext event content in database',t=>{
  const dir=temp(t),secret='Private customer requirement with address 42';let store=new WorkplaceStore(dir);
  const a=boot(store,'agent-one');store.postEvent({...a,kind:'DECISION',body:secret,payload:{privateContext:secret}});store.close();
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const db=path.join(dir,'.jaco/workplace/workplace.sqlite');assert.equal(fs.readFileSync(db).includes(Buffer.from(secret)),false);
  store=new WorkplaceStore(dir);const b=boot(store,'agent-two');assert.ok(store.sync({...b,after:0}).events.some(e=>e.body===secret));assert.equal(store.overview().memory.some(e=>e.body===secret),true);store.close();
});
test('legacy content migrates transactionally; missing or wrong key fails closed',t=>{
  const dir=temp(t);let store=new WorkplaceStore(dir);const a=boot(store,'agent');const e=store.postEvent({...a,kind:'FINDING',body:'original'});
  store.db.prepare('UPDATE events SET body=? WHERE seq=?').run('legacy private plaintext',e.seq);store.close();
  store=new WorkplaceStore(dir);assert.equal(store.overview().memory[0].body,'legacy private plaintext');store.close();
  const state=path.join(dir,'.jaco/workplace');assert.equal(fs.readFileSync(path.join(state,'workplace.sqlite')).includes(Buffer.from('legacy private plaintext')),false);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=fs.readFileSync(path.join(state,'content.key'));fs.unlinkSync(path.join(state,'content.key'));assert.throws(()=>new WorkplaceStore(dir),/CONTENT_KEY_MISSING/);
  fs.writeFileSync(path.join(state,'content.key'),Buffer.alloc(32));assert.throws(()=>new WorkplaceStore(dir),/CONTENT_AUTHENTICATION_FAILED/);fs.writeFileSync(path.join(state,'content.key'),key);
});
test('private targeted decisions are not disclosed through decision context or operator broadcast overview',t=>{
  const store=new WorkplaceStore(temp(t));t.after(()=>{store.close();fs.rmSync(store.workspaceRoot,{recursive:true,force:true});});const a=boot(store,'a'),b=boot(store,'b'),c=boot(store,'c');
  store.postEvent({...a,kind:'DECISION',body:'Only agent b',targets:[b.agentId]});
  assert.ok(store.sync({...b,after:0}).decisions.some(e=>e.body==='Only agent b'));
  assert.equal(store.sync({...c,after:0}).decisions.some(e=>e.body==='Only agent b'),false);
  assert.equal(store.overview().memory.some(e=>e.body==='Only agent b'),false);
});
test('plain text session handoff is retained as actual next-session memory',t=>{
  const dir=temp(t),store=new WorkplaceStore(dir);t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const a=boot(store,'a');store.endSession({...a,handoff:'Resume the private architecture decision next time.'});
  const b=boot(store,'b');assert.ok(store.sync({...b,after:0}).events.some(e=>e.kind==='HANDOFF'&&e.body==='Resume the private architecture decision next time.'));
});
test('paired devices share the same persistent hub log with scoped sessions and revocable memory access',async t=>{
  const dir=temp(t);const listener=createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const hubToken='private-workplace-test-token-123456';
  const child=spawn(process.execPath,['gateway/src/workplace/workplace-server.mjs'],{env:{...process.env,JACO_WORKSPACE_ROOT:dir,JACO_WORKPLACE_PORT:String(port),JACO_WORKPLACE_HOST:'127.0.0.1',JACO_WORKPLACE_TOKEN:hubToken,JACO_WORKPLACE_SUPERVISE_NOVA:'0',JACO_WORKPLACE_SUPERVISE_SEER:'0',JACO_CHATGPT_RELAY_ENABLED:'0'},windowsHide:true,stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill();await exited;}});
  const base='http://127.0.0.1:'+port;let ready=false;
  for(let i=0;i<60;i++){try{ready=(await fetch(base+'/health')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,50));}assert.equal(ready,true);
  const registry=new DeviceRegistry(path.join(dir,'devices.json'));const laptop=registry.add('laptop'),phone=registry.add('phone');
  const app=express();app.use(express.json());mountDeviceWorkplace(app,registry,{baseUrl:base,token:hubToken});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
  const proxy='http://127.0.0.1:'+server.address().port+'/api/connected/device/workplace';
  let r=await fetch(proxy+'/health',{headers:{authorization:'Bearer '+laptop.key}});assert.equal(r.status,403);
  registry.setMemoryAccess('laptop',true);registry.setMemoryAccess('phone',true);
  const a=await bootstrapJacoAgent(card('Nova'),{baseUrl:proxy,token:laptop.key});const b=await bootstrapJacoAgent(card('Nova'),{baseUrl:proxy,token:phone.key});
  assert.notEqual(a.registration.agentId,b.registration.agentId);assert.equal(a.registration.permissions['deployment.execute'],false);assert.equal(JSON.stringify(a.registration).includes(hubToken),false);
  await a.client.post('FINDING','Private shared experience');assert.ok((await b.client.sync()).events.some(e=>e.body==='Private shared experience'));
  r=await fetch(proxy+'/v1/sync',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+phone.key,'x-jaco-session-token':a.client.sessionToken},body:JSON.stringify({sessionId:a.client.sessionId})});assert.equal(r.status,403);
  await assert.rejects(()=>a.client.post('DECISION','Unauthorized policy'),/PERMISSION_DENIED/);
  const next=await bootstrapJacoAgent(card('Nova'),{baseUrl:proxy,token:laptop.key});assert.ok(next.sync.events.some(e=>e.body==='Private shared experience'));
  const recalled=await joinWorkplace({card:card('Recall agent'),env:{JACO_WORKPLACE_URL:proxy,JACO_WORKPLACE_TOKEN:laptop.key},log:()=>{}});
  assert.equal(recalled.state,'READY');assert.ok(recalled.recall().some(e=>e.body==='Private shared experience'));await recalled.end();
  registry.setMemoryAccess('laptop',false);await assert.rejects(()=>next.client.sync(),/DEVICE_MEMORY_NOT_AUTHORIZED/);
  registry.revoke('phone');await assert.rejects(()=>b.client.sync(),/DEVICE_KEY_INVALID/);
});
test('operational memory and private database/key files cannot enter the Git tree',()=>{
  const tracked=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0');
  assert.deepEqual(tracked.filter(p=>p.startsWith('memory/')||p.includes('/.jaco/')||/\.(sqlite|key)$/.test(p)),[]);
});
