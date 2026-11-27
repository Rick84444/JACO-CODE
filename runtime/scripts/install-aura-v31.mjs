import {randomUUID} from 'node:crypto';
import {inspectV31} from './inspect-aura-v31.mjs';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const source=process.argv[2];
if(!source)throw Error('Usage: node runtime/scripts/install-aura-v31.mjs <Aura-V31-JACO.glb>');
const bytes=await readFile(resolve(source));
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
