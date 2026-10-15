const clean = value => String(value ?? '').trim();

// Admission is deterministic; differently worded LLM titles are not a work limit.
export function governorAdmission(graphs, { goalId = null, maxActive = 1 } = {}) {
  const limit = Number.isFinite(Number(maxActive)) ? Math.max(1, Math.floor(Number(maxActive))) : 1;
  const active = graphs.filter(graph => ['ACTIVE', 'NEEDS_REPLAN'].includes(graph.status));
  const sameGoal = goalId && active.find(graph => graph.policy?.strategic_goal_id === goalId);
  if (sameGoal) return { allowed: false, reason: 'goal_already_active', graph_id: sameGoal.id };
  if (active.length >= limit) return { allowed: false, reason: 'active_work_limit', active: active.length, limit };
  return { allowed: true };
}

// The do-nothing option every governor decision is scored against. With an unfinished goal in focus,
// idling has no chance of verified progress, so its success is 0 rather than a certain 1: otherwise it
// beat every real plan (2026-10-09: 0.643 against 0.569 for the REV-001 Lite package, turn after turn).
// Without a goal it stays a certain, harmless choice, so SEER does not invent work.
export function governorBaseline({ hasFocusGoal = false } = {}) {
  return {
    id: 'baseline-no-new-mission',
    title: 'No new mission this turn',
    success_probability: hasFocusGoal ? 0 : 1,
    expected_revenue: 0,
    expected_cost: 0,
    repeatability: 1,
    risk: 0,
    reversibility: 1,
    evidence_quality: 1,
    information_gain: 0.1,
    strategic_fit: 0.15,
    human_intervention: 0,
    consequence: 'REVERSIBLE',
    external_spend: 0,
  };
}

// What the governor works on this turn. The operator's primary goal comes first; when it already has
// active work and a slot is free, the next active strategic goal without work gets the slot instead of
// the turn being skipped (2026-10-08: SEER stood still for hours behind one stuck graph while
// JACO-DIST-002 waited). `goals` must be in SEER's own priority order (goals.list('active')).
// `waiting`: ids of graphs whose running work waits on an operator decision. They still mark their goal
// as taken (no duplicate work) but do not count against the limit, so SEER keeps working meanwhile.
export function chooseGovernorFocus(graphs, { primary = null, goals = [], maxActive = 1, waiting = new Set() } = {}) {
  const limit = Number.isFinite(Number(maxActive)) ? Math.max(1, Math.floor(Number(maxActive))) : 1;
  const active = graphs.filter(graph => ['ACTIVE', 'NEEDS_REPLAN'].includes(graph.status));
  const working = active.filter(graph => !waiting.has(graph.id));
  if (working.length >= limit) return { allowed: false, reason: 'active_work_limit', active: working.length, waiting_on_operator: active.length - working.length, limit };
  if (!primary?.id) return { allowed: true, focus: null, primary: false };
  const busy = new Set(active.map(graph => graph.policy?.strategic_goal_id).filter(Boolean));
  if (!busy.has(primary.id)) return { allowed: true, focus: primary, primary: true };
  const next = goals.find(goal => goal?.id && goal.id !== primary.id && !busy.has(goal.id));
  if (next) {
    return {
      allowed: true,
      focus: { id: next.id, statement: clean(next.statement) },
      primary: false,
      primary_graph_id: active.find(graph => graph.policy?.strategic_goal_id === primary.id)?.id || null,
    };
  }
  return { allowed: false, reason: 'goal_already_active', graph_id: active.find(graph => graph.policy?.strategic_goal_id === primary.id)?.id };
}

export function createDevelopmentCycle({
  memory,
  runTurn,
  emit = () => {},
  now = () => Date.now(),
  schedule = (fn, delay) => setTimeout(fn, delay),
  cooldownMs = 5_000,
  backoffMs = 15_000,
} = {}) {
  if (!memory?.get || !memory?.set) throw new Error('DEVELOPMENT_CYCLE_MEMORY_REQUIRED');
  if (typeof runTurn !== 'function') throw new Error('DEVELOPMENT_CYCLE_RUN_TURN_REQUIRED');

  const STATE_KEY = 'seer.development_cycle';
  let inFlight = false;
  let scheduled = false;

  const state = () => memory.get(STATE_KEY) || {
    status: 'idle',
    last_trigger: null,
    last_event_key: null,
    last_started_at: null,
    last_completed_at: null,
    next_eligible_at: 0,
    failures: 0,
  };

  const persist = patch => {
    const next = { ...state(), ...patch };
    memory.set(STATE_KEY, next, 'seer-development-cycle');
    return next;
  };

  async function execute(reason, eventKey) {
    if (inFlight) return { skipped: 'in_flight' };
    inFlight = true;
    const startedAt = now();
    try {
      persist({
        status: 'running',
        last_trigger: reason,
        last_event_key: eventKey || null,
        last_started_at: startedAt,
      });
      emit('development_cycle.started', { reason, event_key: eventKey || null });
      const result = await runTurn({ reason, eventKey });
      if (result?.ok === false) throw new Error(result.error || 'GOVERNOR_TURN_FAILED');
      const completedAt = now();
      const next = persist({
        status: 'idle',
        last_completed_at: completedAt,
        next_eligible_at: completedAt + cooldownMs,
        failures: 0,
        last_error: null,
      });
      emit('development_cycle.completed', { reason, event_key: eventKey || null });
      return { ok: true, result, state: next };
    } catch (error) {
      const failedAt = now();
      const previous = state();
      const failures = Number(previous.failures || 0) + 1;
      const next = persist({
        status: 'backoff',
        failures,
        last_error: error.message,
        next_eligible_at: failedAt + Math.min(backoffMs * failures, 300_000),
      });
      emit('development_cycle.failed', { reason, event_key: eventKey || null, error: error.message, failures });
      return { ok: false, error: error.message, state: next };
    } finally {
      inFlight = false;
      // An operator goal that arrived during this turn runs next instead of being dropped.
      if (pendingForced) {
        const queued = pendingForced;
        pendingForced = null;
        trigger(queued.reason, { eventKey: queued.eventKey, force: true });
      }
    }
  }

  let pendingForced = null;
  function trigger(reason, { eventKey = null, force = false } = {}) {
    const why = clean(reason) || 'unspecified';
    const current = state();
    if (!force && eventKey && current.last_event_key === eventKey) {
      return { accepted: false, reason: 'duplicate_event' };
    }
    if (inFlight || scheduled) {
      if (!force) return { accepted: false, reason: 'in_flight' };
      pendingForced = { reason: why, eventKey };
      emit('development_cycle.queued', { reason: why, event_key: eventKey || null });
      return { accepted: true, queued: true };
    }
    const eligibleAt = Number(current.next_eligible_at || 0);
    const delay = !force && eligibleAt > now() ? eligibleAt - now() : 0;

    persist({
      status: delay > 0 ? 'scheduled_backoff' : 'scheduled',
      last_trigger: why,
      last_event_key: eventKey || current.last_event_key || null,
    });
    scheduled = true;
    try {
      schedule(async () => {
        scheduled = false;
        await execute(why, eventKey);
      }, delay);
    } catch (error) {
      scheduled = false;
      throw error;
    }
    emit('development_cycle.scheduled', { reason: why, event_key: eventKey || null, delay_ms: delay });
    return { accepted: true, delay_ms: delay };
  }

  function watchdog({ staleAfterMs = 300_000 } = {}) {
    const current = state();
    const last = Number(current.last_completed_at || current.last_started_at || 0);
    if (inFlight || scheduled) return { accepted: false, reason: 'in_flight' };
    if (last && now() - last < staleAfterMs) return { accepted: false, reason: 'healthy' };
    // Recovery must respect the persisted provider backoff, including after restart.
    return trigger('watchdog-recovery', { eventKey: `watchdog:${Math.floor(now() / Math.max(1, staleAfterMs))}` });
  }

  return {
    trigger,
    watchdog,
    state: () => ({ ...state(), in_flight: inFlight, scheduled }),
  };
}
