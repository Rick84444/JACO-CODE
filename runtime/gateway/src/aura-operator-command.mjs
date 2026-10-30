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

// Aura's ingress is ready when Core answers an authenticated Mission Bus read (/api/runtime/identity is
// public, so it proves nothing about the token) and the loopback SEER planner reports healthy. Any
// error, non-loopback SEER URL or unexpected body counts as not ready.
export async function auraIngressReady(core, {
  seerUrl = process.env.SEER_URL || 'http://127.0.0.1:2997', fetchImpl = globalThis.fetch, timeoutMs = 4000,
} = {}) {
  try {
    const seer = new URL(String(seerUrl));
    if (seer.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(seer.hostname) || seer.username || seer.password) return false;
    const status = await core.request('/api/connected/status');
    if (status?.success !== true) return false;
    const response = await fetchImpl(new URL('/health', seer), { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.service === 'seer';
  } catch {
    return false;
  }
}

export async function submitAuraAcceptance(core) {
  if (typeof core?.request !== 'function') throw new Error('AURA_CORE_REQUIRED');
  const url = new URL(String(core.baseUrl || ''));
  if (url.protocol !== 'http:' ||
      !['127.0.0.1','localhost','[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('AURA_OPERATOR_LOOPBACK_REQUIRED');
  }
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
