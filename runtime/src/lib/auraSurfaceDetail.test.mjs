import test from 'node:test';
import assert from 'node:assert/strict';
import {PHOTO_HAIR,HAIR_CUTOFF,SKIN_WRAP,isPhotoHair,wrappedDiffuse,fiberDetail,patchSkinLighting,patchHairMap,shaderPatch} from './auraSurfaceDetail.mjs';
test('only visible V31 photo hair is changed; legacy hidden cards remain untouched',()=>{
  assert.equal(isPhotoHair(PHOTO_HAIR),true);
  for(const name of ['Human.ponytail01','Aura platinum hair cards','Human.mindfront_eyebrows_02','Human.high-poly'])assert.equal(isPhotoHair(name),false);
  assert.ok(HAIR_CUTOFF>.3&&HAIR_CUTOFF<.42);
});
test('skin wrap is bounded and preserves head-on illumination with restrained red terminator',()=>{
  for(const w of SKIN_WRAP){
    assert.equal(wrappedDiffuse(1,w),1);
    assert.equal(wrappedDiffuse(-1,w),0);
    for(let n=-1;n<=1;n+=.01)assert.ok(wrappedDiffuse(n,w)>=0&&wrappedDiffuse(n,w)<=1);
  }
  assert.ok(wrappedDiffuse(0,SKIN_WRAP[0])>wrappedDiffuse(0,SKIN_WRAP[2]));
});
test('fiber contrast is bounded and vanishes at distant/subpixel scale',()=>{
  for(let i=0;i<1000;i++){const f=fiberDetail(i/1000,.4,0);assert.ok(f>=.945-1e-8&&f<=1.055+1e-8);}
  assert.equal(fiberDetail(.22,.4,.01),1);
  assert.equal(fiberDetail(NaN,0,0),1);
});
test('shader replacement is exact and fails closed on upstream anchor changes',()=>{
  const skin='reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  const hair='diffuseColor *= sampledDiffuseColor;';
  assert.match(patchSkinLighting(skin),/auraWrapped/);
  assert.match(patchHairMap(hair),/fwidth/);
  assert.equal(patchSkinLighting('different version'),null);
  assert.equal(patchHairMap(hair+hair),null);
  assert.equal(shaderPatch('#include <map_fragment>','map_fragment',patchHairMap(hair)),patchHairMap(hair));
  assert.equal(shaderPatch('no include','map_fragment',patchHairMap(hair)),null);
});
