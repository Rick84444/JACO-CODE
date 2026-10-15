import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeCodingContract,contractVerificationStatus,codingExecutionSummary} from '../../agents/lib/coding-contract.mjs';
import {createCodingWorkspace} from '../../agents/lib/coding-workspace.mjs';
import {plannerTools,planSchema} from '../../agents/lib/native-tools.mjs';
import {learningStore} from '../../agents/lib/skill-learning.mjs';
import {DurableMissionBus} from '../../runtime/src/server/connected/durableMissionBus.mjs';
import {NovaMissionControl} from '../../runtime/src/server/connected/novaMissionControl.mjs';
import {contractedBrowserOrigin} from '../../agents/nova-bridge.mjs';

const contract=()=>normalizeCodingContract({objective:'Integrate scoped service',scope:{allowed:['app/**']},acceptance:['API and browser work'],execution:{allow_git_commit:false},services:[{id:'web',entry:'app/server.mjs',healthPath:'/health',identity:'integration-fixture'}],verification:{tests_required:false,required_stages:['service','api','browser']}});
const temp=(t,close=()=>{})=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'nova-integration-'));t.after(async()=>{await close();await fs.promises.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return root;};
const receipt=(turn,type,input,result)=>({actionId:`m:turn:${turn}`,type,input,result,ok:true,verified:true});

test('integration completion requires actual service, HTTP expectation and browser postcondition after writes',()=>{
  const c=contract();const r=[receipt(1,'repo-write',{},{}),receipt(2,'repo-service',{action:'start'},{state:'READY'}),receipt(3,'web-fetch',{expect:{status:200}},{status:200})];
  assert.deepEqual(contractVerificationStatus(c,r).missing,['browser']);
  r.push(receipt(4,'browser-click',{expect:{selector:'#result'}},{verified:true}));assert.equal(contractVerificationStatus(c,r).machineVerified,true);
  r.push(receipt(5,'repo-edit',{},{}));assert.deepEqual(contractVerificationStatus(c,r).missing,['service','api','browser']);
});

test('service authority rejects unscoped entries and invalid health requirements',()=>{
  assert.throws(()=>normalizeCodingContract({...contract(),services:{}}),/CODING_SERVICES_INVALID/);
  assert.throws(()=>normalizeCodingContract({...contract(),services:[{id:'web',entry:'.env',healthPath:'/health',identity:'x'}]}),/ENTRY_DENIED/);
  assert.throws(()=>normalizeCodingContract({...contract(),services:[{id:'web',entry:'app/server.mjs',healthPath:'https://external',identity:'x'}]}),/HEALTH_REQUIRED/);
});

test('real hidden service survives a workspace executor reconstruction without duplicate process',async t=>{
  let w,started;const c=contract();const root=temp(t,async()=>{if(started)await w.execute({type:'repo-service',data:{id:'web',action:'stop'}},c);});fs.mkdirSync(path.join(root,'app'));
  fs.writeFileSync(path.join(root,'app/server.mjs'),"import http from 'node:http';http.createServer((q,r)=>{r.end(JSON.stringify({identity:process.env.JACO_SERVICE_ID,leaked:Boolean(process.env.NOVA_TEST_SECRET)}));}).listen(Number(process.env.PORT),process.env.HOST);");
  w=createCodingWorkspace({root});
  process.env.NOVA_TEST_SECRET='must-not-reach-service';
  try {started=await w.execute({type:'repo-service',data:{id:'web',action:'start'}},c);}finally{delete process.env.NOVA_TEST_SECRET;}
  assert.equal(started.state,'READY');const body=await (await fetch(started.url+'/health')).json();assert.equal(body.leaked,false);
  const resumed=await createCodingWorkspace({root}).execute({type:'repo-service',data:{id:'web',action:'start'}},c);
  assert.equal(resumed.pid,started.pid);assert.equal(resumed.url,started.url);
  fs.writeFileSync(path.join(root,'app/dependency.mjs'),'export const changed=true;');
  const stale=await w.execute({type:'repo-service',data:{id:'web',action:'status'}},c);assert.equal(stale.state,'STALE');
  await assert.rejects(w.execute({type:'repo-service',data:{id:'web',action:'start'}},c),/SERVICE_SOURCE_CHANGED/);
  const stopped=await w.execute({type:'repo-service',data:{id:'web',action:'stop'}},c);assert.equal(stopped.state,'STOPPED');
});

test('preflight is lease protected, selected fields are durable and graph keeps earlier receipts after restart',t=>{
  let bus;const root=temp(t,()=>bus.close());bus=new DurableMissionBus(root);let control=new NovaMissionControl(bus,{allowedTasks:['repo-list']});
  const m=control.create({goal:'Inspect app',idempotencyKey:'preflight-restart',contract:contract()});const {token}=control.claim(m.id,'nova');
  assert.throws(()=>control.preflight(m.id,{owner:'other',token,report:{}}),/LEASE_INVALID/);
  control.preflight(m.id,{owner:'nova',token,report:{schema:'jaco.nova-preflight/v1',status:'READY',tools:['repo-list','not-a-tool'],secret:'must-not-store',repository:{revision:'abc',entries:1}}});
  const a=control.begin(m.id,{owner:'nova',token,task:{type:'repo-list',data:{path:'app'}}});control.finish(m.id,{owner:'nova',token,actionId:a.id,receipt:{ok:true,verified:true}});bus.close();
  bus=new DurableMissionBus(root);control=new NovaMissionControl(bus,{allowedTasks:['repo-list']});const recovered=control.get(m.id);
  assert.equal(recovered.receipts.length,1);assert.equal(recovered.preflight.status,'READY');assert.equal(recovered.preflight.secret,undefined);assert.deepEqual(recovered.preflight.tools,['repo-list']);assert.equal(recovered.execution.verifiedActions,1);
});

test('reflection persists actual evidence and marks recalled experience stale after revision changes',t=>{
  const root=temp(t),store=learningStore(root),c=contract();
  const m={id:'m',status:'DONE',contract:c,contractStatus:{machineVerified:true},preflight:{repository:{revision:'a'}},receipts:[receipt(1,'repo-test',{command:'test'},{kind:'test'})]};
  store.recordOutcome(m);assert.equal(learningStore(root).recallOutcome(c,'a')[0].verificationStatus,'VERIFIED');assert.equal(store.recallOutcome(c,'b')[0].verificationStatus,'STALE');
});

test('native and constrained planners share typed service schemas and recovery never instructs blind mutation retry',()=>{
  const native=plannerTools(['repo-service']).tools.find(t=>t.function.name==='repo-service').function.parameters;
  assert.deepEqual(native.properties.action.enum,['start','status','stop']);assert.deepEqual(planSchema(['repo-service']).anyOf[0].properties.task.anyOf[0].properties.data.properties.action.enum,native.properties.action.enum);
  const s=codingExecutionSummary(contract(),[{outcomeUnknown:true,type:'repo-write'}]);assert.equal(s.recovery.code,'OUTCOME_UNKNOWN');assert.match(s.recovery.next,/reconcile/);
});

test('browser grant belongs only to the executing action and an active contracted local service',()=>{
  const m={id:'m',status:'ACTIVE',phase:'EXECUTING',activeTask:{id:'a',type:'browser-click'},contract:contract(),receipts:[receipt(1,'repo-write',{},{}),receipt(2,'repo-service',{id:'web',action:'start'},{url:'http://127.0.0.1:32123',state:'READY',identity:'integration-fixture'})]};
  const input={missionId:'m',actionId:'a',expectedUrl:'http://127.0.0.1:32123/'};
  assert.equal(contractedBrowserOrigin(m,input,'click'),'http://127.0.0.1:32123');
  for(const change of [{actionId:'other'},{expectedUrl:'https://external.example/'},{expectedUrl:'http://127.0.0.1:32124/'}])assert.equal(contractedBrowserOrigin(m,{...input,...change},'click'),null);
  m.activeTask.type='browser-type';assert.equal(contractedBrowserOrigin(m,input,'click'),null);assert.equal(contractedBrowserOrigin(m,input,'type'),'http://127.0.0.1:32123');
  m.activeTask.type='browser-click';m.receipts.push(receipt(3,'repo-edit',{},{}));assert.equal(contractedBrowserOrigin(m,input,'click'),null);
});

test('service logs cannot follow repository hardlinks outside their operational files',async t=>{const root=temp(t),w=createCodingWorkspace({root}),c=contract();fs.mkdirSync(path.join(root,'app'));fs.writeFileSync(path.join(root,'app/server.mjs'),'process.exit(0)');fs.mkdirSync(path.join(root,'.jaco/services'),{recursive:true});fs.writeFileSync(path.join(root,'outside.log'),'preserve');fs.linkSync(path.join(root,'outside.log'),path.join(root,'.jaco/services/web.out.log'));await assert.rejects(w.execute({type:'repo-service',data:{id:'web',action:'start'}},c),/CODING_HARDLINK_DENIED/);assert.equal(fs.readFileSync(path.join(root,'outside.log'),'utf8'),'preserve');});
