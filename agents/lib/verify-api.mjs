// JACO Verify API (operator 2026-10-04: JACO Autonomus IDE is the free product, its capabilities are the
// paid API). Agent builders send an answer and the evidence it rests on; JACO checks every claim the
// way it checks Nova's own answers (agents/lib/claim-check.mjs): concrete facts against the evidence by
// rules, the rest by an independent model. A small free quota per client, then x402 per call.
import { checkClaims } from './claim-check.mjs';

export const VERIFY_PRICE_USD = 0.02;
export const FREE_PER_DAY = 25;
const MAX_ANSWER = 8000, MAX_EVIDENCE = 10, MAX_TEXT = 20_000;

export function validateVerifyRequest(body) {
  const answer = typeof body?.answer === 'string' ? body.answer.trim() : '';
  if (!answer) throw new Error('ANSWER_REQUIRED');
  if (answer.length > MAX_ANSWER) throw new Error(`ANSWER_TOO_LONG:max ${MAX_ANSWER}`);
  const evidence = Array.isArray(body?.evidence) ? body.evidence : null;
  if (!evidence || !evidence.length) throw new Error('EVIDENCE_REQUIRED');
  if (evidence.length > MAX_EVIDENCE) throw new Error(`TOO_MUCH_EVIDENCE:max ${MAX_EVIDENCE}`);
  const items = evidence.map((e, i) => {
    const text = typeof e === 'string' ? e : typeof e?.text === 'string' ? e.text : '';
    if (!text.trim()) throw new Error(`EVIDENCE_TEXT_REQUIRED:${i + 1}`);
    if (text.length > MAX_TEXT) throw new Error(`EVIDENCE_TOO_LONG:${i + 1}:max ${MAX_TEXT}`);
    return { n: i + 1, text, source: typeof e?.source === 'string' ? e.source.slice(0, 500) : null };
  });
  return { answer, evidence: items };
}

// Evidence item n is cited in the answer as [#n]. Each item becomes a verified receipt for the checker.
export async function verifyAnswer(body, { env = process.env, fetchImpl = fetch } = {}) {
  const { answer, evidence } = validateVerifyRequest(body);
  const receipts = evidence.map(e => ({ actionId: `verify:turn:${e.n}`, type: 'evidence', ok: true, verified: true, input: e.source ? { source: e.source } : {}, result: { output: e.text } }));
  const r = await checkClaims(answer, receipts, { env, fetchImpl });
  return {
    ok: r.ok,
    claims: r.claims,
    factsChecked: r.facts,
    unsupportedFacts: r.unsupportedFacts.map(u => ({ fact: u.fact, claim: u.text })),
    contradicted: r.contradicted.map(c => ({ claim: c.text, why: c.why })),
    unclear: r.unclear,
    judged: r.judged,
    judge: r.judge ? 'independent model' : null,
    judgeError: r.judgeError ? 'judge unavailable; facts were checked by rules only' : null,
  };
}

export function verifyOffer(env = process.env) {
  const base = String(env.JACO_GATEWAY_PUBLIC_URL || '').replace(/\/+$/, '');
  return {
    service: 'jaco-verify',
    description: 'Checks an AI answer against the evidence it rests on. Concrete facts (hashes, paths, versions, dates, URLs, names) are matched against the evidence; other claims are judged by an independent model. A list presented as complete is flagged when the evidence names more items.',
    price: { amount: VERIFY_PRICE_USD, currency: 'USD', free: `${FREE_PER_DAY} checks per client per day`, paid: 'x402, USDC on Base, per check' },
    request: { method: 'POST', url: `${base}/v1/verify`, body: { answer: 'The release is 3.14.8 [#1].', evidence: [{ text: 'Python 3.14.8 - Sept. 30, 2026', source: 'https://www.python.org/downloads/' }] } },
    citation: 'Cite evidence item n as [#n] in the answer; uncited claims are checked against all evidence.',
  };
}

export function verifyBazaar(env = process.env) {
  const example = verifyOffer(env).request.body;
  return {
    info: { input: { type: 'http', method: 'POST', bodyType: 'json', body: example }, output: { type: 'json', example: { ok: false, claims: 2, factsChecked: 1, unsupportedFacts: [], contradicted: [{ claim: 'Changed files: a.ts and b.ts', why: 'the evidence lists a third file' }] } } },
    schema: { properties: { input: { type: 'object', properties: { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['POST'] }, bodyType: { type: 'string', enum: ['json'] },
      body: { type: 'object', properties: { answer: { type: 'string' }, evidence: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, source: { type: 'string' } }, required: ['text'] } } }, required: ['answer', 'evidence'] } },
      required: ['type', 'method', 'bodyType', 'body'], additionalProperties: false }, output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } } } } },
    routeTemplate: '/v1/verify',
  };
}

// Free quota per client address and UTC day.
export function freeQuota(limit = FREE_PER_DAY) {
  const used = new Map();
  return {
    take(client, now = Date.now()) {
      const key = `${new Date(now).toISOString().slice(0, 10)}|${client}`;
      const n = used.get(key) || 0;
      if (n >= limit) return false;
      used.set(key, n + 1);
      if (used.size > 50_000) used.clear();
      return true;
    },
  };
}
