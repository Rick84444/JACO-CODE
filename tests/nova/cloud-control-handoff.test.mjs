import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudHandoff, HandoffError} from '../../cloud/control/handoff.mjs';

const deviceA='device_account_A_01';
const deviceB='device_account_B_02';
const key='unique-request-0001';
const auth = {
  A: {tenantId:'tenant-A',subject:'google-sub-A',scopes:['missions:read','missions:write']},
  B: {tenantId:'tenant-B',subject:'google-sub-B',scopes:['missions:read','missions:write']},
  RO: {tenantId:'tenant-A',subject:'google-sub-A',scopes:['missions:read']},
};
function fixture() {
  const tasks=new Map(),unique=new Map();
  let events=0;
  const store={
    async reserveUnique(task) {
      const keyValue=task.tenantId+':'+task.idempotencyKey;
      const id=unique.get(keyValue);
      if (id) return structuredClone(tasks.get(id));
      tasks.set(task.id,structuredClone(task));
      unique.set(keyValue,task.id);
      return structuredClone(task);
    },
    async get(tenant,id) {
      const task=tasks.get(id);
      return task?.tenantId===tenant ? structuredClone(task) : null;
    },
    async beginDispatch(id,at) {
      const task=tasks.get(id);
      if (!task || task.dispatchState!=='NOT_DISPATCHED') return null;
      task.dispatchState='UNKNOWN';
      task.state='DELIVERY_UNKNOWN';
      task.updatedAt=at;
      return structuredClone(task);
    },
    async applyHostEvent(e) {
      const task=tasks.get(e.jobId);
      if (!task || task.tenantId!==e.tenantId || task.deviceId!==e.deviceId ||
          !e.allowedFrom.includes(task.state)) return null;
      if (task.state===e.state) {
        return task.receiptId===e.receiptId ? structuredClone(task) : null;
      }
      task.state=e.state;
      task.dispatchState='DELIVERED';
      task.receiptId=e.receiptId;
      task.evidenceRef=e.evidenceRef;
      task.updatedAt=e.updatedAt;
      events++;
      return structuredClone(task);
    },
  };
  const service=createCloudHandoff({
    authenticateUser:async bearer=>auth[bearer]||null,
    authenticateHost:async credential=>({
      hostA:{tenantId:'tenant-A',deviceId:deviceA},
      hostB:{tenantId:'tenant-B',deviceId:deviceB},
    })[credential]||null,
    // Only configured server-side dependencies can authorize dispatch or
    // verify canonical evidence. No caller-provided callback is trusted.
    authorizeDispatch:async credential=>credential==='internal-dispatcher-key',
    verifyEvidence:async ({tenantId,deviceId,jobId,receiptId,evidenceRef})=>{
      const task=tasks.get(jobId);
      return task?.tenantId===tenantId && task.deviceId===deviceId &&
        evidenceRef==='evidence-12345678' &&
        ['receipt-test-1006','receipt-test-1008'].includes(receiptId);
    },
    ownsDevice:async (actor,id)=>actor.tenantId==='tenant-A'?id===deviceA:id===deviceB,
    store, clock:()=> '2026-11-21T00:00:00.000Z',
  });
  return {service,tasks,events:()=>events};
}
const submit=(service,bearer='A',opts={})=>service.submit({
  bearer,deviceId:bearer==='B'?deviceB:deviceA,
  goal:'Build the gateway and run regression tests',idempotencyKey:key,...opts,
});
const bad=async(p,code)=>assert.rejects(p,e=>e instanceof HandoffError&&e.code===code);

test('fail closed: no verifier or durable store adapter',()=>{
  assert.throws(()=>createCloudHandoff({}),e=>e.code==='CLOUD_DEPENDENCIES_MISSING');
});

test('OAuth-derived tenant and explicit scopes protect creation and status',async()=>{
  const {service}=fixture();
  await bad(submit(service,'RO'),'AUTH_SCOPE_DENIED');
  await bad(submit(service,'UNVERIFIED'),'AUTH_SCOPE_DENIED');
  await bad(submit(service,'A',{deviceId:deviceB}),'DEVICE_ACCESS_DENIED');
  const a=await submit(service,'A');
  assert.equal(a.state,'ACCEPTED');
  assert.equal(a.dispatchState,'NOT_DISPATCHED');
  assert.equal(a.schema,'jaco.cloud-handoff/v1');
  assert.equal(a.tenantId,undefined);
  assert.equal(a.goal,undefined); // No raw mission content in generic receipts.
  assert.deepEqual(await service.status({bearer:'A',jobId:a.id}),a);
  await bad(service.status({bearer:'B',jobId:a.id}),'TASK_NOT_FOUND');
  await bad(service.status({bearer:'RO',jobId:a.id+'oops'}),'TASK_ID_INVALID');
});

test('durable idempotency scoped to tenant, conflicting reuse denied',async()=>{
  const {service}=fixture();
  const a=await submit(service,'A');
  assert.deepEqual(await submit(service,'A'),a);
  await bad(submit(service,'A',{goal:'Different intent'}),'IDEMPOTENCY_CONFLICT');
  const b=await submit(service,'B');
  assert.notEqual(a.id,b.id);
});

test('beginDispatch marks UNKNOWN before delivery and forbids automatic retry',async()=>{
  const {service}=fixture();
  const task=await submit(service);
  await bad(service.beginDispatch({jobId:task.id}),'DISPATCHER_AUTH_DENIED');
  await bad(service.beginDispatch({jobId:task.id,dispatchCredential:'forged'}),'DISPATCHER_AUTH_DENIED');
  await bad(service.beginDispatch({jobId:task.id,authorizeInternalDispatch:async()=>true}),'DISPATCHER_AUTH_DENIED');
  const dispatched=await service.beginDispatch({jobId:task.id,dispatchCredential:'internal-dispatcher-key'});
  assert.equal(dispatched.deviceId,deviceA);
  assert.equal(dispatched.tenantId,'tenant-A');
  assert.equal(dispatched.goal,'Build the gateway and run regression tests');
  const unknown=await service.status({bearer:'A',jobId:task.id});
  assert.equal(unknown.state,'DELIVERY_UNKNOWN');
  assert.equal(unknown.dispatchState,'UNKNOWN');
  await bad(service.beginDispatch({jobId:task.id,dispatchCredential:'internal-dispatcher-key'}),'DISPATCH_ALREADY_CLAIMED');
});

test('only paired host can provide completion, always with durable evidence',async()=>{
  const {service,events}=fixture();
  const task=await submit(service);
  const receipt=(hostCredential,type,receiptId,extra={})=>service.hostReceipt({
    hostCredential,jobId:task.id,event:{type,receiptId,...extra},
  });
  await bad(receipt('hostA','VERIFIED','receipt-test-1000',{verified:true,evidenceRef:'evidence-12345678'}),'TASK_NOT_DELIVERED');
  await service.beginDispatch({jobId:task.id,dispatchCredential:'internal-dispatcher-key'});
  await bad(receipt('hostB','RECEIVED','receipt-test-1001'),'TASK_NOT_FOUND');
  await bad(receipt('UNVERIFIED','RECEIVED','receipt-test-1001'),'HOST_AUTH_DENIED');
  await bad(receipt('hostA','VERIFIED','receipt-test-1002'),'VERIFICATION_EVIDENCE_REQUIRED');
  await bad(receipt('hostA','RECEIVED','receipt-test-1003',{verified:true}),'UNVERIFIED_RESULT_CLAIM');
  await bad(receipt('hostA','VERIFIED','receipt-test-1009',
    {verified:true,evidenceRef:'evidence-12345678'}),'EVIDENCE_NOT_VERIFIED');
  const accepted=await receipt('hostA','RECEIVED','receipt-test-1004');
  assert.equal(accepted.state,'RECEIVED');
  const running=await receipt('hostA','RUNNING','receipt-test-1005');
  assert.equal(running.state,'RUNNING');
  const verified=await receipt('hostA','VERIFIED','receipt-test-1006',{verified:true,evidenceRef:'evidence-12345678'});
  assert.equal(verified.state,'VERIFIED');
  assert.equal(verified.evidenceRef,'evidence-12345678');
  assert.equal(events(),3);
  assert.deepEqual(await receipt('hostA','VERIFIED','receipt-test-1006',{verified:true,evidenceRef:'evidence-12345678'}),verified);
  assert.equal(events(),3);
  await bad(receipt('hostA','FAILED','receipt-test-1007'),'HOST_STATE_TRANSITION_DENIED');
  await bad(receipt('hostA','VERIFIED','receipt-test-1008',{verified:true,evidenceRef:'evidence-12345678'}),'HOST_EVENT_CONFLICT');
});

test('bounded schema never treats arbitrary host instructions as valid events',async()=>{
  const {service}=fixture();
  const task=await submit(service);
  await service.beginDispatch({jobId:task.id,dispatchCredential:'internal-dispatcher-key'});
  await bad(service.hostReceipt({hostCredential:'hostA',jobId:task.id,
    event:{type:'RUN_SHELL',receiptId:'receipt-test-2000',command:'rm -rf /'}}),'HOST_EVENT_INVALID');
});
