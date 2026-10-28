#!/usr/bin/env node
/** Real loopback HTTP test server. Runner only accepts two fixed, repository-owned templates. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const allowed = new Map([
  ['baseline', path.join(here, 'templates/retry-baseline.mjs')],
  ['hardened', path.join(here, 'templates/retry-hardened.mjs')],
]);
export async function runReview(candidate) {
  if (!allowed.has(candidate)) throw new Error('REVIEW_UNTRUSTED_CANDIDATE');
  const file = allowed.get(candidate);
  const codeHash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const { retryRequest } = await import(pathToFileURL(file));
  const counts = new Map();
  const server = http.createServer((request, response) => {
    const key = `${request.method} ${request.url}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    const endpoint = request.url;
    let status = 200, headers = {};
    if (endpoint === '/flaky') status = count < 3 ? 503 : 200;
    if (endpoint === '/post') status = 503;
    if (endpoint === '/bad-request') status = 400;
    if (endpoint === '/throttle') { status = count === 1 ? 429 : 200; headers['Retry-After'] = '1'; }
    if (endpoint === '/always-down') status = 503;
    if (endpoint === '/teapot') status = 418;
    response.writeHead(status, headers); response.end(JSON.stringify({status, count}));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const cases = [];
  async function scenario(name, fn) {
    try {
      const result = await fn();
      if (!result) throw new Error('assertion failed');
      cases.push({ name, passed: true });
    } catch (err) { cases.push({ name, passed: false, error: String(err?.message ?? err).slice(0, 200) }); }
  }
  const calls = (method, endpoint) => counts.get(`${method} ${endpoint}`) ?? 0;
  const noSleep = async () => {};
  try {
    await scenario('GET retries transient 503 and recovers', async () => {
      const r = await retryRequest(`${url}/flaky`, { maxRetries: 2, sleep: noSleep });
      return r.status === 200 && calls('GET', '/flaky') === 3;
    });
    await scenario('POST is not retried without idempotency authority', async () => {
      const r = await retryRequest(`${url}/post`, { method: 'POST', maxRetries: 3, sleep: noSleep });
      return r.status === 503 && calls('POST', '/post') === 1;
    });
    await scenario('HTTP 400 is terminal', async () => {
      const r = await retryRequest(`${url}/bad-request`, { sleep: noSleep });
      return r.status === 400 && calls('GET', '/bad-request') === 1;
    });
    await scenario('HTTP 429 honors Retry-After within delay cap', async () => {
      const delays = [];
      const r = await retryRequest(`${url}/throttle`, { maxDelayMs: 1200, sleep: async ms => delays.push(ms) });
      return r.status === 200 && calls('GET', '/throttle') === 2 && delays[0] === 1000;
    });
    await scenario('Bounded retries do not loop forever', async () => {
      const r = await retryRequest(`${url}/always-down`, { maxRetries: 2, sleep: noSleep });
      return r.status === 503 && calls('GET', '/always-down') === 3;
    });
    await scenario('Abort before request prevents network side effect', async () => {
      const ac = new AbortController(); ac.abort();
      try { await retryRequest(`${url}/teapot`, { signal: ac.signal, sleep: noSleep }); } catch {
        return calls('GET', '/teapot') === 0;
      }
      return false;
    });
    await scenario('Abort during backoff prevents second request', async () => {
      const ac = new AbortController();
      try {
        await retryRequest(`${url}/always-down`, { maxRetries: 2, signal: ac.signal, sleep: async () => ac.abort() });
      } catch { return calls('GET', '/always-down') === 4; }
      return false;
    });
    await scenario('Reject unbounded retry configuration', async () => {
      try { await retryRequest(`${url}/teapot`, { maxRetries: 1000, sleep: noSleep }); } catch { return true; }
      return false;
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
  return { candidate, codeHash, passed: cases.filter(x => x.passed).length, total: cases.length, accepted: cases.every(x => x.passed), cases };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReview(process.argv[2]).then(result => { console.log(JSON.stringify(result)); process.exitCode = result.accepted ? 0 : 2; }).catch(err => { console.error(String(err.stack || err)); process.exitCode = 3; });
}
