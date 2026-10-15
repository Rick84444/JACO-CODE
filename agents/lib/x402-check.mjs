// Free "is your API agent-payable?" check (operator 2026-10-03: first revenue through developer and
// agent forums). It runs Coinbase's public x402 validator against a URL and explains the result in
// plain words, with what to fix. JACO's own repo-scan endpoint passes all its checks, so the tool
// shows what we can do for others. Nothing about the checked URL is stored except a counter.
const VALIDATOR = 'https://api.cdp.coinbase.com/platform/v2/x402/validate';

// Plain-language fixes for the checks a typical API fails first.
const FIX = {
  url_https: 'Serve the endpoint over HTTPS.',
  endpoint_reachable: 'The endpoint must answer requests from the internet (check firewalls and bot protection, which often block agents).',
  returns_402: 'Answer unpaid requests with HTTP 402 Payment Required instead of 200, 401 or 403.',
  valid_json: 'Return the payment requirements as JSON.',
  x402_version: 'Use x402 version 2.',
  payment_required_header: 'Send the requirements in the PAYMENT-REQUIRED response header (base64 JSON).',
  has_accepts: 'List at least one way to pay in "accepts".',
};

export function validateTarget(url, method = 'GET') {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('INVALID_URL'); }
  if (u.protocol !== 'https:') throw new Error('URL_MUST_BE_HTTPS');
  if (/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/i.test(u.hostname) || !u.hostname.includes('.')) throw new Error('URL_NOT_PUBLIC');
  const m = String(method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(m)) throw new Error('METHOD_MUST_BE_GET_OR_POST');
  return { url: u.toString(), method: m };
}

export function summarize(result) {
  const checks = Array.isArray(result?.preflight) ? result.preflight : [];
  const failed = checks.filter(c => !c.passed && !/^Skipped/.test(String(c.detail || '')));
  const skipped = checks.filter(c => !c.passed && /^Skipped/.test(String(c.detail || ''))).length;
  return {
    agentPayable: result?.valid === true,
    statusCode: result?.statusCode ?? null,
    passed: checks.filter(c => c.passed).length,
    total: checks.length,
    skipped,
    problems: failed.map(c => ({ check: c.check, detail: c.detail, fix: FIX[c.check] || null })),
    bazaarMetadata: Boolean(result?.bazaarExtension),
    listedInBazaar: Boolean(result?.index),
  };
}

export async function checkX402(url, method = 'GET', { fetchImpl = fetch } = {}) {
  const target = validateTarget(url, method);
  const res = await fetchImpl(VALIDATOR, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: target.url, method: target.method }), signal: AbortSignal.timeout(45_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`VALIDATOR_UNAVAILABLE:${res.status}`);
  return { ...target, ...summarize(body) };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function checkPageHtml({ report = null, error = null, url = '', method = 'GET', exampleUrl = '' } = {}) {
  const result = report ? `<section class="r ${report.agentPayable ? 'ok' : 'no'}">
<h2>${report.agentPayable ? 'Agents can pay this endpoint' : 'Agents cannot pay this endpoint yet'}</h2>
<p>${esc(report.method)} ${esc(report.url)}: HTTP ${esc(report.statusCode)}, ${report.passed} of ${report.total} checks passed${report.skipped ? ` (${report.skipped} skipped after the first failure)` : ''}.</p>
${report.problems.length ? `<ol>${report.problems.map(p => `<li><b>${esc(p.check)}</b>: ${esc(p.detail)}${p.fix ? `<br><span class="fix">Fix: ${esc(p.fix)}</span>` : ''}</li>`).join('')}</ol>` : ''}
${report.agentPayable && !report.bazaarMetadata ? '<p>Add Bazaar discovery metadata (extensions.bazaar) so agents can find the endpoint in the x402 Bazaar.</p>' : ''}
</section>` : error ? `<section class="r no"><p>${esc(error)}</p></section>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Is your API agent-payable? Free x402 check</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1d2433}input,select,button{font:inherit;padding:8px}input[type=url]{width:100%;box-sizing:border-box}form{display:grid;gap:8px}.r{margin-top:24px;padding:12px 16px;border-radius:6px}.ok{background:#eaf7ee}.no{background:#fdf0ec}.fix{color:#2b5d34}code{background:#f1f3f6;padding:1px 4px}</style></head><body>
<h1>Is your API agent-payable?</h1>
<p>AI agents can pay for API calls per request with <a href="https://x402.org">x402</a> (USDC on Base). This free check runs Coinbase's x402 validator against your endpoint and tells you, in plain words, what an agent would run into and how to fix it.</p>
<form method="get" action="/x402-check"><input type="url" name="url" required placeholder="https://api.example.com/v1/endpoint" value="${esc(url)}">
<label>Method <select name="method"><option${method === 'GET' ? ' selected' : ''}>GET</option><option${method === 'POST' ? ' selected' : ''}>POST</option></select></label>
<button type="submit">Check</button></form>
${result}
<p style="margin-top:32px;color:#5a6475">Example of an endpoint that passes every check: <code>${esc(exampleUrl)}</code> (POST). JSON for agents: <code>/v1/x402-check?url=...&amp;method=GET</code>. Only a usage counter is kept; checked URLs are not stored.</p>
</body></html>`;
}
