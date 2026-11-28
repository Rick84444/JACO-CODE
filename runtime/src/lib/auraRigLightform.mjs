import {createSecondaryRig} from './auraSecondaryRig.mjs';
import {createV31OpticalRig} from './auraV31OpticalRig.mjs';
import {createHumanBehavior} from './auraHumanBehavior.mjs';
import {createAuraBodyRig} from './auraBodyRig.mjs';
import {VISEMES,emptySpeechPose,sampleSpeechPose,approachSpeechPose,createNaturalBlink,validSpeechTimeline} from './auraSpeechTimeline.mjs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// JACO Cognitive Lightform Engine V6 (Visual Freeze & Hardened Runtime Integration)
// A light-form is sampled from the actual skinned geometry, never from a portrait.
// The pinned CC0 MPFB source and build-time compaction are documented in OpenSpec.
const ASSET='/branding/aura-rig.glb';
const EXPECTED_BYTES=7465400;
const V31_ASSET='/branding/aura-anatomical.glb';
const V31_BYTES=45304080;
const V31_SHA256='ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129';
async function loadAvatar(signal){
  // Optional locally installed V31; keep the existing lightform if not installed.
  try{
    const response=await fetch(V31_ASSET,{signal,cache:'force-cache'});
    if(response.ok&&!response.headers.get('content-type')?.includes('text/html')){
      const bytes=await response.arrayBuffer();
      const header=new DataView(bytes);
      if(bytes.byteLength!==V31_BYTES||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==V31_BYTES)throw Error('AURA_V31_HEADER');
      if(globalThis.crypto?.subtle){
        const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==V31_SHA256)throw Error('AURA_V31_HASH');
      }
      return {gltf:await new GLTFLoader().parseAsync(bytes,''),anatomical:true};
    }
    if(!response.ok&&response.status!==404)throw Error('AURA_V31_HTTP_'+response.status);
  }catch(error){
    if(signal?.aborted)throw error;
    console.warn('Aura V31 unavailable; retaining lightform',error);
  }
  const response=await fetch(ASSET,{signal,cache:'force-cache'});
  if(!response.ok)throw Error('AURA_RIG_ASSET_'+response.status);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==EXPECTED_BYTES)throw Error('AURA_RIG_ASSET_SIZE');
  return {gltf:await new GLTFLoader().parseAsync(bytes,''),anatomical:false};
}
const FRAME_TIME=1000/30;
function seeded(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finiteClamp=(v,a,b,fallback=0)=>{
  const n=typeof v==='number'?v:Number(v);
  if(!Number.isFinite(n))return fallback;
  return n<a?a:(n>b?b:n);
};
const smoothstep=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t);};

/**
 * Zero-GC deterministic surface sampler.
 * Pre-flattens triangle vertex offsets (multiplied by 3) and barycentric weights into TypedArrays
 * so the 30 FPS skinning loop performs zero heap allocations per frame.
 */
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
  const flatIds=new Uint32Array(count*3);
  const flatWeights=new Float32Array(count*3);
  const flatSeeds=new Float32Array(count);
  let fi=0;
  for(let i=0;i<count;i++){
    const target=(i+random())/count*area;
    while(fi<faces.length-1&&faces[fi].end<target)fi++;
    const root=Math.sqrt(random()),s=root*random();
    const w0=1-root,w1=s,w2=root-s;
    const fIds=faces[fi].ids;
    const id0=unique.has(fIds[0])?unique.get(fIds[0]):(unique.set(fIds[0],unique.size),unique.size-1);
    const id1=unique.has(fIds[1])?unique.get(fIds[1]):(unique.set(fIds[1],unique.size),unique.size-1);
    const id2=unique.has(fIds[2])?unique.get(fIds[2]):(unique.set(fIds[2],unique.size),unique.size-1);
    const base=i*3;
    flatIds[base]=id0*3;flatIds[base+1]=id1*3;flatIds[base+2]=id2*3;
    flatWeights[base]=w0;flatWeights[base+1]=w1;flatWeights[base+2]=w2;
    const sampleSeed=random(),sampleSize=.62+random()*.82;
    flatSeeds[i]=sampleSeed;
    samples.push({seed:sampleSeed,size:sampleSize});
  }
  return {
    mesh,
    samples,
    flatIds,
    flatWeights,
    flatSeeds,
    indices:Uint32Array.from(unique.keys()),
    vertices:new Float32Array(unique.size*3)
  };
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
  float shimmer=(.00065+.0013*uEnergy)*sin(aSeed*21.0+uTime*1.5);
  vec3 displaced=position+aNormal*shimmer;
  vec4 mv=modelViewMatrix*vec4(displaced,1.0);
  vec3 n=normalize(normalMatrix*aNormal);
  vec3 viewDir=normalize(-mv.xyz);
  float facing=max(0.0,dot(n,viewDir));
  float rim=pow(max(0.0,1.0-facing),1.75);
  float pulse=.84+.16*sin(uTime*2.0+aSeed*23.0+displaced.y*14.0);
  float fade=(aKind>.5&&aKind<1.5)?smoothstep(1.12,1.28,displaced.y):smoothstep(1.30,1.42,displaced.y);
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
  if(aKind<.5){strength*=.55;}
  if(aKind>1.5&&aKind<2.5){vColor=mix(deepBiolum,pureDiamond,.45+aSeed*.50);strength*=.30;}
  if(aKind>.5&&aKind<1.5){vColor=mix(deepBiolum,pureDiamond,.55+aSeed*.45);strength*=1.15;}
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
 * MODULE 1: VoiceFormantTracker
 * - Strictly adopts `audioInput.context` when passed an AudioNode.
 * - NEVER calls unargumented `sourceNode.disconnect()` on external AudioNodes, preventing accidental detachment of main playback speakers.
 * - Uses fftSize=1024 (~46.8 Hz resolution at 48 kHz) to resolve F0 pitch, F1/F2 vowel formants, and spectral Shannon entropy.
 */
export function createVoiceFormantTracker(){
  let ctx=null,ownsContext=false,analyser=null,sourceNode=null,ownsSourceNode=false,bins=null,connected=false;
  let noiseFloor=0.012;
  const result={level:0,openVowel:0,roundVowel:0,spreadVowel:0,sibilant:0,entropy:0};

  function detachCurrent(){
    if(sourceNode&&analyser){
      try{
        // Only disconnect the specific analyser branch; never blanket-disconnect an external AudioNode
        sourceNode.disconnect(analyser);
      }catch{
        if(ownsSourceNode){
          try{sourceNode.disconnect();}catch{}
        }
      }
    }
    if(analyser){try{analyser.disconnect();}catch{}}
    sourceNode=null;ownsSourceNode=false;analyser=null;bins=null;connected=false;
  }

  return {
    attach(audioInput){
      detachCurrent();
      let candidateSource=null,candidateAnalyser=null,candidateOwnsSource=false;
      try{
        if(!audioInput)return false;
        const AudioCtx=typeof window!=='undefined'?(window.AudioContext||window.webkitAudioContext):null;
        if(audioInput.context&&typeof audioInput.connect==='function'){
          if(ctx&&ownsContext&&ctx!==audioInput.context){try{ctx.close();}catch{}}
          ctx=audioInput.context;
          ownsContext=false;
          candidateAnalyser=ctx.createAnalyser();
          candidateAnalyser.fftSize=1024;
          candidateAnalyser.smoothingTimeConstant=0.68;
          candidateSource=audioInput;
          candidateOwnsSource=false;
          candidateSource.connect(candidateAnalyser);
          bins=new Uint8Array(candidateAnalyser.frequencyBinCount);
          sourceNode=candidateSource;
          ownsSourceNode=false;
          analyser=candidateAnalyser;
          connected=true;
        }else if(typeof MediaStream!=='undefined'&&audioInput instanceof MediaStream){
          if(!AudioCtx)return false;
          if(!ctx||!ownsContext){ctx=new AudioCtx();ownsContext=true;}
          candidateAnalyser=ctx.createAnalyser();
          candidateAnalyser.fftSize=1024;
          candidateAnalyser.smoothingTimeConstant=0.68;
          candidateSource=ctx.createMediaStreamSource(audioInput);
          candidateOwnsSource=true;
          candidateSource.connect(candidateAnalyser);
          bins=new Uint8Array(candidateAnalyser.frequencyBinCount);
          sourceNode=candidateSource;
          ownsSourceNode=true;
          analyser=candidateAnalyser;
          connected=true;
        }else if(typeof HTMLMediaElement!=='undefined'&&audioInput instanceof HTMLMediaElement){
          if(!AudioCtx)return false;
          if(!ctx||!ownsContext){ctx=new AudioCtx();ownsContext=true;}
          candidateAnalyser=ctx.createAnalyser();
          candidateAnalyser.fftSize=1024;
          candidateAnalyser.smoothingTimeConstant=0.68;
          candidateSource=ctx.createMediaElementSource(audioInput);
          candidateOwnsSource=true;
          candidateSource.connect(candidateAnalyser);
          candidateAnalyser.connect(ctx.destination);
          bins=new Uint8Array(candidateAnalyser.frequencyBinCount);
          sourceNode=candidateSource;
          ownsSourceNode=true;
          analyser=candidateAnalyser;
          connected=true;
        }else{
          return false;
        }
        if(ctx&&ctx.state==='suspended'&&typeof ctx.resume==='function'){
          ctx.resume().catch(()=>{});
        }
        return true;
      }catch{
        // Safe cleanup on error: never call unargumented disconnect() on an external node
        if(candidateSource&&candidateAnalyser){
          try{candidateSource.disconnect(candidateAnalyser);}catch{
            if(candidateOwnsSource){try{candidateSource.disconnect();}catch{}}
          }
        }
        if(candidateAnalyser){try{candidateAnalyser.disconnect();}catch{}}
        sourceNode=null;ownsSourceNode=false;analyser=null;bins=null;connected=false;
        return false;
      }
    },
    sample(){
      if(!connected||!analyser||!bins)return null;
      analyser.getByteFrequencyData(bins);
      const sampleRate=ctx?.sampleRate||48000;
      const hzPerBin=sampleRate/analyser.fftSize;
      let f0Sum=0,f0N=0,f1OpenSum=0,f1OpenN=0,f1CloseSum=0,f1CloseN=0,f2FrontSum=0,f2FrontN=0,sibSum=0,sibN=0;
      let totalPower=0;
      const maxBin=Math.min(bins.length,Math.ceil(5600/hzPerBin));
      for(let i=1;i<maxBin;i++){
        const hz=i*hzPerBin,val=bins[i]/255;
        totalPower+=val;
        if(hz>=85&&hz<290){f0Sum+=val;f0N++;}
        else if(hz>=290&&hz<560){f1CloseSum+=val;f1CloseN++;}
        else if(hz>=560&&hz<1050){f1OpenSum+=val;f1OpenN++;}
        else if(hz>=1050&&hz<2650){f2FrontSum+=val;f2FrontN++;}
        else if(hz>=2650&&hz<=5500){sibSum+=val;sibN++;}
      }
      const f0=f0N?f0Sum/f0N:0;
      const f1Close=f1CloseN?f1CloseSum/f1CloseN:0;
      const f1Open=f1OpenN?f1OpenSum/f1OpenN:0;
      const f2Front=f2FrontN?f2FrontSum/f2FrontN:0;
      const sibilant=sibN?sibSum/sibN:0;

      let entropy=0;
      if(totalPower>1e-4){
        for(let i=1;i<maxBin;i++){
          const p=(bins[i]/255)/totalPower;
          if(p>1e-5)entropy-=p*Math.log2(p);
        }
        entropy=finiteClamp(entropy/Math.log2(maxBin),0,1,0);
      }

      const rawEnergy=f0*0.26+f1Close*0.24+f1Open*0.30+f2Front*0.14+sibilant*0.06;
      noiseFloor=Math.min(0.04,Math.max(0.007,noiseFloor*0.995+Math.min(rawEnergy,noiseFloor)*0.005));
      const gated=Math.max(0,rawEnergy-noiseFloor*1.42)/(1-noiseFloor);
      if(gated<0.014){
        result.level=0;result.openVowel=0;result.roundVowel=0;result.spreadVowel=0;result.sibilant=0;result.entropy=0;
        return result;
      }
      const structuredGain=1.15-0.25*entropy;
      result.level=finiteClamp(gated*1.72*structuredGain,0,1,0);
      result.openVowel=finiteClamp((f1Open*1.55+f0*0.25)*structuredGain,0,1,0);
      result.roundVowel=finiteClamp((f1Close*1.48+f0*0.30-f2Front*0.35)*structuredGain,0,1,0);
      result.spreadVowel=finiteClamp((f2Front*1.50+f1Close*0.20)*structuredGain,0,1,0);
      result.sibilant=finiteClamp(sibilant*1.85,0,1,0);
      result.entropy=entropy;
      return result;
    },
    isConnected(){return connected;},
    dispose(){
      detachCurrent();
      if(ctx&&ownsContext){try{ctx.close();}catch{}}
      ctx=null;ownsContext=false;
    }
  };
}

/**
 * MODULE 2: QualityGovernor
 * - Calibrated for a 30 FPS target loop (FRAME_TIME = 33.33ms):
 *   Downgrades when smoothed frame interval exceeds 46.0ms (~21.7 FPS)
 *   Upgrades back to high quality when smoothed frame interval recovers below 36.5ms (>= 27.4 FPS, covering healthy 30 FPS at 33.3ms)
 *   after a 2500ms hysteresis cooldown.
 */
export function createQualityGovernor(isMobile=false){
  let avgFrameMs=33.33;
  let tier=isMobile?0.0:1.0;
  let lastSwitchTime=-Infinity;
  const DOWNGRADE_MS=46.0;
  const UPGRADE_MS=36.5;
  const COOLDOWN_MS=2500;
  return {
    update(rawDtMs,nowMs=0){
      const safeDt=finiteClamp(rawDtMs,8,120,33.33);
      const safeNow=finiteClamp(nowMs,0,1e15,0);
      avgFrameMs=avgFrameMs*0.88+safeDt*0.12;
      if(isMobile)return 0.0;
      if(safeNow-lastSwitchTime<COOLDOWN_MS)return tier;
      if(tier>0.5&&avgFrameMs>DOWNGRADE_MS){
        tier=0.0;lastSwitchTime=safeNow;
      }else if(tier<0.5&&avgFrameMs<=UPGRADE_MS){
        tier=1.0;lastSwitchTime=safeNow;
      }
      return tier;
    },
    getTier(){return tier;},
    getAverageFrameMs(){return avgFrameMs;}
  };
}

/**
 * MODULE 3: BehaviorEngine (Cognitive Expression & NaN-Safe Phoneme Co-Articulation)
 * - Auto-derives cognitivePhase when state.cognitivePhase is null/undefined.
 * - Sanitizes all incoming phoneme weights with `finiteClamp` so NaN, strings, or +/-Infinity never corrupt morph targets.
 * - Reuses a pre-allocated output object for Zero-GC execution in the 30 FPS loop.
 */
export function createBehaviorEngine(){
  const PHONEME_MAP={
    AA:{jaw:0.46,aa:0.78,O:0.08,E:0.10,U:0.0},
    A:{jaw:0.42,aa:0.72,O:0.10,E:0.15,U:0.0},
    O:{jaw:0.34,aa:0.12,O:0.74,E:0.0,U:0.22},
    U:{jaw:0.22,aa:0.05,O:0.32,E:0.0,U:0.68},
    E:{jaw:0.26,aa:0.18,O:0.0,E:0.68,U:0.0},
    I:{jaw:0.18,aa:0.10,O:0.0,E:0.58,U:0.08},
    M:{jaw:0.02,aa:0.0,O:0.0,E:0.0,U:0.08},
    B:{jaw:0.04,aa:0.0,O:0.0,E:0.0,U:0.10},
    P:{jaw:0.04,aa:0.0,O:0.0,E:0.0,U:0.10},
    F:{jaw:0.12,aa:0.05,O:0.08,E:0.18,U:0.25},
    V:{jaw:0.12,aa:0.05,O:0.08,E:0.18,U:0.25},
    S:{jaw:0.10,aa:0.05,O:0.0,E:0.32,U:0.18},
    SIL:{jaw:0.0,aa:0.0,O:0.0,E:0.0,U:0.0}
  };

  const out={jaw:0,aa:0,O:0,E:0,U:0,cheek:0};
  const explicitBuf={jaw:0,aa:0,O:0,E:0,U:0};

  function resolvePhonemeWeights(phonemes){
    if(!phonemes)return null;
    if(typeof phonemes==='string'){
      const key=phonemes.trim().toUpperCase();
      return PHONEME_MAP[key]||PHONEME_MAP.SIL;
    }
    if(typeof phonemes==='object'){
      const aa=finiteClamp(phonemes.aa??phonemes.viseme_aa,0,1,0);
      const O=finiteClamp(phonemes.O??phonemes.o??phonemes.viseme_O,0,1,0);
      const E=finiteClamp(phonemes.E??phonemes.e??phonemes.viseme_E,0,1,0);
      const U=finiteClamp(phonemes.U??phonemes.u??phonemes.viseme_U,0,1,0);
      const rawJaw=phonemes.jaw??phonemes.jawOpen;
      const derivedJaw=aa*0.52+O*0.40+E*0.28+U*0.20;
      const jaw=rawJaw!==undefined&&rawJaw!==null?finiteClamp(rawJaw,0,1,derivedJaw):finiteClamp(derivedJaw,0,1,0);
      explicitBuf.jaw=jaw;explicitBuf.aa=aa;explicitBuf.O=O;explicitBuf.E=E;explicitBuf.U=U;
      return explicitBuf;
    }
    return null;
  }

  return {
    resolvePhase(state,busPhase){
      if(state&&typeof state.cognitivePhase==='string'&&state.cognitivePhase.length>0)return state.cognitivePhase;
      if(typeof busPhase==='string'&&busPhase.length>0)return busPhase;
      if(state?.speaking)return 'speaking';
      if(state?.listening)return 'listening';
      if(state?.active)return 'analyzing';
      return 'idle';
    },
    computeVisemes(t,still,state,liveFormants,hasExternalLevel){
      if(still||!state?.speaking){
        out.jaw=0;out.aa=0;out.O=0;out.E=0;out.U=0;out.cheek=0;
        return out;
      }
      const safeT=finiteClamp(t,0,1e12,0);
      // Priority 1: Explicit phoneme/viseme input (strictly NaN-sanitized)
      const explicit=resolvePhonemeWeights(state.phonemes);
      if(explicit){
        out.jaw=explicit.jaw;
        out.aa=explicit.aa;
        out.O=explicit.O;
        out.E=explicit.E;
        out.U=explicit.U;
        out.cheek=finiteClamp(explicit.jaw*0.42+explicit.E*0.25,0,0.32,0);
        return out;
      }
      // Priority 2: Live Web Audio FFT Formant Tracker
      if(liveFormants){
        const lvl=finiteClamp(liveFormants.level,0,1,0);
        out.jaw=lvl>0.014?finiteClamp(.05+.46*lvl,0,1,0):0;
        out.aa=finiteClamp(liveFormants.openVowel*.78,0,.76,0);
        out.O=finiteClamp(liveFormants.roundVowel*.70,0,.68,0);
        out.E=finiteClamp(liveFormants.spreadVowel*.58,0,.56,0);
        out.U=finiteClamp(liveFormants.sibilant*.46,0,.46,0);
        out.cheek=finiteClamp(lvl*.22,0,0.32,0);
        return out;
      }
      // Priority 3: Caller-supplied numeric audioLevel (0 = true silence pause)
      if(hasExternalLevel){
        const lvl=finiteClamp(state.audioLevel,0,1,0);
        if(lvl<=0.015){
          out.jaw=0;out.aa=0;out.O=0;out.E=0;out.U=0;out.cheek=0;
          return out;
        }
        out.jaw=finiteClamp(.06+.45*lvl,0,1,0);
        out.aa=finiteClamp(lvl*(.55+.35*Math.sin(safeT*5.8)),0,.74,0);
        out.O=finiteClamp(lvl*(.45+.35*Math.cos(safeT*4.5)),0,.64,0);
        out.E=finiteClamp(lvl*.38,0,.50,0);
        out.U=finiteClamp(lvl*.32,0,.45,0);
        out.cheek=finiteClamp(lvl*.20,0,0.32,0);
        return out;
      }
      // Priority 4: Deterministic cadence fallback when only speaking:true is set
      const syllable=Math.pow(Math.max(0,Math.sin(safeT*10.6+Math.sin(safeT*3.3)*1.35)),1.3);
      const phraseEnv=.64+.36*Math.sin(safeT*2.4+.4);
      const drive=syllable*phraseEnv;
      out.jaw=finiteClamp(.07+.43*drive,0,1,0);
      out.aa=finiteClamp(drive*(.54+.46*Math.sin(safeT*5.8)),0,.74,0);
      out.O=finiteClamp(drive*(.44+.48*Math.cos(safeT*4.5)),0,.64,0);
      out.E=finiteClamp(drive*(.35+.35*Math.sin(safeT*7.2+1.1)),0,.50,0);
      out.U=finiteClamp(drive*(.30+.30*Math.cos(safeT*6.1+2.0)),0,.45,0);
      out.cheek=finiteClamp(drive*.22,0,0.32,0);
      return out;
    }
  };
}

function createLightBody(scene,model,bones,groups,isMobile,distantField,stars){
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

  const skin=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.NormalBlending,depthWrite:true});
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
  float lowMask=1.0-smoothstep(1.33,1.43,vAuraWorldPos.y);
  vec3 baseN=normalize(mix(vAuraNormal,vec3(0.0,0.0,1.0),lowMask*0.88));
  vec3 perturbedN=normalize(baseN+vec3(microRelief,microRelief*0.7,-microRelief*0.4)*0.028*(1.0-lowMask));

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

  float lipZone=exp(-sq((vAuraWorldPos.y-1.522)*42.0))*exp(-sq(vAuraWorldPos.x*22.0))*smoothstep(0.04,0.11,vAuraWorldPos.z);
  float cheekZone=exp(-sq((vAuraWorldPos.y-1.558)*24.0))*smoothstep(0.02,0.08,abs(vAuraWorldPos.x))*smoothstep(0.02,0.09,vAuraWorldPos.z);

  vec3 halfKey=normalize(keyDir+auraV);
  float NdotH=max(0.0,dot(perturbedN,halfKey));
  float broadSpec=pow(NdotH,16.0)*0.34*(1.0+cheekZone*0.45);
  float sharpSpec=pow(NdotH,64.0)*(0.24+lipZone*(0.55+0.25*uSpeaking))*(0.85+0.25*microRelief);

  float oneMinusFacing=max(0.0,1.0-auraFacing);
  float midRim=pow(oneMinusFacing,2.05);
  float outerRim=pow(oneMinusFacing,4.6);

  float scanline=.99+.01*sin(vAuraWorldPos.y*480.0-uTime*3.4);
  float voicePulse=1.0+lipZone*uSpeaking*(0.28+0.15*sin(uTime*18.0));
  float auraFade=smoothstep(1.14,1.27,vAuraWorldPos.y)*mix(0.62,1.0,smoothstep(1.27,1.44,vAuraWorldPos.y))*(1.0-smoothstep(0.26,0.38,abs(vAuraWorldPos.x)));

  vec3 deepShadow=vec3(.02,.10,.42);
  vec3 biolumCyan=vec3(.10,.46,1.0);
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
  baseSkin+=highlightIce*veinPattern*(0.24+0.16*uEnergy+lowMask*0.62);
  float bodyNet=pow(max(0.0,1.0-abs(auraGyroid(vAuraLocalPos*34.0+vec3(0.0,uTime*0.2,0.0)))),9.0);
  baseSkin=mix(baseSkin,baseSkin*0.55,lowMask*0.55)+vec3(.55,.82,1.0)*bodyNet*lowMask*0.55;
  baseSkin+=vec3(.55,.80,1.0)*lowMask*(0.10+0.10*sin(vAuraWorldPos.y*38.0-uTime*1.6))*(0.5+0.5*uEnergy);

  float lidZone=smoothstep(1.650,1.660,vAuraWorldPos.y)*(1.0-smoothstep(1.672,1.684,vAuraWorldPos.y))
    *smoothstep(0.012,0.022,abs(vAuraWorldPos.x))*(1.0-smoothstep(0.052,0.064,abs(vAuraWorldPos.x)))*smoothstep(0.04,0.08,vAuraWorldPos.z);
  baseSkin=mix(baseSkin,vec3(.66,.72,.94),lidZone*.22)+vec3(.10,.11,.14)*lidZone*sharpSpec*2.0;
  vec3 rimGlow=activeCyan*midRim*(0.62+0.26*uEnergy)+diamondWhite*outerRim*(0.92+0.38*uEnergy);
  vec3 detailed=(baseSkin*(0.56+0.12*uEnergy)*voicePulse+rimGlow*1.65)*scanline;
  // No anatomy below the collarbones: uniform white light that softly dissolves.
  outgoingLight=detailed;
  diffuseColor.a=auraFade;
  #include <opaque_fragment>`);
  };

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

  const hairMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,side:THREE.DoubleSide,blending:THREE.NormalBlending,depthWrite:true});
  hairMat.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.uniforms.uTime=time;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vHairN;\nvarying vec3 vHairV;\nvarying vec3 vHairW;')
      .replace('#include <project_vertex>','#include <project_vertex>\n  vHairV=-mvPosition.xyz;\n  vHairW=(modelMatrix*vec4(transformed,1.0)).xyz;\n  vHairN=normalize(transformedNormal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uEnergy;\nuniform float uTime;\nvarying vec3 vHairN;\nvarying vec3 vHairV;\nvarying vec3 vHairW;')
      .replace('#include <opaque_fragment>',String.raw`
  vec3 n=normalize(vHairN);vec3 v=normalize(vHairV);
  float facing=abs(dot(n,v));
  float rim=pow(max(0.0,1.0-facing),2.0);
  // Strands run front-to-back over the scalp: stripes across x, gently waving along the flow.
  float flow=vHairW.x*820.0+sin(vHairW.z*60.0+vHairW.y*40.0)*3.0;
  float strand=.55+.45*sin(flow)*sin(flow*.37+1.3);
  float sheen=pow(max(0.0,dot(n,normalize(vec3(0.15,0.75,0.65)))),6.0);
  vec3 base=mix(vec3(.12,.32,.70),vec3(.78,.92,1.0),strand*.7+sheen*.5);
  outgoingLight=base*(.78+.28*strand)+vec3(.80,.94,1.0)*(rim*.60+sheen*.40)*(1.0+.25*uEnergy)+vec3(.30,.62,1.0)*.10;
  diffuseColor.a=.94;
  #include <opaque_fragment>`);
  };
  owned.push(hairMat);

  const whiteMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.NormalBlending,depthWrite:false});
  whiteMat.onBeforeCompile=shader=>{
    shader.uniforms.uEnergy=energy;
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vWhiteN;\nvarying vec3 vWhiteV;\nvarying float vWhiteY;')
      .replace('#include <project_vertex>','#include <project_vertex>\n  vWhiteV=-mvPosition.xyz;\n  vWhiteY=(modelMatrix*vec4(transformed,1.0)).y;\n  vWhiteN=normalize(transformedNormal);');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nuniform float uEnergy;\nvarying vec3 vWhiteN;\nvarying vec3 vWhiteV;\nvarying float vWhiteY;')
      .replace('#include <opaque_fragment>',String.raw`
  vec3 wn=normalize(vWhiteN);
  float facing=clamp(dot(wn,normalize(vWhiteV)),0.0,1.0);
  float rim=pow(max(0.0,1.0-facing),2.0);
  float key=clamp((dot(wn,normalize(vec3(0.28,0.42,0.86)))+0.4)/1.4,0.0,1.0);
  vec3 body=mix(vec3(.42,.62,.95),vec3(.86,.94,1.0),key*.8);
  outgoingLight=body*(.86+.12*uEnergy)+vec3(.92,.97,1.0)*rim*.65;
  diffuseColor.a=smoothstep(1.14,1.36,vWhiteY)*(.88+.12*rim);
  #include <opaque_fragment>`);
  };
  owned.push(whiteMat);

  const eyeMat=new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,blending:THREE.NormalBlending,depthWrite:false});
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
  float irisOuter=1.0-smoothstep(0.52,0.62,radial);
  float irisInner=smoothstep(uPupil-0.04,uPupil+0.05,radial);
  float irisMask=irisOuter*irisInner;
  float limbalRing=(1.0-smoothstep(0.55,0.64,radial))*smoothstep(0.44,0.55,radial);
  float pupilCore=1.0-smoothstep(uPupil-0.03,uPupil+0.03,radial);
  float catch1=pow(max(0.0,dot(n,normalize(vec3(0.28,0.34,0.90)))),72.0);
  float catch2=pow(max(0.0,dot(n,normalize(vec3(-0.35,-0.22,0.91)))),48.0)*0.45;
  vec3 sclera=vec3(.86,.92,1.0)*0.92;
  float crypts=.5+.5*sin(angle*11.0+radial*38.0);
  vec3 irisColor=mix(vec3(.05,.42,.95),vec3(.55,.95,1.0),fibers*.75+crypts*.25)*(1.1+0.3*uEnergy);
  irisColor=mix(irisColor,vec3(.70,.86,1.0),smoothstep(uPupil+0.02,uPupil+0.10,radial)*(1.0-smoothstep(uPupil+0.10,uPupil+0.18,radial))*.35);
  vec3 col=sclera*(1.0-irisMask)+irisColor*irisMask+vec3(.02,.08,.30)*limbalRing*0.9;
  col=mix(col,vec3(.02,.04,.12),pupilCore*0.92);
  col+=vec3(1.0,1.0,1.0)*(catch1*1.4+catch2);
  outgoingLight=col*smoothstep(0.1,0.5,forward);
  diffuseColor.a=0.97;
  #include <opaque_fragment>`);
  };

  model.traverse(o=>{if(o.isMesh){o.visible=false;o.frustumCulled=false;}});
  if(!body.geometry.attributes.normal)body.geometry.computeVertexNormals();
  if(!jacket.geometry.attributes.normal)jacket.geometry.computeVertexNormals();
  if(!hairMesh.geometry.attributes.normal)hairMesh.geometry.computeVertexNormals();
  if(!eyeGroup.mesh.geometry.attributes.normal)eyeGroup.mesh.geometry.computeVertexNormals();

  body.material=skin;body.visible=true;
  // The rig has no skin under the outfit, so the outfit shape carries the torso in the same light material as the face.
  jacket.material=skin;jacket.visible=true;
  hairMesh.material=hairMat;hairMesh.visible=true;

  const prepass=new THREE.SkinnedMesh(body.geometry,new THREE.MeshBasicMaterial({colorWrite:false}));
  prepass.bind(body.skeleton,body.bindMatrix);
  prepass.morphTargetInfluences=body.morphTargetInfluences;prepass.morphTargetDictionary=body.morphTargetDictionary;
  prepass.position.copy(body.position);prepass.quaternion.copy(body.quaternion);prepass.scale.copy(body.scale);
  prepass.frustumCulled=false;prepass.renderOrder=-1;body.parent.add(prepass);owned.push(prepass.material,torsoMat,eyeMat);

  eyeGroup.mesh.material=eyeMat;
  eyeGroup.mesh.visible=true;
  brows.material=new THREE.MeshBasicMaterial({color:0xaab8d4,transparent:true,opacity:.72,blending:THREE.NormalBlending,depthWrite:false});
  brows.visible=true;
  lashes.material=new THREE.MeshBasicMaterial({color:0x7d8fb4,transparent:true,opacity:.92,blending:THREE.NormalBlending,depthWrite:false,side:THREE.DoubleSide});
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

  const random=seeded(907),STRANDS=isMobile?36:70,STEPS=isMobile?28:36;
  const linePos=[],lineT=[],lineSeed=[],sparkPos=[],sparkT=[],sparkSeed=[],sparkTw=[];
  const scalp=(th,ph,r)=>new THREE.Vector3(C.x+a*r*Math.sin(th)*Math.sin(ph),C.y+b*r*Math.cos(th),C.z+c*r*Math.sin(th)*Math.cos(ph));
  for(let k=0;k<STRANDS;k++){
    const side=k%2?1:-1,layer=k%3;
    const phi0=side*(1.35+random()*1.75),seed=random();
    const thetaEnd=1.45+random()*.55,r=1.025+layer*.018+random()*.045,ts=.32;
    const flare=.045+layer*.025+random()*.11,drop=.10+layer*.03+random()*.12,waveA=.008+random()*.019,waveF=3.5+random()*5.5;
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
  vC=mix(vec3(.85,.95,1.0),vec3(.30,.60,1.0),pow(max(0.0,aT),.85));
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vA;varying vec3 vC;void main(){gl_FragColor=vec4(vC,vA*.22);}`});

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

  // Long, thick, wavy hair: textured ribbons that follow the scalp, frame the face and fall in waves past the shoulders.
  const LOCKS=isMobile?28:48,LSTEPS=isMobile?56:84,lockRand=seeded(1709);
  const lp=[],lt=[],lu=[],ls=[],lidx=[];let vbase=0;
  const tan=new THREE.Vector3(),outV=new THREE.Vector3(),acrossV=new THREE.Vector3();
  for(let k=0;k<LOCKS;k++){
    const side=k%2?1:-1;
    const ph0=side*(0.62+lockRand()*2.45);
    const seed=lockRand(),thEnd=1.35+lockRand()*.35,r=1.05+lockRand()*.06;
    const len=.03+lockRand()*.06,waveA=.010+lockRand()*.012,waveF=5+lockRand()*4,flare=.008+lockRand()*.016;
    const w0=.010+lockRand()*.008;
    for(let i=0;i<LSTEPS;i++){
      const t=i/(LSTEPS-1),ts=.30;let p,ph;
      if(t<=ts){const u=t/ts;ph=ph0*(.35+.65*u);p=scalp(.12+u*(thEnd-.12),ph,r);}
      else{
        const q=(t-ts)/(1-ts);ph=ph0;
        outV.set(Math.sin(ph),0,Math.cos(ph)*.6).normalize();acrossV.set(Math.cos(ph),0,-Math.sin(ph));
        const curl=Math.min(1,q*2.2);
        p=scalp(thEnd,ph,r).addScaledVector(outV,flare*q+waveA*Math.sin(q*waveF+seed*6.283)*curl).add(new THREE.Vector3(0,-len*q,0)).addScaledVector(acrossV,waveA*Math.cos(q*waveF+seed*6.283)*curl);
      }
      tan.set(Math.cos(ph),0,-Math.sin(ph));
      const w=w0*(1-.55*t);
      p.sub(restPos);
      lp.push(p.x-tan.x*w,p.y,p.z-tan.z*w,p.x+tan.x*w,p.y,p.z+tan.z*w);
      lt.push(t,t);lu.push(0,1);ls.push(seed,seed);
      if(i>0){const a0=vbase+(i-1)*2;lidx.push(a0,a0+1,a0+2,a0+1,a0+3,a0+2);}
    }
    vbase+=LSTEPS*2;
  }
  // Second layer of hair (the 'wig'): locks that cover the parting and hairline at the forehead, and locks that
  // fall from the temples down over the front of the shoulders and chest.
  const wigRand=seeded(2711);
  const pushLock=(points,w0)=>{
    for(let i=0;i<points.length;i++){
      const {p,ph,t}=points[i];
      tan.set(Math.cos(ph),0,-Math.sin(ph));
      const w=w0*(1-.55*t);
      lp.push(p.x-tan.x*w,p.y,p.z-tan.z*w,p.x+tan.x*w,p.y,p.z+tan.z*w);
      lt.push(t,t);lu.push(0,1);ls.push(points.seed,points.seed);
      if(i>0){const a0=vbase+(i-1)*2;lidx.push(a0,a0+1,a0+2,a0+1,a0+3,a0+2);}
    }
    vbase+=points.length*2;
  };
  const HAIRLINE=isMobile?36:64,hlRand=seeded(3301);
  for(let k=0;k<HAIRLINE;k++){
    const side=k%2?1:-1,seed=hlRand(),r=1.06+hlRand()*.035,w0=.012+hlRand()*.008;
    const th0=.58+hlRand()*.18,th1=.90+hlRand()*.25,ph0=side*(.02+hlRand()*.30),ph1=side*(2.2+hlRand()*.5);
    const pts=[];pts.seed=seed;
    for(let i=0;i<LSTEPS;i++){const t=i/(LSTEPS-1),e=t*t*(3-2*t),ph=ph0+(ph1-ph0)*e;const p=scalp(th0+(th1-th0)*e,ph,r);p.sub(restPos);pts.push({p,ph,t:t*.6});}
    pushLock(pts,w0);
  }
  const COVER=isMobile?44:80,FRONT=0;
  for(let k=0;k<COVER+FRONT;k++){
    const side=k%2?1:-1,front=k>=COVER,seed=wigRand();
    const r=1.075+wigRand()*.04,w0=.011+wigRand()*.008;
    const ph0=front?side*(1.02+wigRand()*0.40):side*(0.04+wigRand()*0.34);
    const phEnd=front?ph0:side*(1.9+wigRand()*0.6);
    const thEnd=front?1.40+wigRand()*.25:0.80+wigRand()*.30;
    const len=front?.34+wigRand()*.16:.02+wigRand()*.04;
    const waveA=.016+wigRand()*.014,waveF=5+wigRand()*4,ts=front?.30:.48;
    const pts=[];pts.seed=seed;
    for(let i=0;i<LSTEPS;i++){
      const t=i/(LSTEPS-1);let p,ph;
      if(t<=ts){
        const u=t/ts,e=u*u*(3-2*u);
        ph=ph0+(phEnd-ph0)*e;
        p=scalp(.05+u*(thEnd-.05),ph,r);
      }else{
        const q=(t-ts)/(1-ts),curl=Math.min(1,q*2.2);ph=phEnd;
        // Front locks are pushed forward so they lie over the shoulders and chest.
        if(front)outV.set(Math.sin(ph)*.45,0,Math.cos(ph)+.65).normalize();
        else outV.set(Math.sin(ph),0,Math.cos(ph)*.6).normalize();
        acrossV.set(Math.cos(ph),0,-Math.sin(ph));
        const reach=front?.12:.05;const ramp=front?Math.min(1,Math.max(0,(q-.30)/.40)):Math.min(1,q*1.6);
        p=scalp(thEnd,ph,r).addScaledVector(outV,reach*ramp+waveA*Math.sin(q*waveF+seed*6.283)*curl).add(new THREE.Vector3(0,-len*q,0)).addScaledVector(acrossV,waveA*Math.cos(q*waveF+seed*6.283)*curl);
      }
      p.sub(restPos);
      pts.push({p,ph,t});
    }
    pushLock(pts,w0);
  }
  const lockGeo=new THREE.BufferGeometry();attr(lockGeo,'position',lp,3);attr(lockGeo,'aT',lt,1);attr(lockGeo,'aU',lu,1);attr(lockGeo,'aSeed',ls,1);lockGeo.setIndex(lidx);
  const lockMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uEnergy:energy},transparent:true,depthWrite:false,depthTest:true,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aT;attribute float aU;attribute float aSeed;uniform float uTime;varying float vT;varying float vU;varying float vS;
void main(){${SWAY}
  vT=aT;vU=aU;vS=aSeed;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);}`,
    fragmentShader:String.raw`varying float vT;varying float vU;varying float vS;uniform float uEnergy;
void main(){
  float edge=smoothstep(0.0,0.2,vU)*(1.0-smoothstep(0.8,1.0,vU));
  float strands=.55+.45*sin(vU*46.0+vS*31.0)*sin(vU*17.0+vT*9.0+vS*7.0);
  float tip=1.0-smoothstep(0.82,1.0,vT);
  float round=sin(vU*3.14159);
  float tone=.70+.45*fract(vS*7.31);
  float highlight=pow(max(0.0,sin(vT*18.0+vS*12.0)),6.0)*round;
  vec3 shadow=vec3(.04,.18,.62),light=vec3(.58,.84,1.0);
  vec3 col=mix(shadow,light,clamp(round*.65+strands*.25+(1.0-vT)*.10,0.0,1.0))*tone+vec3(.85,.96,1.0)*highlight*.45+vec3(.30,.62,1.0)*(.10+.08*round);
  float a=edge*tip*(.24+.18*strands);
  col+=vec3(.70,.90,1.0)*pow(1.0-round,3.0)*.8;
  if(a<.02)discard;
  gl_FragColor=vec4(col*(.85+.25*uEnergy),a);
}`});
  const hairLocks=new THREE.Mesh(lockGeo,lockMat);hairLocks.frustumCulled=false;hairLocks.renderOrder=3;
  owned.push(lockGeo,lockMat);

  const auraPlaneGeo=new THREE.PlaneGeometry(1.7,1.7);
  const auraPlaneMat=new THREE.ShaderMaterial({
    uniforms:{uTime:time,uEnergy:energy,uCognitiveTint:cognitiveTint},transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`varying vec2 vUv;void main(){vUv=uv*2.0-1.0;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:String.raw`uniform float uTime;uniform float uEnergy;uniform float uCognitiveTint;varying vec2 vUv;
float sq(float x){return x*x;}
void main(){
  float r=length(vUv);
  float a=atan(vUv.y,vUv.x);
  float ring1=exp(-sq((r-0.34)*30.0))*(0.92+0.08*sin(a*3.0-uTime*0.8));
  float ring2=exp(-sq((r-0.68)*12.0))*(0.5+0.5*cos(a*10.0+uTime*0.8));
  float coreGlow=exp(-r*r*7.5);
  float radialFade=1.0-smoothstep(0.65,1.0,r);
  float alpha=(coreGlow*0.15+exp(-r*r*2.2)*0.045)*(0.85+0.30*uEnergy)*radialFade;
  vec3 baseCol=mix(vec3(.08,.30,.92),vec3(.96,.72,.30),uCognitiveTint*0.45);
  gl_FragColor=vec4(mix(baseCol,vec3(.78,.93,1.0),coreGlow),alpha);
}`
  });
  const auraBackdrop=new THREE.Mesh(auraPlaneGeo,auraPlaneMat);
  auraBackdrop.position.set(0,1.61,distantField?-1.8:-0.16);
  auraBackdrop.renderOrder=-2;
  scene.add(auraBackdrop);

  const texture=glowTexture();
  const sprite=(scale,opacity,color=0xffffff,depthTest=false)=>{
    const m=new THREE.SpriteMaterial({map:texture,color,transparent:true,opacity,blending:THREE.AdditiveBlending,depthTest,depthWrite:false});
    owned.push(m);const s=new THREE.Sprite(m);s.scale.setScalar(scale);return s;
  };
  const hair=new THREE.Group();
  const halo=sprite(.95,.30,0x5aa0ff,true);halo.position.copy(C).sub(restPos).add(new THREE.Vector3(0,-.03,-.09));
  const crown=sprite(.20,.32,0xcfe6ff);crown.position.set(C.x,top+.055,C.z).sub(restPos);
  hair.add(halo,hairLocks,lines,sparks,crown);scene.add(hair);

  const eyeCore=[sprite(.008,.60,0xb8f6ff),sprite(.008,.60,0xb8f6ff)];
  const eyeHalo=[sprite(.032,.34,0x45d6ff),sprite(.032,.34,0x45d6ff)];
  scene.add(...eyeCore,...eyeHalo);
  // A soft veil of light over neck, shoulders and chest binds head, hair and body into one glowing form.
  const veilChest=sprite(.82,.30,0x7cc4ff),veilNeck=sprite(.36,.14,0xb8dcff),chestCore=sprite(.26,.40,0xeaf6ff);
  veilChest.position.set(0,1.32,.18);veilNeck.position.set(0,1.46,.14);chestCore.position.set(0,1.34,.20);
  scene.add(veilChest,veilNeck,chestCore);
  const orbitPts=[];for(let i=0;i<96;i++){const a=i/96*Math.PI*2;orbitPts.push(new THREE.Vector3(Math.cos(a)*.31,1.33+Math.sin(a)*.11,.02+Math.sin(a)*.24));}
  const orbitCurve=new THREE.CatmullRomCurve3(orbitPts,true);
  const orbitGeo=new THREE.TubeGeometry(orbitCurve,240,.0036,6,true);
  const orbitGlowGeo=new THREE.TubeGeometry(orbitCurve,240,.012,8,true);
  const orbitMat=new THREE.MeshBasicMaterial({color:0x7cc8ff,transparent:true,opacity:.85,blending:THREE.AdditiveBlending,depthWrite:false});
  const orbit=new THREE.Mesh(orbitGeo,orbitMat);orbit.rotation.z=-.10;orbit.renderOrder=4;
  const orbitGlowMat=new THREE.MeshBasicMaterial({color:0x3f9dff,transparent:true,opacity:.16,blending:THREE.AdditiveBlending,depthWrite:false});
  orbit.add(new THREE.Mesh(orbitGlowGeo,orbitGlowMat));scene.add(orbit);owned.push(orbitGeo,orbitMat,orbitGlowGeo,orbitGlowMat);

  const starCount=isMobile?180:340;
  const starPos=[],starTw=[],starSeed=seeded(4242);
  for(let i=0;i<starCount;i++){
    const depth=starSeed();
    const zLayer=i<50?.15+depth*.22:distantField?-1.25-depth*2.2:-.45-depth*.30;
    starPos.push((starSeed()-.5)*1.15,1.04+starSeed()*.96,zLayer);
    starTw.push(starSeed());
  }
  const starGeo=new THREE.BufferGeometry();attr(starGeo,'position',starPos,3);attr(starGeo,'aTw',starTw,1);
  const starMat=new THREE.ShaderMaterial({uniforms:{uTime:time,uPixelRatio:pixelRatio},transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,
    vertexShader:String.raw`attribute float aTw;uniform float uTime;uniform float uPixelRatio;varying float vA;
void main(){
  vec3 pos=position;
  float drift=uTime*(.015+aTw*.024)+aTw*6.28;
  pos.y+=mod(drift,0.22)-0.11;
  pos.x+=sin(drift*2.4)*0.012;
  vA=(.22+.64*aTw)*(.55+.45*sin(uTime*(.7+aTw*1.9)+aTw*50.0));
  float distanceScale=clamp(2.0/(1.05-pos.z),.48,1.0);
  gl_PointSize=(0.9+2.4*aTw*aTw)*uPixelRatio*distanceScale;
  vA*=distanceScale;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.0);
}`,
    fragmentShader:String.raw`varying float vA;void main(){float d=length(gl_PointCoord-vec2(.5));gl_FragColor=vec4(.80,.93,1.0,(1.0-smoothstep(0.0,.5,d))*vA);}`});
  const starField=new THREE.Points(starGeo,starMat);starField.frustumCulled=false;starField.visible=stars;scene.add(starField);
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
      crown.material.opacity=0;
      veilChest.material.opacity=.28+.06*Math.sin(t*.9)+.08*energyValue;chestCore.material.opacity=.36+.10*Math.sin(t*1.4)+.10*energyValue;veilNeck.material.opacity=.09+.03*Math.sin(t*1.3+1.0)+.05*energyValue;orbitMat.opacity=.70+.15*Math.sin(t*1.2)+.10*energyValue;
      halo.material.opacity=.11+.055*energyValue+.015*Math.sin(t*1.2);

      sums[0].set(0,0,0);sums[1].set(0,0,0);counts[0]=counts[1]=0;
      const vs=eyeGroup.vertices;
      for(let i=0;i<vs.length;i+=3){const s=vs[i]>hp.x?0:1;sums[s].x+=vs[i];sums[s].y+=vs[i+1];sums[s].z+=vs[i+2];counts[s]++;}
      const open=1-.96*blink;
      for(let s=0;s<2;s++){
        if(!counts[s])continue;
        sums[s].divideScalar(counts[s]).z+=.012;
        eyeCore[s].position.copy(sums[s]);eyeHalo[s].position.copy(sums[s]);
        eyeCore[s].material.opacity=.60*open;
        eyeHalo[s].material.opacity=(.30+.14*energyValue)*open;
      }
    },
    dispose(){scene.remove(hair,starField,auraBackdrop,veilChest,veilNeck,chestCore,orbit,...eyeCore,...eyeHalo);owned.forEach(o=>o.dispose());}
  };
}

function disposeModel(model){
  const geometries=new Set(),materials=new Set(),skeletons=new Set(),textures=new Set();
  model?.traverse(o=>{
    if(o.geometry)geometries.add(o.geometry);
    if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));
    if(o.skeleton)skeletons.add(o.skeleton);
  });
  geometries.forEach(g=>g.dispose());materials.forEach(m=>{for(const value of Object.values(m))if(value?.isTexture)textures.add(value);m.dispose();});textures.forEach(t=>t.dispose());skeletons.forEach(s=>s.dispose());
}

/**
 * GPU point drawing; exact zero-allocation CPU interpolation of vertices after real morph and skin transforms.
 * @param {HTMLCanvasElement} canvas
 * @param {{signal?: AbortSignal, onError?: (error: unknown) => void, relaxedGaze?: boolean, trackPointer?: boolean, leadWithEyes?: boolean, distantField?: boolean, stars?: boolean}} [options]
 */
export async function createAuraRigLightform(canvas,{signal,onError,relaxedGaze=true,trackPointer=true,leadWithEyes=false,distantField=false,stars=true}={}){
  const {gltf,anatomical}=await loadAvatar(signal);
  const model=gltf.scene;
  let renderer,geometry,material,observer,domTelemetryObserver,lightBody,voiceTracker,qualityGovernor,behaviorEngine,secondaryRig,raf=0,disposed=false;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let cleanup=()=>{};
  try{
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const bones=new Map();model.traverse(o=>{if(o.isBone)bones.set(o.name,{bone:o,base:o.quaternion.clone()});});
    const names=['Head','Neck','Spine2','LeftShoulder','RightShoulder','PonytailRoot','Ponytail1','Ponytail2','Ponytail3'];
    if(names.some(n=>!bones.has(n)))throw Error('AURA_RIG_BONES');
    const morphs=[];model.traverse(o=>{if(o.isSkinnedMesh&&o.morphTargetDictionary)morphs.push(o);});
    const required=['eyeBlinkLeft','eyeBlinkRight','jawOpen','mouthSmileLeft','mouthSmileRight','browInnerUp','viseme_aa','viseme_O'];
    if(anatomical)required.push(...VISEMES.filter(n=>!required.includes(n)),'mouthClose','mouthPressLeft','mouthPressRight');
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
    const groups=anatomical?[]:createSamples(model,isMobile?.64:1);
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
    cloud.frustumCulled=false;if(!anatomical)scene.add(cloud);

    const camera=new THREE.PerspectiveCamera(31,1,.03,20);
    camera.position.set(0,1.570,1.05);camera.lookAt(0,1.540,.03);
    renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power',preserveDrawingBuffer:true});
    renderer.setClearColor(0x000000,0);

    if(anatomical){
      // Render the authored GLB materials and meshes in the SAME portrait camera/canvas.
      // Reuse the existing pose, morph, voice and cognitive-state logic below.
      model.traverse(o=>{if(o.isSkinnedMesh)o.frustumCulled=false;});
      scene.add(model);
      const optics=createV31OpticalRig(scene,model,renderer);
      lightBody={
        update(_t,_e,_b,_s,_q,_d,_p,dt,reduced){
          const status=optics.update(dt,reduced);
          canvas.dataset.eyePupilScale=status.pupilScale.toFixed(3);
          canvas.dataset.eyePupilShader=status.pupilReady?'configured':'unavailable';
          canvas.dataset.studioEnvironment=status.environmentReady?'configured':'unavailable';
          canvas.dataset.opticalSurfaceCount=String(status.surfaceCount);
          canvas.dataset.skinDetailShader=status.skinDetailReady?'configured':'unavailable';
          canvas.dataset.hairDetailShader=status.hairDetailReady?'configured':'unavailable';
        },
        dispose(){optics.dispose();}
      };
    }else{
      lightBody=createLightBody(scene,model,bones,groups,isMobile,distantField,stars);
    }
    voiceTracker=createVoiceFormantTracker();
    qualityGovernor=createQualityGovernor(isMobile);
    behaviorEngine=createBehaviorEngine();
    const bodyRig=anatomical?createAuraBodyRig(model,bones):null;
    const human=anatomical?createHumanBehavior():null;
    secondaryRig=anatomical?createSecondaryRig(scene,model,bones,renderer,isMobile):null;

    // Pre-allocated spring state objects (zero array allocations per frame)
    const yawSpring={val:0,vel:0};
    const pitchSpring={val:0,vel:0};
    const rollSpring={val:0,vel:0};
    const stepSpring=(s,target,omega,dt)=>{
      const f=1+2*dt*omega,oo=omega*omega,hoo=dt*oo,hhoo=dt*hoo,detInv=1/(f+hhoo);
      const nextVal=(f*s.val+dt*s.vel+hhoo*target)*detInv;
      s.vel=(s.vel+hoo*(target-s.val))*detInv;
      s.val=nextVal;
    };

    let energy=0,gazeX=0,gazeY=0,smoothJaw=0;
    const speechPose=emptySpeechPose(),speechTarget=emptySpeechPose(),naturalBlink=createNaturalBlink();
    let speechAccent=0,previousSpeechLevel=0;
    let listeningSince=0, previousYaw=0;
    let smoothAA=0,smoothO=0,smoothE=0,smoothU=0,decisionBlend=0,pupilSize=0.31;
    let pointerX=0,pointerY=0,camX=0,camY=0,busPhase=null;
    let last=-Infinity,lastStepTime=0;
    let state={
      active:false,speaking:false,listening:false,
      cognitivePhase:null,
      x:0,y:0,audioLevel:null,phonemes:null,speechPlayback:null
    };
    const temp=new THREE.Vector3(),q=new THREE.Quaternion(),euler=new THREE.Euler(0,0,0,'YXZ');
    const rotate=(name,x,y,z)=>{const entry=bones.get(name);if(!entry)return;entry.bone.quaternion.copy(entry.base).multiply(q.setFromEuler(euler.set(x,y,z,'YXZ')));};
    const assign=(name,value)=>{
      const safeVal=finiteClamp(value,0,1,0);
      for(let m=0;m<morphs.length;m++){
        const o=morphs[m],idx=o.morphTargetDictionary[name];
        if(idx!==undefined)o.morphTargetInfluences[idx]=safeVal;
      }
    };

    const onPointerMove=e=>{
      if(!trackPointer||motion.matches)return;
      const rect=canvas.getBoundingClientRect();
      if(!rect.width||!rect.height)return;
      const nx=((e.clientX-rect.left)/rect.width)*2-1;
      const ny=((e.clientY-rect.top)/rect.height)*2-1;
      if(Math.abs(nx)<=1.8&&Math.abs(ny)<=1.8){
        pointerX=clamp(nx,-1,1)*0.22;
        pointerY=clamp(-ny,-1,1)*0.14;
      }
    };

    const onMissionEvent=e=>{
      const d=e?.detail;
      if(!d)return;
      if(typeof d.cognitivePhase==='string')busPhase=d.cognitivePhase;
      else if(d.state==='blocked'||d.pendingDecisions>0)busPhase='awaiting_decision';
      else if(d.phase==='verify'||d.tool==='repo-read'||d.tool==='git_diff')busPhase='verifying';
      else if(d.running)busPhase='analyzing';
      else busPhase=null;
    };

    // Automatic DOM Telemetry Bridge: reads real JACO CognitiveWorkspace attributes without requiring CustomEvent producers
    const pollWorkspaceTelemetry=()=>{
      if(typeof document==='undefined')return;
      const missionEl=document.querySelector('[data-mission-state]');
      const mState=missionEl?.getAttribute('data-mission-state');
      if(mState==='blocked'){busPhase='awaiting_decision';return;}
      const pulseEl=document.querySelector('.aura-activity-pulse');
      const isPulseActive=pulseEl?.getAttribute('data-active')==='true';
      const latestStepText=document.querySelector('.aura-presence-step')?.textContent||'';
      if(isPulseActive||mState==='running'){
        if(/read|diff|test|verify|check|inspect/i.test(latestStepText))busPhase='verifying';
        else busPhase='analyzing';
      }else if(busPhase==='awaiting_decision'||busPhase==='verifying'||busPhase==='analyzing'){
        busPhase=null;
      }
    };

    if(typeof MutationObserver!=='undefined'&&typeof document!=='undefined'){
      const rootEl=document.querySelector('[data-cognitive-workspace]')||document.body;
      if(rootEl){
        domTelemetryObserver=new MutationObserver(pollWorkspaceTelemetry);
        domTelemetryObserver.observe(rootEl,{attributes:true,subtree:true,attributeFilter:['data-mission-state','data-active','data-mode']});
        pollWorkspaceTelemetry();
      }
    }

    const pose=time=>{
      const still=motion.matches,t=still?0:time/1000;
      const rawDt=lastStepTime?(time-lastStepTime):33.33;
      const dt=clamp(rawDt/1000,0.008,0.06);
      lastStepTime=time;

      const qualityTier=qualityGovernor.update(rawDt,time);
      const phase=behaviorEngine.resolvePhase(state,busPhase);
      const isAnalyzing=phase==='analyzing';
      const isVerifying=phase==='verifying';
      const isDecision=phase==='awaiting_decision';

      decisionBlend=still?Number(isDecision):decisionBlend+(Number(isDecision)-decisionBlend)*0.08;
      material.uniforms.uDecisionMode.value=decisionBlend;

      const liveFormants=voiceTracker.sample();
      const hasExternalLevel=typeof state.audioLevel==='number'&&Number.isFinite(state.audioLevel);
      const playback=anatomical?state.speechPlayback:null;
      const timed=Boolean(playback&&validSpeechTimeline(playback.timeline)&&playback.audio);
      const playing=Boolean(timed&&state.speaking&&!playback.audio.paused&&!playback.audio.ended&&!still);
      if(timed){sampleSpeechPose(playback.timeline,playing?playback.audio.currentTime:NaN,speechTarget);}
      else sampleSpeechPose(null,NaN,speechTarget);
      if(still){sampleSpeechPose(null,NaN,speechPose);}else approachSpeechPose(speechPose,speechTarget,dt);
      const currentAudioLevel=timed?speechTarget.level:(liveFormants?liveFormants.level:(hasExternalLevel?finiteClamp(state.audioLevel,0,1,0):0));

      const activeSignal=Number(state.active||state.speaking||state.listening||isAnalyzing||isVerifying)+currentAudioLevel*0.48;
      energy=still?Number(state.active):energy+(activeSignal-energy)*.08;

      const verifyScanX=isVerifying&&!still?0.08*Math.sin(t*2.8):0;
      const analyzeTilt=isAnalyzing&&!still?0.045:0;

      const organicYaw=.125*Math.sin(t*.41)+.058*Math.sin(t*.17+1.3)+.022*Math.sin(t*.97);
      const organicPitch=.036*Math.sin(t*.59+.4)+.020*Math.cos(t*.23)+.011*Math.sin(t*1.25);
      const organicRoll=.032*Math.sin(t*.35+.8)+.015*Math.cos(t*.79);

      const inputX=Math.abs(state.x)>0.01?finiteClamp(state.x,-1,1,0):pointerX;
      const inputY=Math.abs(state.y)>0.01?finiteClamp(state.y,-1,1,0):pointerY;

      const humanPose=human?.update({presentationTone:state.presentationTone,phase,active:state.active,speaking:state.speaking,listening:state.listening,level:currentAudioLevel,x:inputX,y:inputY},dt,still);
      const contact=leadWithEyes&&state.listening&&!still;
      const contactAge=contact?Math.max(0,t-listeningSince):0;
      const follow=smoothstep(.22,.90,contactAge);
      const idleYaw=clamp(inputX,-1,1)*.36+organicYaw+verifyScanX*.35;
      const targetYaw=still?0:humanPose?humanPose.headYaw:contact?previousYaw*(1-follow)+idleYaw*.12*follow:idleYaw;
      const targetPitch=still?0:humanPose?humanPose.headPitch:clamp(inputY,-1,1)*.16+organicPitch+(state.listening?.032:0)-(isAnalyzing?.025:0);
      const targetRoll=still?0:humanPose?humanPose.headRoll:organicRoll-targetYaw*.15+(state.listening?.042:0)+analyzeTilt;

      if(still){
        yawSpring.val=yawSpring.vel=pitchSpring.val=pitchSpring.vel=rollSpring.val=rollSpring.vel=camX=camY=0;
      }else{
        stepSpring(yawSpring,targetYaw,3.1,dt);
        stepSpring(pitchSpring,targetPitch,3.5,dt);
        stepSpring(rollSpring,targetRoll,2.7,dt);
        camX+=(yawSpring.val*0.038-camX)*0.08;
        camY+=(pitchSpring.val*0.025-camY)*0.08;
      }
      const yaw=yawSpring.val,pitch=pitchSpring.val,roll=rollSpring.val;
      camera.position.set(camX,1.570+camY,1.05);
      camera.lookAt(0,1.540,.03);

      const breathPhase=t*1.15;
      const breath=still?0:humanPose?humanPose.breath:Math.sin(breathPhase)+.24*Math.sin(breathPhase*2.0-.55);
      rotate('Spine2',still?0:.021*breath,yaw*.16,roll*.24);
      rotate('Neck',pitch*.36-.008*breath,yaw*.28,roll*.34);
      rotate('Head',pitch*.72+(!anatomical&&state.speaking&&!still?.018*Math.sin(t*3.9)*clamp(smoothJaw*2.5,0.2,1.0):0),yaw*.76,roll*.64);
      rotate('LeftShoulder',still?0:.016*breath,0,-.009*breath);
      rotate('RightShoulder',still?0:.016*breath+.003,0,.009*breath);

      if(!secondaryRig)for(let j=0;j<4;j++){
        const lag=j*.46;
        rotate(j?'Ponytail'+j:'PonytailRoot',
          still?0:humanPose?humanPose.hairPitch*(1+j*.18):.046*Math.sin(t*1.14-lag)-pitch*.13,
          still?0:humanPose?humanPose.hairYaw*(1+j*.18):.076*Math.sin(t*.96-lag)-yaw*.19,
          still?0:-roll*.22
        );
      }

      const blinkCycle=t%5.3;
      const b1=smoothstep(1.98,2.06,blinkCycle)*(1-smoothstep(2.06,2.23,blinkCycle));
      const b2=smoothstep(2.32,2.39,blinkCycle)*(1-smoothstep(2.39,2.54,blinkCycle))*.84;
      const blink=still?0:anatomical?naturalBlink(t,currentAudioLevel):Math.max(b1,b2);

      // V31 never pretends that the synthetic cadence is a measured phoneme.
      const canUseFallback=!anatomical||Boolean(liveFormants||hasExternalLevel||state.phonemes);
      const visemes=behaviorEngine.computeVisemes(t,still||timed||!canUseFallback,state,liveFormants,hasExternalLevel);
      smoothJaw=timed?speechPose.jaw:still?0:finiteClamp(smoothJaw+(visemes.jaw-smoothJaw)*(anatomical?1-Math.exp(-dt/.035):.32),0,1,0);
      if(anatomical){const rise=Math.max(0,currentAudioLevel-previousSpeechLevel);speechAccent=Math.max(speechAccent*Math.exp(-dt/0.18),state.speaking?Math.min(1,rise*2.2):0);previousSpeechLevel=currentAudioLevel;}
      smoothAA=still?0:finiteClamp(smoothAA+(visemes.aa-smoothAA)*.30,0,1,0);
      smoothO=still?0:finiteClamp(smoothO+(visemes.O-smoothO)*.30,0,1,0);
      smoothE=still?0:finiteClamp(smoothE+(visemes.E-smoothE)*.28,0,1,0);
      smoothU=still?0:finiteClamp(smoothU+(visemes.U-smoothU)*.28,0,1,0);

      const targetPupil=0.30+(isAnalyzing?0.065:0)+(state.listening?0.045:0)+0.03*energy+0.02*Math.sin(t*0.7);
      pupilSize=still?0.32:pupilSize+(targetPupil-pupilSize)*0.12;

      const smile=humanPose?humanPose.smile:still?.09:.09+.045*(1+Math.sin(t*.72))+.04*energy-(isAnalyzing?.03:0);
      const microSaccadeX=still?0:(isVerifying?verifyScanX:(.032*Math.sin(t*2.05)+.018*Math.cos(t*4.9)));
      const microSaccadeY=still?0:.022*Math.cos(t*1.75)-(isVerifying?.03:0);
      const gazeWeight=relaxedGaze&&state.listening?.15:1;
      const eyeTarget=humanPose?humanPose.eyeX:contact?clamp(-yaw*1.8+microSaccadeX*.05,-.55,.55):(yaw*.44+microSaccadeX)*gazeWeight;
      gazeX=still?0:gazeX+(eyeTarget-gazeX)*(humanPose?1-Math.exp(-dt/.045):contact?1-Math.exp(-dt*24):.24);
      gazeY=still?0:gazeY+((humanPose?humanPose.eyeY:(pitch*.46+microSaccadeY)*gazeWeight)-gazeY)*(humanPose?1-Math.exp(-dt/.045):.24);

      const squint=still?0:humanPose?humanPose.cheek:finiteClamp(smile*.45+visemes.cheek+(isAnalyzing?.14:0),0,.38,0);

      const lid=anatomical?blink:(relaxedGaze?.18+.82*blink:blink);
      assign('eyeBlinkLeft',lid);assign('eyeBlinkRight',lid);
      assign('eyeSquintLeft',squint);assign('eyeSquintRight',squint);
      assign('cheekSquintLeft',squint*.7);assign('cheekSquintRight',squint*.7);
      assign('jawOpen',smoothJaw);
      if(anatomical){
        // The GLB has the full Oculus set, including teeth/tongue morphs.
        for(let i=0;i<VISEMES.length;i++){
          let value=timed?speechPose.weights[i]:0;
          if(!timed){if(i===0)value=smoothAA*.65;else if(i===1)value=smoothE*.65;else if(i===3)value=smoothO*.65;else if(i===4)value=smoothU*.65;}
          assign(VISEMES[i],value);
        }
        assign('mouthClose',timed?speechPose.close:0);
        assign('mouthPressLeft',timed?speechPose.press:0);assign('mouthPressRight',timed?speechPose.press:0);
        assign('mouthSmileLeft',smile);assign('mouthSmileRight',smile*.88);
        assign('browInnerUp',humanPose?.brow??0);
        assign('browOuterUpLeft',(humanPose?.brow??0)*.62);
        assign('browOuterUpRight',(humanPose?.brow??0)*.48);
        // Eyelids track vertical gaze without stacking on a closed blink.
        assign('eyeWideLeft',still?0:Math.max(0,gazeY)*.25*(1-blink));
        assign('eyeWideRight',still?0:Math.max(0,gazeY)*.25*(1-blink));
        canvas.dataset.humanBehavior=humanPose?.mode||'idle';
        canvas.dataset.speechAccent=(humanPose?.accent||0).toFixed(3);
        assign('noseSneerLeft',0);assign('noseSneerRight',0);
        canvas.dataset.speechMotion=timed?'pcm-viseme-experimental':liveFormants?'audio-formant-fallback':hasExternalLevel||state.phonemes?'explicit-input':'no-audio-analysis';
      }else{
        assign('viseme_aa',smoothAA);
        assign('viseme_O',smoothO);
        assign('viseme_E',smoothE);
        assign('viseme_U',smoothU);
        assign('mouthSmileLeft',smile);assign('mouthSmileRight',smile);
        assign('browInnerUp',still?0:.05+.15*energy*(.5+.5*Math.sin(t*1.25))+smoothJaw*.15+(isDecision?.14:0));
        assign('browOuterUpLeft',still?0:.03+.08*energy*(.5+.5*Math.cos(t*1.1)));
        assign('browOuterUpRight',still?0:.03+.08*energy*(.5+.5*Math.cos(t*1.1)));
        assign('noseSneerLeft',smoothJaw*.12);assign('noseSneerRight',smoothJaw*.12);
      }
      assign('eyeLookInLeft',Math.max(0,gazeX));assign('eyeLookOutLeft',Math.max(0,-gazeX));
      assign('eyeLookOutRight',Math.max(0,gazeX));assign('eyeLookInRight',Math.max(0,-gazeX));
      assign('eyeLookUpLeft',Math.max(0,gazeY));assign('eyeLookDownLeft',Math.max(0,-gazeY));
      assign('eyeLookUpRight',Math.max(0,gazeY));assign('eyeLookDownRight',Math.max(0,-gazeY));

      const bodyPose=bodyRig?.update(dt,still,humanPose);
      if(bodyPose){
        const wide=bodyPose.wide,offset=bodyPose.rootZ;
        camera.position.set(camX*(1-wide),1.570+camY+(0.89-1.570-camY)*wide,1.05+(4.0/Math.min(1,camera.aspect)-1.05)*wide);
        camera.lookAt(0,1.540+(.87-1.540)*wide,.03+.18*wide);
        canvas.dataset.bodyAction=bodyPose.action||'idle';
        canvas.dataset.bodyTravel=offset.toFixed(3);
        canvas.dataset.bodyFrame=wide.toFixed(3);
      }
      if(secondaryRig){
        const secondary=secondaryRig.update({yaw,pitch,z:bodyPose?.rootZ||0,flex:Math.max(bodyPose?.gesture||0,Math.abs(bodyPose?.swing||0)*3),wide:bodyPose?.wide||0,quality:qualityTier,leftLift:bodyPose?.leftLift||0,rightLift:bodyPose?.rightLift||0},rawDt/1000,still);
        canvas.dataset.hairSway=[secondary.front,secondary.back,secondary.side].map(x=>x.toFixed(3)).join(',');
        canvas.dataset.hairMorphMeshes=String(secondary.hairMeshes);
        canvas.dataset.textileResponseMaterials=String(secondary.textileMaterials);
        canvas.dataset.groundContact=String(secondary.ground);
        canvas.dataset.floorReflection=secondary.reflection?'planar':'adaptive-fallback';
      }
      model.updateMatrixWorld(true);

      let cursor=0;
      for(let g=0;g<groups.length;g++){
        const group=groups[g];
        const {mesh,vertices,indices,flatIds,flatWeights}=group;
        const idxCount=indices.length;
        for(let k=0;k<idxCount;k++){
          mesh.getVertexPosition(indices[k],temp).applyMatrix4(mesh.matrixWorld);
          const vBase=k*3;
          vertices[vBase]=temp.x;vertices[vBase+1]=temp.y;vertices[vBase+2]=temp.z;
        }
        const sampleLen=flatIds.length;
        for(let s=0;s<sampleLen;s+=3){
          const ia=flatIds[s],ib=flatIds[s+1],ic=flatIds[s+2];
          const wa=flatWeights[s],wb=flatWeights[s+1],wc=flatWeights[s+2];
          const ax=vertices[ia],ay=vertices[ia+1],az=vertices[ia+2];
          const bx=vertices[ib],by=vertices[ib+1],bz=vertices[ib+2];
          const cx=vertices[ic],cy=vertices[ic+1],cz=vertices[ic+2];

          positions[cursor]=wa*ax+wb*bx+wc*cx;
          positions[cursor+1]=wa*ay+wb*by+wc*cy;
          positions[cursor+2]=wa*az+wb*bz+wc*cz;

          const e1x=bx-ax,e1y=by-ay,e1z=bz-az;
          const e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
          const nx=e1y*e2z-e1z*e2y;
          const ny=e1z*e2x-e1x*e2z;
          const nz=e1x*e2y-e1y*e2x;
          const invLen=1/Math.max(1e-10,Math.hypot(nx,ny,nz));
          normals[cursor]=nx*invLen;
          normals[cursor+1]=ny*invLen;
          normals[cursor+2]=nz*invLen;
          cursor+=3;
        }
      }
      geometry.attributes.position.needsUpdate=true;geometry.attributes.aNormal.needsUpdate=true;
      material.uniforms.uTime.value=t;material.uniforms.uEnergy.value=energy;
      lightBody.update(t,energy,blink,finiteClamp(smoothJaw*2.0,0,1,0),qualityTier,decisionBlend,pupilSize,dt,still);

      let signature=0;for(let j=0;j<Math.min(positions.length,6000);j+=31)signature+=positions[j]*(j+1);
      canvas.dataset.renderedPoints=String(total);canvas.dataset.renderer=anatomical?'rigged-anatomical-v31':'rigged-particle-field';
      canvas.dataset.avatarVersion=anatomical?'V31':'lightform';
      canvas.dataset.hairPoints=String(groups.find(g=>g.kind===2)?.samples.length??0);
      canvas.dataset.torsoPoints=String(groups.find(g=>g.kind===1)?.samples.length??0);
      canvas.dataset.yaw=yaw.toFixed(4);canvas.dataset.blink=blink.toFixed(4);canvas.dataset.jaw=smoothJaw.toFixed(4);
      if(anatomical){
        // Measure the deformed geometry rather than synthesizing a motion receipt from state.
        signature=0;
        for(let p=0;p<probes.length;p++){
          face.getVertexPosition(probes[p].vertex,temp).applyMatrix4(face.matrixWorld);
          signature+=(temp.x*3+temp.y*5+temp.z*7)*(p+1);
        }
      }
      canvas.dataset.geometrySignature=signature.toFixed(5);
      canvas.dataset.blinkMm=displacement(probes[0]).toFixed(3);
      canvas.dataset.jawMm=displacement(probes[1]).toFixed(3);
      canvas.dataset.cognitivePhase=phase;
      canvas.dataset.qualityTier=qualityTier>0.5?'high':'mobile-adaptive';
      canvas.dataset.audioConnected=String(voiceTracker.isConnected());
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
      if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer?.disconnect();domTelemetryObserver?.disconnect();
      window.removeEventListener('pointermove',onPointerMove);
      window.removeEventListener('jaco:mission-state',onMissionEvent);
      window.removeEventListener('jaco:cognitive-phase',onMissionEvent);
      motion.removeEventListener('change',refresh);document.removeEventListener('visibilitychange',refresh);
      canvas.removeEventListener('webglcontextlost',lost);signal?.removeEventListener('abort',dispose);
      voiceTracker?.dispose();secondaryRig?.dispose();lightBody?.dispose();geometry.dispose();material.dispose();renderer.dispose();disposeModel(model);
    }
    cleanup=dispose;
    window.addEventListener('pointermove',onPointerMove,{passive:true});
    window.addEventListener('jaco:mission-state',onMissionEvent);
    window.addEventListener('jaco:cognitive-phase',onMissionEvent);
    canvas.addEventListener('webglcontextlost',lost);
    signal?.addEventListener('abort',dispose,{once:true});
    observer=new ResizeObserver(resize);observer.observe(canvas);
    motion.addEventListener('change',refresh);document.addEventListener('visibilitychange',refresh);
    resize();refresh();
    return {
      setState(next){
        if(next&&'audioSource' in next){
          if(next.audioSource)voiceTracker.attach(next.audioSource);
          else voiceTracker.dispose();
        }
        if(leadWithEyes&&next?.listening&&!state.listening){
          listeningSince=performance.now()/1000;
          previousYaw=yawSpring.val;
        }
        state={...state,...next};
        if(motion.matches)render(0);
      },
      requestMotion(action){if(disposed||document.hidden||motion.matches||!bodyRig?.request(action))return false;human?.cue(action);return true;},
      attachAudio(audioSource){return voiceTracker.attach(audioSource);},
      dispose
    };
  }catch(error){
    if(!disposed){cleanup();if(!disposed){disposed=true;voiceTracker?.dispose();secondaryRig?.dispose();lightBody?.dispose();geometry?.dispose();material?.dispose();renderer?.dispose();disposeModel(model);}}
    throw error;
  }
}
