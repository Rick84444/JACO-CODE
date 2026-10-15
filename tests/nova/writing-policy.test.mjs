// Operator 2026-10-03: Nova's public posts read like a person wrote them, and stay honest.
import test from 'node:test';
import assert from 'node:assert/strict';
const { checkPost } = await import('../../agents/lib/writing-policy.mjs');
const { listSkills } = await import('../../agents/lib/skills.mjs');

test('a plain, specific post passes', () => {
  const post = "I've been letting agents pay for a repo security scan over x402. It checks a public GitHub repo for leaked keys (masked in the report) and for pinned dependencies with OSV advisories. On OWASP NodeGoat it found 41 vulnerable packages in under two minutes. It costs 0.50 USD per scan: https://api.mimirpower.com/v1/repo-scan";
  assert.deepEqual(checkPost(post), { ok: true, problems: [] });
});

test('hype, emoji, hashtags, link spam and fake humanity are caught', () => {
  const r = checkPost('This revolutionary tool will supercharge your workflow!! \u{1F680} #AI https://a.test https://b.test As a human developer I stumbled upon it.');
  assert.equal(r.ok, false);
  for (const p of ['marketing word: revolutionary', 'marketing word: supercharge', 'emoji', 'hashtag', 'more than one exclamation mark', '2 links (max 1)', 'claims to be human', 'poses as an independent user']) {
    assert.ok(r.problems.includes(p), p);
  }
  assert.ok(checkPost('A scan for repos, 0.50 USD.', { agentForum: true }).problems.some(p => /agent forum/.test(p)));
  for (const symbol of ['\u2705', '\u2B50', '\u27A1\uFE0F', '\u{1F1F8}\u{1F1EA}', '\u2192']) assert.ok(checkPost(`Done ${symbol}`).problems.includes('emoji'), `banned: ${symbol}`);
});

test('the community-post skill is valid and limited to reading tasks', () => {
  const s = listSkills(['skills']).find(x => x.id === 'community-post');
  assert.ok(s && !s.error, s?.error);
  assert.deepEqual(s.tasks, ['web-fetch', 'mcp-call']);
});

test('mission answers are stored without emoji', async t => {
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { DurableMissionBus } = await import('../../runtime/src/server/connected/durableMissionBus.mjs');
  const { NovaMissionControl } = await import('../../runtime/src/server/connected/novaMissionControl.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-emoji-'));
  const bus = new DurableMissionBus(dir);
  t.after(() => { bus.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const control = new NovaMissionControl(bus, { allowedTasks: ['health-check'] });
  const m = control.create({ goal: 'Hur mår runtime?', idempotencyKey: 'emoji-1' });
  const lease = control.claim(m.id, 'nova');
  control.release(m.id, { owner: 'nova', token: lease.token, completionProposed: true, completionReason: 'Allt fungerar \u2705 \u{1F680}' });
  assert.equal(bus.lastMissionEvent(m.id, 'NOVA_PLANNING_RESULT').payload.reason, 'Allt fungerar');
});
