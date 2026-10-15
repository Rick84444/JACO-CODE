// One timing contract for the planner and its exclusive mission lease.
function milliseconds(env, key, fallback) {
  const value = env[key] == null || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isSafeInteger(value) || value < 15_000 || value > 3_600_000) throw new Error(`INVALID_TIMING:${key}`);
  return value;
}
export function novaTiming(env = process.env) {
  const requestMs = milliseconds(env, 'JACO_NOVA_REASONING_TIMEOUT_MS', 600_000);
  const planBudgetMs = milliseconds(env, 'JACO_NOVA_PLAN_BUDGET_MS', 1_200_000);
  if (requestMs > planBudgetMs) throw new Error('NOVA_REASONING_EXCEEDS_PLAN_BUDGET');
  return { requestMs, planBudgetMs, planningLeaseMs: planBudgetMs + 60_000 };
}
export function planningDeadline(mission, timing, now = Date.now()) {
  // The hub owns the lease; a joined device must respect its actual deadline.
  const leaseEnd = Number(mission?.planningDeadlineAt);
  return Math.min(now + timing.planBudgetMs, Number.isFinite(leaseEnd) && leaseEnd > 0 ? leaseEnd - 30_000 : Infinity);
}
