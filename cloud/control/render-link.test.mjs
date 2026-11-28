import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRenderLink} from './render-link.mjs';

const DEVICE='device_123456789012345';
const ACCOUNT='account:upgrade-race';

class TestSocket extends EventEmitter {
  readyState=1;
  closeCode=null;
  closeReason=null;
  close(code,reason){
    if(this.readyState!==1)return;
    this.readyState=3;
    this.closeCode=code;
    this.closeReason=reason;
    this.emit('close');
  }
  send(){}
}

function fakePool(){
  const data=new Map();
  let failRead=false;
  return {
    setFailRead(value){failRead=value;},
    async query(sql,args=[]){
      if(sql.startsWith('SELECT ciphertext FROM jaco_link_kv')){
        if(failRead)throw Error('DATABASE_DOWN');
        const ciphertext=data.get(JSON.stringify([args[0],args[1]]));
        return {rows:ciphertext===undefined?[]:[{ciphertext}]};
      }
      if(sql.startsWith('INSERT INTO jaco_link_kv')){
        data.set(JSON.stringify([args[0],args[1]]),args[2]);
        return {rowCount:1};
      }
      if(sql.startsWith('DELETE FROM jaco_link_kv WHERE namespace=$1 AND key=$2')){
        data.delete(JSON.stringify([args[0],args[1]]));
        return {rowCount:1};
      }
      throw Error('UNEXPECTED_SQL: '+sql);
    },
  };
}

async function upgrade(room){
  const tokenExpiry=Math.floor(Date.now()/1000)+3600;
  const response=await room.fetch(new Request('https://internal/ws',{
    headers:{
      upgrade:'websocket',
      'x-jaco-link-role':'host',
      'x-jaco-link-device':DEVICE,
      'x-jaco-link-token-exp':String(tokenExpiry),
    },
  }));
  assert.equal(response.jacoUpgrade,true);
  return response;
}
async function settle(predicate){
  for(let i=0;i<100;i++){
    if(predicate())return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.fail('asynchronous WebSocket admission did not settle');
}

test('revoke between authorization and WebSocket accept rejects the late host',async()=>{
  const pool=fakePool();
  const link=createRenderLink(pool,Buffer.alloc(32,11));
  try{
    const room=link.LINK_ROOMS.get(ACCOUNT);
    const allowedBeforeRevocation=await upgrade(room);
    const revoked=await room.fetch(new Request('https://internal/revoke',{
      method:'POST',
      body:JSON.stringify({deviceId:DEVICE}),
    }));
    assert.equal(revoked.status,200);
    const socket=new TestSocket();
    allowedBeforeRevocation.room.accept(socket,allowedBeforeRevocation.attachment);
    await settle(()=>socket.closeCode!==null);
    assert.equal(socket.closeCode,4003);
    assert.equal(allowedBeforeRevocation.room.sockets.has(socket),false);
  }finally{link.close();}
});

test('host is admitted only after the durable check succeeds',async()=>{
  const pool=fakePool();
  const link=createRenderLink(pool,Buffer.alloc(32,12));
  try{
    const accepted=await upgrade(link.LINK_ROOMS.get(ACCOUNT));
    const socket=new TestSocket();
    accepted.room.accept(socket,accepted.attachment);
    assert.equal(accepted.room.sockets.has(socket),false);
    await settle(()=>accepted.room.sockets.has(socket));
    assert.equal(socket.closeCode,null);
  }finally{link.close();}
});

test('database failure during final host admission fails closed',async()=>{
  const pool=fakePool();
  const link=createRenderLink(pool,Buffer.alloc(32,13));
  try{
    const accepted=await upgrade(link.LINK_ROOMS.get(ACCOUNT));
    pool.setFailRead(true);
    const socket=new TestSocket();
    accepted.room.accept(socket,accepted.attachment);
    await settle(()=>socket.closeCode!==null);
    assert.equal(socket.closeCode,1011);
    assert.equal(accepted.room.sockets.has(socket),false);
  }finally{link.close();}
});

test('revoked socket with delayed close event cannot dispatch a queued message',async()=>{
  const pool=fakePool();
  const link=createRenderLink(pool,Buffer.alloc(32,14));
  class ClosingSocket extends TestSocket {
    close(code,reason){
      if(this.readyState!==1)return;
      this.readyState=2;this.closeCode=code;this.closeReason=reason;
      // Real WebSockets do not emit close until the handshake completes.
    }
  }
  try{
    const room=link.LINK_ROOMS.get(ACCOUNT);
    const accepted=await upgrade(room),socket=new ClosingSocket();
    accepted.room.accept(socket,accepted.attachment);
    await settle(()=>accepted.room.sockets.has(socket));
    let dispatched=0;
    accepted.room.handler.webSocketMessage=async()=>{dispatched++;};
    const revoked=room.fetch(new Request('https://internal/revoke',{
      method:'POST',body:JSON.stringify({deviceId:DEVICE}),
    }));
    socket.emit('message',Buffer.from('{}'),false);
    assert.equal((await revoked).status,200);
    await room.fetch('https://internal/hosts'); // drain account queue
    assert.equal(socket.readyState,2);
    assert.equal(socket.closeCode,4003);
    assert.equal(accepted.room.sockets.has(socket),true);
    assert.equal(dispatched,0);
    socket.readyState=3;socket.emit('close');
  }finally{link.close();}
});
test('host credential expiring between authorization and admission is rejected',async()=>{
  const pool=fakePool(),link=createRenderLink(pool,Buffer.alloc(32,15));
  try{
    const accepted=await upgrade(link.LINK_ROOMS.get(ACCOUNT)),socket=new TestSocket();
    accepted.room.accept(socket,{...accepted.attachment,expiresAt:Date.now()-1});
    await settle(()=>socket.closeCode!==null);
    assert.equal(socket.closeCode,4003);
    assert.equal(accepted.room.sockets.has(socket),false);
  }finally{link.close();}
});
