// Operator 2026-10-03: Nova's planner calls tools natively, with schemas, like Claude does.
import test from 'node:test';
import assert from 'node:assert/strict';
const { plannerTools, planFromToolCalls, compactSchema } = await import('../../agents/lib/native-tools.mjs');
const { nativeToolsFor } = await import('../../agents/hands-off-agent.mjs');

const mcp = [{ server: 'git', name: 'git_show', readOnly: true, description: 'Shows a commit', inputSchema: { type: 'object', title: 'X', properties: { repo_path: { type: 'string', description: 'long prose' }, revision: { type: 'string' } }, required: ['repo_path', 'revision'] } }];

test('tool list: one function per allowed task, MCP tools with their real schemas, complete and blocked', () => {
  const { tools, resolve } = plannerTools(['web-fetch', 'mcp-call', 'repo-write'], mcp);
  const names = tools.map(t => t.function.name);
  assert.deepEqual(names, ['web-fetch', 'repo-write', 'mcp__git__git_show', 'complete', 'blocked', 'request_replan']);
  const show = tools.find(t => t.function.name === 'mcp__git__git_show').function.parameters;
  assert.deepEqual(show.required, ['repo_path', 'revision']);
  assert.equal(show.properties.repo_path.description, undefined, 'prose is dropped from schemas');
  assert.deepEqual(tools[1].function.parameters.required, ['path', 'content']);
  assert.deepEqual(resolve('mcp__git__git_show'), { kind: 'mcp', server: 'git', tool: 'git_show', write: false });
  assert.equal(resolve('shell'), null, 'a task that is not allowed has no function');
  assert.ok(plannerTools(['mcp-call'], []).tools.some(t => t.function.name === 'mcp-call'), 'generic mcp-call without a catalog');
  assert.deepEqual(compactSchema({ description: 'd', properties: { a: { type: 'string', default: 'x' } } }), { properties: { a: { type: 'string' } } });
});

test('tool calls become a plan: several calls a batch, finish only without steps, bad calls rejected', () => {
  const { resolve } = plannerTools(['web-fetch', 'mcp-call'], mcp);
  const call = (name, args) => ({ type: 'function', function: { name, arguments: JSON.stringify(args) } });
  assert.deepEqual(planFromToolCalls({ tool_calls: [call('mcp__git__git_show', { repo_path: 'C:/r', revision: 'HEAD', expectedOutcome: 'diff' })] }, resolve),
    { task: { type: 'mcp-call', data: { server: 'git', tool: 'git_show', arguments: { repo_path: 'C:/r', revision: 'HEAD' } }, expectedOutcome: 'diff' } });
  const batch = planFromToolCalls({ tool_calls: [call('web-fetch', { url: 'https://a.test' }), call('web-fetch', { url: 'https://b.test' }), call('complete', { reason: 'early' })] }, resolve);
  assert.deepEqual(batch.tasks.map(t => t.data.url), ['https://a.test', 'https://b.test']);
  assert.equal(batch.complete, undefined, 'completion waits for the receipts');
  assert.deepEqual(planFromToolCalls({ tool_calls: [call('complete', { reason: 'Done [#2]' })] }, resolve), { complete: true, reason: 'Done [#2]' });
  assert.equal(planFromToolCalls({ content: '{"task":{}}' }, resolve), null);
  assert.throws(() => planFromToolCalls({ tool_calls: [call('shell', { command: 'x' })] }, resolve), /PLAN_TOOL_UNKNOWN:shell/);
  assert.throws(() => planFromToolCalls({ tool_calls: [{ function: { name: 'web-fetch', arguments: '{bad' } }] }, resolve), /PLAN_TOOL_ARGUMENTS_INVALID/);
});

test('native tools are used for cloud planners, not for Ollama or Groq unless asked', () => {
  assert.equal(nativeToolsFor({ name: 'deepseek', model: 'deepseek-v4-pro' }, {}), true);
  assert.equal(nativeToolsFor({ name: 'ollama', model: 'qwen' }, {}), false);
  assert.equal(nativeToolsFor({ name: 'ollama-local', model: 'gemma3:4b' }, {}), false);
  // Ollama Cloud returns native tool calls (checked live 2026-10-04); only the local server does not.
  assert.equal(nativeToolsFor({ name: 'ollama-cloud', model: 'gpt-oss:120b' }, {}), true);
  assert.equal(nativeToolsFor({ name: 'groq', model: 'x' }, {}), false);
  assert.equal(nativeToolsFor({ name: 'groq', model: 'x' }, { JACO_NOVA_NATIVE_TOOLS: 'all' }), true);
  assert.equal(nativeToolsFor({ name: 'deepseek', model: 'x' }, { JACO_NOVA_NATIVE_TOOLS: '0' }), false);
});

test('local planners are constrained to a plan schema built from the allowed tasks', async () => {
  const { planSchema } = await import('../../agents/lib/native-tools.mjs');
  const { schemaOutputFor } = await import('../../agents/hands-off-agent.mjs');
  const s = planSchema(['web-fetch', 'mcp-call', 'not-a-task']);
  const one = s.anyOf[0].properties.task.anyOf;
  assert.deepEqual(one.map(x => x.properties.type.const), ['web-fetch', 'mcp-call']);
  assert.deepEqual(one[1].properties.data.required, ['server', 'tool']);
  assert.equal(s.anyOf[1].properties.tasks.maxItems, 4);
  assert.deepEqual(s.anyOf.slice(2).map(x => x.required), [['complete', 'reason'], ['blocked', 'reason'], ['replan', 'reason', 'subgoals']]);
  assert.equal(schemaOutputFor({ name: 'ollama-local', model: 'm' }, {}), true);
  assert.equal(schemaOutputFor({ name: 'deepseek', model: 'm' }, {}), false);
  assert.equal(schemaOutputFor({ name: 'groq', model: 'm' }, { JACO_NOVA_SCHEMA_OUTPUT: 'all' }), true);
  assert.equal(schemaOutputFor({ name: 'ollama', model: 'm' }, { JACO_NOVA_SCHEMA_OUTPUT: '0' }), false);
});

test('a direct mcp-call is understood when the MCP tools are offered as their own functions', () => {
  const { tools, resolve } = plannerTools(['mcp-call'], [{ server: 'fetch', name: 'fetch', readOnly: true, inputSchema: { type: 'object', properties: { url: { type: 'string' } } } }]);
  assert.ok(!tools.some(t => t.function.name === 'mcp-call'), 'not offered twice');
  const plan = planFromToolCalls({ tool_calls: [{ function: { name: 'mcp-call', arguments: JSON.stringify({ server: 'fetch', tool: 'fetch', arguments: { url: 'https://example.com' } }) } }] }, resolve);
  assert.deepEqual(plan, { task: { type: 'mcp-call', data: { server: 'fetch', tool: 'fetch', arguments: { url: 'https://example.com' } } } });
  assert.throws(() => planFromToolCalls({ tool_calls: [{ function: { name: 'mcp-call', arguments: '{}' } }] }, plannerTools(['web-fetch'], []).resolve), /PLAN_TOOL_UNKNOWN/);
});

test('native replan preserves structured subgoals for SEER instead of pretending to execute a tool', () => {
 const {resolve}=plannerTools(['repo-read']);
 const subgoals=[{title:'Inspect',objective:'Inspect real contracts'},{title:'Integrate',objective:'Implement and verify original acceptance'}];
 assert.deepEqual(planFromToolCalls({tool_calls:[{function:{name:'request_replan',arguments:JSON.stringify({reason:'Too broad',subgoals})}}]},resolve),{replan:true,reason:'Too broad',subgoals});
});


test('stale MCP write catalog is filtered by current mission authority', () => {
  const changing={server:'files',name:'save_file',readOnly:false,inputSchema:{type:'object',properties:{}}};
  const unclassified={server:'files',name:'opaque_tool',inputSchema:{type:'object',properties:{}}};
  const readable={server:'files',name:'read_file',readOnly:true,inputSchema:{type:'object',properties:{}}};
  const readonly=plannerTools(['mcp-call'],[changing,readable]);
  assert.equal(readonly.resolve('mcp__files__save_file'),null);
  assert.equal(plannerTools(['mcp-call'],[unclassified]).resolve('mcp__files__opaque_tool'),null,'unknown read/write metadata never implies read-only authority');
  assert.equal(readonly.tools.some(t=>t.function.name==='mcp__files__save_file'),false);
  assert.ok(readonly.resolve('mcp__files__read_file'));
  const write=plannerTools(['mcp-call','mcp-write'],[changing,readable]);
  assert.equal(plannerTools(['mcp-call','mcp-write'],[unclassified]).resolve('mcp__files__opaque_tool').write,true,'opaque tools require explicit write authority');
  assert.equal(write.resolve('mcp__files__save_file').write,true);
  assert.equal(planFromToolCalls({tool_calls:[{function:{name:'mcp__files__save_file',arguments:'{}'}}]},write.resolve).task.type,'mcp-write');
});
