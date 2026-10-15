// Evidence-checked answers (operator 2026-10-03: go beyond how Claude is built). A completion answer
// cites the steps it rests on as [#n]; the runtime checks each citation against the mission's
// receipts. A claim backed by a missing or unverified step is not auto-approved, and the operator sees
// how much of an answer is backed. Claude's answers carry no machine-checked link to their evidence.
// Any bracket that names steps as #n counts: [#2], [#1, #3], and the looser forms models also write,
// such as [Referens: receipt #1] (seen live 2026-10-03; it went unchecked by the judge).
const BRACKET = /\[([^\]\n]{0,80})\]/g;
const STEP = /#\s*(\d{1,4})\b/g;

export function citedSteps(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(BRACKET)) {
    for (const n of m[1].matchAll(STEP)) out.add(Number(n[1]));
  }
  return [...out].filter(Number.isFinite).sort((a, b) => a - b);
}

const stepOf = receipt => Number(/:turn:(\d+)$/.exec(String(receipt?.actionId || ''))?.[1]) || null;

// receipts: the mission's receipts (the last 40 are kept). A citation of an older step that was
// rotated out counts as missing: the evidence is no longer on the mission.
export function checkCitations(text, receipts = []) {
  const cited = citedSteps(text);
  const byStep = new Map(receipts.map(r => [stepOf(r), r]));
  const missing = cited.filter(n => !byStep.has(n));
  const unverified = cited.filter(n => byStep.has(n) && !(byStep.get(n).ok === true && byStep.get(n).verified === true));
  return { cited, verified: cited.filter(n => !missing.includes(n) && !unverified.includes(n)), missing, unverified,
    ok: cited.length > 0 && !missing.length && !unverified.length };
}
