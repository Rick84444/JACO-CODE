import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configuration, serviceEnvironment } from '../../agents/lib/local-stack.mjs';

test('packaged Windows product writes runtime state to user data, not Program Files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-win-product-'));
  try {
    const installRoot = path.join(dir, 'Program Files', 'JACO CODE');
    const dataRoot = path.join(dir, 'Users', 'operator', 'AppData', 'Local', 'JACO');
    const runtime = path.join(installRoot, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    fs.mkdirSync(dataRoot, { recursive: true });
    fs.writeFileSync(path.join(runtime, 'server.ts'), '// /api/runtime/identity');
    fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '0.22.0' }));
    fs.writeFileSync(path.join(dataRoot, '.env'), 'JACO_GATEWAY_TOKEN=very_long_unique_token_for_test_000001\nJACO_START_MODE=production\n');
    fs.mkdirSync(path.join(runtime, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(runtime, 'dist', 'index.html'), 'GUI');
    fs.writeFileSync(path.join(runtime, 'dist', 'server.cjs'), 'server');
    const config = configuration(installRoot, { JACO_DATA_DIR: dataRoot, JACO_MODEL_PROVIDER: 'aura' });
    assert.equal(config.dataRoot, dataRoot);
    assert.equal(config.root, installRoot);
    assert.equal(config.env.GATEWAY_TOKEN, 'very_long_unique_token_for_test_000001');
    assert.equal(config.production, true);
    assert.equal(serviceEnvironment(config, 'runtime').JACO_WORKSPACE_ROOT, dataRoot);
    assert.equal(serviceEnvironment(config, 'workplace').JACO_WORKSPACE_ROOT, dataRoot);
    assert.equal(config.env.JACO_RELEASE_ROOT, runtime);
    assert.equal(config.env.JACO_INSTALL_ROOT, installRoot);
    assert.equal(serviceEnvironment(config, 'workplace').JACO_INSTALL_ROOT, installRoot);
    assert.equal(config.env.JACO_PLANNER_CHOICE_FILE, path.join(dataRoot, '.jaco', 'state', 'provider-preference.json'));
    // The installed user must be able to select a model without writing to Program Files.
    fs.mkdirSync(path.dirname(config.env.JACO_PLANNER_CHOICE_FILE), { recursive: true });
    fs.writeFileSync(config.env.JACO_PLANNER_CHOICE_FILE, '{}');
    assert.equal(fs.readFileSync(config.env.JACO_PLANNER_CHOICE_FILE, 'utf8'), '{}');
    assert.ok(!fs.existsSync(path.join(installRoot, '.env')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('unpackaged checkout preserves legacy root layout for existing Windows and Android runtimes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-dev-checkout-'));
  try {
    const runtime = path.join(dir, 'runtime');
    fs.mkdirSync(runtime);
    fs.writeFileSync(path.join(runtime, 'server.ts'), '// /api/runtime/identity');
    fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify({ version: '0.22.0' }));
    const config = configuration(dir, { JACO_GATEWAY_TOKEN: 'local_gate_token_which_is_long_enough', JACO_MODEL_PROVIDER: 'aura' });
    assert.equal(config.dataRoot, dir);
    assert.equal(serviceEnvironment(config, 'runtime').JACO_WORKSPACE_ROOT, undefined);
    assert.equal(serviceEnvironment(config, 'workplace').JACO_WORKSPACE_ROOT, dir);
    assert.equal(config.env.JACO_PLANNER_CHOICE_FILE, path.join(runtime, '.jaco', 'state', 'provider-preference.json'));
    assert.equal(config.env.JACO_INSTALL_ROOT, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});


test('Windows setup publishing is tag-gated, not triggered merely by a main merge', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/jaco-windows-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /publish-github-release:[\s\S]*?if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(workflow, /needs\.windows-setup\.outputs\.version_changed == 'true'/);
});

test('Windows packaged boot validates its own runtime version and runs Aura capability acceptance', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/jaco-windows-release.yml', import.meta.url), 'utf8');
  assert.match(workflow, /\$expectedRuntimeVersion = \(Get-Content \(Join-Path \$installDir 'runtime\/package\.json'\)/);
  assert.match(workflow, /\$identity\.version -eq \$expectedRuntimeVersion/);
  assert.doesNotMatch(workflow, /\$identity\.version -eq '0\.22\.0'/);
  assert.match(workflow, /tests\/nova\/capability-recovery\.test\.mjs/);
  assert.match(workflow, /tests\/nova\/agent-loop\.test\.mjs/);
});

test('installed Workplace runs supervised executables from the immutable installation', () => {
  const source = fs.readFileSync(new URL('../../gateway/src/workplace/workplace-server.mjs', import.meta.url), 'utf8');
  assert.match(source, /const EXECUTION_ROOT = resolve\(process\.env\.JACO_INSTALL_ROOT \|\| process\.cwd\(\)\)/);
  assert.match(source, /createWorkplaceAgentSupervisor\(\{ root: EXECUTION_ROOT, env: process\.env \}\)/);
});

test('Windows installation smoke validates the packaged runtime identity, not a fixed historical version', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/jaco-windows-release.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes("$expectedRuntimeVersion = (Get-Content (Join-Path $installDir 'runtime/package.json') -Raw | ConvertFrom-Json).version"));
  assert.ok(workflow.includes('$identity.version -eq $expectedRuntimeVersion'));
  assert.ok(!workflow.includes("$identity.version -eq '0.22.0'"));
  assert.ok(workflow.includes('INSTALLED_RUNTIME_VERSION_INVALID'));
  // A Windows product release can differ from the version of the embedded runtime.
  assert.ok(workflow.includes('Get-Content windows/product/version.json'));
});
