import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const TOKEN='test-token-12345678901234567890';

// Minimal RFC 6455 reader for unmasked server text frames.
function readFrames(socket,onText){
  let buffer=Buffer.alloc(0);
  socket.on('data',chunk=>{
    buffer=Buffer.concat([buffer,chunk]);
    for(;;){
      if(buffer.length<2)return;
      let length=buffer[1]&0x7f,offset=2;
      if(length===126){if(buffer.length<4)return;length=buffer.readUInt16BE(2);offset=4;}
      else if(length===127){if(buffer.length<10)return;length=Number(buffer.readBigUInt64BE(2));offset=10;}
      if(buffer.length<offset+length)return;
      onText(buffer.subarray(offset,offset+length).toString('utf8'));
      buffer=buffer.subarray(offset+length);
    }
  });
}

test('SEER event stream delivers messages of every WebSocket length class intact',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'seer-ws-'));
  const child=spawn(process.execPath,['gateway/src/seer.mjs'],{env:{PATH:process.env.PATH,SEER_PORT:'0',SEER_STATE_DIR:dir,JACO_GATEWAY_TOKEN:TOKEN,JACO_RUNTIME_URL:'http://127.0.0.1:9'},stdio:['ignore','pipe','pipe']});
  const exited=new Promise(r=>child.once('exit',r));
  t.after(async()=>{child.kill();await exited;rmSync(dir,{recursive:true,force:true});});
  let output='';
  const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('SEER_START_TIMEOUT '+output)),5000);child.stdout.on('data',c=>{output+=c;const m=output.match(/JACO_SEER_LISTENING port=(\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});

  const socket=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/cortex/events/ws',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':crypto.randomBytes(16).toString('base64'),Authorization:`Bearer ${TOKEN}`}});
    req.on('upgrade',(_res,sock)=>resolve(sock));req.on('error',reject);req.end();
  });
  socket.on('error',()=>{});
  const received=[];
  readFrames(socket,text=>received.push(JSON.parse(text)));

  // memory.set events carry the key, so key length controls the frame size: 7-bit, 16-bit and 64-bit length classes.
  const keys=['short',`medium-${'m'.repeat(300)}`,`large-${'l'.repeat(70000)}`];
  for(const key of keys){
    const r=await fetch(`http://127.0.0.1:${port}/cortex/memory`,{method:'POST',headers:{authorization:`Bearer ${TOKEN}`,'content-type':'application/json'},body:JSON.stringify({key,value:1})});
    assert.equal(r.status,200);
  }
  const deadline=Date.now()+5000;
  while(received.filter(e=>e.type==='memory.set').length<keys.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.deepEqual(received.filter(e=>e.type==='memory.set').map(e=>e.payload.key),keys);
  socket.destroy();
});
