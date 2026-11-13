// Nova's agent loop against the real mission control: refusals and failures go back to the model,
// which corrects itself, instead of stopping the mission (operator 2026-10-09: "it gets stuck at once").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { MissionClient, checkedReceipt } from '../../agents/lib/mission-client.mjs';
import { plannerTools, searchDeferredTools } from '../../agents/lib/native-tools.mjs';
import { runAgentMission, receiptForModel, contextPacketIntro, hintFor as hintForCheck } from '../../agents/lib/agent-loop.mjs';
import { createCodingWorkspace } from '../../agents/lib/coding-workspace.mjs';
import { projectGoalGraph, projectNodeContract } from '../../gateway/src/seer-project.mjs';

function setup(t, allowedTasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-loop-'));
  const bus = new DurableMissionBus(dir);
  const control = new NovaMissionControl(bus, { allowedTasks });
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const routes = new Map();
  mountNovaMissionRoutes({ get: (p, ...f) => routes.set('GET ' + p, f), post: (p, ...f) => routes.set('POST ' + p, f) }, () => {}, control);
  const client = new MissionClient('http://offline', 'test-token', async (url, opts) => {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/missions\/([^/]+)(\/.*)?$/);
    const handlers = routes.get(opts.method + ' ' + (match ? pathname.replace(match[1], ':id') : pathname));
    let status = 200, data;
    handlers.at(-1)({ body: opts.body ? JSON.parse(opts.body) : undefined, params: { id: match?.[1] }, query: Object.fromEntries(new URL(url).searchParams) },
      { status(n) { status = n; return this; }, json(v) { data = v; } });
    return { ok: status === 200, status, json: async () => data };
  });
  return { client, control };
}

const call = (name, args, id = name + Math.random()) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
// A scripted model: each turn returns the next answer and records what it was shown.
const scripted = answers => { const seen = []; return { seen, chat: async ({ messages }) => { seen.push(messages.map(m => ({ ...m }))); const a = answers.shift(); if (!a) throw new Error('script exhausted'); return a; } }; };
const run = (s, model, execute, extra = {}) => runAgentMission({
  client: s.client, owner: 'nova', chat: model.chat, system: 'test',
  toolsFor: m => plannerTools(m.allowedTasks, [], {}, false), execute, ...extra,
});

test('a refused tool and a failed step go back to the model, which recovers and completes', async t => {
  const s = setup(t, ['web-fetch', 'health-check', 'shell']);
  const m = s.control.create({ goal: 'Läs README och sammanfatta', idempotencyKey: 'a1', allowedTasks: ['web-fetch', 'health-check'] });
  const model = scripted([
    { tool_calls: [call('shell', { command: 'cat README.md' })] },               // not allowed for this mission
    { tool_calls: [call('web-fetch', '{bad json')] },                             // unparsable arguments
    { tool_calls: [call('web-fetch', { url: 'https://missing.test' })] },                  // runs and fails
    { tool_calls: [call('web-fetch', { url: 'https://readme.test' })] },                   // works
    { tool_calls: [call('complete', { reason: 'README säger hej [#2]' })] },
  ]);
  const ran = [];
  const result = await run(s, model, async task => { ran.push(task.data.url); return task.data.url === 'https://readme.test' ? { ok: true, verified: true, content: 'hej' } : { ok: false, error: 'ENOENT' }; });
  assert.equal(result.completed, true);
  assert.deepEqual(ran, ['https://missing.test', 'https://readme.test'], 'the refused and the malformed call never executed');
  const shown = model.seen.at(-1).filter(x => x.role === 'tool').map(x => x.content);
  assert.match(shown[0], /UNKNOWN_TOOL shell|REFUSED/);
  assert.match(shown[1], /INVALID_ARGUMENTS/);
  assert.match(shown[2], /ENOENT/);
  assert.match(shown[3], /"ok":true/);
  const after = s.control.get(m.id);
  assert.equal(after.status, 'AWAITING_VERIFICATION');
  assert.equal(after.receipts.length, 2);
});

test('the conversation carries every earlier result to the next model turn', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'Läs två filer', idempotencyKey: 'a2', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://a.test' }), call('web-fetch', { url: 'https://b.test' })] },
    { content: 'a innehåller A och b innehåller B.' },
  ]);
  const result = await run(s, model, async task => ({ ok: true, verified: true, content: task.data.url.toUpperCase() }));
  assert.equal(result.completed, true);
  assert.equal(result.answer, 'a innehåller A och b innehåller B.');
  const last = JSON.stringify(model.seen.at(-1));
  assert.ok(last.includes('HTTPS://A.TEST') && last.includes('HTTPS://B.TEST'), 'both results were in the conversation');
});

test('a refused completion is explained and the model keeps working', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'g', idempotencyKey: 'a3', allowedTasks: ['web-fetch'] });
  // Simulate a runtime that refuses the first completion.
  const release = s.client.release.bind(s.client);
  let refusedOnce = false;
  s.client.release = async (id, input) => { if (input.completionProposed && !refusedOnce) { refusedOnce = true; throw new Error('CONTRACT_VERIFICATION_INCOMPLETE:test'); } return release(id, input); };
  const model = scripted([
    { tool_calls: [call('complete', { reason: 'too early' })] },
    { tool_calls: [call('web-fetch', { url: 'https://x.test' })] },
    { tool_calls: [call('complete', { reason: 'done [#1]' })] },
  ]);
  const result = await run(s, model, async () => ({ ok: true, verified: true }));
  assert.equal(result.completed, true);
  assert.match(JSON.stringify(model.seen[1]), /COMPLETION REFUSED: CONTRACT_VERIFICATION_INCOMPLETE/);
  assert.equal(s.control.get(m.id).status, 'AWAITING_VERIFICATION');
});

test('blocked ends the mission with the reason; no model at all defers without spending anything', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'g', idempotencyKey: 'a4', allowedTasks: ['web-fetch'] });
  const deferred = await run(s, { chat: async () => { throw new Error('NO_PLANNER_AVAILABLE groq:429'); } }, async () => ({ ok: true }));
  assert.equal(deferred.deferred, true);
  assert.equal(s.control.get(m.id).status, 'ACTIVE');
  assert.equal(s.control.get(m.id).failures, 0);
  const blocked = await run(s, scripted([{ tool_calls: [call('blocked', { reason: 'needs a browser' })] }]), async () => ({ ok: true }));
  assert.equal(blocked.blocked, true);
  assert.equal(s.control.get(m.id).status, 'BLOCKED');
});

test('Aura defers temporary selected-model outage without ending the durable mission', async t => {
  const s = setup(t, ['web-fetch']);
  const mission = s.control.create({ goal: 'Read an authorized page', idempotencyKey: 'aura-model-block', allowedTasks: ['web-fetch'] });
  let attempts = 0;
  const result = await run(s, { chat: async () => { attempts++; throw Error('AURA_SELECTED_MODEL_UNAVAILABLE:gemini:PROVIDER_TIMEOUT'); } }, async () => assert.fail('no mutation when model is unavailable'));
  assert.equal(result.deferred, true);
  assert.equal(result.recovery, 'WAIT_PROVIDER');
  assert.equal(attempts, 1, 'retry happens on the next supervised tick, not in a burst');
  assert.match(result.reason, /AURA_SELECTED_MODEL_UNAVAILABLE/);
  assert.equal(s.control.get(mission.id).status, 'ACTIVE');
  assert.equal(s.control.get(mission.id).receipts.length, 0);
});

test('Aura absent model choice is a visible blocking configuration issue', async t => {
  const s = setup(t, ['web-fetch']);
  const mission = s.control.create({ goal: 'Read an authorized page', idempotencyKey: 'aura-no-model', allowedTasks: ['web-fetch'] });
  const result = await run(s, { chat: async () => { throw Error('AURA_MODEL_SELECTION_REQUIRED'); } }, async () => assert.fail('no tools without a selected model'));
  assert.equal(result.blocked, true);
  assert.equal(s.control.get(mission.id).status, 'BLOCKED');
});

test('a model that never uses tools is stopped after a bounded number of nudges', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'g', idempotencyKey: 'a5', allowedTasks: ['web-fetch'] });
  const result = await run(s, scripted([{ content: 'hmm' }, { content: 'hmm' }, { content: 'hmm' }]), async () => ({ ok: true }));
  assert.equal(result.failed, true);
  assert.equal(result.reason, 'MODEL_DID_NOT_USE_TOOLS');
});

test('receipts shown to the model are bounded', () => {
  const text = receiptForModel(1, { ok: true, verified: true, result: { content: 'x'.repeat(20000) } });
  assert.ok(text.length < 6200);
});

// The planner is told about the machine it really runs on (it used to be told "Windows" everywhere).
import { brainSystemFor, agentSystemFor, hostLine } from '../../agents/hands-off-agent.mjs';
test('the host line follows the platform: Windows keeps cmd.exe, Android names Termux, others say sh', () => {
  const win = brainSystemFor(['shell', 'repo-read'], false, 'win32');
  assert.match(win, /The host is Windows\. shell commands run in cmd\.exe/);
  const phone = brainSystemFor(['shell', 'repo-read'], false, 'android');
  assert.match(phone, /The host is Android \(Termux\)\. shell commands run in sh/);
  assert.match(phone, /never cmd\.exe or PowerShell/);
  assert.doesNotMatch(phone, /The host is Windows|findstr|Get-ChildItem/);
  const linux = brainSystemFor(['shell'], false, 'linux');
  assert.match(linux, /The host is linux\. shell commands run in sh/);
  assert.doesNotMatch(linux, /cmd\.exe/);
  // a mission that cannot use the shell carries no host line at all, on any platform
  assert.doesNotMatch(brainSystemFor(['repo-read'], false, 'android'), /The host is/);
  // with no task list the whole prompt is returned, with the right host
  assert.match(brainSystemFor(null, false, 'android'), /Termux/);
  // the agent loop's prompt says the same
  assert.match(agentSystemFor(['shell'], 'android'), /Android \(Termux\)/);
  assert.equal(hostLine('win32'), null);
});

test('a model that repeats the same call is told it is stuck, and recovers when it changes course', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'Läs sidan', idempotencyKey: 'stuck1', allowedTasks: ['web-fetch'] });
  const same = () => ({ tool_calls: [call('web-fetch', { url: 'https://same.test' })] });
  const model = scripted([same(), same(), same(), { tool_calls: [call('web-fetch', { url: 'https://other.test' })] }, { tool_calls: [call('complete', { reason: 'klart' })] }]);
  const result = await run(s, model, async task => ({ ok: true, verified: true, content: task.data.url }));
  assert.equal(result.completed, true);
  const afterThird = model.seen[3].filter(m => m.role === 'user').map(m => m.content);
  assert.ok(afterThird.some(c => /^STUCK: .*web-fetch/.test(c)), 'the model was told what it is doing');
});

test('stuck again after the nudge ends the run as blocked, naming why', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Läs sidan', idempotencyKey: 'stuck2', allowedTasks: ['web-fetch'] });
  const same = () => ({ tool_calls: [call('web-fetch', { url: 'https://same.test' })] });
  const model = scripted(Array.from({ length: 8 }, same));
  const result = await run(s, model, async () => ({ ok: true, verified: true, content: 'same' }));
  assert.equal(result.blocked, true);
  assert.match(result.reason, /STUCK:repeat/);
  assert.equal(result.receipts.length, 6, 'three steps, a nudge, three more steps, then it stops');
  assert.notEqual(s.control.get(m.id).status, 'COMPLETED');
});

test('a long conversation is condensed before the next model turn and the model still sees what was done', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'Läs många sidor', idempotencyKey: 'cond1', allowedTasks: ['web-fetch'] });
  const urls = Array.from({ length: 14 }, (_, i) => `https://page${i}.test`);
  const model = scripted([...urls.map(url => ({ tool_calls: [call('web-fetch', { url })] })), { tool_calls: [call('complete', { reason: 'klart' })] }]);
  const dropped = [];
  const result = await run(s, model, async task => ({ ok: true, verified: true, content: `${task.data.url} ` + 'text '.repeat(400) }), { maxContextChars: 6000, onCondense: d => dropped.push(d) });
  assert.equal(result.completed, true);
  assert.ok(dropped.length > 0, 'the dropped messages were handed over for the full log');
  const lastSeen = model.seen.at(-1);
  assert.ok(lastSeen.some(m => m.role === 'user' && m.content.startsWith('EARLIER STEPS')), 'a summary replaced the old exchanges');
  assert.match(JSON.stringify(lastSeen), /page0\.test/, 'the earliest step is still listed in the summary');
  assert.ok(lastSeen.length < 2 + 14 * 2, 'the conversation got shorter');
});


test('live mission loop awaits the bounded intro and still submits tools to the mission runtime', async t => {
  const s = setup(t, ['web-fetch']);
  const mission = s.control.create({ goal: 'Read the permitted page', idempotencyKey: 'packet1', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://packet.test' })] },
    { tool_calls: [call('complete', { reason: 'verified page receipt' })] },
  ]);
  const intros = [];
  const result = await run(s, model, async () => ({ ok: true, verified: true, content: 'page read' }), {
    intro: async current => {
      await Promise.resolve();
      intros.push(current.id);
      return contextPacketIntro(current, { homeText: 'Keep the scope small' });
    },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(intros, [mission.id]);
  const intro = model.seen[0].find(message => message.role === 'user').content;
  const packet = JSON.parse(intro.split('\n')[1]);
  assert.deepEqual(packet.authority.allowedTasks, ['web-fetch']);
  assert.doesNotMatch(intro, /Steps already done in earlier runs/);
  assert.equal(s.control.get(mission.id).receipts.length, 1);
  assert.equal(s.control.get(mission.id).status, 'AWAITING_VERIFICATION');
});


test('system prompt is derived from the active mission rather than a stale outer snapshot', async t => {
  const s = setup(t, ['web-fetch']);
  const mission = s.control.create({ goal: 'Read current mission', idempotencyKey: 'packet-system', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://system.test' })] },
    { tool_calls: [call('complete', { reason: 'verified' })] },
  ]);
  const systemMissions = [];
  const result = await run(s, model, async () => ({ ok: true, verified: true }), {
    system: current => {
      systemMissions.push(current.id);
      return `Mission ${current.id}, tools: ${current.allowedTasks.join(',')}`;
    },
  });
  assert.equal(result.completed, true);
  assert.deepEqual(systemMissions, [mission.id]);
  assert.equal(model.seen[0][0].content, `Mission ${mission.id}, tools: web-fetch`);
});


test('exception after potential browser mutation blocks automatic retry with uncertain receipt', async t => {
  const s=setup(t,['browser-click']);
  const mission=s.control.create({goal:'Save once',idempotencyKey:'unknown-side-effect',allowedTasks:['browser-click']});
  let executions=0;
  const execute=async()=>{executions++;throw Error('CONNECTION_LOST_AFTER_CLICK');};
  const first=await run(s,scripted([{tool_calls:[call('browser-click',{name:'Save'})]}]),execute);
  assert.equal(first.stopped,'BLOCKED');
  assert.equal(executions,1);
  const stored=s.control.get(mission.id);
  assert.equal(stored.status,'BLOCKED');
  assert.equal(stored.receipts.length,1);
  assert.equal(stored.receipts[0].outcomeUnknown,true);
  const second=await run(s,scripted([{tool_calls:[call('browser-click',{name:'Save'})]}]),execute);
  assert.equal(second.executed,false);
  assert.equal(executions,1);
});

test('native MCP write maps to a durable mcp-write action, never read-only mcp-call', async t => {
  const s=setup(t,['mcp-call','mcp-write']);
  const mission=s.control.create({goal:'Write one file through MCP',idempotencyKey:'mcp-action-kind',allowedTasks:['mcp-call','mcp-write']});
  const writeTool={server:'files',name:'save_file',readOnly:false,description:'Save',inputSchema:{type:'object',properties:{path:{type:'string'}}}};
  let executedType=null;
  const model=scripted([{tool_calls:[call('mcp__files__save_file',{path:'notes.txt'})]},{tool_calls:[call('blocked',{reason:'done'})]}]);
  await run(s,model,async action=>{executedType=action.type;return {ok:true,verified:true};},{toolsFor:m=>plannerTools(m.allowedTasks,[writeTool],{},false)});
  assert.equal(executedType,'mcp-write');
  assert.equal(s.control.get(mission.id).receipts[0].type,'mcp-write');
});


test('async tool discovery uses the exact claimed mission before planning, with no stale catalog',async t=>{
  const setup_ = setup(t,['web-fetch']);
  const mission = setup_.control.create({goal:'Read from active mission',idempotencyKey:'async-tools',allowedTasks:['web-fetch']});
  const inspected=[];
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://fresh.test'})]},{tool_calls:[call('complete',{reason:'verified'})]}]);
  const result=await run(setup_,model,async()=>({ok:true,verified:true}),{
    toolsFor:async active=>{await Promise.resolve();inspected.push({id:active.id,permissions:active.allowedTasks});return plannerTools(active.allowedTasks,[],{},false);},
  });
  assert.equal(result.completed,true);
  assert.deepEqual(inspected,[{id:mission.id,permissions:['web-fetch']}]);
});

test('refresh replaces one mission packet with updated receipt state between turns', async t => {
  const s = setup(t, ['health-check']);
  s.control.create({ goal: 'Check service', idempotencyKey: 'refresh-packet', allowedTasks: ['health-check'] });
  const model = scripted([
    { tool_calls: [call('health-check', {})] },
    { tool_calls: [call('complete', { reason: 'Service checked' })] },
  ]);
  const result = await run(s, model, async () => ({ ok: true, verified: true }), {
    refreshIntro: true,
    intro: mission => `BOARD receipts=${mission.receipts?.length || 0}`,
  });
  assert.equal(result.completed, true);
  assert.equal(model.seen[0][1].content, 'BOARD receipts=0');
  assert.equal(model.seen[1][1].content, 'BOARD receipts=1');
  assert.equal(model.seen[1].filter(m => m.content?.startsWith('BOARD')).length, 1);
  assert.ok(model.seen[1].some(m => m.role === 'tool'));
});

test('native tool loop discards a stale model action and reads latest operator direction', async t => {
  const s=setup(t,['web-fetch']);
  const m=s.control.create({goal:'Inspect the service',idempotencyKey:'steer-native-1',allowedTasks:['web-fetch']});
  const calls=[],seen=[];
  let turns=0;
  const model={chat:async({messages})=>{
    seen.push(JSON.stringify(messages));
    turns++;
    if(turns===1){
      s.control.steer(m.id,{instruction:'Use the updated endpoint, not the old one',requestId:'55555555-5555-5555-5555-555555555555'});
      return {tool_calls:[call('web-fetch',{url:'https://old.example.test'})]};
    }
    if(turns===2)return {tool_calls:[call('web-fetch',{url:'https://new.example.test'})]};
    return {tool_calls:[call('complete',{reason:'Updated endpoint inspected [#1]'})]};
  }};
  const result=await run(s,model,async(task)=>{calls.push(task.data.url);return {ok:true,verified:true};});
  assert.equal(result.completed,true);
  assert.deepEqual(calls,['https://new.example.test']);
  assert.match(seen[1],/OPERATOR_DIRECTION_REVISION/);
  assert.match(seen[1],/updated endpoint/);
  assert.equal(s.control.get(m.id).status,'AWAITING_VERIFICATION');
});

test('native tool loop finishes the in-flight action but skips other stale calls',async t=>{
  const s=setup(t,['web-fetch']);
  const m=s.control.create({goal:'Check service availability',idempotencyKey:'steer-native-2',allowedTasks:['web-fetch']});
  const calls=[];let turns=0;
  const model={chat:async()=>{
    turns++;
    if(turns===1)return {tool_calls:[call('web-fetch',{url:'https://first.test'}),call('web-fetch',{url:'https://obsolete.test'})]};
    if(turns===2)return {tool_calls:[call('web-fetch',{url:'https://replacement.test'})]};
    return {tool_calls:[call('complete',{reason:'Both checked [#1][#2]'})]};
  }};
  const result=await run(s,model,async task=>{
    calls.push(task.data.url);
    if(task.data.url==='https://first.test')s.control.steer(m.id,{instruction:'Replace the second endpoint',requestId:'66666666-6666-6666-6666-666666666666'});
    return {ok:true,verified:true};
  });
  assert.equal(result.completed,true);
  assert.deepEqual(calls,['https://first.test','https://replacement.test']);
  assert.equal(s.control.get(m.id).receipts.length,2);
});


test('native coding contract performs durable repository preflight before using model tools', async t => {
  const s = setup(t, ['repo-list']);
  const contract = {
    scope: { allowed: ['src/**'] },
    acceptance: ['The agent inspected the permitted repository tree'],
    verification: { tests_required: false, receipt_required: true },
    execution: { allow_git_commit: false, allow_git_push: false, allow_git_merge: false },
  };
  const mission = s.control.create({
    goal: 'Inspect the source tree', source: 'operator', idempotencyKey: 'contract-native-ready',
    contract, allowedTasks: ['repo-list'],
  });
  let checked = 0;
  const model = scripted([
    { tool_calls: [call('repo-list', { path: '.' })] },
    { tool_calls: [call('complete', { reason: 'Tree inspected [#1]' })] },
  ]);
  const result = await run(s, model, async () => ({ ok: true, verified: true, entries: ['src/index.js'] }), {
    preflight: async ({ mission: active, lease }) => {
      checked++;
      assert.equal(active.id, mission.id);
      assert.equal(model.seen.length, 0, 'no LLM request may start before the coding preflight');
      await s.client.preflight(active.id, { ...lease, report: {
        schema: 'jaco.nova-preflight/v1', status: 'READY',
        tools: ['repo-list'], repository: { revision: 'fixture-head', entries: 1 },
      } });
      return { ready: true };
    },
  });
  assert.equal(checked, 1);
  assert.equal(result.completed, true);
  assert.equal(s.control.get(mission.id).preflight.status, 'READY');
  assert.equal(s.control.get(mission.id).receipts.length, 1);
  assert.equal(s.control.get(mission.id).status, 'AWAITING_VERIFICATION');
});

test('coding preflight blocker never invokes a model or a tool', async t => {
  const s = setup(t, ['repo-list']);
  const mission = s.control.create({
    goal: 'Inspect sources', idempotencyKey: 'contract-native-blocked',
    contract: { scope: { allowed: ['src/**'] }, acceptance: ['Inspect files'], verification: { tests_required: false } },
    allowedTasks: ['repo-list'],
  });
  let calls = 0;
  const result = await run(s, { chat: async () => { calls++; return {}; } },
    async () => { calls++; return { ok: true, verified: true }; }, {
      preflight: async () => ({ blocked: true, reason: 'BROWSER_BRIDGE_UNAVAILABLE' }),
    });
  assert.equal(result.blocked, true);
  assert.equal(result.reason, 'BROWSER_BRIDGE_UNAVAILABLE');
  assert.equal(calls, 0);
  assert.equal(s.control.get(mission.id).status, 'BLOCKED');
  assert.equal(s.control.get(mission.id).receipts.length, 0);
});

test('temporary coding preflight error defers cleanly and can retry', async t => {
  const s = setup(t, ['repo-list']);
  const mission = s.control.create({
    goal: 'Inspect allowed source', idempotencyKey: 'contract-native-retry',
    contract: { scope: { allowed: ['src/**'] }, acceptance: ['Inspect files'], verification: { tests_required: false } },
    allowedTasks: ['repo-list'],
  });
  const deferred = await run(s, { chat: async () => { throw Error('model should not be called'); } },
    async () => ({ ok: true, verified: true }), { preflight: async () => { throw Error('context endpoint timed out'); } });
  assert.equal(deferred.deferred, true);
  assert.match(deferred.reason, /PREFLIGHT_FAILED:context endpoint timed out/);
  assert.equal(s.control.get(mission.id).status, 'ACTIVE');
  const model = scripted([
    { tool_calls: [call('repo-list', { path: '.' })] },
    { tool_calls: [call('complete', { reason: 'Files inspected [#1]' })] },
  ]);
  const result = await run(s, model, async () => ({ ok: true, verified: true, entries: [] }),
    { preflight: async () => ({ ready: true }) });
  assert.equal(result.completed, true);
  assert.equal(s.control.get(mission.id).receipts.length, 1);
});

test('native coding loop replans after a write and does not execute stale batched actions', async t => {
  const s = setup(t, ['repo-write', 'repo-read']);
  const mission = s.control.create({
    goal: 'Fix the source and then inspect it', idempotencyKey: 'native-write-reobserve',
    contract: {
      scope: { allowed: ['src/**'] }, acceptance: ['Change and inspect the file'],
      verification: { tests_required: false, receipt_required: true },
      execution: { allow_git_commit: false },
    },
    allowedTasks: ['repo-write', 'repo-read'],
  });
  const model = scripted([
    { tool_calls: [call('repo-write', { path: 'src/index.js', content: 'export const ok = true;' }),
      call('repo-read', { path: 'src/index.js' })] },
    { tool_calls: [call('repo-read', { path: 'src/index.js' })] },
    { tool_calls: [call('complete', { reason: 'File written and read [#1][#2]' })] },
  ]);
  const executed = [];
  const result = await run(s, model, async task => {
    executed.push(task.type);
    return { ok: true, verified: true, path: task.data.path };
  });
  assert.equal(result.completed, true);
  assert.deepEqual(executed, ['repo-write', 'repo-read']);
  assert.match(JSON.stringify(model.seen[1]), /SKIPPED: observe the previous mutation receipt/);
  assert.equal(s.control.get(mission.id).receipts.length, 2);
});

test('native loop edits a real isolated repository and recovers from a failing test', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-real-code-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.mkdirSync(path.join(project, 'src'));
  fs.mkdirSync(path.join(project, 'tests'));
  const source = path.join(project, 'src', 'client.mjs');
  fs.writeFileSync(source, 'export function retryCount() { return 0; }\n');
  fs.writeFileSync(path.join(project, 'tests', 'client.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { retryCount } from '../src/client.mjs';\ntest('retryCount is two', () => assert.equal(retryCount(), 2));\n");

  const s = setup(t, ['repo-read', 'repo-edit', 'repo-test']);
  const mission = s.control.create({
    goal: 'Fix retryCount and prove tests pass', idempotencyKey: 'native-real-file-test',
    allowedTasks: ['repo-read', 'repo-edit', 'repo-test'],
    contract: {
      scope: { allowed: ['src/**', 'tests/**'] },
      acceptance: ['retryCount returns two', 'The test passes after the last change'],
      verification: { tests_required: true, commands: ['node --test tests/client.test.mjs'], receipt_required: true },
      execution: { allow_git_commit: false },
      budget: { max_failures: 5 },
    },
  });
  const model = scripted([
    { tool_calls: [call('repo-read', { path: 'src/client.mjs' })] },
    { tool_calls: [call('repo-test', { command: 'node --test tests/client.test.mjs' })] },
    { tool_calls: [call('repo-edit', { path: 'src/client.mjs', old: 'return 0;', new: 'return 2;' })] },
    { tool_calls: [call('repo-test', { command: 'node --test tests/client.test.mjs' })] },
    { tool_calls: [call('complete', { reason: 'Corrected the actual file and reran tests successfully [#3][#4]' })] },
  ]);
  const worktree = createCodingWorkspace({ root: project });
  const result = await run(s, model, task => worktree.execute(task, s.control.get(mission.id).contract, {
    actor: 'aura-native-test', receipts: s.control.get(mission.id).receipts,
  }));
  assert.equal(result.completed, true);
  assert.match(fs.readFileSync(source, 'utf8'), /return 2;/);
  const stored = s.control.get(mission.id);
  assert.deepEqual(stored.receipts.map(r => r.type), ['repo-read', 'repo-test', 'repo-edit', 'repo-test']);
  assert.deepEqual(stored.receipts.map(r => r.ok), [true, false, true, true]);
  assert.equal(stored.contractStatus.machineVerified, true);
  assert.equal(stored.status, 'AWAITING_VERIFICATION');
  assert.match(JSON.stringify(model.seen[2]), /repo-test/);
  assert.match(JSON.stringify(model.seen[3]), /repo-edit/);
});

test('a real project mission autonomously discovers npm test, fixes a red test and reports verified green', async t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-project-autotest-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.mkdirSync(path.join(project, 'src'));
  fs.mkdirSync(path.join(project, 'tests'));
  fs.writeFileSync(path.join(project, 'package.json'),
    JSON.stringify({ private: true, type: 'module', scripts: { test: 'node --test tests/client.test.mjs' } }));
  const file = path.join(project, 'src', 'client.mjs');
  fs.writeFileSync(file, 'export function answer() { return 0; }\n');
  fs.writeFileSync(path.join(project, 'tests', 'client.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { answer } from '../src/client.mjs';\ntest('answer', () => assert.equal(answer(), 42));\n");
  const graph = projectGoalGraph({ id: 'agentic-real-project', statement: 'Fix answer and test until green', project_root: project });
  const generated = graph.nodes[0].contract;
  assert.deepEqual(generated.verification.commands, ['npm test']);
  assert.equal(generated.verification.tests_required, true);
  const contract = { ...generated, execution: { ...generated.execution, allow_git_commit: false, require_git_commit: false } };
  const s = setup(t, ['repo-read', 'repo-edit', 'repo-test']);
  const mission = s.control.create({
    goal: graph.objective, idempotencyKey: 'agentic-real-project',
    projectRoot: project, allowedTasks: ['repo-read', 'repo-edit', 'repo-test'], contract,
  });
  const model = scripted([
    { tool_calls: [call('repo-test', { command: 'npm test' })] },
    { tool_calls: [call('repo-edit', { path: 'src/client.mjs', old: 'return 0;', new: 'return 42;' })] },
    { tool_calls: [call('repo-test', { command: 'npm test' })] },
    { tool_calls: [call('complete', { reason: 'Fixed answer after red test, then ran green project suite [#1][#2][#3]' })] },
  ]);
  const workspace = createCodingWorkspace({ root: project });
  const done = await run(s, model, task => workspace.execute(task, s.control.get(mission.id).contract, {
    actor: 'aura-project-integration', receipts: s.control.get(mission.id).receipts,
  }));
  assert.equal(done.completed, true, 'a failed test leads to another autonomous work step');
  assert.match(fs.readFileSync(file, 'utf8'), /return 42;/);
  const stored = s.control.get(mission.id);
  assert.deepEqual(stored.receipts.map(r => r.type), ['repo-test', 'repo-edit', 'repo-test']);
  assert.deepEqual(stored.receipts.map(r => r.ok), [false, true, true]);
  assert.equal(stored.contractStatus.machineVerified, true, 'test passed after the last edit');
});

test('a rate window gives the mission back without blocking it, even after real work', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Läs en sida', idempotencyKey: 'rate-1', allowedTasks: ['web-fetch'] });
  let turn = 0;
  const result = await runAgentMission({
    client: s.client, owner: 'nova', system: 'test',
    toolsFor: x => plannerTools(x.allowedTasks, [], {}, false),
    chat: async () => {
      if (++turn === 1) return { tool_calls: [call('web-fetch', { url: 'https://a.test' })] };
      throw new Error('MODEL_TEMPORARILY_LIMITED:gemini:AUTONOMOUS_CLOUD_BURST_LIMIT');
    },
    execute: async () => ({ ok: true, verified: true, content: 'a' }),
  });
  assert.equal(result.deferred, true);
  assert.equal(turn, 2, 'no retry burst inside the window');
  assert.equal(s.control.get(m.id).status, 'ACTIVE');
});

test('an over-budget request is condensed and retried once before the operator is asked', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'Läs många sidor', idempotencyKey: 'cost-1', allowedTasks: ['web-fetch'] });
  const big = 'x'.repeat(6000);
  const sizes = [];
  let turn = 0;
  const result = await runAgentMission({
    client: s.client, owner: 'nova', system: 'test',
    toolsFor: x => plannerTools(x.allowedTasks, [], {}, false),
    chat: async ({ messages }) => {
      const size = JSON.stringify(messages).length;
      sizes.push(size);
      turn++;
      if (turn <= 8) return { tool_calls: [call('web-fetch', { url: `https://a.test/${turn}` })] };
      if (size > 30_000) throw new Error('AURA_SELECTED_MODEL_UNAVAILABLE:gemini:TASK_COST_LIMIT');
      return { tool_calls: [call('complete', { reason: 'klart' })] };
    },
    execute: async () => ({ ok: true, verified: true, content: big }),
  });
  assert.equal(result.completed, true);
  assert.ok(sizes.at(-1) < 30_000, `retried request was ${sizes.at(-1)} chars`);
});

test('a budget limit that condensing cannot fix stops for the operator with the cause', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Läs en sida', idempotencyKey: 'cost-2', allowedTasks: ['web-fetch'] });
  const result = await runAgentMission({
    client: s.client, owner: 'nova', system: 'test',
    toolsFor: x => plannerTools(x.allowedTasks, [], {}, false),
    chat: async () => { throw new Error('AURA_SELECTED_MODEL_UNAVAILABLE:gemini:TASK_COST_LIMIT'); },
    execute: async () => ({ ok: true, verified: true }),
  });
  assert.equal(result.blocked, true);
  assert.match(result.reason, /TASK_COST_LIMIT/);
  assert.equal(s.control.get(m.id).status, 'BLOCKED');
});

test('repeated text-only answers after a refused completion stop instead of paying for more turns', async t => {
  const s = setup(t, ['web-fetch']);
  s.control.create({ goal: 'Läs en sida', idempotencyKey: 'idle-1', allowedTasks: ['web-fetch'] });
  const release = s.client.release.bind(s.client);
  s.client.release = async (id, input) => {
    if (input.completionProposed) throw new Error('CONTRACT_VERIFICATION_INCOMPLETE:test');
    return release(id, input);
  };
  let calls = 0;
  const result = await runAgentMission({
    client: s.client, owner: 'nova', system: 'test',
    toolsFor: x => plannerTools(x.allowedTasks, [], {}, false),
    chat: async () => {
      calls++;
      return calls === 1 ? { tool_calls: [call('web-fetch', { url: 'https://a.test' })] } : { content: 'Jag är klar.' };
    },
    execute: async () => ({ ok: true, verified: true, content: 'a' }),
  });
  assert.equal(result.failed, true);
  assert.equal(result.reason, 'MODEL_DID_NOT_USE_TOOLS');
  assert.ok(calls <= 5, `${calls} model calls`);
});

test('a plain-text "I am blocked" stops for the operator and is never proposed as the answer', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Läs och hämta', idempotencyKey: 'blocked-text', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://a.test' })] },
    { content: 'I am blocked because I do not have a tool to fetch URLs.' },
  ]);
  const result = await run(s, model, async () => ({ ok: true, verified: true, content: 'a' }));
  assert.equal(result.blocked, true);
  assert.equal(result.completed, undefined);
  assert.equal(s.control.get(m.id).status, 'BLOCKED');
});

test('a circle that spans several runs is caught from the mission history, not only inside one run', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Läs sidor', idempotencyKey: 'circle-1', allowedTasks: ['web-fetch'] });
  // Earlier runs: the same two fetches, over and over (each run was cut short by a rate window).
  for (let round = 0; round < 3; round++) {
    for (const url of ['https://a.test', 'https://b.test']) {
      const claimed = await s.client.claim(m.id, 'nova');
      const lease = { owner: 'nova', token: claimed.token };
      const action = await s.client.begin(m.id, { ...lease, task: { type: 'web-fetch', data: { url } } });
      await s.client.finish(m.id, { ...lease, actionId: action.id, receipt: { ok: true, verified: true, result: { ok: true } } });
    }
  }
  const model = scripted([{ tool_calls: [call('blocked', { reason: 'Which page should I stop at?' })] }]);
  const result = await run(s, model, async () => ({ ok: true, verified: true }));
  assert.equal(result.blocked, true);
  assert.match(JSON.stringify(model.seen[0]), /STUCK: .*already repeated itself across earlier runs/s);
});

test('changing historical results do not trigger a false STUCK warning on resume', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Wait for deployment progress', idempotencyKey: 'history-progress-1', allowedTasks: ['web-fetch'] });
  for (const progress of [10, 40, 80]) {
    const claim = await s.client.claim(m.id, 'nova');
    const lease = { owner: 'nova', token: claim.token };
    const action = await s.client.begin(m.id, { ...lease, task: { type: 'web-fetch', data: { url: 'https://deployment.test/progress' } } });
    await s.client.finish(m.id, { ...lease, actionId: action.id, receipt: { ok: true, verified: true, result: { progress } } });
  }
  const model = scripted([{ tool_calls: [call('blocked', { reason: 'Need the next deployment update' })] }]);
  const result = await run(s, model, async () => ({ ok: true, verified: true }));
  assert.equal(result.blocked, true);
  const firstTurn = model.seen[0].filter(message => message.role === 'user').map(message => message.content).join('\n');
  assert.doesNotMatch(firstTurn, /^STUCK:/m, 'historical progress is not an identical-result loop');
});

test('a result that means "already done" says so to the model', () => {
  const commit = receiptForModel(3, { ok: false, verified: false, error: 'CODING_GIT_NOTHING_IN_SCOPE' });
  assert.match(commit, /Nothing to commit: your changes are already committed/);
  const same = receiptForModel(4, { ok: true, verified: true, result: { ok: true, beforeSha256: 'aa', afterSha256: 'aa' } });
  assert.match(same, /already had exactly this content/);
  const changed = receiptForModel(5, { ok: true, verified: true, result: { ok: true, beforeSha256: 'aa', afterSha256: 'bb' } });
  assert.doesNotMatch(changed, /hint/);
});

test('connector tools past the size limit are searched for, then callable for the rest of the run', async t => {
  const s = setup(t, ['mcp-call', 'web-fetch']);
  const m = s.control.create({ goal: 'Visa git-loggen', idempotencyKey: 'defer-1', allowedTasks: ['mcp-call', 'web-fetch'] });
  const big = { type: 'object', properties: Object.fromEntries(Array.from({ length: 20 }, (_, i) => ['field' + i, { type: 'string', enum: Array.from({ length: 6 }, (_, j) => 'value-number-' + j) }])) };
  const catalog = [
    { server: 'git', name: 'git_log', description: 'Show the commit log', inputSchema: big, readOnly: true },
    ...Array.from({ length: 40 }, (_, i) => ({ server: 'filler', name: 'filler_tool_' + i, description: 'Unrelated filler ' + i, inputSchema: big, readOnly: true })),
  ];
  const seen = [];
  let turn = 0;
  const result = await runAgentMission({
    client: s.client, owner: 'nova', system: 'test',
    toolsFor: x => plannerTools(x.allowedTasks, catalog, {}, false),
    chat: async ({ tools }) => {
      seen.push(tools.map(tool => tool.function.name));
      turn++;
      if (turn === 1) return { tool_calls: [call('tool_search', { query: 'git log' })] };
      if (turn === 2) return { tool_calls: [call('mcp__git__git_log', {})] };
      return { tool_calls: [call('complete', { reason: 'loggen visades [#1]' })] };
    },
    execute: async task => ({ ok: true, verified: true, tool: task.data.tool }),
  });
  assert.equal(result.completed, true);
  assert.ok(seen[0].includes('tool_search') && !seen[0].includes('mcp__git__git_log'), 'not listed at first');
  assert.ok(seen[0].length < 10, `the first list is short (${seen[0].length} tools)`);
  assert.ok(seen[1].includes('mcp__git__git_log'), 'listed after the search');
  assert.ok(!seen[1].includes('mcp__filler__filler_tool_0'), 'only the matching tools are added');
  assert.equal(s.control.get(m.id).receipts.at(0).type, 'mcp-call');
});

test('few connector tools stay listed, and a search with no match says so', () => {
  const small = plannerTools(['mcp-call'], [{ server: 'git', name: 'git_log', description: 'Show the log', inputSchema: { type: 'object', properties: {} }, readOnly: true }], {}, false);
  assert.ok(small.tools.some(tool => tool.function.name === 'mcp__git__git_log'));
  assert.ok(!small.tools.some(tool => tool.function.name === 'tool_search'));
  assert.deepEqual(small.deferred, []);
  const deferred = [{ name: 'mcp__git__git_log', server: 'git', tool: 'git_log', description: 'Show the commit log', def: {} }, { name: 'mcp__shell__shell_run', server: 'shell', tool: 'shell_run', description: 'Run a command', def: {} }];
  assert.deepEqual(searchDeferredTools(deferred, 'commit log').map(d => d.tool), ['git_log']);
  assert.deepEqual(searchDeferredTools(deferred, 'select:shell_run').map(d => d.tool), ['shell_run']);
  assert.deepEqual(searchDeferredTools(deferred, 'zebra'), []);
  assert.deepEqual(searchDeferredTools(deferred, 'commit log', new Set(['mcp__git__git_log'])), []);
});

test('the sentence the model writes before a tool call is shown to the operator as the live text of that step', async t => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Titta på example.com', idempotencyKey: 'say1', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { content: 'Jag börjar med att läsa sidan så jag ser vad som står där.', tool_calls: [call('web-fetch', { url: 'https://example.test' })] },
    { tool_calls: [call('complete', { reason: 'Klart [#1]' })] },
  ]);
  const ran = [];
  await run(s, model, async task => { ran.push(task); return { ok: true, verified: true, content: 'hej' }; });
  assert.equal(ran[0].say, undefined, 'the narration is not part of the action the executor runs');
  const started = s.control.bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED');
  assert.equal(started.payload.say, 'Jag börjar med att läsa sidan så jag ser vad som står där.');
  const live = toCognitiveEvent({ type: 'NOVA_ACTION_STARTED', payload: started.payload, at: new Date().toISOString(), id: 'e1', mission_id: m.id });
  assert.equal(live.text, 'Step 1: Jag börjar med att läsa sidan så jag ser vad som står där.');
  const plain = toCognitiveEvent({ type: 'NOVA_ACTION_STARTED', payload: { action: { type: 'web-fetch', data: {} } }, at: new Date().toISOString(), id: 'e2', mission_id: m.id });
  assert.ok(plain.text.length > 0 && !/colleague/.test(plain.text), 'without a sentence the generic label stays');
});

test('the sentence can be a parameter of the call, which is how models that return no text with a tool call still talk', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Titta på example.com', idempotencyKey: 'say2', allowedTasks: ['web-fetch'] });
  const { tools } = plannerTools(['web-fetch'], [], {}, false);
  assert.equal(tools[0].function.parameters.properties.say.type, 'string');
  assert.ok(!(tools[0].function.parameters.required || []).includes('say'), 'the sentence is optional, never a reason to refuse a call');
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://example.test', say: 'Jag hämtar sidan för att se vad den innehåller.' })] },
    { tool_calls: [call('complete', { reason: 'Klart [#1]' })] },
  ]);
  const ran = [];
  await run(s, model, async task => { ran.push(task); return { ok: true, verified: true, content: 'hej' }; });
  assert.deepEqual(ran[0].data, { url: 'https://example.test' }, 'the sentence is not passed to the tool as an argument');
  assert.equal(s.control.bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED').payload.say, 'Jag hämtar sidan för att se vad den innehåller.');
});

test('a planning lease its own agent left before a restart is freed at start; another agent lease is not', t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Titta', idempotencyKey: 'orph1', allowedTasks: ['web-fetch'] });
  assert.ok(s.control.claim(m.id, 'agent:nova:abc').token);
  assert.deepEqual(s.control.releaseOrphanedPlanning('agent:nova:other').released, []);
  assert.deepEqual(s.control.releaseOrphanedPlanning('agent:nova:abc').released, [m.id]);
  assert.equal(s.control.get(m.id).status, 'ACTIVE');
  assert.ok(s.control.claim(m.id, 'agent:nova:abc').token, 'the mission can be claimed again at once');
  assert.deepEqual(s.control.releaseOrphanedPlanning('').released, []);
});

test('the plan, what the last result taught, and the reason for the next step all reach the live text', async t => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Titta', idempotencyKey: 'learn1', allowedTasks: ['web-fetch'] });
  const { tools } = plannerTools(['web-fetch'], [], {}, false);
  assert.equal(tools[0].function.parameters.properties.learned.type, 'string');
  assert.ok(!(tools[0].function.parameters.required || []).includes('learned'));
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://a.test', say: 'Plan: jag läser sidan, jämför två alternativ och väljer det bästa.' })] },
    { tool_calls: [call('web-fetch', { url: 'https://b.test', learned: 'Första sidan hade bara ett alternativ.', say: 'Jag läser en andra sida för att få något att jämföra med.' })] },
    { tool_calls: [call('complete', { reason: 'Klart [#2]' })] },
  ]);
  const ran = [];
  await run(s, model, async task => { ran.push(task); return { ok: true, verified: true, content: 'x' }; });
  assert.deepEqual(ran.map(r => r.data.url), ['https://a.test', 'https://b.test']);
  assert.equal(ran[1].learned, undefined, 'the narration never reaches the tool');
  const started = s.control.bus.listMissionEvents ? null : null;
  const last = s.control.bus.lastMissionEvent(m.id, 'NOVA_ACTION_STARTED');
  assert.equal(last.payload.learned, 'Första sidan hade bara ett alternativ.');
  const live = toCognitiveEvent({ type: 'NOVA_ACTION_STARTED', payload: last.payload, at: new Date().toISOString(), id: 'l1', mission_id: m.id });
  assert.equal(live.text, 'Step 2: Första sidan hade bara ett alternativ. Jag läser en andra sida för att få något att jämföra med.');
});

test('a refused connector write tells the model to use the workspace write tools', () => {
  assert.match(String(hintForCheck({ ok: false, error: 'MCP_TOOL_NOT_READ_ONLY:filesystem.write_file' })), /repo-write/);
  assert.equal(hintForCheck({ ok: false, error: 'MCP_TOOL_NOT_READ_ONLY:github.list_issues' }), null);
});

test('Aura can create helper agents: delegate turns two or more roles into helper missions of the graph, and the feed names them', async t => {
  const { toCognitiveEvent } = await import('../../runtime/src/lib/cognitiveEvents.mjs');
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Bygg en demo', idempotencyKey: 'deleg1', allowedTasks: ['web-fetch'], source: 'seer-mission-graph', parent: { graphId: 'g', nodeKey: 'build', mainGoal: 'Bygg en demo' } });
  const { tools } = plannerTools(['web-fetch'], [], {}, true);
  assert.ok(tools.some(x => x.function.name === 'delegate'), 'offered on a graph mission');
  assert.ok(!plannerTools(['web-fetch'], [], {}, false).tools.some(x => x.function.name === 'delegate'), 'not offered where helpers cannot run');
  const model = scripted([
    { tool_calls: [call('delegate', { reason: 'Research och bygge är skilda delar.', helpers: [{ role: 'Researcher', task: 'Jämför tre produktidéer med källor.' }] })] },
    { tool_calls: [call('delegate', { reason: 'Research och bygge är skilda delar.', helpers: [{ role: 'Researcher', task: 'Jämför tre produktidéer med källor.' }, { role: 'Builder', task: 'Bygg demo/index.html.' }] })] },
  ]);
  const result = await run(s, model, async () => assert.fail('no tool runs'), { toolsFor: mm => plannerTools(mm.allowedTasks, [], {}, true) });
  assert.match(model.seen[1].filter(x => x.role === 'tool').at(-1).content, /DELEGATE_NEEDS_TWO_HELPERS/, 'one helper is not a team');
  assert.deepEqual(result.delegated, ['Researcher: Jämför tre produktidéer med källor.', 'Builder: Bygg demo/index.html.']);
  const after = s.control.get(m.id);
  assert.equal(after.status, 'BLOCKED');
  assert.equal(after.replanRequest.subgoals.length, 2);
  assert.match(after.replanRequest.subgoals[0].objective, /You are the Researcher helper agent/);
  const ev = s.control.bus.lastMissionEvent(m.id, 'NOVA_REPLAN_REQUEST');
  const live = toCognitiveEvent({ type: 'NOVA_REPLAN_REQUEST', payload: ev.payload, at: new Date().toISOString(), id: 'd1', mission_id: m.id }, { language: 'sv' });
  assert.equal(live.title, 'Arbetet lämnat till hjälpagenter');
  assert.match(live.text, /Hjälpagenter: Researcher: .*; Builder: /);
});

test('a preflight that cannot reach the runtime yet defers the mission instead of blocking it', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal: 'Titta', idempotencyKey: 'defer1', allowedTasks: ['web-fetch'], contract: { objective: 'Titta', scope: { allowed: ['**'] }, acceptance: ['svar'], verification: { tests_required: false } } });
  const model = scripted([]);
  const result = await run(s, model, async () => assert.fail('no tool runs'), { preflight: async () => ({ deferred: true, reason: 'RUNTIME_PREFLIGHT_UNAVAILABLE' }) });
  assert.equal(result.deferred, true);
  assert.equal(s.control.get(m.id).status, 'ACTIVE', 'the mission waits, it is not blocked for the operator');
});


test('Aura recovers from a false repo-write denial and commits a documented artifact', async t => {
  const s = setup(t, ['repo-write','git-commit','repo-read']);
  const contract = projectNodeContract({ title:'Create documentation', objective:'Create a new Markdown document docs/growth/a.md', mainGoal:'Document growth', projectRoot:null });
  const m = s.control.create({ goal:'Create docs/growth/a.md and commit', idempotencyKey:'capability-denial-repair-1',
    contract, allowedTasks:['repo-write','git-commit','repo-read'] });
  const model = scripted([
    { tool_calls:[call('blocked',{reason:'I cannot create files because repo-write is missing'})] },
    { tool_calls:[call('repo-write',{path:'docs/growth/a.md',content:'# Evidence-based draft'})] },
    { tool_calls:[call('git-commit',{message:'docs: add growth draft'})] },
    { tool_calls:[call('complete',{reason:'Saved and committed docs/growth/a.md [#1] [#2]'})] },
  ]);
  const executed = [];
  const result = await run(s, model, async task => {
    executed.push(task.type);
    return task.type === 'repo-write'
      ? {ok:true,verified:true,path:'docs/growth/a.md',beforeSha256:'before',afterSha256:'after'}
      : {ok:true,verified:true,commit:'test-commit'};
  });
  assert.equal(result.completed, true);
  assert.deepEqual(executed, ['repo-write','git-commit']);
  assert.equal(s.control.get(m.id).status, 'AWAITING_VERIFICATION');
  assert.match(JSON.stringify(model.seen[1]), /CAPABILITY_CORRECTION: repo-write/);
  assert.match(JSON.stringify(model.seen[0]), /executionVerified/);
});

test('three identical false capability refusals stop deterministically without spinning', async t => {
  const s = setup(t, ['repo-write']);
  const contract = projectNodeContract({title:'Create documentation', objective:'Create new Markdown document docs/new.md', projectRoot:null});
  const m = s.control.create({goal:'Create docs/new.md',idempotencyKey:'false-capability-loop',contract,allowedTasks:['repo-write']});
  const model = scripted(Array.from({length:3},()=>({tool_calls:[call('blocked',{reason:'I cannot create files because repo-write is missing'})]})));
  const result = await run(s,model, async()=>assert.fail('false denial must not execute'));
  assert.equal(result.blocked,true);
  assert.match(result.reason,/CAPABILITY_CONTRADICTION_REPEATED/);
  assert.equal(model.seen.length,3);
  assert.equal(s.control.get(m.id).status,'BLOCKED');
  assert.equal(s.control.get(m.id).receipts.length,0);
});

test('a genuinely unavailable write tool stays blocked and is never synthesized', async t => {
  const s=setup(t,['web-fetch']);
  const m=s.control.create({goal:'Create a Markdown file',idempotencyKey:'actual-missing-tool',allowedTasks:['web-fetch']});
  const model=scripted([{tool_calls:[call('blocked',{reason:'I cannot create files: no repo-write capability'})]}]);
  const result=await run(s,model,async()=>assert.fail('no action may be invented'));
  assert.equal(result.blocked,true);
  assert.equal(model.seen.length,1);
  assert.equal(s.control.get(m.id).status,'BLOCKED');
});

test('Swedish plain-text capability denial is corrected using native tool catalog', async t => {
  const s=setup(t,['repo-write']);
  const contract=projectNodeContract({title:'Create report',objective:'Create a new Markdown document docs/report.md'});
  const m=s.control.create({goal:'Skapa docs/report.md',idempotencyKey:'swedish-denial',contract,allowedTasks:['repo-write']});
  const model=scripted([
    {content:'Jag kan inte skapa filer, jag saknar verktyg för att skriva.'},
    {tool_calls:[call('repo-write',{path:'docs/report.md',content:'# Report'})]},
    {tool_calls:[call('blocked',{reason:'Actual verification still required'})]},
  ]);
  const executed=[];
  const result=await run(s,model,async task=>{executed.push(task.type);return {ok:true,verified:true,path:task.data.path,beforeSha256:'old',afterSha256:'new'};});
  assert.equal(result.blocked,true);
  assert.deepEqual(executed,['repo-write']);
  assert.match(JSON.stringify(model.seen[1]),/CAPABILITY_CORRECTION: repo-write/);
  assert.equal(s.control.get(m.id).receipts.length,1);
});


test('acceptance: false tool denial recovers into a real file write and an actual Git commit', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-real-artifact-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:50 }));
  const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
  git('init','-b','feature');
  git('config','user.email','jaco-ci@example.invalid');
  git('config','user.name','JACO CI');
  const s = setup(t,['repo-write','git-commit','repo-read']);
  const contract = projectNodeContract({
    title:'Create research document',
    objective:'Create a new Markdown document docs/research.md',
    mainGoal:'Save a reproducible artifact',
    projectRoot:root,
  });
  assert.equal(contract.verification.tests_required,false,'docs-only tasks do not inherit unrelated npm suites');
  const m = s.control.create({ goal:'Create docs/research.md and commit',idempotencyKey:'acceptance-real-artifact',
    allowedTasks:['repo-write','git-commit','repo-read'],contract,projectRoot:root });
  const workspace = createCodingWorkspace({root});
  const model = scripted([
    {tool_calls:[call('blocked',{reason:'I cannot create the Markdown file: repo-write is unavailable'})]},
    {tool_calls:[call('repo-write',{path:'docs/research.md',content:'# Proven artifact\n\nWritten by Aura.'})]},
    {tool_calls:[call('git-commit',{message:'docs: add proof artifact'})]},
    {tool_calls:[call('complete',{reason:'Artifact created and committed [#1] [#2]'})]},
  ]);
  const result = await run(s,model,task=>workspace.execute(task,contract,{receipts:s.control.get(m.id).receipts}));
  assert.equal(result.completed,true);
  assert.equal(fs.readFileSync(path.join(root,'docs/research.md'),'utf8'),'# Proven artifact\n\nWritten by Aura.');
  assert.equal(git('show','HEAD:docs/research.md'),'# Proven artifact\n\nWritten by Aura.');
  assert.equal(git('status','--porcelain'),'');
  assert.equal(s.control.get(m.id).contractStatus.machineVerified,true);
});

test('real durable mission resumes without repeating an unchanged read silently', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({goal:'Inspect and validate page changes',idempotencyKey:'causal-resume-1',allowedTasks:['web-fetch']});
  const oldArgs = {url:'https://example.test/unchanged'};
  for (let i = 0; i < 2; i++) {
    const {token}=s.control.claim(m.id,'nova');
    const action=s.control.begin(m.id,{owner:'nova',token,task:{type:'web-fetch',data:oldArgs}});
    s.control.finish(m.id,{owner:'nova',token,actionId:action.id,
      receipt:checkedReceipt(action,{ok:true,verified:true,content:'unchanged'})
    });
  }
  assert.equal(s.control.get(m.id).receipts.length,2);
  const model=scripted([
    {tool_calls:[call('web-fetch',oldArgs)]},
    {tool_calls:[call('web-fetch',{url:'https://example.test/alternative'})]},
    {tool_calls:[call('complete',{reason:'Alternative endpoint verified [#4]'})]}
  ]);
  const runs=[];
  const result=await run(s,model,async task=>{
    runs.push(task.data.url);
    return {ok:true,verified:true,content:task.data.url===oldArgs.url?'unchanged':'new'};
  });
  assert.equal(result.completed,true);
  assert.deepEqual(runs,[oldArgs.url,'https://example.test/alternative']);
  assert.ok(model.seen[1].some(msg=>msg.role==='user'&&String(msg.content).startsWith('STUCK:')), 
    'the third unchanged action must trigger adaptive correction across persisted runs');
  assert.equal(s.control.get(m.id).receipts.length,4);
  assert.equal(s.control.get(m.id).status,'AWAITING_VERIFICATION');
});


test('queue preemption during model inference yields without false capability denial or another approval',async t=>{
  const s=setup(t,['web-fetch']);
  const research=s.control.create({goal:'Read the research result',idempotencyKey:'queue-original',allowedTasks:['web-fetch']});
  let priority,modelTurns=0,executions=0;
  const result=await runAgentMission({client:s.client,owner:'nova',system:'test',toolsFor:m=>plannerTools(m.allowedTasks,[],{},false),
    chat:async()=>{modelTurns++;priority=s.control.create({goal:'Read the priority result',idempotencyKey:'queue-priority',source:'skyfire-order',allowedTasks:['web-fetch']});
      return {tool_calls:[call('web-fetch',{url:'https://fixture.test/research'})]};},
    execute:async()=>{executions++;return{ok:true,verified:true};}
  });
  assert.equal(result.queueChanged,true);assert.equal(result.deferred,true);
  assert.equal(result.blocked,undefined);assert.equal(executions,0);assert.equal(modelTurns,1);
  assert.equal(s.control.get(research.id).status,'ACTIVE');
  const events=s.control.db.prepare('SELECT type,payload_json FROM events WHERE mission_id=?').all(research.id);
  assert.ok(events.every(e=>!['NOVA_OPERATOR_APPROVAL_REQUIRED','NOVA_SPEND_BLOCKED','NOVA_PLANNING_RESULT'].includes(e.type)));
  const priorityModel=scripted([{tool_calls:[call('web-fetch',{url:'https://fixture.test/priority'})]}, {tool_calls:[call('complete',{reason:'Observed priority [#1]'})]}]);
  const done=await run(s,priorityModel,async()=>({ok:true,verified:true,content:'priority result'}));
  assert.equal(done.completed,true);assert.equal(s.control.get(priority.id).status,'AWAITING_VERIFICATION');
  const resumed=await run(s,scripted([{tool_calls:[call('web-fetch',{url:'https://fixture.test/research'})]},{tool_calls:[call('complete',{reason:'Observed research [#1]'})]}]),async()=>({ok:true,verified:true,content:'research result'}));
  assert.equal(resumed.completed,true);assert.equal(s.control.get(research.id).receipts.length,1);
  assert.equal(s.control.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='NOVA_OPERATOR_RESOLUTION'").get().n,0);
});

test('queue changes at a planning boundary do not consume another model turn',async t=>{
  const s=setup(t,['web-fetch']);
  const original=s.control.create({goal:'Read two research pages',idempotencyKey:'boundary-original',allowedTasks:['web-fetch']});
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://fixture.test/first'})]}]);
  const result=await run(s,model,async()=>({ok:true,verified:true,content:'first'}),{
    onReceipt:async()=>{s.control.create({goal:'Read the new priority page',idempotencyKey:'boundary-priority',source:'stripe-order',allowedTasks:['web-fetch']});}
  });
  assert.equal(result.queueChanged,true);assert.equal(model.seen.length,1);
  assert.equal(s.control.get(original.id).status,'ACTIVE');assert.equal(result.receipts.length,1);
});

test('invalid selected-model credentials remain blocked rather than retried indefinitely', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal:'Inspect a page', idempotencyKey:'health-bad-key', allowedTasks:['web-fetch'] });
  const result = await run(s, { chat: async () => { throw Error('AURA_SELECTED_MODEL_UNAVAILABLE:gemini:AUTH_INVALID_KEY'); } }, async () => assert.fail('no side effects'));
  assert.equal(result.blocked, true);
  assert.equal(s.control.get(m.id).status, 'BLOCKED');
});

test('per-run step window yields ACTIVE durable work and resumes with its receipts', async t => {
  const s = setup(t, ['web-fetch']);
  const m = s.control.create({ goal:'Read two pages', idempotencyKey:'health-step-yield', allowedTasks:['web-fetch'] });
  const first = await run(s, scripted([{tool_calls:[call('web-fetch',{url:'https://first.test'})]}]),
    async () => ({ok:true,verified:true,content:'first'}), {maxSteps:1});
  assert.equal(first.deferred,true);
  assert.match(first.reason,/TURN_WINDOW_EXHAUSTED/);
  assert.equal(s.control.get(m.id).status,'ACTIVE');
  assert.equal(s.control.get(m.id).receipts.length,1);
  const next = await run(s, scripted([{tool_calls:[call('web-fetch',{url:'https://second.test'})]},
    {tool_calls:[call('complete',{reason:'Both pages verified'})]}]),
    async () => ({ok:true,verified:true,content:'second'}));
  assert.equal(next.completed,true);
  assert.equal(s.control.get(m.id).receipts.length,2);
});

test('service failure refreshes currently allowed catalog and offers an alternate tool', async t => {
  const s=setup(t,['web-fetch','health-check']);
  const m=s.control.create({goal:'Check service with a fallback',idempotencyKey:'health-tool-fallback',allowedTasks:['web-fetch','health-check']});
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://offline.test'})]},
    {tool_calls:[call('health-check',{})]},
    {tool_calls:[call('complete',{reason:'Verified by available health-check'})]}]);
  let catalogs=0;
  const result=await run(s,model,async action => action.type==='web-fetch'
    ? {ok:false,verified:false,error:'ECONNREFUSED'} : {ok:true,verified:true,content:'READY'},
    {toolsFor:mission=>{catalogs++;return plannerTools(mission.allowedTasks,[],{},false);}});
  assert.equal(result.completed,true);
  assert.ok(catalogs>=2);
  assert.match(JSON.stringify(model.seen[1]),/TOOL_HEALTH_RECOVERY/);
  assert.equal(s.control.get(m.id).receipts.length,2);
});

test('a temporary broken tool followed by a model block stays active for later repair', async x => {
  const s=setup(x,['web-fetch','health-check']);
  const mission=s.control.create({goal:'Read the page',idempotencyKey:'tool-health-block',allowedTasks:['web-fetch','health-check']});
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://unreachable.test'})]},
    {tool_calls:[call('blocked',{reason:'Browser bridge unavailable while trying the page'})]}]);
  const result=await run(s,model,async()=>({ok:false,verified:false,error:'ECONNREFUSED'}));
  assert.equal(result.deferred,true);
  assert.equal(result.recovery,'WAIT_TOOL');
  assert.equal(s.control.get(mission.id).status,'ACTIVE');
  assert.equal(s.control.get(mission.id).receipts.length,1);
});

test('operator authorization is never disguised as a health defer', async x => {
  const s=setup(x,['web-fetch']);
  const mission=s.control.create({goal:'Read page',idempotencyKey:'tool-health-approval',allowedTasks:['web-fetch']});
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://unreachable.test'})]},
    {tool_calls:[call('blocked',{reason:'Operator approval required to proceed'})]}]);
  const result=await run(s,model,async()=>({ok:false,verified:false,error:'ECONNREFUSED'}));
  assert.equal(result.blocked,true);
  assert.equal(s.control.get(mission.id).status,'BLOCKED');
});

test('a health-deferred mission cools down even after useful work, while a turn window keeps moving', async () => {
  const { novaLoopDelay } = await import('../../agents/hands-off-agent.mjs');
  assert.equal(novaLoopDelay({executed:true,deferred:true,recovery:'WAIT_PROVIDER'},60000,3000),60000);
  assert.equal(novaLoopDelay({executed:true,deferred:true,recovery:'WAIT_TOOL'},60000,3000),60000);
  assert.equal(novaLoopDelay({executed:true,deferred:true,reason:'TURN_WINDOW_EXHAUSTED'},60000,3000),3000);
  assert.equal(novaLoopDelay({executed:false,deferred:true},60000,3000),60000);
});

test('a missing operator fact remains a real question even after a network outage', async x => {
  const s=setup(x,['web-fetch']);
  const mission=s.control.create({goal:'Read a user-selected article',idempotencyKey:'health-needs-input',allowedTasks:['web-fetch']});
  const model=scripted([{tool_calls:[call('web-fetch',{url:'https://offline.test'})]},
    {tool_calls:[call('blocked',{reason:'Which page should I use for the article?'})]}]);
  const result=await run(s,model,async()=>({ok:false,verified:false,error:'ECONNREFUSED'}));
  assert.equal(result.blocked,true);
  assert.equal(s.control.get(mission.id).status,'BLOCKED');
});
