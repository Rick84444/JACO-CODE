// Earned-trust auto-resolution for durable Nova missions.
// Operator decisions: 2026-09-25 "fewer approvals now that the agents follow the rules";
// later the same day "level 5: SEER sets sub-goals and approves everything except outgoing spend,
// focused on the set goal; agents may update the rules when I grant it".
//
// Level (JACO_AUTO_APPROVE_LEVEL, or the policy file's "level" when rule edits are granted)
//   Unset means the highest level (5); the operator lowers it with JACO_AUTO_APPROVE_LEVEL. An invalid value means 0.
//   0  off: everything waits for the operator
//   1  confirm verified read-only completions; resume a BLOCKED mission once after a transient failure
//   2  + confirm verified code work when the coding contract is machine-verified (merge still needs green CI);
//        an autonomous coding contract keeps resuming after failures until its budget is used up
//   3  + confirm any verified completion; resume once after any non-policy failure
//   4  + approve typed jobs waiting in the approval gate
//   5  + approve staged MCP sources (full autonomy)
//
// Hard limits at every level, not editable by agents:
//   - anything that looks like outgoing spend (payments, purchases, payouts, subscriptions, top-ups)
//   - uncertain outcomes (interrupted execution, outcomeUnknown): resuming could repeat a mutation
//   - failures raised by a safety policy (payment/secret shell policy, origin denial, payment required)
import fs from 'node:fs';
import path from 'node:path';

export const READ_ONLY_TASKS = new Set([
  'detect-surfaces', 'health-check', 'check-revenue', 'browser-survey-site', 'web-fetch',
  'desktop-windows', 'desktop-observe', 'windows-wmi-read', 'screenshot', 'get-cursor',
  'repo-list', 'repo-read', 'git-status', 'git-diff', 'mcp-call', 'skill-load',
]);
export const VERIFIED_CODE_TASKS = new Set(['repo-write', 'repo-edit', 'repo-test', 'git-commit']);
// Unambiguous spend vocabulary: always blocks, no matter the surrounding text.
export const OUTGOING_SPEND = /\b(pay|payment|payout|purchase|buy|subscri(be|ption)|top[- ]?up|send (money|funds)|refund|x402|skyfire|invoice (a|the) vendor|checkout\.sessions?\.create)\b|betal|köp|prenumerer|utbetal/i;
// Ambiguous vocabulary that also has common non-financial engineering meanings (data transfer,
// crypto wallet *research*, battery charge, file/API withdraw-style naming). These only block when
// they co-occur with an actual financial-context cue nearby, so "data transfer" or "wallet address
// analysis" (a read-only research task) doesn't force operator confirmation forever.
const AMBIGUOUS_SPEND_TERM = /\b(transfer|wallet|withdraw|charge)\b|överför/i;
const FINANCIAL_CONTEXT = /[$€£]|\bUSD\b|\bSEK\b|\bEUR\b|\bGBP\b|\bmoney\b|\bfunds?\b|\bbank\b|\baccount\b|\bcredit card\b|\bcard number\b|\binvoice\b|\bpengar\b|\bkonto\b|\bkort\b/i;
const TRANSIENT = /fetch failed|NOVA_LEASE_BUSY|timeout|timed out|ECONNRESET|ECONNREFUSED|UNBALANCED_JSON|EMPTY_CONTENT|all_providers_failed|\b429\b|\b503\b/i;
const POLICY_BLOCK = /PAYMENT|SECRET_POLICY|ORIGIN_DENIED|Payment Required|SPEND|MANDATE/i;
// An exhausted coding budget only re-blocks on the next turn: an automated resume never extends it
// (novaMissionControl.resolve), so resuming it would only spend a planner call.
const BUDGET_EXHAUSTED = /CODING_CONTRACT_\w*(BUDGET|DURATION)_EXCEEDED/;
const CAPABILITY_GAP = /PLANNER_BLOCKED|UNKNOWN_TASK_TYPE|WORKER_KEY_MISSING/;
export const MAX_AUTO_RESUMES = 1;
export const MAX_LEVEL = 5;

const clampLevel = value => {
  const level = Number(value);
  return Number.isInteger(level) && level >= 0 && level <= MAX_LEVEL ? level : null;
};

export function policyFilePath(root = process.env.JACO_WORKSPACE_ROOT || process.cwd()) {
  return path.join(root, '.jaco', 'policy', 'approval-policy.json');
}

// Effective policy: .env level, overridden by the policy file only when the operator granted rule edits.
export function loadApprovalPolicy({ env = process.env, file = policyFilePath() } = {}) {
  const envLevel = clampLevel(env.JACO_AUTO_APPROVE_LEVEL ?? MAX_LEVEL) ?? 0;
  const editsGranted = env.JACO_POLICY_EDIT_GRANT === '1';
  let fromFile = null;
  if (editsGranted) { try { fromFile = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {} }
  const fileLevel = clampLevel(fromFile?.level);
  return {
    level: fileLevel ?? envLevel,
    editsGranted,
    extraBlocked: Array.isArray(fromFile?.extraBlocked) ? fromFile.extraBlocked.map(String).slice(0, 50) : [],
    source: fileLevel != null ? 'policy-file' : 'env',
  };
}

export function autoApprovalLevel(env = process.env) {
  return clampLevel(env.JACO_AUTO_APPROVE_LEVEL ?? MAX_LEVEL) ?? 0;
}

// Agents (SEER, Aura) may change the rules only with the operator's grant; the hard limits above stay.
export function updateApprovalPolicy({ level, extraBlocked, reason, actor }, { env = process.env, file = policyFilePath() } = {}) {
  if (env.JACO_POLICY_EDIT_GRANT !== '1') throw new Error('POLICY_EDIT_NOT_GRANTED');
  if (!String(reason || '').trim()) throw new Error('POLICY_REASON_REQUIRED');
  const current = loadApprovalPolicy({ env, file });
  const next = {
    level: level === undefined ? current.level : clampLevel(level),
    extraBlocked: Array.isArray(extraBlocked) ? extraBlocked.map(String).slice(0, 50) : current.extraBlocked,
  };
  if (next.level == null) throw new Error('POLICY_LEVEL_INVALID');
  let history = [];
  try { history = JSON.parse(fs.readFileSync(file, 'utf8')).history || []; } catch {}
  history.push({ at: new Date().toISOString(), actor: String(actor || 'agent'), reason: String(reason).slice(0, 500), from: current.level, to: next.level });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...next, history: history.slice(-100) }, null, 2));
  return { ...next, previousLevel: current.level };
}

// Operator 2026-10-09: "utgift stopp räknar inte in våra llm api i det". JACO's own model usage (DeepSeek,
// Groq, Ollama Cloud and the like) is bounded by the economic budget, not by the spend stop, so a clause
// about a model provider or API usage never makes a mission spend-related. Clauses are cut at punctuation and
// at and/then/och/sedan, so "use DeepSeek, then pay the invoice" still stops at the payment.
const LLM_API = /\b(deepseek|groq|openai|ollama|openrouter|anthropic|claude|gemini|qwen|mistral|hugging ?face|llm|språkmodell|language model|inference|tokens?|api[- ]?(keys?|nycklar|nyckel|kostnad(er)?|costs?|usage|credits?|saldo|balance))\b/i;
const withoutLlmApi = text => String(text || '').split(/[.!?;,\n]+|\b(?:and|then|och|sedan|därefter)\b/i).filter(clause => clause && !LLM_API.test(clause)).join('. ');

function spendRelated(mission, extraBlocked = []) {
  const text = withoutLlmApi([mission.goal, ...(mission.receipts || []).map(r => `${r?.type || ''} ${r?.expectedOutcome || ''}.`)].join(' '));
  if (OUTGOING_SPEND.test(text)) return true;
  if (AMBIGUOUS_SPEND_TERM.test(text) && FINANCIAL_CONTEXT.test(text)) return true;
  return extraBlocked.some(pattern => { try { return new RegExp(pattern, 'i').test(text); } catch { return text.includes(pattern); } });
}

// Returns { decision, note } or null (leave it for the operator).
// lastError: the mission's latest planning/action error (from runtime events); autoResumes: prior auto-resumes.
// The note of the one automatic resume after a claim check found the answer contradicted by its own
// evidence: Nova gets the review (mission.answerReview) and corrects the answer once; a second failed
// check goes to the operator.
export const CLAIM_RESUME_NOTE = 'auto-resumed: answer contradicted by its own evidence';

export function autoResolution(mission = {}, { level = 0, autoResumes = 0, lastError = '', extraBlocked = [], evidence = null, claimCheck = null, claimResumes = 0 } = {}) {
  if (level <= 0 || !mission?.id) return null;
  if (spendRelated(mission, extraBlocked)) return null;
  const status = String(mission.status || '').toUpperCase();
  const receipts = Array.isArray(mission.receipts) ? mission.receipts : [];
  const uncertain = mission.phase === 'INTERRUPTED' || receipts.some(r => r?.outcomeUnknown === true || (r?.ok === true && r?.verified !== true));
  if (uncertain) return null;

  if (status === 'AWAITING_VERIFICATION') {
    const done = receipts.filter(r => r?.ok === true);
    if (!done.length || done.some(r => r.verified !== true)) return null;
    // An answer that cites a step that does not exist or is unverified goes to the operator.
    if (evidence?.cited?.length && evidence.ok !== true) return null;
    // An answer whose claims its evidence does not support is sent back to Nova once, then to the operator.
    if (claimCheck && claimCheck.ok !== true) {
      const problems = (claimCheck.unsupportedFacts?.length || 0) + (claimCheck.contradicted?.length || 0);
      if (problems && claimResumes < 1) return { decision: 'resume', note: `${CLAIM_RESUME_NOTE}: ${problems} claim(s) to correct` };
      return null;
    }
    if (mission.contract && mission.contractStatus?.machineVerified !== true) return null;
    const types = done.map(r => String(r.type || ''));
    if (types.every(t => READ_ONLY_TASKS.has(t))) return { decision: 'confirm', note: `auto-approved (level ${level}): ${done.length} verified read-only receipt(s)` };
    if (level >= 2 && types.every(t => READ_ONLY_TASKS.has(t) || VERIFIED_CODE_TASKS.has(t))) {
      return { decision: 'confirm', note: `auto-approved (level ${level}): verified code work; merge still requires green CI` };
    }
    if (level >= 3) return { decision: 'confirm', note: `auto-approved (level ${level}): ${done.length} verified receipt(s), no outgoing spend` };
    return null;
  }

  if (status === 'BLOCKED') {
    const error = String(lastError || [...receipts].reverse().find(r => r?.error)?.error || '');
    if (!error || POLICY_BLOCK.test(error) || BUDGET_EXHAUSTED.test(error)) return null;
    // Operator 2026-10-02: an autonomous coding contract is the authority to keep working. Within it,
    // failures are retried without approvals; the contract budget (steps, tool calls, time) bounds the
    // retries, and when it is used up the mission stops for the operator (BUDGET_EXHAUSTED above).
    // A planner that says the goal is unreachable, or a missing capability, still gets one retry only.
    // Rejected plans do not consume steps, so retries are also capped from the contract itself: each
    // block takes max_failures failed turns, so max_steps / max_failures resumes cover the step budget.
    // autoResumes counts only since the operator's last own decision.
    const budget = mission.contract?.budget || {};
    const contractResumes = Math.ceil((Number(budget.max_steps) || 40) / Math.max(1, Number(budget.max_failures) || 3));
    if (level >= 2 && mission.contract && mission.contract.execution?.autonomous !== false && !CAPABILITY_GAP.test(error) && autoResumes < contractResumes) {
      return { decision: 'resume', note: `auto-resumed (level ${level}): within the autonomous coding contract after "${error.slice(0, 120)}"` };
    }
    if (autoResumes >= MAX_AUTO_RESUMES) return null;
    if (TRANSIENT.test(error) || level >= 3) {
      return { decision: 'resume', note: `auto-resumed (level ${level}): ${TRANSIENT.test(error) ? 'transient' : 'recoverable'} failure "${error.slice(0, 120)}"` };
    }
  }
  return null;
}

// Non-mission gates (typed jobs, staged MCP sources): approved from level 4 / 5, never when spend-related.
export function autoApproveGate(kind, description = '', { level = 0, extraBlocked = [] } = {}) {
  if (spendRelated({ goal: description, receipts: [] }, extraBlocked)) return false;
  if (kind === 'JOB') return level >= 4;
  if (kind === 'MCP_SOURCE') return level >= 5;
  return false;
}
