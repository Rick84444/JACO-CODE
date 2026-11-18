import path from 'node:path';
import { atomicWriteJson, readJson, nowIso, makeId, deepClone, redactSensitive } from './util.mjs';

/**
 * Hypothesis Engine stores and ranks explicit candidates. It does not fabricate
 * reasoning: candidate generation can come from a model, memory retrieval or a
 * deterministic strategy generator, while evaluation is evidence/metric based.
 */
export class HypothesisEngine {
  constructor(root,events,evidence=null){this.file=path.join(root,'hypotheses.json');this.events=events;this.evidence=evidence;this.state=readJson(this.file,{sets:{},updatedAt:nowIso()});}
  createSet(input,actor='planner'){
    const id=input.id?String(input.id).slice(0,180):makeId('hyp');const set={schema:'jaco.continuum.hypothesis-set.v1',id,missionId:input.missionId?String(input.missionId).slice(0,180):null,problem:String(input.problem||'').slice(0,5000),criteria:Array.isArray(input.criteria)?input.criteria.slice(0,50).map(c=>({name:String(c.name||'').slice(0,120),weight:Number.isFinite(Number(c.weight))?Number(c.weight):1,direction:c.direction==='min'?'min':'max'})):[],candidates:[],status:'OPEN',winnerId:null,createdAt:nowIso(),updatedAt:nowIso()};this.state.sets[id]=set;this.#save();this.events.append({stream:'hypothesis',type:'hypothesis.set_created',entityId:id,actor,data:{problem:set.problem,criteria:set.criteria}});return deepClone(set);
  }
  addCandidate(setId,input,actor='reasoner'){const set=this.#getMutable(setId);if(set.status!=='OPEN')throw new Error('hypothesis set is closed');const c={id:input.id?String(input.id).slice(0,180):makeId('candidate'),label:String(input.label||'candidate').slice(0,240),proposal:input.proposal??null,provenance:String(input.provenance||actor).slice(0,240),metrics:{},evidenceRefs:[],terminalEvidenceRefs:[],status:'PROPOSED',createdAt:nowIso()};set.candidates.push(c);set.updatedAt=nowIso();this.#save();this.events.append({stream:'hypothesis',type:'hypothesis.candidate_added',entityId:c.id,actor,data:{setId,label:c.label,provenance:c.provenance}});return deepClone(c);}
  evaluate(setId,candidateId,{metrics={},evidenceRefs=[],status='EVALUATED',reason=null}={},actor='verifier'){
    const set=this.#getMutable(setId);if(set.status!=='OPEN')throw new Error('hypothesis set is closed');
    const c=set.candidates.find(x=>x.id===candidateId);if(!c)throw new Error('candidate not found');if(c.status==='FALSIFIED')throw new Error('falsified candidate is closed');
    if(!['EVALUATED','VERIFIED','FALSIFIED'].includes(status))throw new Error('invalid hypothesis evaluation status');
    const submittedRefs=[...new Set((Array.isArray(evidenceRefs)?evidenceRefs:[]).map(String))];
    const refs=[...new Set([...(c.evidenceRefs||[]),...submittedRefs])];
    if(status==='VERIFIED'||status==='FALSIFIED'){
      if(!submittedRefs.length)throw new Error(`${status} hypothesis requires evidenceRefs`);
      if(!this.evidence)throw new Error(`${status} hypothesis requires an evidence ledger`);
      this.evidence.assertRefs(submittedRefs,{verified:true});
    }else if(this.evidence&&submittedRefs.length)this.evidence.assertRefs(submittedRefs,{verified:false});
    if(status==='FALSIFIED'&&!String(reason||'').trim())throw new Error('falsification reason required');
    c.metrics={...c.metrics,...metrics};c.evidenceRefs=refs;c.terminalEvidenceRefs=(status==='VERIFIED'||status==='FALSIFIED')?submittedRefs:[];c.status=status;c.rejectionReason=status==='FALSIFIED'?redactSensitive(String(reason).slice(0,2000)):null;c.evaluatedAt=nowIso();set.updatedAt=nowIso();this.#save();
    this.events.append({stream:'hypothesis',type:status==='FALSIFIED'?'hypothesis.candidate_falsified':'hypothesis.candidate_evaluated',entityId:c.id,actor,data:{setId,metrics:c.metrics,evidenceRefs:c.evidenceRefs,terminalEvidenceRefs:c.terminalEvidenceRefs,status,reason:c.rejectionReason}});return deepClone(c);
  }
  #criteria(set){return set.criteria.filter(c=>Number.isFinite(Number(c.weight))&&Number(c.weight)>0);}
  #metric(candidate,name){const raw=candidate.metrics?.[name];return typeof raw==='number'&&Number.isFinite(raw)?raw:NaN;}
  #complete(candidate,criteria){return criteria.every(c=>Number.isFinite(this.#metric(candidate,c.name)));}
  #proof(candidate){return candidate.status==='VERIFIED'&&candidate.terminalEvidenceRefs?.length?candidate.terminalEvidenceRefs:candidate.evidenceRefs;}
  #hasProof(candidate){try {const refs=this.#proof(candidate);if(!refs?.length||!this.evidence)return false;this.evidence.assertRefs(refs,{verified:true});return true;}catch{return false;}}
  rank(setId,{verifiedOnly=false}={}){
    const set=this.#getMutable(setId),criteria=this.#criteria(set);
    const complete=set.candidates.filter(c=>['EVALUATED','VERIFIED'].includes(c.status)&&this.#complete(c,criteria)&&(!verifiedOnly||this.#hasProof(c)));
    const ranges=criteria.map(c=>{let lo=Infinity,hi=-Infinity;for(const x of complete){const v=this.#metric(x,c.name);lo=Math.min(lo,v);hi=Math.max(hi,v);}return {c,lo,hi};});
    const total=criteria.reduce((sum,c)=>sum+Number(c.weight),0);
    return complete.map(candidate=>{
      let score=0;
      for(const {c,lo,hi} of ranges){
        const raw=this.#metric(candidate,c.name);
        // Scale before subtraction to avoid overflow with finite extreme metrics.
        const scale=Math.max(Math.abs(lo),Math.abs(hi),1);
        const span=hi/scale-lo/scale;
        const normalized=span>0?Math.max(0,Math.min(1,(raw/scale-lo/scale)/span)):0.5;
        score+=(c.direction==='min'?1-normalized:normalized)*(Number(c.weight)/total);
      }
      return {...deepClone(candidate),score:total?score:0};
    }).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  }
  selectWinner(setId,candidateId=null,actor='planner'){
    const set=this.#getMutable(setId);if(set.status!=='OPEN')throw new Error('hypothesis set is closed');const ranked=this.rank(setId,{verifiedOnly:true});const winner=candidateId?set.candidates.find(c=>c.id===candidateId):ranked[0];if(!winner)throw new Error('no evaluated candidate with verified evidence available');if(!['EVALUATED','VERIFIED'].includes(winner.status)||!this.#complete(winner,this.#criteria(set)))throw new Error('candidate is not eligible for selection: incomplete evaluation');
    const proofRefs=winner.status==='VERIFIED'&&winner.terminalEvidenceRefs?.length?winner.terminalEvidenceRefs:winner.evidenceRefs;
    if(!proofRefs?.length||!this.evidence)throw new Error('winner requires verified evidence');this.evidence.assertRefs(proofRefs,{verified:true});set.winnerId=winner.id;set.status='SELECTED';set.updatedAt=nowIso();this.#save();this.events.append({stream:'hypothesis',type:'hypothesis.winner_selected',entityId:setId,actor,data:{winnerId:winner.id,evidenceRefs:proofRefs}});return deepClone(set);
  }
  get(id){return deepClone(this.#getMutable(id));}
  list(){return Object.values(this.state.sets).map(deepClone);}
  #getMutable(id){const s=this.state.sets[id];if(!s)throw new Error(`hypothesis set '${id}' not found`);return s;}
  #save(){this.state.updatedAt=nowIso();atomicWriteJson(this.file,this.state);}
}
