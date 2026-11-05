// Built-in read-only public HTTPS MCP fetcher for Node/Termux. No uvx or Python.
// DNS is checked and pinned: no loopback, private service or redirect destinations.
import readline from 'node:readline';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';

const MAX_BYTES = 128 * 1024;
const MAX_TIMEOUT_MS = 12000;
const allowedContent = /^(text\/(plain|html|markdown|xml|csv)|application\/(json|[^;]*\+json|xml|[^;]*\+xml))(?:\s*;|\s*$)/i;
function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a,b,c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127)
    || (a === 192 && b === 88) || (a === 192 && b === 0) || (a === 198 && b === 19));
}
export function checkedUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw Error('FETCH_URL_INVALID');
  let url; try { url = new URL(input); } catch { throw Error('FETCH_URL_INVALID'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || url.hash || net.isIP(host) || !host.includes('.')
    || /(?:^|\.)(localhost|local|internal|lan|home|test|invalid|arpa)$/.test(host)) throw Error('FETCH_PUBLIC_HTTPS_REQUIRED');
  return url;
}
const MAX_REDIRECTS = 5;
// Every hop passes the same public-address check as the first request, so a redirect cannot reach a private service.
export async function fetchPublicText(input, options = {}, redirects = 0) {
  const { lookupFn = lookup, requestFn = https.get } = options;
  // A fragment is never sent to the server; it only names a place on the page.
  const url = checkedUrl(typeof input === 'string' ? input.split('#')[0] : input);
  const addresses = await lookupFn(url.hostname, { all: true, family: 4 });
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(a => !publicIPv4(a.address))) throw Error('FETCH_ADDRESS_NOT_PUBLIC');
  const ip = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = requestFn(url, {
      timeout: MAX_TIMEOUT_MS,
      headers: { accept: 'text/plain, text/html, application/json, application/xml;q=0.8', 'accept-encoding': 'identity', 'user-agent': 'JACO-MCP-Fetch/1.0' },
      // Node's automatic family selection asks for every address ({ all: true }) and expects an array.
      lookup: (_hostname, opts, cb) => (opts?.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        if (!res.headers.location) return reject(Error(`FETCH_HTTP_${res.statusCode}`));
        if (redirects >= MAX_REDIRECTS) return reject(Error('FETCH_TOO_MANY_REDIRECTS'));
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch { return reject(Error('FETCH_URL_INVALID')); }
        return resolve(fetchPublicText(next, options, redirects + 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(Error(`FETCH_HTTP_${res.statusCode}`)); }
      if (!allowedContent.test(String(res.headers['content-type'] || ''))) { res.resume(); return reject(Error('FETCH_UNSUPPORTED_CONTENT_TYPE')); }
      let size = 0; const chunks = [];
      const finish = truncated => resolve({
        url: url.toString(), bytes: size, truncated,
        content: Buffer.concat(chunks).toString('utf8') + (truncated ? `\n[truncated at ${MAX_BYTES} bytes]` : ''),
      });
      res.on('data', chunk => {
        // Most pages are larger than the limit: give the start of the page and say so.
        if (size + chunk.length > MAX_BYTES) {
          chunks.push(chunk.subarray(0, MAX_BYTES - size));
          size = MAX_BYTES;
          finish(true);
          req.destroy();
          return;
        }
        size += chunk.length;
        chunks.push(chunk);
      });
      res.on('end', () => finish(false));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Error('FETCH_TIMEOUT')));
    req.on('error', reject);
  });
}
const TOOL = { name: 'fetch', description: 'Read public HTTPS text, HTML, XML or JSON (first 128 KiB). Redirects are followed; private/local addresses are refused.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }, annotations: { readOnlyHint: true } };
export async function handleFetchMcp(msg, { fetchFn = fetchPublicText } = {}) {
  if (!msg || msg.id === undefined) return null;
  const reply = result => ({ jsonrpc: '2.0', id: msg.id, result });
  if (msg.method === 'initialize') return reply({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jaco-fetch', version: '1.0.0' } });
  if (msg.method === 'tools/list') return reply({ tools: [TOOL] });
  if (msg.method === 'ping') return reply({});
  if (msg.method !== 'tools/call') return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'METHOD_NOT_FOUND' } };
  if (msg.params?.name !== 'fetch') return { jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'UNKNOWN_TOOL' } };
  try {
    const out = await fetchFn(msg.params?.arguments?.url);
    return reply({ content: [{ type: 'text', text: out.content }] });
  } catch (e) {
    return reply({ isError: true, content: [{ type: 'text', text: String(e?.message || e).slice(0,240) }] });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const send = obj => process.stdout.write(JSON.stringify(obj) + '\n');
  readline.createInterface({ input: process.stdin }).on('line', async line => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    const out = await handleFetchMcp(msg); if (out) send(out);
  });
}