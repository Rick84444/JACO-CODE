// Experimental pure selection kernel. No authority, execution or persistence.
// Inspired by GEPA's per-example frontier tracking; independently implemented.
export function selectFrontier(rows, cases) {
  if (!Array.isArray(cases) || !cases.length || new Set(cases).size !== cases.length || cases.some(c => typeof c !== 'string' || !c)) throw new Error('INVALID_CASES');
  if (!Array.isArray(rows) || new Set(rows.map(r => r.id)).size !== rows.length) throw new Error('INVALID_CANDIDATES');
  const valid = rows.filter(r => {
    if (typeof r.id !== 'string' || !r.id || typeof r.contractPassed !== 'boolean' || !Number.isFinite(r.cost) || r.cost < 0 || !r.scores || Object.keys(r.scores).length !== cases.length || cases.some(c => !Object.hasOwn(r.scores,c) || !Number.isFinite(r.scores[c]) || r.scores[c] < 0 || r.scores[c] > 1)) throw new Error('INVALID_EVIDENCE');
    return r.contractPassed;
  });
  const dominates = (a,b) => a.cost <= b.cost && cases.every(c => a.scores[c] >= b.scores[c]) && (a.cost < b.cost || cases.some(c => a.scores[c] > b.scores[c]));
  return valid.filter(b => !valid.some(a => dominates(a,b))).map(r => r.id).sort();
}
