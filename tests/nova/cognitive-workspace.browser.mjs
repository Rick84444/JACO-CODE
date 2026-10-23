// Controlled browser integration test. The test server never starts a model or an agent.
// It uses the real mission store, encrypted chat store, live handler and production client.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { createAuraChatSession } from '../../runtime/src/server/connected/auraChatSession.mjs';
import { createCognitiveStreamHandler } from '../../runtime/src/server/connected/cognitiveLiveStream.mjs';
import { summarizeNovaMission } from '../../runtime/src/lib/novaActivityText.ts';
import { gameboardProjection, simulateGameboardScenario } from '../../agents/lib/gameboard-fabric.mjs';
import { createGameboardExchange } from '../../agents/lib/gameboard-exchange.mjs';

const release=fileURLToPath(new URL('../../runtime/',import.meta.url));
const require=createRequire(path.join(release,'package.json'));
const express=require('express');
const {chromium}=await import(process.env.JACO_PLAYWRIGHT_MODULE || require.resolve('playwright'));
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-ui-test-'));
let bus=new DurableMissionBus(directory),chat=createAuraChatSession(bus),blockLive=false,blockSession=false,liteAck=false,rejectGoal=false;
const workstream={snapshot:()=>({events:[]})},liveResponses=new Set(),requests=[];
const code={ 'example.ts':'export const checked = true;\n',
  'preview.html':'<style>body{font-family:system-ui;padding:32px;color:#153345}h1{font-weight:500}</style><h1>Isolerad förhandsvisning</h1><p id="boundary"></p><script>try{window.parent.document.body.dataset.changed="unsafe";document.querySelector("#boundary").textContent="boundary failed";}catch{document.querySelector("#boundary").textContent="isolated";}</script>' };
const file=relative=>({success:true,path:relative,content:code[relative],language:relative.endsWith('.ts')?'typescript':'html',size:code[relative].length,hash:crypto.createHash('sha256').update(code[relative]).digest('hex')});
const missions=()=>bus.listMissions(30).map(base=>{
  const receipts=bus.listEvents(1000).filter(e=>e.missionId===base.id&&e.type==='NOVA_ACTION_RESULT').reverse().map(e=>({...e.payload,at:e.ts}));
  const started=bus.lastMissionEvent(base.id,'NOVA_ACTION_STARTED');
  return summarizeNovaMission({...base,phase:'EXECUTING',receipts,turn:receipts.length},started?.payload?.action);
});
const snapshot=()=>({success:true,schema:'jaco.aura-workbench/v1',observedAt:new Date().toISOString(),
  workplace:{reachable:false,status:'TEST_FIXTURE',agents:[],error:null},seer:{phase:'IDLE',primaryGoal:null,provider:null,model:null},
  mission:null,missions:missions(),runtime:{running:true,workers:[],dispatchPressure:{}},providers:[],skills:[],tools:[],activity:bus.listEvents(100).map(e=>({id:'nova:'+e.seq,at:e.ts,type:e.type,missionId:e.missionId,payload:e.payload})),
  git:{available:true,branch:'test-fixture',tracking:null,ahead:0,behind:0,dirty:false,changes:[]},
  mcp:{schema:'test-fixture',providers:[],sources:[]},approvals:{count:0,items:[],actionRequired:false,activeMandates:[]},integrations:{}});
const app=express();app.use(express.json());
app.get('/api/aura/workbench/live',(req,res)=>{
  if(blockLive)return res.status(503).json({success:false,error:'TEST_CONNECTION_DOWN'});
  liveResponses.add(res);res.on('close',()=>liveResponses.delete(res));
  createCognitiveStreamHandler({bus,workstream,intervalMs:150})(req,res);
});
app.get('/api/aura/workbench',(_req,res)=>res.json(snapshot()));
app.get('/api/aura/workbench/gameboard',(_req,res)=>res.json({success:true,
  ...gameboardProjection({graphs:null,graphError:'SEER_NOT_RUNNING_IN_TEST',workers:bus.listWorkers(),missions:bus.listMissions(30)}),
  exchange:createGameboardExchange(bus.db).position('global'),
}));
app.get('/api/aura/workbench/gameboard/events',(req,res)=>res.json({success:true,...createGameboardExchange(bus.db).position(String(req.query.scope||'global'))}));
app.post('/api/aura/workbench/gameboard/events',(req,res)=>{
  try {res.status(201).json({success:true,...createGameboardExchange(bus.db).publish(req.body)});}
  catch(error){res.status(409).json({success:false,error:error.message});}
});
app.post('/api/aura/workbench/gameboard/simulate',(req,res)=>{
  try {res.json({success:true,...simulateGameboardScenario(req.body)});}
  catch(error){res.status(400).json({success:false,error:error.message});}
});

app.get('/api/aura/workbench/project',(_req,res)=>res.json({success:true,root:'/test/Verifiering',git:true,history:[]}));
app.get('/api/aura/workbench/files',(_req,res)=>res.json({success:true,files:Object.keys(code).map(p=>({path:p,size:code[p].length}))}));
app.get('/api/aura/workbench/tree',(_req,res)=>res.json({success:true,path:'',entries:Object.keys(code).map(p=>({name:p,path:p,kind:'file',size:code[p].length}))}));
app.get('/api/aura/workbench/file',(req,res)=>code[req.query.path]?res.json(file(req.query.path)):res.status(404).json({success:false,error:'NOT_FOUND'}));
app.put('/api/aura/workbench/file',(req,res)=>{
  const previous=file(req.body.path);
  requests.push({kind:'save',body:req.body});
  if(req.body.expectedHash!==previous.hash)return res.status(409).json({success:false,error:'WORKBENCH_FILE_CONFLICT'});
  code[req.body.path]=req.body.content;res.json({...file(req.body.path),changed:true});
});
app.get('/api/aura/chat/models',(_req,res)=>res.json({success:true,default:'seer',cloud:[],providers:[]}));
app.get('/api/aura/chat/session',(_req,res)=>blockSession?res.status(503).json({success:false,error:'TEST_SESSION_DOWN'}):res.json({success:true,messages:chat.list()}));
app.post('/api/aura/chat/session/messages',(req,res)=>res.json({success:true,message:chat.append(req.body)}));
app.post('/api/aura/chat',(req,res)=>{
  requests.push({kind:'chat',body:req.body});
  res.json({success:true,reply:'Testsvaret använder de observerade händelserna. Uppdraget fortsätter.',provider:'test-fixture',model:'no-inference'});
});
app.post('/api/aura/workbench/start-goal',(req,res)=>{
  requests.push({kind:'goal',body:req.body});
  if(rejectGoal)return res.status(503).json({success:false,error:'TEST_GOAL_REJECTED'});
  const mission=bus.createMission({goal:req.body.goal,source:'browser-test'});
  res.status(201).json(liteAck?{success:true,lite:true,mission}:{success:true,goal:mission});
});
app.post('/api/aura/workbench/missions/:id/cancel',(req,res)=>{bus.db.prepare("UPDATE missions SET status='CANCELLED' WHERE id=?").run(req.params.id);res.json({success:true});});
app.use('/api',(_req,res)=>res.status(503).json({success:false,error:'TEST_ENDPOINT_UNAVAILABLE'}));
app.use(express.static(path.join(release,'dist')));
app.get('*',(_req,res)=>res.sendFile(path.join(release,'dist/index.html')));
const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
const base='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.JACO_BROWSER_EXECUTABLE?{executablePath:process.env.JACO_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']}: {})});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
page.setDefaultTimeout(15000);
// Monaco may reject an already-running language/model task when an editor is
// deliberately disposed (e.g. after changing projects). This exact cancellation
// is not an app exception; any other page error still fails the browser gate.
const errors=[];
const expectedEditorCancels=[];
page.on('pageerror',error=>{
  const detail=error.stack||error.message;
  const fromMonaco=/assets\/AuraCodeEditor-[^\s]+\.js/.test(detail);
  const cancelled=/^Cancel(?:ed|led): Cancel(?:ed|led)(?:\n|$)/.test(detail);
  const duringDisposal=/\.(?:dispose|cancel) \(/.test(detail);
  if(fromMonaco && cancelled && duringDisposal){
    expectedEditorCancels.push(detail);
    console.log('MONACO_EXPECTED_DISPOSAL_CANCELLATION');
    return;
  }
  errors.push(detail);
  console.error("PAGE_ERROR "+detail);
});
const results=[];const passed=name=>{results.push(name);console.log('PASS '+name);};
const input=()=>page.getByRole('textbox',{name:'Meddelande till JACO'});
// Exercise the same work navigation a real user sees at the current viewport.
const canvas = label => ({ click: async () => {
  const mobile = await page.evaluate(() => innerWidth < 768);
  if (!mobile) {
    if (label === 'Samtal') await page.getByRole('button', { name: 'Visa samtalet', exact: true }).click();
    else await page.getByRole('navigation', { name: 'Arbetsyta' }).getByRole('button', { name: label, exact: true }).click();
    return;
  }
  if (['Samtal', 'Arbete', 'Agenter'].includes(label)) {
    await page.getByRole('navigation', { name: 'Mobilnavigation' }).getByRole('button', { name: label, exact: true }).click();
    return;
  }
  await page.getByRole('navigation', { name: 'Mobilnavigation' }).getByRole('button', { name: 'Fler funktioner' }).click();
  await page.getByRole('dialog', { name: 'Din arbetsyta' }).getByRole('button', { name: label, exact: true }).click();
} });
const screenshot=async name=>{
  if(!process.env.JACO_UI_SCREENSHOTS)return;
  fs.mkdirSync(process.env.JACO_UI_SCREENSHOTS,{recursive:true});
  await page.evaluate(()=>{
    let marker=document.getElementById('ui-test-marker');
    if(!marker){marker=document.createElement('div');marker.id='ui-test-marker';marker.textContent='SIMULATED · Kontrollerad webbläsarverifiering, ingen agentkörning';marker.style.cssText='position:fixed;bottom:0;right:0;background:#263747;color:#b6c8d5;font:9px system-ui;padding:4px 8px;z-index:99999;';document.body.append(marker);}
  });
  await page.screenshot({path:path.join(process.env.JACO_UI_SCREENSHOTS,name+'.png')});
};
try {
  blockSession=true;
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Försök läsa igen'}).waitFor();
  await input().fill('Bevarat vid återanslutning');
  blockSession=false;
  await page.getByRole('button',{name:'Försök läsa igen'}).click();
  await page.getByRole('heading',{name:'Vad vill du skapa?'}).waitFor();
  assert.equal(await input().inputValue(),'Bevarat vid återanslutning');
  await input().fill('');
  passed('A failed initial history read can reconnect without losing the draft');
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Vad vill du skapa?'}).waitFor();
  assert.equal(await page.locator('.cognitive-brand img').evaluate(img=>img.naturalWidth>0),true);
  assert.equal(await page.locator('.monaco-editor').count(),0,'defer the editor until a file is opened');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  passed('Production client opens with the real JACO brand, one conversation and no overflow');
  await screenshot('cognitive-workspace-desktop');
  await input().fill('Behåll mitt utkast');
  await canvas('Kod').click();await canvas('Samtal').click();
  assert.equal(await input().inputValue(),'Behåll mitt utkast');
  await page.locator('.cognitive-status').click();
  await page.keyboard.press('Control+Shift+Digit2');
  assert.equal(await page.getByRole('navigation',{name:'Arbetsyta'}).getByRole('button',{name:'Kod',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Control+Shift+Digit1');
  assert.equal(await page.getByRole('navigation',{name:'Arbetsyta'}).getByRole('button',{name:'Arbete',exact:true}).getAttribute('aria-pressed'),'true');
  await input().focus();
  await page.keyboard.press('Control+Shift+Digit4');
  assert.equal(await page.getByRole('navigation',{name:'Arbetsyta'}).getByRole('button',{name:'Arbete',exact:true}).getAttribute('aria-pressed'),'true','editing chat must not switch views');
  assert.equal(await input().inputValue(),'Behåll mitt utkast');
  await page.setViewportSize({width:393,height:852});
  await canvas('Arbete').click();
  await page.getByTestId('aura-live-stage').waitFor();
  assert.equal(await page.getByRole('navigation',{name:'Mobilnavigation'}).getByRole('button',{name:'Arbete',exact:true}).getAttribute('aria-pressed'),'true');
  await canvas('Samtal').click();
  await canvas('Belägg').click();
  await canvas('Samtal').click();
  assert.equal(await input().inputValue(),'Behåll mitt utkast');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  passed('Desktop and mobile view changes retain the same draft and conversation session');
  await canvas('Spelplan').click();
  await page.locator('section[aria-label="Gemensam spelplan"]').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Gameboard must not overflow Android-size viewport');
  await canvas('Samtal').click();
  assert.equal(await input().inputValue(),'Behåll mitt utkast','Gameboard cannot discard the mobile conversation draft');
  passed('Gameboard tab fits mobile viewport and preserves one conversation');

  await canvas('Spelplan').click();
  await page.locator('section[aria-label="Gemensam spelplan"]').waitFor();
  await page.getByText('SEER: UNAVAILABLE').waitFor();
  await page.locator('section[aria-label="Gemensam spelplan"] input[list="gameboard-tools"]').first().fill('mcp:git:git_status');
  await page.getByRole('button',{name:'Simulera utan exekvering'}).click();
  await page.getByText('Verkställt: nej', {exact:false}).waitFor();
  assert.equal(bus.listMissions(10).length,0,'a hypothetical strategy cannot create a mission');
  await canvas('Samtal').click();
  assert.equal(await input().inputValue(),'Behåll mitt utkast');
  passed('Native Gameboard runs a real pure scenario without executing or losing the chat');

  await input().fill('');await screenshot('cognitive-workspace-mobile');
  await page.setViewportSize({width:1440,height:960});
  const mission=bus.createMission({goal:'Testuppdrag: verifiera HTTP-klienten',source:'browser-test'});
  bus.event('NOVA_ACTION_STARTED',{missionId:mission.id,payload:{action:{id:'read-example',type:'repo-read',data:{path:'example.ts'}}}});
  await page.locator('[data-event-id="mission:2"]').waitFor();
  assert.equal(await page.locator('[data-event-id="mission:2"]').count(),1);
  await page.locator('[data-mission-id]').waitFor({timeout:10000});
  passed('A real SSE event is inserted exactly once in the conversation with its mission');
  bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'read-example',type:'repo-read',ok:true,verified:false,result:{path:'example.ts'}}});
  await page.getByText('Verifiering saknas',{exact:true}).waitFor();
  bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'failed-test',type:'repo-test',ok:false,verified:true,error:'TEST_NEGATIVE_CONTROL',result:{exitCode:1}}});
  await page.locator('[data-event-id="mission:4"][data-outcome="failed"]').waitFor();
  assert.equal(await page.locator('[data-event-id="mission:4"]').getByText('Verifierat resultat',{exact:true}).count(),0);
  passed('A successful unverified step and a failing step cannot masquerade as verified');
  await page.getByRole('button',{name:'Vad har du upptäckt?',exact:true}).click();
  await page.getByRole('button',{name:'Skicka meddelande',exact:true}).click();
  await page.getByText('Testsvaret använder de observerade händelserna. Uppdraget fortsätter.',{exact:true}).waitFor();
  assert.equal(requests.filter(r=>r.kind==='goal').length,0);
  assert.equal(requests.at(-1).body.interactionMode,'question');
  const context=requests.at(-1).body.ragContext.find(r=>r.source==='jaco://current-work').content;
  assert.equal(context.mission.id,mission.id);assert.ok(context.events.some(e=>e.outcome==='failed'));
  assert.equal(bus.listMissions(10).length,1);
  passed('A question receives observed run context and does not restart or replace the mission');
  bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'pass-test',type:'repo-test',ok:true,verified:true,result:{path:'example.ts',exitCode:0}}});
  await page.locator('[data-event-id="mission:5"][data-outcome="verified"]').waitFor();
  await screenshot('cognitive-workspace-live');
  await page.locator('[data-event-id="mission:5"]').getByRole('button',{name:'Visa belägg'}).click();
  await page.getByRole('region',{name:'Valt belägg'}).waitFor();
  assert.ok((await page.getByRole('region',{name:'Valt belägg'}).innerText()).includes('Beständig uppdragshistorik'));
  await screenshot('cognitive-workspace-evidence');
  passed('Evidence opens beside the conversation and identifies its durable source');
  await canvas('Samtal').click();
  await page.locator('[data-event-id="mission:3"]').getByRole('button',{name:'example.ts'}).click();
  await page.locator('.monaco-editor').first().waitFor({timeout:15000});
  const editorNode=await page.locator('.monaco-editor').first().elementHandle();
  passed('An event opens the real, deferred Monaco editor for its referenced file');
  await canvas('Förhandsvisa').click();await page.getByRole('button',{name:'preview.html',exact:true}).click();
  assert.equal(await editorNode.evaluate(node=>node.isConnected),true,'retain the initialized editor across contextual views');
  await page.frameLocator('iframe').getByRole('heading',{name:'Isolerad förhandsvisning'}).waitFor();
  assert.equal(await page.frameLocator('iframe').locator('#boundary').innerText(),'isolated');
  assert.equal(await page.evaluate(()=>document.body.dataset.changed||null),null);
  passed('HTML preview runs in an isolated origin and cannot mutate the IDE');
  code['preview.html']=code['preview.html'].replace('Isolerad förhandsvisning','Ny observerad version');
  bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'write-preview',type:'repo-write',ok:true,verified:true,result:{path:'preview.html'}}});
  await page.frameLocator('iframe').getByRole('heading',{name:'Ny observerad version'}).waitFor();
  passed('An observed file write updates the open preview without reopening it');
  await canvas('Kod').click();
  await page.locator('.cognitive-file-tabs').getByRole('button',{name:'example.ts',exact:true}).click();
  await page.locator('.monaco-editor textarea').focus();await page.keyboard.press('Control+KeyA');
  await page.keyboard.insertText('export const userDraft = "keep";');
  await page.waitForFunction(()=>document.querySelector('.monaco-editor .view-lines')?.textContent.includes('userDraft'));
  code['example.ts']='export const serverVersion = true;\n';
  bus.event('NOVA_ACTION_RESULT',{missionId:mission.id,payload:{actionId:'write-code',type:'repo-write',ok:true,verified:true,result:{path:'example.ts'}}});
  await page.getByText('Filen har ändrats i arbetsytan. Ditt utkast är bevarat.',{exact:false}).waitFor();
  assert.ok((await page.locator('.monaco-editor .view-lines').innerText()).includes('userDraft'));
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('File changed on disk. Reload before saving.',{exact:true}).waitFor();
  assert.equal(code['example.ts'],'export const serverVersion = true;\n');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Läs senaste filen',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.monaco-editor .view-lines')?.textContent.includes('serverVersion'));
  passed('A live file update preserves a dirty draft, rejects a conflicting save and requires explicit reload');
  await canvas('Samtal').click();await input().fill('Ett bevarat utkast');
  blockLive=true;for(const response of liveResponses)response.end();
  await page.getByRole('status').filter({hasText:'Anslutningen behöver återställas'}).waitFor({timeout:12000});
  assert.equal(await input().inputValue(),'Ett bevarat utkast');
  blockLive=false;
  await page.getByRole('status').filter({hasText:'Arbetar'}).waitFor({timeout:15000});
  assert.equal(await page.locator('[data-event-id="mission:5"]').count(),1);
  passed('Live connection interruption preserves the draft, exposes uncertainty and reconnects without duplicates');
  for(const response of liveResponses)response.end();
  bus.close();bus=new DurableMissionBus(directory);chat=createAuraChatSession(bus);
  await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-event-id="mission:5"]').waitFor();
  assert.equal(await page.locator('[data-event-id="mission:5"]').count(),1);
  await page.getByText('Testsvaret använder de observerade händelserna. Uppdraget fortsätter.',{exact:true}).waitFor();
  passed('A store restart replays both durable events and the saved encrypted conversation');
  liteAck=true;
  await input().fill('Testa ett Lite-uppdrag');
  await page.getByRole('button',{name:'Uppdrag',exact:true}).click();
  await page.getByRole('button',{name:'Starta uppdrag',exact:true}).click();
  await page.getByText('Uppdraget är registrerat. Planering och resultat visas här när runtime rapporterar dem.',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.cognitive-compose-modes button[aria-pressed=true]')?.textContent.includes('Fråga'));
  assert.equal(requests.filter(r=>r.kind==='goal').length,1);
  passed('Lite mission acknowledgements are accepted without claiming completed work');
  rejectGoal=true;await input().fill('Detta ska inte registreras');
  await page.getByRole('button',{name:'Uppdrag',exact:true}).click();
  await page.getByRole('button',{name:'Starta uppdrag',exact:true}).click();
  await page.getByText('Uppdragets registrering kunde inte bekräftas: TEST_GOAL_REJECTED',{exact:true}).waitFor();
  assert.equal(bus.listMissions(10).length,2);assert.equal(await input().inputValue(),'Detta ska inte registreras');
  passed('Rejected goal creation keeps the request text and never creates a false activation message');
  assert.deepEqual(errors,[], 'no unexpected uncaught app/browser errors');
  if(expectedEditorCancels.length) console.log('Monaco disposal cancellations observed: '+expectedEditorCancels.length);
  const report={status:'PASS',checks:results.length,browser:browser.version(),observedAt:new Date().toISOString(),scope:'Controlled UI integration; no inference, Android or operator runtime execution',clientIndexSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(release,'dist/index.html'))).digest('hex'),results};
  console.log(JSON.stringify(report,null,2));
  if(process.env.JACO_UI_SCREENSHOTS){
    fs.writeFileSync(path.join(process.env.JACO_UI_SCREENSHOTS,'cognitive-workspace-verification.json'),JSON.stringify(report,null,2)+'\n');
    fs.rmSync(path.join(process.env.JACO_UI_SCREENSHOTS,'cognitive-test-failure.png'),{force:true});
  }
}catch(error){
  if(process.env.JACO_UI_SCREENSHOTS)await screenshot('cognitive-test-failure');
  console.error(error);process.exitCode=1;
}finally {
  await browser.close();for(const response of liveResponses)response.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));bus.close();fs.rmSync(directory,{recursive:true,force:true});
}
