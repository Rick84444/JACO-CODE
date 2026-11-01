import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AURA_FUNCTION_DEFINITIONS, projectAuraFunctions } from '../../runtime/src/server/connected/auraFunctions.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';

const now = '2026-10-30T12:00:00.000Z';
const read = rel => fs.readFileSync(path.join(process.cwd(),rel),'utf8');

test('Aura is exactly one operator identity with six stable internal functions, not six agents', () => {
  const f=projectAuraFunctions({ now });
  assert.deepEqual(f.identity,{ id:'aura',name:'Aura',agentCount:1,meaning:'operator-facing-identity-only' });
  assert.equal(f.runtimeConsolidated,false,'do not claim the services have been merged into one OS process');
  assert.deepEqual(f.functions.map(x=>x.id),['reason','plan','execute','memory','tools','verify']);
  assert.deepEqual(new Set(AURA_FUNCTION_DEFINITIONS.map(x=>x.id)).size,6);
  assert.ok(f.functions.every(fn=>fn.authority && fn.implementation && fn.reads));
});

test('degraded services never become fabricated READY statuses',()=>{
  const f=projectAuraFunctions({ now, workplace:{reachable:false},coordinator:{reachable:false},graphs:null,missions:null });
  assert.deepEqual(Object.fromEntries(f.functions.map(x=>[x.id,x.state])),{
    reason:'UNAVAILABLE',plan:'UNAVAILABLE',execute:'UNAVAILABLE',memory:'UNAVAILABLE',
    tools:'UNOBSERVED',verify:'UNAVAILABLE',
  });
});

test('observed model, workers, tools and receipts remain separate from goal acceptance',()=>{
  const f=projectAuraFunctions({now,
    workplace:{reachable:true,memoryState:{storage:'encrypted-workplace'}},
    coordinator:{reachable:true,health:{local_model:{model:'gemma-local'}}},
    graphs:[],
    missions:[{status:'ACTIVE',receipts:[{ok:true,verified:true,outcomeUnknown:false},{ok:true,verified:false}]}],
    workers:[{heartbeatAt:'2026-10-30T11:59:45.000Z'}],
    tools:[{status:'READY'},{status:'STOPPED'}],
  });
  const state=Object.fromEntries(f.functions.map(x=>[x.id,x.state]));
  assert.equal(state.reason,'OBSERVED');
  assert.equal(state.execute,'OBSERVED');
  assert.equal(state.verify,'EVIDENCE_OBSERVED');
  assert.equal(state.tools,'OBSERVED');
  assert.match(f.functions.find(x=>x.id==='verify').detail,/task completion is checked separately/);
  assert.equal(f.runtimeConsolidated,false);
});

test('live model and storage identifiers respect the board redaction boundary',()=>{
  const f=projectAuraFunctions({now,coordinator:{reachable:true,health:{local_model:{model:'secret-raw'}}},
    workplace:{reachable:true,memoryState:{storage:'secret-path'}},safeText:s=>String(s).replace(/secret-\w+/g,'[REDACTED]')});
  assert.ok(!JSON.stringify(f).includes('secret-'));
});

test('Aura function inspection adds no mutation or new agent creation tool',async()=>{
  const toolbox=cognitiveQuestionToolbox({tools:{
    health:{run:async()=>({healthy:true})},
    start_goal:{run:async()=>assert.fail('must never start a mission from capability query')},
    spawn_agent:{run:async()=>assert.fail('must never create an agent')},
  }},()=>({}));
  assert.equal(toolbox.tools.start_goal,undefined);
  assert.equal(toolbox.tools.spawn_agent,undefined);
  const result=await toolbox.tools.aura_functions.run({});
  assert.equal(result.identity,'Aura');
  assert.equal(result.functions.length,6);
  assert.equal(result.runtimeConsolidated,false);
});

test('Aura board is the default, while technical agents remain inspectable and old missions persist',()=>{
  const ui=read('runtime/src/components/AuraAgentBoard.tsx');
  const backend=read('runtime/src/server/connected/auraAgentBoard.mjs');
  assert.match(ui,/useState<'functions'\|'network'\|'missions'\|'cycles'>\('functions'\)/);
  assert.match(ui,/snapshot\?\.aura\?\.functions/);
  assert.match(ui,/uiText\("Execution sessions/);
  assert.match(backend,/projectAuraFunctions/);
  assert.match(backend,/projectAgentNetwork/);
  assert.match(backend,/missionStatusCounts/);
  const chat=read('agents/lib/aura-seer-chat.mjs');
  assert.match(chat,/enda operatörsagent/);
  assert.match(chat,/SEER är hennes interna planeringsfunktion/);
  assert.match(chat,/Nova\/ModelRelay är hennes interna utförandefunktion/);
});

test('Aura question mode can inspect the live control plane without mutation authority',async()=>{
  let reads=0;
  const toolbox=cognitiveQuestionToolbox({tools:{
    aura_runtime:{run:async()=>{reads++;return {identity:{id:'aura'},oversight:{browser:{state:'BLOCKED'}}};}},
    start_goal:{run:async()=>assert.fail('no mission dispatch from a diagnostic question')},
    shell_exec:{run:async()=>assert.fail('no shell execution from a diagnostic question')},
  }},()=>({}),'Hur mår Aura och Chrome?');
  const result=await toolbox.tools.aura_runtime.run({});
  assert.equal(result.identity.id,'aura');
  assert.equal(result.oversight.browser.state,'BLOCKED');
  assert.equal(reads,1);
  assert.equal(toolbox.tools.start_goal,undefined);
  assert.equal(toolbox.tools.shell_exec,undefined);
});
test('Aura exposes a real live read-only oversight route and no second agent owner',()=>{
  const server=read('runtime/server.ts');
  assert.match(server,/aura_runtime:/);
  assert.match(server,/readAgentTeam\(\)/);
  assert.match(server,/auraServiceHealth\(\)/);
  assert.match(server,/tools:mcpHost\.status\(\), services,/);
  const ui=read('runtime/src/components/AuraAgentBoard.tsx');
  assert.match(ui,/uiText\("Aura system controls"\)/);
  assert.match(ui,/oversight\.browser\.state/);
});
