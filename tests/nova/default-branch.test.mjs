// This repository's default branch is `main`. There has never been a `master` branch on the remote.
//
// Naming one anyway is not a cosmetic slip, it is silent breakage, and it broke two separate things:
//   - a workflow whose only push trigger was `master` never ran, so the JACO Lite download was never published;
//   - agents/nova-deliver.mjs fetched `origin/master`, which throws, so autonomous delivery died before it
//     pushed, opened a PR or merged anything.
// Both fail quietly: a workflow that never fires reports nothing, and a delivery that throws is just a tool error.
// These checks are the falsifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBaseBranch } from '../../agents/nova-deliver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowDir = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name));
const read = file => fs.readFileSync(path.join(workflowDir, file), 'utf8');

// Branch filters, without a YAML parser: the `branches:` / `branches-ignore:` keys under a trigger, in both the
// inline (`branches: [main]`) and block (`branches:\n  - main`) forms.
function branchFilters(source) {
  const found = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const inline = /^\s*(branches|branches-ignore):\s*\[(.*)\]\s*$/.exec(lines[index]);
    if (inline) { found.push(...inline[2].split(',').map(entry => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)); continue; }
    if (!/^\s*(branches|branches-ignore):\s*$/.test(lines[index])) continue;
    const indent = lines[index].search(/\S/);
    for (let next = index + 1; next < lines.length; next += 1) {
      const item = /^(\s*)-\s*(.+?)\s*$/.exec(lines[next]);
      if (!item || item[1].length <= indent) break;
      found.push(item[2].replace(/^['"]|['"]$/g, ''));
    }
  }
  return found;
}

test('no workflow filters on a `master` branch, because there is none', () => {
  const offenders = workflows
    .map(file => [file, branchFilters(read(file)).filter(branch => branch === 'master')])
    .filter(([, hits]) => hits.length);
  assert.deepEqual(offenders, [], `branch filters naming master: ${offenders.map(([file]) => file).join(', ')}`);
});

test('every workflow can actually be triggered', () => {
  // A push-only workflow whose branch list leaves out main can never fire. Anything else (pull_request,
  // workflow_dispatch, schedule, workflow_call, workflow_run, repository_dispatch) gives it another way in.
  const dead = [];
  for (const file of workflows) {
    const source = read(file);
    const pushOnly = /^\s{2}push:\s*$/m.test(source)
      && !/^\s{2}(pull_request|pull_request_target|workflow_dispatch|schedule|workflow_call|workflow_run|repository_dispatch):/m.test(source);
    if (!pushOnly) continue;
    const branches = branchFilters(source);
    if (branches.length && !branches.includes('main')) dead.push(`${file} -> ${branches.join(', ')}`);
  }
  assert.deepEqual(dead, [], `push-only workflows that can never fire: ${dead.join(' | ')}`);
});

test('nova delivery asks the repository for its base branch instead of assuming one', () => {
  const source = fs.readFileSync(path.join(root, 'agents/nova-deliver.mjs'), 'utf8');
  assert.doesNotMatch(source, /const base = ['"][a-z]/, 'the base branch must be resolved, not hardcoded');

  const originHead = (...args) => {
    if (args[0] === 'symbolic-ref') return 'origin/main';
    throw new Error('unexpected git call: ' + args.join(' '));
  };
  assert.equal(resolveBaseBranch(originHead, {}), 'main');

  // An operator override wins, and is what a fork or a release line would use.
  assert.equal(resolveBaseBranch(originHead, { JACO_GIT_BASE_BRANCH: 'release/1.x' }), 'release/1.x');

  // A clone without origin/HEAD falls back to asking the remote, then to main. Never to master.
  const remoteShow = (...args) => {
    if (args[0] === 'remote') return 'HEAD branch: trunk';
    throw new Error('no origin/HEAD in this clone');
  };
  assert.equal(resolveBaseBranch(remoteShow, {}), 'trunk');
  const nothing = () => { throw new Error('offline'); };
  assert.equal(resolveBaseBranch(nothing, {}), 'main');
});

test('importing the delivery script does not deliver', async () => {
  // resolveBaseBranch has to be reachable from a test without the module pushing a branch or exiting the process.
  const source = fs.readFileSync(path.join(root, 'agents/nova-deliver.mjs'), 'utf8');
  assert.match(source, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  assert.equal(typeof resolveBaseBranch, 'function');
});

test('the runtime and the security policy name main as this repository default', () => {
  const engine = fs.readFileSync(path.join(root, 'runtime/src/auraEngine.ts'), 'utf8');
  const gitOpsBranch = /JACO_GIT_BRANCH \|\| "([^"]+)"/.exec(engine);
  assert.ok(gitOpsBranch, 'GitOps default branch not found');
  assert.equal(gitOpsBranch[1], 'main');

  assert.match(fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8'), /Only the current `main`/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'runtime/server.ts'), 'utf8'), /merge to master/);
});
