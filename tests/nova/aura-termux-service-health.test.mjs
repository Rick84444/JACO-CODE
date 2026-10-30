import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readAuraServiceHealth, serviceUnavailableLabel } from '../../agents/lib/aura-service-health.mjs';
import { cognitiveQuestionToolbox } from '../../runtime/src/server/connected/cognitiveQuestionToolbox.mjs';

const TOKEN = 'test-bridge-token-12345678901234567890';
const answer = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

test('Termux probes authenticate the real Nova bridge and never mistake a 401 for healthy', async () => {
  const called = [];
  const state = await readAuraServiceHealth({
    env: { PREFIX: '/data/data/com.termux/files/usr', JACO_GATEWAY_TOKEN: TOKEN,
      JACO_ENABLE_CDP: '1', JACO_ENABLE_OLLAMA: '0' },
    platform: 'android',
    fetchImpl: async (url, options) => {
      const u = new URL(url);
      called.push({ port: u.port, headers: options.headers });
      if (u.port === '4243') {
        assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
        return answer(200, { service: 'nova-bridge', ok: false });
      }
      if (['4250', '9222', '11434'].includes(u.port)) throw Error('ECONNREFUSED');
      if (u.port === '2996') return answer(200, { ok: true });
      return answer(200);
    },
  });
  assert.equal(state.novaBridge, 'UNHEALTHY (200)');
  assert.equal(state.cdpBridge, 'UNVERIFIED (200)');
  assert.equal(state.chromeCdp, 'NOT_CONNECTED (BROWSER_DEBUG_PORT)');
  assert.equal(state.gateway, 'NOT_SUPERVISED (TERMUX)');
  assert.equal(state.ollama, 'DISABLED (MODEL_POLICY)');
  assert.equal(state.substrate, 'REACHABLE (200)');
  assert.equal(called.length, 7, 'disabled Ollama is not probed');
});

test('401, non-2xx and boolean-negative responses never masquerade as healthy', async () => {
  const state = await readAuraServiceHealth({
    env: { PREFIX: '/data/data/com.termux/files/usr', JACO_ENABLE_CHATGPT_GATEWAY: '1' },
    platform: 'android',
    fetchImpl: async url => {
      const port = new URL(url).port;
      if (port === '4243') return answer(401, { ok: false });
      if (port === '4250') return answer(503, { error: 'unavailable' });
      if (port === '2995') return answer(200, { success: false });
      return answer(200, { status: 'READY' });
    },
  });
  assert.equal(state.novaBridge, 'AUTH_REQUIRED (401)');
  assert.equal(state.gateway, 'UNHEALTHY (503)');
  assert.equal(state.workplace, 'UNHEALTHY (200)');
  assert.equal(state.seer, 'READY (200)');
});

test('configured CDP and Ollama distinguish disabled from unreachable', () => {
  assert.equal(serviceUnavailableLabel('novaBridge', { JACO_ENABLE_CDP: '0' }, 'android'), 'DISABLED (CDP_POLICY)');
  assert.equal(serviceUnavailableLabel('chromeCdp', { JACO_ENABLE_CDP: '0' }, 'android'), 'DISABLED (CDP_POLICY)');
  assert.equal(serviceUnavailableLabel('ollama', { JACO_ENABLE_OLLAMA: '1' }, 'android'), 'DOWN');
  assert.equal(serviceUnavailableLabel('gateway', { JACO_ENABLE_CHATGPT_GATEWAY: '1' }, 'android'), 'DOWN');
  assert.equal(serviceUnavailableLabel('gateway', { PREFIX: '/data/data/com.termux/files/usr' }, 'linux'), 'NOT_SUPERVISED (TERMUX)');
});

test('Aura exposes real read-only runit inspection and makes a clear repair request actionable', () => {
  const server = fs.readFileSync('runtime/server.ts', 'utf8');
  const bridge = fs.readFileSync('agents/lib/aura-seer-chat.mjs', 'utf8');
  assert.match(server, /readAuraServiceHealth\(\{ env: process\.env \}\)/);
  assert.match(server, /termux_services:/);
  assert.match(server, /execFileAsync\('sv', \['status', target\]/);
  assert.doesNotMatch(server.slice(server.indexOf('termux_services:'), server.indexOf('attachment_read:', server.indexOf('termux_services:'))), /'restart'|'up'|'down'/);
  assert.match(bridge, /Be inte användaren att återigen välja/);
  assert.match(bridge, /mission_list/);
  assert.match(bridge, /start_goal/);
});

test('question mode preserves the read-only Termux tool, not mutation authority', async () => {
  const toolbox = cognitiveQuestionToolbox({
    observe: async () => '{}',
    tools: {
      health: { description: 'status', run: async () => 'READY' },
      termux_services: { description: 'read-only', run: async () => [{ name: 'jaco-core', status: 'run' }] },
      start_goal: { description: 'mutation', run: async () => 'MUST_NOT_RUN' },
    },
  }, async () => 'events', 'Varför är novaBridge nere?');
  assert.equal((await toolbox.tools.termux_services.run())[0].name, 'jaco-core');
  assert.equal(toolbox.tools.start_goal, undefined);
});

test('Aura marks CDP READY only with recent WebSocket evidence, never a legacy facade', async () => {
  const verifiedAt = new Date().toISOString();
  const state = await readAuraServiceHealth({
    env: { JACO_ENABLE_CDP:'1', JACO_GATEWAY_TOKEN:TOKEN },
    fetchImpl: async url => {
      const port = new URL(url).port;
      if (port === '4243' || port === '2996') return answer(200,{
        ok:true, state:'READY', browserVerified:true, verificationAgeMs:0, verifiedAt,
      });
      if (port === '9222') return answer(200,{webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/browser/local'});
      return answer(200,{ok:true});
    },
  });
  assert.equal(state.cdpBridge,'READY (200)');
  assert.equal(state.novaBridge,'READY (200)');
  assert.equal(state.chromeCdp,'DISCOVERABLE (200)');
});

test('Aura Lean does not poll deliberately dormant browser adapters', async()=>{
  const visited=[];
  const state=await readAuraServiceHealth({
    env:{JACO_AURA_LEAN:'1',JACO_ENABLE_CDP:'1',JACO_ENABLE_OLLAMA:'0'},
    platform:'android',
    fetchImpl:async url=>{
      visited.push(new URL(url).port);
      throw Error('not listening');
    },
  });
  assert.equal(state.novaBridge,'DISABLED (AURA_LEAN)');
  assert.equal(state.cdpBridge,'DISABLED (AURA_LEAN)');
  assert.equal(state.ollama,'DISABLED (MODEL_POLICY)');
  assert.ok(!visited.includes('4243') && !visited.includes('2996') && !visited.includes('11434'));
});
