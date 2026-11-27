import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import {createLinkStorage,createRpcAdmission} from './render-store.mjs';
import {createPostgresHandoffStore} from './postgres-store.mjs';
test('real PostgreSQL persists account/device admissions and handoff across pool restart',async()=>{
  assert.ok(process.env.DATABASE_URL,'DATABASE_URL required for real integration test');
  const key=randomBytes(32),account='account:'+randomUUID(),device='device_test_1234',request='request_test_1234';
  let pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try{
    for(const file of ['001_missions.sql','002_link.sql'])await pool.query(await readFile(new URL('./sql/'+file,import.meta.url),'utf8'));
    const storage=createLinkStorage(pool,key);
    await storage(account).put('device:'+device,{createdAt:'test'});
    assert.equal(await storage(account+'-other').get('device:'+device),undefined);
    const results=await Promise.all(Array.from({length:12},()=>createRpcAdmission(pool,account).reserve(device,request)));
    assert.equal(results.filter(Boolean).length,1);
    const now=new Date().toISOString(),task={id:randomUUID(),tenantId:account,deviceId:device,goal:'Test mission',requestHash:'a'.repeat(64),idempotencyKey:'test_key_1234',state:'ACCEPTED',dispatchState:'NOT_DISPATCHED',receiptId:null,evidenceRef:null,createdAt:now,updatedAt:now};
    const store=createPostgresHandoffStore(pool);
    const reservations=await Promise.all(Array.from({length:12},()=>store.reserveUnique({...task,id:randomUUID()})));
    const id=reservations[0].id;assert.equal(new Set(reservations.map(r=>r.id)).size,1);
    const claims=await Promise.all(Array.from({length:12},()=>store.beginDispatch(id,now)));assert.equal(claims.filter(Boolean).length,1);
    await pool.end();pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
    assert.deepEqual(await createLinkStorage(pool,key)(account).get('device:'+device),{createdAt:'test'});
    assert.equal(await createRpcAdmission(pool,account).reserve(device,request),false);
    assert.equal((await createPostgresHandoffStore(pool).get(account,id)).dispatchState,'UNKNOWN');
    assert.equal(await createPostgresHandoffStore(pool).get(account+'-other',id),null);
  }finally{await pool.end();}
});
