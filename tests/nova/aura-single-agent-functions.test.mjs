import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AURA_FUNCTION_DEFINITIONS, projectAuraFunctions } from '../../runtime/src/server/connected/auraFunctions.mjs';
import { cognitiveQuestionToolbox, withPerceptionTools } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';

test('manual conversation can inspect the live MCP catalog without gaining mutation tools',async()=>{
  const observed={servers:[{id:'git',status:'READY',tools:[{name:'git_status',readOnly:true}]}]};
  const toolbox=cognitiveQuestionToolbox({tools:{mcp_catalog:{run:async()=>observed},start_goal:{run:()=>assert.fail('mutation')}}},()=>({}));
  assert.deepEqual(await toolbox.tools.mcp_catalog.run(),observed);
  assert.equal(toolbox.tools.start_goal,undefined);
});

const now = '2026-10-30T12:00:00.000Z';
const read = rel => fs.readFileSync(path.join(process.cwd(),rel),'utf8');

test('Aura is the sole agent with six internal functions and honest process status', () => {
  const f=projectAuraFunctions({ now });
  assert.deepEqual(f.identity,{ id:'aura',name:'Aura',agentCount:1,meaning:'sole-agent' });
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
  assert.match(f.functions.find(x=>x.id==='verify').detail,/not proof of the final goal/);
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
  assert.match(ui,/useState<'functions'\|'organization'\|'network'\|'missions'\|'cycles'>\('functions'\)/);
  assert.match(ui,/snapshot\?\.aura\?\.functions/);
  assert.match(ui,/Technical Workplace sessions/);
  assert.match(backend,/projectAuraFunctions/);
  assert.match(backend,/projectAgentNetwork/);
  assert.match(backend,/missionStatusCounts/);
  const chat=read('agents/lib/aura-seer-chat.mjs');
  assert.match(chat,/only operator agent/);
  assert.match(chat,/Planning and execution are internal JACO runtime functions/);
  assert.match(chat,/not separate agents or product identities/);
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
  assert.match(ui,/Aura control plane/);
  assert.match(ui,/oversight\.browser\.state/);
});

test('with no SEER local model, reasoning is observed only from a probed operator model choice',()=>{
  const seer={reachable:true,health:{local_model:null}};
  const reason=planner=>projectAuraFunctions({now,coordinator:seer,planner}).functions.find(x=>x.id==='reason');
  assert.equal(reason(null).state,'NO_MODEL_OBSERVED');
  assert.equal(reason({provider:'gemini',model:'m',by:'aura-chat'}).state,'NO_MODEL_OBSERVED','an unprobed automatic choice is not evidence');
  const chosen=reason({provider:'gemini',model:'models/gemini-2.5-flash',by:'operator',at:'2026-11-15T17:15:00.032Z'});
  assert.equal(chosen.state,'OBSERVED');
  assert.match(chosen.detail,/gemini\/models\/gemini-2\.5-flash · answered a test request when chosen \(2026-11-15T17:15:00\.032Z\)/);
  const local=projectAuraFunctions({now,coordinator:{reachable:true,health:{local_model:{model:'gemma-local'}}},planner:{provider:'gemini',model:'x',by:'operator'}});
  assert.equal(local.functions.find(x=>x.id==='reason').detail,'gemma-local','a SEER local model still wins');
});

test('Aura perception tools use only the guarded canonical MCP read route',async()=>{
  const calls=[];
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=';
  const tools=withPerceptionTools({mcp_read:{run:async args=>{
    calls.push(args);
    return args.tool==='nova_screenshot'?{content:[{type:'image',mimeType:'image/png',data:png}]}:{content:[{type:'text',text:'observed'}]};
  }},mcp_tool:{run:async()=>assert.fail('no write path')}});
  const question=cognitiveQuestionToolbox({tools},()=>({})).tools;
  assert.equal(question.mcp_tool,undefined);
  for(const view of ['observe','accessibility','html']) await question.dom_track.run({view});
  const capture=await question.laser_vision.run({});
  assert.equal(capture.captured,true);
  assert.equal(capture.source,'browser/nova_screenshot');
  assert.equal(capture.visualAnalysis,'NOT_PERFORMED');
  assert.match(capture.imageSha256,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(capture),/iVBOR/);
  assert.deepEqual(calls.map(x=>x.tool),['nova_observe','nova_ax','nova_html','nova_screenshot']);
  assert.ok(calls.every(x=>x.server==='browser' && Object.keys(x.arguments).length===0));
  await assert.rejects(()=>question.dom_track.run({view:'nova_click'}),/DOM_TRACK_VIEW_INVALID/);
  await assert.rejects(()=>question.laser_vision.run({server:'other'}),/PERCEPTION_ARGUMENTS_INVALID/);
  assert.equal(calls.length,4);
  assert.equal(withPerceptionTools({}).dom_track,undefined);
});
test('perception tools preserve denied and unsuccessful reads',async()=>{
  const denied=withPerceptionTools({mcp_read:{run:async()=>{throw Error('MANDATE_DENIED');}}});
  await assert.rejects(()=>denied.dom_track.run({}),/MANDATE_DENIED/);
  await assert.rejects(()=>denied.laser_vision.run({}),/MANDATE_DENIED/);
  const failed=withPerceptionTools({mcp_read:{run:async()=>({isError:true})}});
  await assert.rejects(()=>failed.dom_track.run({}),/PERCEPTION_MCP_READ_FAILED/);
  const malformed=withPerceptionTools({mcp_read:{run:async()=>({content:[{type:'image',mimeType:'image/png',data:'YWJj'}]})}});
  await assert.rejects(()=>malformed.laser_vision.run({}),/LASER_VISION_INVALID_PNG/);
});
test('production chat toolbox is wired through existing mandate gate',()=>{
  assert.match(read('runtime/server.ts'),/withPerceptionTools\(gateAgentTools\(box\.tools,agentOrganization\)\)/);
});
