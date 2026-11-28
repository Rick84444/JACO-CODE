import test from 'node:test';
import assert from 'node:assert/strict';
import {createLinkStorage,createRpcAdmission} from './render-store.mjs';
test('storage requires exact encryption key',()=>assert.throws(()=>createLinkStorage({},Buffer.alloc(31)),/LINK_STORAGE_KEY_REQUIRED/));
test('stored values are encrypted and bound to tenant and key',async()=>{
  let sealed;
  const pool={async query(sql,args){if(sql.startsWith('INSERT')){sealed=args[2];return {rows:[]};}return {rows:[{ciphertext:sealed}]};}};
  const storage=createLinkStorage(pool,Buffer.alloc(32,7));
  await storage('account:A').put('pair',{token:'private-device-ticket'});
  assert.equal(sealed.includes('private-device-ticket'),false);
  assert.deepEqual(await storage('account:A').get('pair'),{token:'private-device-ticket'});
  await assert.rejects(()=>storage('account:B').get('pair'));
  await assert.rejects(()=>storage('account:A').get('different'));
});
test('durable mutation admission and responses are tenant/device scoped',async()=>{
  const calls=[];const pool={async query(sql,args){calls.push([sql,args]);return {rowCount:calls.length===1?1:0};}};
  const rpc=createRpcAdmission(pool,'account:A');
  assert.equal(await rpc.reserve('device1','request1'),true);
  assert.equal(await rpc.reserve('device1','request1'),false);
  await rpc.response('device1','request1',200);
  assert.deepEqual(calls[0][1],['account:A','device1','request1']);
  assert.match(calls[0][0],/ON CONFLICT DO NOTHING/);
  assert.match(calls[2][0],/state='UNKNOWN'/);
});
