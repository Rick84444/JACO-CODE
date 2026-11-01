import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserAttachPayload } from '../../agents/lib/local-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('startup pins the chosen Chrome page rather than an ambiguous shared URL', () => {
  const url = 'http://127.0.0.1:3000/';
  const tabs = [
    { id: 'page_1', type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page_1' },
    { id: 'page_2', type: 'page', url, webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/page_2' },
  ];
  assert.deepEqual(browserAttachPayload(tabs[1], 9222), {
    port: 9222, urlIncludes: url, targetId: 'page_2',
  });
  assert.notEqual(browserAttachPayload(tabs[0], 9222).targetId, browserAttachPayload(tabs[1], 9222).targetId);
  for (const bad of [
    { ...tabs[0], id: '' },
    { ...tabs[0], id: '../wrong' },
    { ...tabs[0], webSocketDebuggerUrl: '' },
    { ...tabs[0], url: '' },
    null,
  ]) {
    assert.throws(() => browserAttachPayload(bad, 9222), /CHROME_TARGET_ID_INVALID/);
  }
});

test('startup requires the returned attached session and the selected target identity', () => {
  const startup = read('agents/lib/local-stack.mjs');
  assert.match(startup, /body: JSON\\.stringify\\(payload\\)/);
  assert.match(startup, /attached\\.session\\?\\.attached !== true/);
  assert.match(startup, /attached\\.session\\?\\.targetId !== payload\\.targetId/);
});

test('Continuum HTTP and sidecar paths forward targetId through the existing browser owner', () => {
  const router = read('runtime/src/server/continuum/router.mjs');
  const standalone = read('runtime/src/server/continuum/standalone-server.mjs');
  const adapter = read('runtime/src/server/continuum/coreBrowserAdapter.mjs');
  const browserRouter = read('runtime/src/server/browser/router.ts');
  const browserClient = read('runtime/src/server/browser/browserHandsOff.ts');
  assert.match(router, /targetId:req\\.body\\?\\.targetId/);
  assert.match(standalone, /targetId:b\\.targetId/);
  assert.match(adapter, /targetId:input\\.targetId/);
  assert.match(browserRouter, /CdpBridge\\.attach\\(port, urlIncludes, targetId\\)/);
  assert.match(browserClient, /t\\.id === targetId/);
});
