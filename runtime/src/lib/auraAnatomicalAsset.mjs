// Operator-provisioned V4 candidate; not the final portrait.
// No downloads from third parties and no silent substitution.
export const ANATOMICAL_PATH='/branding/aura-anatomical.glb';
export const ANATOMICAL_BYTES=37095016;
export const ANATOMICAL_SHA256='c5971c63aec5922b8df83bc207839146d0f419b84e1a33ae611cb1862ec81ccc';
export function validateAnatomicalHeader(bytes){
  if(bytes.byteLength!==ANATOMICAL_BYTES)throw Error('AURA_ANATOMICAL_SIZE');
  const view=new DataView(bytes);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw Error('AURA_ANATOMICAL_HEADER');
}
export async function fetchAnatomicalAsset(signal){
  const response=await fetch(ANATOMICAL_PATH,{signal,cache:'force-cache'});
  if(!response.ok)throw Error('AURA_ANATOMICAL_MISSING');
  const bytes=await response.arrayBuffer();
  validateAnatomicalHeader(bytes);
  if(globalThis.crypto?.subtle){
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==ANATOMICAL_SHA256)throw Error('AURA_ANATOMICAL_HASH');
  }
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return bytes;
}
