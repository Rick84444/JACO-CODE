import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readAuraResponse } from '../../runtime/src/lib/auraApi.mjs';

const root = resolve(process.cwd());
const read = file => readFileSync(resolve(root, file), 'utf8');

test('failed Git execution exposes its stderr instead of only HTTP_409', async () => {
  const gitError = "fatal: Unable to create '.git/index.lock': File exists.";
  const response = new Response(JSON.stringify({
    success: false,
    status: 'failed',
    actionId: 'action-test',
    result: { success: false, output: gitError },
    error: gitError,
  }), { status: 409, headers: { 'content-type': 'application/json' } });

  await assert.rejects(readAuraResponse(response), error => {
    assert.match(error.message, /Unable to create.*index\.lock/);
    assert.doesNotMatch(error.message, /HTTP_409/);
    return true;
  });
});

test('git route preserves process receipts and projects bounded command errors to response', () => {
  const server = read('runtime/server.ts');
  const routeStart = server.indexOf("app.post('/api/aura/workbench/git/action'");
  assert.ok(routeStart >= 0, 'Git action route must exist');
  const route = server.slice(routeStart, server.indexOf("const auraChatSession", routeStart));
  assert.match(route, /await executeTerminalAction\(action\)/);
  assert.match(route, /action\.result \|\| null/);
  assert.match(route, /\.\.\.\(action\.status !== 'executed' \? \{ error: String\(action\.result\?\.output/);
  assert.match(route, /\.slice\(0, 1200\)/);
  assert.match(route, /res\.status\(action\.status === 'executed' \? 200 : 409\)/);
});

test('Aura displays the server error on failed Git actions', () => {
  const gui = read('runtime/src/components/JacoAuraComputeIDE.tsx');
  assert.match(gui, /fetch\('\/api\/aura\/workbench\/git\/action'/);
  assert.match(gui, /Git \$\{action\} failed: \$\{error\?\.message \|\| String\(error\)\}/);
  assert.doesNotMatch(gui, /Git action not queued:/);
});

test('Termux degraded status includes observed model, SEER and Nova states', () => {
  const script = read('runtime/bin/jacoctl');
  assert.match(script, /workplace_status_summary\(\)/);
  assert.match(script, /lastNovaExit=/);
  assert.match(script, /dependency: %s/);
});
