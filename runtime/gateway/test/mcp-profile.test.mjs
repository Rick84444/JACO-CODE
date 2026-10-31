import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createToolRegistry } from '../src/tool-registry.mjs';
import {
  JACO_MCP_COGNITIVE_READ,
  JACO_MCP_COGNITIVE_COLLABORATE,
  selectJacoMcpTools,
} from '../src/mcp-factory.mjs';

const registry = () => createToolRegistry({
  core: {},
  system: {},
  modelId: 'chatgpt-cognitive-test',
  workplace: {},
});
const names = tools => tools.map(tool => tool.name);

test('the dedicated ChatGPT read profile exposes exactly four bounded tools', () => {
  const full = registry();
  assert.equal(full.length, 42, 'legacy JACO clients retain their full catalog');
  const selected = selectJacoMcpTools(full, 'cognitive-read');
  assert.deepEqual(names(selected), [...JACO_MCP_COGNITIVE_READ]);
  assert.ok(selected.every(x => x.config.annotations.readOnlyHint === true));
  for (const tool of selected) {
    assert.doesNotMatch(tool.name, /post|activate|update|goal|tick|write|note|probe|relay|shell/i);
  }
});

test('collaboration profile permits only scoped communication and opt-in memory notes', () => {
  const selected = selectJacoMcpTools(registry(), 'cognitive-collaborate');
  assert.deepEqual(names(selected), [...JACO_MCP_COGNITIVE_COLLABORATE]);
  assert.equal(selected.length, 7);
  for (const forbidden of ['jaco_seer_goal','jaco_mission_tick','jaco_shell_inspect',
    'jaco_relay_action','jaco_system_update','jaco_system_activate',
    'jaco_aura_provider_chat','jaco_wordpress_update_page']) {
    assert.equal(names(selected).includes(forbidden), false, forbidden);
  }
  assert.equal(selected.find(x => x.name === 'jaco_knowledge_note').config.annotations.readOnlyHint, false);
});

test('invalid MCP tool profile fails closed instead of silently showing 42 tools', () => {
  assert.throws(() => selectJacoMcpTools(registry(), 'cognitive-read-write-full'), /JACO_MCP_TOOL_PROFILE_INVALID/);
  assert.throws(() => selectJacoMcpTools(registry(), ''), /JACO_MCP_TOOL_PROFILE_INVALID/);
  assert.throws(() => selectJacoMcpTools(registry(), 'Cognitive-Read'), /JACO_MCP_TOOL_PROFILE_INVALID/);
});

test('MCP tool profile fails closed if a required tool is missing from its registry', () => {
  assert.throws(() => selectJacoMcpTools(registry().filter(x => x.name !== 'jaco_cognitive_context'), 'cognitive-read'),
    /JACO_MCP_COGNITIVE_PROFILE_INCOMPLETE/);
});

test('read profile does not inherit accidental newly registered tools', () => {
  const injected = registry();
  injected.push({name:'jaco_unreviewed_cloud_control',config:{},handler:async() => {}});
  assert.deepEqual(names(selectJacoMcpTools(injected,'cognitive-read')), [...JACO_MCP_COGNITIVE_READ]);
});

test('collaboration profile cannot write a knowledge note without explicit operator opt-in', async () => {
  const { createToolHandlers } = await import('../src/tool-handlers.mjs');
  const handlers = createToolHandlers({core:{
    knowledgeNote:async()=>{throw Error('UNREACHABLE');},
  },system:{},modelId:'remote',env:{}});
  await assert.rejects(() => handlers.jaco_knowledge_note({
    topic:'Research notes',note:'Only an operator-approved, clearly unverified note may persist.',
  }),/JACO_KNOWLEDGE_WRITE_DISABLED/);
});


test('dedicated tunnel launcher pins read-only profile before loading stdio module', () => {
  const source = readFileSync(new URL('../src/mcp-cognitive-stdio.mjs',import.meta.url),'utf8');
  const gate=source.indexOf("process.env.JACO_MCP_TOOL_PROFILE = 'cognitive-read'");
  const loaded=source.indexOf("await import('./mcp-stdio.mjs')");
  assert.ok(gate>=0 && loaded>gate,'fail closed even if an inherited environment selected full');
  assert.ok(!source.includes("process.env.JACO_MCP_TOOL_PROFILE || 'full'"));
});


test('real MCP server SDK JSON-RPC tools/list exposes only four external read tools', async () => {
  const { buildJacoMcpServer } = await import('../src/mcp-factory.mjs');
  const handler = createMcpHandler(() => buildJacoMcpServer({
    core:{},system:{},modelId:'private-chatgpt-test',profile:'cognitive-read',
  }));
  try {
    const response = await handler.fetch(new Request('http://test.local/mcp',{
      method:'POST',
      headers:{'content-type':'application/json','accept':'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}),
    }));
    assert.equal(response.status,200,'server responded successfully to an actual tools/list request');
    const body=await response.text();
    const messages=body.split(/\r?\n/).filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));
    const reply=messages.find(message => Array.isArray(message?.result?.tools));
    assert.ok(reply,'MCP SDK response must contain tools/list, not an error or an empty heartbeat');
    assert.deepEqual(reply.result.tools.map(t => t.name),
      ['jaco_identity','jaco_system_health','jaco_cognitive_context','jaco_knowledge_search']);
    assert.ok(reply.result.tools.every(t => t.annotations?.readOnlyHint === true));
  } finally {
    await handler.close();
  }
});
