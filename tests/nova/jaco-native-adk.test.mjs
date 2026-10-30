import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { JacoClient, JacoApiError } from '../../runtime/src/sdk/jaco-client.mjs';
import { AuraAdkError, AuraAdk, createAuraAdk, defineAuraProgram, JACO_ADK_VERSION }
  from '../../runtime/src/adk/aura-adk.mjs';

const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
const goalProgram = () => defineAuraProgram({
  id:'technical-audit',version:'1.0.0',description:'A read-first, policy-bound technical mission',
  execution:{type:'goal'},
});
const skillProgram = () => defineAuraProgram({
  id:'repo-check',version:'1.2.3',description:'Use an installed runtime skill',
  execution:{type:'skill',skillId:'repository-security'},
  readTools:[{providerId:'local',toolName:'read_file'}],
});
const board = overrides => ({
  success:true,schema:'jaco.aura-agent-board/v1',observedAt:new Date().toISOString(),
  sources:{workplace:{available:true},missions:{available:true}},
  aura:{identity:{id:'aura',agentCount:1},runtimeConsolidated:false,
    functions:[{id:'plan',state:'OBSERVED'}],
    oversight:{schema:'jaco.aura-oversight/v1',browser:{state:'BLOCKED'}}},...overrides,
});

test('ADK is a real versioned module, not a spawned agent or a second mission dispatcher', () => {
  assert.equal(JACO_ADK_VERSION,'1.0.0');
  const spec=goalProgram();
  assert.deepEqual(Object.keys(spec.execution),['type']);
  assert.equal(spec.operatorIdentity,'aura');
  assert.ok(Object.isFrozen(spec) && Object.isFrozen(spec.execution));
  assert.equal(createAuraAdk({client:{request:async()=>{}}}) instanceof AuraAdk,true);
});
test('manifest requires exact version, valid identifiers and no unreviewed executable fields', () => {
  assert.throws(()=>defineAuraProgram({}),/ADK_PROGRAM_ID_INVALID/);
  assert.throws(()=>defineAuraProgram({...goalProgram(),unknown:'exec'}),/ADK_UNRECOGNIZED_PROGRAM_FIELD/);
  assert.throws(()=>defineAuraProgram({id:'a',version:'latest',description:'d',execution:{type:'goal'}}),/ADK_PROGRAM_VERSION_INVALID/);
  assert.throws(()=>defineAuraProgram({id:'a',version:'1.0.0',description:'d',
    execution:{type:'goal',skillId:'foo'}}),/ADK_GOAL_HAS_SKILL_ID/);
  assert.throws(()=>defineAuraProgram({id:'a',version:'1.0.0',description:'d',
    execution:{type:'skill'}}),/ADK_INVALID_SKILL_ID/);
  assert.throws(()=>defineAuraProgram({id:'a',version:'1.0.0',description:'d',
    execution:{type:'goal'}, readTools:[{providerId:'a',toolName:'b'},{providerId:'a',toolName:'b'}]}),/ADK_DUPLICATE_TOOL/);
  assert.throws(()=>new AuraAdk({endpoint:'https://jaco.example.com'}),/ADK_LOCAL_ONLY/);
});
test('inspection uses the actual Aura board, not fabricated six READY flags', async () => {
  let requested, events=[];
  const adk=createAuraAdk({client:{request:async(path)=>{requested=path;return board();}},
    onEvent:e=>events.push(e)});
  const snapshot=await adk.inspect();
  assert.equal(requested,'/api/aura/workbench/agent-board');
  assert.equal(snapshot.operator,'aura');
  assert.equal(snapshot.oversight.browser.state,'BLOCKED');
  assert.equal(snapshot.functions[0].state,'OBSERVED');
  assert.equal(events[0].type,'runtime.observed');
  assert.ok(!JSON.stringify(snapshot).includes('memory'));
});
test('inspection refuses fake agent identities, missing proof and stale data', async () => {
  for (const invalid of [
    board({aura:{...board().aura,identity:{id:'nova',agentCount:1}}}),
    board({aura:{...board().aura,runtimeConsolidated:true}}),
    board({observedAt:'2020-01-01T00:00:00Z'}),
    board({schema:'jaco.aura-agent-board/v0'}),
  ]) {
    const adk=createAuraAdk({client:{request:async()=>invalid}});
    await assert.rejects(adk.inspect(),/ADK_AURA_/);
  }
});
test('dispatch is explicit and SEER goal is never misreported as a Nova mission', async()=>{
  let route,req;
  const events=[];
  const adk=new AuraAdk({client:{request:async(p,r)=>{route=p;req=r;return {success:true,goal:{id:'goal-123'}};}},
    onEvent:e=>events.push(e)});
  await assert.rejects(adk.dispatch(goalProgram(),{goal:'Fix'}),/ADK_OPERATOR_AUTHORIZATION_REQUIRED/);
  const submitted=await adk.dispatch(goalProgram(),{goal:'  Check code  ',operatorAuthorized:true});
  assert.equal(route,'/api/aura/workbench/start-goal');
  assert.equal(req.method,'POST');
  assert.deepEqual(req.body,{goal:'Check code'});
  assert.equal(submitted.kind,'seer-goal');
  assert.equal(submitted.id,'goal-123');
  assert.equal(submitted.executionVerified,false);
  assert.equal(events[0].type,'dispatch.submitted');
});
test('skill dispatch delegates to installed canonical skill and returns a Nova mission',async()=>{
  let p,body;
  const adk=createAuraAdk({client:{request:async(path,options)=>{
    p=path;body=options.body;return {success:true,mission:{id:'mission-123',status:'ACTIVE'}};
  }}});
  const result=await adk.dispatch(skillProgram(),{
    input:'Find test failures',testCommands:['node --test'],operatorAuthorized:true,
  });
  assert.equal(p,'/api/aura/workbench/skills/repository-security/run');
  assert.deepEqual(body,{input:'Find test failures',testCommands:['node --test']});
  assert.equal(result.kind,'nova-mission');
  assert.equal(result.id,'mission-123');
  assert.throws(()=>defineAuraProgram({id:'a',version:'1.0.0',description:'d',
    execution:{type:'goal'},readTools:[{providerId:'../../bad',toolName:'x'}]}),/ADK_INVALID_PROVIDER_ID/);
});
test('lost response does not retry dispatch and reports outcome unknown',async()=>{
  let count=0;
  const client=new JacoClient({retries:5,retryDelayMs:0,fetchImpl:async()=>{count++;throw Error('ECONNRESET')}});
  const adk=createAuraAdk({client});
  await assert.rejects(()=>adk.dispatch(goalProgram(),{goal:'Audit',operatorAuthorized:true}),
    e=>e instanceof AuraAdkError && e.code==='ADK_DISPATCH_OUTCOME_UNKNOWN' && e.outcomeUnknown===true);
  assert.equal(count,1);
});
test('server rejection is not retried or disguised as an unknown success',async()=>{
  let count=0;
  const client=new JacoClient({retries:3,fetchImpl:async()=>{count++;return reply({success:false,error:'GATE_BLOCKED'},403);}});
  const adk=createAuraAdk({client});
  await assert.rejects(()=>adk.dispatch(goalProgram(),{goal:'Audit',operatorAuthorized:true}),
    e=>e instanceof JacoApiError && e.code==='GATE_BLOCKED');
  assert.equal(count,1);
});
test('malformed successful create response is outcome unknown, never fabricated accepted work',async()=>{
  const adk=createAuraAdk({client:{request:async()=>({success:true,goal:{}})}});
  await assert.rejects(()=>adk.dispatch(goalProgram(),{goal:'Audit',operatorAuthorized:true}),
    e=>e.outcomeUnknown===true && e.code==='ADK_DISPATCH_OUTCOME_UNKNOWN');
});
test('mission observation distinguishes status, verified steps and final acceptance',async()=>{
  const adk=createAuraAdk({client:{request:async()=>({success:true,mission:{
    id:'mission-1',status:'DONE',phase:'READY',contractStatus:{machineVerified:true},
    receipts:[{ok:true,verified:true,outcomeUnknown:false},{ok:true,verified:false},
      {ok:false,verified:false,outcomeUnknown:true}],
  }})}});
  const m=await adk.mission('mission-1');
  assert.equal(m.verifiedSteps,1);
  assert.equal(m.uncertainOutcomes,1);
  assert.equal(m.machineVerified,true);
  assert.equal(m.completionClaimed,true);
  assert.equal(m.accepted,false);
  assert.equal(m.terminal,true);
});
test('mission mismatched IDs and invalid schemas fail closed',async()=>{
  const adk=createAuraAdk({client:{request:async()=>({mission:{id:'another',status:'DONE'}})}});
  await assert.rejects(()=>adk.mission('mission-1'),/ADK_MISSION_ID_MISMATCH/);
  await assert.rejects(()=>adk.mission('../../'),/ADK_INVALID_MISSION_ID/);
});
test('polling handles recoverable BLOCKED, stops at verification gate and never cancels',async()=>{
  let observations=0,updates=0;
  const adk=createAuraAdk({client:{request:async(_p,opts)=>{
    assert.notEqual(opts.method,'POST');
    updates++;
    observations++;
    return {mission:{id:'mission-1',status:observations===1?'BLOCKED':'AWAITING_VERIFICATION'}};
  }}});
  const result=await adk.awaitMission('mission-1',{intervalMs:250,timeoutMs:2000});
  assert.equal(result.status,'AWAITING_VERIFICATION');
  assert.equal(updates,2);
  assert.equal(result.accepted,false);
});
test('bounded poll timeout leaves durable server mission unchanged',async()=>{
  let reads=0;
  const adk=createAuraAdk({client:{request:async()=>{
    reads++;return {mission:{id:'mission-1',status:'ACTIVE'}};
  }}});
  await assert.rejects(()=>adk.awaitMission('mission-1',{intervalMs:250,timeoutMs:300}),
    e => e instanceof AuraAdkError && e.code === 'ADK_WAIT_TIMEOUT' && e.outcomeUnknown === false);
  assert.ok(reads>=1);
});
test('cancel requires operator authorization and does not claim immediate cancellation',async()=>{
  let route;
  const adk=createAuraAdk({client:{request:async(p)=>{route=p;return {success:true,pending:true};}}});
  await assert.rejects(adk.cancelMission('mission-1'),/ADK_OPERATOR_AUTHORIZATION_REQUIRED/);
  const result=await adk.cancelMission('mission-1',{operatorAuthorized:true});
  assert.equal(route,'/api/aura/workbench/missions/mission-1/cancel');
  assert.equal(result.requested,true);
  assert.equal(result.server.pending,true);
});
test('declared MCP read tool needs live read-only metadata and server success',async()=>{
  const calls=[];
  const client=new JacoClient({fetchImpl:async(url,init)=>{
    calls.push({url,init});
    if(url.endsWith('/api/aura/workbench'))return reply({mcp:{providers:[
      {id:'local',name:'Local',tools:[{name:'read_file',readOnly:true}]},
    ]}});
    if(url.endsWith('/mcp/call'))return reply({success:true,result:{isError:false,content:[{type:'text',text:'ok'}]}});
    throw Error('UNEXPECTED_ROUTE');
  }});
  const adk=createAuraAdk({client});
  const r=await adk.readTool(skillProgram(),{providerId:'local',toolName:'read_file',args:{path:'README.md'}});
  assert.equal(r.content[0].text,'ok');
  assert.equal(calls.length,2);
  assert.equal(JSON.parse(calls.at(-1).init.body).toolName,'read_file');
});
test('undeclared/mutable MCP tools, dangerous keys and oversized input never execute',async()=>{
  let calls=0;
  const client=new JacoClient({fetchImpl:async()=>{
    calls++;return reply({mcp:{providers:[{id:'local',tools:[{name:'read_file',readOnly:false}]}]}});
  }});
  const adk=createAuraAdk({client});
  await assert.rejects(()=>adk.readTool(skillProgram(),{providerId:'local',toolName:'write_file'}),
    /ADK_TOOL_NOT_DECLARED/);
  await assert.rejects(()=>adk.readTool(skillProgram(),{providerId:'local',toolName:'read_file',
    args:JSON.parse('{"__proto__":{"polluted":true}}')}),/ADK_ARGUMENT_KEY_DENIED/);
  await assert.rejects(()=>adk.readTool(skillProgram(),{providerId:'local',toolName:'read_file',
    args:{x:'x'.repeat(10000)}}),/ADK_ARGUMENTS_TOO_LARGE/);
  await assert.rejects(()=>adk.readTool(skillProgram(),{providerId:'local',toolName:'read_file',
    args:{path:'safe'}}),/ADK_TOOL_READ_ONLY_NOT_ATTESTED/);
  assert.equal(calls,1,'only discovery request; no mutations executed');
});
test('onEvent observer failures never mask real execution receipts',async()=>{
  const adk=createAuraAdk({client:{request:async()=>({success:true,goal:{id:'goal-1'}})},
    onEvent:()=>{throw Error('telemetry down');}});
  assert.equal((await adk.dispatch(goalProgram(),{goal:'Check',operatorAuthorized:true})).id,'goal-1');
});
test('real loopback HTTP contract: token, read board, submit goal and inspect mission',async()=>{
  const requests=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const c of req)raw+=c;
    requests.push({method:req.method,path:req.url,token:req.headers['x-gateway-token'],body:raw?JSON.parse(raw):null});
    res.setHeader('content-type','application/json');
    const answer=req.url==='/api/aura/workbench/agent-board' ? board()
      : req.url==='/api/aura/workbench/start-goal' ? {success:true,goal:{id:'goal-http'}}
      : req.url==='/api/connected/nova/missions/mission-http' ? {success:true,mission:{id:'mission-http',status:'DONE',receipts:[]}}
      : {success:false,error:'NOT_FOUND'};
    res.writeHead(answer.success===false?404:req.method==='POST'?201:200);
    res.end(JSON.stringify(answer));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const client=new JacoClient({endpoint:'http://127.0.0.1:'+server.address().port,token:'test-only-token',retries:0});
    const adk=createAuraAdk({client});
    assert.equal((await adk.inspect()).operator,'aura');
    assert.equal((await adk.dispatch(goalProgram(),{goal:'Audit',operatorAuthorized:true})).kind,'seer-goal');
    assert.equal((await adk.mission('mission-http')).status,'DONE');
    assert.deepEqual(requests.map(r=>r.method),['GET','POST','GET']);
    assert.ok(requests.every(r=>r.token==='test-only-token'));
    assert.deepEqual(requests[1].body,{goal:'Audit'});
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('a lookalike or forged frozen manifest does not gain execution authority', async()=>{
  let requests=0;
  const adk=createAuraAdk({client:{request:async()=>{requests++;return {success:true,goal:{id:'goal-1'}};}}});
  const fake=Object.freeze({
    schema:'jaco.adk.program/v1', id:'fake', version:'1.0.0',
    description:'Spoofed', execution:Object.freeze({type:'goal'}),
    readTools:Object.freeze([]), operatorIdentity:'aura',
  });
  await assert.rejects(()=>adk.dispatch(fake,{goal:'Audit',operatorAuthorized:true}),/ADK_DEFINE_PROGRAM_FIRST/);
  assert.equal(requests,0);
});
