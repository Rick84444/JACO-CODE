import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// A light-form is sampled from the actual skinned geometry, never from a portrait.
// The pinned CC0 MPFB source and build-time compaction are documented in OpenSpec.
const ASSET='/branding/aura-rig.glb';
const EXPECTED_BYTES=7465400;
const FRAME_TIME=1000/30;
function seeded(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function sampleSurface(mesh,count,region,seed) {
  const pos=mesh.geometry.attributes.position,indices=mesh.geometry.index,faces=[];
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),u=new THREE.Vector3(),v=new THREE.Vector3();
  const n=indices?indices.count:pos.count;
  let area=0;
  for(let i=0;i+2<n;i+=3){
    const ids=[i,i+1,i+2].map(j=>indices?indices.getX(j):j);
    a.fromBufferAttribute(pos,ids[0]);b.fromBufferAttribute(pos,ids[1]);c.fromBufferAttribute(pos,ids[2]);
    const x=(a.x+b.x+c.x)/3,y=(a.y+b.y+c.y)/3;
    if(!region(x,y))continue;
    const weight=u.subVectors(b,a).cross(v.subVectors(c,a)).length()/2;
    if(!Number.isFinite(weight)||weight<1e-10)continue;
    area+=weight;faces.push({ids,end:area});
  }
  if(!faces.length)throw Error('AURA_RIG_EMPTY_REGION:'+mesh.name);
  const random=seeded(seed),unique=new Map(),samples=[];
  let fi=0;
  for(let i=0;i<count;i++){
    const target=(i+random())/count*area;
    while(fi<faces.length-1&&faces[fi].end<target)fi++;
    const root=Math.sqrt(random()),s=root*random();
    const ids=faces[fi].ids.map(id=>{if(!unique.has(id))unique.set(id,unique.size);return unique.get(id);});
    samples.push({ids,w:[1-root,s,root-s],seed:random(),size:.7+random()*.85});
  }
  return {mesh,samples,indices:[...unique.keys()],vertices:new Float32Array(unique.size*3)};
}

// Explicitly select named source regions. No decorative fake shoulders or hair.
// Body skin is sampled only above the outfit, and the jacket fades below the bust.
function createSamples(model,countScale) {
  const meshes=new Map();
  model.traverse(o=>{if(o.isSkinnedMesh)meshes.set(o.name.replace(/\./g,''),o);});
  const find=name=>{const m=[...meshes.values()].find(o=>o.name.includes(name));if(!m)throw Error('AURA_RIG_MISSING_'+name);return m;};
  const body=find('Human'),hair=find('ponytail01'),jacket=find('female_casualsuit01'),eyes=find('high-poly'),brows=find('eyebrows'),lashes=find('eyelashes');
  const plans=[
    [body,9800,(x,y)=>y>=1.457&&Math.abs(x)<.2,0,101],
    [jacket,5100,(x,y)=>y>=1.10&&Math.abs(x)<.36,1,102],
    [hair,4500,()=>true,2,103],
    [eyes,580,()=>true,3,104],
    [brows,460,()=>true,4,105],
    [lashes,230,()=>true,4,106]
  ];
  return plans.map(([mesh,count,region,kind,seed])=>({...sampleSurface(mesh,Math.round(count*countScale),region,seed),kind}));
}

const vertexShader=String.raw`
attribute vec3 aNormal;
attribute float aSeed;
attribute float aSize;
attribute float aKind;
uniform float uTime;
uniform float uEnergy;
uniform float uPixelRatio;
varying float vAlpha;
varying vec3 vColor;
void main(){
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vec3 n=normalize(normalMatrix*aNormal);
  float facing=max(0.0,dot(n,normalize(-mv.xyz)));
  float pulse=.88+.12*sin(uTime*1.9+aSeed*19.0+position.y*10.0);
  float fade=smoothstep(1.105,1.29,position.y);
  float rear=.17;
  float strength=rear+.70*pow(facing,.60);
  vec3 blue=vec3(.16,.57,1.0), ice=vec3(.68,.93,1.0);
  vColor=mix(blue,ice,.28+aSeed*.58);
  // The lit skin surface carries the form; points are fine glitter on it, as in the reference.
  if(aKind<.5){strength*=.14;}
  if(aKind>1.5&&aKind<2.5){vColor=mix(blue,ice,.40+aSeed*.48);strength*=.55;}
  if(aKind>.5&&aKind<1.5){strength*=.30;}
  if(aKind>2.5){strength*=.45;}
  vAlpha=clamp(strength*pulse*fade*(1.12+.35*uEnergy),0.0,.96);
  gl_PointSize=clamp(aSize*uPixelRatio*(2.65+.50*uEnergy)/max(.85,-mv.z),.8,5.5*uPixelRatio);
  gl_Position=projectionMatrix*mv;
}
`;
const fragmentShader=String.raw`
varying float vAlpha;
varying vec3 vColor;
void main(){
  float d=length(gl_PointCoord-vec2(.5));
  float core=1.0-smoothstep(.10,.30,d);
  float halo=1.0-smoothstep(.12,.50,d);
  float alpha=(core*.86+halo*.30)*vAlpha;
  if(alpha<.004)discard;
  gl_FragColor=vec4(mix(vColor,vec3(.83,.96,1.0),core*.35),alpha);
}
`;

function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.18,'rgba(205,230,255,.75)');
  r.addColorStop(.5,'rgba(90,150,255,.18)');r.addColorStop(1,'rgba(40,90,255,0)');
  g.fillStyle=r;g.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
const SWAY=String.raw`
  vec3 p=position;float sway=aT*aT;
  p.x+=sin(uTime*.8+aSeed*6.283+aT*3.5)*.012*sway;
  p.z+=cos(uTime*.7+aSeed*4.0+aT*3.0)*.008*sway;`;

/**
 * The luminous body of the reference look, drawn from the same rig:
 * - the actual skinned, morphing skin mesh as translucent light (soft fill, bright silhouette rim),
 *   so blinks, smiles and jaw motion deform the visible face itself;
 * - glowing eyes on the real eye mesh, a crown spark and a faint halo;
 * - flowing light strands and sparks anchored to the head bone, plus a twinkling star field.
 */
function createLightBody(scene,model,bones,groups){
  const body=groups.find(g=>g.kind===0).mesh,eyeGroup=groups.find(g=>g.kind===3),brows=groups.find(g=>g.kind===4).mesh;
  const energy={value:0},time={value:0},pixelRatio={value:Math.min(window.devicePixelRatio||1,1.5)};
  const owned=[];
  const skin=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:true});
  skin.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vAuraNormal;\nvarying vec3 vAuraView;\nvarying float vAuraY;')
      .replace('#include <project_vertex>','#include <project_vertex>\n  vAuraView=-mvPosition.xyz;\n  vAuraY=(modelMatrix*vec4(transformed,1.0)).y;\n  vAuraNormal=normalize(transformedNormal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uEnergy;\nvarying vec3 vAuraNormal;\nvarying vec3 vAuraView;\nvarying float vAuraY;')
      .replace('#include <opaque_fragment>',String.raw`
  vec3 auraN=normalize(vAuraNormal);vec3 auraV=normalize(vAuraView);
  float auraFacing=clamp(dot(auraN,auraV),0.0,1.0);
  float auraRim=pow(1.0-auraFacing,2.4);
  float auraKey=max(0.0,dot(auraN,normalize(vec3(0.0,.15,1.0))));
  float auraFade=smoothstep(1.25,1.45,vAuraY);
  vec3 auraBase=vec3(.26,.45,.92),auraIce=vec3(.82,.93,1.0);
  outgoingLight=(auraBase*(.10+.24*auraKey)+auraIce*auraRim*(.72+.3*uEnergy))*auraFade;
  diffuseColor.a=auraFade;
  #include <opaque_fragment>`);
  };
  model.traverse(o=>{if(o.isMesh){o.visible=false;o.frustumCulled=false;}});
  // The compacted rig keeps positions, joints and weights only; derive normals for the rim light.
  if(!body.geometry.attributes.normal)body.geometry.computeVertexNormals();
  body.material=skin;body.visible=true;
  // Depth-only prepass on the same skinned, morphing geometry: only the nearest skin surface lights up,
  // so the mouth interior and the far side of the head do not shine through.
  const prepass=new THREE.SkinnedMesh(body.geometry,new THREE.MeshBasicMaterial({colorWrite:false}));
  prepass.bind(body.skeleton,body.bindMatrix);
  prepass.morphTargetInfluences=body.morphTargetInfluences;prepass.morphTargetDictionary=body.morphTargetDictionary;
  prepass.position.copy(body.position);prepass.quaternion.copy(body.quaternion);prepass.scale.copy(body.scale);
  prepass.frustumCulled=false;prepass.renderOrder=-1;body.parent.add(prepass);owned.push(prepass.material);
  eyeGroup.mesh.material=new THREE.MeshBasicMaterial({color:0xdff1ff,transparent:true,opacity:.5,blending:THREE.AdditiveBlending,depthWrite:false});
  eyeGroup.mesh.visible=true;
  brows.material=new THREE.MeshBasicMaterial({color:0x8fc0ff,transparent:true,opacity:.28,blending:THREE.AdditiveBlending,depthWrite:false});
  brows.visible=true;
  scene.add(model);

  // Head frame at rest; strands are authored relative to it and follow the head bone.
  model.updateMatrixWorld(true);
  const head=bones.get('Head').bone;
  const restPos=head.getWorldPosition(new THREE.Vector3()),restInv=head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const pos=body.geometry.attributes.position,v=new THREE.Vector3();
  let minX=1e9,maxX=-1e9,minZ=1e9,maxZ=-1e9,top=-1e9;
  for(let i=0;i<pos.count;i++){
    v.fromBufferAttribute(pos,i).applyMatrix4(body.matrixWorld);
    if(v.y>1.6&&Math.abs(v.x)<.14){minX=Math.min(minX,v.x);maxX=Math.max(maxX,v.x);minZ=Math.min(minZ,v.z);maxZ=Math.max(maxZ,v.z);top=Math.max(top,v.y);}
  }
  if(!(top>1.6))throw Error('AURA_RIG_HEAD_BOUNDS');
  const a=(maxX-minX)/2,c=(maxZ-minZ)/2,b=.125,C=new THREE.Vector3((minX+maxX)/2,top-b,(minZ+maxZ)/2);

  const random=seeded(907),STRANDS=230,STEPS=34;
  const linePos=[],lineT=[],lineSeed=[],sparkPos=[],sparkT=[],sparkSeed=[],sparkTw=[];
  const scalp=(th,ph,r)=>new THREE.Vector3(C.x+a*r*Math.sin(th)*Math.sin(ph),C.y+b*r*Math.cos(th),C.z+c*r*Math.sin(th)*Math.cos(ph));
  for(let k=0;k<STRANDS;k++){
    const side=k%2?1:-1,phi0=side*(1.0+random()*2.1),seed=random();
    const thetaEnd=1.55+random()*.45,r=1.05+random()*.05,ts=.36;
    const flare=.05+random()*.11,drop=.24+random()*.16,waveA=.008+random()*.016,waveF=4+random()*5;
    let prev=null;
    for(let i=0;i<STEPS;i++){
      const t=i/(STEPS-1);let p;
      if(t<=ts){const u=t/ts;p=scalp(u*thetaEnd,phi0+side*.35*Math.sin(u*Math.PI/2),r);}
      else{
        const s=(t-ts)/(1-ts),ph=phi0+side*.35;
        const out=new THREE.Vector3(Math.sin(ph),0,Math.cos(ph)*.5).normalize(),across=new THREE.Vector3(Math.cos(ph),0,-Math.sin(ph));
        p=scalp(thetaEnd,ph,r).addScaledVector(out,flare*Math.pow(s,.8)).add(new THREE.Vector3(0,-drop*s,0)).addScaledVector(across,Math.sin(s*waveF+seed*6.283)*waveA*s);
      }
      p.sub(restPos);
      if(prev){linePos.push(prev.x,prev.y,prev.z,p.x,p.y,p.z);lineT.push((i-1)/(STEPS-1),t);lineSeed.push(seed,seed);}
      if(random()<.07){sparkPos.push(p.x,p.y,p.z);sparkT.push(t);sparkSeed.push(seed);sparkTw.push(random());}
      prev=p;
    }
  }
  const attr=(geo,name,data,size)=>geo.setAttribute(name,new THREE.Float32BufferAttribute(data,size));
  const lineGeo=new THREE.BufferGeometry();attr(lineGeo,'position',linePos,3);attr(lineGeo,'aT',lineT,1);attr(lineGeo,'aSeed',lineSeed,1);
  const lineMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uEnergy:energy},transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aT;attribute float aSeed;uniform float uTime;uniform float uEnergy;varying float vA;varying vec3 vC;
void main(){${SWAY}
  vA=(1.0-aT*.8)*(.62+.38*sin(uTime*1.4+aSeed*23.0-aT*7.0))*(.85+.3*uEnergy);
  vC=mix(vec3(.92,.97,1.0),vec3(.35,.62,1.0),aT);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vA;varying vec3 vC;void main(){gl_FragColor=vec4(vC,vA*.34);}`});
  const sparkGeo=new THREE.BufferGeometry();attr(sparkGeo,'position',sparkPos,3);attr(sparkGeo,'aT',sparkT,1);attr(sparkGeo,'aSeed',sparkSeed,1);attr(sparkGeo,'aTw',sparkTw,1);
  const sparkMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uPixelRatio:pixelRatio},transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aT;attribute float aSeed;attribute float aTw;uniform float uTime;uniform float uPixelRatio;varying float vA;
void main(){${SWAY}
  vA=.3+.7*pow(.5+.5*sin(uTime*2.3+aTw*40.0),3.0);
  gl_PointSize=(1.6+2.8*aTw)*uPixelRatio;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vA;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(.88,.95,1.0,(1.0-smoothstep(0.0,.5,d))*vA*.9);}`});
  const lines=new THREE.LineSegments(lineGeo,lineMat),sparks=new THREE.Points(sparkGeo,sparkMat);
  lines.frustumCulled=false;sparks.frustumCulled=false;

  const texture=glowTexture();
  const sprite=(scale,opacity,color=0xffffff)=>{
    const m=new THREE.SpriteMaterial({map:texture,color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false});
    owned.push(m);const s=new THREE.Sprite(m);s.scale.setScalar(scale);return s;
  };
  const hair=new THREE.Group();
  const halo=sprite(.62,.28,0x3d7dff);halo.position.copy(C).sub(restPos).add(new THREE.Vector3(0,-.02,-.08));
  const crown=sprite(.075,.85);crown.position.set(C.x,top+.006,C.z+c*.3).sub(restPos);
  hair.add(halo,lines,sparks,crown);scene.add(hair);
  const eyeCore=[sprite(.016,.95),sprite(.016,.95)],eyeHalo=[sprite(.045,.35,0x8fc6ff),sprite(.045,.35,0x8fc6ff)];
  scene.add(...eyeCore,...eyeHalo);

  const starPos=[],starTw=[],stars=seeded(4242);
  for(let i=0;i<260;i++){starPos.push((stars()-.5)*1.0,1.08+stars()*.87,-.45-stars()*.2);starTw.push(stars());}
  const starGeo=new THREE.BufferGeometry();attr(starGeo,'position',starPos,3);attr(starGeo,'aTw',starTw,1);
  const starMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uPixelRatio:pixelRatio},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aTw;uniform float uTime;uniform float uPixelRatio;varying float vA;
void main(){vA=(.25+.6*aTw)*(.55+.45*sin(uTime*(.6+aTw*1.8)+aTw*50.0));gl_PointSize=(1.0+2.2*aTw*aTw)*uPixelRatio;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:String.raw`varying float vA;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(.75,.86,1.0,(1.0-smoothstep(0.0,.5,d))*vA);}`});
  const starField=new THREE.Points(starGeo,starMat);starField.frustumCulled=false;scene.add(starField);
  owned.push(lineGeo,lineMat,sparkGeo,sparkMat,starGeo,starMat,texture);

  const hp=new THREE.Vector3(),hq=new THREE.Quaternion(),sums=[new THREE.Vector3(),new THREE.Vector3()],counts=[0,0];
  return {
    update(t,energyValue,blink){
      energy.value=energyValue;time.value=t;
      head.getWorldPosition(hp);head.getWorldQuaternion(hq);
      hair.position.copy(hp);hair.quaternion.copy(hq).multiply(restInv);
      crown.material.opacity=.65+.25*Math.sin(t*1.6);
      // Eye glow follows the real (skinned) eye mesh and closes with the blink morph.
      sums[0].set(0,0,0);sums[1].set(0,0,0);counts[0]=counts[1]=0;
      const vs=eyeGroup.vertices;
      for(let i=0;i<vs.length;i+=3){const s=vs[i]>hp.x?0:1;sums[s].x+=vs[i];sums[s].y+=vs[i+1];sums[s].z+=vs[i+2];counts[s]++;}
      const open=1-.92*blink;
      for(let s=0;s<2;s++){
        if(!counts[s])continue;
        sums[s].divideScalar(counts[s]).z+=.012;
        eyeCore[s].position.copy(sums[s]);eyeHalo[s].position.copy(sums[s]);
        eyeCore[s].material.opacity=.95*open;eyeHalo[s].material.opacity=(.3+.15*energyValue)*open;
      }
    },
    dispose(){scene.remove(hair,starField,...eyeCore,...eyeHalo);owned.forEach(o=>o.dispose());}
  };
}

function disposeModel(model){
  const geometries=new Set(),materials=new Set(),skeletons=new Set();
  model?.traverse(o=>{
    if(o.geometry)geometries.add(o.geometry);
    if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));
    if(o.skeleton)skeletons.add(o.skeleton);
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());skeletons.forEach(s=>s.dispose());
}

/** GPU point drawing; exact CPU interpolation of vertices after real morph and skin transforms. */
export async function createAuraRigLightform(canvas,{signal,onError}={}){
  const response=await fetch(ASSET,{signal,cache:'force-cache'});
  if(!response.ok)throw Error('AURA_RIG_ASSET_'+response.status);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==EXPECTED_BYTES)throw Error('AURA_RIG_ASSET_SIZE');
  const gltf=await new GLTFLoader().parseAsync(bytes,'');
  const model=gltf.scene;
  let renderer,geometry,material,observer,lightBody,raf=0,disposed=false;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let cleanup=()=>{};
  try{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const bones=new Map();model.traverse(o=>{if(o.isBone)bones.set(o.name,{bone:o,base:o.quaternion.clone()});});
    const names=['Head','Neck','Spine2','LeftShoulder','RightShoulder','PonytailRoot','Ponytail1','Ponytail2','Ponytail3'];
    if(names.some(n=>!bones.has(n)))throw Error('AURA_RIG_BONES');
    const morphs=[];model.traverse(o=>{if(o.isSkinnedMesh&&o.morphTargetDictionary)morphs.push(o);});
    const required=['eyeBlinkLeft','eyeBlinkRight','jawOpen','mouthSmileLeft','mouthSmileRight','browInnerUp','viseme_aa','viseme_O'];
    const face=morphs.find(m=>required.every(n=>n in m.morphTargetDictionary));
    if(!face)throw Error('AURA_RIG_MORPHS');
    const probes=['eyeBlinkLeft','jawOpen'].map(name=>{
      const index=face.morphTargetDictionary[name],attr=face.geometry.morphAttributes.position[index];
      let magnitude=0,vertex=0;
      for(let i=0;i<attr.count;i++){
        const d=attr.getX(i)**2+attr.getY(i)**2+attr.getZ(i)**2;
        if(d>magnitude){magnitude=d;vertex=i;}
      }
      if(magnitude<1e-8)throw Error('AURA_RIG_EMPTY_MORPH:'+name);
      return {index,vertex};
    });
    const probeA=new THREE.Vector3(),probeB=new THREE.Vector3();
    // Measure displacement at the same bone pose with only the selected morph removed.
    const displacement=({index,vertex})=>{
      const weight=face.morphTargetInfluences[index];if(!weight)return 0;
      face.getVertexPosition(vertex,probeA).applyMatrix4(face.matrixWorld);
      face.morphTargetInfluences[index]=0;
      try{face.getVertexPosition(vertex,probeB).applyMatrix4(face.matrixWorld);}
      finally{face.morphTargetInfluences[index]=weight;}
      return 1000*probeA.distanceTo(probeB);
    };
    model.updateMatrixWorld(true);
    // Width is CSS, not DPR; keep the mobile CPU skinning budget bounded.
    const groups=createSamples(model,window.innerWidth<768?.64:1);
    const total=groups.reduce((n,g)=>n+g.samples.length,0);
    geometry=new THREE.BufferGeometry();
    const positions=new Float32Array(total*3),normals=new Float32Array(total*3);
    const seeds=new Float32Array(total),sizes=new Float32Array(total),kinds=new Float32Array(total);
    let i=0;
    for(const group of groups)for(const s of group.samples){seeds[i]=s.seed;sizes[i]=s.size;kinds[i]=group.kind;i++;}
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aNormal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSeed',new THREE.BufferAttribute(seeds,1));
    geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
    geometry.setAttribute('aKind',new THREE.BufferAttribute(kinds,1));
    material=new THREE.ShaderMaterial({vertexShader,fragmentShader,uniforms:{uTime:{value:0},uEnergy:{value:0},uPixelRatio:{value:1}},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
    const scene=new THREE.Scene(),cloud=new THREE.Points(geometry,material);
    cloud.frustumCulled=false;scene.add(cloud);
    // Frontal head-and-shoulders framing, as in the reference portrait.
    const camera=new THREE.PerspectiveCamera(34,1,.03,20);
    camera.position.set(0,1.565,1.12);camera.lookAt(0,1.53,.03);
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
    renderer.setClearColor(0x000000,0);
    lightBody=createLightBody(scene,model,bones,groups);
    let energy=0,yaw=0,pitch=0,last=-Infinity,state={active:false,speaking:false,listening:false,x:0,y:0};
    const temp=new THREE.Vector3(),n=new THREE.Vector3(),edge1=new THREE.Vector3(),edge2=new THREE.Vector3(),q=new THREE.Quaternion(),euler=new THREE.Euler(0,0,0,'YXZ');
    const rotate=(name,x,y,z)=>{const entry=bones.get(name);if(!entry)return;entry.bone.quaternion.copy(entry.base).multiply(q.setFromEuler(euler.set(x,y,z,'YXZ')));};
    const assign=(name,value)=>{for(const o of morphs){const idx=o.morphTargetDictionary[name];if(idx!==undefined)o.morphTargetInfluences[idx]=clamp(value,0,1);}};
    const pose=time=>{
      const still=motion.matches,t=still?0:time/1000;
      energy=still?Number(state.active):energy+(Number(state.active||state.speaking||state.listening)-energy)*.09;
      const targetYaw=still?0:clamp(state.x,-1,1)*.38+.16*Math.sin(t*.51);
      const targetPitch=still?0:clamp(state.y,-1,1)*.15+.04*Math.sin(t*.87);
      yaw=still?0:yaw+(targetYaw-yaw)*.10;pitch=still?0:pitch+(targetPitch-pitch)*.10;
      rotate('Spine2',still?0:.018*Math.sin(t*1.45),yaw*.18,still?0:.012*Math.sin(t*.64));
      rotate('Neck',pitch*.36,yaw*.28,0);
      rotate('Head',pitch*.70,yaw*.74,still?0:.035*Math.sin(t*.73));
      rotate('LeftShoulder',still?0:.012*Math.sin(t*1.45),0,0);
      rotate('RightShoulder',still?0:.012*Math.sin(t*1.45+.4),0,0);
      for(let j=0;j<4;j++)rotate(j?'Ponytail'+j:'PonytailRoot',still?0:.045*Math.sin(t*1.2-j*.5),still?0:.07*Math.sin(t*1.1-j*.4),0);
      // Genuine blendshapes: blinking, expression and gaze. Browser speech has
      // no reliable phoneme timestamps; jaw motion is expressive, not lip sync.
      const blinkPhase=t%4.7,blink=still?0:Math.max(0,1-Math.abs(blinkPhase-2.1)/.115);
      const jaw=still||!state.speaking?0:.12+.37*Math.pow(Math.max(0,Math.sin(t*13+Math.sin(t*4))),1.7);
      const smile=still?.07:.06+.05*(1+Math.sin(t*.85))+.035*energy;
      assign('eyeBlinkLeft',blink);assign('eyeBlinkRight',blink);
      assign('jawOpen',jaw);
      assign('mouthSmileLeft',smile);assign('mouthSmileRight',smile);
      assign('browInnerUp',still?0:.05+.13*energy*(.5+.5*Math.sin(t*1.35)));
      assign('eyeLookInLeft',Math.max(0,yaw)*.35);assign('eyeLookOutLeft',Math.max(0,-yaw)*.35);
      assign('eyeLookOutRight',Math.max(0,yaw)*.35);assign('eyeLookInRight',Math.max(0,-yaw)*.35);
      model.updateMatrixWorld(true);
      let cursor=0;
      for(const group of groups){
        const {mesh,samples,vertices,indices}=group;
        for(let k=0;k<indices.length;k++){
          mesh.getVertexPosition(indices[k],temp).applyMatrix4(mesh.matrixWorld);
          temp.toArray(vertices,k*3);
        }
        for(const s of samples){
          const [ia,ib,ic]=s.ids.map(i=>i*3),[a,b,c]=s.w;
          const x=a*vertices[ia]+b*vertices[ib]+c*vertices[ic];
          const y=a*vertices[ia+1]+b*vertices[ib+1]+c*vertices[ic+1];
          const z=a*vertices[ia+2]+b*vertices[ib+2]+c*vertices[ic+2];
          edge1.set(vertices[ib]-vertices[ia],vertices[ib+1]-vertices[ia+1],vertices[ib+2]-vertices[ia+2]);
          edge2.set(vertices[ic]-vertices[ia],vertices[ic+1]-vertices[ia+1],vertices[ic+2]-vertices[ia+2]);
          n.crossVectors(edge1,edge2).normalize();
          const shimmer=still?0:(.0008+.0014*energy)*Math.sin(s.seed*21+t*1.5);
          positions[cursor]=x+n.x*shimmer;positions[cursor+1]=y+n.y*shimmer;positions[cursor+2]=z+n.z*shimmer;
          n.toArray(normals,cursor);cursor+=3;
        }
      }
      geometry.attributes.position.needsUpdate=true;geometry.attributes.aNormal.needsUpdate=true;
      material.uniforms.uTime.value=t;material.uniforms.uEnergy.value=energy;
      lightBody.update(t,energy,blink);
      // A small head-relative motion statistic from actual sampled coordinates for regression.
      let signature=0;for(let j=0;j<Math.min(positions.length,6000);j+=31)signature+=positions[j]*(j+1);
      canvas.dataset.renderedPoints=String(total);canvas.dataset.renderer='rigged-particle-field';
      canvas.dataset.hairPoints=String(groups.find(g=>g.kind===2).samples.length);
      canvas.dataset.torsoPoints=String(groups.find(g=>g.kind===1).samples.length);
      canvas.dataset.yaw=yaw.toFixed(4);canvas.dataset.blink=blink.toFixed(4);canvas.dataset.jaw=jaw.toFixed(4);
      canvas.dataset.geometrySignature=signature.toFixed(5);
      canvas.dataset.blinkMm=displacement(probes[0]).toFixed(3);
      canvas.dataset.jawMm=displacement(probes[1]).toFixed(3);
    };
    const render=time=>{if(disposed||document.hidden)return;pose(time);renderer.render(scene,camera);};
    const tick=time=>{
      if(disposed||document.hidden||motion.matches)return;
      if(time-last>=FRAME_TIME-1){render(time);last=time;}
      raf=requestAnimationFrame(tick);
    };
    const refresh=()=>{
      cancelAnimationFrame(raf);if(disposed||document.hidden)return;
      last=-Infinity;render(motion.matches?0:performance.now());
      if(!motion.matches)raf=requestAnimationFrame(tick);
    };
    const resize=()=>{
      if(disposed)return;
      const width=Math.max(1,canvas.clientWidth||360),height=Math.max(1,canvas.clientHeight||width);
      const dpr=Math.min(window.devicePixelRatio||1,1.5);
      renderer.setPixelRatio(dpr);renderer.setSize(width,height,false);
      camera.aspect=width/height;camera.updateProjectionMatrix();material.uniforms.uPixelRatio.value=dpr;
      if(motion.matches)render(0);
    };
    const lost=event=>{event.preventDefault();dispose();onError?.(Error('AURA_RIG_WEBGL_CONTEXT_LOST'));};
    function dispose(){
      if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer?.disconnect();
      motion.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',refresh);
      canvas.removeEventListener('webglcontextlost',lost);signal?.removeEventListener('abort',dispose);
      lightBody?.dispose();geometry.dispose();material.dispose();renderer.dispose();disposeModel(model);
    }
    cleanup=dispose;
    canvas.addEventListener('webglcontextlost',lost);
    signal?.addEventListener('abort',dispose,{once:true});
    observer=new ResizeObserver(resize);observer.observe(canvas);
    motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);
    resize();refresh();
    return {setState(next){state={...state,...next};if(motion.matches)render(0);},dispose};
  }catch(error){
    if(!disposed){cleanup();if(!disposed){disposed=true;lightBody?.dispose();geometry?.dispose();material?.dispose();renderer?.dispose();disposeModel(model);}}
    throw error;
  }
}
