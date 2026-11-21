import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresHandoffStore} from '../../cloud/control/postgres-store.mjs';
import {createCloudHandoff, HandoffError} from '../../cloud/control/handoff.mjs';

const ID='ee74de11-d7b4-4bd2-8844-012345678901';
const row = (overrides={})=>({
  id:ID,tenantId:'tenant-1',deviceId:'device-12345678',
  goal:'Build and verify a local provider',requestHash:'a'.repeat(64),
  idempotencyKey:'sample-key-1000',state:'ACCEPTED',
  dispatchState:'NOT_DISPATCHED',receiptId:null,evidenceRef:null,
  createdAt:'2026-11-21T00:00:00.000Z',updatedAt:'2026-11-21T00:00:00.000Z',
  ...overrides,
});
function scriptedPool(rows) {
  const calls=[];
  return {calls,async query(sql,args) {
    calls.push({sql,args});
    return {rows:rows.shift()||[]};
  }};
}

test('Postgres adapter rejects missing Pool',()=>{
  assert.throws(()=>createPostgresHandoffStore(null),/POSTGRES_POOL_REQUIRED/);
});

test('unique tenant + key INSERT is parameterized and duplicate fallback cannot change existing goal',async()=>{
  const first=scriptedPool([[row()]]);
  const store=createPostgresHandoffStore(first);
  const value=row();
  assert.deepEqual(await store.reserveUnique(value),value);
  assert.match(first.calls[0].sql,/ON CONFLICT \(tenant_id,idempotency_key\) DO NOTHING RETURNING/);
  assert.equal(first.calls[0].args.length,12);
  assert.equal(first.calls[0].args[2],'device-12345678');
  assert.equal(first.calls[0].args[3],'Build and verify a local provider');
  assert.equal(first.calls[0].sql.includes('Build and verify'),false);

  const duplicate=scriptedPool([[],[value]]);
  const reused=await createPostgresHandoffStore(duplicate).reserveUnique({...value,id:'another-id',goal:'different goal'});
  assert.equal(reused.id,ID);
  assert.equal(reused.goal,value.goal);
  assert.equal(duplicate.calls.length,2);
  assert.match(duplicate.calls[1].sql,/WHERE tenant_id=\$1 AND idempotency_key=\$2/);
  assert.deepEqual(duplicate.calls[1].args,['tenant-1','sample-key-1000']);
});

test('dispatch is single atomic transition to UNKNOWN, never a blind retry',async()=>{
  const pool=scriptedPool([[row({state:'DELIVERY_UNKNOWN',dispatchState:'UNKNOWN'})],[]]);
  const store=createPostgresHandoffStore(pool);
  const r=await store.beginDispatch(ID,'2026-11-21T00:01:00.000Z');
  assert.equal(r.dispatchState,'UNKNOWN');
  assert.equal(await store.beginDispatch(ID,'2026-11-21T00:02:00.000Z'),null);
  for(const call of pool.calls) {
    assert.match(call.sql,/UPDATE jaco_cloud_missions/);
    assert.match(call.sql,/state='ACCEPTED' AND dispatch_state='NOT_DISPATCHED'/);
    assert.match(call.sql,/dispatch_state='UNKNOWN'/);
    assert.equal(call.args[0],ID);
  }
});

test('receipt CAS binds tenant/device/mission, forbids terminal overwrite and requires exact duplicate receipt',async()=>{
  const pool=scriptedPool([[row({
    state:'VERIFIED',dispatchState:'DELIVERED',receiptId:'receipt-12345678',
    evidenceRef:'evidence-12345678',
  })],[]]);
  const store=createPostgresHandoffStore(pool);
  const params={
    tenantId:'tenant-1',jobId:ID,deviceId:'device-12345678',
    state:'VERIFIED',receiptId:'receipt-12345678',
    evidenceRef:'evidence-12345678',
    updatedAt:'2026-11-21T00:01:00.000Z',
    allowedFrom:['RUNNING','RECEIVED','VERIFIED'],
  };
  const verified=await store.applyHostEvent(params);
  assert.equal(verified.state,'VERIFIED');
  assert.equal(await store.applyHostEvent({...params,receiptId:'receipt-other'}),null);
  const {sql,args}=pool.calls[0];
  assert.match(sql,/WHERE tenant_id=\$1 AND id=\$2::uuid AND device_id=\$3/);
  assert.match(sql,/dispatch_state<>'NOT_DISPATCHED'/);
  assert.match(sql,/receipt_id=\$5 AND evidence_ref IS NOT DISTINCT FROM \$6/);
  assert.match(sql,/state NOT IN \('VERIFIED','FAILED'\)/);
  assert.match(sql,/state=ANY\(\$8::text\[\]\)/);
  assert.deepEqual(args,[params.tenantId,params.jobId,params.deviceId,params.state,
    params.receiptId,params.evidenceRef,params.updatedAt,params.allowedFrom]);
});

test('query is always tenant scoped, UUID validation rejects malformed IDs before PostgreSQL',async()=>{
  const pool=scriptedPool([[row()]]);
  const store=createPostgresHandoffStore(pool);
  assert.equal((await store.get('tenant-1',ID)).id,ID);
  assert.match(pool.calls[0].sql,/WHERE tenant_id=\$1 AND id=\$2::uuid/);
  const service=createCloudHandoff({
    authenticateUser:async()=>({tenantId:'tenant-1',subject:'account-1',scopes:['missions:read']}),
    authenticateHost:async()=>null,
    authorizeDispatch:async()=>false,
    verifyEvidence:async()=>false,
    ownsDevice:async()=>true,
    store,
  });
  await assert.rejects(()=>service.status({bearer:'test',jobId:'------------------------------------'}),
    e=>e instanceof HandoffError && e.code==='TASK_ID_INVALID');
  assert.equal(pool.calls.length,1);
});
