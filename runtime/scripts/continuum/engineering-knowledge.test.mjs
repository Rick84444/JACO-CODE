import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {KnowledgeStore} from '../../src/server/continuum/knowledgeStore.mjs';
import {ENGINEERING_KNOWLEDGE,seedEngineeringKnowledge} from '../../src/server/continuum/engineeringKnowledge.mjs';
const runtime=fileURLToPath(new URL('../..',import.meta.url));
test('engineering references exist, are searchable, and never grant verification or execution',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jaco-engineering-'));
 try{
  const events=[];const store=new KnowledgeStore(dir,{append:e=>events.push(e)});
  assert.equal(seedEngineeringKnowledge(store).length,6);
  for(const item of ENGINEERING_KNOWLEDGE){
   const record=store.get(item.id);
   assert.equal(record.verificationStatus,'UNVERIFIED');assert.equal(record.reusable,false);
   assert.deepEqual(record.evidenceRefs,[]);assert.equal(record.confidence,0);
   for(const file of item.implementation.files)assert.ok(fs.existsSync(path.resolve(runtime,'..',file.path)),file.path);
  }
  assert.ok(store.search('3D avatar').some(k=>k.id==='engineering_3d_rig_v1'));
  assert.ok(store.search('NVIDIA Audio2Face').some(k=>k.id==='engineering_3d_neural_face_v1'));
  assert.equal(seedEngineeringKnowledge(store).length,0);assert.equal(events.length,6);
  store.setStatus('engineering_3d_neural_face_v1','STALE',{reason:'local retest required'});
  seedEngineeringKnowledge(store);
  assert.equal(store.get('engineering_3d_neural_face_v1').verificationStatus,'STALE');
  assert.ok(!store.search('NVIDIA Audio2Face').some(k=>k.id==='engineering_3d_neural_face_v1'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
