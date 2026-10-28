/**
 * Evidence Ledger v2 — public claims are never proof.
 * The runtime-only recorder is a same-process trust boundary, NOT an OS sandbox:
 * components with arbitrary JS execution in the runtime process can still call it.
 * A production remotely isolated verifier needs IPC authentication and separate keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { ensureDir, atomicWriteJson, readJson, makeId, nowIso, sha256, canonicalJson, deepClone, redactSensitive } from './util.mjs';

function makeKey(root) {
  const filename = path.join(root, '.evidence-authority.key');
  try { fs.writeFileSync(filename, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (err) { if (err.code !== 'EEXIST') throw err; }
  const st = fs.lstatSync(filename);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== 32 || (process.platform !== 'win32' && (st.mode & 0o077) !== 0))
    throw new Error('EVIDENCE_AUTHORITY_KEY_UNSAFE');
  return fs.readFileSync(filename);
}

export class EvidenceLedger {
  #key;
  constructor(root, events) {
    this.dir = ensureDir(path.join(root, 'evidence'));
    this.events = events;
    this.#key = makeKey(root);
  }
  #seal(item) {
    const { integrity, ...signed } = item;
    return { scheme:'HMAC-SHA256', tag:createHmac('sha256',this.#key).update(canonicalJson(signed)).digest('hex') };
  }
  #trusted(item) {
    if (!item?.verified || item.integrity?.scheme !== 'HMAC-SHA256' || !/^[a-f0-9]{64}$/.test(item.integrity?.tag||'')) return false;
    const expected=this.#seal(item).tag;
    try { return timingSafeEqual(Buffer.from(expected,'hex'), Buffer.from(item.integrity.tag,'hex')); }
    catch { return false; }
  }
  /** Untrusted API: `verified:true` and `verificationMethod` are ignored. */
  record(input, actor='system') { return this.#record(input,actor,false); }
  /** INTERNAL ONLY: use only for measured observations from trusted runtime components. */
  recordInternal(input, actor='system') { return this.#record(input,actor,true); }
  #record(input={}, actor, internal) {
    const id=input.id?String(input.id).slice(0,180):makeId('evidence');
    if (fs.existsSync(this.#file(id))) throw new Error(`evidence '${id}' already exists`);
    const payload={
      kind:String(input.kind||'observation').slice(0,120),
      claim:String(input.claim||'').slice(0,4000),
      source:String(input.source||'runtime').slice(0,500),
      observedAt:input.observedAt||nowIso(),
      data:redactSensitive(input.data??null),
      refs:Array.isArray(input.refs)?input.refs.slice(0,200).map(String):[],
    };
    const verified=internal && input.verified === true;
    if (verified && (typeof input.verificationMethod !== 'string' || !input.verificationMethod.trim()))
      throw new Error('EVIDENCE_INTERNAL_METHOD_REQUIRED');
    const item={schema:'jaco.continuum.evidence.v2',id,...payload,
      contentHash:`sha256:${sha256(canonicalJson(payload))}`,
      verified,verificationMethod:verified?input.verificationMethod.slice(0,500):null,
      createdAt:nowIso(),actor,verificationOrigin:verified?'TRUSTED_RUNTIME_OBSERVATION':null};
    if (verified) item.integrity=this.#seal(item);
    atomicWriteJson(this.#file(id),item);
    this.events?.append({stream:'evidence',type:verified?'evidence.runtime_attested':'evidence.recorded',entityId:id,actor,
      data:{kind:item.kind,claim:item.claim,contentHash:item.contentHash}});
    return deepClone(item);
  }
  /** Public verification has been withdrawn: no caller-supplied method proves a fact. */
  verify() { throw new Error('EVIDENCE_INDEPENDENT_VERIFIER_REQUIRED'); }
  /** INTERNAL ONLY: used for already-observed evidence (e.g. independent test runner). */
  verifyInternal(id,{method,actor='trusted-reviewer',data=null}={}) {
    if (typeof method !== 'string' || !method.trim()) throw new Error('EVIDENCE_INTERNAL_METHOD_REQUIRED');
    const item=this.get(id);
    if (item.verified) throw new Error('EVIDENCE_ALREADY_VERIFIED');
    item.verified=true;item.verificationMethod=method.slice(0,500);
    item.verificationOrigin='TRUSTED_RUNTIME_OBSERVATION';item.verifiedAt=nowIso();
    if (data!==null)item.verificationData=redactSensitive(data);
    item.integrity=this.#seal(item);
    atomicWriteJson(this.#file(id),item);
    this.events?.append({stream:'evidence',type:'evidence.runtime_attested',entityId:id,actor,data:{method:item.verificationMethod}});
    return deepClone(item);
  }
  get(id) {
    const item=readJson(this.#file(id));
    if (!item) throw new Error(`evidence '${id}' not found`);
    const out=deepClone(item);
    if (out.verified && !this.#trusted(out)) {
      out.verified=false;out.verificationMethod=null;out.integrityStatus='INVALID_OR_LEGACY_ATTESTATION';
    }
    return out;
  }
  exists(id) {return Boolean(readJson(this.#file(id)));}
  assertRefs(refs,{verified=true,kinds=null,allowEmpty=false}={}) {
    const list=Array.isArray(refs)?[...new Set(refs.map(String).filter(Boolean))]:[];
    if (!list.length&&!allowEmpty) throw new Error('evidenceRefs required');
    const items=list.map(id=>this.get(id));
    if (verified) {const bad=items.filter(x=>!x.verified);if(bad.length)throw new Error(`evidence not verified: ${bad.map(x=>x.id).join(', ')}`);}
    if (Array.isArray(kinds)&&kinds.length) {const allowed=new Set(kinds.map(String));const bad=items.filter(x=>!allowed.has(x.kind));if(bad.length)throw new Error(`evidence kind not allowed: ${bad.map(x=>`${x.id}:${x.kind}`).join(', ')}`);}
    return items;
  }
  list({verified=null,kind=null,limit=200}={}) {return fs.readdirSync(this.dir).filter(n=>n.endsWith('.json')).map(n=>this.get(n.slice(0,-5))).filter(x=>verified===null||x.verified===verified).filter(x=>!kind||x.kind===kind).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,Math.min(1000,Number(limit)||200));}
  #file(id) {return path.join(this.dir,`${String(id).replace(/[^a-zA-Z0-9_.-]/g,'_')}.json`);}
}
