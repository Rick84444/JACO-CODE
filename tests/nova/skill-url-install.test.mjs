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
