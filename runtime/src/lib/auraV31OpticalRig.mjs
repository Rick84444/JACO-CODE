import {HAIR_CUTOFF,isPhotoHair,patchSkinLighting,patchHairMap,shaderPatch} from './auraSurfaceDetail.mjs';
import * as THREE from 'three';
import {EYE_ATLAS,STUDIO_LIGHT,approachPupil,pupilScaleForLight,materialRole} from './auraOptics.mjs';

// A small authored photographic lightbox, baked once to a filtered environment.
// No network, external HDR asset, post-process pass or extra eye mesh.
function makeStudioEnvironment(renderer){
  const room=new THREE.Scene();
  room.background=new THREE.Color(0x10141b);
  const geo=new THREE.PlaneGeometry(1,1);
  const panels=[];
  const add=(color,intensity,x,y,z,w,h)=>{
    const mat=new THREE.MeshBasicMaterial({color,toneMapped:false,side:THREE.DoubleSide});
    mat.color.multiplyScalar(intensity);
    const panel=new THREE.Mesh(geo,mat);
    panel.position.set(x,y,z);panel.scale.set(w,h,1);panel.lookAt(0,0,0);
    room.add(panel);panels.push(panel);
  };
  add(0xfff1e6,4.2,-2.5,2.2,3.8,2.3,3.6);
  add(0xc9dfff,1.1,3.0,.6,2.8,2.5,3.2);
  add(0xd1e4ff,2.0,-.8,3.0,-2.7,2.6,1.3);
  const pmrem=new THREE.PMREMGenerator(renderer);
  try{return pmrem.fromScene(room,.06,.1,20,{size:128});}
  finally{pmrem.dispose();for(const p of panels)p.material.dispose();geo.dispose();}
}
function physicalFrom(source){
  // Copy common material parameters including original texture references, alpha mode,
  // UV mapping, depth behavior, roughness and normal map. Do not copy identity.
  const target=new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(target,source);
  // Standard.copy resets defines; restore the physical shader contract in r186.
  target.defines={STANDARD:'',PHYSICAL:''};
  target.name=source.name;return target;
}
function installPupil(material,uniform){
  const original=THREE.ShaderChunk.map_fragment;
  const anchor='texture2D( map, vMapUv )';
  if(!original.includes(anchor))return false;
  const [a,b]=EYE_ATLAS.centers;
  const remap=original.replace(anchor,'texture2D( map, auraEyeUv(vMapUv) )');
  material.onBeforeCompile=shader=>{
    shader.uniforms.uAuraPupilScale=uniform;
    shader.fragmentShader=`uniform float uAuraPupilScale;
vec2 auraEyeUv(vec2 uv) {
  vec2 a=vec2(${a[0]},${a[1]}), b=vec2(${b[0]},${b[1]});
  vec2 center=distance(uv,a)<distance(uv,b)?a:b;
  vec2 d=uv-center;
  float r=length(d),iris=${EYE_ATLAS.iris},pupil=${EYE_ATLAS.pupil};
  if(r>=iris||r<0.000001)return uv;
  float p=pupil*clamp(uAuraPupilScale,0.76,1.28);
  float oldR=r<p?r*pupil/p:pupil+(r-p)*(iris-pupil)/(iris-p);
  return center+d*(oldR/r);
}
`+shader.fragmentShader.replace('#include <map_fragment>',remap);
  };
  material.customProgramCacheKey=()=> 'aura-v31-eye-atlas-v1';
  return true;
}
export function createV31OpticalRig(scene,model,renderer){
  const owned=new Set(),replaced=new Map(),uniform={value:1};
  let pupilReady=false,environment=null;
  let skinDetailReady=false,hairDetailReady=false;
  const antialias=renderer.getContext().getContextAttributes()?.antialias===true;
  const lights=[];
  const direct=(color,intensity,x,y,z)=>{
    const light=new THREE.DirectionalLight(color,intensity);light.position.set(x,y,z);lights.push(light);scene.add(light);return light;
  };
  const ambient=new THREE.HemisphereLight(0xe4eeff,0x37303a,STUDIO_LIGHT.ambient);
  lights.push(ambient);scene.add(ambient);
  direct(0xfff1e6,STUDIO_LIGHT.key,-.65,2.15,1.7);
  direct(0xd0e3ff,STUDIO_LIGHT.fill,1.2,1.55,1.1);
  direct(0xb9d6ff,STUDIO_LIGHT.rim,-.65,2.1,-.8);
  try{environment=makeStudioEnvironment(renderer);scene.environment=environment.texture;scene.environmentIntensity=STUDIO_LIGHT.environment;}
  catch(error){console.warn('Aura optical environment unavailable',error);}
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=STUDIO_LIGHT.exposure;
  const convert=source=>{
    const role=materialRole(source?.name);
    const photoHair=isPhotoHair(source?.name);
    if((role==='authored'&&!photoHair)||!source?.isMeshStandardMaterial)return source;
    if(replaced.has(source))return replaced.get(source);
    const m=physicalFrom(source);
    // Restrained surface response: not subsurface scattering or an anatomy edit.
    if(role==='skin'){
      m.ior=1.42;m.specularIntensity=.67;m.clearcoat=.08;m.clearcoatRoughness=.58;
      if(source.normalMap)m.clearcoatNormalMap=source.normalMap;
      m.clearcoatNormalScale.copy(source.normalScale).multiplyScalar(.45);
      const chunk=patchSkinLighting(THREE.ShaderChunk.lights_physical_pars_fragment);
      if(chunk){m.onBeforeCompile=shader=>{const patched=shaderPatch(shader.fragmentShader,'lights_physical_pars_fragment',chunk);if(patched){shader.fragmentShader=patched;skinDetailReady=true;}};m.customProgramCacheKey=()=> 'aura-v31-skin-wrap-v1';}
    }else if(photoHair){
      m.alphaTest=HAIR_CUTOFF;m.alphaToCoverage=antialias;m.transparent=false;m.depthWrite=true;
      m.roughness=Math.min(m.roughness,.85);m.specularIntensity=.56;
      const chunk=patchHairMap(THREE.ShaderChunk.map_fragment);
      if(chunk&&m.map){m.onBeforeCompile=shader=>{const patched=shaderPatch(shader.fragmentShader,'map_fragment',chunk);if(patched){shader.fragmentShader=patched;hairDetailReady=true;}};m.customProgramCacheKey=()=> 'aura-v31-hair-fibers-v1';}
    }else{
      m.ior=1.376;m.specularIntensity=.9;m.clearcoat=.62;m.clearcoatRoughness=.12;
      if(source.map&&!source.map.flipY)pupilReady=installPupil(m,uniform);
    }
    replaced.set(source,m);owned.add(m);return m;
  };
  model.traverse(o=>{if(o.isMesh&&o.material)o.material=Array.isArray(o.material)?o.material.map(convert):convert(o.material);});
  // Old materials are detached but their shared textures remain owned by the model.
  for(const old of replaced.keys())old.dispose();
  return {
    update(dt,reduced){
      uniform.value=reduced?1:approachPupil(uniform.value,pupilScaleForLight(STUDIO_LIGHT.lightProxy),dt);
      return {pupilScale:uniform.value,pupilReady,environmentReady:Boolean(environment),surfaceCount:owned.size,skinDetailReady,hairDetailReady};
    },
    dispose(){
      scene.remove(...lights);
      scene.environment=null;environment?.dispose();
      // The model's existing disposer owns the attached materials and textures.
      owned.clear();replaced.clear();
    }
  };
}
