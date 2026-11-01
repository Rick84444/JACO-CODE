import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const workflow = load('.github/workflows/lite-release.yml');
const base = 'https://github.com/Rick84444/JACO-CODE/releases/latest/download';
const raw = 'https://raw.githubusercontent.com/Rick84444/JACO-CODE/main/lite/';

test('a normal push to main verifies, but never publishes', () => {
  assert.match(workflow, /push:\n    branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      release_tag:/);
  assert.match(workflow, /confirmation:\n        description: 'Type PUBLISH/);
  const publisher = workflow.split(/^  publish:\s*$/m)[1];
  assert.ok(publisher, 'publisher job present');
  assert.match(publisher, /if: github\.event_name == 'workflow_dispatch'/);
  assert.match(publisher, /needs: \[release-gate, verified-lite, windows-lite-smoke\]/);
  assert.match(publisher, /environment: github-release/);
  assert.doesNotMatch(workflow, /wrangler@|site\/wrangler\.toml|cloudflare_api_token/i);
  assert.doesNotMatch(publisher, /github\.event_name == 'push'/);
});

test('release gate requires matching tag, main head, runtime version, and manual confirmation', () => {
  const gate = workflow.split(/^  release-gate:\s*$/m)[1]?.split(/^  verified-lite:\s*$/m)[0];
  assert.ok(gate, 'gate job present');
  assert.match(gate, /CONFIRMATION.*PUBLISH/);
  assert.match(gate, /refs\/tags\/\$RELEASE_TAG/);
  assert.match(gate, /tag_sha.*main_sha/);
  assert.match(gate, /runtime\/package\.json/);
  assert.match(gate, /\$RELEASE_TAG.*v\$version/);
  assert.match(workflow, /source_sha: \$\{\{ steps\.verify\.outputs\.source_sha \}\}/);
});

test('verified release is built, exercised on Windows, compared to manifest and served bytes', () => {
  assert.match(workflow, /needs: \[release-gate, verified-lite\]/);
  assert.match(workflow, /JACO_BUILD_SOURCE_COMMIT:/);
  assert.match(workflow, /node tools\/verify-lite\.mjs/);
  assert.match(workflow, /RELEASE_MANIFEST_VERIFIED/);
  assert.match(workflow, /RELEASE_SOURCE_MISMATCH/);
  assert.match(workflow, /gh release create.*--draft --verify-tag/);
  assert.match(workflow, /gh release edit.*--draft=false --latest/);
  assert.match(workflow, /PUBLIC_DOWNLOAD_BYTES_MATCH/);
  assert.match(workflow, /cmp "release-files\/\$file" "\$RUNNER_TEMP\/public-\$file"/);
});

test('installation and update checks point to latest GitHub Release assets', () => {
  const sh = load('lite/install.sh');
  const ps1 = load('lite/install.ps1');
  const launcher = load('lite/start.mjs');
  assert.ok(sh.includes('BASE_URL="${JACO_LITE_BASE_URL:-' + base + '}"'));
  assert.ok(ps1.includes("Env 'JACO_LITE_BASE_URL' '" + base + "'"));
  assert.ok(launcher.includes("export const UPDATE_URL = '" + base + "/latest.json'"));
  assert.ok(launcher.includes(base + '/${entry.file}'));
  assert.ok(sh.includes(raw + 'install.sh'));
  assert.ok(ps1.includes(raw + 'install.ps1'));
});
