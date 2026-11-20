import test from 'node:test';
import assert from 'node:assert/strict';
import { activationReport, formatReport, runtimeUp } from '../../agents/lib/activate.mjs';

// A runtime stand-in: tool servers that start on request, a provider scan and the planner state.
function fakeRuntime({ servers, scan, planner, workplace = { state: 'RUNNING', novaState: 'RUNNING' }, startFails = [], identity = {}, executorHealth = null }) {
  const calls = [];
  const f = async (url, init = {}) => {
    const route = new URL(url).pathname, method = init.method || 'GET';
    calls.push(`${method} ${route}`);
    const ok = body => ({ ok: true, status: 200, json: async () => ({ success: true, ...body }) });
    const bad = (status, error) => ({ ok: false, status, json: async () => ({ success: false, error }) });
    if (route === '/api/runtime/identity') return ok({ product:'JACO Autonomus IDE', version: '0.21.0', ...identity });
    if (route === '/api/connected/nova/executor-health') {
      assert.ok(init.headers['x-gateway-token']);
      return executorHealth ? ok(executorHealth) : bad(404, 'NOT_FOUND');
    }
    if (route === '/api/system/status') return ok({ status: { state: workplace.supervisorState || 'READY' } });
    if (route === '/health') return ok({ status: 'READY', supervisedAgents: { state: workplace.state, nova: { state: workplace.novaState } } });
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
  assert.match(formatReport(r), /Tools: 17 in 3 of 3 servers/);
});

test('Termux supervisor ownership is part of READY truth when required', async () => {
  const g = GOOD(); g.workplace = { state: 'RUNNING', novaState: 'RUNNING', supervisorState: 'DEGRADED' };
  const r = await activationReport({ baseUrl: 'http://x', workplaceUrl: 'http://w', sentinelUrl: 'http://s', token: 't', fetchImpl: fakeRuntime(g), requireSupervisor: true });
  assert.equal(r.supervisor.state, 'DEGRADED');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /supervisor.*not READY/i.test(p)));
});

test('Workplace/Durable Nova are part of READY truth, not just Core/tools/provider', async () => {
  const g = GOOD(); g.workplace = { state: 'RUNNING', novaState: 'STOPPED' };
  const r = await activationReport({ baseUrl: 'http://x', workplaceUrl: 'http://w', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.workplace.up, true);
  assert.equal(r.workplace.novaState, 'STOPPED');
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /Durable Nova.*not RUNNING|Workplace\/Durable Nova är inte RUNNING/.test(p)));
});

test('Lite disabled Workplace supervisor is not misdiagnosed as a stopped managed Nova', async () => {
  const g = GOOD();
  g.workplace = { state:'DISABLED', novaState:'DISABLED' };
  const report = await activationReport({ baseUrl:'http://x', workplaceUrl:'http://w',
    token:'t', fetchImpl:fakeRuntime(g), lite:true, requireWorkplace:true });
  assert.equal(report.workplace.up, true);
  assert.equal(report.workplace.state, 'READY');
  assert.equal(report.workplace.novaState, 'EXTERNAL_UNVERIFIED');
  assert.equal(report.workplace.externalExecutor, true);
  assert.ok(report.problems.some(p => /managed by the separate Lite launcher/.test(p)));
  assert.ok(report.problems.every(p => !p.includes('Workplace/Durable Nova is not RUNNING')));
  assert.equal(report.ok, false, 'never attest an unprobed external worker');
});

test('Lite observes its own worker even when coordination is optional and caller assumed full', async () => {
  const g = GOOD();
  g.identity = { executionProfile: 'lite', workplaceRequired: false };
  g.executorHealth = { schema: 'jaco.nova-executor-health/v1', state: 'RUNNING', observedAt: new Date().toISOString() };
  const f = fakeRuntime(g);
  const r = await activationReport({ baseUrl:'http://x', token:'t', fetchImpl:f, lite:false });
  assert.equal(r.ok, true);
  assert.equal(r.executor.state, 'RUNNING');
  assert.equal(r.workplace.required, false);
  assert.ok(!f.calls.includes('GET /health'));
  assert.ok(f.calls.includes('GET /api/connected/nova/executor-health'));
});

test('Lite does not attest READY for absent, stale or malformed worker observations', async () => {
  for (const health of [null, { schema:'jaco.nova-executor-health/v1', state:'UNVERIFIED', observedAt:new Date().toISOString() },
    { state:'RUNNING', observedAt:new Date().toISOString() }, { schema:'jaco.nova-executor-health/v1', state:'RUNNING', observedAt:null }]) {
    const g = GOOD();
    g.identity = { executionProfile:'lite', workplaceRequired:false };
    g.executorHealth = health;
    const r = await activationReport({ baseUrl:'http://x', token:'t', fetchImpl:fakeRuntime(g) });
    assert.equal(r.ok, false);
    assert.equal(r.executor.state, 'UNVERIFIED');
  }
});

test('required Lite coordination checks service health, not disabled supervision', async () => {
  const g = GOOD();
  g.identity = { executionProfile:'lite', workplaceRequired:true };
  g.workplace = { state:'DISABLED', novaState:'DISABLED' };
  g.executorHealth = { schema:'jaco.nova-executor-health/v1', state:'RUNNING', observedAt:new Date().toISOString() };
  const r = await activationReport({ baseUrl:'http://x', token:'t', fetchImpl:fakeRuntime(g) });
  assert.equal(r.ok, true);
  assert.equal(r.workplace.state, 'READY');
  assert.equal(r.workplace.novaState, 'RUNNING');
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
  assert.ok(r.problems.some(p => /Tool server fetch did not start: spawn npx ENOENT/.test(p)));
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
  assert.ok(r.problems.some(p => /deepseek is not answering \(NO_KEY\)/.test(p)));
  assert.equal(r.ok, false);
});

test('no choice made: the first provider that answers is named as the automatic planner', async () => {
  const g = GOOD(); g.planner = { choice: null, choices: [] };
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.planner.source, 'automatic');
  assert.equal(r.planner.provider, 'deepseek');
});

test('no provider answers at all is a problem with a way out', async () => {
  const g = GOOD(); g.scan = [{ id: 'ollama', active: false, state: 'UNREACHABLE' }]; g.planner = { choice: null, choices: [] };
  const r = await activationReport({ baseUrl: 'http://x', token: 't', fetchImpl: fakeRuntime(g) });
  assert.equal(r.ok, false);
  assert.ok(r.problems.some(p => /No model provider is answering/.test(p)));
});

test('activation rejects HTML fallback and an unrelated JSON listener', async () => {
  for (const body of ['<html>SPA</html>', JSON.stringify({success:true, product:'Unrelated'})]) {
    const r=await activationReport({baseUrl:'http://x',fetchImpl:async()=>new Response(body)});
    assert.equal(r.runtime.up,false);
    assert.equal(r.ok,false);
  }
});

test('a runtime that is down is reported plainly', async () => {
  const dead = async () => { throw new Error('ECONNREFUSED'); };
  assert.equal(await runtimeUp({ baseUrl: 'http://x', fetchImpl: dead }), false);
  const r = await activationReport({ baseUrl: 'http://x', fetchImpl: dead });
  assert.equal(r.runtime.up, false);
  assert.match(formatReport(r), /The JACO runtime is not answering/);
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

test('Debian CLI prefers the live portable launcher token over stale Termux and state files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-debian-cli-'));
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const runtimeEnv = path.join(root, 'runtime.env');
  fs.writeFileSync(path.join(root, '.env'), 'JACO_GATEWAY_TOKEN="launcher-current"\nGATEWAY_TOKEN="launcher-old"\n');
  fs.writeFileSync(runtimeEnv, 'GATEWAY_TOKEN="termux-stale"\n');
  fs.writeFileSync(path.join(state, 'gateway.token'), 'state-stale\n');
  assert.equal(gatewayToken({JACO_RUNTIME_ENV:runtimeEnv,JACO_STATE_DIR:state},root),'launcher-current');
  assert.equal(gatewayToken({TERMUX_VERSION:'0.118',JACO_RUNTIME_ENV:runtimeEnv,JACO_STATE_DIR:state},root),'termux-stale');
  assert.equal(gatewayToken({GATEWAY_TOKEN:'explicit-override',JACO_RUNTIME_ENV:runtimeEnv,JACO_STATE_DIR:state},root),'explicit-override');
});

test('installed portable CLI reads JACO_DATA_DIR .env as local-stack does',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cli-installed-'));
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-cli-data-'));
  fs.writeFileSync(path.join(root,'.env'),'GATEWAY_TOKEN="checkout-old"\n');
  fs.writeFileSync(path.join(data,'.env'),'GATEWAY_TOKEN="installed-current"\n');
  assert.equal(gatewayToken({JACO_DATA_DIR:data,JACO_RUNTIME_ENV:path.join(root,'missing.env')},root),'installed-current');
});
