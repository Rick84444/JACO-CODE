#!/usr/bin/env node
// End-to-end probe of a live JACO A2A v1.0 endpoint: discovery, auth
// enforcement, one real task, and polling until the task reaches a terminal
// state. Prints an evidence record; the exit code says how far the chain got.
//
//   JACO_A2A_PROBE_TOKEN=... node scripts/a2a-probe.mjs [--url URL] [--text TEXT]
//        [--skill jaco_continuum_task] [--timeout-ms 300000] [--out evidence.json]
//
// The bearer is read from JACO_A2A_PROBE_TOKEN (or JACO_A2A_BEARER), never
// from argv, so it does not land in shell history or process listings.
//
// Exit codes: 0 COMPLETED, 2 FAILED/REJECTED/CANCELED/INPUT_REQUIRED,
// 3 still running at timeout, 4 discovery/auth contract broken, 1 probe error.
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};

const url = String(opt('url', process.env.JACO_A2A_PROBE_URL || 'https://a2a.jacocode.com')).replace(/\/$/, '');
const text = opt('text', 'JACO A2A probe: reply with one short sentence confirming which model handled this task.');
const skill = opt('skill', 'jaco_continuum_task');
const timeoutMs = Number(opt('timeout-ms', 300000));
const out = opt('out', null);
const token = process.env.JACO_A2A_PROBE_TOKEN || process.env.JACO_A2A_BEARER || '';

const TERMINAL = new Set(['TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED']);
const INTERRUPTED = new Set(['TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED']);

const started = Date.now();
const evidence = { schema: 'jaco.a2a-probe/v1', url, startedAt: new Date(started).toISOString(), steps: [] };
const step = (name, data) => {
  const entry = { ...data, name, atMs: Date.now() - started };
  evidence.steps.push(entry);
  console.error(`[a2a-probe] ${String(entry.atMs).padStart(6)}ms ${name} ${JSON.stringify(data)}`);
};

function finish(code, outcome) {
  evidence.outcome = outcome;
  evidence.exitCode = code;
  evidence.durationMs = Date.now() - started;
  const json = JSON.stringify(evidence, null, 2);
  if (out) writeFileSync(out, json + '\n');
  console.log(json);
  process.exit(code);
}

async function http(path, init = {}) {
  const res = await fetch(url + path, { ...init, signal: AbortSignal.timeout(30000) });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch {}
  return { status: res.status, json, body };
}

let rpcId = 0;
async function rpc(method, params, bearer = token) {
  const headers = { 'content-type': 'application/json', 'A2A-Version': '1.0' };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return http('/', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
}

// Only the parts an operator needs to judge the result; artifact text is capped.
function summarizeTask(task) {
  return {
    id: task?.id,
    state: task?.status?.state,
    hubTaskId: task?.metadata?.hubTaskId,
    artifacts: (task?.artifacts || []).map(a => ({
      artifactId: a.artifactId,
      parts: (a.parts || []).map(p => (p.text !== undefined
        ? { text: String(p.text).slice(0, 2000) }
        : { data: JSON.stringify(p.data ?? p).slice(0, 2000) })),
    })),
    statusMessage: (task?.status?.message?.parts || []).map(p => p.text).filter(Boolean).join('\n').slice(0, 2000) || undefined,
  };
}

try {
  if (!token) {
    step('config', { error: 'JACO_A2A_PROBE_TOKEN (or JACO_A2A_BEARER) is not set' });
    finish(1, 'NO_TOKEN');
  }

  const card = await http('/.well-known/agent-card.json');
  const iface = card.json?.supportedInterfaces?.[0];
  const bearer = card.json?.securitySchemes?.jacoBearer?.httpAuthSecurityScheme?.scheme;
  step('discovery', { status: card.status, agent: card.json?.name, version: card.json?.version, protocolVersion: iface?.protocolVersion, binding: iface?.protocolBinding, bearer, skills: (card.json?.skills || []).map(s => s.id) });
  if (card.status !== 200 || iface?.protocolVersion !== '1.0' || bearer !== 'Bearer') finish(4, 'DISCOVERY_CONTRACT_BROKEN');
  if (!(card.json.skills || []).some(s => s.id === skill)) finish(4, `SKILL_NOT_ADVERTISED:${skill}`);

  const health = await http('/health');
  step('health', { status: health.status, evidenceState: health.json?.evidenceState, taskStore: health.json?.taskStore });

  // The endpoint must refuse work without credentials before we trust it with any.
  const anon = await rpc('SendMessage', { message: { messageId: `probe-anon-${randomUUID()}`, role: 'ROLE_USER', parts: [{ text: 'anon' }] } }, null);
  step('auth-required', { status: anon.status });
  if (anon.status !== 401) finish(4, 'UNAUTHENTICATED_REQUEST_NOT_REJECTED');

  const messageId = `probe-${randomUUID()}`;
  const sent = await rpc('SendMessage', {
    message: { messageId, role: 'ROLE_USER', parts: [{ text }] },
    configuration: { returnImmediately: true },
    metadata: { skillId: skill },
  });
  if (sent.status === 401) { step('send', { status: 401 }); finish(4, 'TOKEN_REJECTED'); }
  if (sent.json?.error) { step('send', { status: sent.status, error: sent.json.error }); finish(1, 'SEND_ERROR'); }
  let task = sent.json?.result?.task;
  step('send', { status: sent.status, messageId, ...summarizeTask(task) });
  if (!task?.id) finish(1, 'NO_TASK_RETURNED');

  let lastState = task.status?.state;
  let delay = 1000;
  while (!TERMINAL.has(lastState) && !INTERRUPTED.has(lastState)) {
    if (Date.now() - started > timeoutMs) {
      evidence.task = summarizeTask(task);
      finish(3, `TIMEOUT_IN_${lastState}`);
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 10000);
    const got = await rpc('GetTask', { id: task.id });
    if (got.json?.error) { step('poll', { error: got.json.error }); finish(1, 'POLL_ERROR'); }
    task = got.json?.result;
    if (task?.status?.state !== lastState) {
      lastState = task?.status?.state;
      step('state', { state: lastState });
    }
  }

  evidence.task = summarizeTask(task);
  finish(lastState === 'TASK_STATE_COMPLETED' ? 0 : 2, lastState);
} catch (error) {
  step('error', { message: String(error?.message || error) });
  finish(1, 'PROBE_ERROR');
}
