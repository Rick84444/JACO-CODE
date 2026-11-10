// Read-only view projection over Aura's existing CognitiveLive receipts.
// No model calls, tool execution, state writes, policy changes or synthetic progress.
export const LIVE_SURFACES = Object.freeze(['code', 'browser', 'terminal', 'tests', 'git', 'tools']);
const MAX_ACTIVE_AGE_MS = 120_000;
const safeToolType = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(value) ? value : null;
const stamp = event => Number.isFinite(Date.parse(event?.at)) ? Date.parse(event.at) : 0;
const isResult = event => event?.type === 'NOVA_ACTION_RESULT';
const isStarted = event => event?.type === 'NOVA_ACTION_STARTED';

export function surfaceForAuraTool(type) {
  const tool = safeToolType(type)?.toLowerCase() || '';
  if (!tool) return 'tools';
  if (/(?:^|[-_.])(test|tests|pytest|jest|vitest|lint|check|benchmark)(?:$|[-_.])/.test(tool) || /^(run-tests|repo-test|test-run)$/.test(tool)) return 'tests';
  if (/^(browser-|nova_|cdp[._-]|web-|desktop-|screenshot|page-)/.test(tool)) return 'browser';
  if (/^(git-|github-|repo-git|git[._])/.test(tool)) return 'git';
  if (/^(shell|terminal|command|exec|powershell|node-exec|npm-|repo-shell|bash)/.test(tool)) return 'terminal';
  if (/^(repo-|file-|filesystem|coding-|code-|editor-|write-file|read-file|patch-)/.test(tool)) return 'code';
  return 'tools';
}
const ranked = Object.freeze({
  RUNNING: 90, FAILED: 86, UNKNOWN: 84, UNVERIFIED: 75,
  OBSERVATION_INTERRUPTED: 69, NO_RECENT_OBSERVATION: 66, VERIFIED: 48
});

function executionState(started, finished, connection, now) {
  if (finished) {
    const outcome = finished.evidence?.outcome;
    return outcome === 'verified' ? 'VERIFIED' : outcome === 'failed' ? 'FAILED'
      : outcome === 'unknown' ? 'UNKNOWN' : 'UNVERIFIED';
  }
  if (!started || connection !== 'live') return 'OBSERVATION_INTERRUPTED';
  const age = now - stamp(started);
  return age >= 0 && age <= MAX_ACTIVE_AGE_MS ? 'RUNNING' : 'NO_RECENT_OBSERVATION';
}

// Events already passed through server redaction. Never infer a tool call from
// narration, planning or the mere presence of an MCP tool in the registry.
export function projectAuraLiveWorkspace(events = [], {
  missionId = null, connection = 'live', now = Date.now(),
  pinnedSurface = null, maxSurfaces = 6
} = {}) {
  const actions = new Map();
  const sorted = (Array.isArray(events) ? events : [])
    .filter(event => (isStarted(event) || isResult(event)) &&
      event?.actionId && safeToolType(event.toolType) &&
      (!missionId || event.missionId === missionId))
    .sort((a, b) => stamp(a) - stamp(b) ||
      (a.seq ?? 0) - (b.seq ?? 0) ||
      Number(isResult(a)) - Number(isResult(b)));
  for (const event of sorted) {
    const key = JSON.stringify([event.missionId, event.actionId]);
    const current = actions.get(key) || { started: null, finished: null };
    if (isResult(event)) {
      if (!current.finished || (!current.finished.durable && event.durable) ||
        stamp(event) >= stamp(current.finished)) current.finished = event;
    } else if (!current.started || stamp(event) >= stamp(current.started)) {
      current.started = event;
    }
    actions.set(key, current);
  }

  const bySurface = new Map();
  for (const { started, finished } of actions.values()) {
    const event = finished || started;
    const surface = surfaceForAuraTool(event.toolType);
    const state = executionState(started, finished, connection, now);
    const item = {
      id: JSON.stringify([event.missionId, event.actionId]),
      missionId: event.missionId, actionId: event.actionId,
      toolType: event.toolType, surface, state, at: event.at,
      evidence: event.evidence, text: event.text,
      eventId: event.id, durable: event.durable === true,
      // Keep a reference to the already-redacted event for evidence/file navigation.
      event
    };
    if (!bySurface.has(surface)) bySurface.set(surface, []);
    bySurface.get(surface).push(item);
  }
  const surfaces = [...bySurface.entries()].map(([id, entries]) => {
    entries.sort((a,b) => (ranked[b.state] || 0) - (ranked[a.state] || 0) ||
      stamp(b) - stamp(a));
    return {
      id, primary: entries[0], entries: entries.slice(0, 8),
      running: entries.filter(item => item.state === 'RUNNING').length,
      count: entries.length,
      attention: entries.some(item => ['FAILED','UNKNOWN'].includes(item.state))
    };
  }).sort((a,b) =>
    Number(b.id === pinnedSurface) - Number(a.id === pinnedSurface) ||
    (ranked[b.primary.state] || 0) - (ranked[a.primary.state] || 0) ||
    stamp(b.primary) - stamp(a.primary));

  return {
    schema: 'jaco.aura-live-workspace/v1',
    // This is a presentation only. It never certifies that a mission is complete.
    actionCount: actions.size,
    surfaces: surfaces.slice(0, Math.max(1, Math.min(6, maxSurfaces))),
    totalSurfaces: surfaces.length,
    connection,
    missionId
  };
}
