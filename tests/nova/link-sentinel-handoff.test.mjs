import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { permittedRemoteCall } from '../../site/jacocode.com/link-protocol.mjs';
import { createJacoLinkHost } from '../../runtime/src/server/connected/jacoLinkHost.mjs';

const read = file => fs.readFileSync(file,'utf8');
const did='abcdefghijklmnopqr';
const event = (id,method,path,body) => ({
  type:'rpc',id,method,path,...(body===undefined?{}:{body}),
});

test('Sentinel cold-start delegation only allows two exact lifecycle RPCs',()=>{
  assert.equal(permittedRemoteCall('GET','/api/jaco-link/system/status'),true);
  assert.equal(permittedRemoteCall('POST','/api/jaco-link/system/activate'),true);
  for (const [verb,route] of [
    ['POST','/api/jaco-link/system/status'],['GET','/api/jaco-link/system/activate'],
    ['POST','/api/system/update'],['POST','/api/link-host/stop'],
    ['POST','/api/jaco-link/system/activate/../shell'],
  ])assert.equal(permittedRemoteCall(verb,route),false,route);
});

test('Sentinel Link lifecycle interception never invokes a stopped Core or arbitrary fetch',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-link-handoff-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'link','host.json');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({hostToken:'a'.repeat(90),deviceId:did}),{mode:0o600});
  const socket=new EventEmitter();
  socket.readyState=1;
  const sent=[];
  socket.send=raw=>sent.push(JSON.parse(raw));
  socket.close=()=>{socket.readyState=3;socket.emit('close',1000);};
  let fetched=0,intercepted=0;
  const host=createJacoLinkHost({
    file,fetchImpl:async()=>{fetched++;throw Error('Core must not be touched');},
    websocketFactory:()=>socket,
    lifecycleRequest:async request=>{
      intercepted++;
      if(request.path==='/api/jaco-link/system/status')return {status:200,body:{state:'DOWN',coreReady:false}};
      if(request.path==='/api/jaco-link/system/activate')return {status:403,body:{error:'LINK_REMOTE_ACTIVATION_DISABLED'}};
      throw Error('Unexpected lifecycle route');
    },
  });
  host.resume();
  socket.emit('open');
  socket.emit('message',Buffer.from(JSON.stringify(event('12345678-status','GET','/api/jaco-link/system/status'))));
  socket.emit('message',Buffer.from(JSON.stringify(event('12345678-activate','POST','/api/jaco-link/system/activate',{}))));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(intercepted,2);
  assert.equal(fetched,0);
  assert.equal(sent[0].body.coreReady,false);
  assert.equal(sent[1].status,403);
  assert.equal(host.status().configured,true);
  host.stop();
});

test('opt-in ownership prevents Core and Sentinel opening two host connections',()=>{
  const core=read('runtime/server.ts'), sentinel=read('runtime/gateway/src/sentinel.mjs');
  assert.match(core,/linkOwnedBySentinel = process\.env\.JACO_LINK_LIFECYCLE_OWNER === 'sentinel'/);
  assert.match(core,/if \(!linkOwnedBySentinel\) \{/);
  assert.match(core,/sentinelLinkRequest\('GET','status',res\)/);
  assert.match(sentinel,/linkOwned = process\.env\.JACO_LINK_LIFECYCLE_OWNER === 'sentinel'/);
  assert.match(sentinel,/if \(linkOwned\) \{/);
  assert.match(sentinel,/JACO_LINK_REMOTE_ACTIVATE/);
  assert.match(sentinel,/config\.coreToken\.length < 24/);
  assert.match(sentinel,/system\.activate\('full', \{fromMcp:true\}\)/);
});
