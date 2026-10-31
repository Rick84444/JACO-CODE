// The GitHub bridge has no authority to dispatch arbitrary text into the
// executor. New goals originate at Aura's existing, local-only operator route.
// This fixed first command is a bounded operator intent, not a tool grant.
export const AURA_ACCEPTANCE_GOAL = [
  'Aura: assess the real local Windows JACO runtime as a single operator agent.',
  'Observe Core, Workplace, SEER, browser-attachment and the MCP tool catalog.',
  'Distinguish available tools from tools actually executed and record only',
  'authentic evidence. Identify blockers and propose the first useful task.',
  'This acceptance task is observation-only: do not change files, code,',
  'services, accounts, browser tabs, configuration or spend money.',
  'Do not create a parallel Nova operator mission; use canonical Aura/SEER',
  'strategy and existing Mission Bus, leases, policies and receipts.',
].join(' ');

const GOAL_ID = /^[a-zA-Z0-9_.:-]{1,160}$/;
export const AURA_NOT_READY_REASONS = ['CORE_UNREACHABLE', 'CORE_AUTH_REJECTED', 'SEER_UNREACHABLE',
  'SEER_AUTH_REJECTED', 'READINESS_RECEIPT_INVALID', 'READINESS_PROBE_UNAVAILABLE'];

function assertLoopbackCore(core) {
  if (typeof core?.request !== 'function') throw new Error('AURA_CORE_REQUIRED');
  const url = new URL(String(core.baseUrl || ''));
  if (url.protocol !== 'http:' ||
      !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('AURA_OPERATOR_LOOPBACK_REQUIRED');
  }
}

function readinessGap(receipt) {
  if (receipt?.success !== true || receipt?.schema !== 'jaco.aura-readiness/v1') return 'READINESS_RECEIPT_INVALID';
  if (receipt.core?.authenticated !== true) return 'CORE_AUTH_REJECTED';
  if (receipt.seer?.required === false) return null;
  if (receipt.seer?.reachable !== true) return 'SEER_UNREACHABLE';
  if (receipt.seer?.authenticated !== true) return 'SEER_AUTH_REJECTED';
  return null;
}

// At Windows login Sentinel can start before Core or SEER. A goal submitted then
// either fails or lands nowhere, so wait (bounded) until Core accepts an
// operator-authenticated request and SEER accepts Core's bearer token.
// Nothing is created here: a NOT_READY result is safe to retry later.
export async function waitForAuraReadiness(core, {
  timeoutMs = Number(process.env.JACO_AURA_READINESS_TIMEOUT_MS || 90000),
  intervalMs = 3000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
} = {}) {
  assertLoopbackCore(core);
  const deadline = now() + Math.max(0, Number(timeoutMs) || 0);
  let attempts = 0, reason = 'CORE_UNREACHABLE';
  for (;;) {
    attempts++;
    try {
      const receipt = await core.request('/api/aura/workbench/readiness', {
        method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1000, Math.min(5000, deadline - now()))),
      });
      reason = readinessGap(receipt);
      if (!reason) return { ready: true, attempts };
    } catch (error) {
      const message = String(error?.message || error);
      reason = /^JACO_CORE_HTTP_40[13]/.test(message) ? 'CORE_AUTH_REJECTED'
        : /^JACO_CORE_HTTP_404/.test(message) ? 'READINESS_PROBE_UNAVAILABLE'
        : 'CORE_UNREACHABLE';
    }
    if (now() + intervalMs > deadline) return { ready: false, reason, attempts };
    await sleep(intervalMs);
  }
}

export function safeAuraNotReadyLines(value) {
  const reason = AURA_NOT_READY_REASONS.includes(value?.reason) ? value.reason : 'UNVERIFIED';
  return [
    '#### Canonical Aura operator goal',
    '- Readiness: `NOT_READY`',
    '- Blocker: `' + reason + '`',
    '- Goal created: `NO`',
    '',
    'No goal was submitted. The command stays open and is retried once Core and SEER are ready.',
  ];
}

export async function submitAuraAcceptance(core) {
  assertLoopbackCore(core);
  const result = await core.request('/api/aura/workbench/start-goal', {
    method: 'POST',
    redirect: 'error',
    body: JSON.stringify({
      goal: AURA_ACCEPTANCE_GOAL,
      horizon: 'short',
    }),
  });
  if (result?.success !== true || result?.schema !== 'jaco.operator-goal/v1' ||
      typeof result.goal?.id !== 'string' || !GOAL_ID.test(result.goal.id)) {
    throw new Error('AURA_CANONICAL_GOAL_RECEIPT_INVALID');
  }
  return {
    schema: 'jaco.aura-operator-command/v1',
    status: 'ACCEPTED',
    goalId: result.goal.id,
    ingress: 'aura.workbench.start-goal',
    strategy: 'SEER',
    execution: 'NOT_VERIFIED',
  };
}

export function safeAuraAcceptanceLines(value) {
  if (value?.schema !== 'jaco.aura-operator-command/v1') return [];
  const id = typeof value.goalId === 'string' && GOAL_ID.test(value.goalId) ? value.goalId : 'UNVERIFIED';
  const accepted = value.status === 'ACCEPTED' && id !== 'UNVERIFIED';
  return [
    '#### Canonical Aura operator goal',
    '- Aura ingress: `' + (accepted ? 'ACCEPTED' : 'UNVERIFIED') + '`',
    '- Goal ID: `' + id + '`',
    '- Planning capability: `SEER`',
    '- Mission execution: `NOT_VERIFIED`',
    '- Tool receipts: `NOT_VERIFIED`',
    '',
    'Goal acceptance is not proof of dispatch, execution, or completion.',
  ];
}
