import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserSessionManager } from '../../runtime/src/server/browser/router.ts';
import { CdpBridge, localCdpSocketUrl } from '../../runtime/src/server/browser/browserHandsOff.ts';

const url = 'https://work.example/project';
const input = {port:9222,urlIncludes:url};
const temp = fn => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cdp-attach-'));
  return Promise.resolve().then(()=>fn(root)).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
};
const bridge = (id) => ({targetId:id,closed:0,close:async function(){this.closed++}});

test('CDP target WebSocket remains on the actual local browser debugging port',()=>{
  assert.equal(localCdpSocketUrl('ws://127.0.0.1:9222/devtools/page/A',9222),'ws://127.0.0.1:9222/devtools/page/A');
  assert.equal(localCdpSocketUrl('ws://localhost:9222/devtools/page/B',9222),'ws://localhost:9222/devtools/page/B');
  for(const value of [
    'ws://evil.example:9222/devtools/page/X',
    'wss://127.0.0.1:9222/devtools/page/X',
    'ws://127.0.0.1:1337/devtools/page/X',
    'ws://user:pass@127.0.0.1:9222/devtools/page/X',
    'ws://127.0.0.1:9222/another-endpoint',
    'not-a-websocket',
  ]) assert.throws(()=>localCdpSocketUrl(value,9222),/CDP_SOCKET/);
});

test('failed or invalid CDP reattachment preserves the existing browser session',async()=>{
  await temp(async root=>{
    const original=CdpBridge.attach,first=bridge('original');
    const manager=new BrowserSessionManager(root);
    try {
      CdpBridge.attach=async()=>first;
      const snap=await manager.attach(input);
      assert.equal(snap.targetId,'original');
      CdpBridge.attach=async()=>{throw Error('CDP_TARGET_AMBIGUOUS')};
      await assert.rejects(manager.attach({...input,urlIncludes:'another'}),/CDP_TARGET_AMBIGUOUS/);
      await assert.rejects(manager.attach({...input,port:65536}),/invalid CDP port/);
      assert.equal(manager.snapshot().targetId,'original');
      assert.equal(manager.getClient() !== null,true);
      assert.equal(first.closed,0);
    }finally{CdpBridge.attach=original;await manager.detach();}
  });
});

test('verified CDP attachment atomically replaces and closes prior transport',async()=>{
  await temp(async root=>{
    const original=CdpBridge.attach,a=bridge('a'),b=bridge('b');
    const manager=new BrowserSessionManager(root);
    try {
      CdpBridge.attach=async(_port,pattern)=>pattern==='second'?b:a;
      await manager.attach(input);
      const updated=await manager.attach({...input,urlIncludes:'second'});
      assert.equal(updated.targetId,'b');
      assert.equal(a.closed,1);
      assert.equal(b.closed,0);
      assert.equal(updated.urlIncludes,'second');
    }finally{CdpBridge.attach=original;await manager.detach();}
  });
});

test('detach invalidates an in-flight CDP connection rather than restoring an old tab',async()=>{
  await temp(async root=>{
    const original=CdpBridge.attach,late=bridge('late');
    const manager=new BrowserSessionManager(root);
    let release;
    try {
      CdpBridge.attach=()=>new Promise(resolve=>{release=resolve;});
      const pending=manager.attach(input);
      await manager.detach();
      release(late);
      await assert.rejects(pending,/CDP_ATTACH_SUPERSEDED/);
      assert.equal(late.closed,1);
      assert.equal(manager.getClient(),null);
    }finally{CdpBridge.attach=original;await manager.detach();}
  });
});

test('slow detach cannot erase a newer successfully attached browser target',async()=>{
  await temp(async root=>{
    const original=CdpBridge.attach,a=bridge('a'),b=bridge('b');
    const manager=new BrowserSessionManager(root);
    let finishOldClose;
    try {
      CdpBridge.attach=async(_port,pattern)=>pattern==='second'?b:a;
      await manager.attach(input);
      a.close=()=>new Promise(resolve=>{finishOldClose=resolve;});
      const detaching=manager.detach();
      assert.equal(manager.getClient(),null,'detach invalidates the old session immediately');
      const next=await manager.attach({...input,urlIncludes:'second'});
      finishOldClose();
      await detaching;
      assert.equal(next.targetId,'b');
      assert.equal(manager.snapshot().targetId,'b');
      assert.notEqual(manager.getClient(),null);
    }finally{CdpBridge.attach=original;await manager.detach();}
  });
});
