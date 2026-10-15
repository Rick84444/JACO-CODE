#!/usr/bin/env node
import assert from 'node:assert/strict';import {spawn,spawnSync} from 'node:child_process';import net from 'node:net';import path from 'node:path';import {fileURLToPath} from 'node:url';import fs from 'node:fs';import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(e=>e?reject(e):resolve(p))})});
const child=spawn(process.execPath,['src/a2a-server.mjs'],{cwd:root,env:{...process.env,JACO_A2A_HOST:'127.0.0.1',JACO_A2A_PORT:String(port),JACO_BASE_URL:'http://127.0.0.1:1',JACO_A2A_STATE_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'jaco-a2a-continuum-'))},stdio:['ignore','pipe','pipe']});
try{
 for(let i=0;i<300;i++){try{const r=await fetch(`http://127.0.0.1:${port}/health`);if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,50));}
 const health=await (await fetch(`http://127.0.0.1:${port}/health`)).json();assert.equal(health.version,'0.22.0');assert.equal(health.protocol,'1.0');
 const card=await (await fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`)).json();assert.equal(card.version,'0.22.0');assert.equal(card.supportedInterfaces[0].protocolVersion,'1.0');
 const send=await (await fetch(`http://127.0.0.1:${port}/`,{method:'POST',headers:{'content-type':'application/json','A2A-Version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'SendMessage',params:{message:{messageId:'m1',role:'ROLE_USER',parts:[{text:'test inbound'}]}}})})).json();assert.equal(send.result.task.status.state,'TASK_STATE_FAILED');assert.equal(send.result.task.artifacts?.length||0,0);
 const unknown=await (await fetch(`http://127.0.0.1:${port}/`,{method:'POST',headers:{'content-type':'application/json','A2A-Version':'1.0'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'NoSuchMethod',params:{}})})).json();assert.equal(unknown.error.code,-32601);
 const exposed=spawnSync(process.execPath,['src/a2a-server.mjs'],{cwd:root,env:{...process.env,JACO_A2A_HOST:'127.0.0.1',JACO_A2A_PORT:'0',JACO_A2A_BEARER:'',JACO_A2A_PEERS:'',JACO_A2A_PUBLIC_URL:'https://a2a.example.com',JACO_A2A_STATE_DIR:fs.mkdtempSync(path.join(os.tmpdir(),'jaco-a2a-exposed-'))},encoding:'utf8',timeout:15000});assert.notEqual(exposed.status,0);assert.match(exposed.stderr,/Refusing to publish A2A/);
 console.log('A2A_CONTINUUM: PASS (health/card/truthful-failure/method-boundary/public-requires-credentials)');
}finally{child.kill('SIGTERM');}
