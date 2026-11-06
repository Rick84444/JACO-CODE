import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBrowser } from '../src/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

test('the server speaks MCP over stdio and lists its tools with honest hints', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'server.mjs')], env: { ...process.env, JACO_BROWSER_LAUNCH: '0', JACO_CDP_PORT: '1' } }));
  try {
    const tools = Object.fromEntries((await client.listTools()).tools.map(t => [t.name, t]));
    assert.deepEqual(Object.keys(tools).sort(), ['browser_click', 'browser_close_tab', 'browser_open', 'browser_press', 'browser_read', 'browser_switch_tab', 'browser_tabs', 'browser_type']);
    assert.equal(tools.browser_read.annotations.readOnlyHint, true);
    assert.equal(tools.browser_click.annotations.readOnlyHint, false);
    // Without a browser and with launching off, a call fails with a reason instead of hanging.
    const r = await client.callTool({ name: 'browser_open', arguments: { url: 'https://example.com' } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /No browser on port 1/);
  } finally { await client.close(); }
});

test('sign-in, payment and non-web addresses are refused before any browser is touched', async () => {
  let touched = false;
  const browser = createBrowser({ port: 1, env: { JACO_BROWSER_LAUNCH: '0' }, fetchImpl: async () => { touched = true; throw new Error('no'); } });
  await assert.rejects(browser.open('https://accounts.google.com/signin'), /REFUSED/);
  await assert.rejects(browser.open('https://shop.example/checkout'), /REFUSED/);
  await assert.rejects(browser.open('file:///etc/passwd'), /URL_INVALID/);
  await assert.rejects(browser.read(), /NO_TAB/);
  await assert.rejects(browser.closeTab('someone-elses-tab'), /TAB_NOT_OWNED/);
  assert.equal(touched, false);
});
