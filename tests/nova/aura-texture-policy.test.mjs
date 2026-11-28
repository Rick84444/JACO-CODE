// 2026-11-28: on the Operator Stage the V31 model rendered white. GLTFLoader fetched its embedded textures through
// blob: URLs, which the page's connect-src 'self' refuses. The rig loads them as image elements (img-src allows
// blob:), without widening the page policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('the model textures load within the page security policy, without widening it', () => {
  const rig = read('runtime/src/lib/auraRigLightform.mjs');
  assert.match(rig, /parser\.textureLoader=new THREE\.TextureLoader\(parser\.options\.manager\)/);
  assert.doesNotMatch(rig, /new GLTFLoader\(\)\.parseAsync/, 'every model goes through the image-element loader');
  const policy = read('runtime/src/server/security/httpHardening.ts');
  assert.match(policy, /"img-src 'self' data: blob:"/);
  assert.match(policy, /: "connect-src 'self'",/);
});
