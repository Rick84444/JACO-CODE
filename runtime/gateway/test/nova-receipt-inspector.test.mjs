import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inspectNovaMissionReceipt, safeNovaReceiptLines } from '../src/nova-receipt-inspector.mjs';

const goal = 'AURA LIVE ACCEPTANCE: Perform exactly one read-only JACO Core health-check on the local Windows runtime. Record the real tool outcome and a durable Nova receipt; no file writes, browser navigation, payments, installations, process controls, git mutations, or external communications. End only with evidence, not a simulated success.';
const hash = createHash('sha256').update(goal).digest('hex');
const mission = { id:'mission_safe-123',goal,source:'git-control',metadata:{executor:'nova'} };
const detail = {
  id:mission.id,status:'ACTIVE',phase:'READY',
  receipts:[{ok:true,verified:true,type:'health-check',result:{password:'ABSOLUTELY_PRIVATE'}},
            {ok:false,verified:false,type:'git-status',stderr:'C:/Users/private/.env'}],
};
function client({missions=[mission],details=detail}={}) {
  const paths=[];
  return {paths,async request(path) {
    paths.push(path);
    if(path==='/api/connected/missions?limit=200') return {success:true,missions};
    if(path==='/api/connected/nova/missions/mission_safe-123') return {success:true,mission:details};
    throw Error('Unexpected external request '+path);
  }};
}
test('locates a unique real local mission and exposes only allowlisted receipt counters',async()=>{
  const core=client();
  const result=await inspectNovaMissionReceipt(core,hash);
  assert.equal(result.matched,true);
  assert.equal(result.missionId,'mission_safe-123');
  assert.equal(result.verifiedReceipts,1);
  assert.equal(result.verifiedHealthChecks,1);
  assert.equal(result.verifiedTask,'health-check');
  assert.equal(result.executed,true);
  assert.deepEqual(core.paths,['/api/connected/missions?limit=200','/api/connected/nova/missions/mission_safe-123']);
  const published=safeNovaReceiptLines(result).join('\n');
  assert.match(published,/RECEIPT_VERIFIED/);
  assert.doesNotMatch(published,/ABSOLUTELY_PRIVATE|password|C:\/Users|\.env|AURA LIVE ACCEPTANCE/);
});
test('missing mission is not presented as verified execution',async()=>{
  const result=await inspectNovaMissionReceipt(client({missions:[]}),hash);
  assert.equal(result.matched,false);
  assert.equal(result.executed,false);
  assert.equal(result.missionId,null);
  assert.match(safeNovaReceiptLines(result).join('\n'),/NOT_VERIFIED/);
});
test('never confuse a different goal, remote executor or forged source with the target',async()=>{
  const others=[
    {...mission,goal:'other'},
    {...mission,source:'manual'},
    {...mission,metadata:{executor:'nova@remote'}},
  ];
  const result=await inspectNovaMissionReceipt(client({missions:others}),hash);
  assert.equal(result.matched,false);
});
test('ambiguous duplicate goals fail closed without leaking identity',async()=>{
  const result=await inspectNovaMissionReceipt(client({missions:[mission,{...mission,id:'mission_other'}]}),hash);
  assert.equal(result.status,'AMBIGUOUS');
  assert.equal(result.missionId,null);
});
test('malformed fingerprint rejects without making a Core request',async()=>{
  const c=client();
  await assert.rejects(inspectNovaMissionReceipt(c,'bad'),/NOVA_RECEIPT_GOAL_HASH_INVALID/);
  assert.deepEqual(c.paths,[]);
});
test('unverified or disallowed receipts cannot establish real execution',async()=>{
  const c=client({details:{...detail,receipts:[{ok:true,verified:false,type:'health-check'},{ok:true,verified:true,type:'shell'}]}});
  const r=await inspectNovaMissionReceipt(c,hash);
  assert.equal(r.executed,false);
  assert.equal(r.verifiedHealthChecks,0);
});
test('unexpected backend errors fail closed with no raw text publication',async()=>{
  const c={async request(){throw Error('SECRET_TOKEN_SHOULD_NEVER_PUBLISH')}};
  await assert.rejects(inspectNovaMissionReceipt(c,hash),/SECRET_TOKEN/);
  const lines=safeNovaReceiptLines({schema:'jaco.nova-receipt-summary/v1',missionId:'\x1b[31msecret',missionState:'AUTH_TOKEN',phase:'x',receipts:NaN,verifiedReceipts:-1,verifiedHealthChecks:1e9,verifiedTask:'shell'});
  assert.doesNotMatch(lines.join(' '),/secret|AUTH_TOKEN|shell|NaN/);
});
