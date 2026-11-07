#!/usr/bin/env node
// Measures how reliably Aura finishes simple web missions against the running JACO stack.
//
//   node tools/eval-web-missions.mjs [--runs 3] [--url http://127.0.0.1:3000] [--out results.json] [--only 1,4]
//
// Each case starts a real autonomous mission, waits for it to finish (at most four minutes), and checks the answer
// against what the page really says. Every case costs model calls: about 0.01-0.05 USD each with a small cloud model.
// The result is a pass rate per case and overall, so a change can be judged by a number instead of an impression.
import fs from 'node:fs';

export const CASES = [
  { id: 'click-title', goal: 'Open https://example.com in the browser, click the link on the page, and tell me the title of the page you land on.', expect: /Example Domains|IANA/i },
  { id: 'click-address', goal: 'Open https://example.org in the browser, click the link on the page, and tell me the web address you end up on.', expect: /iana\.org/i },
  { id: 'read-heading', goal: 'Open https://example.net in the browser and tell me the exact heading text shown on the page. Do not click anything.', expect: /Example Domain/i },
  { id: 'form-field', goal: 'Open https://httpbin.org/forms/post in the browser, type Alice into the customer name field, and tell me the label of the button that submits the form. Do not submit it.', expect: /submit order/i },
  { id: 'read-other-site', goal: 'Open https://www.iana.org/domains/reserved in the browser and tell me the first heading on the page.', expect: /Reserved Domains|IANA-managed/i },
  { id: 'click-then-read', goal: 'Open https://example.com in the browser, click the link, and then tell me the name of the first link in the page menu.', expect: /domains|protocols|numbers|about/i },
];

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback; };

export async function runCase(base, testCase, { timeoutMs = 4 * 60_000, pollMs = 8000, fetchImpl = fetch } = {}) {
  const api = async (path, body) => (await fetchImpl(base + path, body
    ? { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) }
    : { headers: { origin: base } })).json();
  const tag = `[EVAL-${testCase.id}-${Date.now() % 100000}]`;
  const started = Date.now();
  await api('/api/aura/workbench/start-goal', { executionMode: 'autonomous', goal: `${tag} ${testCase.goal}` });
  let mission = null, blockedPolls = 0;
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    mission = ((await api('/api/aura/workbench')).missions || []).find(m => String(m.goal).startsWith(tag)) || mission;
    if (!mission) continue;
    if (['DONE', 'FAILED', 'CANCELLED', 'AWAITING_VERIFICATION'].includes(mission.status)) break;
    blockedPolls = mission.status === 'BLOCKED' ? blockedPolls + 1 : 0;
    if (blockedPolls >= 6) break;
  }
  const answer = String(mission?.answer || '');
  const pass = testCase.expect.test(answer);
  // A case that did not finish is stopped, so the next one starts on an empty queue.
  if (mission && ['ACTIVE', 'BLOCKED'].includes(mission.status)) await api(`/api/aura/workbench/missions/${mission.id}/cancel`, { note: 'evaluation case finished' }).catch(() => {});
  return { case: testCase.id, pass, status: mission?.status || 'NO_MISSION', steps: mission?.step ?? null, seconds: Math.round((Date.now() - started) / 1000), answer: answer.slice(0, 300), missionId: mission?.id || null };
}

export function summarize(results) {
  const byCase = {};
  for (const r of results) (byCase[r.case] ||= []).push(r.pass);
  const cases = Object.fromEntries(Object.entries(byCase).map(([id, list]) => [id, `${list.filter(Boolean).length}/${list.length}`]));
  const passed = results.filter(r => r.pass).length;
  return { passed, total: results.length, rate: results.length ? Math.round((passed / results.length) * 100) : 0, cases };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('eval-web-missions.mjs')) {
  const base = arg('--url', 'http://127.0.0.1:3000').replace(/\/+$/, '');
  const runs = Math.max(1, Number(arg('--runs', 1)));
  const only = arg('--only', null)?.split(',').map(Number);
  const out = arg('--out', null);
  const selected = CASES.filter((_, i) => !only || only.includes(i + 1));
  const results = [];
  for (let run = 1; run <= runs; run++) {
    for (const testCase of selected) {
      const r = await runCase(base, testCase);
      results.push({ run, ...r });
      console.log(`run ${run} ${r.pass ? 'PASS' : 'FAIL'} ${r.case} ${r.status} steps=${r.steps ?? '?'} ${r.seconds}s | ${r.answer.slice(0, 120).replace(/\n/g, ' ')}`);
      if (out) fs.writeFileSync(out, JSON.stringify({ results, summary: summarize(results) }, null, 2));
      await new Promise(r => setTimeout(r, 4000));
    }
  }
  const s = summarize(results);
  console.log(`\n${s.passed}/${s.total} passed (${s.rate}%)`);
  for (const [id, score] of Object.entries(s.cases)) console.log(`  ${id}: ${score}`);
}
