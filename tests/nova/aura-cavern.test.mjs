import test from 'node:test';
import assert from 'node:assert/strict';
import {cavernLayout,cavernGovernor,createIceCavern,garmentShade} from '../../runtime/src/lib/auraCavern.mjs';
import {bodyMotion,approachAngle} from '../../runtime/src/lib/auraBodyMotion.mjs';
// Resolve Three through the same dependency tree as the renderer.
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../runtime/package.json',import.meta.url));
const THREE=require('three');

test('cavern layout is reproducible and leaves central walkway clear',()=>{
  const a=cavernLayout(),b=cavernLayout();
  assert.deepEqual(a,b);assert.equal(a.crystals.length,52);
  assert.ok(a.crystals.every(c=>Math.abs(c.x)>=1.55 && c.z<=2.2 && c.height>=.3));
  assert.equal(cavernLayout(true).dust.length,96);
});
test('governor reduces quality on sustained slow rendering and recovers with hysteresis',()=>{
  const g=cavernGovernor();
  assert.equal(g.settings().fps,24);assert.equal(g.settings(true).fps,18);
  for(let i=0;i<30;i++)g.observe(45);
  assert.deepEqual(g.settings(),{fps:15,dpr:.70,tier:0});
  for(let i=0;i<10;i++)g.observe(5);
  assert.equal(g.settings().fps,15);
  for(let i=0;i<250;i++)g.observe(5);
  assert.equal(g.settings().fps,24);
  const mobile=cavernGovernor(true);
  for(let i=0;i<300;i++)mobile.observe(3);
  assert.equal(mobile.settings().fps,18);
});
test('real scene contains world-space depth, two bounded crystal batches and cleans up',()=>{
  const scene=new THREE.Scene();
  const cave=createIceCavern(scene,true);
  const group=scene.children[0];
  const meshes=group.children.filter(o=>o.isInstancedMesh);
  assert.equal(meshes.length,2);
  assert.ok(meshes.every(o=>o.count===28));
  const matrix=new THREE.Matrix4(),v=new THREE.Vector3(),depths=[];
  for(let i=0;i<28;i++){meshes[0].getMatrixAt(i,matrix);v.setFromMatrixPosition(matrix);depths.push(v.z);}
  assert.ok(Math.max(...depths)-Math.min(...depths)>10);
  assert.ok(scene.fog);
  cave.update(1);cave.dispose();
  assert.equal(scene.children.length,0);assert.equal(scene.fog,null);
});

test('body motion is bounded, quiet without speech, and reduced motion is static',()=>{
  for(let i=0;i<600;i++){
    const t=i/10,quiet=bodyMotion(t),speaking=bodyMotion(t,{speaking:true,jaw:.9});
    assert.equal(quiet.gesture,0);
    assert.ok(Math.abs(speaking.gesture)<=.043);
    assert.ok(Math.abs(speaking.hips)<=.024);
    assert.ok(Math.abs(speaking.breath)<=.012);
  }
  assert.ok(Object.values(bodyMotion(14,{speaking:true,jaw:1,reduced:true})).every(x=>x===0));
  const next=approachAngle(0,.04,1/24);
  assert.ok(next>0&&next<.04);
  assert.equal(approachAngle(.02,.04,0),.02);
});
test('garment palette separates boot, cuff, body and trim without additional draw calls',()=>{
  const palette=[garmentShade(0,.1,0),garmentShade(0,.22,0),garmentShade(.105,.6,0),garmentShade(0,1.2,.1),garmentShade(.25,1.2,0),garmentShade(.05,1.2,0)];
  assert.equal(new Set(palette).size,6);
  assert.ok(palette.every(x=>Number.isInteger(x)&&x>=0&&x<=0xffffff));
});
