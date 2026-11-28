import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

export const V31_BYTES=45304080;
export const V31_SHA256='ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129';
export function inspectV31(bytes){
  if(bytes.length!==V31_BYTES||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('AURA_V31_HEADER_OR_SIZE');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(sha256!==V31_SHA256)throw Error('AURA_V31_SHA256');
  const size=bytes.readUInt32LE(12),end=20+size;
  if(bytes.toString('ascii',16,20)!=='JSON'||end+8>bytes.length||bytes.toString('ascii',end+4,end+8)!=='BIN\0'||end+8+bytes.readUInt32LE(end)!==bytes.length)throw Error('AURA_V31_CHUNKS');
  const j=JSON.parse(bytes.toString('utf8',20,end));
  if(j.asset?.version!=='2.0'||j.extensionsRequired?.length)throw Error('AURA_V31_GLTF');
  const requiredBones=['Head','Neck','Spine2','LeftShoulder','RightShoulder','PonytailRoot','Ponytail1','Ponytail2','Ponytail3','Hips','LeftArm','LeftForeArm','LeftHand','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot'];
  const requiredMorphs=['eyeBlinkLeft','eyeBlinkRight','jawOpen','mouthSmileLeft','mouthSmileRight','browInnerUp','viseme_aa','viseme_O','viseme_E','viseme_U','viseme_I','viseme_PP','viseme_SS','viseme_TH','viseme_DD','viseme_FF','viseme_kk','viseme_nn','viseme_RR','viseme_CH','mouthClose','mouthPressLeft','mouthPressRight','cheekSquintLeft','cheekSquintRight','browOuterUpLeft','browOuterUpRight'];
  const names=new Set((j.skins||[]).flatMap(s=>s.joints.map(i=>j.nodes[i]?.name)));
  if(requiredBones.some(n=>!names.has(n)))throw Error('AURA_V31_BONES');
  const skinned=(j.nodes||[]).filter(n=>Number.isInteger(n.skin)&&Number.isInteger(n.mesh));
  const face=skinned.map(n=>j.meshes[n.mesh]).find(m=>requiredMorphs.every(n=>m.extras?.targetNames?.includes(n)));
  if(!face)throw Error('AURA_V31_MORPHS');
  const binStart=end+8;
  // Validate actual dense or sparse float POSITION deltas rather than trusting morph labels.
  for(const name of requiredMorphs){
    const idx=face.extras.targetNames.indexOf(name);
    let nonzero=false;
    for(const primitive of face.primitives){
      const a=j.accessors[primitive.targets?.[idx]?.POSITION];
      if(!a||a.componentType!==5126||a.type!=='VEC3')continue;
      const checkRange=(viewIndex,offset,count,stride,width)=>{
        const v=j.bufferViews[viewIndex];
        if(!v||v.buffer!==0||!Number.isInteger(count)||count<1||offset<0)throw Error('AURA_V31_ACCESSOR_LAYOUT');
        const start=binStart+(v.byteOffset||0)+offset;
        if(start+(count-1)*stride+width>Math.min(bytes.length,binStart+(v.byteOffset||0)+v.byteLength))throw Error('AURA_V31_ACCESSOR_BOUNDS');
        return start;
      };
      const sparse=a.sparse;
      let start,stride,count;
      if(sparse){
        count=sparse.count;stride=12;
        if(count>a.count)throw Error('AURA_V31_SPARSE_COUNT');
        const type=sparse.indices.componentType,width=({5121:1,5123:2,5125:4})[type];
        if(!width)throw Error('AURA_V31_SPARSE_INDEX_TYPE');
        const ix=checkRange(sparse.indices.bufferView,sparse.indices.byteOffset||0,count,width,width);
        let previous=-1;
        for(let i=0;i<count;i++){
          const index=bytes.readUIntLE(ix+i*width,width);
          if(index<=previous||index>=a.count)throw Error('AURA_V31_SPARSE_INDEX');
          previous=index;
        }
        start=checkRange(sparse.values.bufferView,sparse.values.byteOffset||0,count,stride,12);
      }else{
        count=a.count;stride=j.bufferViews[a.bufferView]?.byteStride||12;
        start=checkRange(a.bufferView,a.byteOffset||0,count,stride,12);
      }
      for(let i=0;i<count;i++){
        const p=start+i*stride;
        const x=bytes.readFloatLE(p),y=bytes.readFloatLE(p+4),z=bytes.readFloatLE(p+8);
        if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z))throw Error('AURA_V31_NONFINITE_MORPH');
        if(x*x+y*y+z*z>1e-8)nonzero=true;
      }
    }
    if(!nonzero)throw Error('AURA_V31_EMPTY_MORPH:'+name);
  }
  return {version:'V31',bytes:bytes.length,sha256,joints:names.size,skinnedMeshes:skinned.length,requiredMorphs,structuralStatus:'PASS',visualStatus:'NOT_TESTED'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Usage: node runtime/scripts/inspect-aura-v31.mjs <GLB>');
  console.log(JSON.stringify(inspectV31(await readFile(resolve(process.argv[2]))),null,2));
}
