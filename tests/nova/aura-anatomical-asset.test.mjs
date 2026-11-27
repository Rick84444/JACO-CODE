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
