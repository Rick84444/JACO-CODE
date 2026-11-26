// Aura's Operator Stage is served by the runtime as this computer's start page (2026-11-25).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorStageAssets } from '../../runtime/operator-stage/assets.mjs';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime');
// CI installs the repository root, not the runtime's own packages, so runtime/node_modules/three is absent there
// (this failed the Desktop AgentOS Gate twice). The tests therefore run against a temporary runtime root holding
// copies of the REAL stage files and a small stand-in for three.js; nothing here depends on an install.
import os from 'node:os';
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-stage-src-'));
process.on('exit', () => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
for (const rel of ['operator-stage/index.html', 'operator-stage/stage.css', 'operator-stage/stage.js', 'operator-stage/setup.js', 'operator-stage/setupSteps.mjs',
  'src/lib/auraRigLightform.mjs', 'src/lib/workspaceActions.mjs', 'src/lib/speechParts.mjs']) {
  fs.mkdirSync(path.dirname(path.join(fixtureRoot, rel)), { recursive: true });
  fs.copyFileSync(path.join(runtimeRoot, rel), path.join(fixtureRoot, rel));
}
for (const [rel, text] of Object.entries({
  'node_modules/three/build/three.module.js': "export * from './three.core.js';",
  'node_modules/three/build/three.core.js': 'export const REVISION = "stand-in";',
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js': "import { Loader } from 'three';\nimport { clone } from '../utils/SkeletonUtils.js';\nexport class GLTFLoader extends Loader {}",
  'node_modules/three/examples/jsm/utils/SkeletonUtils.js': 'export const clone = x => x;',
  'node_modules/three/examples/jsm/utils/BufferGeometryUtils.js': 'export const toTrianglesDrawMode = x => x;',
})) { fs.mkdirSync(path.dirname(path.join(fixtureRoot, rel)), { recursive: true }); fs.writeFileSync(path.join(fixtureRoot, rel), text); }
const assets = operatorStageAssets(fixtureRoot);
const threeInstalled = true;

test('the stage page and the modules it shares with the IDE resolve to real files', () => {
  assert.equal(assets.available(), true);
  for (const p of ['/', '/stage.js', '/stage.css', '/vendor/aura-rig.mjs', '/vendor/workspace-actions.mjs', '/vendor/speech-parts.mjs']) {
    assert.ok(assets.resolve(p), p);
  }
  assert.match(assets.resolve('/vendor/aura-rig.mjs').file, /src[\\/]lib[\\/]auraRigLightform\.mjs$/);
  assert.equal(assets.kind, 'source');
  for (const p of ['/setup.js', '/setup-steps.mjs']) assert.ok(assets.resolve(p), p);
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

// 2026-11-26: /setup.js was missing from the route list, fell through to the IDE's index.html, and the stage
// (which imports it) loaded nothing. Every module the stage imports must be both served and routed.
test('every module the stage imports is resolved by the assets and routed by the runtime', () => {
  const server = fs.readFileSync(path.join(runtimeRoot, 'server.ts'), 'utf8');
  const routes = /app\.get\((\[[^\]]*'\/stage\.js'[^\]]*\])/.exec(server)?.[1] || '';
  assert.ok(routes, 'the stage route list is in server.ts');
  const imported = new Set();
  for (const file of ['stage.js', 'setup.js']) {
    const text = fs.readFileSync(path.join(runtimeRoot, 'operator-stage', file), 'utf8');
    for (const m of text.matchAll(/from\s+'(\/[^']+)'|import\('(\/[^']+)'\)/g)) imported.add(m[1] || m[2]);
  }
  assert.ok(imported.size >= 5, 'the stage imports its modules');
  for (const url of imported) {
    assert.ok(assets.resolve(url), `${url} is not served by operatorStageAssets`);
    const inList = routes.includes(`'${url}'`) || (url.startsWith('/vendor/') && routes.includes("'/vendor/*'"));
    assert.ok(inList, `${url} is not in the runtime's route list, so it would fall through to the IDE page`);
  }
  for (const url of ['/', '/stage.css', '/stage.js']) assert.ok(routes.includes(`'${url}'`), url);
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
