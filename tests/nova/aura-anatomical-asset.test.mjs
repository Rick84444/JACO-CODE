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
