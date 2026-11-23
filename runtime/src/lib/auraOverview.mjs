// The operator's overview of Aura's work: one place that answers what is happening, what is verified,
// what is in the way and what needs the operator. It only reads the observed Gameboard payload
// (/api/aura/workbench/gameboard). It creates no state and claims no progress that was not observed.

const arr = value => (Array.isArray(value) ? value : []);
const text = (value, max = 240) => String(value ?? '').trim().slice(0, max);

// Model waits are temporary and recover on their own; anything else needs a look.
export function isModelWait(code) {
  return /^(MODEL_TEMPORARILY_LIMITED|AURA_SELECTED_MODEL_UNAVAILABLE|PROVIDER_(TIMEOUT|NOT_READY|UNREACHABLE)|RATE_LIMIT)/.test(String(code || ''));
}

export function summarizeAuraWork(board) {
  const missions = arr(board?.missions);
  const plans = arr(board?.plans);
  const active = missions.filter(m => m.status === 'ACTIVE');
  const activePlan = plans.find(p => p.status === 'ACTIVE') || null;
  const nodes = arr(activePlan?.nodes);
  const verified = nodes.filter(n => n.status === 'VERIFIED').length;
  const running = nodes.find(n => n.status === 'ACTIVE') || null;
  const move = arr(activePlan?.moves).find(m => m.executable) || null;
  const nextNode = move ? nodes.find(n => n.identity === move.stepId) || null : null;
  const blockers = active
    .filter(m => m.lastError)
    .map(m => ({ mission: text(m.identity, 80), code: String(m.lastError).split(':')[0], detail: text(m.lastError, 200) }));
  const paused = active.filter(m => m.paused).map(m => ({ mission: text(m.identity, 80), detail: 'Pausad' }));
  const verifiedActions = missions.reduce((sum, m) => sum + (Number.isSafeInteger(m.verifiedActions) ? m.verifiedActions : 0), 0);
  const waitingForOperator = [
    ...paused,
    ...blockers.filter(b => !isModelWait(b.code) && /APPROVAL|OPERATOR|REVIEW|DECISION/i.test(b.code)),
  ];

  let state = 'IDLE';
  if (active.length > 0) {
    if (blockers.length > 0 && blockers.every(b => isModelWait(b.code))) state = 'WAITING_MODEL';
    else if (blockers.length > 0 || paused.length > 0) state = 'BLOCKED';
    else state = 'WORKING';
  }

  return {
    state,
    goal: text(board?.operatorGoal?.statement, 400) || null,
    activeMissions: active.length,
    verifiedActions,
    progress: { verified, total: nodes.length },
    running: running ? text(running.title, 200) : null,
    nextStep: nextNode ? text(nextNode.title, 200) : null,
    blockers: blockers.map(b => ({ mission: b.mission, code: b.code, detail: b.detail })),
    waitingForOperator,
    observedAt: text(board?.observedAt, 40) || null,
  };
}
