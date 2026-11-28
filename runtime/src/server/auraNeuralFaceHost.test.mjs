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
