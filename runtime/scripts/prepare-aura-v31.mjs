import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const path=url=>fileURLToPath(new URL(url,import.meta.url));
const dir=path('../../assets/aura-v31/');
const exists=async p=>{try{await access(p);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
const parts=await Promise.all([1,2].map(n=>exists(path('../../assets/aura-v31/Aura-V31-JACO.part0'+n))));
const installed=path('../public/branding/aura-anatomical.glb');
const installer=path('./install-aura-v31.mjs');
const inspector=path('./inspect-aura-v31.mjs');
function run(script,args){
  const result=spawnSync(process.execPath,[script,...args],{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('AURA_V31_PREPARE_FAILED');
}
if(parts.every(Boolean))run(installer,['--parts',dir]);
else if(parts.some(Boolean))throw Error('AURA_V31_PARTS_INCOMPLETE');
else if(await exists(installed))run(inspector,[installed]);
else console.log('Aura V31 asset not supplied; legacy lightform remains available (V31 not verified).');
