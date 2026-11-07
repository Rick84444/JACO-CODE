import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needsFor } from '../../agents/lib/capability-needs.mjs';
import { createPlanComments, planView } from '../../runtime/src/server/connected/auraPlan.mjs';

test('each step shows what it needs, and what leaves the computer or touches money needs approval', () => {
  const kinds = s => needsFor(s, { language: 'sv' }).map(n => n.kind + (n.approval ? '!' : ''));
  assert.deepEqual(kinds('Undersök trender inom lokala AI-verktyg'), ['research', 'skill']);
  assert.ok(kinds('Skapa ett konto på plattformen och publicera ett inlägg').includes('account!'));
  assert.ok(kinds('Skapa ett konto på plattformen och publicera ett inlägg').includes('publish!'));
  assert.ok(kinds('Sätt ett pris och ta betalt med Stripe').includes('payment!'));
  assert.ok(kinds('Bygg en webbsida för bageriet').includes('code'));
  assert.ok(needsFor('Bygg en webbsida för bageriet').some(n => n.kind === 'skill' && n.id === 'build-web-page'));
});

test('the plan view gives the final goal, each step in the chosen language with needs, progress, changes and comments', () => {
  const graph = { id: 'g1', title: 'Fler användare', objective: 'Få 100 användare att prova JACO', status: 'ACTIVE',
    nodes: [
      { key: 'research', title: 'Undersök var målgruppen finns', objective: 'Sök efter forum och trender', status: 'VERIFIED', dependencies: [] },
      { key: 'account', title: 'Skapa konto', objective: 'Registrera ett konto för Aura på plattformen', status: 'READY', dependencies: ['research'] },
      { key: 'old', title: 'Gammal idé', objective: 'Annonsera', status: 'SUPERSEDED', dependencies: [] },
    ],
    replans: [{ created_at: 1794000000, reason: 'Annonser når inte utvecklare', failed_node_key: 'old', replacement_node_key: 'research' }] };
  const v = planView(graph, { language: 'sv', comments: [{ graphId: 'g1', nodeKey: 'account', text: 'Använd jacocode-adressen' }, { graphId: 'g1', nodeKey: null, text: 'Fokusera på Sverige först' }] });
  assert.equal(v.objective, 'Få 100 användare att prova JACO');
  assert.deepEqual(v.progress, { done: 1, total: 2 });
  assert.equal(v.nodes[0].statusText, 'Klart');
  assert.equal(v.nodes[1].statusText, 'Redo');
  assert.ok(v.needsApproval.some(n => n.kind === 'account'));
  assert.equal(v.nodes[1].comments[0].text, 'Använd jacocode-adressen');
  assert.equal(v.comments[0].text, 'Fokusera på Sverige först');
  assert.equal(v.changes[0].reason, 'Annonser når inte utvecklare');
  assert.match(v.changes[0].at, /^20\d\d-/);
});

test('comments are kept per plan and step, and an empty or missing one is refused', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  try {
    const c = createPlanComments({ file: path.join(d, 'comments.json') });
    c.add({ graphId: 'g1', text: 'Fokusera på Sverige först' });
    c.add({ graphId: 'g1', nodeKey: 'account', text: 'Använd jacocode-adressen' });
    c.add({ graphId: 'g2', text: 'Annat mål' });
    assert.equal(c.list('g1').length, 2);
    assert.throws(() => c.add({ graphId: 'g1', text: ' ' }), /PLAN_COMMENT_TEXT_INVALID/);
    assert.throws(() => c.add({ text: 'utan plan' }), /PLAN_COMMENT_GRAPH_REQUIRED/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('a step of a plan is told to keep the final goal in view and replan when it does not lead there', async () => {
  const { agentSystemFor, PLAN_RULE } = await import('../../agents/hands-off-agent.mjs');
  assert.ok(agentSystemFor(['web-fetch'], 'win32', true, 'sv').includes(PLAN_RULE));
  assert.match(PLAN_RULE, /request_replan/);
  assert.match(PLAN_RULE, /operator's comments on the plan/);
});

test('each need shows whether Aura has it, lacks it or needs approval, and Aura says in her own words what she lacks', async () => {
  const { needStatus, gapSummary } = await import('../../runtime/src/server/connected/auraPlan.mjs');
  const available = { tasks: new Set(['web-fetch', 'repo-write']), skills: new Set(['web-research']), payments: false };
  assert.equal(needStatus({ kind: 'research' }, available), 'have');
  assert.equal(needStatus({ kind: 'browser' }, available), 'missing');
  assert.equal(needStatus({ kind: 'account' }, available), 'approval');
  assert.equal(needStatus({ kind: 'skill', id: 'build-web-page' }, available), 'missing');
  assert.equal(needStatus({ kind: 'skill', id: 'web-research' }, available), 'have');
  assert.equal(needStatus({ kind: 'payment' }, available), 'missing');
  const graph = { id: 'g', title: 'T', objective: 'Sälj digitala mallar', status: 'ACTIVE', nodes: [
    { key: 'a', title: 'Bygg en webbsida för mallarna', objective: 'Bygg sidan', status: 'READY', dependencies: [] },
    { key: 'b', title: 'Ta betalt', objective: 'Sätt ett pris och ta betalt', status: 'BLOCKED', dependencies: ['a'] },
  ] };
  const v = planView(graph, { language: 'sv', available });
  assert.match(v.abilities.text, /^Jag har gått igenom målet och mina förmågor\. Det här saknar jag än:/);
  assert.match(v.abilities.text, /build-web-page/);
  assert.match(v.abilities.text, /betalkoppling/);
  const ok = gapSummary([{ needs: [{ kind: 'research', state: 'have' }] }], 'sv');
  assert.deepEqual(ok.missing, []);
  assert.match(ok.text, /^Jag har det som planen behöver/);
  assert.equal(planView(graph, { language: 'sv' }).abilities, null, 'without knowing what is available, nothing is claimed');
});
