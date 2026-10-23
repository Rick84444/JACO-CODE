// Guards the two things that silently broke the install path.
//
// 1. Seven workflows triggered on `push: branches: [master]` in a repository
//    whose only branch is `main`, so they never ran on a push. CI looked
//    configured and was not.
// 2. build-lite.mjs writes versioned zips while latest.json names the download
//    (jaco-lite.zip). Publishing the versioned names makes lite/install.sh
//    resolve a URL that is not there, which is a failed install on a phone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowDir = path.join(root, '.github', 'workflows');

function remoteBranches() {
  try {
    return new Set(
      execFileSync('git', ['ls-remote', '--heads', 'origin'], { cwd: root, encoding: 'utf8', timeout: 60_000 })
        .split('\n')
        .map((line) => line.split('refs/heads/')[1])
        .filter(Boolean)
        .map((name) => name.trim()),
    );
  } catch {
    return null;
  }
}

// Reads branch names out of a workflow's on.push/on.pull_request triggers,
// covering both the inline form (branches: [main]) and the list form.
function declaredBranches(yaml) {
  const names = [];
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(/^\s*branches:\s*\[(.+)\]\s*$/);
    if (inline) {
      names.push(...inline[1].split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')));
      continue;
    }
    if (!/^\s*branches:\s*$/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const item = lines[j].match(/^\s*-\s*(.+?)\s*$/);
      if (!item) break;
      names.push(item[1].replace(/^['"]|['"]$/g, ''));
    }
  }
  // A pattern is matched against whatever branches exist, so it cannot be stale.
  return names.filter((name) => name && !/[*?\[\]!]/.test(name));
}

const branches = remoteBranches();

test('every branch a workflow triggers on exists', { skip: branches === null && 'no reachable git remote' }, () => {
  const dead = [];
  for (const file of fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name))) {
    const yaml = fs.readFileSync(path.join(workflowDir, file), 'utf8');
    for (const branch of declaredBranches(yaml)) {
      if (!branches.has(branch)) dead.push(`${file}: ${branch}`);
    }
  }
  assert.deepEqual(
    dead,
    [],
    `these workflows trigger on branches that do not exist, so they never run:\n  ${dead.join('\n  ')}`,
  );
});

test('the release is staged under the names latest.json declares', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-stage-lite-'));
  try {
    const source = path.join(work, 'lite');
    fs.mkdirSync(path.join(source, 'platforms'), { recursive: true });

    const made = {
      universal: { at: path.join(source, 'jaco-lite-9.9.9.zip'), body: 'universal', name: 'jaco-lite.zip' },
      windows: { at: path.join(source, 'platforms', 'jaco-lite-windows-9.9.9.zip'), body: 'win', name: 'jaco-lite-windows.zip' },
      android: { at: path.join(source, 'platforms', 'jaco-lite-android-9.9.9.zip'), body: 'android', name: 'jaco-lite-android.zip' },
    };
    const files = {};
    for (const [key, entry] of Object.entries(made)) {
      fs.writeFileSync(entry.at, entry.body);
      files[key] = {
        file: entry.name,
        bytes: Buffer.byteLength(entry.body),
        sha256: crypto.createHash('sha256').update(entry.body).digest('hex'),
      };
    }
    const manifest = path.join(source, 'latest.json');
    fs.writeFileSync(manifest, JSON.stringify({ schema: 'jaco.lite-latest/v1', version: '9.9.9', files }));

    const out = path.join(work, 'publish');
    const stage = () =>
      execFileSync(process.execPath, [path.join(root, 'tools', 'stage-lite-release.mjs'), source, out], {
        encoding: 'utf8',
        timeout: 60_000,
      });

    stage();

    // The installer fetches exactly these names, so these are what must exist.
    assert.deepEqual(
      fs.readdirSync(out).sort(),
      [
        'jaco-lite-android.zip',
        'jaco-lite-android.zip.sha256',
        'jaco-lite-windows.zip',
        'jaco-lite-windows.zip.sha256',
        'jaco-lite.zip',
        'jaco-lite.zip.sha256',
        'latest.json',
      ],
      'the staged names must be the ones lite/install.sh resolves',
    );
    assert.equal(fs.readFileSync(path.join(out, 'jaco-lite-android.zip'), 'utf8'), 'android');

    // A build that disagrees with its own manifest must not reach a release.
    fs.writeFileSync(made.android.at, 'tampered');
    assert.throws(stage, /latest\.json/i, 'staging a zip whose hash or size disagrees must fail');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
