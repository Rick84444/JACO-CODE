// Aura's Operator Stage is served by the runtime as this computer's start page (2026-11-25).
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorStageAssets } from '../../runtime/operator-stage/assets.mjs';

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../runtime');
const assets = operatorStageAssets(runtimeRoot);

test('the stage page and the modules it shares with the IDE resolve to real files', () => {
  assert.equal(assets.available(), true);
  for (const p of ['/', '/stage.js', '/stage.css', '/vendor/aura-rig.mjs', '/vendor/workspace-actions.mjs', '/vendor/speech-parts.mjs']) {
    assert.ok(assets.resolve(p), p);
  }
  assert.match(assets.resolve('/vendor/aura-rig.mjs').file, /src[\\/]lib[\\/]auraRigLightform\.mjs$/);
});

test('three.js is served only from its own build and addon folders', () => {
  assert.ok(assets.resolve('/vendor/three/build/three.module.js'));
  assert.ok(assets.resolve('/vendor/three/addons/loaders/GLTFLoader.js'));
  for (const p of ['/vendor/three/build/../../package.json', '/vendor/three/build/../../../server.ts', '/vendor/three/addons/..%2F..%2Fpackage.json',
    '/vendor/three/build/three.module.json', '/vendor/other.mjs', '/server.ts', '/.env']) {
    assert.equal(assets.resolve(p), null, p);
  }
});

// The runtime CSP allows no inline import map; bare `three` imports must reach the browser already resolved.
test('served modules carry no bare three imports, and the page has no inline script', async () => {
  const fs = await import('node:fs');
  for (const p of ['/vendor/aura-rig.mjs', '/vendor/three/addons/loaders/GLTFLoader.js', '/vendor/three/build/three.module.js']) {
    const text = assets.read(assets.resolve(p)).toString('utf8');
    assert.doesNotMatch(text, /from\s*['"]three(['"]|\/addons\/)/, p);
  }
  assert.match(assets.read(assets.resolve('/vendor/aura-rig.mjs')).toString('utf8'), /from\s*'\/vendor\/three\/build\/three\.module\.js'/);
  const html = fs.readFileSync(assets.resolve('/').file, 'utf8');
  for (const tag of html.match(/<script\b[^>]*>/g) || []) assert.match(tag, /\bsrc=/, 'inline script: ' + tag);
});

test('a release without the stage files reports it, so the runtime keeps the IDE at /', () => {
  assert.equal(operatorStageAssets(path.join(runtimeRoot, 'does-not-exist')).available(), false);
});
