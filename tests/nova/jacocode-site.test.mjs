// Regression: the jacocode.com source keeps its search metadata, structured data and links consistent, the files it
// serves exist in the folder that is deployed, and the worker keeps serving robots.txt with the sitemap, the www
// redirect and assets with security headers.
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
const VSCODE = 'https://marketplace.visualstudio.com/items?itemName=jacocode.jaco-cognitive-ide';
// Published into public/ by the release workflow, never committed: the downloads and the two installers.
const PUBLISHED_AT_RELEASE = ['/download/', '/install.sh', '/install.ps1'];

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

test('structured data parses, links every published surface, and its files exist', () => {
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1]);
  const byType = type => data['@graph'].find(n => n['@type'] === type);
  const all = type => data['@graph'].filter(n => n['@type'] === type);
  assert.deepEqual(byType('Organization').sameAs, [GITHUB, HF, VSCODE]);
  assert.equal(byType('SoftwareSourceCode').codeRepository, GITHUB);
  const video = byType('VideoObject');
  for (const key of ['name', 'description', 'thumbnailUrl', 'contentUrl', 'uploadDate']) assert.ok(video[key], key);
  for (const url of [video.thumbnailUrl, video.contentUrl, byType('Organization').logo]) assert.ok(existsSync(pub(url.slice(ORIGIN.length + 1))), url);
  // Both applications are offered: the download and the VS Code extension. Neither invents a rating.
  const apps = all('SoftwareApplication');
  assert.equal(apps.length, 2);
  for (const app of apps) assert.equal('aggregateRating' in app, false, app.name);
  assert.equal(apps.find(a => a['@id'].endsWith('#jaco-lite')).downloadUrl, `${ORIGIN}/download/jaco-lite.zip`);
  assert.equal(apps.find(a => a['@id'].endsWith('#vscode-extension')).url, VSCODE);
});

test('GitHub, Hugging Face and the VS Code extension are linked, and local links resolve', () => {
  assert.ok(html.split(GITHUB).length - 1 >= 3);
  assert.ok(html.split(HF).length - 1 >= 2);
  // The extension is reachable from the page itself, not only from the structured data: its own section and the footer.
  assert.ok(html.split(VSCODE).length - 1 >= 3, 'VS Code Marketplace link');
  assert.match(html, /<section id="vscode"/);
  assert.match(html, /<a href="#vscode">/);
  assert.match(html, /<section id="open"/);
  assert.match(html, /<a href="#open">/);
  for (const href of [...html.matchAll(/(?:href|src|poster)="(\/[^"#?]+)/g)].map(m => m[1])) {
    if (href.startsWith('/auth/') || PUBLISHED_AT_RELEASE.some(prefix => href.startsWith(prefix))) continue;
    assert.ok(existsSync(pub(href.slice(1))), `missing ${href}`);
  }
  assert.doesNotMatch(html, /<script[^>]+src="https?:/);
});

// A deploy replaces every asset: an image referenced by the page but missing from this folder disappears from the
// live site. Only the downloads and installers may be absent, because the release workflow writes them in first.
test('every asset the page and the stylesheet reference is in the deployed folder', () => {
  const sources = ['index.html', 'privacy.html', 'style.css'].map(file => readFileSync(pub(file), 'utf8')).join('\n');
  const referenced = new Set([
    ...[...sources.matchAll(/(?:href|src|poster)="(\/[^"#?]+)"/g)].map(m => m[1]),
    ...[...sources.matchAll(/url\(['"]?(\/[^)'"#?]+)/g)].map(m => m[1]),
  ]);
  for (const href of referenced) {
    if (href.startsWith('/auth/') || PUBLISHED_AT_RELEASE.some(prefix => href.startsWith(prefix))) continue;
    assert.ok(existsSync(pub(href.slice(1))), `a deploy would remove ${href} from the live site`);
  }
  for (const asset of ['brand/jaco-logo.png', 'brand/jaco-icon-192.png']) assert.ok(existsSync(pub(asset)), asset);
});

// What the page tells people to run has to be what the repository actually ships.
test('the download and install instructions match the real launchers and installers', () => {
  const lite = file => resolve(root, '../../lite', file);
  assert.match(html, /curl -fsSL https:\/\/jacocode\.com\/install\.sh \| sh/);
  assert.match(html, /irm https:\/\/jacocode\.com\/install\.ps1 \| iex/);
  assert.ok(existsSync(lite('install.sh')), 'lite/install.sh');
  assert.ok(existsSync(lite('install.ps1')), 'lite/install.ps1');
  // The names the build publishes, and the manifest the installers read.
  for (const file of ['jaco-lite.zip', 'jaco-lite.zip.sha256', 'jaco-lite-windows.zip', 'jaco-lite-android.zip', 'latest.json']) {
    assert.ok(html.includes(`/download/${file}`), `/download/${file}`);
  }
  assert.match(readFileSync(lite('install.sh'), 'utf8'), /latest\.json/);
  assert.match(readFileSync(lite('install.ps1'), 'utf8'), /latest\.json/);
  // Android is built from the same code but has never been started on a phone: the page must not imply otherwise.
  assert.match(html, /has not been run on a phone/);

  // `latest.json` is a SHA-256 manifest fetched over HTTPS. Nothing in the repository signs it, and no installer
  // verifies a signature against a pinned key, so the page must not describe it as signed.
  assert.doesNotMatch(html, /\bsigned\b/i, 'no signing key exists: the page may not claim one');
  const installers = ['install.sh', 'install.ps1'].map(file => readFileSync(resolve(root, '../../lite', file), 'utf8')).join('\n');
  assert.doesNotMatch(installers, /gpg|minisign|cosign|openssl\s+dgst\s+-verify/i, 'an installer verifies a signature: update the page wording');
});

test('the workspace the page describes is the one the runtime implements', () => {
  assert.match(html, /<section id="workspace"/);
  assert.match(html, /<a href="#workspace">/);
  const stage = readFileSync(resolve(root, '../../runtime/src/components/AuraLiveStage.tsx'), 'utf8');
  const lib = readFileSync(resolve(root, '../../runtime/src/lib/auraStage.mjs'), 'utf8');
  // "Only what is proven gets shown": verified outcome, in-project path, sandboxed preview, bounded screenshot age.
  assert.match(stage, /event\.evidence\.outcome==='verified'/);
  assert.match(stage, /age>30_000/);
  assert.match(lib, /export function stageFileAllowed/);
  assert.match(readFileSync(resolve(root, '../../runtime/src/components/CognitivePreview.tsx'), 'utf8'), /sandbox/);
  // "Work, Evidence, Code, Preview" and a pinned stage.
  const ui = readFileSync(resolve(root, '../../runtime/src/components/CognitiveWorkspace.tsx'), 'utf8');
  for (const view of ['stage', 'evidence', 'code', 'preview']) assert.ok(ui.includes(`['${view}',`), view);
  assert.match(ui, /stagePinned/);
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
