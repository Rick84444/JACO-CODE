import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const SOURCE='https://raw.githubusercontent.com/met4citizen/TalkingHead/1563de184c19b310de4b636664d5835e2c74dbba/avatars/mpfb.glb';
const EXPECTED='cd2ebbe1fe8bcbf3d5b2dfbf1262a7f76814e68f';
const SIZE=36815920;
const dir=resolve(process.argv[2]||'aura-rig-evidence');
await mkdir(dir,{recursive:true});
const file=resolve(dir,'mpfb.glb');
let bytes;
try { bytes=await readFile(file); } catch(error) {
  if(error.code!=='ENOENT') throw error;
  const response=await fetch(SOURCE,{signal:AbortSignal.timeout(120000)});
  if(!response.ok) throw Error('AURA_RIG_DOWNLOAD_'+response.status);
  bytes=Buffer.from(await response.arrayBuffer());
}
if(bytes.length!==SIZE) throw Error('AURA_RIG_SIZE');
const hash=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
if(hash!==EXPECTED) throw Error('AURA_RIG_HASH');
if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.toString('ascii',16,20)!=='JSON')throw Error('AURA_RIG_HEADER');
const size=bytes.readUInt32LE(12);
const json=JSON.parse(bytes.toString('utf8',20,20+size));
const nodes=(json.nodes||[]).map((node,index)=>({index,name:node.name??null,mesh:node.mesh??null,skin:node.skin??null}));
const meshes=(json.meshes||[]).map((mesh,index)=>({index,name:mesh.name??null,morphNames:mesh.extras?.targetNames||[],primitives:mesh.primitives.map(primitive=>({vertices:json.accessors[primitive.attributes.POSITION]?.count??0,morphTargets:primitive.targets?.length||0,attributes:Object.keys(primitive.attributes),extensions:Object.keys(primitive.extensions||{})}))}));
const skins=(json.skins||[]).map(skin=>({name:skin.name??null,joints:skin.joints.map(i=>nodes[i]?.name??i)}));
const report={source:SOURCE,license:'CC0 per upstream README',blob:hash,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),extensions:json.extensionsUsed||[],requiredExtensions:json.extensionsRequired||[],nodes,meshes,skins};
if(!skins.length||!meshes.some(m=>m.primitives.some(p=>p.morphTargets>0)))throw Error('AURA_RIG_MISSING_SKIN_OR_MORPH');
await writeFile(file,bytes);
await writeFile(resolve(dir,'rig-manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
