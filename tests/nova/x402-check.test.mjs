// Operator 2026-10-03: a free agent-payability check as the entry point for developer forums.
import test from 'node:test';
import assert from 'node:assert/strict';
const { validateTarget, summarize, checkX402, checkPageHtml } = await import('../../agents/lib/x402-check.mjs');

test('only public https GET/POST targets are checked', () => {
  assert.deepEqual(validateTarget('https://api.example.com/v1/x', 'post'), { url: 'https://api.example.com/v1/x', method: 'POST' });
  for (const [u, e] of [['http://api.example.com', /HTTPS/], ['https://localhost/x', /NOT_PUBLIC/], ['https://192.168.1.2/x', /NOT_PUBLIC/], ['not a url', /INVALID_URL/]]) assert.throws(() => validateTarget(u), e);
  assert.throws(() => validateTarget('https://api.example.com', 'DELETE'), /METHOD/);
});

test('the validator result becomes a plain report with fixes', async () => {
  const body = { valid: false, statusCode: 200, preflight: [
    { check: 'url_https', passed: true, detail: 'ok' },
    { check: 'returns_402', passed: false, detail: 'Endpoint returns 200 OK' },
    { check: 'valid_json', passed: false, detail: 'Skipped: endpoint did not return 402' }] };
  const r = summarize(body);
  assert.deepEqual([r.agentPayable, r.passed, r.total, r.skipped, r.problems.length], [false, 1, 3, 1, 1]);
  assert.match(r.problems[0].fix, /402 Payment Required/);
  const sent = [];
  const out = await checkX402('https://api.example.com/v1/x', 'GET', { fetchImpl: async (u, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify(body)); } });
  assert.deepEqual(sent, [{ resource: 'https://api.example.com/v1/x', method: 'GET' }]);
  assert.equal(out.statusCode, 200);
  const html = checkPageHtml({ report: out, url: 'https://api.example.com/v1/x', exampleUrl: 'https://x.test/v1/repo-scan' });
  assert.match(html, /Agents cannot pay this endpoint yet/);
  assert.ok(!/<script/i.test(checkPageHtml({ error: '<script>alert(1)</script>' })), 'output is escaped');
});
