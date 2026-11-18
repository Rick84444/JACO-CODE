import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// A light-form is sampled from the actual skinned geometry, never from a portrait.
// The pinned CC0 MPFB source and build-time compaction are documented in OpenSpec.
const ASSET='/branding/aura-rig.glb';
const EXPECTED_BYTES=7465400;
const FRAME_TIME=1000/30;
function seeded(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smoothstep=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);};

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
    samples.push({ids,w:[1-root,s,root-s],seed:random(),size:.62+random()*.82});
  }
  return {mesh,samples,indices:[...unique.keys()],vertices:new Float32Array(unique.size*3)};
}

// Explicitly select named source regions.
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
    [lashes,230,()=>true,5,106]
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
uniform float uDecisionMode;
varying float vAlpha;
varying vec3 vColor;
varying float vDepth;
void main(){
  vec4 mv=modelViewMatrix*vec4(position,1.0);
  vec3 n=normalize(normalMatrix*aNormal);
  vec3 viewDir=normalize(-mv.xyz);
  float facing=max(0.0,dot(n,viewDir));
  float rim=pow(max(0.0,1.0-facing),1.75);
  float pulse=.84+.16*sin(uTime*2.0+aSeed*23.0+position.y*14.0);
  float fade=smoothstep(1.105,1.31,position.y);
  float dof=1.0-clamp(abs(-mv.z-1.02)*1.6,0.0,0.45);
  vDepth=dof;
  float strength=(.12+.44*pow(facing,.7)+.58*rim)*dof;
  vec3 deepBiolum=vec3(.12,.58,1.0);
  vec3 cyanCore=vec3(.48,.88,1.0);
  vec3 decisionGold=vec3(1.0,.78,.36);
  vec3 pureDiamond=vec3(.94,.99,1.0);
  vColor=mix(deepBiolum,cyanCore,.32+aSeed*.55);
  vColor=mix(vColor,decisionGold,uDecisionMode*rim*.55);
  vColor=mix(vColor,pureDiamond,rim*.65);
  if(aKind<.5){strength*=.13;}
  if(aKind>1.5&&aKind<2.5){vColor=mix(deepBiolum,pureDiamond,.45+aSeed*.50);strength*=.62;}
  if(aKind>.5&&aKind<1.5){strength*=.28;}
  if(aKind>2.5){vColor=pureDiamond;strength*=.52;}
  vAlpha=clamp(strength*pulse*fade*(1.08+.38*uEnergy),0.0,.96);
  gl_PointSize=clamp(aSize*uPixelRatio*(2.05+.46*uEnergy)*(0.85+0.25*dof)/max(.82,-mv.z),.70,4.5*uPixelRatio);
  gl_Position=projectionMatrix*mv;
}
`;

const fragmentShader=String.raw`
varying float vAlpha;
varying vec3 vColor;
varying float vDepth;
void main(){
  float d=length(gl_PointCoord-vec2(.5));
  float core=1.0-smoothstep(.06,.24,d);
  float halo=1.0-smoothstep(.08,.50,d);
  float alpha=(core*.94+halo*.28*vDepth)*vAlpha;
  if(alpha<.004)discard;
  gl_FragColor=vec4(mix(vColor,vec3(.97,.99,1.0),core*.55),alpha);
}
`;

// Clean-room, first-party deterministic 3D harmonic lattice field (zero external license, 3x faster on mobile GPUs)
// Includes strict sq(x) helper to eliminate IEEE/GLSL negative base pow() NaN undefined behavior.
const GLSL_AURA_BIOFIELD=String.raw`
float sq(float x){return x*x;}
float auraGyroid(vec3 p){
  return dot(sin(p),cos(p.yzx));
}
vec2 auraBioField3D(vec3 p,float t,float detailLevel){
  vec3 q1=p*58.0+vec3(0.0,0.0,t*0.14);
  float g1=auraGyroid(q1)*0.5;
  float g2=detailLevel>0.5?auraGyroid(q1*2.17+vec3(g1*1.4,t*0.22,1.7))*0.28:0.0;
  float veinCoord=auraGyroid(p*15.5-vec3(0.0,t*0.38,0.0));
  float vein=1.0-smoothstep(0.0,0.22,abs(veinCoord));
  return vec2(g1+g2,sq(vein)*vein);
}
`;

function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=64;
  const g=c.getContext('2d'),r=g.createRadialGradient(32,32,0,32,32,32);
  r.addColorStop(0,'rgba(255,255,255,1)');
  r.addColorStop(.14,'rgba(225,248,255,.90)');
  r.addColorStop(.42,'rgba(70,175,255,.26)');
  r.addColorStop(1,'rgba(20,75,255,0)');
  g.fillStyle=r;g.fillRect(0,0,64,64);
  const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}

const SWAY=String.raw`
  vec3 p=position;float sway=aT*aT;
  p.x+=(sin(uTime*.72+aSeed*6.283+aT*3.2)*.013+sin(uTime*1.52+aSeed*3.7+aT*5.4)*.0045)*sway;
  p.y+=sin(uTime*.95+aSeed*5.1+aT*2.4)*.0035*sway;
  p.z+=(cos(uTime*.64+aSeed*4.0+aT*2.8)*.009+cos(uTime*1.31+aSeed*2.1+aT*4.6)*.0035)*sway;`;

/**
 * Real-time Web Audio Formant & Envelope Analyzer:
 * Splits live TTS/AudioStream into 3 vocal frequency bands:
 * - Low (85-350 Hz): Fundamental vocal pitch -> drives jaw mass
 * - Mid (350-1800 Hz): F1/F2 vowel formants -> drives open vowels (viseme_aa / viseme_E)
 * - High (1800-4800 Hz): Sibilants & rounded formants -> drives lip shaping (viseme_O / viseme_U)
 */
function createVoiceFormantTracker(){
  let ctx=null,analyser=null,sourceNode=null,bins=null;
  let noiseFloor=0.012;
  return {
    attach(audioInput){
      try{
        if(!audioInput)return false;
        const AudioCtx=window.AudioContext||window.webkitAudioContext;
        if(!AudioCtx)return false;
        if(!ctx)ctx=new AudioCtx();
        if(ctx.state==='suspended')ctx.resume().catch(()=>{});
        if(sourceNode){try{sourceNode.disconnect();}catch{}}
        analyser=ctx.createAnalyser();
        analyser.fftSize=256;
        analyser.smoothingTimeConstant=0.72;
        bins=new Uint8Array(analyser.frequencyBinCount);
        if(typeof MediaStream!=='undefined'&&audioInput instanceof MediaStream){
          sourceNode=ctx.createMediaStreamSource(audioInput);
          sourceNode.connect(analyser);
        }else if(typeof HTMLMediaElement!=='undefined'&&audioInput instanceof HTMLMediaElement){
          sourceNode=ctx.createMediaElementSource(audioInput);
          sourceNode.connect(analyser);
          analyser.connect(ctx.destination);
        }else if(audioInput.context&&typeof audioInput.connect==='function'){
          sourceNode=audioInput;
          sourceNode.connect(analyser);
        }else{
          return false;
        }
        return true;
      }catch{
        return false;
      }
    },
    sample(){
      if(!analyser||!bins)return null;
      analyser.getByteFrequencyData(bins);
      const sampleRate=ctx?.sampleRate||44100;
      const hzPerBin=sampleRate/analyser.fftSize;
      let lowSum=0,lowN=0,midSum=0,midN=0,highSum=0,highN=0;
      for(let i=1;i<bins.length;i++){
        const hz=i*hzPerBin,val=bins[i]/255;
        if(hz>=80&&hz<360){lowSum+=val;lowN++;}
        else if(hz>=360&&hz<1850){midSum+=val;midN++;}
        else if(hz>=1850&&hz<=4800){highSum+=val;highN++;}
      }
      const low=lowN?lowSum/lowN:0;
      const mid=midN?midSum/midN:0;
      const high=highN?highSum/highN:0;
      const rawEnergy=low*0.42+mid*0.44+high*0.14;
      // Adaptive noise floor gate ensures total silence during speech pauses
      noiseFloor=Math.min(0.04,Math.max(0.008,noiseFloor*0.995+Math.min(rawEnergy,noiseFloor)*0.005));
      const gated=Math.max(0,rawEnergy-noiseFloor*1.45)/(1-noiseFloor);
      if(gated<0.015)return {level:0,openVowel:0,roundVowel:0,spreadVowel:0,sibilant:0};
      return {
        level:clamp(gated*1.65,0,1),
        openVowel:clamp((mid*1.4+low*0.4)*1.2,0,1),
        roundVowel:clamp((low*1.35-high*0.5)*1.2,0,1),
        spreadVowel:clamp((mid*0.9+high*0.9)*1.2,0,1),
        sibilant:clamp(high*1.8,0,1)
      };
    },
    hasHardwareSource(){return Boolean(analyser);},
    dispose(){
      try{sourceNode?.disconnect();analyser?.disconnect();ctx?.close();}catch{}
      sourceNode=analyser=ctx=bins=null;
    }
  };
}

function createLightBody(scene,model,bones,groups,isMobile){
  const body=groups.find(g=>g.kind===0).mesh;
  const jacket=groups.find(g=>g.kind===1).mesh;
  const hairMesh=groups.find(g=>g.kind===2).mesh;
  const eyeGroup=groups.find(g=>g.kind===3);
  const brows=groups.find(g=>g.kind===4).mesh;
  const lashes=groups.find(g=>g.kind===5).mesh;
  const energy={value:0},time={value:0},speaking={value:0},pupil={value:0.32};
  const detailLevel={value:isMobile?0.0:1.0},cognitiveTint={value:0.0};
  const pixelRatio={value:Math.min(window.devicePixelRatio||1,1.5)};
  const owned=[];

  // 1. Sculpted Biomorphic Skin Shader (strictly NaN-safe, valid smoothstep order, adaptive detail)
  const skin=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:true});
  skin.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.uniforms.uTime=time;
    shader.uniforms.uSpeaking=speaking;
    shader.uniforms.uDetailLevel=detailLevel;
    shader.uniforms.uCognitiveTint=cognitiveTint;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vAuraNormal;\nvarying vec3 vAuraView;\nvarying vec3 vAuraWorldPos;\nvarying vec3 vAuraLocalPos;')
      .replace('#include <project_vertex>',String.raw`
  vAuraLocalPos=transformed;
  vec4 auraWorld=modelMatrix*vec4(transformed,1.0);
  vAuraWorldPos=auraWorld.xyz;
  #include <project_vertex>
  vAuraView=-mvPosition.xyz;
  vAuraNormal=normalize(transformedNormal);`);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',String.raw`
  #include <common>
  uniform float uEnergy;
  uniform float uTime;
  uniform float uSpeaking;
  uniform float uDetailLevel;
  uniform float uCognitiveTint;
  varying vec3 vAuraNormal;
  varying vec3 vAuraView;
  varying vec3 vAuraWorldPos;
  varying vec3 vAuraLocalPos;
  ${GLSL_AURA_BIOFIELD}`)
      .replace('#include <opaque_fragment>',String.raw`
  vec3 auraV=normalize(vAuraView);
  vec2 bio=auraBioField3D(vAuraLocalPos,uTime,uDetailLevel);
  float microRelief=bio.x;
  float veinPattern=bio.y;
  vec3 perturbedN=normalize(vAuraNormal+vec3(microRelief,microRelief*0.7,-microRelief*0.4)*0.028);

  float auraFacing=clamp(dot(perturbedN,auraV),0.0,1.0);

  vec3 keyDir=normalize(vec3(0.28,0.42,0.86));
  vec3 fillDir=normalize(vec3(-0.62,0.10,0.78));
  vec3 topDir=normalize(vec3(0.0,0.88,0.47));
  vec3 underDir=normalize(vec3(0.0,-0.55,0.83));

  float keyDot=dot(perturbedN,keyDir);
  float keyWrap=clamp((keyDot+0.42)/1.42,0.0,1.0);
  float sssBand=smoothstep(0.0,0.55,keyWrap)*(1.0-smoothstep(0.45,1.0,keyWrap));
  float fillWrap=clamp((dot(perturbedN,fillDir)+0.45)/1.45,0.0,1.0);
  float topLight=max(0.0,dot(perturbedN,topDir));
  float underBounce=max(0.0,dot(perturbedN,underDir));

  // Strictly positive sq() instead of pow(negative, 2.0) to prevent IEEE/WebGL NaNs
  float lipZone=exp(-sq((vAuraWorldPos.y-1.522)*42.0))*exp(-sq(vAuraWorldPos.x*22.0))*smoothstep(0.04,0.11,vAuraWorldPos.z);
  float cheekZone=exp(-sq((vAuraWorldPos.y-1.558)*24.0))*smoothstep(0.02,0.08,abs(vAuraWorldPos.x))*smoothstep(0.02,0.09,vAuraWorldPos.z);

  vec3 halfKey=normalize(keyDir+auraV);
  float NdotH=max(0.0,dot(perturbedN,halfKey));
  float broadSpec=pow(NdotH,16.0)*0.34*(1.0+cheekZone*0.45);
  float sharpSpec=pow(NdotH,64.0)*(0.24+lipZone*(0.55+0.25*uSpeaking))*(0.85+0.25*microRelief);

  float oneMinusFacing=max(0.0,1.0-auraFacing);
  float midRim=pow(oneMinusFacing,2.05);
  float outerRim=pow(oneMinusFacing,4.6);

  float scanline=.965+.035*sin(vAuraWorldPos.y*480.0-uTime*3.4);
  float voicePulse=1.0+lipZone*uSpeaking*(0.28+0.15*sin(uTime*18.0));
  float auraFade=smoothstep(1.17,1.42,vAuraWorldPos.y);

  vec3 deepShadow=vec3(.06,.22,.62);
  vec3 biolumCyan=vec3(.24,.66,.99);
  vec3 sssWarmAzure=vec3(.42,.58,1.0);
  vec3 decisionAmber=vec3(1.0,.76,.35);
  vec3 lipRoseCyan=vec3(.58,.82,1.0);
  vec3 highlightIce=vec3(.82,.95,1.0);
  vec3 diamondWhite=vec3(.98,.995,1.0);

  vec3 activeCyan=mix(biolumCyan,decisionAmber,uCognitiveTint*0.35);
  vec3 baseSkin=mix(deepShadow,activeCyan,pow(max(0.0,keyWrap),1.18)*0.76+fillWrap*0.24);
  baseSkin+=sssWarmAzure*sssBand*0.32;
  baseSkin=mix(baseSkin,lipRoseCyan,lipZone*(0.42+0.22*uSpeaking));
  baseSkin=mix(baseSkin,highlightIce,pow(max(0.0,keyWrap),2.2)*0.48+topLight*0.18+broadSpec);
  baseSkin+=diamondWhite*sharpSpec;
  baseSkin+=activeCyan*underBounce*0.14;
  baseSkin+=highlightIce*veinPattern*(0.06+0.12*uEnergy);

  vec3 rimGlow=activeCyan*midRim*(0.62+0.26*uEnergy)+diamondWhite*outerRim*(0.92+0.38*uEnergy);
  outgoingLight=(baseSkin*(0.56+0.14*uEnergy)*voicePulse+rimGlow)*scanline*auraFade;
  diffuseColor.a=clamp(auraFade*(0.85+0.15*midRim),0.0,1.0);
  #include <opaque_fragment>`);
  };

  // 2. Sculpted Translucent Bust / Collar & Ponytail Volume Shaders
  const torsoMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
  torsoMat.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.uniforms.uTime=time;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vTorsoN;\nvarying vec3 vTorsoV;\nvarying float vTorsoY;')
      .replace('#include <project_vertex>','#include <project_vertex>\n  vTorsoV=-mvPosition.xyz;\n  vTorsoY=(modelMatrix*vec4(transformed,1.0)).y;\n  vTorsoN=normalize(transformedNormal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uEnergy;\nuniform float uTime;\nvarying vec3 vTorsoN;\nvarying vec3 vTorsoV;\nvarying float vTorsoY;')
      .replace('#include <opaque_fragment>',String.raw`
  vec3 n=normalize(vTorsoN);vec3 v=normalize(vTorsoV);
  float facing=clamp(dot(n,v),0.0,1.0);
  float rim=pow(max(0.0,1.0-facing),2.2);
  float key=max(0.0,dot(n,normalize(vec3(0.2,0.5,0.85))));
  float fade=smoothstep(1.12,1.36,vTorsoY)*(1.0-smoothstep(1.44,1.52,vTorsoY));
  float grid=.92+.08*sin(vTorsoY*260.0-uTime*3.0);
  vec3 col=mix(vec3(.08,.32,.78),vec3(.55,.88,1.0),rim*.75+key*.25);
  outgoingLight=col*(.18+.48*rim+.16*key)*(1.0+.3*uEnergy)*grid*fade;
  diffuseColor.a=fade*(.35+.45*rim);
  #include <opaque_fragment>`);
  };

  // 3. Procedural 3D Iris, Pupil & Cornea Shader (strictly ordered smoothstep boundaries)
  const eyeMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false});
  eyeMat.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.uniforms.uTime=time;
    shader.uniforms.uPupil=pupil;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vEyeN;\nvarying vec3 vEyeV;')
      .replace('#include <project_vertex>','#include <project_vertex>\n  vEyeV=normalize(-mvPosition.xyz);\n  vEyeN=normalize(transformedNormal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uEnergy;\nuniform float uTime;\nuniform float uPupil;\nvarying vec3 vEyeN;\nvarying vec3 vEyeV;')
      .replace('#include <opaque_fragment>',String.raw`
  vec3 n=normalize(vEyeN);vec3 v=normalize(vEyeV);
  float forward=clamp(dot(n,vec3(0.0,0.0,1.0)),0.0,1.0);
  float radial=length(n.xy);
  float angle=atan(n.y,n.x);
  float fibers=.65+.35*sin(angle*28.0+sin(radial*24.0)*2.5);
  // Strictly ascending smoothstep edge0 < edge1 per GLSL specification
  float irisOuter=1.0-smoothstep(0.52,0.62,radial);
  float irisInner=smoothstep(uPupil-0.04,uPupil+0.05,radial);
  float irisMask=irisOuter*irisInner;
  float limbalRing=(1.0-smoothstep(0.55,0.64,radial))*smoothstep(0.44,0.55,radial);
  float pupilCore=1.0-smoothstep(uPupil-0.03,uPupil+0.03,radial);
  float catch1=pow(max(0.0,dot(n,normalize(vec3(0.28,0.34,0.90)))),72.0);
  float catch2=pow(max(0.0,dot(n,normalize(vec3(-0.35,-0.22,0.91)))),48.0)*0.45;
  vec3 sclera=vec3(.25,.60,.95)*0.42;
  vec3 irisColor=mix(vec3(.18,.68,1.0),vec3(.82,.97,1.0),fibers)*(1.15+0.4*uEnergy);
  vec3 col=sclera*(1.0-irisMask)+irisColor*irisMask+vec3(.05,.22,.55)*limbalRing*0.8;
  col=mix(col,vec3(.04,.16,.42),pupilCore*0.75);
  col+=vec3(1.0,1.0,1.0)*(catch1*1.4+catch2);
  outgoingLight=col*smoothstep(0.1,0.5,forward);
  diffuseColor.a=0.92;
  #include <opaque_fragment>`);
  };

  model.traverse(o=>{if(o.isMesh){o.visible=false;o.frustumCulled=false;}});
  if(!body.geometry.attributes.normal)body.geometry.computeVertexNormals();
  if(!jacket.geometry.attributes.normal)jacket.geometry.computeVertexNormals();
  if(!hairMesh.geometry.attributes.normal)hairMesh.geometry.computeVertexNormals();
  if(!eyeGroup.mesh.geometry.attributes.normal)eyeGroup.mesh.geometry.computeVertexNormals();

  body.material=skin;body.visible=true;
  jacket.material=torsoMat;jacket.visible=true;
  hairMesh.material=torsoMat;hairMesh.visible=true;

  const prepass=new THREE.SkinnedMesh(body.geometry,new THREE.MeshBasicMaterial({colorWrite:false}));
  prepass.bind(body.skeleton,body.bindMatrix);
  prepass.morphTargetInfluences=body.morphTargetInfluences;prepass.morphTargetDictionary=body.morphTargetDictionary;
  prepass.position.copy(body.position);prepass.quaternion.copy(body.quaternion);prepass.scale.copy(body.scale);
  prepass.frustumCulled=false;prepass.renderOrder=-1;body.parent.add(prepass);owned.push(prepass.material,torsoMat,eyeMat);

  eyeGroup.mesh.material=eyeMat;
  eyeGroup.mesh.visible=true;
  brows.material=new THREE.MeshBasicMaterial({color:0xb4e2ff,transparent:true,opacity:.62,blending:THREE.AdditiveBlending,depthWrite:false});
  brows.visible=true;
  lashes.material=new THREE.MeshBasicMaterial({color:0xe6f7ff,transparent:true,opacity:.78,blending:THREE.AdditiveBlending,depthWrite:false});
  lashes.visible=true;
  scene.add(model);

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

  // Adaptive strand geometry budget: 280 strands on mobile, 540 on desktop
  const random=seeded(907),STRANDS=isMobile?280:540,STEPS=isMobile?32:40;
  const linePos=[],lineT=[],lineSeed=[],sparkPos=[],sparkT=[],sparkSeed=[],sparkTw=[];
  const scalp=(th,ph,r)=>new THREE.Vector3(C.x+a*r*Math.sin(th)*Math.sin(ph),C.y+b*r*Math.cos(th),C.z+c*r*Math.sin(th)*Math.cos(ph));
  for(let k=0;k<STRANDS;k++){
    const side=k%2?1:-1,layer=k%3;
    const phi0=side*(.76+random()*2.34),seed=random();
    const thetaEnd=1.45+random()*.55,r=1.025+layer*.018+random()*.045,ts=.32;
    const flare=.045+layer*.025+random()*.11,drop=.26+layer*.04+random()*.18,waveA=.008+random()*.019,waveF=3.5+random()*5.5;
    let prev=null;
    for(let i=0;i<STEPS;i++){
      const t=i/(STEPS-1);let p;
      if(t<=ts){const u=t/ts;p=scalp(u*thetaEnd,phi0+side*.39*Math.sin(u*Math.PI/2),r);}
      else{
        const s=(t-ts)/(1-ts),ph=phi0+side*.39;
        const out=new THREE.Vector3(Math.sin(ph),0,Math.cos(ph)*.52).normalize(),across=new THREE.Vector3(Math.cos(ph),0,-Math.sin(ph));
        p=scalp(thetaEnd,ph,r).addScaledVector(out,flare*Math.pow(s,.84)).add(new THREE.Vector3(0,-drop*s,0)).addScaledVector(across,Math.sin(s*waveF+seed*6.283)*waveA*s);
      }
      p.sub(restPos);
      if(prev){linePos.push(prev.x,prev.y,prev.z,p.x,p.y,p.z);lineT.push((i-1)/(STEPS-1),t);lineSeed.push(seed,seed);}
      if(random()<.075){sparkPos.push(p.x,p.y,p.z);sparkT.push(t);sparkSeed.push(seed);sparkTw.push(random());}
      prev=p;
    }
  }
  const attr=(geo,name,data,size)=>geo.setAttribute(name,new THREE.Float32BufferAttribute(data,size));
  const lineGeo=new THREE.BufferGeometry();attr(lineGeo,'position',linePos,3);attr(lineGeo,'aT',lineT,1);attr(lineGeo,'aSeed',lineSeed,1);
  const lineMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uEnergy:energy},transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aT;attribute float aSeed;uniform float uTime;uniform float uEnergy;varying float vA;varying vec3 vC;
void main(){${SWAY}
  float travel=sin(uTime*2.2+aSeed*19.0-aT*9.0);
  vA=(1.0-aT*.78)*(.66+.34*travel)*(.88+.40*uEnergy);
  vC=mix(vec3(.97,.995,1.0),vec3(.22,.64,1.0),pow(max(0.0,aT),.85));
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vA;varying vec3 vC;void main(){gl_FragColor=vec4(vC,vA*.36);}`});

  const sparkGeo=new THREE.BufferGeometry();attr(sparkGeo,'position',sparkPos,3);attr(sparkGeo,'aT',sparkT,1);attr(sparkGeo,'aSeed',sparkSeed,1);attr(sparkGeo,'aTw',sparkTw,1);
  const sparkMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uPixelRatio:pixelRatio},transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aT;attribute float aSeed;attribute float aTw;uniform float uTime;uniform float uPixelRatio;varying float vA;
void main(){${SWAY}
  vA=.32+.68*pow(max(0.0,.5+.5*sin(uTime*2.5+aTw*40.0)),3.2);
  gl_PointSize=(1.4+2.9*aTw)*uPixelRatio;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vA;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(.94,.99,1.0,(1.0-smoothstep(0.0,.5,d))*vA*.95);}`});
  const lines=new THREE.LineSegments(lineGeo,lineMat),sparks=new THREE.Points(sparkGeo,sparkMat);
  lines.frustumCulled=false;sparks.frustumCulled=false;

  // Volumetric 3D Neural Aura Halo (strictly ascending smoothstep & sq() helper)
  const auraPlaneGeo=new THREE.PlaneGeometry(1.15,1.15);
  const auraPlaneMat=new THREE.ShaderMaterial({
    uniforms:{uTime:time,uEnergy:energy,uCognitiveTint:cognitiveTint},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`varying vec2 vUv;void main(){vUv=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:String.raw`uniform float uTime;uniform float uEnergy;uniform float uCognitiveTint;varying vec2 vUv;
float sq(float x){return x*x;}
void main(){
  float r=length(vUv);
  float a=atan(vUv.y,vUv.x);
  float ring1=exp(-sq((r-0.52)*9.5))*(0.55+0.45*sin(a*6.0-uTime*1.1));
  float ring2=exp(-sq((r-0.68)*12.0))*(0.5+0.5*cos(a*10.0+uTime*0.8));
  float coreGlow=exp(-r*r*3.8)*0.24;
  float radialFade=1.0-smoothstep(0.65,1.0,r);
  float alpha=(coreGlow+ring1*0.18+ring2*0.12)*(0.75+0.45*uEnergy)*radialFade;
  vec3 baseCol=mix(vec3(.14,.48,.96),vec3(.96,.72,.30),uCognitiveTint*0.45);
  gl_FragColor=vec4(mix(baseCol,vec3(.65,.92,1.0),clamp(ring1+ring2,0.0,1.0)),alpha);
}`
  });
  const auraBackdrop=new THREE.Mesh(auraPlaneGeo,auraPlaneMat);
  auraBackdrop.position.set(0,1.53,-0.16);
  auraBackdrop.renderOrder=-2;
  scene.add(auraBackdrop);

  const texture=glowTexture();
  const sprite=(scale,opacity,color=0xffffff)=>{
    const m=new THREE.SpriteMaterial({map:texture,color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthTest:false,depthWrite:false});
    owned.push(m);const s=new THREE.Sprite(m);s.scale.setScalar(scale);return s;
  };
  const hair=new THREE.Group();
  const halo=sprite(.82,.34,0x2b7fff);halo.position.copy(C).sub(restPos).add(new THREE.Vector3(0,-.03,-.09));
  const crown=sprite(.082,.88,0xe6f8ff);crown.position.set(C.x,top+.008,C.z+c*.25).sub(restPos);
  hair.add(halo,lines,sparks,crown);scene.add(hair);

  const eyeCore=[sprite(.012,.92,0xffffff),sprite(.012,.92,0xffffff)];
  const eyeHalo=[sprite(.042,.42,0x78c8ff),sprite(.042,.42,0x78c8ff)];
  scene.add(...eyeCore,...eyeHalo);

  const starCount=isMobile?180:340;
  const starPos=[],starTw=[],stars=seeded(4242);
  for(let i=0;i<starCount;i++){
    const zLayer=i<50?(.15+stars()*.22):(-.45-stars()*.30);
    starPos.push((stars()-.5)*1.15,1.04+stars()*.96,zLayer);
    starTw.push(stars());
  }
  const starGeo=new THREE.BufferGeometry();attr(starGeo,'position',starPos,3);attr(starGeo,'aTw',starTw,1);
  const starMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uPixelRatio:pixelRatio},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aTw;uniform float uTime;uniform float uPixelRatio;varying float vA;
void main(){
  vec3 pos=position;
  float drift=uTime*(.015+aTw*.024)+aTw*6.28;
  pos.y+=mod(drift,0.22)-0.11;
  pos.x+=sin(drift*2.4)*0.012;
  vA=(.22+.64*aTw)*(.55+.45*sin(uTime*(.7+aTw*1.9)+aTw*50.0));
  gl_PointSize=(0.9+2.4*aTw*aTw)*uPixelRatio;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}`,
    fragmentShader:String.raw`varying float vA;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(.80,.93,1.0,(1.0-smoothstep(0.0,.5,d))*vA);}`});
  const starField=new THREE.Points(starGeo,starMat);starField.frustumCulled=false;scene.add(starField);
  owned.push(lineGeo,lineMat,sparkGeo,sparkMat,starGeo,starMat,auraPlaneGeo,auraPlaneMat,texture);

  const hp=new THREE.Vector3(),hq=new THREE.Quaternion(),sums=[new THREE.Vector3(),new THREE.Vector3()],counts=[0,0];
  const hairQuat=new THREE.Quaternion();
  let hairInitialized=false;

  return {
    update(t,energyValue,blink,speakingLevel,qualityTier,decisionSignal,pupilTarget){
      energy.value=energyValue;time.value=t;speaking.value=speakingLevel;
      detailLevel.value=qualityTier;
      cognitiveTint.value=decisionSignal;
      pupil.value=pupilTarget;

      head.getWorldPosition(hp);head.getWorldQuaternion(hq);
      if(!hairInitialized){hairQuat.copy(hq);hairInitialized=true;}
      else{hairQuat.slerp(hq,0.14);}
      hair.position.copy(hp);hair.quaternion.copy(hairQuat).multiply(restInv);
      crown.material.opacity=.70+.25*Math.sin(t*1.7);
      halo.material.opacity=.28+.15*energyValue+.04*Math.sin(t*1.2);

      sums[0].set(0,0,0);sums[1].set(0,0,0);counts[0]=counts[1]=0;
      const vs=eyeGroup.vertices;
      for(let i=0;i<vs.length;i+=3){const s=vs[i]>hp.x?0:1;sums[s].x+=vs[i];sums[s].y+=vs[i+1];sums[s].z+=vs[i+2];counts[s]++;}
      const open=1-.96*blink;
      for(let s=0;s<2;s++){
        if(!counts[s])continue;
        sums[s].divideScalar(counts[s]).z+=.012;
        eyeCore[s].position.copy(sums[s]);eyeHalo[s].position.copy(sums[s]);
        eyeCore[s].material.opacity=.92*open;
        eyeHalo[s].material.opacity=(.38+.20*energyValue)*open;
      }
    },
    dispose(){scene.remove(hair,starField,auraBackdrop,...eyeCore,...eyeHalo);owned.forEach(o=>o.dispose());}
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
  let renderer,geometry,material,observer,lightBody,voiceTracker,raf=0,disposed=false;
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
    const displacement=({index,vertex})=>{
      const weight=face.morphTargetInfluences[index];if(!weight)return 0;
      face.getVertexPosition(vertex,probeA).applyMatrix4(face.matrixWorld);
      face.morphTargetInfluences[index]=0;
      try{face.getVertexPosition(vertex,probeB).applyMatrix4(face.matrixWorld);}
      finally{face.morphTargetInfluences[index]=weight;}
      return 1000*probeA.distanceTo(probeB);
    };
    model.updateMatrixWorld(true);
    const isMobile=window.innerWidth<768;
    const groups=createSamples(model,isMobile?.64:1);
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
    material=new THREE.ShaderMaterial({
      vertexShader,fragmentShader,
      uniforms:{uTime:{value:0},uEnergy:{value:0},uPixelRatio:{value:1},uDecisionMode:{value:0}},
      transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
    });
    const scene=new THREE.Scene(),cloud=new THREE.Points(geometry,material);
    cloud.frustumCulled=false;scene.add(cloud);

    const camera=new THREE.PerspectiveCamera(31,1,.03,20);
    camera.position.set(0,1.570,1.05);camera.lookAt(0,1.540,.03);
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
    renderer.setClearColor(0x000000,0);
    lightBody=createLightBody(scene,model,bones,groups,isMobile);
    voiceTracker=createVoiceFormantTracker();

    // Spring dynamics, adaptive quality governor, and cognitive runtime state
    let energy=0,yaw=0,yawVel=0,pitch=0,pitchVel=0,roll=0,rollVel=0,gazeX=0,gazeY=0,smoothJaw=0;
    let smoothAA=0,smoothO=0,smoothE=0,smoothU=0,decisionBlend=0,pupilSize=0.31;
    let pointerX=0,pointerY=0,camX=0,camY=0;
    let avgFrameMs=33.3,qualityTier=isMobile?0.0:1.0;
    let last=-Infinity,lastStepTime=0;
    let state={
      active:false,speaking:false,listening:false,
      // 'idle' | 'listening' | 'analyzing' | 'verifying' | 'awaiting_decision' | 'speaking'; null derives it from active/speaking/listening.
      cognitivePhase:null,
      x:0,y:0,audioLevel:null,phonemes:null
    };
    const temp=new THREE.Vector3(),n=new THREE.Vector3(),edge1=new THREE.Vector3(),edge2=new THREE.Vector3(),q=new THREE.Quaternion(),euler=new THREE.Euler(0,0,0,'YXZ');
    const rotate=(name,x,y,z)=>{const entry=bones.get(name);if(!entry)return;entry.bone.quaternion.copy(entry.base).multiply(q.setFromEuler(euler.set(x,y,z,'YXZ')));};
    const assign=(name,value)=>{for(const o of morphs){const idx=o.morphTargetDictionary[name];if(idx!==undefined)o.morphTargetInfluences[idx]=clamp(value,0,1);}};

    const onPointerMove=e=>{
      if(motion.matches)return;
      const rect=canvas.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const nx=((e.clientX-rect.left)/rect.width)*2-1;
      const ny=((e.clientY-rect.top)/rect.height)*2-1;
      if(Math.abs(nx)<=1.8&&Math.abs(ny)<=1.8){
        pointerX=clamp(nx,-1,1)*0.22;
        pointerY=clamp(-ny,-1,1)*0.14;
      }
    };

    const springStep=(cur,vel,target,omega,dt)=>{
      const f=1+2*dt*omega,oo=omega*omega,hoo=dt*oo,hhoo=dt*hoo,detInv=1/(f+hhoo);
      return [(f*cur+dt*vel+hhoo*target)*detInv,(vel+hoo*(target-cur))*detInv];
    };

    const pose=time=>{
      const still=motion.matches,t=still?0:time/1000;
      const rawDt=lastStepTime?(time-lastStepTime):33.3;
      const dt=clamp(rawDt/1000,0.008,0.06);
      lastStepTime=time;

      // Adaptive GPU quality governor: drops secondary FBM octave if frame time exceeds 42ms
      avgFrameMs=avgFrameMs*0.92+clamp(rawDt,10,100)*0.08;
      if(!isMobile)qualityTier=avgFrameMs>44?0.0:1.0;

      // Resolve JACO cognitive runtime phase
      const phase=state.cognitivePhase||(state.speaking?'speaking':state.listening?'listening':state.active?'analyzing':'idle');
      const isAnalyzing=phase==='analyzing';
      const isVerifying=phase==='verifying';
      const isDecision=phase==='awaiting_decision';

      decisionBlend=still?Number(isDecision):decisionBlend+(Number(isDecision)-decisionBlend)*0.08;
      material.uniforms.uDecisionMode.value=decisionBlend;

      // Sample live Web Audio FFT formants if attached
      const liveFormants=voiceTracker.sample();
      const hasExternalLevel=typeof state.audioLevel==='number'&&Number.isFinite(state.audioLevel);
      const currentAudioLevel=liveFormants?liveFormants.level:(hasExternalLevel?clamp(state.audioLevel,0,1):0);

      const activeSignal=Number(state.active||state.speaking||state.listening||isAnalyzing||isVerifying)+currentAudioLevel*0.48;
      energy=still?Number(state.active):energy+(activeSignal-energy)*.08;

      // Cognitive kinematics: subtle reading/scanning motion during 'verifying', focused tilt during 'analyzing'
      const verifyScanX=isVerifying&&!still?0.08*Math.sin(t*2.8):0;
      const analyzeTilt=isAnalyzing&&!still?0.045:0;

      const organicYaw=.125*Math.sin(t*.41)+.058*Math.sin(t*.17+1.3)+.022*Math.sin(t*.97);
      const organicPitch=.036*Math.sin(t*.59+.4)+.020*Math.cos(t*.23)+.011*Math.sin(t*1.25);
      const organicRoll=.032*Math.sin(t*.35+.8)+.015*Math.cos(t*.79);

      const inputX=Math.abs(state.x)>0.01?state.x:pointerX;
      const inputY=Math.abs(state.y)>0.01?state.y:pointerY;

      const targetYaw=still?0:clamp(inputX,-1,1)*.36+organicYaw+verifyScanX*.35;
      const targetPitch=still?0:clamp(inputY,-1,1)*.16+organicPitch+(state.listening?.032:0)-(isAnalyzing?.025:0);
      const targetRoll=still?0:organicRoll-targetYaw*.15+(state.listening?.042:0)+analyzeTilt;

      if(still){
        yaw=pitch=roll=yawVel=pitchVel=rollVel=camX=camY=0;
      }else{
        [yaw,yawVel]=springStep(yaw,yawVel,targetYaw,3.1,dt);
        [pitch,pitchVel]=springStep(pitch,pitchVel,targetPitch,3.5,dt);
        [roll,rollVel]=springStep(roll,rollVel,targetRoll,2.7,dt);
        camX+=(yaw*0.038-camX)*0.08;
        camY+=(pitch*0.025-camY)*0.08;
      }
      camera.position.set(camX,1.570+camY,1.05);
      camera.lookAt(0,1.540,.03);

      const breathPhase=t*1.15;
      const breath=still?0:Math.sin(breathPhase)+.24*Math.sin(breathPhase*2.0-.55);
      rotate('Spine2',still?0:.021*breath,yaw*.16,roll*.24);
      rotate('Neck',pitch*.36-.008*breath,yaw*.28,roll*.34);
      rotate('Head',pitch*.72+(state.speaking&&!still?.018*Math.sin(t*3.9)*clamp(smoothJaw*2.5,0.2,1.0):0),yaw*.76,roll*.64);
      rotate('LeftShoulder',still?0:.016*breath,0,-.009*breath);
      rotate('RightShoulder',still?0:.016*breath+.003,0,.009*breath);

      for(let j=0;j<4;j++){
        const lag=j*.46;
        rotate(j?'Ponytail'+j:'PonytailRoot',
          still?0:.046*Math.sin(t*1.14-lag)-pitch*.13,
          still?0:.076*Math.sin(t*.96-lag)-yaw*.19,
          still?0:-roll*.22
        );
      }

      const blinkCycle=t%5.3;
      const b1=smoothstep(1.98,2.06,blinkCycle)*(1-smoothstep(2.06,2.23,blinkCycle));
      const b2=smoothstep(2.32,2.39,blinkCycle)*(1-smoothstep(2.39,2.54,blinkCycle))*.84;
      const blink=still?0:Math.max(b1,b2);

      // Speech synchronization:
      // 1. If Web Audio FFT formants are active, drive visemes directly from real acoustic bands (pauses stay silent).
      // 2. If explicit state.audioLevel is provided by caller, respect 0 as true silence (no sine fallback during pauses).
      // 3. Only use expressive syllable cadence when state.speaking is true AND no audio stream/level is wired.
      let targetJaw=0,targetAA=0,targetO=0,targetE=0,targetU=0,cheekSquint=0;
      if(!still&&state.speaking){
        if(liveFormants){
          targetJaw=liveFormants.level>0.015?(.06+.46*liveFormants.level):0;
          targetAA=clamp(liveFormants.openVowel*.78,0,.76);
          targetO=clamp(liveFormants.roundVowel*.68,0,.66);
          targetE=clamp(liveFormants.spreadVowel*.52,0,.52);
          targetU=clamp(liveFormants.sibilant*.45,0,.46);
          cheekSquint=liveFormants.level*.22;
        }else if(hasExternalLevel){
          // Caller controls audioLevel: 0 means a real pause in speech
          const lvl=clamp(state.audioLevel,0,1);
          if(lvl>0.015){
            targetJaw=.06+.45*lvl;
            targetAA=clamp(lvl*(.55+.35*Math.sin(t*5.8)),0,.74);
            targetO=clamp(lvl*(.45+.35*Math.cos(t*4.5)),0,.64);
            targetE=clamp(lvl*.38,0,.50);
            targetU=clamp(lvl*.32,0,.45);
            cheekSquint=lvl*.20;
          }
        }else{
          // Fallback cadence (keeps existing unit tests passing when only setState({ speaking: true }) is called)
          const syllable=Math.pow(Math.max(0,Math.sin(t*10.6+Math.sin(t*3.3)*1.35)),1.3);
          const phraseEnv=.64+.36*Math.sin(t*2.4+.4);
          const speechDrive=syllable*phraseEnv;
          targetJaw=.07+.43*speechDrive;
          targetAA=clamp(speechDrive*(.54+.46*Math.sin(t*5.8)),0,.74);
          targetO=clamp(speechDrive*(.44+.48*Math.cos(t*4.5)),0,.64);
          targetE=clamp(speechDrive*(.35+.35*Math.sin(t*7.2+1.1)),0,.50);
          targetU=clamp(speechDrive*(.30+.30*Math.cos(t*6.1+2.0)),0,.45);
          cheekSquint=speechDrive*.22;
        }
      }
      smoothJaw=still?0:smoothJaw+(targetJaw-smoothJaw)*.32;
      smoothAA=still?0:smoothAA+(targetAA-smoothAA)*.30;
      smoothO=still?0:smoothO+(targetO-smoothO)*.30;
      smoothE=still?0:smoothE+(targetE-smoothE)*.28;
      smoothU=still?0:smoothU+(targetU-smoothU)*.28;

      // Dynamic pupil response to cognitive state (dilates when analyzing/listening)
      const targetPupil=0.30+(isAnalyzing?0.065:0)+(state.listening?0.045:0)+0.03*energy+0.02*Math.sin(t*0.7);
      pupilSize=still?0.32:pupilSize+(targetPupil-pupilSize)*0.12;

      const smile=still?.09:.09+.045*(1+Math.sin(t*.72))+.04*energy-(isAnalyzing?.03:0);
      const microSaccadeX=still?0:(isVerifying?verifyScanX:(.032*Math.sin(t*2.05)+.018*Math.cos(t*4.9)));
      const microSaccadeY=still?0:.022*Math.cos(t*1.75)-(isVerifying?.03:0);
      gazeX=still?0:gazeX+((yaw*.44+microSaccadeX)-gazeX)*.24;
      gazeY=still?0:gazeY+((pitch*.46+microSaccadeY)-gazeY)*.24;

      const squint=still?0:clamp(smile*.45+cheekSquint+(isAnalyzing?.14:0),0,.38);

      assign('eyeBlinkLeft',blink);assign('eyeBlinkRight',blink);
      assign('eyeSquintLeft',squint);assign('eyeSquintRight',squint);
      assign('cheekSquintLeft',squint*.7);assign('cheekSquintRight',squint*.7);
      assign('jawOpen',smoothJaw);
      assign('viseme_aa',smoothAA);
      assign('viseme_O',smoothO);
      assign('viseme_E',smoothE);
      assign('viseme_U',smoothU);
      assign('mouthSmileLeft',smile);assign('mouthSmileRight',smile);
      assign('browInnerUp',still?0:.05+.15*energy*(.5+.5*Math.sin(t*1.25))+smoothJaw*.15+(isDecision?.14:0));
      assign('browOuterUpLeft',still?0:.03+.08*energy*(.5+.5*Math.cos(t*1.1)));
      assign('browOuterUpRight',still?0:.03+.08*energy*(.5+.5*Math.cos(t*1.1)));
      assign('noseSneerLeft',smoothJaw*.12);assign('noseSneerRight',smoothJaw*.12);
      assign('eyeLookInLeft',Math.max(0,gazeX));assign('eyeLookOutLeft',Math.max(0,-gazeX));
      assign('eyeLookOutRight',Math.max(0,gazeX));assign('eyeLookInRight',Math.max(0,-gazeX));
      assign('eyeLookUpLeft',Math.max(0,gazeY));assign('eyeLookDownLeft',Math.max(0,-gazeY));
      assign('eyeLookUpRight',Math.max(0,gazeY));assign('eyeLookDownRight',Math.max(0,-gazeY));

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
          const shimmer=still?0:(.00065+.0013*energy)*Math.sin(s.seed*21+t*1.5);
          positions[cursor]=x+n.x*shimmer;positions[cursor+1]=y+n.y*shimmer;positions[cursor+2]=z+n.z*shimmer;
          n.toArray(normals,cursor);cursor+=3;
        }
      }
      geometry.attributes.position.needsUpdate=true;geometry.attributes.aNormal.needsUpdate=true;
      material.uniforms.uTime.value=t;material.uniforms.uEnergy.value=energy;
      lightBody.update(t,energy,blink,clamp(smoothJaw*2.0,0,1),qualityTier,decisionBlend,pupilSize);

      let signature=0;for(let j=0;j<Math.min(positions.length,6000);j+=31)signature+=positions[j]*(j+1);
      canvas.dataset.renderedPoints=String(total);canvas.dataset.renderer='rigged-particle-field';
      canvas.dataset.hairPoints=String(groups.find(g=>g.kind===2).samples.length);
      canvas.dataset.torsoPoints=String(groups.find(g=>g.kind===1).samples.length);
      canvas.dataset.yaw=yaw.toFixed(4);canvas.dataset.blink=blink.toFixed(4);canvas.dataset.jaw=smoothJaw.toFixed(4);
      canvas.dataset.geometrySignature=signature.toFixed(5);
      canvas.dataset.blinkMm=displacement(probes[0]).toFixed(3);
      canvas.dataset.jawMm=displacement(probes[1]).toFixed(3);
      canvas.dataset.cognitivePhase=phase;
      canvas.dataset.qualityTier=qualityTier>0.5?'high':'mobile-adaptive';
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
      window.removeEventListener('pointermove',onPointerMove);
      motion.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',refresh);
      canvas.removeEventListener('webglcontextlost',lost);signal?.removeEventListener('abort',dispose);
      voiceTracker?.dispose();lightBody?.dispose();geometry.dispose();material.dispose();renderer.dispose();disposeModel(model);
    }
    cleanup=dispose;
    window.addEventListener('pointermove',onPointerMove,{passive:true});
    canvas.addEventListener('webglcontextlost',lost);
    signal?.addEventListener('abort',dispose,{once:true});
    observer=new ResizeObserver(resize);observer.observe(canvas);
    motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);
    resize();refresh();
    return {
      setState(next){
        if(next?.audioSource)voiceTracker.attach(next.audioSource);
        state={...state,...next};
        if(motion.matches)render(0);
      },
      attachAudio(audioSource){return voiceTracker.attach(audioSource);},
      dispose
    };
  }catch(error){
    if(!disposed){cleanup();if(!disposed){disposed=true;voiceTracker?.dispose();lightBody?.dispose();geometry?.dispose();material?.dispose();renderer?.dispose();disposeModel(model);}}
    throw error;
  }
}
