// Which of several ACTIVE missions should keep running, wait, or end.
//
// The queue is first-in first-out, so an old mission that no longer makes progress starves every newer goal (2026-11-23: three
// resumed old missions and four retries of the same drill queued up, and the executor answered MISSION_NOT_CURRENT for minutes).
// This decides, from observable facts only, and never touches what the operator is waiting on:
//   - never: paid orders, missions of a mission graph (they follow their parent), paused or ending missions, a mission that
//     waits for an operator decision, and a mission that is executing a step right now;
//   - a retry of the same task (same goal family, a newer one exists, no verified progress of its own) is CANCELLED as superseded;
//   - any other mission older than the newest operator goal that has not moved for `idleMs` is PAUSED (reversible, resumable).
// Nothing here judges whether a goal is "mostly done": that stays with the mission's own verification.

export const TRIAGE_IDLE_MS = 15 * 60_000;
export const TRIAGE_STALE_MS = 2 * 60 * 60_000;

// "Datorövning Q3 (Qwen ...)" and "Datorövning Q4 (...)" are the same task tried again: letters of the opening words, no digits.
export const goalFamily = goal => String(goal || '').toLowerCase().split(/[(:\n]/)[0].replace(/[\d\s\-_.,]+/g, ' ').trim().slice(0, 40);

const time = value => { const t = Date.parse(value); return Number.isFinite(t) ? t : 0; };
const lastProgress = mission => Math.max(time(mission.updatedAt), time(mission.createdAt), ...(mission.receipts || []).map(r => time(r?.at)));
const verifiedProgress = mission => (mission.receipts || []).some(r => r?.ok === true && r?.verified === true);

const untouchable = mission =>
  /-order$/.test(String(mission.source || '')) ||
  Boolean(mission.metadata?.parent?.graphId) ||
  Boolean(mission.paused) || Boolean(mission.cancelRequested) ||
  Boolean(mission.pendingOperatorAction) || Boolean(mission.spendApprovalPending) ||
  Boolean(mission.executionLeaseActive);

/**
 * @param {Array<object>} missions ACTIVE missions with source, goal, createdAt, updatedAt, receipts and the flags above
 * @returns {Array<{id:string, action:'pause'|'cancel', reason:string}>}
 */
export function planMissionTriage(missions, { now = Date.now(), idleMs = TRIAGE_IDLE_MS, staleMs = TRIAGE_STALE_MS } = {}) {
  const active = (missions || []).filter(m => m && m.id);
  const candidates = active.filter(m => !untouchable(m));
  if (candidates.length === 0) return [];
  const newest = [...active].filter(m => !/-order$/.test(String(m.source || '')) && !m.metadata?.parent?.graphId)
    .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
  const decisions = [];
  for (const mission of candidates) {
    const idle = now - lastProgress(mission);
    const newer = candidates.filter(other => other !== mission && time(other.createdAt) > time(mission.createdAt));
    const family = goalFamily(mission.goal);
    const retry = family && newer.some(other => goalFamily(other.goal) === family);
    if (retry && !verifiedProgress(mission)) {
      decisions.push({ id: mission.id, action: 'cancel', reason: 'a newer attempt at the same task exists and this one has no verified progress of its own' });
    } else if (newest && newest.id !== mission.id && time(mission.createdAt) < time(newest.createdAt) && idle >= idleMs) {
      decisions.push({ id: mission.id, action: 'pause', reason: `older than the newest goal and idle for ${Math.round(idle / 60_000)} minutes` });
    } else if (idle >= staleMs) {
      decisions.push({ id: mission.id, action: 'pause', reason: `no progress for ${Math.round(idle / 3_600_000)} hours` });
    }
  }
  return decisions;
}

export const DONE_WINDOW_MS = 24 * 60 * 60_000;

/**
 * Before a goal is started: was a task of the same family just finished with evidence? Missions of the same family that finished
 * (DONE) within the last day are listed, newest first, so the caller can report them instead of silently repeating the work.
 * (A still-open near-duplicate is answered by NovaMissionControl.create through missionDedupe.mjs.)
 */
export function findSimilarMissions(goal, missions, { now = Date.now(), windowMs = DONE_WINDOW_MS } = {}) {
  const family = goalFamily(goal);
  if (!family) return { done: [] };
  const done = (missions || []).filter(m => m && m.id && m.status === 'DONE' && goalFamily(m.goal) === family && now - time(m.updatedAt) <= windowMs)
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
    .map(m => ({ id: m.id, goal: String(m.goal).slice(0, 160), finishedAt: m.updatedAt, verified: verifiedProgress(m) }));
  return { done };
}
