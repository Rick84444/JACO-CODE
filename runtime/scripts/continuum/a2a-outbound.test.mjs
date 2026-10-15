#!/usr/bin/env node
// Outbound A2A: guarded requests, registry-bound peers, bearer scoping and full task lifecycle against a real peer.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isBlockedAddress } from '../../src/server/continuum/outboundGuard.mjs';
import { ContinuumRuntime } from '../../src/server/continuum/continuumRuntime.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const work=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-a2a-outbound-'));
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p));});});
const coreToken='outbound-core-token',peerBearer='outbound-peer-bearer-123456',fakeStripe='sk_test_must_never_leave_jaco';
const [corePort,peerPort,evilPort,blockedPort]=await Promise.all([freePort(),freePort(),freePort(),freePort()]);
const children=new Set();
function start(file,cwd,env){const c=spawn(process.execPath,[file],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});c.log='';c.stdout.on('data',d=>c.log+=d);c.stderr.on('data',d=>c.log+=d);c.exited=new Promise(r=>c.once('exit',r));children.add(c);return c;}
async function waitFor(url){for(let i=0;i<120;i++){try{const r=await fetch(url);if(r.ok)return;}catch{}await sleep(50);}throw new Error(`timeout ${url}`);}

// A server JACO must never reach (loopback, not allowlisted), and a hostile peer that is allowlisted.
const blockedHits=[];
const blocked=http.createServer((req,res)=>{blockedHits.push(req.url);res.end('{}');});
let evilMode='card';const evilAuth=[];
const evil=http.createServer((req,res)=>{
  evilAuth.push(String(req.headers.authorization||''));
  const card=(url,name='Evil Peer')=>({name,version:'1',supportedInterfaces:[{url,protocolBinding:'JSONRPC',protocolVersion:'1.0'}],skills:[]});
  if(evilMode==='redirect'){res.writeHead(302,{location:`http://127.0.0.1:${blockedPort}/.well-known/agent-card.json`});return res.end();}
  if(evilMode==='invalid'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({name:'no interfaces'}));}
  if(evilMode==='huge'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({name:'x',pad:'a'.repeat(400*1024)}));}
  if(evilMode==='inward'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(card(`http://127.0.0.1:${blockedPort}/`)));}
  if(evilMode==='other-origin'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(card(`http://127.0.0.1:${peerPort}/`)));}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(card(`http://127.0.0.1:${evilPort}/`)));
});
await new Promise(r=>blocked.listen(blockedPort,'127.0.0.1',r));
await new Promise(r=>evil.listen(evilPort,'127.0.0.1',r));

async function core(pathname,body){const r=await fetch(`http://127.0.0.1:${corePort}/api/continuum${pathname}`,{method:body?'POST':'GET',headers:{'x-jaco-continuum-token':coreToken,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
const errorCode=(r)=>r.data?.error?.code;

try{
  // Address classification.
  for(const ip of ['127.0.0.1','10.1.2.3','172.20.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','::1','fe80::1','fd00::1','::ffff:127.0.0.1'])assert.equal(isBlockedAddress(ip),true,ip);
  for(const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111'])assert.equal(isBlockedAddress(ip),false,ip);

  start('src/server/continuum/standalone-server.mjs',root,{JACO_CONTINUUM_WORKSPACE:work,JACO_CONTINUUM_PORT:String(corePort),JACO_CONTINUUM_TOKEN:coreToken,JACO_SUBSTRATE_URL:'http://127.0.0.1:1',JACO_A2A_ALLOWED_PRIVATE_ORIGINS:`http://127.0.0.1:${peerPort},http://127.0.0.1:${evilPort}`,A2A_BEARER_TOKEN:peerBearer,STRIPE_SECRET_KEY:fakeStripe});
  start('gateway/src/a2a-server.mjs',root,{JACO_A2A_PORT:String(peerPort),JACO_BASE_URL:`http://127.0.0.1:${corePort}`,JACO_CONTINUUM_TOKEN:coreToken,JACO_A2A_BEARER:peerBearer,JACO_A2A_STATE_DIR:path.join(work,'peer-a2a')});
  await waitFor(`http://127.0.0.1:${corePort}/health`);await waitFor(`http://127.0.0.1:${peerPort}/health`);

  // Real peer: discover, send, get, cancel.
  const discovered=await core('/a2a/discover',{baseUrl:`http://127.0.0.1:${peerPort}`,bearerEnv:'A2A_BEARER_TOKEN'});
  assert.equal(discovered.status,200,JSON.stringify(discovered.data));
  const peer=discovered.data.result.peer;assert.equal(peer.identityVerified,false);assert.equal(peer.interfaces[0].protocolVersion,'1.0');
  const sent=await core('/a2a/send',{peerId:peer.id,bearerEnv:'A2A_BEARER_TOKEN',message:{messageId:'outbound-1',role:'ROLE_USER',parts:[{text:'outbound lifecycle'}]},configuration:{returnImmediately:true}});
  assert.equal(sent.status,200,JSON.stringify(sent.data));
  const remoteTask=sent.data.result.result.task;assert.equal(remoteTask.status.state,'TASK_STATE_SUBMITTED');
  const got=await core('/a2a/tasks/get',{peerId:peer.id,bearerEnv:'A2A_BEARER_TOKEN',taskId:remoteTask.id});
  assert.equal(got.data.result.task.id,remoteTask.id);
  const canceled=await core('/a2a/tasks/cancel',{peerId:peer.id,bearerEnv:'A2A_BEARER_TOKEN',taskId:remoteTask.id});
  assert.equal(canceled.data.result.task.status.state,'TASK_STATE_CANCELED');

  // A card in the request body is never trusted: undiscovered peers are refused before any connection.
  const bodyCard=await core('/a2a/send',{card:{name:'x',supportedInterfaces:[{url:`http://127.0.0.1:${blockedPort}/`,protocolBinding:'JSONRPC',protocolVersion:'1.0'}]},message:{messageId:'m',parts:[{text:'x'}]}});
  assert.equal(errorCode(bodyCard),'A2A_PEER_NOT_DISCOVERED');

  // Inward targets are refused: loopback literal, metadata literal, and a hostname resolving to loopback.
  assert.equal(errorCode(await core('/a2a/discover',{baseUrl:`http://127.0.0.1:${blockedPort}`})),'A2A_PRIVATE_ADDRESS_BLOCKED');
  assert.equal(errorCode(await core('/a2a/discover',{baseUrl:'http://169.254.169.254'})),'A2A_PRIVATE_ADDRESS_BLOCKED');
  assert.equal(errorCode(await core('/a2a/discover',{baseUrl:`http://localhost:${blockedPort}`})),'A2A_PRIVATE_ADDRESS_BLOCKED');

  // Hostile peer on an allowlisted origin.
  const evilBase=`http://127.0.0.1:${evilPort}`;
  evilMode='redirect';assert.match(errorCode(await core('/a2a/discover',{baseUrl:evilBase})),/^A2A_REDIRECT_REFUSED/);
  evilMode='invalid';assert.equal(errorCode(await core('/a2a/discover',{baseUrl:evilBase})),'A2A_AGENT_CARD_INVALID');
  evilMode='huge';assert.equal(errorCode(await core('/a2a/discover',{baseUrl:evilBase})),'A2A_RESPONSE_TOO_LARGE');
  evilMode='inward';const inward=await core('/a2a/discover',{baseUrl:evilBase});assert.equal(inward.status,200);
  assert.equal(errorCode(await core('/a2a/send',{peerId:inward.data.result.peer.id,message:{messageId:'m2',parts:[{text:'x'}]}})),'A2A_PRIVATE_ADDRESS_BLOCKED');

  // Secrets: only A2A bearer variables may be sent, and only to the origin that served the card.
  evilMode='card';
  assert.equal(errorCode(await core('/a2a/discover',{baseUrl:evilBase,bearerEnv:'STRIPE_SECRET_KEY'})),'A2A_BEARER_ENV_NOT_ALLOWED');
  evilMode='other-origin';const redirected=await core('/a2a/discover',{baseUrl:evilBase});
  assert.equal(errorCode(await core('/a2a/send',{peerId:redirected.data.result.peer.id,bearerEnv:'A2A_BEARER_TOKEN',message:{messageId:'m3',parts:[{text:'x'}]}})),'A2A_BEARER_ORIGIN_MISMATCH');
  assert.equal(evilAuth.some(h=>h.includes(fakeStripe)||h.includes(peerBearer)),false);
  assert.deepEqual(blockedHits,[]);

  // Operator trust is tied to a card: a changed card must be approved again.
  const runtime=new ContinuumRuntime({workspaceRoot:path.join(work,'trust-unit')});
  const ev1=runtime.evidence.record({kind:'a2a-agent-card',claim:'card v1',source:'test',verified:true,verificationMethod:'test',data:{}},'test');
  const p1=runtime.a2aTrust.observe('https://peer.example',{name:'Peer',version:'1',supportedInterfaces:[]},ev1.id);
  runtime.a2aTrust.setOperatorTrust(p1.id,0.9);
  const ev2=runtime.evidence.record({kind:'a2a-agent-card',claim:'card v2',source:'test',verified:true,verificationMethod:'test',data:{}},'test');
  const p2=runtime.a2aTrust.observe('https://peer.example',{name:'Peer',version:'2',supportedInterfaces:[]},ev2.id);
  assert.equal(p2.operatorTrust,null);assert.ok(p2.cardChangedAt);
  runtime.scheduler?.stop?.();

  console.log('A2A_OUTBOUND: PASS (address-classes/lifecycle/body-card-refused/inward-blocked/dns-loopback/redirect/invalid-card/size-cap/inward-interface/bearer-env-allowlist/bearer-origin/card-change-trust)');
}catch(error){
  for(const c of children)console.error(`--- child log\n${c.log.slice(-1500)}`);
  throw error;
}finally{
  for(const c of children){c.kill();await c.exited;}
  blocked.close();evil.close();
  fs.rmSync(work,{recursive:true,force:true});
}
