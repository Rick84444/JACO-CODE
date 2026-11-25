// Aura's web search (operator 2026-11-25: "she reads one page and stops"). One public search results page read
// through the existing Fetch MCP (its DNS and redirect guards apply), turned into titles, addresses and snippets
// she can choose from and read with web_fetch. No browser, no account, no key. DuckDuckGo and Brave answer the
// fetch server with 202/429 (bot walls); Bing's HTML results are readable, with Wikipedia as the fallback.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = html => String(html || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : ENTITIES[e.toLowerCase()] ?? m)
  .replace(/\s+/g, ' ').trim();

// Bing links point at its click tracker; the real address is base64url in u=a1...
export function bingTarget(href) {
  try {
    const url = new URL(text(href), 'https://www.bing.com');
    if (url.hostname.endsWith('bing.com') && url.pathname === '/ck/a') {
      const u = url.searchParams.get('u') || '';
      if (!u.startsWith('a1')) return null;
      const decoded = Buffer.from(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      return /^https?:\/\//.test(decoded) ? decoded : null;
    }
    return /^https?:$/.test(url.protocol) && !url.hostname.endsWith('bing.com') ? url.href : null;
  } catch { return null; }
}

/** @param {string} html a Bing results page @returns {{title:string,url:string,snippet:string}[]} */
export function parseBingResults(html, limit = 8) {
  const results = [];
  const blocks = String(html || '').split(/class="b_algo"/).slice(1);
  for (const block of blocks) {
    const head = block.match(/<h2[^>]*>\s*<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!head) continue;
    const url = bingTarget(head[1]);
    const title = text(head[2]);
    if (!url || !title || results.some(r => r.url === url)) continue;
    const snippet = text(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').slice(0, 300);
    results.push({ title: title.slice(0, 200), url, snippet });
    if (results.length >= limit) break;
  }
  return results;
}

// Bing's RSS results: about 5 KB with direct addresses. The HTML page can be cut off by the fetch server's 128 KB
// limit before the first result (its inline CSS alone fills it for some queries), so RSS is read first.
/** @param {string} xml */
export function parseBingRss(xml, limit = 8) {
  const results = [];
  for (const item of String(xml || '').split('<item>').slice(1)) {
    const field = name => text((item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '').replace(/^<!\[CDATA\[|\]\]>$/g, ''));
    const url = field('link'), title = field('title');
    if (!/^https?:\/\//.test(url) || !title || results.some(r => r.url === url)) continue;
    results.push({ title: title.slice(0, 200), url, snippet: field('description').slice(0, 300) });
    if (results.length >= limit) break;
  }
  return results;
}

/** @param {string} json a MediaWiki search API response */
export function parseWikipediaResults(json, lang = 'en', limit = 8) {
  try {
    return (JSON.parse(json)?.query?.search || []).slice(0, limit).map(r => ({
      title: String(r.title), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, '_'))}`,
      snippet: text(r.snippet).slice(0, 300),
    }));
  } catch { return []; }
}

/**
 * @param {(url: string) => Promise<string>} read the public page reader (readPublicViaMcp)
 * @param {{query: string, lang?: string}} args
 */
export async function webSearch(read, { query, lang } = {}) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) throw Error('WEB_SEARCH_QUERY_REQUIRED');
  const language = /^[a-z]{2}$/.test(String(lang || '')) ? lang : (/[åäö]/i.test(q) ? 'sv' : 'en');
  let results = [], source = 'bing';
  const bing = `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=${language}`;
  try { results = parseBingRss(await read(bing + '&format=rss')); } catch { /* fall back */ }
  if (!results.length) { try { results = parseBingResults(await read(bing)); } catch { /* fall back */ } }
  if (!results.length) {
    source = 'wikipedia';
    results = parseWikipediaResults(await read(`https://${language}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=8&srsearch=${encodeURIComponent(q)}`), language);
  }
  return { query: q, source, results, next: results.length ? 'Read the three or four most relevant results with web_fetch in one TOOL_CALLS batch.' : 'No results: rephrase the query.' };
}
