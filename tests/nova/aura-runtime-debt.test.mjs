import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ProviderRegistry } from '../../runtime/src/server/connected/providerRegistry.mjs';
import { automaticConnections } from '../../runtime/src/server/connected/automaticConnections.mjs';
import { serviceUnavailableLabel } from '../../agents/lib/aura-service-health.mjs';

const source = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

test('model discovery coalesces concurrent probes and caches passive reads, not explicit checks', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-provider-debt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let requests = 0, model = 'gemma4-e4b';
  const server = http.createServer(async (_req, res) => {
    requests++;
    await new Promise(resolve => setTimeout(resolve, 25));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: model }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const registry = new ProviderRegistry(dir, { JACO_AURA_LEAN: '1' });
  registry.providers.clear();
  registry.register({ id: 'local-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'gemma4-e4b' });
  const responses = await Promise.all(Array.from({length: 5}, () =>
    registry.probe('local-model', { maxAgeMs: 60_000 })));
  assert.equal(requests, 1, 'five callers must share one /v1/models HTTP request');
  assert.ok(responses.every(r => r.ok && r.models[0] === 'gemma4-e4b'));
  const observedAt = responses[0].observedAt;
  model = 'gemma4-e4b-new';
  const cached = await registry.probe('local-model', { maxAgeMs: 60_000 });
  assert.equal(requests, 1);
  assert.equal(cached.observedAt, observedAt, 'cached observation must not look fresh');
  assert.deepEqual(cached.models, ['gemma4-e4b']);

  const fresh = await registry.probe('local-model');
  assert.equal(requests, 2, 'explicit probe bypasses the time-based cache');
  assert.deepEqual(fresh.models, ['gemma4-e4b-new']);
  registry.ensureDefaults = () => {};
  const listed = await registry.scan();
  assert.equal(requests, 2, 'Aura Lean passive scan reuses freshly measured models');
  assert.equal(listed[0].observedAt, fresh.observedAt);
  registry.register({ id: 'local-model', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, defaultModel: 'operator-changed' });
  await registry.probe('local-model', { maxAgeMs: 60_000 });
  assert.equal(requests, 3, 'changing a model definition invalidates cached probes');
});

test('Aura Lean does not spawn MCP providers during background auto-connect',async () => {
  const probes = [], started = [];
  const providers = new Map([
    ['litert', { id:'litert', baseUrl:'http://127.0.0.1:9379/v1', defaultModel:'gemma', credentialConfigured:true }],
    ['llamacpp', { id:'llamacpp', baseUrl:'http://127.0.0.1:9380/v1', defaultModel:'', credentialConfigured:true }],
  ]);
  const registry = {
    providers, ensureDefaults() {}, list: () => [...providers.values()],
    register(p) { providers.set(p.id, p); },
    async probe(id, options = {}) {
      probes.push({ id, maxAgeMs: options.maxAgeMs });
      return { ok: true, models: ['gemma'], observedAt: '2026-10-30T10:00:00.000Z' };
    },
  };
  const mcpHost = {
    status: () => [{id:'git',status:'STOPPED',agentAccess:'write',tools:[]}],
    async start(id) { started.push(id); return []; },
  };
  const conn = automaticConnections({ registry, mcpHost,
    env: { JACO_AURA_LEAN:'1', JACO_AUTO_START_TOOLS:'0' } });
  const state = await conn.refresh({force:true});
  assert.deepEqual(started, []);
  assert.equal(state.ok, true);
  assert.ok(probes.length >= 1 && probes.every(x => x.maxAgeMs === 60_000));
});

test('new Termux installs default to Lean; full profile remains explicit', () => {
  const ctl = source('runtime/bin/jacoctl');
  const installer = source('runtime/termux/install-activation.sh');
  const run = source('runtime/termux/services/jaco-core/run');
  const core = source('runtime/server.ts');
  assert.match(installer, /ensure_export JACO_AURA_LEAN "1"/);
  assert.match(ctl, /JACO_AURA_LEAN="\$\{JACO_AURA_LEAN:-1\}"/);
  assert.match(ctl, /requested_aura_lean/);
  assert.match(ctl, /if \[\[ "\$\{JACO_AURA_LEAN:-0\}" == "1" && "\$preference" == auto \]\]; then return 0; fi/);
  assert.match(run, /export JACO_AUTO_START_TOOLS=0/);
  assert.doesNotMatch(core, /startWorkerLoop\('worker_main'/);
  assert.match(core, /if \(!auraLean\) \{[\s\S]*?loadLegacyHeartbeat\(\)/);
  assert.match(core, /legacyHeartbeatPromise \?\?= import\('\.\/src\/server\/plan\/autonomousHeartbeat\.js'\)/);
  assert.doesNotMatch(core, /^import\s*\{[\s\S]*?\}\s*from\s*["']\.\/src\/server\/plan\/autonomousHeartbeat\.js["'];/m,
    'Aura startup must not import the heavy old model/market/command stack');
  assert.match(core, /auraLean \? 5000 : 1200/);
  assert.match(core, /auraLean \? 180_000 : 30_000/);
});

test('optional browser services report intentional disablement, not false downtime', () => {
  const env = { JACO_AURA_LEAN:'1', JACO_ENABLE_CDP:'1' };
  assert.equal(serviceUnavailableLabel('cdpBridge',env,'android'),'DISABLED (AURA_LEAN)');
  assert.equal(serviceUnavailableLabel('novaBridge',env,'android'),'DISABLED (AURA_LEAN)');
  assert.equal(serviceUnavailableLabel('cdpBridge',{JACO_AURA_LEAN:'0',JACO_ENABLE_CDP:'1'},'android'),'DOWN');
});

test('dormant Aura views code-split; supervisor reduces retry/probe pressure without losing receipts',() => {
  const ui=source('runtime/src/components/JacoAuraComputeIDE.tsx');
  for(const name of ['CognitiveGameboard','VoiceChannel','RevenueView','SkillsView','DevicesView']) {
    assert.match(ui,new RegExp('React\\.lazy\\(\\(\\) => import\\(\\x27\\./'+name+'\\x27\\)'));
  }
  const supervisor=source('gateway/src/workplace/workplace-agent-supervisor.mjs');
  assert.match(supervisor,/let launching = false/);
  assert.match(supervisor,/Math\.min\(60_000, restartDelayMs/);
  assert.match(supervisor,/Math\.min\(nextDelay \* 2, 8000\)/);
  assert.match(supervisor,/providerProbeTimeoutMs/);
  assert.match(supervisor,/aggregateState = 'VERIFYING_SEER_BRAIN'/);
  assert.match(supervisor,/await launchNova\(\)/);
  const dispatcher=source('runtime/src/server/connected/connectedRuntime.mjs');
  assert.match(dispatcher,/let tickInFlight = false/);
  assert.match(dispatcher,/\.finally\(\(\) => \{ tickInFlight = false; \}\)/);
});
