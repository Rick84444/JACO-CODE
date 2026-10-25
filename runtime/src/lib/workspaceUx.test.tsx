import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { UiLanguageProvider } from '../i18n/UiLanguage';
import { ActivationCard } from '../components/ActivationCard';
import { CognitiveWorkspace } from '../components/CognitiveWorkspace';
import { AuraChatPanel } from '../components/AuraChatPanel';

const renderToStaticMarkup = (node: React.ReactNode) => renderMarkup(<UiLanguageProvider initialLanguage="sv">{node}</UiLanguageProvider>);
const noop = () => {};
const activationProps = {onOpenProject:noop,onOpenProviders:noop,projectName:'My project'};

test('a failed initial status request offers retry without a permanent loading state', () => {
  const html=renderToStaticMarkup(<ActivationCard {...activationProps} activation={{report:null,loading:false,starting:false,error:'offline',read:async()=>{}}}/>);
  assert.match(html,/Status kunde inte hämtas/);
  assert.match(html,/Försök igen/);
  assert.doesNotMatch(html,/animate-spin/);
});

test('no model has a direct setup action in the main run controls', () => {
  const html=renderToStaticMarkup(<ActivationCard {...activationProps} activation={{report:{ok:false,runtime:{up:true},providers:[],planner:null,tools:{toolCount:0,ready:0,servers:[]},problems:[]},loading:false,starting:false,error:'',read:async()=>{}}}/>);
  assert.match(html,/Anslut en modell för att börja/);
  assert.match(html,/>Anslut modell</);
  assert.doesNotMatch(html,/Redo för ditt uppdrag/);
});

test('decisions are outside the canvas so switching to code does not hide them', () => {
  const html=renderToStaticMarkup(<CognitiveWorkspace canvas="code" onCanvas={noop} conversation="Conversation" detail="Code" stage="Stage" stagePinned={false} onTogglePin={noop}
    attention={<section>Operator decision</section>} sidePanel={null} sidebar="explorer" sidePanelOpen={false} onSidebar={noop} onCloseSidebar={noop}
    status={{label:'Needs decision',tone:'waiting'}} projectName="Project" changes={0} approvalCount={1} onApprovals={noop} onCommands={noop} onSignOut={noop} lastObservedAt={null} error={null}/>);
  assert.ok(html.indexOf('Operator decision') < html.indexOf('<main'));
  assert.match(html,/1 beslut behöver dig/);
  assert.match(html,/aria-label="Aura Live Workspace"/);
  assert.match(html,/Visa senaste arbetet/);
  assert.doesNotMatch(html,/Fler arbetsvyer/);
});

test('chat exposes response cancellation separately from the running mission', () => {
  const session:any={messages:[],setMessages:noop,appendMessage:async()=>{},storageReady:true,storageError:null,retryStorage:noop,input:'',setInput:noop,busy:'chat',setBusy:noop,toolArguments:'{}',setToolArguments:noop};
  const html=renderToStaticMarkup(<AuraChatPanel session={session} onStartGoal={noop} runControls={<section>Setup action</section>}/>);
  assert.match(html,/Avbryt svar/);
  assert.match(html,/aria-label="Väntetid"/);
  assert.match(html,/Setup action/);
  assert.match(html,/aria-pressed="true"[^>]*>[\s\S]*?Uppdrag/);
});

test('agent constellation exposes real relationships and missing planning without inventing agents', async () => {
  const { AgentConstellation } = await import('../components/AgentConstellation');
  const network:any={schema:'jaco.agent-network/v1',observedAt:new Date().toISOString(),coordinatorId:'root',nodes:[
    {id:'root',kind:'coordinator',name:'JACO',role:'Samordnare',parentId:null,status:'CONNECTED',purpose:'Coordinate actual work',model:null,source:'SEER',missionIds:[],planIds:[]},
    {id:'research',kind:'task-agent',name:'API specialist',role:'Uppdragsagent',parentId:'root',status:'READY',purpose:'Inspect actual interfaces',model:null,source:'SEER Mission Graph',missionIds:[],planIds:['plan'],dependencies:[]},
  ],links:[{from:'root',to:'research',kind:'delegation'}],plans:[{id:'plan',title:'Research the interface',objective:'Understand the actual code',status:'ACTIVE',agentIds:['research'],replans:[]}],planningAvailable:true,coordinatorAvailable:true,truncated:false};
  const html=renderToStaticMarkup(<AgentConstellation network={network} error={null} onSelectMission={noop}/>);
  assert.match(html,/API specialist, Uppdragsagent, Redo/);
  assert.match(html,/data-kind="delegation"/);
  assert.match(html,/Inspect actual interfaces|Research the interface/);
  assert.doesNotMatch(html,/Samordnaren svarar inte/);
  const missing=renderToStaticMarkup(<AgentConstellation network={{...network,planningAvailable:false,coordinatorAvailable:false,nodes:[{...network.nodes[0],status:'UNAVAILABLE'}],links:[],plans:[]}} error={null} onSelectMission={noop}/>);
  assert.match(missing,/Planerna kunde inte hämtas/);
  assert.doesNotMatch(missing,/API specialist/);
  assert.match(missing,/JACO, Samordnare, Inte nåbar/);
});

test('attachment controls distinguish uploaded copies and binary extraction limits',async()=>{
  const {AttachmentPicker}=await import('../components/AttachmentPicker');
  const html=renderToStaticMarkup(<AttachmentPicker items={[{id:'test',files:[{path:'notes/input.pdf',format:'binary'}]}]} onChange={noop} onBusy={noop} disabled={false}/>);
  assert.match(html,/Bifoga filer/);assert.match(html,/Bifoga mapp/);
  assert.match(html,/texttolkning saknas/);assert.match(html,/originalen ändras inte/);
});

test('connections workspace exposes live sources and the existing integration controls',async()=>{
  const {ConnectionsWorkspace}=await import('../components/ConnectionsWorkspace');
  const html=renderToStaticMarkup(<ConnectionsWorkspace onSelectTool={noop} onTabChange={noop}/>);
  for(const label of ['Anslutningar','Lokala verktyg','Webbläsare / CDP','Skills','Väntar på modellernas svar'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/Ingen tillgänglig modell observerad/,'no unobserved provider is claimed absent before the first response');
});

test('CDP refuses ambiguous URL-only attachment instead of choosing another identical tab',async()=>{
 const {CdpBridge}=await import('../server/browser/browserHandsOff');
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json([{id:'first',type:'page',url:'about:blank',webSocketDebuggerUrl:'ws://127.0.0.1/first'},{id:'second',type:'page',url:'about:blank',webSocketDebuggerUrl:'ws://127.0.0.1/second'}]);
 try {
  await assert.rejects(CdpBridge.attach(9222,'about:blank'),/CDP_TARGET_AMBIGUOUS/);
  await assert.rejects(CdpBridge.attach(9222,'about:blank','missing'),/no open tab/);
 }finally{globalThis.fetch=original;}
});

test('routine background observations are grouped while mission blockers stay in the conversation', () => {
  const session:any={messages:[],setMessages:noop,appendMessage:async()=>{},storageReady:true,storageError:null,retryStorage:noop,input:'',setInput:noop,busy:null,setBusy:noop,toolArguments:'{}',setToolArguments:noop};
  const event:any={id:'background',at:'2026-10-22T10:00:00Z',type:'mission.dispatch.started',category:'observation',title:'Ny observation',text:'Dispatcher started',missionId:null,evidence:{outcome:'observed'}};
  const html=renderToStaticMarkup(<AuraChatPanel session={session} onStartGoal={noop} liveEvents={[event,{...event,id:'blocked',category:'blocked',title:'Arbetet har ett hinder',text:'Anslutningen bröts',evidence:{outcome:'unknown'}}]}/>);
  const grouped=html.slice(html.indexOf('<details class="cognitive-background-events"'),html.indexOf('</details>')+10);
  assert.match(grouped,/Dispatcher started/);
  assert.doesNotMatch(grouped,/Anslutningen bröts/);
  assert.match(html,/Anslutningen bröts/);
});
