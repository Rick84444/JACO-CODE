// Read-only compatibility surface for historical PODAR plans.
// The legacy autonomous worker is retired. Never grant execution authority
// to these records, synthesize fake receipts, or silently migrate old work.
export const LEGACY_PLAN_WRITE_PATHS = Object.freeze([
  '/api/plans/:id/step/outcome',
  '/api/plans/:id/abandon-subgoal',
  '/api/plans/:id/decide',
  '/api/plans/synthesize-blueprint',
  '/api/plans/:id/add-subgoal',
  '/api/plans/:id/step/execute-live',
  '/api/plans/heartbeat/toggle',
  '/api/plans/heartbeat/tick-now',
  '/api/plans/:id/jaco-final-signoff',
  '/api/plans/:id/resolve-blocker',
]);

export function retiredLegacyPlanMutation(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    success: false,
    error: 'LEGACY_PLAN_EXECUTION_RETIRED',
    historicalPlansRetained: true,
    migrated: false,
    next: '/api/aura/workbench/start-goal',
    nextMethod: 'POST',
  });
}

/**
 * Mount exactly the old read endpoints and fail-closed write endpoints.
 * Dependencies are injected to keep read-only history separable and testable.
 * GET returns a snapshot; it never creates a task, lock, receipt, or mission.
 */
export function mountLegacyPlanRoutes(app, {
  listPlans, getPlan, getNextStep, needsReplanning,
}) {
  for (const fn of [listPlans, getPlan, getNextStep, needsReplanning]) {
    if (typeof fn !== 'function') throw new TypeError('LEGACY_PLAN_READ_DEPENDENCY_MISSING');
  }

  app.get('/api/plans', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const plans = listPlans();
      return res.json({ success: true, count: plans.length, plans });
    } catch {
      return res.status(503).json({ success: false, error: 'LEGACY_PLANS_UNAVAILABLE' });
    }
  });

  app.get('/api/plans/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const plan = getPlan(req.params.id);
      if (!plan) return res.status(404).json({ success: false, error: 'LEGACY_PLAN_NOT_FOUND' });
      const next = getNextStep(plan);
      const replanNeeded = needsReplanning(plan);
      return res.json({ success: true, plan, nextStep: next, needsReplanning: replanNeeded });
    } catch {
      return res.status(503).json({ success: false, error: 'LEGACY_PLAN_UNAVAILABLE' });
    }
  });

  app.get('/api/plans/heartbeat/status', retiredLegacyPlanMutation);
  for (const route of LEGACY_PLAN_WRITE_PATHS) app.post(route, retiredLegacyPlanMutation);
}
