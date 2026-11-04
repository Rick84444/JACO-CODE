// jacocode.com: static assets from ./public with security headers, Google sign-in (auth.mjs), byte ranges for the
// replay video, and robots.txt pointing at the sitemap. Reconstructed from the deployed jaco-site bundle; the only
// behavioural change is the Sitemap line in robots.txt.
import { handleAuth } from './auth.mjs';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const ROBOTS = 'User-agent: *\nAllow: /\n\nSitemap: https://jacocode.com/sitemap.xml\n';

export function withHeaders(response, pathname, { noStore = false } = {}) {
  const res = new Response(response.body, response);
  res.headers.set('content-security-policy', CSP);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  res.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  if (noStore) {
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  const html = pathname === '/' || pathname.endsWith('.html');
  if (pathname.startsWith('/download/')) {
    const name = pathname.split('/').pop();
    res.headers.set('content-disposition', `attachment; filename="${name}"`);
    if (name.endsWith('.zip')) res.headers.set('content-type', 'application/zip');
    else if (name.endsWith('.sha256')) res.headers.set('content-type', 'text/plain; charset=utf-8');
    res.headers.set('cache-control', 'public, max-age=300');
    return res;
  }
  res.headers.set('cache-control', html || pathname.endsWith('.json') || pathname.endsWith('.xml') ? 'public, max-age=300' : 'public, max-age=86400');
  return res;
}

export async function withRange(request, response) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (response.status !== 200 || !/^(video|audio)\//.test(response.headers.get('content-type') || '')) return response;
  const body = await response.arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set('accept-ranges', 'bytes');
  if (!range || (!range[1] && !range[2])) {
    headers.set('content-length', String(body.byteLength));
    return new Response(body, { status: 200, headers });
  }
  const size = body.byteLength;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    headers.set('content-range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set('content-range', `bytes ${start}-${end}/${size}`);
  headers.set('content-length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === 'www.jacocode.com') return Response.redirect('https://jacocode.com' + url.pathname + url.search, 301);
    if (url.pathname.startsWith('/auth/')) {
      const res = await handleAuth(request, env, url);
      if (res) return withHeaders(res, url.pathname, { noStore: true });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'jaco-site' });
    if (url.pathname === '/robots.txt') return new Response(ROBOTS, { headers: { 'content-type': 'text/plain' } });
    return withHeaders(await withRange(request, await env.ASSETS.fetch(request)), url.pathname);
  },
};
