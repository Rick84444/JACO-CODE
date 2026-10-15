import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DurableMissionBus } from '../src/server/connected/durableMissionBus.mjs';
import { ProviderRegistry } from '../src/server/connected/providerRegistry.mjs';
import { WordPressService } from '../src/server/connected/wordpressService.mjs';
import { discoverAgentCards, sendA2ATask } from '../src/server/connected/a2aNetwork.mjs';
import { ConnectedRuntime } from '../src/server/connected/connectedRuntime.mjs';

const pass=[]; const ok=(name,fn)=>Promise.resolve().then(fn).then(()=>{pass.push(name);console.log('PASS',name)});
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-0191-'));

await ok('mission bus durable lease/restart/requeue', async()=>{
  const bus=new DurableMissionBus(tmp,{stateDir:path.join(tmp,'bus1')});
  bus.registerWorker('w',['cap']);
  const m=bus.createMission({goal:'durable',idempotencyKey:'k1'});
  assert.equal(bus.createMission({goal:'durable',idempotencyKey:'k1'}).id,m.id);
  const t=bus.enqueueTicket({missionId:m.id,capability:'cap',title:'t'});
  const c=bus.claimNext('w',['cap'],60_000); assert.equal(c.id,t.id); bus.start(t.id,'w',c.leaseToken); bus.close();
  const reopened=new DurableMissionBus(tmp,{stateDir:path.join(tmp,'bus1')});
  assert.equal(reopened.getTicket(t.id).status,'RUNNING');
  reopened.db.prepare("UPDATE tickets SET lease_expires_at=? WHERE id=?").run(new Date(Date.now()-1000).toISOString(),t.id);
  assert.equal(reopened.requeueExpiredLeases(),1); assert.equal(reopened.getTicket(t.id).status,'READY'); reopened.close();
});

let wpPage={id:1,slug:'home',status:'publish',title:{raw:'Old'},content:{raw:'<p>Old</p>'},link:''};
const network=createServer(async(req,res)=>{
  let body=''; for await(const c of req) body+=c;
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/v1/models'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({data:[{id:'fake-model'}]}));}
  if(url.pathname==='/v1/chat/completions'){
    const parsed=JSON.parse(body||'{}'); const sys=parsed.messages?.[0]?.content||'';
    const content=sys.includes('WordPress improvement worker')?JSON.stringify({title:'Improved',content:'<main><h1>Improved</h1><p>Verified content</p></main>'}):'Use a clear H1, preserve facts, verify public render.';
    res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({model:'fake-model',choices:[{message:{content}}],usage:{total_tokens:10}}));
  }
  if(url.pathname==='/wp-json/wp/v2/pages' && req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify([wpPage]));}
  if(url.pathname==='/wp-json/wp/v2/pages/1' && req.method==='GET'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(wpPage));}
  if(url.pathname==='/wp-json/wp/v2/pages/1' && req.method==='POST'){
    const v=JSON.parse(body||'{}'); if(v.title!=null)wpPage.title.raw=v.title;if(v.content!=null)wpPage.content.raw=v.content;
    res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify(wpPage));
  }
  if(url.pathname==='/page'){res.writeHead(200,{'content-type':'text/html'});return res.end(`<!doctype html><body>${wpPage.content.raw}</body>`);}
  if(url.pathname==='/agent-card.json'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({name:'Peer',url:`http://127.0.0.1:${network.address().port}/a2a`,skills:[{id:'research'}]}));}
  if(url.pathname==='/a2a' && req.method==='POST'){const p=JSON.parse(body||'{}');res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({jsonrpc:'2.0',id:p.id,result:{id:p.params?.id,status:{state:'completed'},artifacts:[{name:'receipt'}]}}));}
  res.writeHead(404);res.end('no');
});
network.listen(0,'127.0.0.1'); await once(network,'listening'); const port=network.address().port; wpPage.link=`http://127.0.0.1:${port}/page`;

await ok('generic provider probe and chat use real HTTP receipts', async()=>{
  const env={}; const reg=new ProviderRegistry(tmp,env); reg.register({id:'fake',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'fake-model'});
  const probe=await reg.probe('fake'); assert.equal(probe.ok,true); assert.ok(probe.responseHash);
  const chat=await reg.chat({providerId:'fake',messages:[{role:'user',content:'hello'}]}); assert.match(chat.content,/clear H1/); assert.ok(chat.requestHash&&chat.responseHash);
});

await ok('WordPress REST write -> edit readback -> public render', async()=>{
  const env={WORDPRESS_BASE_URL:`http://127.0.0.1:${port}`,WORDPRESS_USERNAME:'u',WORDPRESS_APP_PASSWORD:'app-pass'};
  const reg=new ProviderRegistry(tmp,env); reg.register({id:'fake2',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'fake-model'});
  const wp=new WordPressService({env,providers:reg}); const out=await wp.updatePage({pageId:1,title:'Manual',content:'<p>Manual verified</p>'});
  assert.equal(out.after.title,'Manual'); assert.equal(out.publicRender.status,200); assert.equal(out.evidence.length,3);
});

await ok('A2A discovery and outbound require real HTTP response', async()=>{
  // The fake peer runs on loopback, which outbound A2A only reaches when the exact origin is allowlisted.
  process.env.JACO_A2A_ALLOWED_PRIVATE_ORIGINS=`http://127.0.0.1:${port}`;
  const card=await discoverAgentCards([`http://127.0.0.1:${port}/agent-card.json`]); assert.equal(card[0].ok,true); assert.ok(card[0].responseHash);
  const receipt=await sendA2ATask({endpoint:`http://127.0.0.1:${port}/a2a`,skill:'research',message:'test'}); assert.equal(receipt.status,200); assert.equal(receipt.response.result.status.state,'completed');
});

await ok('SEER goal -> Forge -> Aura provider -> WordPress subagent -> evidence -> learning', async()=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-connected-'));
  const env={WORDPRESS_BASE_URL:`http://127.0.0.1:${port}`,WORDPRESS_USERNAME:'u',WORDPRESS_APP_PASSWORD:'app-pass'};
  const events=[]; const seer={update:x=>events.push(['update',x]),record:x=>events.push(['record',x])};
  const forge={compileIntuition:goal=>({id:'g1',goal,desiredOutcome:'verified',fixedConstraints:[],completionCriteria:['evidence'],autonomyTier:'LOCAL_AUTO'}),compileProject:c=>({projectId:'p1',structure:['mission-bus'],generatedFiles:0,assignedJourneys:[],goal:c.goal})};
  const rt=new ConnectedRuntime({workspaceRoot:workspace,forge,seerLive:seer,env});
  rt.providers.register({id:'fake',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'fake-model'});
  const created=rt.createGoal({goal:'Förbättra WordPress hemsida med verifierad render',providerId:'fake',pageId:1,idempotencyKey:'e2e'});
  await rt.tick(); await rt.tick();
  assert.equal(rt.bus.getMission(created.mission.id).status,'DONE');
  const tickets=rt.bus.listTickets({missionId:created.mission.id}); assert.deepEqual(tickets.map(t=>t.status),['DONE','DONE','DONE']);
  assert.ok(tickets.every(t=>Array.isArray(t.evidence)&&t.evidence.length>0));
  assert.equal(rt.bus.dispatchPressure().invariant,'CLEAR');
  assert.ok(events.some(e=>e[1]?.type==='seer.learning.consumed'));
  rt.bus.close();
});

await ok('Nova Hands-Off ticket returns verified receipt and syncs evidence to SEER', async()=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-nova-connected-'));
  const events=[]; const seer={update:x=>events.push(['update',x]),record:x=>events.push(['record',x])};
  const forge={compileIntuition:goal=>({id:'g2',goal,desiredOutcome:'verified',fixedConstraints:[],completionCriteria:['evidence'],autonomyTier:'LOCAL_AUTO'}),compileProject:c=>({projectId:'p2',structure:['mission-bus','nova'],generatedFiles:0,assignedJourneys:[],goal:c.goal})};
  const receipts=[];
  const rt=new ConnectedRuntime({workspaceRoot:workspace,forge,seerLive:seer,env:{},executeNovaAction:async payload=>{
    const receipt={verified:true,surface:payload.surface,actionType:payload.action?.type||'observe',beforeHash:'before',afterHash:'after'}; receipts.push(receipt); return {verified:true,receipt};
  }});
  rt.providers.register({id:'fake-nova',baseUrl:`http://127.0.0.1:${port}/v1`,defaultModel:'fake-model'});
  const created=rt.createGoal({goal:'Verifiera Android Hands-Off via Nova och synka resultat till SEER',providerId:'fake-nova',surface:'ANDROID',action:{type:'observe'},mandateId:'mandate-test',idempotencyKey:'nova-e2e'});
  await rt.tick(); await rt.tick();
  const mission=rt.bus.getMission(created.mission.id); const tickets=rt.bus.listTickets({missionId:created.mission.id});
  assert.equal(mission.status,'DONE');
  assert.deepEqual(tickets.map(t=>t.status),['DONE','DONE','DONE']);
  const nova=tickets.find(t=>t.capability==='nova.hands_off');
  assert.ok(nova?.evidence?.some(e=>e.type==='nova_hands_off_receipt'));
  assert.equal(receipts.length,1);
  assert.ok(events.some(e=>e[1]?.type==='nova.hands_off.verified'));
  assert.ok(events.some(e=>e[0]==='update' && e[1]?.latestVerifiedProgress==='nova.hands_off DONE'));
  rt.bus.close();
});

await ok('truth patches remove synthetic Forge/worker/provider success', async()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const forge=fs.readFileSync(path.join(root,'src/server/forge/jacoForge.ts'),'utf8');
  const worker=fs.readFileSync(path.join(root,'src/server/agents/workerRunner.ts'),'utf8');
  const pool=fs.readFileSync(path.join(root,'src/server/modelPool/poolManager.ts'),'utf8');
  assert.doesNotMatch(forge,/status:\s*'PASSED',[\s\S]{0,120}evidenceHash:\s*'sha256-/);
  assert.match(worker,/UNSUPPORTED_JOB_TYPE/); assert.match(pool,/PROVIDER_UNAVAILABLE/); assert.doesNotMatch(pool,/DETERMINISTIC_OFFLINE_FALLBACK/);
});

network.close();
console.log(`connected-0191: PASS (${pass.length}/${pass.length})`);
