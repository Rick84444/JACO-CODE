// Operator 2026-10-04: JACO's answer checking as a paid API (free quota, then x402).
import test from 'node:test';
import assert from 'node:assert/strict';
const { validateVerifyRequest, verifyAnswer, freeQuota, verifyOffer, verifyBazaar } = await import('../../agents/lib/verify-api.mjs');
const { paymentRequired } = await import('../../agents/lib/x402-seller.mjs');

test('requests are validated before anything is charged', () => {
  assert.throws(() => validateVerifyRequest({}), /ANSWER_REQUIRED/);
  assert.throws(() => validateVerifyRequest({ answer: 'x' }), /EVIDENCE_REQUIRED/);
  assert.throws(() => validateVerifyRequest({ answer: 'x', evidence: [{ text: ' ' }] }), /EVIDENCE_TEXT_REQUIRED:1/);
  assert.throws(() => validateVerifyRequest({ answer: 'x', evidence: Array(11).fill('e') }), /TOO_MUCH_EVIDENCE/);
  assert.deepEqual(validateVerifyRequest({ answer: ' a ', evidence: ['plain text', { text: 't', source: 'https://s' }] }).evidence.map(e => [e.n, e.source]), [[1, null], [2, 'https://s']]);
});

test('a fact missing from the evidence and a contradicted claim fail the answer', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"verdicts":[{"id":"C1","verdict":"contradicted","why":"the evidence lists a third file"}]}' } }] }));
  const r = await verifyAnswer({ answer: 'Python 3.14.9 is the latest [#1].\nChanged files: a.ts and b.ts [#2].', evidence: ['Python 3.14.8 - Sept. 30, 2026', '--- a/a.ts\n--- a/b.ts\n--- a/c.ts'] }, { env: { GROQ_API_KEY: 'k' }, fetchImpl });
  assert.equal(r.ok, false);
  assert.deepEqual(r.unsupportedFacts.map(u => u.fact), ['3.14.9']);
  assert.match(r.contradicted[0].why, /third file/);
  assert.equal(r.judge, 'independent model', 'the judge model is not disclosed');
});

test('free quota per client and day; the 402 carries the endpoint price and its own Bazaar metadata', () => {
  const q = freeQuota(2);
  const t = Date.parse('2026-10-04T10:00:00Z');
  assert.deepEqual([q.take('a', t), q.take('a', t), q.take('a', t), q.take('b', t), q.take('a', t + 86400000)], [true, true, false, true, true]);
  const env = { X402_PAY_TO: '0x' + '1'.repeat(40), CDP_API_KEY_ID: 'i', CDP_API_KEY_SECRET: 's', JACO_GATEWAY_PUBLIC_URL: 'https://api.example.test' };
  const pr = paymentRequired('https://api.example.test/v1/verify', env, { priceUsd: 0.02, description: verifyOffer(env).description, bazaar: verifyBazaar(env) });
  assert.equal(pr.accepts[0].amount, '20000');
  assert.equal(pr.extensions.bazaar.routeTemplate, '/v1/verify');
  assert.equal(paymentRequired('https://api.example.test/v1/repo-scan', { ...env, SKYFIRE_REPO_SCAN_PRICE_USD: '0.5' }).accepts[0].amount, '500000', 'the repo scan keeps its own price');
});


test('a genuine consistency success is explicitly limited to unverified caller-provided evidence', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify({choices:[{message:{content:
      '{"verdicts":[{"id":"C0","verdict":"supported","why":"the supplied excerpt contains version 3.14.8"}]}'}}]}));
  };
  const r = await verifyAnswer({
    answer:'The release version is 3.14.8 [#1].',
    evidence:[{text:'Release version 3.14.8',source:'https://example.test/release'}],
  },{env:{GROQ_API_KEY:'existing-paid-key',OLLAMA_API_KEY:'cloud-key'},fetchImpl});
  assert.equal(r.ok,true);
  assert.equal(r.verdict,'SUPPORTED_BY_SUPPLIED_EVIDENCE');
  assert.equal(r.sourceAuthenticity,'NOT_CHECKED');
  assert.equal(r.evidenceProvenance,'CALLER_SUPPLIED_UNVERIFIED');
  assert.equal(r.scope,'CLAIM_EVIDENCE_CONSISTENCY_ONLY');
  assert.equal(r.judged,r.claims);
  assert.equal(calls.length,1);
  assert.equal(new URL(calls[0]).hostname,'127.0.0.1', 'paid API credentials must not select cloud judges');
});

test('a missing or failing local judge never produces a false successful verification', async () => {
  const r = await verifyAnswer({answer:'The release version is 3.14.8 [#1].',
    evidence:['Release version 3.14.8']},{
    env:{GROQ_API_KEY:'paid-key'},
    fetchImpl:async ()=>{throw new Error('local Ollama offline');},
  });
  assert.equal(r.ok,false);
  assert.equal(r.verdict,'INCONCLUSIVE');
  assert.equal(r.judged,0);
  assert.match(r.judgeError,/no positive verification/);
});

test('a partial model review is INCONCLUSIVE even if all inspected claims passed', async () => {
  const r = await verifyAnswer({
    answer:'The version is 3.14.8 [#1].\nThe release was published today [#1].',
    evidence:['Version 3.14.8 was released today.'],
  },{
    env:{},
    fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:
      '{"verdicts":[{"id":"C0","verdict":"supported","why":"listed"}]}'}}]})),
  });
  assert.equal(r.claims,2);
  assert.equal(r.judged,1);
  assert.equal(r.verdict,'INCONCLUSIVE');
  assert.equal(r.ok,false);
});

test('a mismatched version remains UNSUPPORTED; zero inspectable claims cannot be approved', async () => {
  const mismatched = await verifyAnswer({
    answer:'The version is 3.14.9 [#1].',evidence:['Version 3.14.8 was released.'],
  },{env:{},fetchImpl:async()=>{throw new Error('offline');}});
  assert.equal(mismatched.verdict,'UNSUPPORTED');
  assert.equal(mismatched.ok,false);
  const empty = await verifyAnswer({answer:'Hello!',evidence:['Hello!']},{
    env:{},fetchImpl:async()=>{throw new Error('should never request model');},
  });
  assert.equal(empty.claims,0);
  assert.equal(empty.verdict,'INCONCLUSIVE');
  assert.equal(empty.ok,false);
});

test('non-local judge endpoint cannot become a paid side channel through OLLAMA_BASE_URL', async () => {
  const urls=[];
  await verifyAnswer({answer:'The version is 3.14.8 [#1].',evidence:['Version 3.14.8']},{
    env:{OLLAMA_BASE_URL:'https://ollama.com',OLLAMA_API_KEY:'paid-cloud-key'},
    fetchImpl:async(url)=>{urls.push(String(url)); throw new Error('offline');},
  });
  assert.ok(urls.length>0);
  assert.ok(urls.every(url=>url.startsWith('http://127.0.0.1:11434/')));
});


test('uncited claims are checked against all supplied excerpts and cannot silently pass unjudged', async () => {
  const observed = [];
  const r = await verifyAnswer({
    answer: 'The version is 3.14.8.',
    evidence: ['Version 3.14.8.', 'Release notes match version 3.14.8.'],
  },{
    env:{},
    fetchImpl:async(url,opts)=>{
      const payload=JSON.parse(opts.body);
      observed.push(payload.messages?.[1]?.content||'');
      return new Response(JSON.stringify({choices:[{message:{content:
        '{"verdicts":[{"id":"C0","verdict":"supported","why":"both excerpts support version 3.14.8"}]}'}}]}));
    },
  });
  assert.equal(r.claims,1);
  assert.equal(r.judged,1);
  assert.equal(r.verdict,'SUPPORTED_BY_SUPPLIED_EVIDENCE');
  assert.equal(r.ok,true);
  assert.match(observed[0], /\[#1\]/);
  assert.match(observed[0], /\[#2\]/);
});
