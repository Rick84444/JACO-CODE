import assert from 'node:assert/strict';
import test from 'node:test';
import { localTools } from '../../agents/hands-off-agent.mjs';

// A command that omits its timeout used to be killed after 30 s (ETIMEDOUT), which made long but healthy
// commands such as npm test look like a blocked environment.
test('a shell task without a timeout runs past the old 30 second limit', { timeout: 60_000 }, () => {
  const started = Date.now();
  const result = localTools.shell(`"${process.execPath}" -e "setTimeout(()=>console.log('done'),31500)"`);
  assert.equal(result.ok, true, result.error);
  assert.match(result.output, /done/);
  assert.ok(Date.now() - started >= 31_000);
});

test('an explicit timeout is honoured and bounded', () => {
  const short = localTools.shell(`"${process.execPath}" -e "setTimeout(()=>{},5000)"`, 1500);
  assert.equal(short.ok, false);
  assert.match(short.error, /ETIMEDOUT/);
  const source = String(localTools.shell);
  assert.match(source, /300000/);
});
