import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ANATOMICAL_CANDIDATES,validateAnatomicalHeader} from '../../runtime/src/lib/auraAnatomicalAsset.mjs';
import {verifyCandidate,installCandidate} from '../../runtime/scripts/install-aura-anatomical.mjs';
test('truncated or substituted GLB is rejected',()=>{
  assert.throws(()=>verifyCandidate(Buffer.alloc(12)),/SIZE/);
  for(const candidate of ANATOMICAL_CANDIDATES){
    const bytes=Buffer.alloc(candidate.bytes);
    assert.throws(()=>validateAnatomicalHeader(bytes.buffer),/HEADER/);
    bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(candidate.bytes,8);
    assert.throws(()=>verifyCandidate(bytes),/HASH/);
  }
});
test('exact locally provisioned candidate passes and installs atomically',{skip:!process.env.JACO_AURA_ANATOMICAL_PATH},async()=>{
  const source=process.env.JACO_AURA_ANATOMICAL_PATH,dir=await mkdtemp(join(tmpdir(),'aura-anatomical-'));
  try{
    const destination=join(dir,'aura-anatomical.glb'),result=await installCandidate(source,destination);
    assert.ok(ANATOMICAL_CANDIDATES.some(c=>c.sha256===result.sha256&&c.version===result.version&&c.bytes===result.bytes));
    const installed=await readFile(destination);
    verifyCandidate(installed);
    installed[installed.length-1]^=1;
    assert.throws(()=>verifyCandidate(installed),/HASH/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

// 2026-11-28: the model rendered as a white mannequin. GLTFLoader fetches embedded textures through blob: URLs,
// which the page's connect-src 'self' refuses; image elements are allowed by img-src, so the rig loads them that way.
test('the model textures load within the page security policy, without widening it', async () => {
  const { readFileSync } = await import('node:fs');
  const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
  const rig = read('runtime/src/lib/auraRigLightform.mjs');
  assert.match(rig, /parser\.textureLoader=new THREE\.TextureLoader\(parser\.options\.manager\)/);
  const policy = read('runtime/src/server/security/httpHardening.ts');
  assert.match(policy, /"img-src 'self' data: blob:"/);
  assert.match(policy, /: "connect-src 'self'",/);
});

// Operator 2026-11-28: "see all of her". The full-body camera is fitted to the model's measured size, so head and
// boots stay in view in a tall and in a narrow canvas without shrinking her to half the height.
test('the full-body camera fits the whole figure and fills the canvas', async () => {
  const { fullBodyDistance } = await import('../../runtime/src/lib/auraAnatomicalAsset.mjs');
  const fovDeg = 42, half = Math.tan(fovDeg * Math.PI / 360);
  for (const aspect of [1.6, 0.74, 0.3]) {
    const size = { height: 1.8, width: 1.1 };
    const distance = fullBodyDistance({ ...size, aspect, fovDeg });
    const viewHeight = 2 * distance * half, viewWidth = viewHeight * aspect;
    assert.ok(viewHeight >= size.height && viewWidth >= size.width, `cut off at aspect ${aspect}`);
    assert.ok(Math.max(size.height / viewHeight, size.width / viewWidth) > 0.9, `too small at aspect ${aspect}`);
  }
});
