import test from 'node:test';
const syntheticFailureSecret = ["sk-ant-ap","i03-AbCdEfGh","IjKlMnOpQrStUvWxYz0123456789"].join('');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableMissionBus } from '../../runtime/src/server/connected/durableMissionBus.mjs';
import { NovaMissionControl, mountNovaMissionRoutes } from '../../runtime/src/server/connected/novaMissionControl.mjs';
import { MissionClient } from '../../agents/lib/mission-client.mjs';
import { plannerTools } from '../../agents/lib/native-tools.mjs';
import { runAgentMission } from '../../agents/lib/agent-loop.mjs';
import { classifyToolFailure, diagnoseToolFailure, createToolDiagnoser } from '../../agents/lib/tool-failure-diagnosis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('failures are classified by what can be done about them', () => {
  const kind = (error, task) => classifyToolFailure(error, task).kind;
  assert.equal(kind('MCP_SERVER_EXITED:filesystem'), 'SERVER_STOPPED');
  assert.equal(kind('MCP_SERVER_SPAWN_FAILED:gitx:ENOENT'), 'COMMAND_MISSING');
  assert.equal(kind('listen EADDRINUSE: address already in use 127.0.0.1:5000'), 'PORT_CONFLICT');
  assert.equal(kind('fetch failed ECONNREFUSED 127.0.0.1:2995'), 'LOCAL_SERVICE_DOWN');
  assert.equal(kind('Cannot find module ./x.mjs'), 'CODE_ERROR');
  assert.equal(kind('HTTP 401 UNAUTHORIZED'), 'NEEDS_OPERATOR');
  assert.equal(kind('something odd'), 'UNKNOWN');
  assert.equal(classifyToolFailure('MCP_SERVER_STOPPED:git').server, 'git');
  assert.equal(classifyToolFailure('boom', { type: 'mcp-call', data: { server: 'repo' } }).server, 'repo');
});

test('a stopped server is restarted and its own log and status are shown to the model', async () => {
  const calls = [];
  const d = await diagnoseToolFailure({
    task: { type: 'mcp-call', data: { server: 'git', tool: 'git_status' } },
    receipt: { ok: false, error: 'MCP_SERVER_EXITED:git' },
    serverStatus: async id => ({ status: 'FAILED', error: 'exited with code 1: bad config' }),
    startServer: async id => { calls.push(id); return { ok: true, tools: 9 }; },
    readLog: async () => 'line one\nline two',
    ensureStack: async () => { throw new Error('must not run for a stopped MCP server'); },
  });
  assert.deepEqual(calls, ['git']);
  assert.equal(d.kind, 'SERVER_STOPPED');
  assert.match(d.text, /TOOL_DIAGNOSIS kind=SERVER_STOPPED server=git/);
  assert.match(d.text, /exited with code 1: bad config/);
  assert.match(d.text, /started git \(9 tools\)/);
  assert.match(d.text, /line two/);
});

test('credential and permission failures are never worked around or restarted', async () => {
  const d = await diagnoseToolFailure({
    receipt: { ok: false, error: 'PERMISSION denied: APPROVAL required' },
    startServer: async () => { throw new Error('must not start'); },
    ensureStack: async () => { throw new Error('must not recover'); },
  });
  assert.equal(d.kind, 'NEEDS_OPERATOR');
  assert.match(d.text, /operator decision/);
  assert.deepEqual(d.actions, []);
});

test('a failing remedy is reported as evidence instead of aborting the diagnosis', async () => {
  const d = await diagnoseToolFailure({
    receipt: { ok: false, error: 'MCP_SERVER_STOPPED:repo' },
    serverStatus: async () => { throw new Error('runtime offline'); },
    startServer: async () => ({ ok: false, error: 'spawn failed: uvx missing' }),
  });
  assert.match(d.text, /server status: unavailable \(runtime offline\)/);
  assert.match(d.text, /start of repo failed: spawn failed: uvx missing/);
});

test('secrets in logs are redacted before the model sees them', async () => {
  const d = await diagnoseToolFailure({
    receipt: { ok: false, error: 'MCP_SERVER_EXITED:git' },
    readLog: async () => 'token ' + syntheticFailureSecret + ' rejected',
  });
  assert.doesNotMatch(d.text, /AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/);
});

test('the production diagnoser uses the MCP API, reads startup logs and rate-limits stack recovery', async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-diag-'));
  fs.mkdirSync(path.join(data, 'logs', 'startup'), { recursive: true });
  fs.writeFileSync(path.join(data, 'logs', 'startup', 'workplace.err.log'), 'boot failed: EADDRINUSE\n');
  const urls = [], spawned = [];
  let t = 1_000_000;
  const diagnose = createToolDiagnoser({
    runtimeUrl: 'http://127.0.0.1:1', env: { JACO_DATA_DIR: data, JACO_INSTALL_ROOT: ROOT, JACO_GATEWAY_TOKEN: 't'.repeat(32) },
    fetchImpl: async (url, opts) => { urls.push(`${opts?.method || 'GET'} ${new URL(url).pathname}`); return { ok: true, json: async () => ({ success: true, servers: [{ id: 'workplace', status: 'STOPPED' }], tools: ['a'] }) }; },
    spawnImpl: (cmd, args) => { spawned.push(args[0]); return { unref() {} }; },
    now: () => t,
  });
  const down = { receipt: { ok: false, error: 'fetch failed ECONNREFUSED MCP_SERVER_UNAVAILABLE:workplace' } };
  const first = await diagnose(down);
  assert.equal(spawned.length, 0, 'an unavailable MCP server restarts that server, not the whole stack');
  assert.ok(urls.includes('POST /api/mcp/start'));
  assert.match(first.text, /boot failed/);
  const stack = { receipt: { ok: false, error: 'connect ECONNREFUSED 127.0.0.1:2995' } };
  const a = await diagnose(stack); t += 1000;
  const b = await diagnose(stack);
  assert.equal(spawned.length, 1, 'stack recovery is requested once per cooldown');
  assert.match(a.text, /launcher started in the background/);
  assert.match(b.text, /recovery already requested recently/);
  fs.rmSync(data, { recursive: true, force: true });
});

function loop(t, allowedTasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diag-loop-'));
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
    handlers.at(-1)({ body: opts.body ? JSON.parse(opts.body) : undefined, params: { id: match?.[1] }, query: Object.fromEntries(new URL(url).searchParams) }, { status(n) { status = n; return this; }, json(v) { data = v; } });
    return { ok: status === 200, status, json: async () => data };
  });
  return { client, control };
}
const call = (name, args) => ({ id: name + Math.random(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
const scripted = answers => { const seen = []; return { seen, chat: async ({ messages }) => { seen.push(messages.map(m => ({ ...m }))); const a = answers.shift(); if (!a) throw new Error('script exhausted'); return a; } }; };

test('the agent loop diagnoses a failed tool once and the model sees the findings next turn', async t => {
  const s = loop(t, ['web-fetch']);
  s.control.create({ goal: 'Hämta sidan', idempotencyKey: 'd1', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://a.test' })] },
    { tool_calls: [call('web-fetch', { url: 'https://a.test' })] },
    { tool_calls: [call('complete', { reason: 'klart [#2]' })] },
  ]);
  const diagnosed = [];
  let attempt = 0;
  const result = await runAgentMission({
    client: s.client, owner: 'nova', chat: model.chat, system: 'test',
    toolsFor: m => plannerTools(m.allowedTasks, [], {}, false),
    execute: async () => (++attempt === 1 ? { ok: false, error: 'fetch failed ECONNREFUSED 127.0.0.1:2995' } : { ok: true, verified: true, content: 'ok' }),
    diagnose: async ({ receipt }) => { diagnosed.push(receipt.error); return { text: 'TOOL_DIAGNOSIS kind=LOCAL_SERVICE_DOWN: recovery requested' }; },
  });
  assert.equal(result.completed, true);
  assert.equal(diagnosed.length, 1);
  const secondTurn = model.seen[1].map(m => String(m.content));
  assert.ok(secondTurn.some(c => c.startsWith('TOOL_DIAGNOSIS kind=LOCAL_SERVICE_DOWN')), 'the model is shown the diagnosis before its next decision');
});

test('a diagnosis that throws never stops the mission', async t => {
  const s = loop(t, ['web-fetch']);
  s.control.create({ goal: 'Hämta sidan', idempotencyKey: 'd2', allowedTasks: ['web-fetch'] });
  const model = scripted([
    { tool_calls: [call('web-fetch', { url: 'https://b.test' })] },
    { tool_calls: [call('complete', { reason: 'ändå klart [#1]' })] },
  ]);
  const result = await runAgentMission({
    client: s.client, owner: 'nova', chat: model.chat, system: 'test',
    toolsFor: m => plannerTools(m.allowedTasks, [], {}, false),
    execute: async () => ({ ok: false, error: 'ECONNREFUSED' }),
    diagnose: async () => { throw new Error('diagnosis broke'); },
  });
  assert.notEqual(result.stopped, 'diagnosis broke');
  assert.equal(model.seen.length >= 2, true);
});
