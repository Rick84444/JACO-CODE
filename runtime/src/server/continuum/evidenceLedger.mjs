import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, atomicWriteJson, readJson, makeId, nowIso, sha256, canonicalJson, deepClone, redactSensitive } from './util.mjs';

export class EvidenceLedger {
  constructor(root,events){this.dir=ensureDir(path.join(root,'evidence'));this.events=events;}
  record(input,actor='system'){
    const id=input.id?String(input.id).slice(0,180):makeId('evidence');
    if(fs.existsSync(this.#file(id)))throw new Error(`evidence '${id}' already exists`);
    const payload={
      kind:String(input.kind||'observation').slice(0,120),
      claim:String(input.claim||'').slice(0,4000),
      source:String(input.source||'runtime').slice(0,500),
      observedAt:input.observedAt||nowIso(),
      data:redactSensitive(input.data??null),
      refs:Array.isArray(input.refs)?input.refs.slice(0,200).map(String):[],
    };
    const item={schema:'jaco.continuum.evidence.v1',id,...payload,contentHash:`sha256:${sha256(canonicalJson(payload))}`,verified:Boolean(input.verified),verificationMethod:input.verificationMethod?String(input.verificationMethod).slice(0,500):null,createdAt:nowIso(),actor};
    atomicWriteJson(this.#file(id),item);
    this.events.append({stream:'evidence',type:item.verified?'evidence.verified':'evidence.recorded',entityId:id,actor,data:{kind:item.kind,claim:item.claim,contentHash:item.contentHash}});
    return deepClone(item);
  }
  verify(id,{method,actor='verifier',data=null}={}){
    const item=this.get(id);item.verified=true;item.verificationMethod=String(method||'explicit_verification').slice(0,500);item.verifiedAt=nowIso();if(data!==null)item.verificationData=redactSensitive(data);atomicWriteJson(this.#file(id),item);this.events.append({stream:'evidence',type:'evidence.verified',entityId:id,actor,data:{method:item.verificationMethod}});return deepClone(item);
  }
  get(id){const v=readJson(this.#file(id));if(!v)throw new Error(`evidence '${id}' not found`);return deepClone(v);}
  exists(id){return Boolean(readJson(this.#file(id)));}
  assertRefs(refs,{verified=true,kinds=null,allowEmpty=false}={}){
    const list=Array.isArray(refs)?[...new Set(refs.map(String).filter(Boolean))]:[];
    if(!list.length&&!allowEmpty)throw new Error('evidenceRefs required');
    const items=list.map(id=>this.get(id));
    if(verified){const bad=items.filter(x=>!x.verified);if(bad.length)throw new Error(`evidence not verified: ${bad.map(x=>x.id).join(', ')}`);}
    if(Array.isArray(kinds)&&kinds.length){const allowed=new Set(kinds.map(String));const bad=items.filter(x=>!allowed.has(x.kind));if(bad.length)throw new Error(`evidence kind not allowed: ${bad.map(x=>`${x.id}:${x.kind}`).join(', ')}`);}
    return items;
  }
  list({verified=null,kind=null,limit=200}={}){return fs.readdirSync(this.dir).filter(n=>n.endsWith('.json')).map(n=>readJson(path.join(this.dir,n))).filter(Boolean).filter(x=>verified===null||x.verified===verified).filter(x=>!kind||x.kind===kind).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,Math.min(1000,Number(limit)||200));}
  #file(id){return path.join(this.dir,`${String(id).replace(/[^a-zA-Z0-9_.-]/g,'_')}.json`);}
}
