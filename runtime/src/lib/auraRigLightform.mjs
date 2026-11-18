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
  if(aKind>1.5&&aKind<2.5){vColor=mix(blue,ice,.40+aSeed*.48);strength*=1.20;}
  if(aKind>.5&&aKind<1.5){strength*=.92;}
  if(aKind>2.5){strength*=.70;}
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
  let renderer,geometry,material,observer,raf=0,disposed=false;
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
    // Three-quarter framing reveals the actual ponytail behind the head and keeps shoulders in view.
    const camera=new THREE.PerspectiveCamera(34,1,.03,20);
    camera.position.set(.48,1.53,1.07);camera.lookAt(0,1.50,.035);
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:false,powerPreference:'low-power',preserveDrawingBuffer:true});
    renderer.setClearColor(0x000000,0);
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
      geometry.dispose();material.dispose();renderer.dispose();disposeModel(model);
    }
    cleanup=dispose;
    canvas.addEventListener('webglcontextlost',lost);
    signal?.addEventListener('abort',dispose,{once:true});
    observer=new ResizeObserver(resize);observer.observe(canvas);
    motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);
    resize();refresh();
    return {setState(next){state={...state,...next};if(motion.matches)render(0);},dispose};
  }catch(error){
    if(!disposed){cleanup();if(!disposed){disposed=true;geometry?.dispose();material?.dispose();renderer?.dispose();disposeModel(model);}}
    throw error;
  }
}
