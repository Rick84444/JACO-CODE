import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const expectedBytes=45304080;
const expectedHash='ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129';
const source=process.argv[2];
if(!source)throw Error('Usage: node runtime/scripts/install-aura-v31.mjs <Aura-V31-JACO.glb>');
const bytes=await readFile(resolve(source));
if(bytes.length!==expectedBytes||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('AURA_V31_HEADER_OR_SIZE');
const sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!==expectedHash)throw Error('AURA_V31_SHA256');
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
