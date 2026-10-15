import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createProjectRoot } from './projectRoot.mjs';

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('fallback when nothing is set', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const projectRoot = createProjectRoot({ stateDir, fallbackRoot, env: {} });

  assert.equal(projectRoot.get(), path.resolve(fallbackRoot));
  assert.deepEqual(projectRoot.history(), []);
});

test('env root used when valid and ignored when not a directory', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const envRoot = makeTempDir('jaco-env-');

  const withEnv = createProjectRoot({
    stateDir,
    fallbackRoot,
    env: { JACO_PROJECT_ROOT: envRoot },
  });
  assert.equal(withEnv.get(), path.resolve(envRoot));

  const withBadEnv = createProjectRoot({
    stateDir,
    fallbackRoot,
    env: { JACO_PROJECT_ROOT: path.join(stateDir, 'does-not-exist') },
  });
  assert.equal(withBadEnv.get(), path.resolve(fallbackRoot));
});

test('set persists and survives a new createProjectRoot instance', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const projectA = makeTempDir('jaco-a-');

  const first = createProjectRoot({ stateDir, fallbackRoot, env: {} });
  assert.equal(first.set(projectA), path.resolve(projectA));
  assert.equal(first.get(), path.resolve(projectA));

  const second = createProjectRoot({ stateDir, fallbackRoot: stateDir, env: {} });
  assert.equal(second.get(), path.resolve(projectA));

  const persisted = JSON.parse(
    fs.readFileSync(path.join(stateDir, 'project-root.json'), 'utf8'),
  );
  assert.equal(persisted.root, path.resolve(projectA));
  assert.equal(typeof persisted.setAt, 'string');
  assert.ok(!Number.isNaN(Date.parse(persisted.setAt)));
  assert.deepEqual(persisted.history, [path.resolve(projectA)]);
});

test('history keeps distinct roots newest first capped at 10', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const projectRoot = createProjectRoot({ stateDir, fallbackRoot, env: {} });

  const dirs = [];
  for (let i = 0; i < 12; i += 1) dirs.push(makeTempDir(`jaco-h${i}-`));
  for (const dir of dirs) projectRoot.set(dir);

  const expected = dirs.slice(-10).map((dir) => path.resolve(dir)).reverse();
  assert.deepEqual(projectRoot.history(), expected);

  // re-setting an existing root must not duplicate it, only move it to the front
  projectRoot.set(dirs[11]);
  const after = projectRoot.history();
  assert.equal(after.length, 10);
  assert.equal(after[0], path.resolve(dirs[11]));
  assert.equal(after.filter((item) => item === path.resolve(dirs[11])).length, 1);
});

test('a deleted persisted root falls back', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const projectA = makeTempDir('jaco-a-');

  const projectRoot = createProjectRoot({ stateDir, fallbackRoot, env: {} });
  projectRoot.set(projectA);
  assert.equal(projectRoot.get(), path.resolve(projectA));

  fs.rmSync(projectA, { recursive: true, force: true });

  const fresh = createProjectRoot({ stateDir, fallbackRoot, env: {} });
  assert.equal(fresh.get(), path.resolve(fallbackRoot));
});

test('invalid paths', () => {
  const stateDir = makeTempDir('jaco-state-');
  const fallbackRoot = makeTempDir('jaco-fallback-');
  const projectA = makeTempDir('jaco-a-');
  const projectRoot = createProjectRoot({ stateDir, fallbackRoot, env: {} });

  // set(): relative path
  assert.throws(() => projectRoot.set('relative/path'), /PROJECT_ROOT_NOT_DIRECTORY/);
  // set(): missing directory
  assert.throws(
    () => projectRoot.set(path.join(stateDir, 'missing-dir')),
    /PROJECT_ROOT_NOT_DIRECTORY/,
  );
  // set(): existing file
  const filePath = path.join(stateDir, 'a-file.txt');
  fs.writeFileSync(filePath, 'not a directory');
  assert.throws(() => projectRoot.set(filePath), /PROJECT_ROOT_NOT_DIRECTORY/);
  // set(): directory inside stateDir
  const insideState = path.join(stateDir, 'inside-state');
  fs.mkdirSync(insideState);
  assert.throws(() => projectRoot.set(insideState), /PROJECT_ROOT_INSIDE_STATE/);
  assert.throws(() => projectRoot.set(stateDir), /PROJECT_ROOT_INSIDE_STATE/);

  // resolve(): traversal, absolute outside the root, NUL byte
  assert.equal(projectRoot.set(projectA), path.resolve(projectA));
  assert.throws(() => projectRoot.resolve('../x'), /PATH_OUTSIDE_PROJECT/);
  assert.throws(
    () => projectRoot.resolve(path.join(os.tmpdir(), 'outside-root')),
    /PATH_OUTSIDE_PROJECT/,
  );
  assert.throws(() => projectRoot.resolve('nul\0byte'), /PATH_OUTSIDE_PROJECT/);
});
