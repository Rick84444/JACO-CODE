import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, atomicWriteJson, readJson, makeId, nowIso, sha256, canonicalJson, deepClone, redactSensitive } from './util.mjs';

export class KnowledgeStore {
  constructor(root,events,evidence=null){this.dir=ensureDir(path.join(root,'knowledge'));this.events=events;this.evidence=evidence;}
  put(input,actor='system'){
    const id=input.id?String(input.id).slice(0,180):makeId('knowledge');const current=readJson(this.#file(id));
    const body={purpose:String(input.purpose||current?.purpose||'').slice(0,2000),kind:String(input.kind||current?.kind||'general').slice(0,100),confidence:Math.max(0,Math.min(1,Number(input.confidence??current?.confidence??0))),evidenceRefs:Array.isArray(input.evidenceRefs)?[...new Set(input.evidenceRefs.map(String))].slice(0,500):(current?.evidenceRefs||[]),usedIn:Array.isArray(input.usedIn)?[...new Set(input.usedIn.map(String))].slice(0,500):(current?.usedIn||[]),dependencies:Array.isArray(input.dependencies)?[...new Set(input.dependencies.map(String))].slice(0,500):(current?.dependencies||[]),alternatives:redactSensitive(Array.isArray(input.alternatives)?input.alternatives.slice(0,100):current?.alternatives||[]),failureModes:redactSensitive(Array.isArray(input.failureModes)?input.failureModes.slice(0,100):current?.failureModes||[]),reusable:input.reusable!==undefined?Boolean(input.reusable):Boolean(current?.reusable),implementation:redactSensitive(input.implementation??current?.implementation??null),reasoningSummary:String(input.reasoningSummary||current?.reasoningSummary||'').slice(0,6000),metrics:redactSensitive(input.metrics&&typeof input.metrics==='object'?input.metrics:(current?.metrics||{}))};
    if(this.evidence&&body.evidenceRefs.length)this.evidence.assertRefs(body.evidenceRefs,{verified:false});
    const contentHash=`sha256:${sha256(canonicalJson(body))}`;
    const changed=contentHash!==current?.contentHash;
    const requestedStatus=input.verificationStatus;
    const allowed=['UNVERIFIED','VERIFIED','STALE','SUPERSEDED','CONTRADICTED','INVALID'];
    if(requestedStatus!==undefined&&!allowed.includes(requestedStatus))throw new Error('invalid knowledge verificationStatus');
    const verificationStatus=requestedStatus||(changed?'UNVERIFIED':current?.verificationStatus||'UNVERIFIED');
    if(verificationStatus==='VERIFIED'){
      if(!body.evidenceRefs.length)throw new Error('verified knowledge requires evidenceRefs');
      if(this.evidence)this.evidence.assertRefs(body.evidenceRefs,{verified:true});
      else throw new Error('verified knowledge requires an evidence ledger');
    }
    const keepStatusContext=!changed&&verificationStatus===current?.verificationStatus;
    const item={schema:'jaco.continuum.knowledge-object.v1',id,...body,verificationStatus,statusReason:keepStatusContext?current.statusReason||null:null,statusEvidenceRefs:keepStatusContext?current.statusEvidenceRefs||[]:[],revision:Number(current?.revision||0)+1,createdAt:current?.createdAt||nowIso(),updatedAt:nowIso(),contentHash};
    atomicWriteJson(this.#file(id),item);this.events.append({stream:'knowledge',type:current?'knowledge.updated':'knowledge.created',entityId:id,actor,data:{kind:item.kind,purpose:item.purpose,confidence:item.confidence,verificationStatus:item.verificationStatus,contentHash:item.contentHash}});return deepClone(item);
  }
  setStatus(id,status,{reason,evidenceRefs=[]}={},actor='verifier'){
    const allowed=['UNVERIFIED','VERIFIED','STALE','SUPERSEDED','CONTRADICTED','INVALID'];
    if(!allowed.includes(status))throw new Error('invalid knowledge verificationStatus');
    const item=this.get(id);
    const refs=[...new Set((Array.isArray(evidenceRefs)?evidenceRefs:[]).map(String))];
    if(status==='VERIFIED'){
      if(!item.evidenceRefs.length)throw new Error('verified knowledge requires evidenceRefs');
      if(!this.evidence)throw new Error('verified knowledge requires an evidence ledger');
      this.evidence.assertRefs(item.evidenceRefs,{verified:true});
      if(refs.length)this.evidence.assertRefs(refs,{verified:true});
    }else if(refs.length&&this.evidence)this.evidence.assertRefs(refs,{verified:false});
    if(['STALE','SUPERSEDED','CONTRADICTED','INVALID'].includes(status)&&!String(reason||'').trim())throw new Error('knowledge status reason required');
    item.verificationStatus=status;item.statusReason=redactSensitive(String(reason||'').slice(0,2000))||null;item.statusEvidenceRefs=refs;item.updatedAt=nowIso();item.revision+=1;
    atomicWriteJson(this.#file(id),item);
    this.events.append({stream:'knowledge',type:'knowledge.status_changed',entityId:id,actor,data:{status,reason:item.statusReason,evidenceRefs:refs}});
    return deepClone(item);
  }
  get(id){const k=readJson(this.#file(id));if(!k)throw new Error(`knowledge '${id}' not found`);return deepClone(k);}
  list({kind=null,minConfidence=0,reusable=null,limit=200}={}){return fs.readdirSync(this.dir).filter(n=>n.endsWith('.json')).map(n=>readJson(path.join(this.dir,n))).filter(Boolean).filter(k=>!kind||k.kind===kind).filter(k=>Number(k.confidence)>=Number(minConfidence||0)).filter(k=>reusable===null||k.reusable===reusable).sort((a,b)=>Number(b.confidence)-Number(a.confidence)).slice(0,Math.min(1000,Number(limit)||200));}
  search(query,{limit=20,includeInactive=false}={}){const terms=String(query||'').toLowerCase().split(/\s+/).filter(Boolean);return this.list({limit:1000}).filter(k=>includeInactive||!['STALE','SUPERSEDED','CONTRADICTED','INVALID'].includes(k.verificationStatus)).map(k=>{const hay=JSON.stringify([k.id,k.purpose,k.kind,k.dependencies,k.failureModes,k.reasoningSummary]).toLowerCase();const score=terms.reduce((s,t)=>s+(hay.includes(t)?1:0),0);return {score,item:k};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||b.item.confidence-a.item.confidence).slice(0,Math.min(100,Number(limit)||20)).map(x=>x.item);}
  #file(id){return path.join(this.dir,`${String(id).replace(/[^a-zA-Z0-9_.-]/g,'_')}.json`);}
}
