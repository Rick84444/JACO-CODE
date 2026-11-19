import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { KnowledgeStore } from '../../runtime/src/server/continuum/knowledgeStore.mjs';
import { COMMERCIAL_CLOCK, COMMERCIAL_SOURCE, COMMERCIAL_TASKS, commercialAuthorized, commercialTaskAllowed, reconcileCommercialClock, archiveCommercialOutcome, seedCommercialOperatorKnowledge } from '../../runtime/src/server/autonomy/commercialClock.mjs';
import { operatorApprovalCheck } from '../../agents/lib/operator-action-guard.mjs';

function setup(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-commercial-clock-'));
  let now=Date.now(), enabled=true, mode='RUNNING', emergencyLatched=false;
  const m={id:'commercial-test',name:COMMERCIAL_CLOCK,signedAt:new Date(now).toISOString(),expiresAt:new Date(now+8*3600000).toISOString(),decisions:{READ:'ALLOW',EXTERNAL_MUTATION:'ALLOW',FINANCIAL:'REVIEW'}};
  const mandates={get:id=>id===m.id?m:null,list:()=>[m],isActive:id=>id===m.id&&enabled&&now<Date.parse(m.expiresAt)};
  const operator={snapshot:()=>({mode,emergencyLatched})};
  const bus=new DurableMissionBus(root);
  const nova=new NovaMissionControl(bus,{allowedTasks:[...COMMERCIAL_TASKS,'shell'],now:()=>now});
  nova.commercialAuthorization=(mission,task)=>commercialAuthorized(mission,mandates,operator,task);
  const knowledge=new KnowledgeStore(path.join(root,'knowledge-test'),{append:()=>{}});
  t.after(()=>{bus.close();fs.rmSync(root,{recursive:true,force:true});});
  return {m,mandates,operator,bus,nova,knowledge,setEnabled:v=>enabled=v,setMode:v=>mode=v,setEmergency:v=>emergencyLatched=v,advance:ms=>now+=ms,tick:()=>reconcileCommercialClock({mandates,operator,bus,nova,knowledge,now})};
}
const read={type:'mcp-call',data:{server:'jobbi',tool:'list_gigs',arguments:{lane:'agent'}}};
test('only an explicit active commercial clock queues one mission and seeds canonical memory',t=>{
  const s=setup(t);
  s.m.name='Autonomi-klocka';assert.equal(s.tick().state,'INACTIVE');
  s.m.name=COMMERCIAL_CLOCK;s.setEnabled(false);assert.equal(s.tick().state,'INACTIVE');
  s.setEnabled(true);s.setMode('PAUSED');assert.equal(s.tick().state,'INACTIVE');
  s.setMode('RUNNING');s.setEmergency(true);assert.equal(s.tick().state,'INACTIVE');
  s.setEmergency(false);
  assert.throws(()=>s.knowledge.get('commercial-operator-knowledge-v2'),/not found/);
  const first=s.tick();assert.equal(first.state,'QUEUED');
  assert.equal(s.tick().state,'OUTSTANDING');
  const mission=s.nova.get(first.missionId);
  assert.equal(mission.source,COMMERCIAL_SOURCE);assert.equal(mission.metadata.mandateId,s.m.id);
  assert.equal(s.knowledge.get('commercial-opportunity-policy-v1').verificationStatus,'UNVERIFIED');
  const policy=s.knowledge.get('commercial-operator-knowledge-v2');
  assert.equal(policy.verificationStatus,'UNVERIFIED');
  assert.equal(policy.confidence,0);
  assert.equal(seedCommercialOperatorKnowledge(s.knowledge).revision,policy.revision);
  assert.equal(s.nova.current().id,mission.id);
});
test('expiry and revocation stop new actions, including an already claimed planning turn',t=>{
  const s=setup(t),id=s.tick().missionId;
  const {token}=s.nova.claim(id,'agent');
  s.setEnabled(false);
  assert.throws(()=>s.nova.begin(id,{owner:'agent',token,task:read}),/COMMERCIAL_CLOCK_INACTIVE/);
  assert.equal(s.nova.current(),null);
  s.setEnabled(true);s.advance(8*3600000+1);
  assert.throws(()=>s.nova.claim(id,'agent'),/COMMERCIAL_CLOCK_INACTIVE/);
  assert.equal(s.tick().state,'INACTIVE');
});
test('scoped tool allowlist cannot grant spend or arbitrary MCP writes',()=>{
  assert.equal(commercialTaskAllowed(read),true);
  for(const [server,tool] of [['jobbi','get_gig'],['jobbi','list_sources'],['frantic','frantic.read_board'],['frantic','frantic.get_bounty'],['frantic','frantic.read_ledger'],['agentgigs','estimate_payout']]){
    assert.equal(commercialTaskAllowed({type:'mcp-call',data:{server,tool}}),true);
    assert.equal(commercialTaskAllowed({type:'mcp-write',data:{server,tool}}),false);
  }
  assert.equal(commercialTaskAllowed({type:'mcp-call',data:{server:'frantic',tool:'frantic.claim'}}),false);
  assert.equal(commercialTaskAllowed({type:'mcp-write',data:{server:'frantic',tool:'frantic.claim'}}),false);
  assert.equal(commercialTaskAllowed({type:'mcp-call',data:{server:'jobbi',tool:'jobbi.list_gigs'}}),true);
  assert.equal(commercialTaskAllowed({type:'mcp-call',data:{server:'jobbi',tool:'apply'}}),false);
  assert.equal(commercialTaskAllowed({type:'mcp-write',data:{server:'agentgigs',tool:'fund'}}),false);
  assert.equal(commercialTaskAllowed({type:'mcp-write',data:{server:'agentgigs',tool:'apply'}}),true);
  assert.ok(operatorApprovalCheck({type:'mcp-write',data:{server:'agentgigs',tool:'apply'}}));
  assert.ok(operatorApprovalCheck({type:'mcp-write',data:{server:'agentgigs',tool:'agentgigs.apply'}}));
  assert.equal(commercialTaskAllowed({type:'skill-load',data:{id:'buyer-tailored-proposal'}}),true);
  assert.equal(commercialTaskAllowed({type:'skill-load',data:{id:'product-validation'}}),false);
  assert.equal(commercialTaskAllowed({type:'shell',data:{command:'curl'}}),false);
});
test('out-of-scope tools rejected in real Nova begin; no fabricated revenue in outcome memory',t=>{
  const s=setup(t),id=s.tick().missionId;
  const {token}=s.nova.claim(id,'agent');
  assert.throws(()=>s.nova.begin(id,{owner:'agent',token,task:{type:'mcp-write',data:{server:'agentgigs',tool:'fund'}}}),/COMMERCIAL_TASK_OUT_OF_SCOPE/);
  const a=s.nova.begin(id,{owner:'agent',token,task:read});
  s.nova.finish(id,{owner:'agent',token,actionId:a.id,receipt:{ok:true,verified:true}});
  s.nova.requestCancel(id,'test end');
  const mission=s.nova.get(id);
  const item=archiveCommercialOutcome({mission,nova:s.nova,knowledge:s.knowledge});
  assert.equal(item.verificationStatus,'UNVERIFIED');assert.equal(item.metrics.verifiedReceipts,1);
  assert.equal(archiveCommercialOutcome({mission,nova:s.nova,knowledge:s.knowledge}),null);
  assert.equal(s.tick().state,'COOLDOWN');
  s.advance(3600000+Math.max(0,Date.parse(mission.createdAt)-Date.parse(s.m.signedAt))+1);assert.equal(s.tick().state,'QUEUED');
});
