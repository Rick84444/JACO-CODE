import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivationCard } from '../components/ActivationCard';
import { CognitiveWorkspace } from '../components/CognitiveWorkspace';
import { AuraChatPanel } from '../components/AuraChatPanel';

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
  const html=renderToStaticMarkup(<CognitiveWorkspace canvas="code" onCanvas={noop} conversation="Conversation" detail="Code"
    attention={<section>Operator decision</section>} sidePanel={null} sidebar="explorer" sidePanelOpen={false} onSidebar={noop} onCloseSidebar={noop}
    status={{label:'Needs decision',tone:'waiting'}} projectName="Project" changes={0} approvalCount={1} onApprovals={noop} onCommands={noop} onSignOut={noop} lastObservedAt={null} error={null}/>);
  assert.ok(html.indexOf('Operator decision') < html.indexOf('<main'));
  assert.match(html,/1 beslut behöver dig/);
  assert.match(html,/Fler arbetsvyer/);
});

test('chat exposes response cancellation separately from the running mission', () => {
  const session:any={messages:[],setMessages:noop,appendMessage:async()=>{},storageReady:true,storageError:null,retryStorage:noop,input:'',setInput:noop,busy:'chat',setBusy:noop,toolArguments:'{}',setToolArguments:noop};
  const html=renderToStaticMarkup(<AuraChatPanel session={session} onStartGoal={noop} runControls={<section>Setup action</section>}/>);
  assert.match(html,/Avbryt svar/);
  assert.match(html,/aria-label="Väntetid"/);
  assert.match(html,/Setup action/);
  assert.match(html,/aria-pressed="true"[^>]*>[\s\S]*?Uppdrag/);
});
