// `start <app>` returns at once; the launched app used to keep the shell step waiting for its whole timeout
// because it inherited the captured output pipes (Notepad opened three times, every step "failed", 2026-11-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const windows = process.platform === 'win32';

test('a start command returns quickly although the launched program keeps running', { skip: !windows }, async () => {
  const { localTools } = await import('../../agents/hands-off-agent.mjs');
  const began = Date.now();
  // The child lives for ~8 s and would hold the captured pipes; the step must not wait for it.
  const result = localTools.shell('start "" /min cmd /c ping -n 8 127.0.0.1 >nul', 5000);
  const took = Date.now() - began;
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
  assert.equal(result.exitCode, 0);
  assert.ok(took < 4000, `returned after ${took} ms`);
});

test('an ordinary command still captures its output, and /wait keeps the old behaviour', { skip: !windows }, async () => {
  const { localTools } = await import('../../agents/hands-off-agent.mjs');
  const ordinary = localTools.shell('echo kept');
  assert.equal(ordinary.ok, true);
  assert.match(ordinary.output, /kept/);
  const waited = localTools.shell('start /wait "" cmd /c echo waited', 5000);
  assert.equal(waited.ok, true);
});

test('only a leading start with no /wait is treated as a launch', () => {
  const source = fs.readFileSync(new URL('../../agents/hands-off-agent.mjs', import.meta.url), 'utf8');
  const line = source.split('\n').find(l => l.includes('const launch = '));
  assert.ok(line, 'the launch rule exists');
  assert.ok(line.includes("process.platform === 'win32'"));
  assert.ok(line.includes('start'));
  assert.ok(line.includes('/wait'));
});
