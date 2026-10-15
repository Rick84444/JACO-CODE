// Operator 2026-10-03: an answer's claims are checked against its receipts before anything approves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const { splitClaims, factsOf, checkClaimsByRules, judgeRequest, parseVerdicts, checkClaims, digest, judgeCandidates } = await import('../../agents/lib/claim-check.mjs');
const { autoResolution, CLAIM_RESUME_NOTE } = await import('../../agents/lib/approval-policy.mjs');

// Shaped like the live mission of 2026-10-03: the answer named 2 of the 5 files the diff shows.
const show = { actionId: 'm:turn:4', type: 'mcp-call', ok: true, verified: true, input: { server: 'git', tool: 'git_show' },
  result: { output: "Commit: '48768d918eebaf8c48afb1019e4642a8a155cc6b'\nDate: datetime.datetime(2026, 10, 3, 18, 39, 53)\nMessage: 'feat(nova): evidence'\n\n--- R/server.ts\n+++ R/server.ts\n@@\n--- R/src/lib/novaActivityText.ts\n+++ R/src/lib/novaActivityText.ts\n--- agents/hands-off-agent.mjs\n" } };
const answer = '1. **Commit 48768d918eebaf8c48afb1019e4642a8a155cc6b** (2026‑10‑03) - feat(nova).\n   - Ändrade filer: `server.ts` och `src/lib/novaActivityText.ts` [#4].\n   - Vad som gjordes: logik för belägg lades till.\n2. Python 3.14.8 släpptes [#4].';

test('claims: lines and sentences; an uncited claim inherits its numbered item\'s citation', () => {
  const claims = splitClaims(answer);
  assert.deepEqual(claims.map(c => c.cites), [[4], [4], [4], [4]]);
  assert.equal(claims[0].inherited, true);
  assert.equal(claims[1].inherited, undefined);
});

test('facts: hashes, paths, versions, dates (with git\'s datetime form) and URLs', () => {
  const kinds = factsOf('Commit 48768d9 changed `agents/x.mjs` and server.ts on 2026-10-03, Node v24.1.0, see https://nodejs.org/en/.').map(f => `${f.kind}:${f.value}`);
  assert.deepEqual(kinds.sort(), ['date:2026-10-03', 'hash:48768d9', 'name:agents/x.mjs', 'path:agents/x.mjs', 'path:server.ts', 'url:https://nodejs.org/en/', 'version:24.1.0'].sort());
});

test('rules: a fact found in no cited receipt is unsupported; facts that are there pass', () => {
  const r = checkClaimsByRules(answer, [show]);
  assert.deepEqual(r.unsupportedFacts.map(u => u.fact), ['3.14.8'], 'the version is in no receipt');
  assert.equal(r.claims[0].unsupported.length, 0, 'hash and date (datetime form) are found');
  assert.equal(r.claims[1].unsupported.length, 0, 'named files exist in the diff');
});

test('judge request: each excerpt once, claims by id, structure of long outputs kept', () => {
  const rules = checkClaimsByRules(answer.replace(' Python 3.14.8 släpptes [#4].', ''), [show]);
  const req = judgeRequest(rules, [show]);
  assert.equal((req.user.match(/\[#4\]/g) || []).length, 1, 'the excerpt is sent once');
  assert.match(req.user, /^C1: /m);
  const long = 'head\n' + 'x\n'.repeat(5000) + '--- a/one.mjs\n' + 'y\n'.repeat(5000) + '--- a/two.mjs\n';
  const d = digest(long, 600);
  assert.ok(d.length <= 700 && d.includes('--- a/one.mjs') && d.includes('--- a/two.mjs'));
  assert.deepEqual(parseVerdicts('ok {"verdicts":[{"id":"C1","verdict":"contradicted","why":"also hands-off-agent.mjs"},{"id":"C9","verdict":"supported"},{"i":2,"verdict":"maybe"}]}', [1, 2]),
    [{ i: 1, verdict: 'contradicted', why: 'also hands-off-agent.mjs' }]);
});

test('full check: a contradicted claim fails it; a failing judge falls through to the next; none leaves rules only', async () => {
  const text = '1. Ändrade filer: `server.ts` [#4].';
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push(JSON.parse(init.body).model);
    if (url.includes('groq')) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"verdicts":[{"id":"C0","verdict":"contradicted","why":"the diff also changes two more files"}]}' } }] }));
  };
  const r = await checkClaims(text, [show], { env: { GROQ_API_KEY: 'k' }, fetchImpl });
  assert.deepEqual(asked, ['openai/gpt-oss-120b', 'gemma3:4b']);
  assert.equal(r.ok, false);
  assert.equal(r.judge, 'ollama/gemma3:4b');
  assert.match(r.contradicted[0].why, /two more files/);
  const none = await checkClaims(text, [show], { env: {}, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual([none.ok, none.judged, none.judgeError], [true, 0, 'offline']);
  const excluded = await checkClaims(text, [show], { env: { GROQ_API_KEY: 'k' }, exclude: ['groq/openai/gpt-oss-120b', 'ollama/gemma3:4b'], fetchImpl });
  assert.equal(excluded.judge, null, 'the planner never judges its own answer');
});

test('policy: a rejected answer goes back to Nova once with the review, then to the operator', () => {
  const mission = { id: 'm', status: 'AWAITING_VERIFICATION', receipts: [show] };
  const bad = { ok: false, contradicted: [{ claim: 1 }], unsupportedFacts: [] };
  const first = autoResolution(mission, { level: 5, claimCheck: bad, claimResumes: 0 });
  assert.equal(first.decision, 'resume');
  assert.ok(first.note.startsWith(CLAIM_RESUME_NOTE));
  assert.equal(autoResolution(mission, { level: 5, claimCheck: bad, claimResumes: 1 }), null);
  assert.equal(autoResolution(mission, { level: 5, claimCheck: { ok: true } }).decision, 'confirm');
});

test('a resumed mission carries the rejected claims for the planner', async t => {
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-claims-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus, { allowedTasks: ['health-check'] });
  const m = control.create({ goal: 'Vilka filer ändrades?', idempotencyKey: 'cc-1' });
  assert.equal(control.get(m.id).answerReview, undefined);
  bus.event('NOVA_CLAIM_CHECK', { missionId: m.id, payload: { ok: false, contradicted: [{ text: 'Ändrade filer: server.ts', why: 'two more files' }], unsupportedFacts: [], partial: [4] } });
  assert.deepEqual(control.get(m.id).answerReview, { rejected: [{ claim: 'Ändrade filer: server.ts', problem: 'contradicted: two more files' }], partialSteps: [4] });
});

test('the planner sees a long MCP output as a digest that still names every file', async () => {
  const { compactMissionForBrain } = await import('../../agents/hands-off-agent.mjs');
  const output = "Commit: 'abc1234'\n" + Array.from({ length: 8 }, (_, i) => `--- a/file${i}.mjs\n+++ b/file${i}.mjs\n` + 'line\n'.repeat(400)).join('');
  const brain = compactMissionForBrain({ receipts: [{ type: 'mcp-call', ok: true, verified: true, actionId: 'm:turn:1', result: { ok: true, output } }] });
  const seen = JSON.stringify(brain.recentReceipts[0].result);
  for (let i = 0; i < 8; i++) assert.ok(seen.includes(`file${i}.mjs`), `file${i}.mjs is visible`);
  assert.ok(seen.length < 4200);
});

test('loose citation forms count, and a single citation covers the answer\'s other claims', async () => {
  const { citedSteps } = await import('../../agents/lib/evidence.mjs');
  assert.deepEqual(citedSteps('Svar ... [Referens: receipt #1] och [#2, #4] men inte #9 eller [utan steg]'), [1, 2, 4]);
  const claims = splitClaims('1. Commit abc ändrade server.ts.\n2. Commit def ändrade x.mjs.\n\n[Referens: receipt #1]');
  assert.deepEqual(claims.map(c => c.cites), [[1], [1]]);
  assert.ok(!factsOf('ändrade server.ts [Referens: receipt #1]').some(f => /receipt/.test(f.value)));
});

test('a planner on Ollama Cloud is never judged by the same model on Groq, and Ollama Cloud judges with another family', () => {
  const env = { GROQ_API_KEY: 'g', OLLAMA_API_KEY: 'o' };
  assert.deepEqual(judgeCandidates(env).map(j => `${j.name}/${j.model}`), ['groq/openai/gpt-oss-120b', 'ollama-cloud/gemma4:31b', 'ollama/gemma3:4b']);
  assert.deepEqual(judgeCandidates(env, { exclude: ['ollama-cloud/gpt-oss:120b'] }).map(j => j.name), ['ollama-cloud', 'ollama']);
  assert.deepEqual(judgeCandidates(env, { exclude: ['groq/openai/gpt-oss-120b'] }).map(j => j.name), ['ollama-cloud', 'ollama']);
  assert.deepEqual(judgeCandidates({}).map(j => j.name), ['ollama']);
});

test('two words joined by a slash are prose, not a path fact; real paths still are', () => {
  const facts = factsOf('Per-file status with added/removed line counts, and/or notes, in agents/lib/claim-check.mjs and src/server.').map(f => f.value);
  assert.ok(!facts.includes('added/removed'));
  assert.ok(!facts.includes('and/or'));
  assert.ok(facts.includes('agents/lib/claim-check.mjs'));
});
