// Aura's Operator Stage is served by the runtime as this computer's start page (2026-11-25).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorStageAssets } from '../../runtime/operator-stage/assets.mjs';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime');
const assets = operatorStageAssets(runtimeRoot);
// CI installs the repository root, not the runtime's own packages; three.js is only there after `npm install` in runtime/.
const threeInstalled = fs.existsSync(path.join(runtimeRoot, 'node_modules/three/build/three.module.js'));

test('the stage page and the modules it shares with the IDE resolve to real files', () => {
  assert.equal(assets.available(), true);
  for (const p of ['/', '/stage.js', '/stage.css', '/vendor/aura-rig.mjs', '/vendor/workspace-actions.mjs', '/vendor/speech-parts.mjs']) {
    assert.ok(assets.resolve(p), p);
  }
  assert.match(assets.resolve('/vendor/aura-rig.mjs').file, /src[\\/]lib[\\/]auraRigLightform\.mjs$/);
});

test('nothing outside three.js\'s own build and addon folders can be reached', () => {
  for (const p of ['/vendor/three/build/../../package.json', '/vendor/three/build/../../../server.ts', '/vendor/three/addons/..%2F..%2Fpackage.json',
    '/vendor/three/build/three.module.json', '/vendor/other.mjs', '/server.ts', '/.env']) {
    assert.equal(assets.resolve(p), null, p);
  }
});

test('three.js itself is served from its build and addon folders', { skip: !threeInstalled && 'runtime/node_modules not installed' }, () => {
  assert.ok(assets.resolve('/vendor/three/build/three.module.js'));
  assert.ok(assets.resolve('/vendor/three/addons/loaders/GLTFLoader.js'));
});

// The runtime CSP allows no inline import map; bare `three` imports must reach the browser already resolved.
test('the rig module reaches the browser with its three imports resolved, and the page has no inline script', () => {
  const rig = assets.read(assets.resolve('/vendor/aura-rig.mjs')).toString('utf8');
  assert.doesNotMatch(rig, /from\s*['"]three(['"]|\/addons\/)/);
  assert.match(rig, /from\s*'\/vendor\/three\/build\/three\.module\.js'/);
  assert.match(rig, /from\s*'\/vendor\/three\/addons\/loaders\/GLTFLoader\.js'/);
  const html = fs.readFileSync(assets.resolve('/').file, 'utf8');
  for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc=/, 'inline script: ' + tag);
});

test('three.js addons reach the browser with their imports resolved', { skip: !threeInstalled && 'runtime/node_modules not installed' }, () => {
  for (const p of ['/vendor/three/addons/loaders/GLTFLoader.js', '/vendor/three/build/three.module.js']) {
    assert.doesNotMatch(assets.read(assets.resolve(p)).toString('utf8'), /from\s*['"]three(['"]|\/addons\/)/, p);
  }
});

test('a release without the stage files reports it, so the runtime keeps the IDE at /', () => {
  const none = operatorStageAssets(path.join(runtimeRoot, 'does-not-exist'));
  assert.equal(none.available(), false);
  assert.equal(none.kind, null);
});

// Lite and the installers ship dist/, not src/ or node_modules/three: the build copies the stage into dist/.
test('a release layout (dist/operator-stage only) is served when the source is not there', async () => {
  const os = await import('node:os');
  const { STAGE_FILES, THREE_FILES } = await import('../../runtime/scripts/build-operator-stage.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-stage-release-'));
  try {
    for (const target of Object.keys({ ...STAGE_FILES, ...THREE_FILES })) {
      const file = path.join(root, 'dist', 'operator-stage', target);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, target.endsWith('aura-rig.mjs') ? "import * as THREE from 'three';" : '// ' + target);
    }
    const release = operatorStageAssets(root);
    assert.equal(release.kind, 'release');
    assert.match(release.resolve('/').file, /dist[\\/]operator-stage[\\/]index\.html$/);
    assert.match(release.resolve('/vendor/three/addons/utils/SkeletonUtils.js').file, /dist[\\/]operator-stage[\\/]vendor[\\/]three[\\/]addons/);
    assert.equal(release.resolve('/vendor/three/build/../../../index.html'), null);
    assert.match(release.read(release.resolve('/vendor/aura-rig.mjs')).toString(), /from '\/vendor\/three\/build\/three\.module\.js'/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the build copies every file the source layout serves', async () => {
  const { STAGE_FILES, THREE_FILES } = await import('../../runtime/scripts/build-operator-stage.mjs');
  for (const source of Object.values(STAGE_FILES)) assert.ok(fs.existsSync(path.join(runtimeRoot, source)), source);
  assert.ok(Object.keys(THREE_FILES).includes('vendor/three/LICENSE'), 'three.js is MIT: its license ships with it');
  for (const needed of ['three.module.js', 'three.core.js', 'GLTFLoader.js', 'BufferGeometryUtils.js', 'SkeletonUtils.js'])
    assert.ok(Object.keys(THREE_FILES).some(k => k.endsWith(needed)), needed);
});
