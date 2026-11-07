// A human-readable projection of repeated mission blockers. No claim of success is inferred
// from transport events, and the original events remain available in Evidence.
export function summarizeMissionBlocker(events = [], missionId = null) {
  if (!missionId || !Array.isArray(events)) return null;
  const matching = events.filter(event =>
    event?.missionId === missionId &&
    (event?.category === 'blocked' || event?.evidence?.outcome === 'failed' || event?.evidence?.outcome === 'unknown')
  );
  if (!matching.length) return null;
  const event = matching.at(-1);
  const fingerprint = current => String(current?.evidence?.error || current?.text || current?.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const reason = fingerprint(event);
  const count = matching.filter(item => fingerprint(item) === reason).length;
  const isBudgetLimit = /monthly_budget_limit|monthly.{0,25}budget|månadsbudget/i.test(reason);
  return { event, count, isBudgetLimit };
}
