// Read-only projection of durable, contract-scoped mission outcomes into the
// native model's context. This is evidence retrieval, not a permission source.
// Only outcomes originally machine-verified and with recorded action evidence
// can teach the next mission. A changed repository revision marks them STALE.
import { redactDeep } from './secret-capture.mjs';

export function verifiedOutcomeHints(outcomes = [], allowedTasks = [], { maxChars = 2400 } = {}) {
  const allowed = new Set(Array.isArray(allowedTasks) ? allowedTasks : []);
  const items = [];
  const budget = Math.max(200, Math.min(4000, Number(maxChars) || 2400));
  for (const record of Array.isArray(outcomes) ? outcomes.slice(0, 8) : []) {
    if (!record || !Array.isArray(record.evidence) || !record.evidence.length) continue;
    const original = record.originalVerificationStatus || record.verificationStatus;
    if (original !== 'VERIFIED' || !['VERIFIED', 'STALE'].includes(record.verificationStatus)) continue;
    const worked = Array.isArray(record.worked)
      ? [...new Set(record.worked.filter(t => typeof t === 'string' && allowed.has(t)))].slice(0, 12) : [];
    const pattern = Array.isArray(record.reusablePatterns)
      ? record.reusablePatterns
        .filter(p => typeof p?.tool === 'string' && allowed.has(p.tool))
        .slice(0, 12).map(p => ({
          tool: p.tool,
          // The canonical outcome records argument names, not their values.
          // Preserve which fields worked without replaying commands or secrets.
          argumentNames: Array.isArray(p.args) ? p.args.filter(name =>
            typeof name === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)).slice(0, 12) : [],
        })) : [];
    const failures = Array.isArray(record.failed) ? record.failed
      .filter(f => f && typeof f.tool === 'string' && allowed.has(f.tool))
      .slice(0, 3).map(f => ({ tool: f.tool, code: String(f.error || 'TOOL_FAILED').slice(0, 90) })) : [];
    if (!worked.length && !pattern.length && !failures.length) continue;
    items.push(redactDeep({
      evidenceType: 'historical_mission_outcome',
      sourceMission: String(record.missionId || '').slice(0, 120),
      verification: record.verificationStatus === 'VERIFIED' ? 'VERIFIED_FOR_RECORDED_REVISION' : 'STALE_REQUIRES_REVALIDATION',
      sourceRevision: String(record.repositoryRevision || '').slice(0, 120) || null,
      evidenceCount: record.evidence.length,
      worked, sequence: pattern, failures,
    }));
    if (items.length >= 3) break;
  }
  if (!items.length) return '';
  let result = JSON.stringify(items);
  while (result.length > budget && items.length > 1) { items.pop(); result = JSON.stringify(items); }
  if (result.length > budget) {
    const compact = JSON.stringify([{ sourceMission: items[0].sourceMission, verification: items[0].verification, evidenceCount: items[0].evidenceCount, worked: items[0].worked.slice(0, 4) }]);
    return compact.length <= budget ? compact : '';
  }
  return result;
}
