import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../start.sh', import.meta.url));
test('root launcher routes to local-stack from another cwd without installing or running agent-only', { skip: process.platform === 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jaco-root-start-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const bin = path.join(root, 'bin');
  for (const dir of [bin, path.join(root,'node_modules'), path.join(root,'runtime','node_modules')]) fs.mkdirSync(dir,{recursive:true});
  fs.copyFileSync(source,path.join(root,'start.sh'));
  fs.writeFileSync(path.join(bin,'node'), '#!/bin/sh\nif [ "$1" = "-e" ]; then exit 0; fi\nprintf "%s\\n" "$PWD" "$@"\n', {mode:0o755});
  const run = (...args) => spawnSync('bash',[path.join(root,'start.sh'), ...args],{cwd:os.tmpdir(), encoding:'utf8', env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}});
  const normal=run(); assert.equal(normal.status,0,normal.stderr); assert.deepEqual(normal.stdout.trim().split('\n'),[fs.realpathSync(root),'agents/lib/local-stack.mjs','--open']);
  const status=run('--status'); assert.equal(status.status,0,status.stderr); assert.deepEqual(status.stdout.trim().split('\n'),[fs.realpathSync(root),'agents/lib/local-stack.mjs','--status']);
  const headless=run('--no-open'); assert.equal(headless.status,0,headless.stderr); assert.deepEqual(headless.stdout.trim().split('\n'),[fs.realpathSync(root),'agents/lib/local-stack.mjs']);
  fs.rmSync(path.join(root,'runtime','node_modules'),{recursive:true});
  const missing=run(); assert.notEqual(missing.status,0); assert.match(missing.stderr,/npm run setup/);
});
