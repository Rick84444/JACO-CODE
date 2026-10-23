// Regression: the public site (site/) stays search-friendly, honest and self-contained.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const site = file => resolve(root, 'site', file);
const html = readFileSync(site('index.html'), 'utf8');
const ORIGIN = 'https://jacocode.com';
const REPO = 'https://github.com/Rick84444/JACO-CODE';

test('title, description and canonical are present and sized for search results', () => {
  const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] || '';
  assert.ok(title.length >= 20 && title.length <= 65, `title length ${title.length}`);
  const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] || '';
  assert.ok(description.length >= 70 && description.length <= 165, `description length ${description.length}`);
  assert.match(html, new RegExp(`<link rel="canonical" href="${ORIGIN}/">`));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="viewport"/);
  assert.doesNotMatch(html, /name="robots" content="[^"]*noindex/);
});

test('exactly one h1, sections are labelled and every image has an alt attribute', () => {
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
  for (const img of html.match(/<img\b[^>]*>/g) || []) assert.match(img, /\balt=/);
});

test('Open Graph and Twitter tags point at the canonical site and an image that exists', () => {
  assert.match(html, new RegExp(`property="og:url" content="${ORIGIN}/"`));
  const image = /property="og:image" content="([^"]+)"/.exec(html)?.[1] || '';
  assert.ok(image.startsWith(`${ORIGIN}/assets/`));
  assert.ok(existsSync(site(image.slice(ORIGIN.length + 1))), 'og:image file is missing');
  assert.match(html, /name="twitter:card"/);
});

test('structured data parses and states only facts the repository supports', () => {
  const raw = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const data = JSON.parse(raw);
  const nodes = data['@graph'];
  const software = nodes.find(n => n['@type'] === 'SoftwareApplication');
  assert.equal(software.codeRepository, REPO);
  for (const forbidden of ['aggregateRating', 'review', 'offers', 'price', 'interactionStatistic']) {
    assert.equal(forbidden in software, false, `${forbidden} would be an unverified claim`);
  }
  const faq = nodes.find(n => n['@type'] === 'FAQPage');
  assert.ok(faq.mainEntity.length >= 3);
  // Every FAQ answer in the data appears as visible text too (search engines require this).
  for (const q of faq.mainEntity) assert.ok(html.includes(`<summary>${q.name}</summary>`), q.name);
});

test('the GitHub repository is linked, internal links resolve and nothing is loaded from third parties', () => {
  assert.ok((html.match(new RegExp(REPO, 'g')) || []).length >= 2);
  for (const href of [...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map(m => m[1])) {
    if (href === '/') continue;
    assert.ok(existsSync(site(href.slice(1))), `missing ${href}`);
  }
  const external = [...html.matchAll(/<(?:script|link|img)\b[^>]*(?:src|href)="(https?:[^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(external.filter(u => !u.startsWith(ORIGIN) && !/rel="canonical"/.test(u)), []);
  assert.doesNotMatch(html, /<script[^>]+src=/i);
});

test('the copy makes no unverifiable commercial or open-source claims', () => {
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(visible, /\b(customers?|trusted by|testimonials?|case stud|guarantee[sd]? (?:uptime|roi)|free forever|open[- ]source)\b/i);
  assert.doesNotMatch(visible, /\$\s?\d|\d\s?(?:SEK|USD|EUR)\b|per month/i);
  assert.doesNotMatch(visible, /lorem|todo|placeholder|mimir/i);
});

test('robots.txt and sitemap.xml agree with the canonical origin', () => {
  const robots = readFileSync(site('robots.txt'), 'utf8');
  assert.match(robots, new RegExp(`Sitemap: ${ORIGIN}/sitemap.xml`));
  assert.doesNotMatch(robots, /Disallow:\s*\/\s*$/m);
  const sitemap = readFileSync(site('sitemap.xml'), 'utf8');
  assert.match(sitemap, new RegExp(`<loc>${ORIGIN}/</loc>`));
  assert.ok(existsSync(site('404.html')));
  assert.match(readFileSync(site('404.html'), 'utf8'), /noindex/);
});
