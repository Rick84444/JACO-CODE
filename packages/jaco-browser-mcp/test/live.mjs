// A real run: start the server over stdio, as an MCP client would, and drive a real Chrome on JACO_CDP_PORT (default 9222).
// Not part of `npm test` (it needs a browser and the network). Run: node test/live.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: 'live-check', version: '1.0.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(here, '..', 'src', 'server.mjs')], env: { ...process.env, JACO_BROWSER_LAUNCH: '0' } }));
const call = async (name, args = {}) => { const r = await client.callTool({ name, arguments: args }); const text = r.content?.[0]?.text || ''; return { error: r.isError, data: r.isError ? text : JSON.parse(text) }; };
const out = [];
const check = (label, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
try {
  const tools = (await client.listTools()).tools.map(t => t.name);
  check('the server lists its eight tools', tools.length === 8, tools.join(','));
  const opened = await call('browser_open', { url: 'https://example.com' });
  check('opens a page and reads it', !opened.error && /Example Domain/.test(opened.data.title), opened.error ? opened.data : opened.data.title);
  const missed = await call('browser_click', { name: 'Click here for prizes' });
  check('a name that is not on the page lists what is there', missed.data.ok === false && missed.data.error === 'NO_TARGET' && missed.data.available.length > 0, JSON.stringify(missed.data.available));
  const clicked = await call('browser_click', { name: 'Learn more' });
  check('a real click on the link lands on the next page and is verified', clicked.data.ok && clicked.data.verified && /iana\.org/.test(clicked.data.now?.url || ''), JSON.stringify(clicked.data.now));
  const refused = await call('browser_open', { url: 'https://accounts.google.com/signin' });
  check('a sign-in page is refused', refused.error && /REFUSED/.test(refused.data), refused.data);
  const tabs = await call('browser_tabs');
  check('only its own tab is listed', !tabs.error && tabs.data.tabs.length >= 1, String(tabs.data.tabs?.length));
  for (const t of tabs.data.tabs || []) await call('browser_close_tab', { id: t.id });
} finally { await client.close(); }
console.log(out.join('\n'));
