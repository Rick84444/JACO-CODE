// The operator-facing Aura Core owns scheduling. The legacy strategy database
// and durable execution ledger are reached through their existing authenticated
// adapters; the short lease prevents parallel legacy scheduling during migration.
export function createAuraCoreController({
  request, intervalMs = 2500, onStatus = () => {},
} = {}) {
  if (typeof request !== 'function') throw new Error('AURA_CORE_CONTROL_REQUEST_REQUIRED');
  let leaseToken = null;
  let active = false;
  let busy = false;
  let timer = null;
  let last = null;
  let lastError = null;
  let ticks = 0;

  const state = () => ({
    owner: 'aura',
    executionHost: 'core',
    running: active,
    inFlight: busy,
    leased: Boolean(leaseToken),
    ticks,
    last,
    lastError,
    // The legacy storage adapters still run in other OS processes.
    runtimeConsolidated: false,
  });

  async function tick() {
    if (!active) return { skipped: 'stopped' };
    if (busy) return { skipped: 'in_flight' };
    busy = true;
    try {
      if (!leaseToken) {
        const grant = await request('claim', { owner: 'aura-core' });
        if (typeof grant?.token !== 'string' || !grant.token) throw new Error('AURA_CORE_LEASE_MISSING');
        leaseToken = grant.token;
      }
      const result = await request('tick', { token: leaseToken });
      ticks++;
      if (result?.ok === false && result?.error) {
        lastError = String(result.error).slice(0, 200);
      } else lastError = null;
      last = result && typeof result === 'object'
        ? { ok: result.ok === true, sequence: result.sequence || null, phases: result.phases || [], skipped: result.skipped || null }
        : { ok: false, skipped: 'INVALID_CONTROL_RESULT' };
      onStatus(state());
      return result;
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('AURA_CONTROL_LEASE_INVALID')) leaseToken = null;
      lastError = message.slice(0, 200);
      onStatus(state());
      return { ok: false, error: lastError };
    } finally { busy = false; }
  }

  function start() {
    if (active) return;
    active = true;
    void tick();
    timer = setInterval(() => { void tick(); }, Math.max(1000, intervalMs));
    timer.unref?.();
  }

  async function stop() {
    active = false;
    if (timer) clearInterval(timer);
    timer = null;
    const token = leaseToken;
    leaseToken = null;
    if (token) {
      try { await request('release', { token }); }
      catch { /* Time-bound lease expires automatically; no fabricated release receipt. */ }
    }
  }
  return { start, stop, tick, state };
}
