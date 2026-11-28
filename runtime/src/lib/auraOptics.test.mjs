import test from 'node:test';
import assert from 'node:assert/strict';
import {EYE_ATLAS,pupilScaleForLight,approachPupil,remapEyeRadius,materialRole,STUDIO_LIGHT} from './auraOptics.mjs';
test('the two calibrated pupil centers are separated and remain inside the original atlas',()=>{
  const [a,b]=EYE_ATLAS.centers;
  assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])>2*EYE_ATLAS.iris);
  for(const c of [a,b])for(const x of c)assert.ok(x>EYE_ATLAS.iris&&x<1-EYE_ATLAS.iris);
});
test('pupil warp preserves iris boundary and outside texture, and never folds',()=>{
  for(const s of [.76,1,1.28]){
    assert.ok(Math.abs(remapEyeRadius(EYE_ATLAS.pupil*s,s)-EYE_ATLAS.pupil)<1e-10);
    assert.equal(remapEyeRadius(EYE_ATLAS.iris,s),EYE_ATLAS.iris);
    assert.equal(remapEyeRadius(.25,s),.25);
    let prior=0;for(let i=0;i<200;i++){const x=remapEyeRadius(i*.001,s);assert.ok(x>=prior);prior=x;}
  }
});
test('pupil constriction is faster than dilation, both bounded and time-based',()=>{
  assert.ok(pupilScaleForLight(1)<pupilScaleForLight(0));
  const constriction=1.28-approachPupil(1.28,.76,.1);
  const dilation=approachPupil(.76,1.28,.1)-.76;
  assert.ok(constriction>dilation);
  let a=1,b=1;for(let i=0;i<30;i++)a=approachPupil(a,.76,1/30);
  for(let i=0;i<60;i++)b=approachPupil(b,.76,1/60);
  assert.ok(Math.abs(a-b)<1e-9);
  assert.ok(a>=.76&&a<=1.28);
});
test('only exact authored skin, eye and oral materials are eligible for optical refinement',()=>{
  assert.equal(materialRole('Human.body'),'skin');assert.equal(materialRole('Human.high-poly'),'eyes');
  assert.equal(materialRole('Human.teeth_base'),'teeth');assert.equal(materialRole('Human.tongue01'),'tongue');
  for(const n of ['Aura platinum hair cards','Aura suit / brushed_titanium','Human.mindfront_eyelashes_02','unknown'])assert.equal(materialRole(n),'authored');
  assert.ok(STUDIO_LIGHT.environment<1&&STUDIO_LIGHT.lightProxy>=0&&STUDIO_LIGHT.lightProxy<=1);
});

// 2026-11-28: a steep, hard key left dark hollows under the brows, on the cheeks and under the chin.
test('the face is lit softly from a moderate height with a low frontal fill',()=>{
  const {key,fill,front,positions}=STUDIO_LIGHT;
  assert.ok(key/(fill+front)<=1.4,'key to fill ratio');
  const [x,y,z]=positions.key,elevation=Math.atan2(y-1.55,Math.hypot(x,z))*180/Math.PI;
  assert.ok(elevation>10&&elevation<=32,'key elevation above the face: '+elevation.toFixed(1));
  const [,fy,fz]=positions.front;assert.ok(fy<1.6&&fz>1,'frontal fill comes from about eye height, in front');
});
