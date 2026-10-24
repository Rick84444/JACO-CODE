import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { htmlSession, uncleanHtmlReason, MAX_HTML_BYTES, HTML_CLEANER } from '../../agents/nova-bridge.mjs';
import { createCdpFacade } from '../../agents/cdp-bridge.mjs';

// A CDP session that answers Runtime.evaluate in order and records what was asked.
const session = (...values) => {
  const asked = [];
  return { asked, send: async (method, params) => { asked.push(params.expression); return { result: { value: values.shift() } }; } };
};
const allowOnly = origin => url => { try { return new URL(url).origin === origin; } catch { return false; } };
const page = html => ({ url: 'https://shop.example/p', title: 'Shop', html });

test('a disallowed page is refused before its markup is read', async () => {
  const s = session('https://bank.example/account', page('<html></html>'));
  assert.deepEqual(await htmlSession(s, { isAllowed: allowOnly('https://shop.example') }), { ok: false, error: 'ORIGIN_DENIED' });
  assert.equal(s.asked.length, 1, 'only location.href was evaluated');
});

test('cleaned markup is returned with its digest and size', async () => {
  const html = '<!doctype html><html><head><style>h1{color:red}</style></head><body><h1 class="t">Hej</h1><input name="q"></body></html>';
  const s = session('https://shop.example/p', page(html));
  const r = await htmlSession(s, { isAllowed: allowOnly('https://shop.example') });
  assert.equal(r.ok, true); assert.equal(r.html, html); assert.equal(r.bytes, Buffer.byteLength(html));
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.equal(s.asked[1], HTML_CLEANER, 'the in-page cleaner ran');
});

test('the bridge refuses markup that still carries scripts, form values, hidden fields, handlers or data attributes', async () => {
  for (const [html, reason] of [
    ['<html><script>x</script></html>', 'script'], ['<html><!-- secret --></html>', 'comment'],
    ['<input type="hidden" name="csrf">', 'hidden-field'], ['<input name="u" value="me@x">', 'form-value'],
    ['<button onclick="go()">', 'event-handler'], ['<div data-session="abc">', 'data-attribute'],
  ]) {
    assert.equal(uncleanHtmlReason(html), reason);
    const r = await htmlSession(session('https://shop.example/p', page(html)), { isAllowed: allowOnly('https://shop.example') });
    assert.deepEqual(r, { ok: false, error: 'HTML_NOT_CLEAN:' + reason });
  }
  assert.equal(uncleanHtmlReason('<p>Someone said: on=off, value=1</p>'), null, 'text content is not mistaken for attributes');
});

test('oversized pages are refused instead of truncated', async () => {
  const r = await htmlSession(session('https://shop.example/p', page('<p>' + 'x'.repeat(MAX_HTML_BYTES) + '</p>')), { isAllowed: allowOnly('https://shop.example') });
  assert.equal(r.ok, false); assert.equal(r.error, 'HTML_TOO_LARGE');
});

test('the in-page cleaner removes scripts, comments, form values, hidden fields, token metadata, handlers and data attributes', () => {
  for (const part of ["script,noscript,template,iframe,object,embed,input[type=hidden]", "csrf|xsrf|token|nonce|session|auth|key|secret",
    "removeAttribute('value')", 'SHOW_COMMENT', "n.startsWith('data-') || n.startsWith('on')"]) assert.ok(HTML_CLEANER.includes(part), part);
});

test('MCP advertises nova_html as a read-only tool', async () => {
  const token = 'test-token-12345678901234567890';
  const server = createCdpFacade({ token, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const tool = (await res.json()).result.tools.find(t => t.name === 'nova_html');
    assert.ok(tool); assert.equal(tool.annotations.readOnlyHint, true);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('the runtime allows nova_html and keeps only its origin, size and digest in durable receipts', () => {
  const server = fs.readFileSync(new URL('../../runtime/server.ts', import.meta.url), 'utf8');
  assert.match(server, /\['nova_targets','nova_observe','nova_screenshot','nova_html'\]/);
  assert.match(server, /toolName === 'nova_html'[\s\S]{0,400}htmlOmitted: true/);
  const stage = fs.readFileSync(new URL('../../runtime/src/components/CapturedPage.tsx', import.meta.url), 'utf8');
  assert.match(stage, /sandbox=""/); assert.match(stage, /sanitizeAuraStageHtml/);
});

// Regressions for PR #13 review: URLs and element values that carried tokens past the cleaner and the gate.
test('the bridge refuses markup whose links, images, styles or element values still carry query strings or values', async () => {
  for (const html of ['<a href="https://shop.example/reset?token=abc">x</a>', '<img src="https://cdn.example/x.png?sig=SECRET">',
    '<form action="/login?next=/admin#t">', '<img srcset="https://cdn.example/a.png?s=1 1x, https://cdn.example/b.png 2x">',
    '<div style="background:url(https://cdn.example/bg.png?sig=1)">', '<style>.h{background:url("/bg.png#t")}</style>',
    '<link rel="stylesheet" href="https://cdn.example/a.css?session=1">']) {
    assert.equal(uncleanHtmlReason(html), 'url-query', html);
    const r = await htmlSession(session('https://shop.example/p', page(html)), { isAllowed: allowOnly('https://shop.example') });
    assert.deepEqual(r, { ok: false, error: 'HTML_NOT_CLEAN:url-query' }, html);
  }
  assert.equal(uncleanHtmlReason('<button value="secret">x</button>'), 'form-value');
  assert.equal(uncleanHtmlReason('<li value="3">x</li>'), 'form-value');
  for (const html of ['<a href="#section">x</a>', '<a href="https://shop.example/p/item">x</a>', '<img src="data:image/png;base64,iVBORw0KGgo=">',
    '<div style="color:red">x</div>', '<style>.h{background:url("https://cdn.example/bg.png")}</style>', '<p>See url(x?y) or a?b=c in text</p>'])
    assert.equal(uncleanHtmlReason(html), null, html);
});

test('the in-page cleaner strips URL queries and fragments, redacts opaque path segments and removes every value attribute', () => {
  for (const part of ["u.origin + u.pathname", "opaque.test(s) ? 'redacted'", "'srcset'", "cssUrls(a.value)", "if (n === 'value') { e.removeAttribute('value')"])
    assert.ok(HTML_CLEANER.includes(part), part);
  assert.doesNotThrow(() => new Function('return ' + HTML_CLEANER.replace(/\(\)\s*$/, '')), 'the cleaner source parses as JavaScript');
});
