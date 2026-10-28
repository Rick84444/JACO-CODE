/**
 * Deterministic autonomous development-cycle laboratory.
 * Executes real candidate JS in a separate Node process and creates REAL local git commits.
 * Seven distinct scoped roles (simulated decision makers, not seven LLM instances).
 * Not a sandbox for hostile code, nor a source of production proof.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash,createHmac,randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ExecutionLeaseManager} from '../../../runtime/src/server/continuum/leaseManager.mjs';
import {CognitiveProgressGovernor} from '../../lib/cognitive-progress.mjs';
import {cleanTechnicalDebt} from './debt-steward.mjs';
import { CYCLE_ZERO_HASH as ZERO, hashCycleEvent, parseCycleLedger } from '../../lib/cognitive-cycle-ledger.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE=path.join(here,'task-engine.template.mjs');
const REVIEWER=path.join(here,'cycle-reviewer.mjs');
export const PHASES=Object.freeze(['validation','dedupe','retry','abort','persistence','fencing','permission','receipt','isolation','budgetPersistence','concurrency']);
export const MAX_CYCLES=PHASES.length*3;
const PERMISSIONS=Object.freeze({
  'user-agent':['scope'],
  'git-researcher':['inspect-diff','inspect-history'],
  'developer':['propose'],
  'autonomous-developer':['repair'],
  'debugger':['diagnose'],
  'technical-debt-steward':['audit-debt','clean-debt'],
  'reviewer':['verify'],
  'senior-developer':['approve','reject','observe'],
});
const hash=x=>createHash('sha256').update(x).digest('hex');
const canonical=x=>JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])));
function result(cmd,args,{cwd,timeout=12000}={}) {
  const proc=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout,maxBuffer:600000,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:os.devNull}});
  if(proc.error||proc.status!==0)throw new Error(`PROCESS_FAILED ${cmd} ${args.join(' ')}: ${proc.error?.message||proc.stderr?.slice(0,450)} (exit ${proc.status})`);
  return proc.stdout.trim();
}
function git(root,...args){return result('git',['-C',root,...args]);}
function validateRoot(state){
  const root=path.resolve(state);if(root==='/'||root===os.homedir()||root===process.cwd())throw new Error('STATE_ROOT_UNSAFE');
  let current=path.parse(root).root;
  for(const part of root.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);
    try{if(fs.lstatSync(current).isSymbolicLink())throw new Error('STATE_SYMLINK_DENIED')}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return root;
}
function safeFile(file){try{const st=fs.lstatSync(file);if(st.isSymbolicLink()||!st.isFile())throw new Error('FILE_NOT_REGULAR')}catch(e){if(e.code!=='ENOENT')throw e;}return file;}
function saveJson(file,body){safeFile(file);const temp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(body,null,2)+'\n',{mode:0o600,flag:'wx'});fs.renameSync(temp,file)}
function allowed(role,action){if(!PERMISSIONS[role]?.includes(action))throw new Error(`ROLE_CAPABILITY_DENIED:${role}:${action}`);}
function authorityKey(root){const file=path.join(root,'.cycle-authority.key');if(!fs.existsSync(file))fs.writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==32||(stat.mode&0o077)!==0)throw new Error('AUTHORITY_KEY_UNSAFE');return fs.readFileSync(file)}
function sign(root,payload){const mac=createHmac('sha256',authorityKey(root)).update(canonical(payload)).digest('hex');return {...payload,mac}}
function verify(root,record){if(!record||!/^[a-f0-9]{64}$/.test(record.mac||''))return false;const {mac,...payload}=record;const actual=createHmac('sha256',authorityKey(root)).update(canonical(payload)).digest();return timingSafeEqual(actual,Buffer.from(mac,'hex'))}
export function readCycleLedger(root){
 const file=path.join(validateRoot(root),'events.jsonl');
 if(!fs.existsSync(file))return [];
 safeFile(file);
 return parseCycleLedger(fs.readFileSync(file,'utf8'));
}
function writer(root){let log=readCycleLedger(root);return (type,role,data)=>{if(!PERMISSIONS[role]&&role!=='controller')throw new Error('UNKNOWN_ACTOR');const e={schema:'jaco.autonomous-cycle-event/v1',seq:log.length+1,at:new Date().toISOString(),type,role,data,prev:log.at(-1)?.hash??ZERO};e.hash=hashCycleEvent(e);fs.appendFileSync(safeFile(path.join(root,'events.jsonl')),JSON.stringify(e)+'\n',{mode:0o600});log.push(e);return e};}
function candidateSource(features){const rendered=fs.readFileSync(TEMPLATE,'utf8').replace('/*__FEATURES__*/',JSON.stringify(features));if(rendered.includes('__FEATURES__'))throw new Error('UNFILLED_TEMPLATE');return rendered;}
function evidencePath(root,cycle){return path.join(root,'evidence',`cycle-${String(cycle).padStart(2,'0')}.json`)}
function verifyOldReports(root,ledger){for(const entry of ledger.filter(x=>x.type==='review.attested')){const file=evidencePath(root,entry.data.cycle);if(!fs.existsSync(file))throw new Error('REVIEW_EVIDENCE_MISSING');const proof=JSON.parse(fs.readFileSync(file,'utf8'));if(!verify(root,proof)||proof.cycle!==entry.data.cycle||proof.codeHash!==entry.data.codeHash||proof.passed!==entry.data.passed||proof.total!==entry.data.total)throw new Error('REVIEW_EVIDENCE_TAMPERED');}}
function initialize(root){fs.mkdirSync(root,{recursive:true,mode:0o700});for(const d of ['work','evidence','agents'])fs.mkdirSync(path.join(root,d),{recursive:true,mode:0o700});for(const role of Object.keys(PERMISSIONS)){
 const dir=path.join(root,'agents',role);fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'capsule.json');if(!fs.existsSync(file))saveJson(file,{agentId:role,skills:PERMISSIONS[role],prompt:`Act as ${role}; do not exceed assigned capability. Report uncertainty.`,memory:{}});
 const config=JSON.parse(fs.readFileSync(file,'utf8'));if(config.agentId!==role||JSON.stringify(config.skills)!==JSON.stringify(PERMISSIONS[role]))throw new Error('ROLE_CAPSULE_MUTATED');
 }
 const work=path.join(root,'work'),source=path.join(work,'task-engine.mjs');
 if(!fs.existsSync(path.join(work,'.git'))){
  git(work,'init','-q');git(work,'config','user.name','JACO Simulation');git(work,'config','user.email','jaco-simulator@invalid.local');
  const flags=Object.fromEntries(PHASES.map(x=>[x,false]));flags.budget=true;
  fs.writeFileSync(source,candidateSource(flags));git(work,'add','task-engine.mjs');git(work,'commit','-qm','baseline: deterministic task engine');
  saveJson(path.join(root,'knowledge.json'),{schema:'jaco.autonomous-knowledge/v1',accepted:[],version:0});
 }
 if(!fs.existsSync(source))throw new Error('WORKSPACE_MISSING');authorityKey(root);return {root,work,source};
}
function reviewChild(source,phase,holdout){const p=spawnSync(process.execPath,[REVIEWER,source,String(phase),holdout?'yes':'no'],{encoding:'utf8',cwd:path.dirname(source),timeout:12000,maxBuffer:150000,env:{PATH:process.env.PATH||'',HOME:os.tmpdir()}});
 if(p.error||![0,2].includes(p.status))throw new Error('REVIEW_CHILD_FAILED:'+String(p.error?.message||p.stderr?.slice(0,150)));
 const d=JSON.parse(p.stdout);const currentHash=hash(fs.readFileSync(source));if(d.codeHash!==currentHash||d.phase!==phase||d.holdout!==holdout||d.passed!==d.cases.filter(c=>c.passed).length||d.total!==d.cases.length||d.accepted!==(p.status===0))throw new Error('UNTRUSTED_REVIEW_RESULT');
 return {report:d,exitCode:p.status,stdoutHash:hash(p.stdout),stderrHash:hash(p.stderr)};
}
function validateKnowledge(root,work,knowledge){
 if(knowledge.schema!=='jaco.autonomous-knowledge/v1'||!Array.isArray(knowledge.accepted))throw new Error('KNOWLEDGE_SCHEMA_INVALID');
 const seen=new Set();
 for(const k of knowledge.accepted){
  if(!PHASES.includes(k.phase)||seen.has(k.phase))throw new Error('KNOWLEDGE_PHASE_INVALID');seen.add(k.phase);
  const file=path.join(root,'evidence',k.evidence);
  const ev=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!verify(root,ev)||ev.phase!==k.phase||ev.codeHash!==k.codeHash||ev.accepted!==true||ev.passed!==ev.total)
   throw new Error('KNOWLEDGE_EVIDENCE_UNTRUSTED');
  const code=git(work,'show',`${k.commit}:task-engine.mjs`);
  if(hash(code+'\n')!==k.codeHash && hash(code)!==k.codeHash)throw new Error('KNOWLEDGE_COMMIT_MISMATCH');
 }
 return [...seen];
}
function runLease(root,cycle){const events={append(){}};const mgr=new ExecutionLeaseManager(root,events,{assertExecutionAllowed(){}},null);const missionId=`cycle-${cycle}`;const leases=Object.fromEntries(Object.entries(PERMISSIONS).map(([role,actions])=>{
 const lease=mgr.issue({missionId,agentId:role,allowedActions:actions,maxActions:10,durationMs:600000,maxCloudUsd:0});return [role,lease.id]}));
 const authorize=(role,action)=>{allowed(role,action);return mgr.authorize(leases[role],{action,missionId,agentId:role})};
 const reserve=(role,action,id)=>{allowed(role,action);return mgr.beginAction(leases[role],{operationId:id,action,missionId,agentId:role})};
 const finish=(role,id,res,receipt)=>mgr.finishAction(leases[role],{operationId:id,generation:res.generation,receiptRef:receipt});
 return{authorize,reserve,finish};
}
export function inspectCycles(state){const root=validateRoot(state);const log=readCycleLedger(root);if(log.length)verifyOldReports(root,log);const complete=log.filter(x=>x.type==='cycle.completed'),fixed=complete.filter(x=>x.data.mode==='repair'&&x.data.accepted).length,rejected=complete.filter(x=>!x.data.accepted).length;let gitCommits=0;
 const repo=path.join(root,'work');if(fs.existsSync(path.join(repo,'.git')))gitCommits=Number(git(repo,'rev-list','--count','HEAD'));
 return{schema:'jaco.autonomous-cycles-summary/v1',simulation:'DETERMINISTIC',cycles:complete.length,maxCycles:MAX_CYCLES,fixesAccepted:fixed,proposalsRejected:rejected,regressionCycles:complete.filter(x=>x.data.mode==='regression').length,reviewCasesExecuted:complete.reduce((n,x)=>n+x.data.total,0),reviewCasesPassed:complete.reduce((n,x)=>n+x.data.passed,0),actualGitCommits:gitCommits,debtAudits:log.filter(x=>x.type==='debt.audited').length,debtCleanups:log.filter(x=>x.type==='debt.cleaned').length,debtBlockers:log.filter(x=>x.type==='debt.blocked').length,events:log.length,ledgerTip:log.at(-1)?.hash??ZERO,completed:complete.length===MAX_CYCLES,skillsPromoted:fs.existsSync(path.join(root,'knowledge.json'))?JSON.parse(fs.readFileSync(path.join(root,'knowledge.json'),'utf8')).accepted.length:0};
}
export async function runCycles(state,{until=MAX_CYCLES}={}){
 if(!Number.isInteger(until)||until<1||until>MAX_CYCLES)throw new Error('INVALID_CYCLE_LIMIT');
 const root=validateRoot(state);const {work,source}=initialize(root);const lock=path.join(root,'.run-lock');
 try{fs.mkdirSync(lock,{mode:0o700})}catch(e){if(e.code==='EEXIST')throw new Error('SIMULATION_CONCURRENT_WRITER');throw e}
 try{
  const entries=readCycleLedger(root);verifyOldReports(root,entries);const completed=entries.filter(e=>e.type==='cycle.completed');if(entries.length&&entries.at(-1).type!=='cycle.completed')throw new Error('SIMULATION_UNCERTAIN_RESUME');
  const write=writer(root);
  for(let cycle=completed.length+1;cycle<=until;cycle++){
   const i=Math.floor((cycle-1)/3),phase=PHASES[i],step=(cycle-1)%3,mode=['propose','repair','regression'][step];
   const lease=runLease(root,cycle);const knowledge=JSON.parse(fs.readFileSync(path.join(root,'knowledge.json'),'utf8'));
   const recalled=validateKnowledge(root,work,knowledge);const flags=Object.fromEntries(PHASES.map(p=>[p,recalled.includes(p)||(p===phase&&mode!=='propose')]));flags.budget=true;
   lease.authorize('user-agent','scope');write('mission.scoped','user-agent',{cycle,phase,criteria:`pass independent ${phase} checks; retain all previous guarantees`,priorSkills:recalled.length});
   lease.authorize('git-researcher','inspect-history');const headBefore=git(work,'rev-parse','HEAD');const cleanBefore=git(work,'status','--porcelain');if(cleanBefore)throw new Error('WORKTREE_NOT_CLEAN_AT_CYCLE_START');
   write('git.researched','git-researcher',{cycle,headBefore,commitCount:Number(git(work,'rev-list','--count','HEAD')),memoryAvailable:recalled.length});
   if(mode!=='regression'){
    const role=mode==='propose'?'developer':'autonomous-developer';lease.authorize(role,mode);fs.writeFileSync(source,candidateSource(flags)+`\n// candidate ${cycle}: ${mode} for ${phase}\n`);
    write('code.changed',role,{cycle,mode,phase,codeHash:hash(fs.readFileSync(source))});
   }else{lease.authorize('senior-developer','observe');write('regression.started','senior-developer',{cycle,phase,previouslyApproved:true});}
   lease.authorize('git-researcher','inspect-diff');const changed=git(work,'diff','--name-only');if(mode!=='regression'&&changed!=='task-engine.mjs')throw new Error('UNEXPECTED_GIT_MUTATION');if(mode==='regression'&&changed)throw new Error('REGRESSION_DIRTY_WORKTREE');
   // The Debt Steward is a real source-to-source transformation step. It cannot approve itself.
   lease.authorize('technical-debt-steward','audit-debt');
   const debt=cleanTechnicalDebt(fs.readFileSync(source,'utf8'));
   if(debt.changed){
    lease.authorize('technical-debt-steward','clean-debt');
    fs.writeFileSync(source,debt.source,{flag:'w'});
    write('debt.cleaned','technical-debt-steward',{cycle,phase,beforeHash:debt.beforeHash,afterHash:debt.afterHash,removedCandidateComments:debt.removedCandidateComments});
   }
   write('debt.audited','technical-debt-steward',{cycle,phase,accepted:debt.accepted,blockers:debt.blockers,codeHash:debt.afterHash});
   if(!debt.accepted){
    write('debt.blocked','technical-debt-steward',{cycle,phase,blockers:debt.blockers});
    throw new Error(`TECHNICAL_DEBT_BLOCKED:${debt.blockers.join(',')}`);
   }
   if(hash(fs.readFileSync(source))!==debt.afterHash)throw new Error('DEBT_SOURCE_CHANGED_BEFORE_REVIEW');
   const opId=`cycle-${cycle}-review`;const reservation=lease.reserve('reviewer','verify',opId);
   let review;try{review=reviewChild(source,i+1,cycle===MAX_CYCLES);lease.finish('reviewer',opId,reservation,`sha256:${review.report.codeHash}`);}catch(e){throw new Error(`UNCERTAIN_REVIEW_OUTCOME:${e.message}`)}
   const r=review.report;
   const sealed=sign(root,{schema:'jaco.autonomous-review-proof/v1',cycle,phase,codeHash:r.codeHash,reviewerHash:hash(fs.readFileSync(REVIEWER)),passed:r.passed,total:r.total,accepted:r.accepted,exitCode:review.exitCode,stdoutHash:review.stdoutHash,stderrHash:review.stderrHash,debtHash:debt.afterHash,debtCleaned:debt.changed,debtBlockers:debt.blockers,cases:r.cases});
   saveJson(evidencePath(root,cycle),sealed);
   write('review.attested','reviewer',{cycle,phase,mode,codeHash:r.codeHash,passed:r.passed,total:r.total,accepted:r.accepted,debtAccepted:debt.accepted,debtHash:debt.afterHash,failed:r.cases.filter(x=>!x.passed).map(x=>x.name)});
   if(!r.accepted){
    lease.authorize('debugger','diagnose');const diagnosis=r.cases.filter(x=>!x.passed).map(x=>x.name);
    write('debug.diagnosed','debugger',{cycle,phase,failed:diagnosis,remedy:`enable and verify ${phase} contract; do not bypass failing assertions`});
    lease.authorize('senior-developer','reject');
    write('senior.rejected','senior-developer',{cycle,reason:'independent behavioral tests failed',failed:diagnosis});
    fs.writeFileSync(source,git(work,'show','HEAD:task-engine.mjs')+'\n');
    // git show strips trailing newlines; source hash is the actual commit content, not narrative.
    if(git(work,'status','--porcelain'))throw new Error('REJECT_ROLLBACK_INCOMPLETE');
   }else{
    if(!debt.accepted || debt.afterHash!==r.codeHash)throw new Error('SENIOR_DEBT_GATE_FAILED');
    lease.authorize('senior-developer','approve');
    // Standalone deterministic progress guard: a new passing implementation is distinct.
    const governor=new CognitiveProgressGovernor({maxSteps:1,maxStalls:0});governor.before(`${phase}:${r.codeHash}`);governor.observe(`${phase}:${r.codeHash}`,{passed:r.passed,total:r.total,codeHash:r.codeHash});
    write('senior.approved','senior-developer',{cycle,phase,mode,codeHash:r.codeHash,tests:r.total,verification:'child-exit+HMAC',debtGate:'clean-and-reviewed'});
    if(mode==='repair'){
      git(work,'add','task-engine.mjs');git(work,'commit','-qm',`feat(task-engine): independently verify ${phase}`);
      const commit=git(work,'rev-parse','HEAD');
      const newSkill={phase,codeHash:r.codeHash,commit,evidence:`cycle-${String(cycle).padStart(2,'0')}.json`,cycle};
      knowledge.accepted.push(newSkill);knowledge.version++;
      saveJson(path.join(root,'knowledge.json'),knowledge);
      write('skill.promoted','senior-developer',{cycle,phase,commit,codeHash:r.codeHash,reviewEvidence:newSkill.evidence});
    }
   }
   write('cycle.completed','controller',{cycle,phase,mode,accepted:r.accepted,passed:r.passed,total:r.total,codeHash:r.codeHash,gitHead:git(work,'rev-parse','HEAD'),memoryCount:knowledge.accepted.length});
  }
  const report=inspectCycles(root);saveJson(path.join(root,'summary.json'),report);return report;
 }finally{fs.rmdirSync(lock)}
}
export function adversarialChecks(state){const root=validateRoot(state),proof=JSON.parse(fs.readFileSync(evidencePath(root,MAX_CYCLES),'utf8'));const forged={...proof,passed:proof.passed+1};
 let forbidden=false;try{allowed('developer','approve')}catch(e){forbidden=e.message.startsWith('ROLE_CAPABILITY_DENIED')}
 const journal=readCycleLedger(root);const tamperDetection=journal.length>0&&journal.at(-1).hash===hashCycleEvent(journal.at(-1));
 return{forgedProofRejected:!verify(root,forged),developerCannotApprove:forbidden,ledgerIntegrityVerified:tamperDetection};
}
