import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('CDP Studio replaces legacy raw target list without a second actuator', () => {
  const connections = read('../../runtime/src/components/ConnectionsWorkspace.tsx');
  const studio = read('../../runtime/src/components/CdpStudio.tsx');
  assert.match(connections, /tab==='browser'&&<CdpStudio\/>/);
  assert.match(studio, /providerId: 'cdp'/);
  for (const tool of ['nova_targets', 'nova_observe', 'nova_screenshot']) {
    assert.match(studio, new RegExp(tool));
  }
  for (const mutation of ['nova_navigate','nova_click','nova_type']) {
    assert.doesNotMatch(studio, new RegExp(mutation));
  }
  assert.match(studio, /get.*|refresh/);
  assert.match(studio, /aria-label="Observerade webbläsarflikar"/);
  assert.match(studio, /Observera fäst flik/);
  assert.match(studio, /Hämta skärmbild/);
});

test('CDP screenshot is on demand and bounded to PNG data', () => {
  const studio = read('../../runtime/src/components/CdpStudio.tsx');
  assert.match(studio, /image\/png/);
  assert.match(studio, /base64\.length <= 8_000_000/);
  assert.match(studio, /if \(!value\.image\) throw/);
  assert.match(studio, /onClick=\{\(\) => void run\('nova_screenshot'\)\}/);
  assert.doesNotMatch(studio, /setInterval\([^)]*nova_screenshot/s);
});

test('CDP activity uses canonical workbench evidence, not synthetic agent data', () => {
  const studio = read('../../runtime/src/components/CdpStudio.tsx');
  assert.match(studio, /fetch\('\/api\/aura\/workbench'/);
  assert.match(studio, /item\?\.type === 'mcp\.tool\.called'/);
  assert.match(studio, /item\?\.payload\?\.providerId === 'cdp'/);
  assert.match(studio, /Inga CDP-händelser registrerade/);
  assert.match(studio, /kan vara föråldrade/);
});

test('server omits image data in screenshot audit while preserving existing CDP mutation policy', () => {
  const server = read('../../runtime/server.ts');
  assert.match(server, /screenshotDataOmitted: true/);
  assert.match(server, /payloadSha256: data \? crypto\.createHash\('sha256'\)/);
  assert.match(server, /result: receiptResult/);
  assert.match(server, /CDP_DIRECT_MUTATION_DISABLED_USE_REMOTE_OR_BROWSER_HANDS_OFF/);
  assert.match(server, /\['nova_targets','nova_observe','nova_screenshot'\]/);
});
