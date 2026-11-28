import test from 'node:test';
import assert from 'node:assert/strict';
import {createBlinkController,approachFacialWeight} from '../../runtime/src/lib/auraFacialDynamics.mjs';

test('blink events are bounded, variable and include full closure commands',()=>{
  const b=createBlinkController(7),starts=[];let prior=0,peak=0;
  for(let i=0;i<=12000;i++){
    const t=i/100,v=b.sample(t,'idle');
    assert.ok(Number.isFinite(v)&&v>=0&&v<=1);
    if(v>0&&prior===0)starts.push(t);
    peak=Math.max(peak,v);prior=v;
  }
  assert.equal(peak,1);assert.ok(starts.length>=15&&starts.length<=55);
  const gaps=starts.slice(1).map((v,i)=>Math.round((v-starts[i])*100));
  assert.ok(new Set(gaps).size>10);
  assert.ok(gaps.every(v=>v>=200&&v<=650));
});
test('absolute time blink agrees at coincident samples across frame rates',()=>{
  const a=createBlinkController(77),b=createBlinkController(77);
  for(let i=0;i<=1800;i++){
    const v=a.sample(i/60,'speaking');
    if(i%4===0)assert.ok(Math.abs(v-b.sample(i/60,'speaking'))<1e-10);
  }
});
test('reduced motion, invalid clock and hidden tab gaps reset without a burst',()=>{
  const b=createBlinkController(7);b.sample(0);
  assert.equal(b.sample(2,'idle',true),0);
  assert.equal(b.sample(2.1),0);
  assert.equal(b.sample(900),0);
  assert.equal(b.sample(NaN),0);
  assert.equal(b.sample(1),0);
});
test('facial smoothing depends on elapsed time, not number of frames',()=>{
  const run=fps=>{let v=0;for(let i=0;i<fps;i++)v=approachFacialWeight(v,.82,1/fps,.30);return v;};
  assert.ok(Math.abs(run(15)-run(60))<1e-12);
  assert.ok(Math.abs(run(24)-run(60))<1e-12);
  assert.equal(approachFacialWeight(NaN,1,1/30,.3),0);
  assert.equal(approachFacialWeight(.3,.9,0,.3),.3);
});
