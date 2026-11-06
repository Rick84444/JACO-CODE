import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { localTools } from '../../agents/hands-off-agent.mjs';

test('a shell step runs in the directory it is given, not in the checkout the agent was started from', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shell-cwd-')));
  try {
    const inside = localTools.shell('node -e "console.log(process.cwd())"', 15000, dir);
    assert.equal(inside.ok, true);
    assert.equal(fs.realpathSync(inside.output.trim()), dir);
    const outside = localTools.shell('node -e "console.log(process.cwd())"', 15000);
    assert.notEqual(fs.realpathSync(outside.output.trim()), dir, 'without a directory it keeps the old behaviour');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
