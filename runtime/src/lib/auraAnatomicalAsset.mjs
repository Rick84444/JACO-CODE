// Operator-provisioned experimental anatomical candidates; neither is final.
export const ANATOMICAL_PATH='/branding/aura-anatomical.glb';
export const ANATOMICAL_BYTES=37095016;
export const ANATOMICAL_SHA256='c5971c63aec5922b8df83bc207839146d0f419b84e1a33ae611cb1862ec81ccc';
export const ANATOMICAL_CANDIDATES=Object.freeze([
  Object.freeze({version:'V4',bytes:ANATOMICAL_BYTES,sha256:ANATOMICAL_SHA256}),
  Object.freeze({version:'V6',bytes:39494416,sha256:'ba7479460465de16178f2620a611910f48f39b87d1abc8e5eb8d8cd37a8f5a8b'}),
  // Operator-built JACO candidate, normalised to 1.75 m with soles at y=0. Values come from the operator's own
  // measurement report; a file that does not match both exactly is refused, never accepted.
  Object.freeze({version:'V31-JACO',bytes:45304080,sha256:'ea9c4646cf197f042fa4a39ea8ecd5a438adb1b0865c8eddb0749d0915bd6129'})
]);
export function validateAnatomicalHeader(bytes){
  const candidate=ANATOMICAL_CANDIDATES.find(c=>c.bytes===bytes.byteLength);
  if(!candidate)throw Error('AURA_ANATOMICAL_SIZE');
  const view=new DataView(bytes);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw Error('AURA_ANATOMICAL_HEADER');
  return candidate;
}
export async function fetchAnatomicalAsset(signal){
  const response=await fetch(ANATOMICAL_PATH,{signal,cache:'no-store'});
  if(!response.ok)throw Error('AURA_ANATOMICAL_MISSING');
  const bytes=await response.arrayBuffer();
  const candidate=validateAnatomicalHeader(bytes);
  if(!globalThis.crypto?.subtle)throw Error('AURA_ANATOMICAL_SECURE_CONTEXT_REQUIRED');
  const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==candidate.sha256)throw Error('AURA_ANATOMICAL_HASH');
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  return bytes;
}
