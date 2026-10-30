import { createHash } from 'node:crypto';

const SAFE_STATES = new Set(['ACTIVE','PENDING','QUEUED','READY','PLANNING','EXECUTING','BLOCKED','DONE','CANCELLED','FAILED','CLOSED','RECONCILIATION_REQUIRED']);
const SAFE_TASKS = new Set(['health-check','git-status','repo-list','repo-read','detect-surfaces']);
const SAFE_ID = /^[a-zA-Z0-9._:-]{1,160}$/;

// Public GitHub issues must never contain mission goals, receipt payloads,
// system paths, secrets, or backend errors. Only evidence from the authenticated
// local Core is projected into the allowlisted read-only response.
export async function inspectNovaMissionReceipt(core, goalSha256) {
  if (!/^[a-f0-9]{64}$/.test(String(goalSha256 || ''))) {
    throw new Error('NOVA_RECEIPT_GOAL_HASH_INVALID');
  }
  const notFound = {
    schema: 'jaco.nova-receipt-summary/v1',
    status: 'NOT_FOUND', matched: false, executed: false,
    missionId: null, missionState: 'UNVERIFIED', phase: 'UNVERIFIED',
    receipts: 0, verifiedReceipts: 0, verifiedHealthChecks: 0,
    verifiedTask: 'NONE',
  };
  const data = await core.request('/api/connected/missions?limit=200');
  if (data?.success !== true || !Array.isArray(data.missions)) throw new Error('NOVA_RECEIPT_MISSION_LIST_UNAVAILABLE');
  const candidates = data.missions.filter(m => {
    if (!['git-control','github-control'].includes(m?.source) || m?.metadata?.executor !== 'nova') return false;
    if (typeof m?.goal !== 'string') return false;
    return createHash('sha256').update(m.goal,'utf8').digest('hex') === goalSha256;
  });
  if (candidates.length !== 1) return { ...notFound, status: candidates.length ? 'AMBIGUOUS' : 'NOT_FOUND' };
  const id = candidates[0].id;
  if (typeof id !== 'string' || !SAFE_ID.test(id)) return { ...notFound, status: 'UNVERIFIED' };
  const detail = await core.request('/api/connected/nova/missions/' + encodeURIComponent(id));
  if (detail?.success !== true || detail?.mission?.id !== id) throw new Error('NOVA_RECEIPT_DETAIL_UNAVAILABLE');
  const m = detail.mission;
  const receipts = Array.isArray(m.receipts) ? m.receipts : [];
  const verified = receipts.filter(r => r?.ok === true && r?.verified === true && SAFE_TASKS.has(r?.type));
  const health = verified.filter(r => r.type === 'health-check');
  return {
    schema: 'jaco.nova-receipt-summary/v1',
    status: 'OBSERVED', matched: true,
    executed: verified.length > 0,
    missionId: id,
    missionState: SAFE_STATES.has(m.status) ? m.status : 'UNVERIFIED',
    phase: SAFE_STATES.has(m.phase) ? m.phase : 'UNVERIFIED',
    receipts: Math.min(10000, receipts.length),
    verifiedReceipts: Math.min(10000, verified.length),
    verifiedHealthChecks: Math.min(10000, health.length),
    verifiedTask: verified.length ? verified.at(-1).type : 'NONE',
  };
}

export function safeNovaReceiptLines(r) {
  if (r?.schema !== 'jaco.nova-receipt-summary/v1') return [];
  const id = typeof r.missionId === 'string' && SAFE_ID.test(r.missionId) ? r.missionId : 'NOT_AVAILABLE';
  const state = SAFE_STATES.has(r.missionState) ? r.missionState : 'UNVERIFIED';
  const phase = SAFE_STATES.has(r.phase) ? r.phase : 'UNVERIFIED';
  const task = SAFE_TASKS.has(r.verifiedTask) ? r.verifiedTask : 'NONE';
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 10000 ? n : 0;
  return [
    '#### Nova durable mission (local read-only evidence)',
    '- Match: `' + (r.matched === true ? 'FOUND' : 'NOT_FOUND') + '`',
    '- Mission ID: `' + id + '`',
    '- Mission state: `' + state + '`',
    '- Phase: `' + phase + '`',
    '- Receipts: `' + count(r.receipts) + '`',
    '- Verified receipts: `' + count(r.verifiedReceipts) + '`',
    '- Verified health checks: `' + count(r.verifiedHealthChecks) + '`',
    '- Last allowlisted verified task: `' + task + '`',
    '- Actual execution: `' + (r.executed === true ? 'RECEIPT_VERIFIED' : 'NOT_VERIFIED') + '`',
  ];
}
