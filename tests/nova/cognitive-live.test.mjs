import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { readCognitiveFeed, createCognitiveStreamHandler } from '../../runtime/src/server/connected/cognitiveLiveStream.mjs';
import { toCognitiveEvent, mergeCognitiveEvents, liveWorkspaceStatus, cognitiveLink } from '../../runtime/src/lib/cognitiveEvents.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';
import { auraChatViaSeer } from '../../agents/lib/aura-seer-chat.mjs';

const at='2026-10-11T12:00:00.000Z';
const action=(payload={},missionId='mission-one')=>({seq:1,ts:at,type:'NOVA_ACTION_RESULT',missionId,payload:{type:'run-tests',actionId:'action-one',...payload}});
const workstream={snapshot:()=>({events:[]})};

test('question routing rejects model-selected mutations while allowing observed current-work tools',async()=>{
  let mutated=0,round=0;
  const mutators=['start_goal','seer_subgoal','policy_update','provider_switch','nova_deliver','new_future_mutator'];
  const original={observe:async()=>'{"missionId":"existing"}',tools:{
    ...Object.fromEntries(mutators.map(name=>[name,{description:'mutation',run:async()=>{mutated++;}}])),
    repo_read:{description:'read',run:async()=> 'source'},
  }};
  const observed={events:[{id:'mission:1',evidence:{outcome:'unverified'}}]};
  const toolbox=cognitiveQuestionToolbox(original,()=>observed);
  assert.ok(mutators.every(name=>!Object.hasOwn(toolbox.tools,name)));
  assert.equal(await toolbox.tools.repo_read.run({}),'source');
  assert.deepEqual(await toolbox.tools.runtime_events.run({}),observed);
  const result=await auraChatViaSeer({message:'What have you discovered?',toolbox,complete:async()=>({
    text:++round===1?'TOOL_CALL {"name":"start_goal","args":{"goal":"replace current mission"}}':'The current mission continues.',provider:'test-fixture',model:'no-inference',
  })});
  assert.equal(mutated,0);assert.equal(result.toolReceipts[0].ok,false);
  assert.equal(result.reply,'The current mission continues.');
});

test('success, failure and unknown outcomes stay distinct even when verification flags disagree',()=>{
  assert.equal(toCognitiveEvent(action({ok:true,verified:true}),{durable:true}).evidence.outcome,'verified');
  assert.equal(toCognitiveEvent(action({ok:true,verified:false})).evidence.outcome,'unverified');
  assert.equal(toCognitiveEvent(action({ok:false,verified:true,error:'test failed'})).evidence.outcome,'failed');
  assert.equal(toCognitiveEvent(action({ok:true,verified:true,result:{exitCode:1}})).evidence.outcome,'failed');
  assert.equal(toCognitiveEvent(action({ok:true,verified:true,result:{error:'DENIED'}})).evidence.outcome,'failed');
  assert.equal(toCognitiveEvent(action({ok:true,verified:true,outcomeUnknown:true})).evidence.outcome,'unknown');
  assert.equal(toCognitiveEvent({...action(),type:'NOVA_ACTION_STARTED',payload:{action:{type:'run-tests',id:'a'}}}).evidence.outcome,'observed');
});

test('housekeeping and invalid observations never become cognitive progress',()=>{
  assert.equal(toCognitiveEvent({id:'tick',at,type:'seer.cycle.started',verified:true,message:'cycle'}),null);
  assert.equal(toCognitiveEvent({id:'x',at:'invalid',type:'result',message:'done'}),null);
  assert.equal(toCognitiveEvent({at,type:'observation',message:'without identity'}),null);
  assert.equal(toCognitiveEvent({id:'x',at,type:'governor.skipped',message:'noop'}),null);
  assert.equal(liveWorkspaceStatus({connection:'reconnecting',runtimeRunning:true,missions:[{status:'ACTIVE',phase:'EXECUTING'}]}).tone,'waiting');
  assert.equal(liveWorkspaceStatus({connection:'live',runtimeRunning:true,missions:[{status:'ACTIVE',phase:'VERIFYING'}]}).label,'Kontrollerar resultat');
});

test('raw arguments, credentials and untrusted result URLs stay out of the live contract',()=>{
  const secret='private-random-value';
  const event=toCognitiveEvent(action({ok:false,error:'password=hunter2 Bearer confidential ghp_123456 '+secret,data:{apiKey:'do-not-copy'},result:{url:'javascript:alert(1)',output:'raw-private-output'}}),{secrets:[secret]});
  const text=JSON.stringify(event);
  for(const privateValue of ['hunter2','confidential','ghp_123456',secret,'do-not-copy','raw-private-output'])assert.equal(text.includes(privateValue),false);
  assert.equal(event.evidence.url,null);
  assert.equal(cognitiveLink('https://user:password@example.com'),null);
  assert.equal(cognitiveLink('https://example.com?token=secret'),null);
  assert.equal(cognitiveLink('https://example.com/result'),'https://example.com/result');
  const bounded=toCognitiveEvent({id:'bounded',at,type:'observation',message:'x'.repeat(595)+secret},{secrets:[secret]});
  assert.equal(bounded.text.includes('priva'),false,'redact a configured secret before clipping the narrative');
});

test('receipt replay is deduplicated within a mission and the durable source wins',()=>{
  const volatile=toCognitiveEvent({...action({ok:true,verified:true}),id:'receipt:a'});
  const durable=toCognitiveEvent(action({ok:true,verified:true}),{durable:true});
  const other=toCognitiveEvent({...action({ok:true,verified:true},'mission-two'),seq:2},{durable:true});
  const merged=mergeCognitiveEvents([volatile],[durable,durable,other]);
  assert.equal(merged.length,2); assert.equal(merged[0].durable,true);
  assert.equal(mergeCognitiveEvents(merged,[durable]).length,2);
});

test('real SQLite mission history replays after a process-store restart without synthetic completion',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cognitive-'));
  let bus;
  try {
    bus=new DurableMissionBus(dir);
    const mission=bus.createMission({goal:'Verify a restart'});
    bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{type:'run-tests',actionId:'a',ok:true,verified:false,result:{exitCode:0}}});
    const first=readCognitiveFeed({bus,workstream});
    assert.equal(first.events.length,2); assert.equal(first.events[1].evidence.outcome,'unverified');
    bus.close();bus=new DurableMissionBus(dir);
    const replay=readCognitiveFeed({bus,workstream});
    assert.deepEqual(replay.events.map(e=>e.id),first.events.map(e=>e.id));
    assert.ok(replay.events.every(e=>e.durable));
    assert.equal(readCognitiveFeed({bus,workstream,after:first.cursor}).events.length,0);
    bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{type:'run-tests',actionId:'b',ok:true,verified:true,result:{exitCode:0}}});
    const resumed=readCognitiveFeed({bus,workstream,after:first.cursor});
    assert.equal(resumed.events.length,1);assert.equal(resumed.events[0].evidence.outcome,'verified');
  } finally {bus?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('bounded replay explicitly identifies missing older history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cognitive-'));
  const bus=new DurableMissionBus(dir);
  try {
    const mission=bus.createMission({goal:'Bounded history'});
    for(let n=0;n<8;n++)bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{ok:true,verified:true,actionId:String(n)}});
    const packet=readCognitiveFeed({bus,workstream,after:1,limit:3});
    assert.equal(packet.events.length,3);assert.equal(packet.historyTruncated,true);
  }finally{bus.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('authenticated-route SSE transport delivers new events and resumes from Last-Event-ID over a real socket',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cognitive-sse-'));
  const bus=new DurableMissionBus(dir);
  const mission=bus.createMission({goal:'SSE delivery'});
  const handler=createCognitiveStreamHandler({bus,workstream,intervalMs:100});
  const server=createServer((req,res)=>{
    // The real app mounts this handler behind requireLocalUi. Test the gate with a fixed test credential.
    if(req.headers.authorization!=='Bearer test-credential'){res.writeHead(401).end();return;}
    req.query={after:new URL(req.url,'http://localhost').searchParams.get('after')};req.get=name=>req.headers[name.toLowerCase()];
    res.status=code=>{res.statusCode=code;return res;};res.set=headers=>{for(const [k,v]of Object.entries(headers))res.setHeader(k,v);return res;};
    handler(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/live';
  const active=[];
  const packetReader=async headers=>{
    const controller=new AbortController();active.push(controller);
    const response=await fetch(url,{headers:{authorization:'Bearer test-credential',...headers},signal:controller.signal});
    assert.equal(response.headers.get('content-type'),'text/event-stream; charset=utf-8');
    const reader=response.body.getReader();let buffer='';
    return {controller,next:async()=>{
      while(true){const boundary=buffer.indexOf('\n\n');if(boundary>=0){const raw=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=raw.split('\n').find(line=>line.startsWith('data: '));if(data)return JSON.parse(data.slice(6));}
        else{const {value,done}=await reader.read();if(done)throw Error('SSE_CLOSED');buffer+=new TextDecoder().decode(value);}}
    }};
  };
  try {
    assert.equal((await fetch(url)).status,401);
    const initial=await packetReader({});
    const first=await initial.next();assert.equal(first.events[0].missionId,mission.id);
    bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'delivery',type:'run-tests',ok:true,verified:true}});
    let next=await initial.next();while(!next.events.length)next=await initial.next();
    assert.equal(next.events[0].evidence.outcome,'verified');
    initial.controller.abort();
    const reconnect=await packetReader({'Last-Event-ID':String(next.cursor)});
    assert.equal((await reconnect.next()).events.length,0);
    bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'after-reconnect',ok:false,error:'negative control'}});
    let failed=await reconnect.next();while(!failed.events.length)failed=await reconnect.next();
    assert.equal(failed.events.length,1);assert.equal(failed.events[0].evidence.outcome,'failed');
  }finally{for(const c of active)c.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));bus.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a disconnected or slow stream releases its timers and never fabricates recovery',()=>{
  const req=new EventEmitter();req.query={};req.get=()=>undefined;
  const res=new EventEmitter();let ended=false,frames=0;
  res.status=()=>res;res.set=()=>res;res.flushHeaders=()=>{};
  res.write=frame=>{frames++;assert.equal(frame.includes('runtime.recovered'),false);return false;};
  res.end=()=>{ended=true;};
  const bus={listEvents:()=>[],getMission:()=>null};
  createCognitiveStreamHandler({bus,workstream})(req,res);
  assert.equal(ended,true);assert.equal(frames,1);assert.equal(res.listenerCount('close'),0);
});


test('explicit conversational policy requests expose only the policy action, not mission mutations', async()=>{
  const original={observe:async()=>'',tools:{policy_update:{run:async()=>({saved:true})},start_goal:{run:async()=>{throw Error('must not run');}}}};
  for(const message of ['Jag vill minska godkännanden','Ändra autonominivå till 4','Godkänn inte publicering automatiskt']) {
    const t=cognitiveQuestionToolbox(original,()=>({}),message);
    assert.ok(t.tools.policy_update); assert.equal(t.tools.start_goal,undefined);
    assert.deepEqual(await t.tools.policy_update.run(),{saved:true});
  }
  for(const message of ['Varför ändra policyn?','Hur minskar jag godkännanden?','Vad händer med reglerna?','Jag vill se koden']) assert.equal(cognitiveQuestionToolbox(original,()=>({}),message).tools.policy_update,undefined);
});
