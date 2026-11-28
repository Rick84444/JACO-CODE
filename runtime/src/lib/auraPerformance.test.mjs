import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformancePlan,rememberPerformancePlan,takePerformancePlan,createCueGate} from './auraPerformance.mjs';
test('directives attach to the next spoken segment, not the first audio part',()=>{
  const p=createPerformancePlan('Hej.\n[[jaco:focus browser]]\n[[jaco:expression warm]]\nHär är sidan.\n[[jaco:motion explain]]\nSå fungerar det.');
  assert.equal(p.parts[0].text,'Hej.');assert.deepEqual(p.parts[0].cues,[]);
  assert.deepEqual(p.parts[1].cues,[{type:'focus',value:'browser'},{type:'expression',value:'warm'}]);
  assert.deepEqual(p.parts[2].cues,[{type:'motion',value:'explain'}]);
  assert.doesNotMatch(p.text,/jaco:/);
});
test('code blocks, inline instructions, invalid values and trailing cues never execute',()=>{
  const p=createPerformancePlan('Exempel:\n```\n[[jaco:motion advance]]\n```\nInline [[jaco:motion return]].\n[[jaco:expression angry]]\nHej.\n[[jaco:motion advance]]');
  assert.ok(p.parts.every(p=>!p.cues.length));assert.ok(p.parts.every(p=>!p.text.includes('jaco:')));
});
test('closed budget, degraded output and IDE panel restriction',()=>{
  const raw='[[jaco:focus browser]]\n[[jaco:motion explain]]\n[[jaco:motion advance]]\n[[jaco:expression warm]]\n[[jaco:expression concerned]]\nHej.';
  assert.equal(createPerformancePlan(raw).parts[0].cues.length,3);
  assert.ok(createPerformancePlan(raw,{enabled:false}).parts.every(p=>!p.cues.length));
  assert.ok(createPerformancePlan(raw,{allowStage:false}).parts.every(p=>p.cues.every(c=>c.type!=='focus')));
});
test('transient IDE plans are exact-match and consume-once; history never replays cues',()=>{
  rememberPerformancePlan('reply','[[jaco:expression warm]]\nHej.');
  assert.equal(takePerformancePlan('reply','Hej.').parts[0].cues.length,1);
  assert.equal(takePerformancePlan('reply','Hej.').parts[0].cues.length,0);
  rememberPerformancePlan('other','[[jaco:motion advance]]\nHej.');
  assert.equal(takePerformancePlan('other','different').parts[0].cues.length,0);
});
test('cue gate rejects duplicate playback and stale generations',()=>{
  const seen=[],g=createCueGate(c=>seen.push(c)),a=g.begin();
  assert.equal(g.play(a,0,['first']),true);assert.equal(g.play(a,0,['duplicate']),false);
  g.cancel();assert.equal(g.play(a,1,['late']),false);
  const b=g.begin();assert.equal(g.play(b,0,['new']),true);assert.deepEqual(seen,['first','new']);
});
