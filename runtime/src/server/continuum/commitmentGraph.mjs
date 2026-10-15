import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, atomicWriteJson, readJson, makeId, nowIso, assertString, deepClone } from './util.mjs';

const STATES = ['PROPOSED','ACCEPTED','ACTIVE','BLOCKED','VERIFYING','FULFILLED','CANCELLED'];
const TRANSITIONS = {
  PROPOSED:new Set(['ACCEPTED','CANCELLED']), ACCEPTED:new Set(['ACTIVE','CANCELLED']),
  ACTIVE:new Set(['BLOCKED','VERIFYING','CANCELLED']), BLOCKED:new Set(['ACTIVE','CANCELLED']),
  VERIFYING:new Set(['ACTIVE','BLOCKED','FULFILLED','CANCELLED']), FULFILLED:new Set([]), CANCELLED:new Set([]),
};

export class CommitmentGraph {
  constructor(root, events, evidence=null) { this.dir=ensureDir(path.join(root,'commitments')); this.events=events; this.evidence=evidence; }

  create(input, actor='system') {
    const id=input.id?assertString(input.id,'commitment.id',180):makeId('commit');
    if(fs.existsSync(this.#file(id))) throw new Error(`commitment '${id}' already exists`);
    const c={
      schema:'jaco.continuum.commitment.v1', id,
      missionId:assertString(input.missionId,'missionId',180),
      title:assertString(input.title,'title',500),
      description:String(input.description||'').slice(0,4000),
      state:'PROPOSED',
      dependsOn:this.#ids(input.dependsOn),
      requiredEvidence:this.#ids(input.requiredEvidence),
      producedEvidence:[],
      assigneeAgentId:input.assigneeAgentId?String(input.assigneeAgentId).slice(0,180):null,
      execution: input.execution && typeof input.execution==='object' ? { kind:String(input.execution.kind||'').slice(0,120), payload:input.execution.payload&&typeof input.execution.payload==='object'?input.execution.payload:{}, consequence:String(input.execution.consequence||'REVERSIBLE').slice(0,80), leaseId:input.execution.leaseId?String(input.execution.leaseId).slice(0,180):null, maxAttempts:Math.max(1,Math.min(Number(input.execution.maxAttempts||3),20)) } : null,
      recoveryStrategy:String(input.recoveryStrategy||'replan_from_last_verified_state').slice(0,1000),
      attempts:0,
      createdAt:nowIso(), updatedAt:nowIso(), revision:1,
    };
    this.#assertNoCycle(c);
    atomicWriteJson(this.#file(id),c);
    this.events.append({stream:'commitment',type:'commitment.created',entityId:id,actor,data:c});
    return deepClone(c);
  }

  get(id){const c=readJson(this.#file(id)); if(!c) throw new Error(`commitment '${id}' not found`); return deepClone(c);}
  list({missionId=null,state=null}={}){return fs.readdirSync(this.dir).filter(n=>n.endsWith('.json')).map(n=>readJson(path.join(this.dir,n))).filter(Boolean).filter(c=>!missionId||c.missionId===missionId).filter(c=>!state||c.state===state).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));}

  transition(id,nextState,{actor='system',reason=null,evidenceRefs=[]}={}){
    const c=this.get(id);
    if(!STATES.includes(nextState)||!TRANSITIONS[c.state]?.has(nextState)) throw new Error(`commitment transition ${c.state} -> ${nextState} is not allowed`);
    if(nextState==='ACTIVE'){
      const deps=c.dependsOn.map(dep=>this.get(dep));
      const unmet=deps.filter(dep=>dep.state!=='FULFILLED');
      if(unmet.length) throw new Error(`commitment dependencies not fulfilled: ${unmet.map(x=>x.id).join(', ')}`);
    }
    if(this.evidence && Array.isArray(evidenceRefs) && evidenceRefs.length) this.evidence.assertRefs(evidenceRefs,{verified:nextState==='FULFILLED'});
    if(nextState==='VERIFYING') c.attempts+=1;
    if(nextState==='FULFILLED'){
      const refs=[...new Set([...(c.producedEvidence||[]),...this.#ids(evidenceRefs)])];
      if(refs.length===0) throw new Error('commitment fulfillment requires evidence');
      c.producedEvidence=refs;
    } else if(evidenceRefs?.length) c.producedEvidence=[...new Set([...(c.producedEvidence||[]),...this.#ids(evidenceRefs)])];
    c.state=nextState;c.updatedAt=nowIso();c.revision+=1;if(reason)c.lastReason=String(reason).slice(0,1000);
    atomicWriteJson(this.#file(id),c);
    this.events.append({stream:'commitment',type:`commitment.${nextState.toLowerCase()}`,entityId:id,actor,data:{reason,evidenceRefs}});
    return deepClone(c);
  }

  ready(missionId){return this.list({missionId}).filter(c=>['ACCEPTED','BLOCKED'].includes(c.state)).filter(c=>c.dependsOn.every(id=>{try{return this.get(id).state==='FULFILLED'}catch{return false}}));}

  graph(missionId){
    const nodes=this.list({missionId});
    return {missionId,nodes,edges:nodes.flatMap(c=>c.dependsOn.map(dep=>({from:dep,to:c.id,type:'depends_on'}))),ready:this.ready(missionId).map(c=>c.id)};
  }

  #assertNoCycle(candidate){
    const all=[...this.list({missionId:candidate.missionId}).filter(c=>c.id!==candidate.id),candidate];
    const map=new Map(all.map(c=>[c.id,c.dependsOn||[]]));
    const visiting=new Set(),done=new Set();
    const walk=(id)=>{if(visiting.has(id))throw new Error(`commitment graph cycle detected at '${id}'`);if(done.has(id))return;visiting.add(id);for(const dep of map.get(id)||[])if(map.has(dep))walk(dep);visiting.delete(id);done.add(id);};
    for(const id of map.keys())walk(id);
  }
  #ids(v){return Array.isArray(v)?[...new Set(v.slice(0,200).map(x=>String(x).trim().slice(0,240)).filter(Boolean))]:[];}
  #file(id){return path.join(this.dir,`${String(id).replace(/[^a-zA-Z0-9_.-]/g,'_')}.json`);}
}
