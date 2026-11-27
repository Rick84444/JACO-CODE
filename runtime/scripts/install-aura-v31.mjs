import {randomUUID,createHash} from 'node:crypto';
import {inspectV31} from './inspect-aura-v31.mjs';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const source=process.argv[2];
if(!source)throw Error('Usage: node runtime/scripts/install-aura-v31.mjs <GLB> OR --parts <directory>');
let bytes;
if(source==='--parts'){
  const dir=resolve(process.argv[3]||fileURLToPath(new URL('../../assets/aura-v31/',import.meta.url)));
  const hashes=['3f362117325cd20d0047ed39633c19d346fc51e5fef5649eee03e8c9802d8494','2790dd1fe1f28b2324e0d820b79fe9a050d7d122ebebaac2ce5e82771ddb6c67'];
  const parts=[];
  for(let i=0;i<hashes.length;i++){
    const part=await readFile(resolve(dir,'Aura-V31-JACO.part0'+(i+1)));
    if(part.length!==22652040||createHash('sha256').update(part).digest('hex')!==hashes[i])throw Error('AURA_V31_PART_INVALID_'+(i+1));
    parts.push(part);
  }
  bytes=Buffer.concat(parts);
}else bytes=await readFile(resolve(source));
const {sha256}=inspectV31(bytes);
const destination=fileURLToPath(new URL('../public/branding/aura-anatomical.glb',import.meta.url));
await mkdir(dirname(destination),{recursive:true});
const tmp=destination+'.'+randomUUID()+'.tmp';
try{
  await writeFile(tmp,bytes,{flag:'wx'});
  await rename(tmp,destination);
}finally{
  await rm(tmp,{force:true});
}
console.log(JSON.stringify({version:'V31',bytes:bytes.length,sha256,destination}));
