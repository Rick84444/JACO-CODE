import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createInputBridgeDaemon} from '../../agents/lib/input-bridge-daemon.mjs';
function worker(handler){
  const c=new EventEmitter();
  c.stdout=new PassThrough();c.stderr=new PassThrough();
  c.kill=()=>{c.emit('exit');return true;};
  c.stdin=new Writable({write(chunk,_encoding,done){handler(JSON.parse(chunk.toString()),c);done();}});
  return c;
}
const answer=(c,request,extra={})=>c.stdout.write(JSON.stringify({reqId:request.reqId,ok:true,verified:true,...extra})+'\n');
test('persistent bridge uses one process and serializes correlated requests',async()=>{
  let starts=0;const requests=[];
  const bridge=createInputBridgeDaemon('fixture',{platform:'win32',spawnImpl:()=>{starts++;return worker((r,c)=>{requests.push(r);answer(c,r);});}});
  try{
    const results=await Promise.all([bridge.send({op:'get_cursor'}),bridge.send({op:'get_cursor'})]);
    assert.equal(starts,1);assert.equal(requests.length,2);assert.notEqual(requests[0].reqId,requests[1].reqId);
    assert.ok(requests.every(r=>r.DeadlineMs>Date.now()));assert.ok(results.every(r=>r.ok&&r.verified));
  }finally{bridge.close();}
});
test('uncorrelated response cannot attest mutation; queued work is not dispatched',async()=>{
  let calls=0;
  const bridge=createInputBridgeDaemon('fixture',{platform:'win32',spawnImpl:()=>worker((r,c)=>{calls++;c.stdout.write('{"ok":true,"verified":true}\n');})});
  try{
    const [a,b]=await Promise.all([bridge.send({op:'mouse_click'}),bridge.send({op:'get_cursor'})]);
    assert.equal(a.outcomeUnknown,true);assert.equal(a.verified,false);
    assert.equal(b.outcomeUnknown,false);assert.equal(calls,1);
  }finally{bridge.close();}
});
test('timeout does not replay input or admit further dispatch',async()=>{
  let calls=0;
  const bridge=createInputBridgeDaemon('fixture',{platform:'win32',spawnImpl:()=>worker(()=>{calls++;})});
  try{
    const a=await bridge.send({op:'key_press'},100);
    assert.equal(a.error,'BRIDGE_TIMEOUT');assert.equal(a.outcomeUnknown,true);
    assert.equal((await bridge.send({op:'key_press'})).ok,false);assert.equal(calls,1);
  }finally{bridge.close();}
});
test('actual Windows daemon compiles and executes consecutive non-input fixtures',{skip:process.platform!=='win32'},async()=>{
  const script=fileURLToPath(new URL('../../agents/input-bridge.ps1',import.meta.url));
  const bridge=createInputBridgeDaemon(script);
  try{
    for(let i=0;i<2;i++){
      const result=await bridge.send({op:'self_test'},30000);
      assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.checks,3);assert.equal(result.inputDispatched,false);
    }
  }finally{bridge.close();}
});

test('read-only interactive session probe reuses the original single Win32 worker',async()=>{
  let starts=0,mutations=0;
  const bridge=createInputBridgeDaemon('fixture',{platform:'win32',spawnImpl:()=>{
    starts++;
    return worker((request,child)=>{
      if(request.op!=='session_status')mutations++;
      answer(child,request,{schema:'jaco.desktop-session/v1',interactive:true,sessionId:2,foregroundHwnd:410,inputDesktop:'Default'});
    });
  }});
  try {
    const result=await bridge.send({op:'session_status'});
    assert.equal(result.ok,true);
    assert.equal(result.sessionId,2);
    assert.equal(mutations,0);
    assert.equal(starts,1);
  } finally {bridge.close();}
});
