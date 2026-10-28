/** Read-only, bounded projection of the local deterministic developer-cycle ledger. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const ZERO='0'.repeat(64);
const HASH=x=>createHash('sha256').update(x).digest('hex');
const MAX_BYTES=8_000_000;
const MAX_EVENTS=2000;
const MAX_TIMELINE=30;
const INTERESTING=new Set(['mission.scoped','git.researched','code.changed','debt.cleaned','debt.audited','debt.blocked','review.attested','debug.diagnosed','senior.rejected','senior.approved','skill.promoted','cycle.completed']);
function readRegular(file, max=MAX_BYTES){
 const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error('CYCLE_SOURCE_UNSAFE');
 return fs.readFileSync(file,'utf8');
}
function safeStateRoot(workspaceRoot){
 const root=path.resolve(workspaceRoot,'.jaco','autonomous-cycles');
 // A symlink under the workspace cannot be used to make the dashboard read arbitrary files.
 for(const file of [path.resolve(workspaceRoot),path.join(path.resolve(workspaceRoot),'.jaco'),root]){
  if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw Error('CYCLE_ROOT_SYMLINK_DENIED');
 }
 return root;
}
function sealedEvents(text){
 if(text&&!text.endsWith('\n'))throw Error('CYCLE_LEDGER_INCOMPLETE');
 let prev=ZERO;const events=[];
 for(const line of text.split('\n')){
  if(!line)continue;
  if(events.length>=MAX_EVENTS)throw Error('CYCLE_LEDGER_TOO_LARGE');
  const ev=JSON.parse(line),{hash:stored,...unsigned}=ev;
  const check=HASH(JSON.stringify(unsigned));
  if(!ev||ev.seq!==events.length+1||ev.prev!==prev||stored!==check)throw Error('CYCLE_LEDGER_INTEGRITY_FAILED');
  prev=stored;events.push(ev);
 }
 return events;
}
export function readAutonomousCycleBoard(workspaceRoot){
 const observedAt=new Date().toISOString();const root=safeStateRoot(workspaceRoot);
 const file=path.join(root,'events.jsonl');
 const basic={success:true,schema:'jaco.autonomous-cycle-board/v1',observedAt,mode:'DETERMINISTIC_SIMULATION',state:'NOT_STARTED',source:'LOCAL_LEDGER',liveProcessObserved:false,mainMergeVerified:false,evidenceLevel:'HASH_CHAIN_ONLY'};
 if(!fs.existsSync(file))return {...basic,summary:null,lastEventAt:null,timeline:[]};
 const events=sealedEvents(readRegular(file));
 if(!events.length)return {...basic,summary:null,lastEventAt:null,timeline:[]};
 const complete=events.filter(e=>e.type==='cycle.completed');
 const last=events.at(-1);
 const debt=events.filter(e=>e.type==='debt.audited');
 const summary={
  cycles:complete.length,
  targetCycles:33,
  phasesCompleted:complete.filter(e=>e.data?.mode==='regression').length,
  fixesAccepted:complete.filter(e=>e.data?.mode==='repair'&&e.data?.accepted).length,
  proposalsRejected:complete.filter(e=>!e.data?.accepted).length,
  reviewCasesExecuted:complete.reduce((n,e)=>n+Number(e.data?.total||0),0),
  reviewCasesPassed:complete.reduce((n,e)=>n+Number(e.data?.passed||0),0),
  debtAudits:debt.length,
  debtCleanups:events.filter(e=>e.type==='debt.cleaned').length,
  debtBlockers:events.filter(e=>e.type==='debt.blocked').length,
  seniorApprovals:events.filter(e=>e.type==='senior.approved').length,
  lastCycle:complete.at(-1)?.data?.cycle??0,
  lastPhase:complete.at(-1)?.data?.phase??null,
  lastLocalGitHead:complete.at(-1)?.data?.gitHead??null,
 };
 const timeline=events.filter(e=>INTERESTING.has(e.type)).slice(-MAX_TIMELINE).reverse().map(e=>({
  seq:e.seq,at:e.at,kind:e.type,role:e.role,
  cycle:Number(e.data?.cycle||0),phase:typeof e.data?.phase==='string'?e.data.phase.slice(0,80):null,
  accepted:typeof e.data?.accepted==='boolean'?e.data.accepted:null,
  blockers:Array.isArray(e.data?.blockers)?e.data.blockers.filter(x=>typeof x==='string').slice(0,6):[],
 }));
 return {...basic,state:summary.cycles===summary.targetCycles&&last.type==='cycle.completed'?'COMPLETED':'RECORDED',lastEventAt:last.at,summary,timeline};
}