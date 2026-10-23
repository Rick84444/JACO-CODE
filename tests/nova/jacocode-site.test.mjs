// Regression: the jacocode.com source keeps its search metadata, structured data and links consistent, and the
// worker keeps serving robots.txt with the sitemap, the www redirect and assets with security headers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import worker, { ROBOTS } from '../../site/jacocode.com/worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../site/jacocode.com');
const pub = file => resolve(root, 'public', file);
const html = readFileSync(pub('index.html'), 'utf8');
const ORIGIN = 'https://jacocode.com';
const GITHUB = 'https://github.com/Rick84444/JACO-CODE';
const HF = 'https://huggingface.co/spaces/Rick8444/JACO-Autonomous-IDE';

test('title, description and canonical fit search results', () => {
  const title = /<title>([^<]+)<\/title>/.exec(html)[1];
  assert.ok(title.length >= 30 && title.length <= 60, `title ${title.length}`);
  const description = /<meta name="description" content="([^"]+)"/.exec(html)[1];
  assert.ok(description.length >= 110 && description.length <= 160, `description ${description.length}`);
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/">`));
  assert.doesNotMatch(html, /noindex/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('social cards use an image that exists in the site', () => {
  const image = /property="og:image" content="([^"]+)"/.exec(html)[1];
  assert.ok(image.startsWith(`${ORIGIN}/`));
  assert.ok(existsSync(pub(image.slice(ORIGIN.length + 1))));
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
});

test('structured data parses, links GitHub and Hugging Face, and its files exist', () => {
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const byType = type => data['@graph'].find(n => n['@type'] === type);
  assert.deepEqual(byType('Organization').sameAs, [GITHUB, HF]);
  assert.equal(byType('SoftwareSourceCode').codeRepository, GITHUB);
  const video = byType('VideoObject');
  for (const key of ['name', 'description', 'thumbnailUrl', 'contentUrl', 'uploadDate']) assert.ok(video[key], key);
  for (const url of [video.thumbnailUrl, video.contentUrl, byType('Organization').logo]) assert.ok(existsSync(pub(url.slice(ORIGIN.length + 1))), url);
  assert.equal('aggregateRating' in byType('SoftwareApplication'), false);
});

test('GitHub and Hugging Face are linked in the page, and local links resolve', () => {
  assert.ok(html.split(GITHUB).length - 1 >= 3);
  assert.ok(html.split(HF).length - 1 >= 2);
  assert.match(html, /<section id="open"/);
  assert.match(html, /<a href="#open">/);
  for (const href of [...html.matchAll(/(?:href|src|poster)="(\/[^"#?]+)/g)].map(m => m[1])) {
    if (href.startsWith('/auth/') || href.startsWith('/download/')) continue;
    assert.ok(existsSync(pub(href.slice(1))), `missing ${href}`);
  }
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});

test('sitemap lists the canonical pages', () => {
  const sitemap = readFileSync(pub('sitemap.xml'), 'utf8');
  assert.match(sitemap, new RegExp(`<loc>${ORIGIN}/</loc>`));
  assert.match(sitemap, new RegExp(`<loc>${ORIGIN}/privacy.html</loc>`));
  assert.match(readFileSync(pub('privacy.html'), 'utf8'), new RegExp(`rel="canonical" href="${ORIGIN}/privacy.html"`));
});

test('worker serves robots.txt with the sitemap, redirects www and adds security headers to assets', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) } };
  const robots = await worker.fetch(new Request(`${ORIGIN}/robots.txt`), env);
  assert.equal(await robots.text(), ROBOTS);
  assert.match(ROBOTS, new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  const www = await worker.fetch(new Request('https://www.jacocode.com/privacy.html'), env);
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('location'), `${ORIGIN}/privacy.html`);
  const page = await worker.fetch(new Request(`${ORIGIN}/`), env);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const post = await worker.fetch(new Request(`${ORIGIN}/`, { method: 'POST' }), env);
  assert.equal(post.status, 405);
});
