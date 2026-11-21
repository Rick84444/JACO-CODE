import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SOURCE='https://raw.githubusercontent.com/met4citizen/TalkingHead/1563de184c19b310de4b636664d5835e2c74dbba/avatars/mpfb.glb';
export const BLOB='cd2ebbe1fe8bcbf3d5b2dfbf1262a7f76814e68f';
export const SIZE=36815920;
const align=n=>(n+3)&~3;
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function compactRig(source){
  const hash=createHash('sha1').update('blob '+source.length+'\0').update(source).digest('hex');
  if(source.length!==SIZE||hash!==BLOB)throw Error('AURA_RIG_SOURCE_MISMATCH');
  if(source.toString('ascii',0,4)!=='glTF'||source.readUInt32LE(4)!==2||source.readUInt32LE(8)!==source.length)throw Error('AURA_RIG_HEADER');
  const jsonSize=source.readUInt32LE(12),binHeader=20+jsonSize;
  if(source.toString('ascii',16,20)!=='JSON'||source.toString('ascii',binHeader+4,binHeader+8)!=='BIN\0')throw Error('AURA_RIG_CHUNKS');
  const json=JSON.parse(source.toString('utf8',20,binHeader)),data=source.subarray(binHeader+8);
  if(json.extensionsUsed?.length||json.extensionsRequired?.length||json.buffers.length!==1||json.buffers[0].uri)throw Error('AURA_RIG_UNSUPPORTED_LAYOUT');
  // Keep rig and full position morphs; remove unused photographic textures and rendering attributes.
  delete json.images;delete json.textures;delete json.samplers;delete json.materials;
  const used=new Set();
  for(const mesh of json.meshes)for(const p of mesh.primitives){
    delete p.material;
    p.attributes=Object.fromEntries(Object.entries(p.attributes).filter(([key])=>['POSITION','JOINTS_0','WEIGHTS_0'].includes(key)));
    if(!('POSITION' in p.attributes)||!('JOINTS_0' in p.attributes)||!('WEIGHTS_0' in p.attributes))throw Error('AURA_RIG_MISSING_SKIN_ATTRIBUTES');
    Object.values(p.attributes).forEach(i=>used.add(i));
    if(p.indices!==undefined)used.add(p.indices);
    if(p.targets)p.targets=p.targets.map(target=>{if(target.POSITION===undefined)throw Error('AURA_RIG_MORPH_POSITION');used.add(target.POSITION);return {POSITION:target.POSITION};});
  }
  for(const skin of json.skins)if(skin.inverseBindMatrices!==undefined)used.add(skin.inverseBindMatrices);
  if(json.animations?.length)throw Error('AURA_RIG_UNEXPECTED_ANIMATIONS');
  const indices=[...used].sort((a,b)=>a-b),accessorMap=new Map(indices.map((i,n)=>[i,n]));
  json.accessors=indices.map(i=>json.accessors[i]);
  for(const mesh of json.meshes)for(const p of mesh.primitives){
    p.attributes=Object.fromEntries(Object.entries(p.attributes).map(([k,i])=>[k,accessorMap.get(i)]));
    if(p.indices!==undefined)p.indices=accessorMap.get(p.indices);
    if(p.targets)p.targets=p.targets.map(t=>({POSITION:accessorMap.get(t.POSITION)}));
  }
  for(const skin of json.skins)if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=accessorMap.get(skin.inverseBindMatrices);
  const views=new Set();for(const a of json.accessors){if(a.bufferView!==undefined)views.add(a.bufferView);if(a.sparse){views.add(a.sparse.indices.bufferView);views.add(a.sparse.values.bufferView);}}
  const viewIndices=[...views].sort((a,b)=>a-b),viewMap=new Map(viewIndices.map((i,n)=>[i,n]));
  const chunks=[];let offset=0;
  json.bufferViews=viewIndices.map(i=>{const v={...json.bufferViews[i]},start=v.byteOffset||0,end=start+v.byteLength;if(v.buffer!==0||end>data.length)throw Error('AURA_RIG_VIEW_BOUNDS');const part=data.subarray(start,end);v.byteOffset=offset;chunks.push(part,Buffer.alloc(align(part.length)-part.length));offset+=align(part.length);return v;});
  for(const a of json.accessors){if(a.bufferView!==undefined)a.bufferView=viewMap.get(a.bufferView);if(a.sparse){a.sparse.indices.bufferView=viewMap.get(a.sparse.indices.bufferView);a.sparse.values.bufferView=viewMap.get(a.sparse.values.bufferView);}}
  json.buffers=[{byteLength:offset}];
  const j=Buffer.from(JSON.stringify(json));const padding=Buffer.alloc(align(j.length)-j.length,0x20),bin=Buffer.concat(chunks);
  const header=Buffer.alloc(20);header.write('glTF',0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+j.length+padding.length+8+bin.length,8);header.writeUInt32LE(j.length+padding.length,12);header.write('JSON',16);
  const binHead=Buffer.alloc(8);binHead.writeUInt32LE(bin.length,0);binHead.write('BIN\0',4);
  return Buffer.concat([header,j,padding,binHead,bin]);
}
const output=resolve(process.argv[2]||fileURLToPath(new URL('../public/branding/aura-rig.glb',import.meta.url)));
const expected='ac10ed2361d02634524cf3e0d1c8b5e6ec10bc67d9a589c5567c6b873bd8307d';
let existing;try{existing=await readFile(output)}catch(e){if(e.code!=='ENOENT')throw e;}
if(existing&&sha256(existing)===expected){console.log('Aura rig ready: '+expected);process.exit(0);}
// This is one pinned asset with two transport mirrors, not two versions.
 // GitHub raw intermittently returns HTTP 429 on parallel CI builds.
 // All successful transfers are checked against the *same* upstream Git blob
 // SHA-1, expected GLB structure and deterministic compact SHA-256 below.
export const SOURCE_MIRRORS = Object.freeze([
  SOURCE,
  'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1563de184c19b310de4b636664d5835e2c74dbba/avatars/mpfb.glb',
]);
async function downloadPinnedRig(fetchImpl = fetch) {
  const errors = [];
  for (const url of SOURCE_MIRRORS) {
    // A short retry handles burst rate limits without hanging the build.
    for (let attempt=0; attempt<2; attempt++) {
      try {
        const res=await fetchImpl(url,{signal:AbortSignal.timeout(120000)});
        if (!res.ok) {
          errors.push(res.status);
          if (res.status !== 429 && res.status < 500) break;
        } else {
          const bytes=Buffer.from(await res.arrayBuffer());
          const hash=createHash('sha1').update('blob '+bytes.length+'\\0').update(bytes).digest('hex');
          if (bytes.length!==SIZE||hash!==BLOB) throw Error('AURA_RIG_SOURCE_MISMATCH');
          return bytes;
        }
      } catch (error) {
        errors.push(String(error?.message||error));
        if (errors.at(-1)==='AURA_RIG_SOURCE_MISMATCH') throw error;
      }
      if (!attempt) await new Promise(resolve=>setTimeout(resolve,1500));
    }
  }
  throw Error('AURA_RIG_ALL_PINNED_SOURCES_FAILED:' + errors.map(x=>String(x).slice(0,50)).join(','));
}
let source;if(process.env.JACO_AURA_RIG_SOURCE)source=await readFile(process.env.JACO_AURA_RIG_SOURCE);else source=await downloadPinnedRig();
const compact=compactRig(source),digest=sha256(compact);
if(digest!==expected)throw Error('AURA_RIG_COMPACT_HASH');
await mkdir(dirname(output),{recursive:true});const tmp=output+'.tmp-'+process.pid;await writeFile(tmp,compact);await rename(tmp,output);console.log(JSON.stringify({bytes:compact.length,sha256:digest,source:BLOB}));
