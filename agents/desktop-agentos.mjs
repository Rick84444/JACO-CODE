#!/usr/bin/env node
/**
 * JACO Desktop AgentOS executor.
 *
 * Architecture:
 *   SEER -> durable Nova mission lease -> this executor -> ModelRelay
 *        -> DesktopHandsOffClient -> Windows UI Automation -> verified receipt.
 *
 * This process is an executor, not a second planner authority or control plane.
 * SEER remains the sole planner. ModelRelay remains the sole mutation gateway.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MissionClient, processMissionTurn } from './lib/mission-client.mjs';
import { seerCompletion } from './lib/seer-client.mjs';
import { loadState, executeTask as legacyExecuteTask } from './hands-off-agent.mjs';
import { buildAgentCard, joinWorkplace } from './lib/workplace-session.mjs';
import { windowsWmiRead } from './lib/windows-wmi-read.mjs';
import { CODE_TASKS } from './lib/coding-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RUNTIME_URL = (process.env.JACO_RUNTIME_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const TOKEN = process.env.JACO_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '';
const OWNER = process.env.JACO_AGENTOS_OWNER || `desktop-agentos-${os.hostname()}-${process.pid}`;
const POLL_MS = Math.max(500, Math.min(Number(process.env.JACO_AGENTOS_POLL_MS || 1500), 30_000));
const ALLOW_COORDINATE_FALLBACK = process.env.JACO_ALLOW_COORDINATE_FALLBACK === '1';
const ALLOW_SHELL = process.env.JACO_ALLOW_SHELL_TASKS === '1';
const STATE_DIR = process.env.JACO_AGENTOS_STATE_DIR || path.join(ROOT, '.jaco', 'state', 'desktop-agentos');
const LOCK_FILE = path.join(STATE_DIR, 'executor.lock.json');

const COORDINATE_TASKS = new Set(['mouse-move', 'mouse-click', 'mouse-scroll', 'key-press', 'type-text']);
const LOCAL_SUPPORTED = new Set([
  ...CODE_TASKS,
  'detect-surfaces', 'health-check', 'check-revenue',
  'browser-survey-site', 'browser-click', 'browser-type',
  'desktop-windows', 'desktop-observe', 'desktop-action', 'desktop-invoke', 'windows-wmi-read',
  'screenshot', 'mouse-move', 'mouse-click', 'mouse-scroll',
  'key-press', 'type-text', 'get-cursor', 'shell',
  'invoke-worker', 'promote-hf',
]);

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function now() { return new Date().toISOString(); }

function acquireExecutorLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const previous = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (Number.isInteger(previous.pid) && previous.pid > 0) {
        try {
          process.kill(previous.pid, 0);
          throw new Error(`AGENTOS_ALREADY_RUNNING:${previous.pid}`);
        } catch (error) {
          if (String(error?.message || '').startsWith('AGENTOS_ALREADY_RUNNING:')) throw error;
        }
      }
    } catch (error) {
      if (String(error?.message || '').startsWith('AGENTOS_ALREADY_RUNNING:')) throw error;
    }
  }
  const tmp = `${LOCK_FILE}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, owner: OWNER, startedAt: now() }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, LOCK_FILE);
}

function releaseExecutorLock() {
  try {
    const current = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    if (current.pid === process.pid) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

async function requestRuntime(method, route, body, { mutation = false, timeoutMs = 20_000 } = {}) {
  const headers = { 'content-type': 'application/json', 'x-gateway-token': TOKEN };
  try {
    const response = await fetch(`${RUNTIME_URL}${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { raw: text.slice(0, 4000) }; }
    if (response.ok && payload?.success !== false) return payload;
    const error = typeof payload?.error === 'string' ? payload.error : `RUNTIME_HTTP_${response.status}`;
    return {
      ...payload,
      success: false,
      ok: false,
      error,
      outcomeUnknown: Boolean(mutation && !payload?.receipt && response.status >= 500),
      httpStatus: response.status,
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      outcomeUnknown: mutation,
      transportError: true,
    };
  }
}

async function requireRuntime(method, route, body, options) {
  const result = await requestRuntime(method, route, body, options);
  if (result?.success === false || result?.ok === false) throw new Error(result?.error || 'RUNTIME_REQUEST_FAILED');
  return result;
}

async function observeEnvironment() {
  const probes = await Promise.allSettled([
    requireRuntime('GET', '/api/runtime/identity'),
    requireRuntime('GET', '/api/desktop/hands-off/status'),
    requireRuntime('GET', '/api/relay/status'),
    requireRuntime('GET', '/api/browser/hands-off/status'),
  ]);
  const value = index => probes[index].status === 'fulfilled'
    ? probes[index].value
    : { available: false, error: probes[index].reason instanceof Error ? probes[index].reason.message : String(probes[index].reason) };
  return {
    observedAt: now(),
    runtime: value(0),
    desktop: value(1),
    relay: value(2),
    browser: value(3),
  };
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
  throw new Error('SEER_PLAN_NOT_JSON');
}

export function plannerAllowedTasks(mission) {
  let tasks = (mission.allowedTasks || []).filter(task => LOCAL_SUPPORTED.has(task));
  if (!mission.contract) tasks = tasks.filter(task => !CODE_TASKS.has(task));
  if (!ALLOW_COORDINATE_FALLBACK) tasks = tasks.filter(task => !COORDINATE_TASKS.has(task));
  if (!ALLOW_SHELL) tasks = tasks.filter(task => task !== 'shell');
  if (process.platform !== 'win32') tasks = tasks.filter(task => task !== 'windows-wmi-read');
  return tasks;
}

function compact(value, max = 24_000) {
  const text = JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}...<truncated>`;
}

async function planMission({ mission, observation }) {
  const allowed = plannerAllowedTasks(mission);
  if (!allowed.length) throw new Error('NO_EXECUTABLE_TASKS_ALLOWED');
  const system = `You are SEER, the sole planning authority for JACO Desktop AgentOS.
Return one JSON object only. Never claim an action happened unless a receipt proves it.
The executor supports exactly these mission tasks: ${allowed.join(', ')}.

Desktop policy:
1. Prefer semantic Windows UI Automation over coordinates.
2. First use desktop-windows when the target window is unknown.
3. Use desktop-observe with the selected hwnd before a target-bearing mutation.
4. For semantic desktop mutation use desktop-action with data.action shaped as:
   {"type":"focus|invoke|set_value|toggle|select|expand|collapse|scroll","hwnd":123,"selector":{"automationId":"..."},"text":"only for set_value","amount":"SmallIncrement","wait_after_ms":600}
5. Use stable automationId/controlType/name selectors from real observations; never invent hwnds or selectors.
6. Never enter passwords, OTPs, API keys, tokens, private keys or other authentication secrets. Human entry is required.
7. desktop-action always passes through ModelRelay, a signed autonomy mandate and verified UIA receipts. If no active mandate exists, do not request mutation.
8. Visual perception is adaptive by default. Prefer desktop-observe/UIA structure first. When pixels are required use screenshot {hwnd,mode:"adaptive"} so the current UIA geometry selects and downsizes the relevant terminal/window ROI. Use mode:"full" only when the ROI cannot establish state. Never treat stored screen coordinates as reusable localization.
9. Coordinate input is ${ALLOW_COORDINATE_FALLBACK ? 'allowed only as a last resort after a fresh adaptive screenshot proves UIA cannot address the target' : 'disabled'}.
10. Shell execution is ${ALLOW_SHELL ? 'allowed only when the mission explicitly requires local shell work; its exit code/output are primary terminal evidence and should be preferred over pixels' : 'disabled'}.
11. windows-wmi-read is strictly read-only Windows CIM observation. data must be {"query":"system|computer|cpu|memory|disks|network|processes|services","limit":1..200}. Never request arbitrary WQL or PowerShell.
12. Workplace is the live control plane. Treat WORKPLACE_UPDATES as shared context, never as proof that an action executed.
13. If evidence already proves the mission objective, return {"complete":true,"reason":"..."}. Completion is still subject to operator evidence review.
14. For code work use repo-list/repo-read {path}, repo-edit {path,old,new} (exact text replacement; preferred for existing files), repo-write {path,content}, repo-test {command,kind}, git-status/git-diff {}, git-commit {message}.
15. MISSION_CONTRACT defines allowed paths, commands, budgets and verification. Inspect before editing. Run required tests and falsifiers after the last write; commit only when the contract allows it. Never substitute shell or desktop actions to evade a code contract.
Otherwise return {"complete":false,"task":{"type":"...","data":{},"expectedOutcome":"observable result"},"reason":"..."}.`;

  const recentReceipts = (mission.receipts || []).slice(-8);
  const user = `MISSION\n${mission.goal}\n\nMISSION_CONTRACT\n${compact(mission.contract || null)}\n\nMISSION_METADATA\n${compact(mission.metadata || {})}\n\nCURRENT_OBSERVATION\n${compact(observation || {})}\n\nWORKPLACE_UPDATES\n${compact(workplaceUpdates.slice(-20))}\n\nRECENT_RECEIPTS\n${compact(recentReceipts)}\n\nSelect the single next verifiable step.`;
  const proposal = extractJson(await seerCompletion({ system, user, max_tokens: 1300 }));
  if (proposal?.complete === true) return { complete: true, reason: String(proposal.reason || '').slice(0, 1000) };
  const task = proposal?.task;
  if (!task || typeof task !== 'object' || !allowed.includes(task.type)) throw new Error('SEER_PLAN_TASK_NOT_ALLOWED');
  return { task: { ...task, expectedOutcome: String(task.expectedOutcome || '').slice(0, 2000) } };
}

async function resolveMandateId(mission) {
  const relay = await requireRuntime('GET', '/api/relay/status');
  const active = Array.isArray(relay.activeMandates) ? relay.activeMandates : [];
  const requested = String(mission?.metadata?.mandateId || process.env.JACO_AUTONOMY_MANDATE_ID || '').trim();
  if (requested) {
    if (!active.some(item => item.id === requested)) throw new Error(`AUTONOMY_MANDATE_NOT_ACTIVE:${requested}`);
    return requested;
  }
  if (active.length === 1) return active[0].id;
  if (active.length === 0) throw new Error('ACTIVE_SIGNED_AUTONOMY_MANDATE_REQUIRED');
  throw new Error('AUTONOMY_MANDATE_AMBIGUOUS');
}

async function executeDesktopAction(task) {
  const mission = await missionClient.current();
  if (!mission || mission.id !== task.missionId) return { ok: false, error: 'MISSION_CONTEXT_CHANGED', outcomeUnknown: false };
  const action = task.type === 'desktop-invoke'
    ? { type: 'invoke', hwnd: task.data.hwnd, selector: task.data.selector }
    : task.data.action;

  let mandateId;
  try { mandateId = await resolveMandateId(mission); }
  catch (error) { return { ok: false, error: error.message, outcomeUnknown: false }; }

  const result = await requestRuntime('POST', '/api/relay/action', {
    surface: 'DESKTOP',
    modelId: OWNER,
    missionId: mission.id,
    mandateId,
    action,
  }, { mutation: true, timeoutMs: 35_000 });

  if (result?.success === true && result?.receipt?.verified === true) {
    return { ok: true, verified: true, receipt: result.receipt, relay: { consequence: result.consequence, lease: result.lease } };
  }
  return {
    ok: false,
    verified: false,
    error: result?.error || result?.receipt?.refusal || result?.receipt?.error || 'DESKTOP_ACTION_UNVERIFIED',
    receipt: result?.receipt,
    outcomeUnknown: Boolean(result?.outcomeUnknown),
    httpStatus: result?.httpStatus,
  };
}

export async function executeTask(task, mission) {
  if (task.type === 'desktop-windows') {
    const result = await requestRuntime('GET', '/api/desktop/hands-off/windows');
    return result?.success === false ? result : { ok: true, verified: true, ...result };
  }
  if (task.type === 'desktop-observe') {
    const result = await requestRuntime('POST', '/api/desktop/hands-off/observe', task.data?.hwnd ? { hwnd: task.data.hwnd } : {});
    return result?.success === false ? result : { ok: true, verified: true, ...result };
  }
  if (task.type === 'desktop-action' || task.type === 'desktop-invoke') return executeDesktopAction(task);
  if (task.type === 'windows-wmi-read') return windowsWmiRead(task.data || {});
  return legacyExecuteTask(task, legacyState, mission);
}

// Own missions only while Nova runs; JACO_DESKTOP_TAKES_ALL=1 makes Desktop AgentOS the sole executor for every mission.
const TAKES_ALL = process.env.JACO_DESKTOP_TAKES_ALL === '1';
const missionClient = new MissionClient(RUNTIME_URL, TOKEN, globalThis.fetch, TAKES_ALL ? null : 'desktop-agentos');
const legacyState = loadState();
let stopping = false;
let workplace = null;

const workplaceUpdates = [];

function recordWorkplaceEvents(events = []) {
  for (const event of events) {
    if (!['DECISION','MISSION','HANDOFF','RESULT','ERROR','WARNING','FINDING','MESSAGE'].includes(event.kind)) continue;
    workplaceUpdates.push({
      seq: event.seq,
      kind: event.kind,
      thread: event.thread,
      sender: event.sender?.agentId || null,
      body: String(event.body || '').slice(0, 2000),
      payload: event.payload || {},
      missionId: event.missionId || null,
      createdAt: event.createdAt,
    });
  }
  if (workplaceUpdates.length > 100) workplaceUpdates.splice(0, workplaceUpdates.length - 100);
  if (events.length) console.log(`[AGENTOS] [workplace] live sync events=${events.length} cursor=${events.at(-1)?.seq || 'n/a'}`);
}

async function publishWmiEvidence(receipt, task, mission) {
  if (!workplace?.allowed || receipt?.result?.schema !== 'jaco.windows-wmi-read/v1') return;
  const evidence = {
    schema: 'jaco.windows-wmi-read/v1',
    query: receipt.result.query,
    count: receipt.result.count,
    observedAt: receipt.result.observedAt,
    host: receipt.result.host,
    source: receipt.result.source,
    verified: receipt.verified === true,
  };
  await workplace.client.post('RESULT', `Windows WMI observation: ${receipt.result.query}`, {
    thread: 'windows-observation',
    missionId: mission?.id || task?.missionId || null,
    eventId: task?.id ? `wmi-result:${task.id}` : undefined,
    payload: { status: receipt.verified ? 'DONE' : 'UNVERIFIED', evidence },
    references: task?.id ? { actionId: task.id } : {},
  }).catch(error => console.error(`[AGENTOS] [workplace] WMI evidence publish failed: ${error.message}`));
}

async function preflight() {
  if (TOKEN.length < 24) throw new Error('JACO_GATEWAY_TOKEN_REQUIRED_MIN_24');
  const identity = await requireRuntime('GET', '/api/runtime/identity');
  const desktop = await requireRuntime('GET', '/api/desktop/hands-off/status');
  if (desktop?.status?.supported !== true) throw new Error(`DESKTOP_UIA_UNAVAILABLE:${desktop?.status?.evidenceState || 'UNKNOWN'}`);
  if (desktop?.status?.evidenceState !== 'OBSERVED') throw new Error(`DESKTOP_UIA_NOT_OBSERVED:${desktop?.status?.evidenceState || 'UNKNOWN'}`);
  const relay = await requireRuntime('GET', '/api/relay/status');
  // Fail closed like the former start-all.ps1 gate: two writers through ModelRelay could act twice.
  if (relay?.singleWriter !== true) throw new Error('MODELRELAY_SINGLE_WRITER_UNAVAILABLE');
  return { identity, desktop: desktop.status, relay };
}

export async function runTurn() {
  return processMissionTurn({
    client: missionClient,
    owner: OWNER,
    acceptMission: mission => TAKES_ALL || mission?.metadata?.executor === 'desktop-agentos',
    plan: planMission,
    observe: observeEnvironment,
    execute: executeTask,
    onReceipt: (receipt, task, mission) => {
      const state = receipt?.verified ? 'VERIFIED' : receipt?.outcomeUnknown ? 'OUTCOME_UNKNOWN' : 'REJECTED';
      console.log(`[AGENTOS] receipt ${state}${receipt?.error ? ` error=${receipt.error}` : ''}`);
      if (receipt?.result?.schema === 'jaco.windows-wmi-read/v1') void publishWmiEvidence(receipt, task, mission);
    },
  });
}

export function desktopAgentCard(status = { desktop: { evidenceState: 'UNKNOWN' } }, platform = process.platform) {
  const windows = platform === 'win32';
  return buildAgentCard({
    stableId: 'desktop-agentos',
    name: 'Desktop AgentOS',
    agentType: 'runtime',
    role: 'desktop-execution',
    description: 'Local Windows execution agent synchronized through Workplace; performs verified UI Automation mutations and bounded read-only WMI/CIM observation.',
    capabilities: {
      desktop_control: true,
      windows_system_observation: windows,
      browser_control: false,
      terminal: ALLOW_SHELL,
      reasoning: false,
      filesystem_read: true,
      filesystem_write: true,
      code_edit: true,
      testing: true,
    },
    tools: [
      ...CODE_TASKS,
      'desktop-windows', 'desktop-observe', 'desktop-action', 'desktop-invoke',
      ...(windows ? ['windows-wmi-read'] : []),
    ],
    constraints: [
      'Repository changes, tests and commits require a mission-bound coding contract; no git push capability',
      `UIA evidence at startup: ${status.desktop?.evidenceState || 'UNKNOWN'}`,
      'windows-wmi-read is read-only and limited to fixed CIM profiles; arbitrary WQL/PowerShell is not exposed',
      'Mutations require an active signed autonomy mandate and pass ModelRelay single-writer lease',
      `coordinate fallback ${ALLOW_COORDINATE_FALLBACK ? 'enabled' : 'disabled'}, shell ${ALLOW_SHELL ? 'enabled' : 'disabled'}`,
    ],
    preferredTasks: ['Windows system observation', 'desktop application control', 'IDE operation through UI Automation'],
  });
}

export async function main() {
  acquireExecutorLock();
  try {
    const status = await preflight();
    console.log(`[AGENTOS] [REAL] executor=${OWNER}`);
    console.log(`[AGENTOS] [REAL] runtime=${RUNTIME_URL}`);
    console.log(`[AGENTOS] [REAL] desktop=${status.desktop.evidenceState} actuation=${status.desktop.actuation}`);
    console.log(`[AGENTOS] [REAL] singleWriter=${status.relay.singleWriter === true}`);
    console.log(`[AGENTOS] [REAL] coordinateFallback=${ALLOW_COORDINATE_FALLBACK} shell=${ALLOW_SHELL}`);

    // Same rule as every JACO executor: no READY Workplace session, no tool use.
    workplace = await joinWorkplace({
      card: desktopAgentCard(status),
      onEvents: async events => recordWorkplaceEvents(events),
      log: (level, msg) => console.log(`[AGENTOS] [workplace] ${level.toUpperCase()} ${msg}`),
    });
    if (!workplace.allowed) throw new Error(`WORKPLACE_NOT_READY:${workplace.error}`);

    while (!stopping) {
      if (!workplace.allowed) { console.error(`[AGENTOS] paused: Workplace session ${workplace.state}`); await sleep(POLL_MS); continue; }
      try {
        const result = await runTurn();
        if (result?.executed) console.log(`[AGENTOS] mission=${result.mission?.id || 'unknown'} turn executed`);
      } catch (error) {
        console.error(`[AGENTOS] turn error: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!stopping) await sleep(POLL_MS);
    }
  } finally {
    await workplace?.end?.();
    releaseExecutorLock();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`[AGENTOS] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
