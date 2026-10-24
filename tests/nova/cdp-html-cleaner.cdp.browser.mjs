// Real Chromium regression for the nova_html boundary: runs the production in-page cleaner over a page
// whose links, images, styles, forms and metadata carry secrets, then applies the bridge's gate.
// Requires Playwright available to the runtime test environment (same setup as aura-safe-html.cdp.browser.mjs).
// Does NOT assert that the user's live JACO instance or a live CDP bridge was tested.
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { HTML_CLEANER, uncleanHtmlReason } from '../../agents/nova-bridge.mjs';

const runtimeRoot = fileURLToPath(new URL('../../runtime/', import.meta.url));
const require = createRequire(path.join(runtimeRoot, 'package.json'));
const { chromium } = await import(process.env.JACO_PLAYWRIGHT_MODULE || require.resolve('playwright'));

const SECRETS = ['tok_RESET_9f2', 'sig_IMG_77a', 'sess_FORM_31c', 'csrf_META_5d0', 'val_BUTTON_8e1', 'q_SRCSET_4b2', 'q_CSS_6c3',
  'frag_LINK_2a9', 'typed_INPUT_1f4', 'area_TEXT_0e6', 'REFRESH_7d1', 'Zx9QmK2vLp8RtY4wNs6UbJ3hGf5DcA1eXqW7'];
const PAGE = `<!doctype html><html><head>
<meta name="csrf-token" content="csrf_META_5d0"><meta http-equiv="refresh" content="900;url=/login?r=REFRESH_7d1">
<meta property="og:url" content="https://shop.example/p?ref=tok_RESET_9f2">
<link rel="stylesheet" href="https://shop.example/a.css?v=sess_FORM_31c">
<style>.hero{background:url("https://cdn.example/hero.png?k=q_CSS_6c3") no-repeat;color:#0ff}</style>
<script>window.secret='never'</script></head><body>
<!-- internal note tok_RESET_9f2 -->
<h1 class="hero">Butik</h1>
<svg width="10" height="10"><defs><linearGradient id="paint0_linear"><stop offset="0"/></linearGradient></defs><rect id="grad" style="fill:url(#paint0_linear)" width="10" height="10"/></svg>
<a id="reset" href="https://shop.example/reset?token=tok_RESET_9f2">Återställ</a>
<a id="frag" href="/konto#frag_LINK_2a9">Konto</a>
<a id="opaque" href="https://shop.example/invite/Zx9QmK2vLp8RtY4wNs6UbJ3hGf5DcA1eXqW7/accept">Bjud in</a>
<a id="local" href="#top">Upp</a>
<img id="img" src="https://cdn.example/p.png?X-Amz-Signature=sig_IMG_77a" srcset="https://cdn.example/p.png?w=1&q=q_SRCSET_4b2 1x, https://cdn.example/p2.png 2x">
<img id="inline" src="data:image/png;base64,iVBORw0KGgo=">
<div id="styled" style="background-image:url(/bg.png?k=q_CSS_6c3);color:red" data-session="sess_FORM_31c" onclick="go()">x</div>
<form action="/login?next=sess_FORM_31c"><input id="typed" name="u"><input type="hidden" name="csrf" value="csrf_META_5d0">
<input type="password" value="typed_INPUT_1f4"><textarea>area_TEXT_0e6</textarea>
<button value="val_BUTTON_8e1">Skicka</button><select><option value="a" selected>A</option></select></form>
<a id="js" href="javascript:alert(1)">js</a></body></html>`;

let browser = null;
const ok = (condition, name) => { assert.ok(condition, name); console.log('PASS ' + name); };
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.JACO_BROWSER_EXECUTABLE ? { executablePath: process.env.JACO_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: PAGE }));
  await page.goto('https://shop.example/p');
  await page.fill('#typed', 'typed_INPUT_1f4');
  const cdp = await page.context().newCDPSession(page);
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: HTML_CLEANER, returnByValue: true });
  ok(!exceptionDetails, 'production cleaner evaluates in Chromium without exceptions');
  const { html, url } = result.value;
  ok(url === 'https://shop.example/p', 'reports the page URL');
  for (const secret of SECRETS) ok(!html.includes(secret), 'secret removed: ' + secret);
  ok(uncleanHtmlReason(html) === null, 'cleaned output passes the bridge gate');
  ok(html.includes('href="https://shop.example/reset"'), 'link kept without its query');
  ok(html.includes('href="https://shop.example/konto"'), 'relative link resolved, fragment dropped');
  ok(html.includes('/invite/redacted/accept'), 'opaque path segment redacted, rest of the path kept');
  ok(html.includes('href="#top"'), 'same-page anchor kept');
  ok(html.includes('src="data:image/png;base64,iVBORw0KGgo="'), 'inline data image kept');
  ok(html.includes('https://cdn.example/p2.png 2x'), 'srcset candidates kept without queries');
  ok(/background:\s*url\("https:\/\/cdn\.example\/hero\.png"\)/.test(html), 'stylesheet url kept without query');
  ok(html.includes('color:#0ff') || html.includes('color: #0ff') || html.includes('color:#0ff;'), 'stylesheet otherwise intact');
  ok(/url\((?:"|&quot;)#paint0_linear(?:"|&quot;)\)/.test(html), 'local SVG fragment reference kept and accepted by the gate');
  ok(!/javascript:/i.test(html), 'javascript: link removed');
  ok(!/<script/i.test(html) && !/onclick/i.test(html) && !/data-session/i.test(html), 'scripts, handlers and data attributes removed');
  ok(!/http-equiv="refresh"/i.test(html), 'meta refresh removed');
  console.log(`\n${SECRETS.length} secrets checked; cleaned page ${Buffer.byteLength(html)} bytes`);
} finally { await browser?.close(); }
