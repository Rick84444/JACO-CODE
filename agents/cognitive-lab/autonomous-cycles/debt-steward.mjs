/**
 * Technical Debt Steward — bounded, deterministic safe cleanup for lab candidates.
 * Does not execute candidate code or run arbitrary repair scripts.
 * All cleanup is followed by an independent reviewer run in cycle-runtime.
 */
import { createHash } from 'node:crypto';
const hash = text => createHash('sha256').update(text).digest('hex');
const ARTIFACT_COMMENT = /^\s*\/\/ candidate (\d+): (propose|repair) for ([a-zA-Z][\w-]*)\s*$/;
const REJECT = [
  { code: 'DEBUGGER_STATEMENT', pattern: /^\s*debugger\s*;/m },
  { code: 'UNRESOLVED_FIXME', pattern: /^\s*\/\/\s*(?:TODO|FIXME)\b/m },
  { code: 'UNSAFE_DYNAMIC_EVAL', pattern: /(?:^|[^.\w])(?:eval|Function)\s*\(/m },
  { code: 'CONSOLE_DEBUG', pattern: /\bconsole\.(?:debug|log)\s*\(/m },
  { code: 'UNFILLED_TEMPLATE', pattern: /__FEATURES__/ },
];
export function auditTechnicalDebt(source) {
  if (typeof source !== 'string' || source.length > 1_000_000) throw new Error('DEBT_SOURCE_INVALID');
  const blockers = REJECT.filter(item => item.pattern.test(source)).map(item => item.code);
  if (/\r/.test(source)) blockers.push('CRLF_DETECTED');
  if (source.split('\n').some(line => /[ \t]+$/.test(line))) blockers.push('TRAILING_WHITESPACE');
  if (source.split(/\n{4,}/).length > 1) blockers.push('EXCESSIVE_BLANK_LINES');
  if (source.split('\n').some(line => ARTIFACT_COMMENT.test(line))) blockers.push('GENERATED_CANDIDATE_COMMENT');
  return { accepted: blockers.length === 0, blockers };
}
export function cleanTechnicalDebt(source) {
  if (typeof source !== 'string' || source.length > 1_000_000) throw new Error('DEBT_SOURCE_INVALID');
  const beforeHash = hash(source);
  let removedCandidateComments = 0;
  const rows = source.replace(/\r\n/g, '\n').split('\n').filter(line => {
    if (!ARTIFACT_COMMENT.test(line)) return true;
    removedCandidateComments++;
    return false;
  });
  let cleaned = rows.map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/\n{4,}/g, '\n\n\n');
  cleaned = cleaned.replace(/\n*$/, '\n');
  const audit = auditTechnicalDebt(cleaned);
  return {
    schema: 'jaco.technical-debt-review/v1',
    beforeHash, afterHash: hash(cleaned),
    changed: cleaned !== source,
    removedCandidateComments,
    blockers: audit.blockers,
    accepted: audit.accepted,
    source: cleaned,
  };
}