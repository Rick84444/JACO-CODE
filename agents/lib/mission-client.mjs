import { createHash } from 'node:crypto';
import { executionExceptionResult } from './replay-semantics.mjs';
import { classifyEffectEvidence } from './effect-evidence.mjs';

export class MissionClient {
  // device: true for a Nova on a joined device; baseUrl is then the hub's public URL and token the
  // device key (gateway /v1/device/*, runtime src/server/connected/deviceAccess.mjs).
  constructor(baseUrl, token = '', fetchImpl = globalThis.fetch, executor = null, { device = false } = {}) {
    this.executor = executor;
    this.device = device;
    this.base = baseUrl.replace(/\/$/, '') + (device ? '/v1/device' : '/api/connected/nova');
    this.token = token;
    this.fetch = fetchImpl;
  }
  async request(method, path, body) {
    const auth = !this.token ? {} : this.device ? { authorization: `Bearer ${this.token}` } : { 'x-gateway-token': this.token };
    const response = await this.fetch(this.base + path, {
      method, headers: { 'content-type': 'application/json', ...auth },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) throw new Error(typeof data.error === 'string' ? data.error : `MISSION_HTTP_${response.status}`);
    return data;
  }
  async create(input) { return (await this.request('POST', '/missions', input)).mission; }
  async get(id) { return (await this.request('GET', `/missions/${encodeURIComponent(id)}`)).mission; }
  async current() { return (await this.request('GET', this.executor ? `/current?executor=${encodeURIComponent(this.executor)}` : '/current')).mission; }
  claim(id, owner) { return this.request('POST', `/missions/${encodeURIComponent(id)}/claim`, { owner, ...(this.executor ? { executor: this.executor } : {}) }); }
  preflight(id,input) { return this.request('POST', `/missions/${encodeURIComponent(id)}/preflight`,input); }
  async begin(id, input) { return (await this.request('POST', `/missions/${encodeURIComponent(id)}/begin`, input)).task; }
  async finish(id, input) { return (await this.request('POST', `/missions/${encodeURIComponent(id)}/finish`, input)).mission; }
  release(id, input) { return this.request('POST', `/missions/${encodeURIComponent(id)}/release`, input); }
  async resolve(id, input) { return (await this.request('POST', `/missions/${encodeURIComponent(id)}/resolve`, input)).mission; }
}

const READ_ONLY = new Set(['health-check', 'check-revenue', 'detect-surfaces', 'browser-survey-site', 'desktop-windows', 'desktop-observe', 'android-status', 'android-observe', 'android-begin', 'android-target', 'windows-wmi-read', 'screenshot', 'get-cursor', 'repo-list', 'repo-read', 'git-status', 'git-diff']);

// Receipts are persisted (last 40) and sent to the planner every turn. A full page observation is
// ~40 elements; storing it twice per receipt made the planner prompt hundreds of kB.
export function observationFingerprint(observation) {
  if (!observation || typeof observation !== 'object') return observation ?? null;
  return { at: observation.at || null, url: observation.url || null, title: observation.title || null,
    targets: Array.isArray(observation.targets) ? observation.targets.length : undefined,
    textChars: typeof observation.text === 'string' ? observation.text.length : undefined };
}

export function checkedReceipt(task, result, before = null, after = null) {
  before = observationFingerprint(before);
  after = observationFingerprint(after);
  const error = result?.error || result?.receipt?.error || result?.refusal || result?.receipt?.refusal;
  const rejected = result?.ok === false || result?.success === false || result?.receipt?.success === false || Boolean(error);
  const acknowledged = result?.ok === true || result?.success === true || result?.receipt?.verified === true;
  const ok = !rejected && acknowledged;
  const verified = ok && (READ_ONLY.has(task.type) || result?.verified === true || result?.receipt?.verified === true);
  const receipt = { ok, verified, before, after, result: result ?? null,
    error: rejected ? (typeof error === 'string' ? error : JSON.stringify(error || 'TOOL_REJECTED')) : !acknowledged ? 'TOOL_RESULT_UNACKNOWLEDGED' : null,
    outcomeUnknown: Boolean(result?.outcomeUnknown) || (ok && !verified),
  };
  // Computed from canonical task/result, never from a model-supplied evidence level.
  return { ...receipt, effectEvidence: classifyEffectEvidence(task.type, receipt) };
}

// Exact fingerprint of an action's arguments, stored on each receipt next to the bounded display
// copy (compactTaskInput) so the very same mutation is recognised even when its arguments are long.
const stableJson = value => JSON.stringify(value ?? null, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export function hashTaskInput(data) { return createHash('sha256').update(stableJson(data)).digest('hex'); }
const sameView = (a, b) => { const strip = o => o && typeof o === 'object' ? { ...o, at: null } : o ?? null; return stableJson(strip(a)) === stableJson(strip(b)); };

// A planner proposing exactly the mutation whose verified receipt is the latest, while the observed
// state is unchanged since that receipt, has nothing new to do: re-running it repeats a side effect
// forever. Read-only tasks may repeat (polling); a changed view (e.g. the next wizard page) may too.
export function repeatsVerifiedAction(mission, next, before) {
  const last = (mission.receipts || []).at(-1);
  if (!next || READ_ONLY.has(next.type) || !last?.ok || !last.verified || last.type !== next.type || !last.inputHash) return false;
  return last.inputHash === hashTaskInput(next.data) && sameView(last.before, observationFingerprint(before));
}

// No external side effects on import. Dependencies are injected for offline tests.
export async function processMissionTurn(options) {
  try { return await runMissionTurn(options); }
  finally { if (options.onActivity) await options.onActivity({ phase: 'READY', missionId: null }); }
}

async function runMissionTurn({ client, owner, plan, execute, observe = async () => null, onReceipt = () => {}, acceptMission = null, onActivity = async () => {} }) {
  const current = await client.current();
  if (!current || current.status !== 'ACTIVE') return { executed: false, mission: current };
  if (typeof acceptMission === 'function' && !(await acceptMission(current))) return { executed: false, mission: current, skipped: 'executor_mismatch' };
  const { mission, token } = await client.claim(current.id, owner);
  const lease = { owner, token };
  await onActivity({ phase: 'PLANNING', missionId: mission.id });
  let task;
  let planned = [];
  let before = null;
  try {
    before = await observe(mission).catch(() => null);
    const proposal = await plan({ mission, observation: before || mission.observation, lease });
    if (proposal?.replan === true) {
      await client.release(mission.id, { ...lease, replanRequest: { reason: proposal.reason, subgoals: proposal.subgoals } });
      return { executed: false, replanRequested: true };
    }
    if (proposal?.complete === true) {
      await client.release(mission.id, { ...lease, completionProposed: true, completionReason: String(proposal.reason || '').slice(0, 4000) });
      return { executed: false, awaitingVerification: true };
    }
    if (proposal?.blocked === true) {
      // The planner explicitly declined rather than substituting an unrelated available task for
      // one it doesn't have the capability to do. Surface that reason directly instead of letting
      // it look like a generic planning failure, so a human reviewing a BLOCKED mission sees why.
      const reason = String(proposal.reason || '').slice(0, 500) || 'no allowedTasks capability matches mission.goal';
      await client.release(mission.id, { ...lease, error: `PLANNER_BLOCKED:${reason}` }).catch(() => {});
      return { executed: false, blocked: true, reason };
    }
    if (proposal?.deferred === true) {
      // No planner was available this tick. Hand the lease back without an error so neither a
      // step nor a failure is spent; the next tick plans again.
      await client.release(mission.id, lease);
      return { executed: false, deferred: true, reason: String(proposal.reason || '') };
    }
    planned = planTasks(proposal);
    if (!planned.length) throw new Error('NO_NEXT_TASK');
    if (repeatsVerifiedAction(mission, planned[0], before)) {
      await client.release(mission.id, { ...lease, completionProposed: true, completionReason: 'REPEAT_OF_VERIFIED_ACTION' });
      return { executed: false, awaitingVerification: true, reason: 'REPEAT_OF_VERIFIED_ACTION' };
    }
    task = await client.begin(mission.id, { ...lease, task: planned[0] });
    await onActivity({ phase: 'EXECUTING', missionId: mission.id });
  } catch (error) {
    // A failed/lost begin response may have persisted EXECUTING. The server
    // rejects release in that state and blocks it on lease expiry.
    await client.release(mission.id, { ...lease, error: error.message }).catch(() => {});
    throw error;
  }
  const runOne = async (current, currentLease, currentBefore) => {
    let result;
    try { result = await execute(current, mission); }
    catch (error) { result = executionExceptionResult(current, error); }
    const after = await observe(mission).catch(() => null);
    const receipt = checkedReceipt(current, result, currentBefore, after);
    // Never repeat execution on a receipt transport failure. The persisted
    // executing turn becomes INTERRUPTED until its outcome is reconciled.
    const updated = await client.finish(mission.id, { ...currentLease, actionId: current.id, receipt });
    await onReceipt(receipt, current, updated);
    return { receipt, updated, after };
  };
  let { receipt, updated, after } = await runOne(task, lease, before);
  const receipts = [receipt];
  // Further planned steps run without another planning call while each one succeeds and only reads.
  // Each still goes through claim/begin/finish, so it is validated and gets its own receipt.
  for (const nextTask of planned.slice(1, BATCH_MAX)) {
    if (!receipt.ok || !BATCHABLE.has(nextTask?.type) || updated?.status !== 'ACTIVE') break;
    let nextLease;
    try {
      const claimed = await client.claim(mission.id, owner);
      nextLease = { owner, token: claimed.token };
      task = await client.begin(mission.id, { ...nextLease, task: nextTask });
    } catch (error) {
      if (nextLease) await client.release(mission.id, { ...nextLease, error: error.message }).catch(() => {});
      break;
    }
    ({ receipt, updated, after } = await runOne(task, nextLease, after));
    receipts.push(receipt);
  }
  return { executed: true, receipt, receipts, mission: updated };
}

// Read-only steps that may follow another step in the same planning turn.
export const BATCHABLE = new Set([...READ_ONLY, 'web-fetch', 'mcp-call', 'skill-load']);
export const BATCH_MAX = 4;
// A plan is {task}, {tasks:[...]} or a bare array.
export function planTasks(proposal) {
  const list = Array.isArray(proposal) ? proposal : Array.isArray(proposal?.tasks) ? proposal.tasks : proposal?.task ? [proposal.task] : [];
  return list.filter(t => t && typeof t === 'object' && typeof t.type === 'string').slice(0, BATCH_MAX);
}
