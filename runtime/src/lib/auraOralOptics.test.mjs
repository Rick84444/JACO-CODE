import test from 'node:test';
import assert from 'node:assert/strict';
import {LIP_UV,lipWetness,patchLipCoat} from './auraSurfaceDetail.mjs';
test('lip clearcoat mask is confined to the authored lip island',()=>{
  assert.equal(lipWetness(LIP_UV.x,LIP_UV.y),1);
  assert.equal(lipWetness(.5,.5),0);
  assert.equal(lipWetness(LIP_UV.x+.03,LIP_UV.y),0);
  for(let i=0;i<100;i++){const m=lipWetness(LIP_UV.x+i*.0002,LIP_UV.y);assert.ok(m>=0&&m<=1);}
});
test('lip wet surface shader preserves original response outside mask and rejects changed anchor',()=>{
  const a='material.clearcoatRoughness = clearcoatRoughness;';
  assert.match(patchLipCoat(a),/auraLipMask/);
  assert.match(patchLipCoat(a),/mix\(material.clearcoat,0.27,auraLipMask\)/);
  assert.equal(patchLipCoat('other'),null);
});
