// Release rules, read from the workflow: a preview version published from main is a GitHub pre-release
// (never offered by the in-app updater); stable is published only from a tag; a version that did not change
// publishes nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/jaco-windows-release.yml'), 'utf8').split('\r\n').join('\n');

test('a preview version from main is published automatically as a pre-release', () => {
  assert.match(workflow, /github\.ref == 'refs\/heads\/main' && needs\.windows-setup\.outputs\.version_changed == 'true' && needs\.windows-setup\.outputs\.channel == 'preview'/);
  assert.match(workflow, /prerelease: \$\{\{ needs\.windows-setup\.outputs\.channel == 'preview' \}\}/);
});

test('stable is still published only from a tag', () => {
  assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(workflow, /prerelease: false\n\s+tag_name/);
});

test('the channel is validated and exposed to the publish job', () => {
  assert.match(workflow, /RELEASE_CHANNEL_INVALID/);
  assert.match(workflow, /channel: \$\{\{ steps\.product-version\.outputs\.channel \}\}/);
});
