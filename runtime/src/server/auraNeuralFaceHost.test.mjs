import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FACE_CHANNELS} from '../lib/auraNeuralFace.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeuralFaceHost} from './auraNeuralFaceHost.mjs';
test('disabled by default, invalid configuration never starts an executable',async()=>{
 const h=createNeuralFaceHost({});assert.equal(await h.available(),false);assert.equal(await h.analyze('AAAA'),null);
 const other=createNeuralFaceHost({JACO_A2F_ENABLED:'1',JACO_A2F_EXECUTABLE:'relative',JACO_A2F_MODEL_JSON:'relative'});
 assert.equal(await other.available(),false);
});
test('unavailable executable and aborted inference fail closed',async()=>{
 const h=createNeuralFaceHost({JACO_A2F_ENABLED:'1',JACO_A2F_EXECUTABLE:'/nonexistent-a2f',JACO_A2F_MODEL_JSON:'/nonexistent-model'});
 assert.equal(await h.available(),false);const c=new AbortController();c.abort();assert.equal(await h.analyze('AAAA',c.signal),null);
});

test('real child-process protocol validates PCM and returns only bounded named frames',async()=>{
 const root=await mkdtemp(join(tmpdir(),'jaco-a2f-test-'));
 try{
  const script=join(root,'fake-sdk.cjs');
  const names=FACE_CHANNELS.slice(0,12);
  await writeFile(script,"const fs=require('node:fs');const b=fs.readFileSync(process.argv[3]);if(b.length!==64000)process.exit(2);console.log('SDK diagnostic');console.log('JACO_A2F_JSON:'+JSON.stringify("+JSON.stringify({protocol:'jaco-a2f/1',names,frames:Array.from({length:11},(_,i)=>[i/10,...names.map(()=>i/10)])})+"));");
  const h=createNeuralFaceHost({JACO_A2F_ENABLED:'1',JACO_A2F_EXECUTABLE:process.execPath,JACO_A2F_MODEL_JSON:script});
  assert.equal(await h.available(),true);
  const bytes=Buffer.alloc(64000);bytes.writeFloatLE(NaN,0);assert.equal(await h.analyze(bytes.toString('base64')),null);
  bytes.writeFloatLE(.2,0);
  const result=await h.analyze(bytes.toString('base64'));assert.equal(result?.protocol,'jaco-a2f/1');assert.equal(result.frames.length,11);
 }finally{await rm(root,{recursive:true,force:true});}
});
