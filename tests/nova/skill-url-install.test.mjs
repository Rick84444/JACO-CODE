import test from 'node:test';
import assert from 'node:assert/strict';
import { skillSourceUrl, skillIdFrom, fetchSkillFromUrl } from '../../agents/lib/skills.mjs';

const SKILL = '---\nname: Sammanfatta sida\ndescription: Läser en sida och sammanfattar den\ntasks: [web-fetch]\n---\nHämta sidan och sammanfatta den på svenska.';
const reply = (body, { status = 200, url, headers = {} } = {}) => async () => ({ ok: status < 400, status, url, headers: new Headers(headers), text: async () => body });

test('only public HTTPS addresses are accepted, and GitHub file pages map to the raw file', () => {
  assert.equal(skillSourceUrl('https://github.com/acme/skills/blob/main/summarize/SKILL.md'), 'https://raw.githubusercontent.com/acme/skills/main/summarize/SKILL.md');
  assert.equal(skillSourceUrl('https://example.com/a/SKILL.md'), 'https://example.com/a/SKILL.md');
  for (const [url, error] of [['http://example.com/SKILL.md', /HTTPS_REQUIRED/], ['https://user:pw@example.com/SKILL.md', /CREDENTIALS/],
    ['https://localhost/SKILL.md', /PRIVATE_HOST/], ['https://127.0.0.1/SKILL.md', /PRIVATE_HOST/], ['https://192.168.1.5/SKILL.md', /PRIVATE_HOST/],
    ['https://10.0.0.2/SKILL.md', /PRIVATE_HOST/], ['https://[::1]/SKILL.md', /PRIVATE_HOST/], ['not a url', /URL_INVALID/]]) assert.throws(() => skillSourceUrl(url), error, url);
});

test('a fetched skill is validated like a pasted one and gets an id from its name or folder', async () => {
  const r = await fetchSkillFromUrl('https://github.com/acme/skills/blob/main/summarize/SKILL.md', { fetchImpl: reply(SKILL) });
  assert.equal(r.url, 'https://raw.githubusercontent.com/acme/skills/main/summarize/SKILL.md');
  assert.equal(r.suggestedId, 'sammanfatta-sida'); assert.equal(r.content, SKILL);
  assert.equal(skillIdFrom({}, 'https://example.com/x/web-research/SKILL.md'), 'web-research');
  assert.equal(skillIdFrom({ name: 'Résumé Tool' }, 'https://example.com/x.md'), 'resume-tool');
});

test('HTML pages, oversized files, unknown tasks, HTTP errors and redirects to private or plain-HTTP hosts are refused', async () => {
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply('<!doctype html><p>login</p>') }), /NOT_MARKDOWN/);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply(SKILL, { headers: { 'content-length': '999999' } }) }), /TOO_LARGE/);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply(SKILL.replace('web-fetch', 'format-disk')) }), /SKILL_TASK_UNKNOWN/);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply('', { status: 404 }) }), /HTTP_404/);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply(SKILL, { url: 'http://example.com/s.md' }) }), /HTTPS_REQUIRED/);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: reply(SKILL, { url: 'https://127.0.0.1/s.md' }) }), /PRIVATE_HOST/);
});

// Regressions for PR #13 review: address forms the first host pattern let through, redirects that were
// requested before they were checked, DNS answers pointing inward, and bodies read before their size was known.
import net from 'node:net';
import { isNonPublicAddress, publicOnlyLookup, publicHttpsGet } from '../../agents/lib/skills.mjs';

test('mapped, compatible, NAT64, 6to4, link-local, CGNAT, unspecified and internal-name hosts are refused as written', () => {
  for (const url of ['https://[::ffff:127.0.0.1]/s.md', 'https://[::ffff:a9fe:a9fe]/s.md', 'https://[::]/s.md', 'https://[fe80::1]/s.md',
    'https://[64:ff9b::7f00:1]/s.md', 'https://[2002:a00:1::]/s.md', 'https://[fd12:3456::1]/s.md', 'https://localhost./s.md',
    'https://100.64.0.1/s.md', 'https://198.18.0.1/s.md', 'https://metadata.google.internal/s.md', 'https://printer.local/s.md',
    'https://skills/s.md', 'https://router.home.arpa/s.md'])
    assert.throws(() => skillSourceUrl(url), /PRIVATE_HOST/, url);
  for (const url of ['https://example.com/s.md', 'https://8.8.8.8/s.md', 'https://[2606:4700:4700::1111]/s.md', 'https://127.0.0.1.example.com/s.md'])
    assert.doesNotThrow(() => skillSourceUrl(url), url);
  assert.equal(isNonPublicAddress('not-an-ip'), true, 'anything that is not an address fails closed');
});

const hop = (status, location) => ({ status, ok: false, headers: new Headers(location ? { location } : {}), text: async () => '' });
const recorder = steps => {
  const calls = [];
  return { calls, fetchImpl: async (url, opts) => { calls.push({ url, redirect: opts.redirect }); return steps.shift(); } };
};

test('every redirect target is checked before it is requested', async () => {
  for (const [location, error] of [['https://169.254.169.254/latest/meta-data/', /PRIVATE_HOST/], ['http://example.com/s.md', /HTTPS_REQUIRED/],
    ['https://[::ffff:10.0.0.1]/s.md', /PRIVATE_HOST/], ['https://user:pw@example.com/s.md', /CREDENTIALS/]]) {
    const r = recorder([hop(302, location)]);
    await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: r.fetchImpl }), error, location);
    assert.deepEqual(r.calls, [{ url: 'https://example.com/s.md', redirect: 'manual' }], 'the redirect target was never requested: ' + location);
  }
  const missing = recorder([hop(301)]);
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: missing.fetchImpl }), /REDIRECT_INVALID/);
});

test('public redirects are followed hop by hop, relative locations resolve, and the chain is bounded', async () => {
  const steps = [hop(302, 'https://cdn.example.org/a/SKILL.md'), hop(307, '../b/SKILL.md'), await reply(SKILL)()];
  const chain = recorder(steps);
  const r = await fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: chain.fetchImpl });
  assert.deepEqual(chain.calls.map(c => c.url), ['https://example.com/s.md', 'https://cdn.example.org/a/SKILL.md', 'https://cdn.example.org/b/SKILL.md']);
  assert.equal(r.url, 'https://cdn.example.org/b/SKILL.md');
  const loop = recorder(Array.from({ length: 10 }, (_, i) => hop(302, `https://example.com/${i}.md`)));
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl: loop.fetchImpl }), /TOO_MANY_REDIRECTS/);
  assert.equal(loop.calls.length, 4, 'initial request plus three redirects, then stop');
});

test('a body without content-length is read only up to the limit, then the transfer is cancelled', async () => {
  let pulled = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new TextEncoder().encode('x'.repeat(16_384))); },
    cancel() { cancelled = true; },
  });
  const fetchImpl = async () => ({ status: 200, ok: true, headers: new Headers(), body });
  await assert.rejects(fetchSkillFromUrl('https://example.com/s.md', { fetchImpl }), /TOO_LARGE/);
  assert.ok(cancelled, 'stream cancelled');
  assert.ok(pulled <= 8, `stopped after ${pulled} chunks of 16 KiB, not the whole stream`);
});

const lookupReturning = addresses => (_host, _opts, cb) => cb(null, addresses.map(address => ({ address, family: net.isIP(address) })));
const lookupOf = (fn, opts) => new Promise(resolve => fn('skills.example', opts, (error, address, family) => resolve({ error, address, family })));

test('connect-time lookup refuses any non-public answer, including a mixed one', async () => {
  for (const answers of [['10.0.0.5'], ['93.184.215.14', '127.0.0.1'], ['::ffff:192.168.1.1'], ['fe80::1'], []]) {
    const r = await lookupOf(publicOnlyLookup(lookupReturning(answers)), {});
    assert.ok(r.error, 'refused: ' + answers.join(','));
  }
  const single = await lookupOf(publicOnlyLookup(lookupReturning(['93.184.215.14'])), { family: 0 });
  assert.equal(single.error, null); assert.equal(single.address, '93.184.215.14'); assert.equal(single.family, 4);
  const all = await lookupOf(publicOnlyLookup(lookupReturning(['93.184.215.14', '2606:2800::1'])), { all: true });
  assert.equal(all.error, null); assert.equal(all.address.length, 2);
});

test('a public name that resolves to loopback never opens a connection', async () => {
  let connections = 0;
  const server = net.createServer(socket => { connections++; socket.destroy(); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try {
    await assert.rejects(publicHttpsGet(`https://skills.example:${port}/SKILL.md`, { lookupImpl: lookupReturning(['127.0.0.1']) }), /PRIVATE_HOST/);
    await assert.rejects(fetchSkillFromUrl(`https://skills.example:${port}/SKILL.md`, {
      fetchImpl: (url, opts) => publicHttpsGet(url, { ...opts, lookupImpl: lookupReturning(['127.0.0.1']) }) }), /PRIVATE_HOST/);
    await new Promise(r => setTimeout(r, 50));
    assert.equal(connections, 0, 'the loopback listener was never reached');
  } finally { await new Promise(r => server.close(r)); }
});
