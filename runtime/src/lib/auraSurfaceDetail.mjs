// V31-only surface refinement. Preserve the authored albedo, UVs and geometry.
export const PHOTO_HAIR='Aura V26 neutral platinum photo hair';
export const HAIR_CUTOFF=.36;
export const HAIR_ATLAS_WIDTH=832;
export const HAIR_ATLAS_COLUMNS=13;
export const SKIN_WRAP=Object.freeze([.20,.10,.055]);
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function isPhotoHair(name){return name===PHOTO_HAIR;}
export function wrappedDiffuse(n,wrap){
  n=clamp(Number.isFinite(n)?n:0,-1,1);
  wrap=clamp(Number.isFinite(wrap)?wrap:0,0,.25);
  return clamp((n+wrap)/(1+wrap),0,1);
}
export function fiberDetail(u,v,footprint){
  if(![u,v,footprint].every(Number.isFinite))return 1;
  const frequency=HAIR_ATLAS_WIDTH*.40;
  const wave=Math.cos(2*Math.PI*(u*frequency+.18*Math.sin(v*18)));
  const fade=1-clamp((footprint*frequency-.20)/.30,0,1);
  return 1+.055*wave*fade;
}
// Fail closed if Three changes the pinned r186 shader anchors.
export function patchSkinLighting(source){
  const anchor='reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );';
  if(typeof source!=='string'||source.split(anchor).length!==2)return null;
  return source.replace(anchor,`// A bounded spectral wrapped-diffuse approximation; not true SSS.
  vec3 auraWrap=vec3(${SKIN_WRAP.join(',')});
  float auraSignedNL=dot(geometryNormal,directLight.direction);
  vec3 auraWrapped=clamp((vec3(auraSignedNL)+auraWrap)/(1.0+auraWrap),0.0,1.0);
  vec3 auraDiffuse=mix(vec3(dotNL),auraWrapped,0.65)*directLight.color;
  reflectedLight.directDiffuse += auraDiffuse * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );`);
}
export function patchHairMap(source){
  const anchor='diffuseColor *= sampledDiffuseColor;';
  if(typeof source!=='string'||source.split(anchor).length!==2)return null;
  return source.replace(anchor,`// Subtle longitudinal fibers, attenuated at subpixel scale.
  float auraFrequency=${HAIR_ATLAS_WIDTH*.40};
  float auraFiber=cos(6.2831853*(vMapUv.x*auraFrequency+0.18*sin(vMapUv.y*18.0)));
  float auraFootprint=fwidth(vMapUv.x)*auraFrequency;
  float auraFade=1.0-clamp((auraFootprint-0.20)/0.30,0.0,1.0);
  sampledDiffuseColor.rgb *= 1.0+0.055*auraFiber*auraFade;
  diffuseColor *= sampledDiffuseColor;`);
}
export function shaderPatch(fragment,include,replacement){
  const anchor='#include <'+include+'>';
  return typeof replacement==='string'&&fragment.split(anchor).length===2?fragment.replace(anchor,replacement):null;
}

// The rotated lip island in the original 2048px skin atlas. Keep the mask local.
export const LIP_UV=Object.freeze({x:.909,y:.515,rx:.014,ry:.023});
export function lipWetness(u,v){
  if(![u,v].every(Number.isFinite))return 0;
  const r=Math.hypot((u-LIP_UV.x)/LIP_UV.rx,(v-LIP_UV.y)/LIP_UV.ry);
  const t=clamp((r-.45)/.55,0,1);
  return 1-t*t*(3-2*t);
}
export function patchLipCoat(source){
  const anchor='material.clearcoatRoughness = clearcoatRoughness;';
  if(typeof source!=='string'||source.split(anchor).length!==2)return null;
  return source.replace(anchor,anchor+`
  #ifdef USE_MAP
    float auraLipMask=1.0-smoothstep(0.45,1.0,length((vMapUv-vec2(${LIP_UV.x},${LIP_UV.y}))/vec2(${LIP_UV.rx},${LIP_UV.ry})));
    material.clearcoat=mix(material.clearcoat,0.27,auraLipMask);
    material.clearcoatRoughness=mix(material.clearcoatRoughness,0.31,auraLipMask);
  #endif`);
}
