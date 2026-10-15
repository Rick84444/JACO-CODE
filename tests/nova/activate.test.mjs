import test from 'node:test';
import assert from 'node:assert/strict';
import { activationReport, formatReport, runtimeUp } from '../../agents/lib/activate.mjs';

// A runtime stand-in: tool servers that start on request, a provider scan and the planner state.
function fakeRuntime({ servers, scan, planner, workplace = { state: 'RUNNING', novaState: 'RUNNING' }, startFails = [] }) {
  const calls = [];
  const f = async (url, init = {}) => {
    const route = new URL(url).pathname, method = init.method || 'GET';
    calls.push(`${method} ${route}`);
    const ok = body => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
    const bad = (status, error) => ({ ok: false, status, json: async () => ({ success: false, error }) });
    if (route === '/api/runtime/identity') return ok({ version: '0.21.0' });
    if (route === '/api/system/status') return ok({ status: { state: workplace.supervisorState || 'READY' } });
    if (route === '/health') return ok({ supervisedAgents: { state: workplace.state, nova: { state: workplace.novaState } } });
    if (route === '/api/mcp/tools') {
      assert.ok(init.headers['x-gateway-token'], 'tool routes carry the gateway token');
      return ok({ servers: servers.map(s => ({ id: s.id, status: s.status, agentAccess: s.agentAccess || 'read', tools: s.status === 'READY' ? Array.from({ length: s.tools }, (_, i) => ({ name: `t${i}` })) : [] })) });
    }
    if (route === '/api/mcp/start') {
      const id = JSON.parse(init.body).server;
      if (startFails.includes(id)) return bad(409, 'spawn npx ENOENT');
      const s = servers.find(x => x.id === id); s.status = 'READY';
      return ok({ tools: Array.from({ length: s.tools }, (_, i) => `t${i}`) });
    }
    if (route === '/api/aura/workbench/providers/scan') return ok({ providers: scan });
    if (route === '/api/nova/planner') return ok(planner);
    return bad(404, 'NOT_FOUND');
  };
  f.calls = calls;
  return f;
}
const GOOD = () => ({
  servers: [{ id: 'remote', status: 'READY', tools: 4 }, { id: 'git', status: 'STOPPED', tools: 12 }, { id: 'fetch', status: 'STOPPED', tools: 1 }],
  scan: [{ id: 'deepseek', active: true, state: 'ACTIVE', models: 3, defaultModel: 'deepseek-flash', ms: 220 }, { id: 'ollama', active: false, state: 'UNREACHABLE', models: 0 }],
  planner: { choice: { provider: 'deepseek', model: 'deepseek-flash', by: 'operator' }, choices: [{ provider: 'deepseek', usable: true, keyConfigured: true }] },
});

test('stopped tool servers are started and counted; a working stack reports ok', async () => {
  const f = fakeRuntime(GOOD());
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: f });
  assert.equal(r.tools.ready, 3);
  assert.equal(r.tools.toolCount, 17);
  assert.deepEqual(r.tools.servers.filter(s => s.started).map(s => s.id).sort(), ['fetch', 'git']);
  assert.equal(f.calls.filter(c => c === 'POST /api/mcp/start').length, 2, 'only the stopped ones were started');
  assert.equal(r.planner.provider, 'deepseek');
  assert.equal(r.planner.reachable, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
  assert.match(formatReport(r), /Verktyg: 17 i 3 av 3 servrar/);
});

test('Termux supervisor ownership is part of READY truth when required', async () => {
  const g = GOOD(); g.workplace = { state: 'RUNNING', novaState: 'RUNNING', supervisorState: 'DEGRADED' };
  const r = await activationReport({ baseUrl: 'http://x', workplaceUrl: 'http://w', sentinelUrl: 'http://s', token: 't', fetchImpl: fakeRuntime(g), requireSupervisor: true });
  assert.equal(r.supervisor.state, 'DEGRADED');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /supervisor.*inte READY/i.test(p)));
});

test('Workplace/Durable Nova are part of READY truth, not just Core/tools/provider', async () => {
  const g = GOOD(); g.workplace = { state: 'RUNNING', novaState: 'STOPPED' };
  const r = await activationReport({ baseUrl: 'http://x', workplaceUrl: 'http://w', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.workplace.up, true);
  assert.equal(r.workplace.novaState, 'STOPPED');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /Durable Nova.*not RUNNING|Workplace\/Durable Nova är inte RUNNING/.test(p)));
});

test('a selected planner that was not actually scanned cannot make READY true', async () => {
  const g = GOOD();
  g.planner = { choice: { provider: 'mistral', model: 'mistral-large-latest', by: 'operator' }, choices: [{ provider: 'mistral', usable: true, keyConfigured: true }] };
  const r = await activationReport({ baseUrl: 'http://x', workplaceUrl: 'http://w', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.planner.reachable, false);
  assert.equal(r.planner.why, 'NOT_PROBED');
  assert.equal(r.ok, false);
});

test('a tool server that cannot start is named, and the stack is not ok', async () => {
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime({ ...GOOD(), startFails: ['fetch'] }) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /fetch startade inte: spawn npx ENOENT/.test(p)));
  assert.equal(r.tools.toolCount, 16);
});

test('--no-tools starts nothing', async () => {
  const f = fakeRuntime(GOOD());
  await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: f, startTools: false });
  assert.equal(f.calls.filter(c => c === 'POST /api/mcp/start').length, 0);
});

test('a planner the GUI chose that does not answer is reported with what to do', async () => {
  const g = GOOD(); g.scan = [{ id: 'deepseek', active: false, state: 'NO_KEY' }, { id: 'ollama', active: true, state: 'ACTIVE', models: 1, defaultModel: 'q' }];
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.planner.reachable, false);
  assert.equal(r.planner.why, 'NO_KEY');
  assert.ok(r.problems.some(p => /deepseek svarar inte \(NO_KEY\)/.test(p)));
  assert.equal(r.ok, false);
});

test('no choice made: the first provider that answers is named as the automatic planner', async () => {
  const g = GOOD(); g.planner = { choice: null, choices: [] };
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.planner.source, 'automatiskt');
  assert.equal(r.planner.provider, 'deepseek');
});

test('no provider answers at all is a problem with a way out', async () => {
  const g = GOOD(); g.scan = [{ id: 'ollama', active: false, state: 'UNREACHABLE' }]; g.planner = { choice: null, choices: [] };
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /Ingen modell-provider svarar/.test(p)));
});

test('a runtime that is down is reported plainly', async () => {
  const dead = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await runtimeUp({ baseUrl: 'http://x', fetchImpl: dead }), false);
  const r = await activationReport({ baseUrl: 'http://x', fetchImpl: dead });
  assert.equal(r.runtime.up, false);
  assert.match(formatReport(r), /JACO-runtime svarar inte/);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startPlan, gatewayToken } from '../../agents/jaco-cli.mjs';
test('the stack is started the way the platform does it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-root-'));
  fs.mkdirSync(path.join(root, 'scripts')); fs.writeFileSync(path.join(root, 'scripts/cloud-stack.sh'), '');
  fs.mkdirSync(path.join(root, 'rt/bin'), { recursive: true }); fs.writeFileSync(path.join(root, 'rt/bin/jacoctl'), '');
  const linux = startPlan({ platform: 'linux', env: {}, root });
  assert.equal(linux.cmd, 'bash'); assert.match(linux.args.join(' '), /cloud-stack\.sh up$/);
  const win = startPlan({ platform: 'win32', env: {}, root });
  assert.match(win.args.join(' '), /local-stack\.mjs$/);
  const termux = startPlan({ platform: 'linux', env: { TERMUX_VERSION: '0.118' }, root });
  assert.match(termux.args.join(' '), /rt[\\/]bin[\\/]jacoctl activate --profile full$/);
  // Termux without its supervisor falls back to the portable choices
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-bare-'));
  assert.match(startPlan({ platform: 'linux', env: { TERMUX_VERSION: '1' }, root: bare }).args.join(' '), /local-stack\.mjs$/);
});
test('the gateway token comes from env, canonical Termux runtime.env, state file, then checkout .env', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-tok-')), state = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-st-'));
  const runtimeEnv = path.join(root, 'runtime.env');
  assert.equal(gatewayToken({ JACO_GATEWAY_TOKEN: 'from-env', JACO_STATE_DIR: state, JACO_RUNTIME_ENV: runtimeEnv }, root), 'from-env');

  fs.writeFileSync(runtimeEnv, "export JACO_GATEWAY_TOKEN='from-runtime-env'\n");
  fs.writeFileSync(path.join(state, 'gateway.token'), 'stale-state-token\n');
  assert.equal(gatewayToken({ JACO_STATE_DIR: state, JACO_RUNTIME_ENV: runtimeEnv }, root), 'from-runtime-env', 'canonical Termux env wins over a stale state token');

  fs.rmSync(runtimeEnv);
  assert.equal(gatewayToken({ JACO_STATE_DIR: state, JACO_RUNTIME_ENV: runtimeEnv }, root), 'stale-state-token');
  fs.rmSync(path.join(state, 'gateway.token'));

  fs.mkdirSync(path.join(root, 'rt')); fs.writeFileSync(path.join(root, 'rt/.env'), 'OTHER=1\nGATEWAY_TOKEN="from-dotenv"\n');
  assert.equal(gatewayToken({ JACO_STATE_DIR: state, JACO_RUNTIME_ENV: runtimeEnv }, root), 'from-dotenv');
  assert.equal(gatewayToken({ JACO_STATE_DIR: state, JACO_RUNTIME_ENV: runtimeEnv }, fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-none-'))), '');
});


test('Termux jaco entrypoint routes activate/status through the product activation CLI', () => {
  const script = fs.readFileSync(path.resolve('runtime/bin/jaco'), 'utf8');
  assert.match(script, /activate\|status/);
  assert.match(script, /agents\/jaco-cli\.mjs/);
  assert.match(script, /jacoctl/, 'other lifecycle verbs retain the canonical runit supervisor');
});

test('npm jaco:status uses the same activation truth command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  assert.equal(pkg.scripts['jaco:status'], 'node agents/jaco-cli.mjs status');
});
