import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ANATOMICAL_BYTES,ANATOMICAL_SHA256,validateAnatomicalHeader} from '../../runtime/src/lib/auraAnatomicalAsset.mjs';
import {verifyCandidate,installCandidate} from '../../runtime/scripts/install-aura-anatomical.mjs';
test('truncated or substituted GLB is rejected',()=>{
  assert.throws(()=>verifyCandidate(Buffer.alloc(12)),/SIZE/);
  const bytes=Buffer.alloc(ANATOMICAL_BYTES);
  assert.throws(()=>validateAnatomicalHeader(bytes.buffer),/HEADER/);
  bytes.write('glTF');bytes.writeUInt32LE(2,4);bytes.writeUInt32LE(ANATOMICAL_BYTES,8);
  assert.throws(()=>verifyCandidate(bytes),/HASH/);
});
test('exact locally provisioned candidate passes and installs atomically',{skip:!process.env.JACO_AURA_ANATOMICAL_PATH},async()=>{
  const source=process.env.JACO_AURA_ANATOMICAL_PATH,dir=await mkdtemp(join(tmpdir(),'aura-anatomical-'));
  try{
    const destination=join(dir,'aura-anatomical.glb'),result=await installCandidate(source,destination);
    assert.equal(result.sha256,ANATOMICAL_SHA256);
    const installed=await readFile(destination);
    verifyCandidate(installed);
    installed[installed.length-1]^=1;
    assert.throws(()=>verifyCandidate(installed),/HASH/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
