// Opt-in verification against an already running local llama.cpp server.
// No downloads, paid providers, Git mutation, or operator project changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = relative => import(pathToFileURL(path.join(repo, relative)).href);
const modelUrl = new URL(process.env.JACO_LIVE_MODEL_URL || 'http://127.0.0.1:9380/v1');
if (modelUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(modelUrl.hostname)
    || modelUrl.username || modelUrl.password) throw Error('LOOPBACK_MODEL_URL_REQUIRED');
const profile=process.env.NOVA_CONTEXT_PROFILE||'compact';
if(!['compact','standard'].includes(profile))throw Error('CONTEXT_PROFILE_INVALID');
const context = Number(process.env.JACO_LIVE_MODEL_CTX || 16384);
if (!Number.isInteger(context) || context < 8192 || context > 131072) throw Error('MODEL_CONTEXT_INVALID');

// The fixture must not inherit operator model keys or project choices.
const retained = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy',
  'all_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
for (const key of Object.keys(process.env)) if (!retained.has(key)) delete process.env[key];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-live-proof-'));
Object.assign(process.env, {
  NOVA_CONTEXT_PROFILE: profile,
  DOTENV_CONFIG_PATH: path.join(root, 'absent.env'),
  JACO_WORKSPACE_ROOT: root, NOVA_STATE_DIR: path.join(root, 'nova'),
  JACO_RUNTIME_DIR: path.join(root, 'runtime'), JACO_ALLOW_PAID_MODELS: '0',
  JACO_SEER_PROVIDER_PREFERENCE: 'llamacpp', JACO_MODEL_PROVIDER: 'llamacpp',
  JACO_LLAMACPP_URL: modelUrl.href.replace(/\/$/, ''), JACO_LLAMACPP_CTX: String(context),
  SEER_STATE_DIR: path.join(root, 'seer'), SEER_PORT: '0',
  SEER_GOVERNOR_INTERVAL_MS: '0', SEER_AUTONOMY_LOOP_MS: '0',
  JACO_GATEWAY_TOKEN: randomBytes(24).toString('hex'),
  JACO_WORKPLACE_URL: 'http://127.0.0.1:9', JACO_RUNTIME_URL: 'http://127.0.0.1:9',
});
fs.mkdirSync(path.join(root, 'src'));
fs.writeFileSync(path.join(root, 'src/add.mjs'), 'export const add = (a, b) => a - b;\n');
const check = "import assert from 'node:assert/strict'; import {add} from './src/add.mjs'; assert.equal(add(2,3),5); assert.equal(add(-2,3),1);\n";
fs.writeFileSync(path.join(root, 'check.mjs'), check);
const baseline = spawnSync(process.execPath, ['check.mjs'], { cwd: root, encoding: 'utf8', timeout: 10000 });
if (baseline.status !== 1 || baseline.error) {
  fs.rmSync(root, { recursive: true, force: true });
  throw Error('BROKEN_FIXTURE_NOT_REPRODUCED');
}
console.log('BASELINE expected failing addition test reproduced');

const server = spawn(process.execPath, ['gateway/src/seer-start.mjs'], {
  cwd: repo, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', startError = null, bus;
server.on('error', error => { startError = error; });
server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-16000); });
try {
  for (let i = 0; i < 100 && !logs.match(/JACO_SEER_LISTENING port=(\d+)/); i++) {
    if (startError || server.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const port = logs.match(/JACO_SEER_LISTENING port=(\d+)/)?.[1];
  if (!port || startError) throw Error('SEER_START_FAILED');
  process.env.SEER_URL = `http://127.0.0.1:${port}`;
  const health = await (await fetch(process.env.SEER_URL + '/health', { signal: AbortSignal.timeout(5000) })).json();
  if (health.local_model?.provider !== 'llamacpp') throw Error('LOCAL_MODEL_NOT_DISCOVERED');
  console.log('MODEL', JSON.stringify(health.local_model));

  const { DurableMissionBus } = await load('runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await load('runtime/src/server/connected/novaMissionControl.mjs');
  const { processMissionTurn } = await load('agents/lib/mission-client.mjs');
  const { callBrain, executeTask } = await load('agents/hands-off-agent.mjs');
  bus = new DurableMissionBus(path.join(root, 'bus'));
  const allowedTasks = ['repo-read', 'repo-edit', 'repo-test'];
  const control = new NovaMissionControl(bus, { allowedTasks });
  const mission = control.create({
    idempotencyKey: 'local-live-proof', allowedTasks,
    goal: 'Fix add(a,b) in src/add.mjs so it adds numbers rather than subtracting. Read the file, make the smallest edit, run node check.mjs, then complete with observed evidence.',
    contract: {
      objective: 'Correct addition', scope: { allowed: ['src/add.mjs'] },
      acceptance: ['Addition works for positive and negative numbers'],
      verification: { commands: ['node check.mjs'], tests_required: true, falsifier_required: false },
      budget: { max_steps: 8, max_tool_calls: 8, max_duration_ms: 600000 },
    },
  });
  const client = Object.fromEntries(['claim', 'begin', 'finish', 'release'].map(name => [
    name, async (...args) => control[name](...args),
  ]));
  client.current = async () => control.get(mission.id);
  for (let i = 0; i < 8 && control.get(mission.id).status === 'ACTIVE'; i++) {
    const turn = await processMissionTurn({
      client, owner: 'local-proof',
      plan: async input => {
        const state={surfaces:{},errors:[]};
        try {
          const proposal=await callBrain(state,input);
          console.log('PLAN',JSON.stringify(proposal));
          return proposal;
        } finally { console.log('PLANNER_METRIC',JSON.stringify(state.plannerMetrics?.at(-1)||null)); }
      },
      execute: (task, assigned) => executeTask(task, { agentId: 'local-proof' }, assigned),
    });
    console.log('TURN', i + 1, JSON.stringify({
      executed: turn.executed, verified: turn.receipt?.verified, error: turn.receipt?.error,
      awaitingVerification: turn.awaitingVerification, blocked: turn.blocked,
    }));
  }
  const result = control.get(mission.id);
  console.log('RESULT', JSON.stringify({
    status: result.status, contractStatus: result.contractStatus,
    receipts: result.receipts.map(({ type, ok, verified, error }) => ({ type, ok, verified, error })),
  }));
  if (!result.contractStatus?.machineVerified || result.status !== 'AWAITING_VERIFICATION'
      || !['repo-read', 'repo-edit', 'repo-test'].every(type => result.receipts.some(r => r.type === type && r.ok && r.verified))) {
    throw Error('LIVE_MISSION_NOT_VERIFIED');
  }
  if (fs.readFileSync(path.join(root, 'check.mjs'), 'utf8') !== check) throw Error('TEST_FIXTURE_CHANGED');
  execFileSync(process.execPath, ['check.mjs'], { cwd: root, timeout: 10000 });
  bus.close();
  bus = new DurableMissionBus(path.join(root, 'bus'));
  if (new NovaMissionControl(bus).get(mission.id).receipts.length !== result.receipts.length) throw Error('RECEIPTS_NOT_DURABLE');
  console.log('PASS real local model -> SEER -> Nova -> edit -> tests -> durable receipts');
} finally {
  bus?.close();
  if (server.exitCode === null && !startError) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    const timeout = setTimeout(() => server.kill('SIGKILL'), 5000);
    timeout.unref();
    await stopped;
    clearTimeout(timeout);
  }
  fs.rmSync(root, { recursive: true, force: true });
}
