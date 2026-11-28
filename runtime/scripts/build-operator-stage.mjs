#!/usr/bin/env node
// Copies Aura's Operator Stage into dist/operator-stage/ with the shared modules and the five three.js files the
// rig loads, so every package built from dist/ (Lite, Windows Setup, npm) opens on Aura (operator 2026-11-25:
// "this is what opens when you install JACO, also from the website"). Run after `vite build`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AURA_STAGE_FILES } from '../operator-stage/assets.mjs';

const runtime = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(runtime, 'dist', 'operator-stage');
const three = path.join(runtime, 'node_modules', 'three');

export const STAGE_FILES = {
  'index.html': 'operator-stage/index.html',
  'stage.css': 'operator-stage/stage.css',
  'stage.js': 'operator-stage/stage.js',
  'setup.js': 'operator-stage/setup.js',
  'setup-steps.mjs': 'operator-stage/setupSteps.mjs',
  'vendor/aura-rig.mjs': 'src/lib/auraRigLightform.mjs',
  'vendor/workspace-actions.mjs': 'src/lib/workspaceActions.mjs',
  'vendor/speech-parts.mjs': 'src/lib/speechParts.mjs',
  ...AURA_STAGE_FILES,
};
export const THREE_FILES = {
  'vendor/three/build/three.module.js': 'build/three.module.js',
  'vendor/three/build/three.core.js': 'build/three.core.js',
  'vendor/three/addons/loaders/GLTFLoader.js': 'examples/jsm/loaders/GLTFLoader.js',
  'vendor/three/addons/utils/BufferGeometryUtils.js': 'examples/jsm/utils/BufferGeometryUtils.js',
  'vendor/three/addons/utils/SkeletonUtils.js': 'examples/jsm/utils/SkeletonUtils.js',
  'vendor/three/addons/objects/Reflector.js': 'examples/jsm/objects/Reflector.js',
  'vendor/three/LICENSE': 'LICENSE',
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!fs.existsSync(path.join(runtime, 'dist', 'index.html'))) throw new Error('OPERATOR_STAGE_BUILD_NEEDS_DIST: run vite build first');
  fs.rmSync(out, { recursive: true, force: true });
  const copy = (target, source) => { fs.mkdirSync(path.dirname(path.join(out, target)), { recursive: true }); fs.copyFileSync(source, path.join(out, target)); };
  for (const [target, source] of Object.entries(STAGE_FILES)) copy(target, path.join(runtime, source));
  for (const [target, source] of Object.entries(THREE_FILES)) {
    const file = path.join(three, source);
    if (!fs.existsSync(file)) throw new Error('OPERATOR_STAGE_THREE_MISSING:' + source + ' (npm install in runtime/)');
    copy(target, file);
  }
  const bytes = Object.keys({ ...STAGE_FILES, ...THREE_FILES }).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
  console.log(`operator stage: ${Object.keys({ ...STAGE_FILES, ...THREE_FILES }).length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in dist/operator-stage`);
}
