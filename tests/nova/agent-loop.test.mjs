// Nova's agent loop against the real mission control: refusals and failures go back to the model,
// which corrects itself, instead of stopping the mission (operator 2026-10-09: "it gets stuck at once").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { MissionClient } from '../../agents/lib/mission-client.mjs';
import { plannerTools } from '../../agents/lib/native-tools.mjs';
import { runAgentMission, receiptForModel, contextPacketIntro } from '../../agents/lib/agent-loop.mjs';

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
