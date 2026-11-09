// Aura's single serialized control turn. Existing strategy and durable executor
// remain callable adapters during the state-preserving migration.
//
// A turn always consumes persisted execution results before allowing planning
// to dispatch more work. Separate timers must not independently mutate the
// same mission graph. This code creates no new persistence, tokens or agents.
export function createAuraControlLoop({
  reconcile, plan, emit = () => {}, now = () => Date.now(),
} = {}) {
  if (typeof reconcile !== 'function' || typeof plan !== 'function') {
    throw new Error('AURA_CONTROL_ADAPTER_REQUIRED');
  }
  let inFlight = null;
  let stopped = false;
  let last = null;
  let sequence = 0;
  const state = () => ({
    owner: 'aura',
    inFlight: Boolean(inFlight),
    stopped,
    sequence,
    last: last ? { ...last } : null,
    // The scheduler is consolidated, NOT the legacy strategy/executor OS processes.
    runtimeConsolidated: false,
  });

  async function tick({ planningEnabled = true, trigger = 'scheduled' } = {}) {
    if (stopped) return { ok: false, skipped: 'stopped' };
    if (inFlight) return { ok: false, skipped: 'in_flight' };
    const seq = ++sequence;
    const startedAt = new Date(now()).toISOString();
    const run = (async () => {
      let phase = 'reconcile';
      try {
        // Fail closed on a lost reconciliation, so an unknown execution result
        // cannot cause a new planning/dispatch turn on stale graph state.
        await reconcile();
        if (stopped) {
          const report = { ok: false, skipped: 'stopped_after_reconcile', sequence: seq, startedAt };
          last = report;
          return report;
        }
        if (!planningEnabled) {
          const report = { ok: true, sequence: seq, startedAt, phases: ['reconcile'], planning: 'disabled' };
          last = report;
          return report;
        }
        phase = 'plan';
        const outcome = await plan();
        const report = { ok: true, sequence: seq, startedAt, phases: ['reconcile', 'plan'],
          dispatched: Array.isArray(outcome?.dispatched) ? outcome.dispatched.length : 0,
          replanned: Array.isArray(outcome?.replanned) ? outcome.replanned.length : 0,
          errors: Array.isArray(outcome?.errors) ? outcome.errors.length : 0 };
        last = report;
        emit('aura.control.turn_completed', report);
        return report;
      } catch (error) {
        const report = { ok: false, sequence: seq, startedAt, phase, error: String(error?.message || error).slice(0, 300) };
        last = report;
        emit('aura.control.turn_failed', report);
        return report;
      }
    })();
    inFlight = run;
    try { return await run; }
    finally { if (inFlight === run) inFlight = null; }
  }
  function stop() { stopped = true; }
  return { tick, stop, state };
}
