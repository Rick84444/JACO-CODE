import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,resolve} from 'node:path';
import {ANATOMICAL_BYTES,ANATOMICAL_SHA256,validateAnatomicalHeader} from '../src/lib/auraAnatomicalAsset.mjs';

export function verifyCandidate(bytes){
  if(bytes.length!==ANATOMICAL_BYTES)throw Error('AURA_ANATOMICAL_SIZE');
  validateAnatomicalHeader(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  if(createHash('sha256').update(bytes).digest('hex')!==ANATOMICAL_SHA256)throw Error('AURA_ANATOMICAL_HASH');
}
export async function installCandidate(source,destination){
  const bytes=await readFile(source);
  verifyCandidate(bytes);
  await mkdir(dirname(destination),{recursive:true});
  const tmp=destination+'.tmp-'+process.pid;
  try{await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,destination);}
  finally{await rm(tmp,{force:true});}
  return {bytes:bytes.length,sha256:ANATOMICAL_SHA256,destination};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Usage: node runtime/scripts/install-aura-anatomical.mjs <Aura-V4-compact.glb>');
  const destination=fileURLToPath(new URL('../public/branding/aura-anatomical.glb',import.meta.url));
  console.log(JSON.stringify(await installCandidate(resolve(process.argv[2]),destination)));
}
