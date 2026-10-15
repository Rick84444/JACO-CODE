// Claim verification (operator 2026-10-03, step 1 of going beyond Claude's design).
// The citation check (evidence.mjs) proves an answer's steps exist; this checks what the answer says.
// 1. Rules: every concrete fact in a claim (commit hash, file path, version, date, URL, `quoted`
//    name) must appear in the receipts the claim cites, or in any receipt if it cites none.
// 2. A cheap independent model (not the planner) judges the claims rules cannot settle against the
//    cited receipt text: supported, contradicted or unclear.
// A fact found in no receipt, or a claim the judge finds contradicted, stops auto-approval; the
// operator sees which claim and why. A claim resting on a cut receipt is reported as partial.
import { citedSteps } from './evidence.mjs';

const stepOf = receipt => Number(/:turn:(\d+)$/.exec(String(receipt?.actionId || ''))?.[1]) || null;
// Models write typographic hyphens and markdown; receipts are plain.
const plain = text => String(text || '').replace(/[‐-―−]/g, '-').replace(/\*\*|__/g, '');

// Claims are lines and sentences. A numbered item ("1. ...") starts a section; a claim without its own
// citation takes the citations of the nearest cited claim in its section (models cite once per item),
// and is marked inherited.
export function splitClaims(answer) {
  const claims = [];
  const trailing = [];
  let section = 0;
  for (const line of plain(answer).split(/\r?\n+/)) {
    if (/^\s*\d+[.)]\s/.test(line)) section++;
    for (const part of line.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9`*-])/)) {
      const text = part.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim();
      // A line that is only a citation is not a claim; its steps still count for the answer.
      if (text.replace(CITE_BRACKET, '').trim().length >= 15) claims.push({ text, cites: citedSteps(text), section });
      else if (citedSteps(text).length) trailing.push(...citedSteps(text));
    }
  }
  for (const [i, claim] of claims.entries()) {
    if (claim.cites.length) continue;
    const same = c => c.section === claim.section && c.section > 0 && c.cites.length && !c.inherited;
    const donor = claims.slice(0, i).reverse().find(same) || claims.slice(i + 1).find(same);
    if (donor) { claim.cites = donor.cites; claim.inherited = true; }
  }
  // An answer that cites only once (e.g. a trailing "[receipt #1]") covers its other claims with it.
  const answerCites = [...new Set([...claims.flatMap(c => c.cites), ...trailing])].sort((x, y) => x - y);
  for (const claim of claims) if (!claim.cites.length && answerCites.length) { claim.cites = answerCites; claim.inherited = true; }
  return claims.map(({ text, cites, inherited }) => ({ text, cites, ...(inherited ? { inherited } : {}) }));
}

// A citation bracket in any form evidence.mjs accepts: [#2], [#1, #3], [Referens: receipt #1].
const CITE_BRACKET = /\[[^\]\n]*#\s*\d[^\]\n]*\]/g;
const HASH =/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi;
const URL_RE = /https?:\/\/[^\s)\]<>"'`]+/g;
const TICKED = /`([^`\n]{2,120})`/g;
const PATH = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+|\b[A-Za-z0-9_-]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|md|py|ps1|yml|yaml|css|html|sh)\b/g;
const VERSION = /\bv?\d+\.\d+\.\d+(?:\.\d+)?\b/g;
const DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

export function factsOf(claimText) {
  const text = claimText.replace(CITE_BRACKET, ' ');
  const facts = new Map();
  const add = (kind, value, alternatives = []) => { const key = `${kind}:${value.toLowerCase()}`; if (!facts.has(key)) facts.set(key, { kind, value, alternatives }); };
  const urls = [...text.matchAll(URL_RE)].map(m => m[0].replace(/[.,;:]+$/, ''));
  urls.forEach(u => add('url', u, [u.replace(/\/$/, '')]));
  const rest = urls.reduce((t, u) => t.replace(u, ' '), text);
  for (const m of rest.matchAll(HASH)) add('hash', m[0], [m[0].slice(0, 7)]);
  for (const m of rest.matchAll(TICKED)) if (!/\s/.test(m[1].trim()) || m[1].includes('/')) add('name', m[1].trim());
  // Two plain words joined by a slash ("added/removed", "and/or") are prose, not a path (2026-10-08: a
  // correct answer was held back for "added/removed"). The claim itself is still judged.
  for (const m of rest.matchAll(PATH)) if (!/^\d+(\.\d+)+$/.test(m[0]) && !/^[A-Za-z]+\/[A-Za-z]+$/.test(m[0])) add('path', m[0]);
  for (const m of rest.matchAll(VERSION)) add('version', m[0].replace(/^v/, ''));
  // Git prints some dates as datetime.datetime(2026, 10, 3, ...).
  for (const m of rest.matchAll(DATE)) add('date', m[0], [`datetime(${Number(m[1])}, ${Number(m[2])}, ${Number(m[3])}`]);
  return [...facts.values()];
}

export function receiptText(receipt) {
  return JSON.stringify({ input: receipt?.input ?? null, result: receipt?.result ?? null })
    .replace(/\\\\/g, '/').replace(/\\n/g, '\n').replace(/\\"/g, '"').toLowerCase();
}

const found = (fact, text) => [fact.value, ...fact.alternatives].some(v => v && text.includes(String(v).toLowerCase().replace(/\\/g, '/')));

// Rules only; synchronous. receipts: the mission's receipts.
export function checkClaimsByRules(answer, receipts = []) {
  const byStep = new Map(receipts.map(r => [stepOf(r), r]));
  const allText = receipts.map(receiptText).join('\n');
  const claims = splitClaims(answer).map((claim, i) => {
    const cited = claim.cites.map(n => byStep.get(n)).filter(Boolean);
    const scope = cited.length ? cited.map(receiptText).join('\n') : allText;
    const facts = factsOf(claim.text);
    const unsupported = facts.filter(f => !found(f, scope)).map(f => f.value);
    const partial = cited.filter(r => r.result?.truncated === true).map(stepOf);
    return { i, text: claim.text.slice(0, 400), cites: claim.cites, facts: facts.length, unsupported, partial };
  });
  return { claims, unsupportedFacts: claims.flatMap(c => c.unsupported.map(fact => ({ claim: c.i, fact }))) };
}

const JUDGE_PROMPT = 'You check an agent\'s answer against tool output. Compare each claim ONLY with the evidence excerpts it names. verdict: "supported" if the excerpts state it; "contradicted" if they state something incompatible, including a claim that presents a list as complete (for example "changed files: A and B") while the excerpt names further items of the same kind; "unclear" if the excerpts do not cover it. Use each claim\'s id exactly as given (C1, C2, ...). Return JSON only: {"verdicts":[{"id":"C1","verdict":"supported|contradicted|unclear","why":"short reason naming what the excerpt shows"}]}.';

// Claims rules cannot settle (no concrete facts) that cite receipts go to the judge, with bounded
// excerpts: the judge's prompt must fit a free tier (Groq: 8k tokens per minute).
// An excerpt that keeps a long output's structure: its head, then the lines that name things (diff
// file headers, commit fields, headings, titles), so a claim like "changed files X and Y" can be
// compared with every file the output names, not only the first screen.
const KEY_LINE = /^(?:diff --git |--- |\+\+\+ |Commit:|Author:|Date:|Message:|#{1,3} |Title:|URL:|Source:|Version)/;
export function digest(text, max) {
  const s = String(text || '');
  if (s.length <= max) return s;
  const head = s.slice(0, Math.floor(max * 0.4));
  const keys = [];
  let used = head.length;
  for (const line of s.slice(head.length).split('\n')) {
    if (!KEY_LINE.test(line) || keys.includes(line)) continue;
    if (used + line.length + 1 > max) break;
    keys.push(line); used += line.length + 1;
  }
  return `${head}\n[... key lines of the rest:]\n${keys.join('\n')}`;
}

export function judgeRequest(ruleResult, receipts, { maxClaims = 12, totalChars = 9000 } = {}) {
  const byStep = new Map(receipts.map(r => [stepOf(r), r]));
  const claims = ruleResult.claims.filter(c => c.cites.length && !c.unsupported.length).slice(0, maxClaims);
  if (!claims.length) return null;
  const steps = [...new Set(claims.flatMap(c => c.cites))].filter(n => byStep.has(n));
  // Each excerpt is sent once, and the claims refer to it: the prompt must fit a free tier.
  const budget = Math.max(600, Math.floor(totalChars / Math.max(1, steps.length)));
  const evidence = steps.map(n => {
    const r = byStep.get(n);
    const body = typeof r.result?.output === 'string' ? r.result.output : JSON.stringify(r.result ?? null);
    return `[#${n}] ${r.type} ${JSON.stringify(r.input || {})}${r.result?.truncated ? ' (output was cut when recorded)' : ''}\n${digest(body, budget)}`;
  }).join('\n\n');
  const list = claims.map(c => `C${c.i}: ${c.text.replace(CITE_BRACKET, '').trim()} (evidence ${c.cites.map(n => `#${n}`).join(', ')})`).join('\n');
  return { claims: claims.map(c => c.i), system: JUDGE_PROMPT, user: `Evidence excerpts:\n${evidence}\n\nClaims:\n${list}` };
}

export function parseVerdicts(text, claimIds) {
  const match = /\{[\s\S]*\}/.exec(String(text || ''));
  if (!match) throw new Error('JUDGE_NO_JSON');
  const verdicts = JSON.parse(match[0]).verdicts;
  if (!Array.isArray(verdicts)) throw new Error('JUDGE_NO_VERDICTS');
  const idOf = v => Number(/^C?(\d+)$/i.exec(String(v?.id ?? v?.i ?? ''))?.[1] ?? NaN);
  return verdicts.filter(v => claimIds.includes(idOf(v)) && ['supported', 'contradicted', 'unclear'].includes(v.verdict))
    .map(v => ({ i: idOf(v), verdict: v.verdict, why: String(v.why || '').slice(0, 200) }));
}

// The same model under different providers' names ('openai/gpt-oss-120b' on Groq, 'gpt-oss:120b' on
// Ollama Cloud) is one model for the purpose of "never grades its own answer".
export const modelIdentity = model => String(model || '').toLowerCase().split('/').pop().replace(/[^a-z0-9]/g, '');

// Judges in order of preference; each { name, model, url, key }. The planner's own model is excluded
// by the caller (as 'provider/model'), so a model never grades its own answer, whichever provider
// served it. Ollama Cloud's judge is gemma4:31b: in the operator's free plan, a different family from
// the gpt-oss planners, and it found a planted contradiction in about a second (2026-10-04).
export function judgeCandidates(env = process.env, { exclude = [] } = {}) {
  const list = [];
  if (env.GROQ_API_KEY) list.push({ name: 'groq', model: env.JACO_CLAIM_JUDGE_GROQ_MODEL || 'openai/gpt-oss-120b', url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY });
  if (env.OLLAMA_API_KEY) list.push({ name: 'ollama-cloud', model: env.JACO_CLAIM_JUDGE_OLLAMA_CLOUD_MODEL || 'gemma4:31b', url: `${env.OLLAMA_CLOUD_URL || 'https://ollama.com'}/v1/chat/completions`, key: env.OLLAMA_API_KEY });
  list.push({ name: 'ollama', model: env.JACO_CLAIM_JUDGE_OLLAMA_MODEL || env.JACO_OLLAMA_LOCAL_MODEL || 'gemma3:4b', url: `${env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'}/v1/chat/completions`, key: 'ollama' });
  const excluded = new Set(exclude.map(e => modelIdentity(String(e).slice(String(e).indexOf('/') + 1))));
  return list.filter(j => !exclude.includes(`${j.name}/${j.model}`) && !excluded.has(modelIdentity(j.model)));
}

async function askJudge(judge, request, fetchImpl) {
  const res = await fetchImpl(judge.url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${judge.key}` },
    body: JSON.stringify({ model: judge.model, temperature: 0, max_tokens: 2048,
      ...(judge.name === 'groq' ? { reasoning_effort: 'low' } : {}),
      messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }] }),
    signal: AbortSignal.timeout(judge.name === 'ollama' ? 240_000 : 60_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`JUDGE_HTTP_${res.status}`);
  return parseVerdicts(body?.choices?.[0]?.message?.content, request.claims);
}

// The full check. ok is false when a fact was found in no receipt or a claim was contradicted; a judge
// that could not run leaves those claims unjudged (reported), never approved by default reasoning.
export async function checkClaims(answer, receipts = [], { env = process.env, fetchImpl = fetch, exclude = [] } = {}) {
  const rules = checkClaimsByRules(answer, receipts);
  const request = judgeRequest(rules, receipts);
  let judge = null, verdicts = [], judgeError = null;
  if (request) {
    for (const candidate of judgeCandidates(env, { exclude })) {
      try { verdicts = await askJudge(candidate, request, fetchImpl); judge = `${candidate.name}/${candidate.model}`; judgeError = null; break; }
      catch (error) { judgeError = String(error?.message || error).slice(0, 160); }
    }
  }
  const contradicted = verdicts.filter(v => v.verdict === 'contradicted');
  return {
    claims: rules.claims.length,
    facts: rules.claims.reduce((n, c) => n + c.facts, 0),
    unsupportedFacts: rules.unsupportedFacts.map(u => ({ ...u, text: rules.claims[u.claim].text })),
    partial: [...new Set(rules.claims.flatMap(c => c.partial))],
    judged: verdicts.length, judge, judgeError,
    contradicted: contradicted.map(v => ({ claim: v.i, why: v.why, text: rules.claims[v.i]?.text })),
    unclear: verdicts.filter(v => v.verdict === 'unclear').length,
    ok: rules.unsupportedFacts.length === 0 && contradicted.length === 0,
  };
}
