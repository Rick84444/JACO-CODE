import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { productText } from '../../runtime/src/i18n/productText.mjs';

test('product copy defaults to English and supports explicit Swedish interpolation', () => {
  assert.equal(productText('Connect model'), 'Connect model');
  assert.equal(productText('Connect model', 'sv'), 'Anslut modell');
  assert.equal(productText('Open task: {0}', 'en', ['Keep my goal']), 'Open task: Keep my goal');
  assert.equal(productText('Open task: {0}', 'sv', ['Behåll mitt mål']), 'Öppna uppdrag: Behåll mitt mål');
  assert.equal(productText('Ansluter till JACO', 'en'), 'Connecting to JACO');
  assert.equal(productText('Unknown provider / custom-model', 'sv'), 'Unknown provider / custom-model');
  assert.equal(productText('constructor'), 'constructor');
  assert.equal(productText('__proto__'), '__proto__');
});

test('legacy system templates translate while interpolated values remain literal', () => {
  assert.equal(productText('5 sek sedan', 'en'), '5 sec ago');
  assert.equal(productText('Läser en fil: src/main.ts', 'en'), 'Reading a file: src/main.ts');
  assert.equal(productText('Läser en fil: resultatet är verifierat.', 'en'), 'Reading a file: result verified.');
  assert.equal(productText('Could not release: REMOTE_UNKNOWN', 'sv'), 'Kunde inte frigöra: REMOTE_UNKNOWN');
  assert.equal(productText('Open task: {0}', 'en', ['<script>$&</script>']), 'Open task: <script>$&</script>');
});

const runtime = fileURLToPath(new URL('../../runtime/', import.meta.url));
const runtimeRequire = createRequire(path.join(runtime, 'package.json'));
let esbuild;
try {
  esbuild = runtimeRequire('esbuild');
  runtimeRequire.resolve('react-dom/server');
  runtimeRequire.resolve('lucide-react');
} catch { /* Runtime UI dependencies are installed in the canonical build gate. */ }

test('rendered onboarding and task surfaces use English by default and retain Swedish', { skip: !esbuild }, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-product-language-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'render.cjs');
  await esbuild.build({
    stdin: { resolveDir: runtime, sourcefile: 'product-language.tsx', loader: 'tsx', contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { UiLanguageProvider } from './src/i18n/UiLanguage';
      import { ConnectionsWorkspace } from './src/components/ConnectionsWorkspace';
      import { ProviderConnect } from './src/components/ProviderConnect';
      import { McpServersPanel } from './src/components/McpServersPanel';
      import { MissionReview } from './src/components/MissionReview';
      import { CognitiveEventCard } from './src/components/CognitiveEventCard';
      import { AgentConstellation } from './src/components/AgentConstellation';
      import { CognitiveWorkspace } from './src/components/CognitiveWorkspace';
      const noop=()=>{};
      const render=(node, language)=>renderToStaticMarkup(<UiLanguageProvider initialLanguage={language}>{node}</UiLanguageProvider>);
      const network={schema:'jaco.agent-network/v1',observedAt:'2026-11-01T10:00:00Z',coordinatorId:'root',nodes:[{id:'root',kind:'coordinator',name:'JACO',role:'Samordnare',parentId:null,status:'READY',purpose:'Behåll mitt mål',model:null,source:'Planner',missionIds:[],planIds:[]}],links:[],plans:[],planningAvailable:true,coordinatorAvailable:true,truncated:false};
      const event={id:'result',type:'NOVA_ACTION_RESULT',category:'result',title:'Arbete pågår',text:'Läser en fil: resultatet är verifierat.',at:'2026-11-01T10:00:00Z',evidence:{outcome:'verified',path:null,url:null,commit:null,error:null,exitCode:0}};
      const panels={
        connections:<ConnectionsWorkspace onSelectTool={noop} onTabChange={noop}/>,
        provider:<ProviderConnect onConnected={noop}/>,
        mcp:<McpServersPanel providers={[{id:'local',name:'Local tools',role:'Project tools',status:'READY',transport:'stdio',agentAccess:'read',error:null,tools:[]}]} recentCalls={[]} busy={null} selectedToolId={null} onStart={noop} onSelectTool={noop} onChanged={noop}/>,
        review:<MissionReview missions={[]} onDecisions={noop}/>,
        evidence:<CognitiveEventCard event={event}/>,
        agents:<AgentConstellation network={network} error={null} onSelectMission={noop}/>,
        workspace:<CognitiveWorkspace canvas="conversation" onCanvas={noop} conversation="Conversation" detail={null} stage={null} stagePinned={false} onTogglePin={noop} sidePanel={null} sidebar="providers" sidePanelOpen={true} onSidebar={noop} onCloseSidebar={noop} status={{label:'Ansluter till arbetsytan',tone:'waiting'}} projectName="Project" changes={0} approvalCount={0} onApprovals={noop} onCommands={noop} onSignOut={noop} lastObservedAt={null} error={null}/>,
      };
      console.log(JSON.stringify(Object.fromEntries(Object.entries(panels).map(([key,node])=>[key,{en:render(node,undefined),sv:render(node,'sv')}]))));
    ` },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
  });
  const child = spawnSync(process.execPath, [output], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.status, 0, child.stderr);
  const rendered = JSON.parse(child.stdout);
  assert.match(rendered.connections.en, />Connections</);
  assert.match(rendered.connections.en, /href="\/connect.html">Setup</);
  assert.match(rendered.connections.en, /Waiting for model services/);
  assert.doesNotMatch(rendered.connections.en, /Anslutningar|Tillgängliga LLM|Väntar på/);
  assert.match(rendered.connections.sv, />Anslutningar</);
  assert.match(rendered.provider.en, /aria-label="Choose API provider"/);
  assert.match(rendered.provider.en, /type="password"[^>]+aria-label="API key for a custom model service"/);
  assert.match(rendered.provider.sv, /aria-label="Välj API-leverantör"/);
  assert.match(rendered.mcp.en, /Read and write/);
  assert.match(rendered.mcp.sv, /Läsa och ändra/);
  assert.match(rendered.review.en, /Task results/);
  assert.match(rendered.review.sv, /Agentens resultat/);
  assert.match(rendered.evidence.en, /Work in progress/);
  assert.match(rendered.evidence.en, /Reading a file: result verified/);
  assert.match(rendered.evidence.sv, /Läser en fil: resultatet är verifierat/);
  assert.match(rendered.agents.en, /JACO, Coordinator, Ready/);
  assert.match(rendered.agents.sv, /JACO, Samordnare, Redo/);
  assert.match(rendered.agents.en, /Behåll mitt mål/, 'operator goals must not be translated');
  assert.match(rendered.workspace.en, /Model connections/);
  assert.match(rendered.workspace.en, /Connecting to workspace/);
  assert.doesNotMatch(rendered.workspace.en, /Modellanslutningar|Ansluter till arbetsytan/);
});
