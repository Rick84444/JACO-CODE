import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { joinWorkplace, buildAgentCard } from '../../agents/lib/workplace-session.mjs';
import { bootstrapJacoAgent, JacoWorkplaceClient } from '../../gateway/src/workplace/workplace-client.mjs';
import { novaAgentCard } from '../../agents/hands-off-agent.mjs';

const TRANSPORT = 'transport-token-1234567890abcdef';
const SEER_TOKEN = 'seer-token-12345678901234567890';

async function startProcess(t, args, env, readyPattern) {
  const child = spawn(process.execPath, args, { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr.on('data', c => { output += c; });
  const exited = new Promise(r => child.once('exit', r));
  // A killed child has signalCode set and exitCode null, so wait on the exit event itself.
  const stop = async () => { child.kill(); await exited; };
  t.after(stop);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('START_TIMEOUT ' + output)), 8000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('EXIT ' + output)); });
    child.stdout.on('data', c => {
      output += c;
      const m = output.match(readyPattern);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
  });
  return { port, stop, output: () => output };
}

async function startWorkplace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-wp-agents-'));
  const wp = await startProcess(t, ['--experimental-sqlite', 'gateway/src/workplace/workplace-server.mjs'],
    { JACO_WORKPLACE_PORT: '0', JACO_WORKSPACE_ROOT: dir, JACO_WORKPLACE_TOKEN: TRANSPORT }, /READY http:\/\/[^:]+:(\d+)/);
  // after() hooks run in registration order: stop the process before removing its directory.
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { ...wp, url: `http://127.0.0.1:${wp.port}` };
}

const card = name => buildAgentCard({ stableId: name, name, agentType: 'runtime', role: 'test', description: 'test', capabilities: { browser_control: true } });

test('an unconfigured process is DEGRADED_UNSYNCED and not allowed unless the operator opts out', async () => {
  const logs = [];
  const strict = await joinWorkplace({ card: card('a'), env: {}, log: (l, m) => logs.push([l, m]) });
  assert.equal(strict.state, 'DEGRADED_UNSYNCED');
  assert.equal(strict.allowed, false);
  assert.equal(strict.error, 'WORKPLACE_URL_NOT_CONFIGURED');
  assert.match(logs[0][1], /JACO tools stay disabled/);

  const optedOut = await joinWorkplace({ card: card('a'), env: { JACO_WORKPLACE_REQUIRED: '0' }, log: () => {} });
  assert.equal(optedOut.state, 'DEGRADED_UNSYNCED');
  assert.equal(optedOut.allowed, true);
});

test('joinWorkplace reaches READY, heartbeats, degrades when Workplace disappears and ends cleanly', async t => {
  const wp = await startWorkplace(t);
  const env = { JACO_WORKPLACE_URL: wp.url, JACO_WORKPLACE_TOKEN: TRANSPORT };
  const session = await joinWorkplace({ card: card('heartbeat-agent'), env, heartbeatMs: 100, log: () => {} });
  assert.equal(session.state, 'READY');
  assert.equal(session.allowed, true);

  const observer = new JacoWorkplaceClient({ baseUrl: wp.url, token: TRANSPORT });
  const listed = (await observer.agents()).agents.find(a => a.agentId === session.registration.agentId);
  assert.equal(listed.sessions[0].status, 'READY');

  await wp.stop();
  await new Promise(r => setTimeout(r, 400));
  assert.equal(session.state, 'DEGRADED_UNSYNCED');
  assert.equal(session.allowed, false);
  await session.end();
});

test('Nova declares only the surfaces it detected', () => {
  const none = novaAgentCard({ runtime: false, nova: false, browser: false, desktop: false });
  assert.equal(none.capabilities.browser_control, false);
  assert.equal(none.capabilities.desktop_control, false);
  assert.equal(none.capabilities.tools.includes('browser-click'), false);

  const browser = novaAgentCard({ runtime: true, nova: true, browser: true, desktop: false });
  assert.equal(browser.capabilities.browser_control, true);
  assert.equal(browser.capabilities.tools.includes('browser-click'), true);
  assert.equal(browser.capabilities.desktop_control, false);
});

test('SEER registers itself and dispatches only to READY agents with the required capabilities', async t => {
  const wp = await startWorkplace(t);
  const seerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-seer-dispatch-'));
  const seer = await startProcess(t, ['--experimental-sqlite', 'gateway/src/seer.mjs'], {
    SEER_PORT: '0', SEER_STATE_DIR: seerDir, JACO_GATEWAY_TOKEN: SEER_TOKEN,
    JACO_RUNTIME_URL: 'http://127.0.0.1:9', OLLAMA_BASE_URL: 'http://127.0.0.1:9',
    JACO_WORKPLACE_URL: wp.url, JACO_WORKPLACE_TOKEN: TRANSPORT
  }, /JACO SEER(?: Strategic Governor)? :(\d+)/);
  t.after(() => fs.rmSync(seerDir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${seer.port}`;
  const dispatch = async requires => {
    const r = await fetch(`${base}/cortex/dispatch`, { method: 'POST', headers: { authorization: `Bearer ${SEER_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ task: 'open page', requires }) });
    return { status: r.status, body: await r.json() };
  };

  // Wait until SEER reports its own Workplace session.
  const observer = new JacoWorkplaceClient({ baseUrl: wp.url, token: TRANSPORT });
  for (let i = 0; i < 50; i++) {
    const seerAgent = (await observer.agents()).agents.find(a => a.requestedName === 'SEER');
    if (seerAgent?.sessions.some(s => s.status === 'READY')) break;
    await new Promise(r => setTimeout(r, 100));
  }

  const { client: browserAgent } = await bootstrapJacoAgent(card('browser-agent'), { baseUrl: wp.url, token: TRANSPORT });
  const unsynced = new JacoWorkplaceClient({ baseUrl: wp.url, token: TRANSPORT });
  await unsynced.register(card('never-ready'));

  const withBrowser = await dispatch(['browser_control']);
  assert.equal(withBrowser.status, 200);
  assert.deepEqual(withBrowser.body.candidates.map(c => c.agentId), [browserAgent.agentId]);
  assert.equal(withBrowser.body.capabilitiesVerified, false);

  const withDesktop = await dispatch(['desktop_control']);
  assert.equal(withDesktop.body.agent, null);

  await browserAgent.end();
  assert.equal((await dispatch(['browser_control'])).body.candidates.length, 0);

  await wp.stop();
  await seer.stop();
  assert.match(seer.output(), /READY as agent:seer/);
});

test('SEER without Workplace keeps serving but refuses dispatch', async t => {
  const seerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-seer-nowp-'));
  const seer = await startProcess(t, ['--experimental-sqlite', 'gateway/src/seer.mjs'], {
    SEER_PORT: '0', SEER_STATE_DIR: seerDir, JACO_GATEWAY_TOKEN: SEER_TOKEN, JACO_RUNTIME_URL: 'http://127.0.0.1:9'
  }, /JACO SEER(?: Strategic Governor)? :(\d+)/);
  t.after(() => fs.rmSync(seerDir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${seer.port}`;
  const headers = { authorization: `Bearer ${SEER_TOKEN}`, 'content-type': 'application/json' };
  await new Promise(r => setTimeout(r, 200));
  const r = await fetch(`${base}/cortex/dispatch`, { method: 'POST', headers, body: '{}' });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'WORKPLACE_UNSYNCED');
  assert.equal((await fetch(`${base}/cortex/missions`, { headers })).status, 200);
});


test('long-running local agent receives targeted Workplace updates and ACKs them live', async t => {
  const wp = await startWorkplace(t);
  const env = { JACO_WORKPLACE_URL: wp.url, JACO_WORKPLACE_TOKEN: TRANSPORT };
  const received = [];

  const receiver = await joinWorkplace({
    card: buildAgentCard({
      stableId:'desktop-live-sync',
      name:'Desktop Live Sync',
      agentType:'runtime',
      role:'desktop-execution',
      description:'test local Windows agent',
      capabilities:{ windows_system_observation:true },
      tools:['windows-wmi-read']
    }),
    env,
    syncMs:50,
    heartbeatMs:1000,
    onEvents: async events => { received.push(...events); },
    log:()=>{}
  });
  assert.equal(receiver.state,'READY');

  const { client: sender } = await bootstrapJacoAgent(card('control-plane-sender'), { baseUrl:wp.url, token:TRANSPORT });
  const targeted = await sender.post('MESSAGE','refresh local context',{
    thread:'control-plane',
    targets:[receiver.registration.agentId],
    payload:{ schema:'jaco.local-agent-update/v1', revision:2 }
  });

  for(let i=0;i<40 && (!received.some(e=>e.eventId===targeted.eventId) || receiver.client.cursor < targeted.seq || receiver.lastEventSeq < targeted.seq);i++) {
    await new Promise(r=>setTimeout(r,50));
  }

  const event = received.find(e=>e.eventId===targeted.eventId);
  assert.ok(event,'targeted Workplace event was not delivered to local agent');
  assert.equal(event.payload.schema,'jaco.local-agent-update/v1');
  assert.ok(receiver.client.cursor >= targeted.seq);
  assert.ok(receiver.lastEventSeq >= targeted.seq);
  assert.ok(receiver.lastSyncAt);

  await receiver.end();
  await sender.end();
});
