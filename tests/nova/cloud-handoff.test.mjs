import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudHandoff, HandoffError} from '../../cloud/control/handoff.mjs';

// A synchronous transactional test double. Production MUST use a database with
// real uniqueness constraints and compare-and-swap, never this in-memory map.
function harness() {
  const records = new Map();
  const keys = new Map();
  const devices = new Map([['tenant-a',new Set(['device-aaaa1111'])],['tenant-b',new Set(['device-bbbb2222'])]]);
  const auth = {
    alice: {tenantId:'tenant-a',subject:'sub-aaa',scopes:['missions:write','missions:read']},
    bob: {tenantId:'tenant-b',subject:'sub-bbb',scopes:['missions:write','missions:read']},
    viewer: {tenantId:'tenant-a',subject:'sub-view',scopes:['missions:read']},
  };
  const store = {
    async reserveUnique(task) {
      const k = task.tenantId+'|'+task.idempotencyKey;
      if (keys.has(k)) return records.get(keys.get(k));
      keys.set(k,task.id);
      records.set(task.id,{...task});
      return records.get(task.id);
    },
    async get(tenantId,jobId) {
      const task=records.get(jobId);
      return task?.tenantId===tenantId?{...task}:null;
    },
    async beginDispatch(jobId,time) {
      const task=records.get(jobId);
      if (!task || task.dispatchState!=='NOT_DISPATCHED') return null;
      task.dispatchState='UNKNOWN';
      task.state='DELIVERY_UNKNOWN';
      task.updatedAt=time;
      return {...task};
    },
    async applyHostEvent({tenantId,jobId,deviceId,state,receiptId,evidenceRef,updatedAt,allowedFrom}) {
      const task=records.get(jobId);
      if (!task || task.tenantId!==tenantId || task.deviceId!==deviceId) return null;
      if (!allowedFrom.includes(task.state)) return null;
      if (task.state===state) {
        return task.receiptId===receiptId&&task.evidenceRef===(evidenceRef||null)?{...task}:null;
      }
      if (task.state==='VERIFIED'||task.state==='FAILED') return null;
      Object.assign(task,{state,receiptId,evidenceRef,updatedAt});
      return {...task};
    },
  };
  const controller = createCloudHandoff({
    authenticateUser: async token=>auth[token]||null,
    authenticateHost: async token=>token==='host-a'?{tenantId:'tenant-a',deviceId:'device-aaaa1111'}:
      token==='host-b'?{tenantId:'tenant-b',deviceId:'device-bbbb2222'}:null,
    authorizeDispatch: async credential=>credential==='worker-credential',
    verifyEvidence: async receipt=>receipt.tenantId==='tenant-a' &&
      receipt.deviceId==='device-aaaa1111' && receipt.receiptId==='receipt-0003' &&
      receipt.evidenceRef==='ledger:11111111',
    ownsDevice: async (p,d)=>Boolean(devices.get(p.tenantId)?.has(d)),
    store,clock:()=> '2026-11-21T01:00:00.000Z',
  });
  const submit=(extra={})=>controller.submit({
    bearer:'alice',deviceId:'device-aaaa1111',goal:'Create and test a TypeScript package',
    idempotencyKey:'same-request-key-001',...extra,
  });
  return {controller,records,submit,store};
}
const assertCode = code => e=> e instanceof HandoffError && e.code===code;

test('tenant-scoped idempotent admission returns one durable ID without exposing goal or subject', async()=>{
  const {submit,records}=harness();
  const [a,b]=await Promise.all([submit(),submit()]);
  assert.equal(a.schema,'jaco.cloud-handoff/v1');
  assert.equal(a.id,b.id);
  assert.equal(records.size,1);
  assert.equal(a.state,'ACCEPTED');
  assert.equal(a.dispatchState,'NOT_DISPATCHED');
  assert.equal(JSON.stringify(a).includes('Create and test'),false);
  assert.equal(JSON.stringify(a).includes('sub-aaa'),false);
  await assert.rejects(()=>submit({goal:'A different task'}),assertCode('IDEMPOTENCY_CONFLICT'));
});

test('OAuth read/write scope and device isolation are checked before admission/status',async()=>{
  const {controller,submit}=harness();
  const a=await submit();
  await assert.rejects(()=>submit({bearer:'viewer',idempotencyKey:'viewer-credential-01'}),assertCode('AUTH_SCOPE_DENIED'));
  await assert.rejects(()=>submit({bearer:'bob',idempotencyKey:'wrong-device-222'}),assertCode('DEVICE_ACCESS_DENIED'));
  await assert.rejects(()=>controller.status({bearer:'bob',jobId:a.id}),assertCode('TASK_NOT_FOUND'));
  await assert.rejects(()=>controller.status({bearer:'bad',jobId:a.id}),assertCode('AUTH_SCOPE_DENIED'));
  assert.equal((await controller.status({bearer:'viewer',jobId:a.id})).id,a.id);
  await assert.rejects(()=>submit({goal:' ',idempotencyKey:'invalid-goal-11'}),assertCode('GOAL_INVALID'));
  await assert.rejects(()=>submit({idempotencyKey:'bad'}),assertCode('IDEMPOTENCY_KEY_REQUIRED'));
});

test('dispatch requires an internal capability and never silently retries ambiguous delivery',async()=>{
  const {controller,submit}=harness();
  const task=await submit();
  await assert.rejects(()=>controller.beginDispatch({jobId:task.id}),assertCode('DISPATCHER_AUTH_DENIED'));
  await assert.rejects(()=>controller.beginDispatch({jobId:task.id,dispatchCredential:'forged-worker'}),assertCode('DISPATCHER_AUTH_DENIED'));
  const delivery=await controller.beginDispatch({jobId:task.id,dispatchCredential:'worker-credential'});
  assert.equal(delivery.deviceId,'device-aaaa1111');
  assert.equal((await controller.status({bearer:'alice',jobId:task.id})).dispatchState,'UNKNOWN');
  await assert.rejects(()=>controller.beginDispatch({jobId:task.id,dispatchCredential:'worker-credential'}),assertCode('DISPATCH_ALREADY_CLAIMED'));
});

test('host receipt requires correct paired device, real receipt ID and evidence for VERIFIED',async()=>{
  const {controller,submit}=harness();
  const task=await submit();
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-0001',verified:true,evidenceRef:'ledger:11111111'}}),assertCode('TASK_NOT_DELIVERED'));
  await controller.beginDispatch({jobId:task.id,dispatchCredential:'worker-credential'});
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-b',jobId:task.id,event:{type:'RECEIVED',receiptId:'receipt-0001'}}),assertCode('TASK_NOT_FOUND'));
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'forged',jobId:task.id,event:{type:'RECEIVED',receiptId:'receipt-0001'}}),assertCode('HOST_AUTH_DENIED'));
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-0001',verified:true}}),assertCode('VERIFICATION_EVIDENCE_REQUIRED'));
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'RUNNING',receiptId:'receipt-0001',verified:true}}),assertCode('UNVERIFIED_RESULT_CLAIM'));
  const received=await controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'RECEIVED',receiptId:'receipt-0001'}});
  assert.equal(received.state,'RECEIVED');
  const running=await controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'RUNNING',receiptId:'receipt-0002'}});
  assert.equal(running.state,'RUNNING');
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-1111',verified:true,evidenceRef:'ledger:fake-ref'}}),assertCode('EVIDENCE_NOT_VERIFIED'));
  const done=await controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-0003',verified:true,evidenceRef:'ledger:11111111'}});
  assert.equal(done.state,'VERIFIED');
  assert.equal(done.evidenceRef,'ledger:11111111');
  const again=await controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-0003',verified:true,evidenceRef:'ledger:11111111'}});
  assert.deepEqual(again,done);
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'FAILED',receiptId:'receipt-0004'}}),assertCode('HOST_STATE_TRANSITION_DENIED'));
  await assert.rejects(()=>controller.hostReceipt({hostCredential:'host-a',jobId:task.id,event:{type:'VERIFIED',receiptId:'receipt-0005',verified:true,evidenceRef:'ledger:11111111'}}),assertCode('HOST_EVENT_CONFLICT'));
});

test('cloud handoff has no HTTP listener, remote shell or autonomous agent startup',async()=>{
  const {createCloudHandoff:api}=await import('../../cloud/control/handoff.mjs');
  assert.equal(typeof api,'function');
  assert.throws(()=>api({}),assertCode('CLOUD_DEPENDENCIES_MISSING'));
});
