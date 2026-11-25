// 2026-11-25: Aura had no search tool and read one page before stopping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bingTarget, parseBingResults, parseBingRss, parseWikipediaResults, webSearch } from '../../runtime/src/server/mcp/webSearch.mjs';

const b64 = s => 'a1' + Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const ck = url => `https://www.bing.com/ck/a?!&amp;&amp;p=abc&amp;u=${b64(url)}&amp;ntb=1`;
const page = `<html><ol id="b_results">
<li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="${ck('https://www.salesforce.com/se/agents/')}">salesforce.com</a></div>
<h2><a target="_blank" href="${ck('https://www.salesforce.com/se/agents/')}">Vad &#228;r <strong>autonoma agenter</strong>? | Salesforce</a></h2>
<div class="b_caption"><p class="b_lineclamp2">Autonoma agenter &amp; AI som <strong>agerar</strong> sj&#228;lva.</p></div></li>
<li class="b_algo"><h2><a href="${ck('https://sv.wikipedia.org/wiki/Intelligent_agent')}">Intelligent agent – Wikipedia</a></h2><p>En agent som uppfattar sin milj&#246;.</p></li>
<li class="b_algo"><h2><a href="${ck('https://www.salesforce.com/se/agents/')}">Duplicate</a></h2></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=zzbroken">Broken</a></h2></li>
<li class="b_algo"><h2><a href="javascript:alert(1)">Script</a></h2></li>
</ol></html>`;

test('Bing results become titles, real addresses and snippets, without duplicates or tracker links', () => {
  const r = parseBingResults(page);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { title: 'Vad är autonoma agenter ? | Salesforce', url: 'https://www.salesforce.com/se/agents/', snippet: 'Autonoma agenter & AI som agerar själva.' });
  assert.equal(r[1].url, 'https://sv.wikipedia.org/wiki/Intelligent_agent');
  assert.equal(r[1].snippet, 'En agent som uppfattar sin miljö.');
});

test('only http(s) targets come out of a tracker link', () => {
  assert.equal(bingTarget(ck('https://example.com/a')), 'https://example.com/a');
  assert.equal(bingTarget(`https://www.bing.com/ck/a?u=${b64('javascript:alert(1)')}`), null);
  assert.equal(bingTarget('https://www.bing.com/search?q=x'), null);
  assert.equal(bingTarget('javascript:alert(1)'), null);
});

const rss = `<?xml version="1.0"?><rss><channel><item><title>AI agent trends 2026 report | Google Cloud</title><link>https://cloud.google.com/resources/ai-agent-trends-2026</link><description>The 5 top trends &amp; more.</description></item>
<item><title>Bad</title><link>javascript:alert(1)</link></item><item><title>Agenter</title><link>https://example.se/a</link><description>Om agenter</description></item></channel></rss>`;

test('Bing RSS results are read first: direct addresses, small enough for the fetch limit', async () => {
  assert.deepEqual(parseBingRss(rss), [
    { title: 'AI agent trends 2026 report | Google Cloud', url: 'https://cloud.google.com/resources/ai-agent-trends-2026', snippet: 'The 5 top trends & more.' },
    { title: 'Agenter', url: 'https://example.se/a', snippet: 'Om agenter' },
  ]);
  const seen = [];
  const out = await webSearch(async url => { seen.push(url); return rss; }, { query: 'AI agent trends' });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /&format=rss$/);
  assert.equal(out.results.length, 2);
});

test('search falls back from RSS to the results page, then to Wikipedia, and tells Aura to read several results', async () => {
  const seen = [];
  const out = await webSearch(async url => { seen.push(url); return url.endsWith('format=rss') ? '<rss></rss>' : page; }, { query: 'autonoma agenter' });
  assert.match(seen[1], /^https:\/\/www\.bing\.com\/search\?q=autonoma%20agenter&setlang=en$/);
  assert.equal(out.source, 'bing');
  assert.equal(out.results.length, 2);
  assert.match(out.next, /three or four .* web_fetch .* TOOL_CALLS/);
  const wiki = JSON.stringify({ query: { search: [{ title: 'Autonom agent', snippet: 'En <span>agent</span> som' }] } });
  const fallback = await webSearch(async url => (url.includes('bing.com') ? '<html>wall</html>' : wiki), { query: 'självkörande', lang: 'sv' });
  assert.equal(fallback.source, 'wikipedia');
  assert.deepEqual(fallback.results[0], { title: 'Autonom agent', url: 'https://sv.wikipedia.org/wiki/Autonom_agent', snippet: 'En agent som' });
  await assert.rejects(webSearch(async () => '', { query: ' ' }), /WEB_SEARCH_QUERY_REQUIRED/);
  assert.deepEqual(parseWikipediaResults('not json'), []);
});
