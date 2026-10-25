import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const filename = resolve(root, 'runtime/bin/jacoctl');
const script = readFileSync(filename, 'utf8');
const expected = 'jaco-code-0.22.0';

test('Termux supervisor script is valid bash', () => {
  const proc = spawnSync('bash', ['-n', filename], { encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
});

test('Core identity is checked against the checkout release, not HTTP 200 alone', () => {
  assert.match(script, /EXPECTED_CORE_RELEASE_ID=.*CURRENT_RELEASE\.json/);
  assert.match(script, /core_truth_ready\(\)\{ svc_stable "\$CORE_SERVICE" && svc_owner_matches_checkout "\$CORE_SERVICE" && core_identity_matches_release;/);
});

const identityParserLine = script.split('\n').find(line => line.includes('JACO_EXPECTED_RELEASE_ID="$EXPECTED_CORE_RELEASE_ID" node -e'));
assert.ok(identityParserLine, 'Core identity JSON parser must exist in jacoctl');
const match = identityParserLine.match(/node -e '(.*)'$/);
assert.ok(match, 'Core identity JSON parser needs a single-quoted node expression');

function checkIdentity(payload) {
  return spawnSync(process.execPath, ['-e', match[1]], {
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, JACO_EXPECTED_RELEASE_ID: expected },
  });
}

test('Core identity gate rejects previous releases and invalid JSON', () => {
  assert.equal(checkIdentity(JSON.stringify({ success: true, releaseId: expected })).status, 0);
  assert.notEqual(checkIdentity(JSON.stringify({ success: true, releaseId: 'JACO-Cognitive-Runtime-0.21.0-REFLECTIVE-FUTURES-RC1' })).status, 0);
  assert.notEqual(checkIdentity(JSON.stringify({ success: false, releaseId: expected })).status, 0);
  assert.notEqual(checkIdentity('<!doctype html>').status, 0);
});

test('checkout root remains pinned after loading project and runtime environments', () => {
  assert.match(script, /JACO_CHECKOUT_ROOT=/);
  assert.match(script, /JACO_ROOT="\$JACO_CHECKOUT_ROOT"/);
  assert.match(script, /set_config_export JACO_ROOT "\$JACO_CHECKOUT_ROOT"/);
});

test('explicit activation enables long-running Core and Workplace supervision', () => {
  assert.match(script, /rm -f "\$\(svc_path "\$CORE_SERVICE"\)\/down" "\$\(svc_path "\$WORKPLACE_SERVICE"\)\/down"/);
});
