import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { runtimeReleaseRoot } from '../../runtime/src/server/runtimeReleaseRoot.mjs';

test('runtime source and bundled server resolve the same frontend independently of cwd', () => {
  const runtime = path.resolve('/installation/JACO-CODE/runtime');
  assert.equal(runtimeReleaseRoot({moduleFile:path.join(runtime,'server.ts')}),runtime);
  assert.equal(runtimeReleaseRoot({moduleFile:path.join(runtime,'dist/server.cjs')}),runtime);
  assert.equal(runtimeReleaseRoot({moduleFile:path.join(runtime,'dist/server.cjs'),override:'/explicit/runtime'}),path.resolve('/explicit/runtime'));
});
test('development and production both serve the release-owned UI', () => {
  const server=fs.readFileSync(new URL('../../runtime/server.ts',import.meta.url),'utf8');
  assert.match(server,/const RELEASE_ROOT = runtimeReleaseRoot\(/);
  assert.match(server,/root: RELEASE_ROOT/);
  assert.match(server,/configFile: path\.join\(RELEASE_ROOT, 'vite.config.ts'\)/);
  assert.match(server,/const distPath = path\.join\(RELEASE_ROOT, 'dist'\)/);
});
