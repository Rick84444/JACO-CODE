import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { safeAuthReturn } from '../../site/jacocode.com/auth.mjs';
import { permittedRemoteCall, validateRemoteCall } from '../../site/jacocode.com/link-protocol.mjs';
import { JacoLinkPairing, JacoLinkRoom } from '../../site/jacocode.com/link.mjs';
import { createJacoLinkHost } from '../../runtime/src/server/connected/jacoLinkHost.mjs';

const did='abcdefghijklmnopqr';
const id='123e4567-e89b-42d3-a456-426614174000';
class Store {
  constructor(){this.data=new Map();}
  get(key){return Promise.resolve(this.data.get(key));}
  put(key,value){this.data.set(key,value);return Promise.resolve();}
  delete(key){this.data.delete(key);return Promise.resolve();}
  list({prefix}={}){return Promise.resolve(new Map([...this.data].filter(([key])=>key.startsWith(prefix||''))));}
}
class Socket {
  constructor(role,deviceId=null){this.attachment={role,deviceId,sessionId:role==='host'?'host-session-1':'phone-session-1',pending:[]};this.sent=[];this.closed=null;}
  deserializeAttachment(){return this.attachment;}
  serializeAttachment(value){this.attachment=structuredClone(value);}
  send(value){this.sent.push(JSON.parse(value));}
  close(code,reason){this.closed={code,reason};}
}
function room(){
  const storage=new Store(),sockets=[];
  const ctx={storage,getWebSockets:()=>sockets};
  return {ctx,sockets,storage,instance:new JacoLinkRoom(ctx)};
}
function rpc(method,path,body=undefined) {
  return {type:'rpc',id,method,path,...(body===undefined?{}:{body})};
}

test('remote RPC allows only intentional Aura operator capabilities and exact paths',()=>{
  for(const [method,path] of [
    ['GET','/api/aura/plan'],['GET','/api/aura/chat/session'],
    ['GET','/api/aura/workbench/local-memory'],['GET','/api/aura/workbench/approvals'],
    ['POST','/api/aura/chat'],['POST','/api/aura/workbench/start-goal'],
    ['POST','/api/aura/workbench/missions/abc-123/cancel'],
    ['POST','/api/aura/workbench/approvals/mission:abc/decision'],
  ])assert.equal(permittedRemoteCall(method,path),true,path);
  for(const path of [
    '/api/terminal/exec','/api/aura/workbench/file','/api/aura/workbench/mcp/call',
    '/api/aura/workbench/project','/api/aura/model','/api/aura/budget',
    '/api/aura/chat?secret=1','/api//aura/chat','/api/aura/../terminal/exec',
    '/api/aura/workbench/approvals/id/decision/../file',
  ])assert.equal(permittedRemoteCall('POST',path),false,path);
  assert.equal(validateRemoteCall(rpc('GET','/api/aura/plan',{bogus:true})).ok,false);
  assert.equal(validateRemoteCall(rpc('POST','/api/aura/chat')).ok,false);
  assert.equal(validateRemoteCall(rpc('POST','/api/aura/chat',{message:'a'.repeat(60000)})).ok,false);
});

test('Google OAuth return path cannot redirect customers to attacker origin',()=>{
  assert.equal(safeAuthReturn('/link/remote.html'),'/link/remote.html');
  assert.equal(safeAuthReturn('/link/connect.html?code=ABCDE'),'/link/connect.html?code=ABCDE');
  for(const target of ['https://evil.example','//evil.example','/auth/logout','/api/aura/chat',
                       '\\evil.com','/link/../../evil','/link/connect.html#fragment'])
    assert.ok(safeAuthReturn(target).startsWith('/')&&!safeAuthReturn(target).startsWith('//'));
  assert.equal(safeAuthReturn('//evil.example'),'/');
});

test('pending pairing is one-time and polling needs a separate 256-bit secret',async()=>{
  const store=new Store(),pair=new JacoLinkPairing({storage:store});
  const send=(pathname,body,method='POST')=>pair.fetch(new Request('https://internal'+pathname,{
    method,...(body?{body:JSON.stringify(body)}:{}),
  }));
  assert.equal((await send('/start',{hash:'correct-poll-token-hash',until:Date.now()+600000})).status,200);
  assert.equal((await send('/start',{hash:'other',until:Date.now()+600000})).status,409);
  assert.equal((await send('/poll?hash=bad',null,'GET')).status,401);
  assert.equal((await(await send('/poll?hash=correct-poll-token-hash',null,'GET')).json()).state,'PENDING');
  assert.equal((await send('/claim',{token:'signed-host-ticket'})).status,200);
  assert.equal((await send('/claim',{token:'second'})).status,409);
  const delivered=await(await send('/poll?hash=correct-poll-token-hash',null,'GET')).json();
  assert.equal(delivered.state,'APPROVED');
  assert.equal(delivered.hostToken,'signed-host-ticket');
  assert.equal((await send('/poll?hash=correct-poll-token-hash',null,'GET')).status,410);
});

test('distinct customer rooms cannot read, route or revoke each other’s Windows host',async()=>{
  const a=room(),b=room();
  const host=new Socket('host',did),phoneA=new Socket('phone'),phoneB=new Socket('phone');
  a.sockets.push(host,phoneA);b.sockets.push(phoneB);
  a.instance.webSocketMessage(phoneA,JSON.stringify(rpc('GET','/api/aura/plan')));
  assert.equal(host.sent.length,1);
  assert.equal('body' in host.sent[0],false,'GET must not invent body:null');
  // Simulate the cloud evicting the Durable Object JavaScript instance while
  // both WebSockets remain alive. Pending ownership must be on the socket.
  const resumed = new JacoLinkRoom(a.ctx);
  resumed.webSocketMessage(host,JSON.stringify({type:'rpc_result',id,status:200,body:{plans:[{name:'secret A'}]}}));
  assert.equal(phoneA.sent[0].body.plans[0].name,'secret A');
  assert.equal(phoneB.sent.length,0);
  b.instance.webSocketMessage(phoneB,JSON.stringify(rpc('GET','/api/aura/plan')));
  assert.equal(phoneB.sent.at(-1).body.error,'PC_OFFLINE');
  await a.storage.put('device:'+did,{createdAt:'2026-11-09T00:00:00Z'});
  assert.equal((await(await a.instance.fetch(new Request('https://internal/hosts'))).json()).hosts[0].deviceId,did);
  assert.equal((await a.instance.fetch(new Request('https://internal/revoke',{method:'POST',body:JSON.stringify({deviceId:did})}))).status,200);
  assert.equal(host.closed.code,4003);
  assert.equal(await a.storage.get('revoked:'+did),true,'revocations never expire from a bounded list');
  assert.equal(await b.storage.get('revoked:'+did),undefined,'different tenants remain isolated');
});

test('Windows host is outbound-only, stores no account passwords, and never forwards shell',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-link-unit-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'link','host.json'),calls=[];
  let scheduled=null,websocket=null;
  const fakeFetch=async(url,options={})=>{
    calls.push({url:String(url),method:options.method||'GET'});
    if(String(url).endsWith('/link/v1/start'))return Response.json({
      code:did,pollToken:'x'.repeat(48),expiresIn:600,
    });
    if(String(url).includes('/link/v1/poll?'))return Response.json({
      state:'APPROVED',hostToken:'a'.repeat(90),
    });
    if(String(url).includes('/api/aura/plan'))return Response.json({success:true,plans:[{goal:'Works'}]});
    throw Error('Unexpected endpoint '+url);
  };
  class Ws extends EventEmitter{
    constructor(){super();this.readyState=1;this.sent=[];this.options=null;}
    send(content){this.sent.push(JSON.parse(content));}
    close(){this.readyState=3;this.emit('close',1000);}
  }
  const host=createJacoLinkHost({
    file,fetchImpl:fakeFetch,schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{},
    websocketFactory:(url,options)=>{assert.match(url,/^wss:\/\/jacocode\.com\/link\/ws/);assert.match(options.headers.authorization,/^Bearer /);websocket=new Ws();return websocket;},
  });
  const pending=await host.startPairing();
  assert.equal(pending.state,'AWAITING_ACCOUNT_APPROVAL');
  assert.equal(pending.pairing.code,did);
  assert.equal(JSON.stringify(pending).includes('pollToken'),false);
  assert.ok(scheduled);
  scheduled();
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(host.status().configured,true);
  assert.equal(JSON.parse(fs.readFileSync(file)).deviceId,did);
  assert.equal(host.status().hostToken,undefined);
  websocket.emit('open');
  assert.equal(host.status().state,'CONNECTED');
  websocket.emit('message',Buffer.from(JSON.stringify(rpc('GET','/api/aura/plan'))));
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(websocket.sent[0].status,200);
  assert.deepEqual(websocket.sent[0].body.plans,[{goal:'Works'}]);
  websocket.emit('message',Buffer.from(JSON.stringify(rpc('POST','/api/terminal/exec',{command:'rm'}))));
  assert.equal(websocket.sent.at(-1).status,403);
  assert.equal(calls.filter(c=>c.url.includes('/api/terminal/')).length,0);
  host.stop();
});
test('Windows connector rejects alternate cloud origins and non-loopback local services',()=>{
  assert.throws(()=>createJacoLinkHost({file:'/tmp/link.json',origin:'https://evil.example'}),/LINK_ORIGIN_NOT_TRUSTED/);
  assert.throws(()=>createJacoLinkHost({file:'/tmp/link.json',localBaseUrl:'http://192.168.1.5:3000'}),/LINK_REQUIRES_LOCAL_AURA/);
});
test('mobile app has real installable assets and actual branded memory icon',()=>{
  const read=file=>fs.readFileSync(file,'utf8');
  const base='site/jacocode.com/public/link/';
  const manifest=JSON.parse(read(base+'manifest.webmanifest'));
  assert.equal(manifest.start_url,'/link/remote.html');
  assert.equal(manifest.display,'standalone');
  for(const file of ['remote.html','connect.html','remote.js','connect.js','style.css','icon.svg','memory-tree.png'])
    assert.ok(fs.statSync(base+file).size>100,file);
  assert.match(read(base+'remote.js'),/\/api\/aura\/workbench\/local-memory/);
  assert.match(read(base+'remote.js'),/\/api\/aura\/workbench\/missions\//);
  assert.match(read('runtime/src/components/DevicesView.tsx'),/jaco-link-onboarding/);
});

test('an old host socket cannot claim a response belonging to its replacement',()=>{
  const a=room();
  const first=new Socket('host',did),phone=new Socket('phone');
  a.sockets.push(first,phone);
  a.instance.webSocketMessage(phone,JSON.stringify(rpc('GET','/api/aura/plan')));
  assert.equal(phone.deserializeAttachment().pending.length,1);
  const replacement=new Socket('host',did);
  replacement.serializeAttachment({role:'host',deviceId:did,sessionId:'host-session-2',pending:[]});
  a.sockets.push(replacement);
  const resumed=new JacoLinkRoom(a.ctx);
  resumed.webSocketMessage(replacement,JSON.stringify({type:'rpc_result',id,status:200,body:{plans:['malicious']}}));
  assert.equal(phone.sent.length,0,'wrong host response is ignored');
  resumed.webSocketClose(first);
  assert.equal(phone.sent[0].body.error,'PC_DISCONNECTED_OUTCOME_UNKNOWN');
  assert.equal(phone.deserializeAttachment().pending.length,0);
});

test('pending mutation outcome survives DO restart without retrying it',()=>{
  const a=room(),host=new Socket('host',did),phone=new Socket('phone');
  a.sockets.push(host,phone);
  a.instance.webSocketMessage(phone,JSON.stringify(rpc('POST','/api/aura/chat',{message:'build it'})));
  assert.equal(host.sent.length,1);
  const resumed=new JacoLinkRoom(a.ctx);
  resumed.webSocketMessage(host,JSON.stringify({type:'rpc_result',id,status:202,body:{accepted:true}}));
  assert.equal(phone.sent[0].body.accepted,true);
  assert.equal(host.sent.length,1,'no duplicate mutation sent during resume');
});

test('operator approval viewer consumes the canonical approval-center items and legal actions',()=>{
  const ui=fs.readFileSync('site/jacocode.com/public/link/remote.js','utf8');
  assert.match(ui,/Array\.isArray\(data\.items\)/);
  assert.match(ui,/resume:'Återuppta'/);
  assert.match(ui,/confirm:'Bekräfta'/);
  assert.match(ui,/a\.actions\.includes\(choice\)/);
});
