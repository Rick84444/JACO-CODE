import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, GitCommitHorizontal, RefreshCw, ShieldCheck, Wrench, AlertTriangle } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type CycleStatus = {
  success: boolean;
  schema: 'jaco.autonomous-cycle-board/v1';
  observedAt: string;
  lastEventAt: string | null;
  state: 'NOT_STARTED' | 'RECORDED' | 'COMPLETED';
  mode: 'DETERMINISTIC_SIMULATION';
  source: 'LOCAL_LEDGER';
  liveProcessObserved: false;
  mainMergeVerified: false;
  evidenceLevel: 'HASH_CHAIN_ONLY';
  summary: null | {
    cycles: number; targetCycles: number; phasesCompleted: number;
    fixesAccepted: number; proposalsRejected: number;
    reviewCasesExecuted: number; reviewCasesPassed: number;
    debtAudits: number; debtCleanups: number; debtBlockers: number;
    seniorApprovals: number; lastCycle: number; lastPhase: string | null;
    lastLocalGitHead: string | null;
  };
  timeline: Array<{
    seq: number; at: string; kind: string; role: string;
    cycle: number; phase: string | null; accepted: boolean | null; blockers: string[];
  }>;
};
type LeasedCycleStatus = {
  success: boolean;
  schema: 'jaco.continuum.cognitive-lab-lease.v1';
  state: 'NOT_STARTED'|'RECORDED'|'COMPLETED'|'RUNNING'|'STOPPING'|'RECONCILIATION_REQUIRED'|'UNAVAILABLE';
  simulation: 'DETERMINISTIC';
  run: null | {leaseId:string;operationId:string;targetCycle:number;lastCompletedCycle:number;error:string|null;receiptRef:string|null};
  unresolved: Array<{leaseId:string;operationId:string;status:string}>;
  remoteMainUpdated: false;
  independentModelDecisions: false;
  runtimeInstalled: boolean;
};
const labels: Record<string, string> = {
  'mission.scoped':'Requirements set', 'git.researched':'Git history researched',
  'code.changed':'Code proposal', 'debt.cleaned':'Technical debt cleaned',
  'debt.audited':'Debt audit', 'debt.blocked':'Stopped by debt steward',
  'review.attested':'Independent test record', 'debug.diagnosed':'Defect diagnosed',
  'senior.rejected':'Senior rejected', 'senior.approved':'Senior approved',
  'skill.promoted':'Knowledge preserved', 'cycle.completed':'Cycle completed',
};
const formattedTime = (input: string | null) => input && Number.isFinite(Date.parse(input))
  ? new Date(input).toLocaleString('en-US') : 'Not observed';

export function AutonomousCyclesPanel() {
  const [record,setRecord]=useState<CycleStatus|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [loading,setLoading]=useState(false);
  const [lease,setLease]=useState<{id:string;expiresAt:string}|null>(null);
  const [live,setLive]=useState<LeasedCycleStatus|null>(null);
  const [leaseBusy,setLeaseBusy]=useState(false);
  const [leaseError,setLeaseError]=useState<string|null>(null);
  const [leaseNotice,setLeaseNotice]=useState<string|null>(null);
  const readLease=useCallback(async (signal?:AbortSignal)=>{
    try {
      const response=await fetch('/api/continuum/autonomous-cycles/status',{
        cache:'no-store',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
      });
      const result=await readAuraResponse(response) as LeasedCycleStatus;
      if(result.schema!=='jaco.continuum.cognitive-lab-lease.v1')throw Error('Wrong run leash version.');
      if(!signal?.aborted){setLive(result);setLeaseError(null)}
    } catch(e){if(!signal?.aborted)setLeaseError(e instanceof Error?e.message:'Continuum is unreachable.')}
  },[]);
  const mutateLease=useCallback(async (operation:'lease'|'run'|'stop')=>{
    setLeaseBusy(true);setLeaseError(null);setLeaseNotice(null);
    try {
      const id=live?.run?.leaseId||lease?.id;
      const current=record?.summary?.cycles||0;
      const body=operation==='lease'?{durationMs:5*60_000}:operation==='run'?{
        leaseId:lease?.id,operationId:`ide-${crypto.randomUUID()}`,until:Math.min(33,current+3),
      }:{leaseId:id,reason:'operator stopped in IDE'};
      const response=await fetch(`/api/continuum/autonomous-cycles/${operation}`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
      });
      const result=await readAuraResponse(response);
      if(operation==='lease'){
        if(!result.lease?.id)throw Error('Lease ID missing.');
        setLease({id:result.lease.id,expiresAt:result.lease.expiresAt});
        setLeaseNotice('Execution lease created: one local mission, 0 USD cloud budget.');
      } else {
        setLeaseNotice(operation==='run'?'Run started. The journal updates automatically.':'Stop requested; unknown outcome is blocked.');
      }
      await readLease();
    } catch(e){setLeaseError(e instanceof Error?e.message:'Could not change run leash.');}
    finally {setLeaseBusy(false)}
  },[lease,live,readLease,record?.summary?.cycles]);


  const refresh=useCallback(async (signal?:AbortSignal) => {
    setLoading(true);
    try {
      const response=await fetch('/api/aura/workbench/autonomous-cycles',{
        cache:'no-store',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      const data=await readAuraResponse(response) as CycleStatus;
      if(!data.success||data.schema!=='jaco.autonomous-cycle-board/v1') throw new Error('The cycle report has the wrong schema.');
      if(signal?.aborted)return;
      setRecord(data);setError(null);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Could not read the development journal.');}
    finally{if(!signal?.aborted)setLoading(false);}
  },[]);
  useEffect(() => {
    let mounted = true;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      if (!mounted) return;
      if (document.visibilityState !== 'hidden') {
        request = new AbortController();
        await Promise.all([refresh(request.signal),readLease(request.signal)]);
      }
      if (mounted) timer = setTimeout(() => void poll(), 5000);
    };
    void poll();
    return () => {
      mounted = false;
      request?.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [refresh,readLease]);
  const summary=record?.summary;
  const progress=summary?Math.max(0,Math.min(100,Math.round(summary.cycles/Math.max(1,summary.targetCycles)*100))):0;
  const completed=record?.state==='COMPLETED';
  return <section className="min-w-0 h-full overflow-y-auto bg-[#050608] p-3 sm:p-5 text-neutral-200 space-y-4" data-testid="autonomous-cycles-panel" aria-label="Autonomous development journal">
    <header className="flex flex-wrap justify-between items-start gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold flex gap-2 items-center"><Activity className="w-4 h-4 text-neutral-300"/> Autonomous development</h3>
        <p className="text-xs text-neutral-400">User → Git Researcher → Developer → Debugger → Technical Debt Steward → Reviewer → Senior → local Git</p>
      </div>
      <button type="button" onClick={()=>void refresh()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded border border-neutral-800 text-neutral-200 text-xs disabled:opacity-50" aria-label="Refresh development journal">
        <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> {loading?'Loading…':'Refresh'}
      </button>
    </header>
    <div className="rounded-lg border border-neutral-900/70 bg-[#111214] p-3 space-y-2" data-testid="cognitive-lease-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Continuum Execution Leash</strong>
        <span className="text-xs text-neutral-400">{live?.state||'Not connected'} · Deterministic lab only</span>
      </div>
      <p className="text-xs text-neutral-400">A run changes only the lab's local .jaco workspace. Requires a real Continuum lease; no automatic GitHub merge or cloud spend.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={leaseBusy||live?.state==='RUNNING'||live?.state==='STOPPING'||live?.state==='RECONCILIATION_REQUIRED'||live?.state==='UNAVAILABLE'} onClick={()=>void mutateLease('lease')} className="px-3 py-2 border border-neutral-800 text-xs rounded disabled:opacity-40">Grant 5 min lease</button>
        <button type="button" disabled={leaseBusy||!lease||!live||live.state==='RUNNING'||live.state==='STOPPING'||live.state==='RECONCILIATION_REQUIRED'||live.state==='UNAVAILABLE'||record?.state==='COMPLETED'} onClick={()=>void mutateLease('run')} className="px-3 py-2 rounded bg-neutral-900/70 text-xs disabled:opacity-40">Run next 3 cycles</button>
        <button type="button" disabled={leaseBusy||!live?.run?.leaseId||!['RUNNING','STOPPING'].includes(live?.state||'')} onClick={()=>void mutateLease('stop')} className="px-3 py-2 border border-red-900 text-red-200 text-xs rounded disabled:opacity-40">Stop</button>
      </div>
      {lease && <p className="text-xs text-neutral-500 break-all">Lease {lease.id} · Expires {formattedTime(lease.expiresAt)}</p>}
      {live?.run && <p className="text-xs text-neutral-400 break-words">Operation {live.run.operationId} · Completed cycle {live.run.lastCompletedCycle}/{live.run.targetCycle}{live.run.receiptRef?` · Local receipt ${live.run.receiptRef}`:''}</p>}
      {live?.state==='UNAVAILABLE' && <p role="status" className="text-xs text-amber-200">The development engine is not present in this installation. Continuum and the IDE still work; the full JACO source installation is required to run the lab.</p>}
      {live?.state==='RECONCILIATION_REQUIRED' && <p role="alert" className="text-xs text-amber-200">Unknown outcome after stop/crash. No automatic rerun. Requires manual reconciliation of journal and lease.</p>}
      {leaseNotice && <p role="status" className="text-xs text-neutral-200">{leaseNotice}</p>}
      {leaseError && <p role="alert" className="text-xs text-amber-300">Continuum: {leaseError}. A connected IDE session or valid gateway authentication may be required.</p>}
    </div>
    {error && <div role="alert" className="rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">Cannot verify the local journal: {error}. Earlier observations are not current status.</div>}
    {!record&&!error && <p role="status" className="text-xs text-neutral-400">Reading local development journal…</p>}
    {record?.state==='NOT_STARTED' && <div className="rounded-lg border border-[#23445a] bg-[#131416] p-4 space-y-2">
      <p className="font-medium text-sm">No local cycle run recorded</p>
      <p className="text-xs text-neutral-400">This view does not start runs or GitHub merges automatically. The following command creates a local, deterministic run journal in the workspace:</p>
      <code className="block text-xs text-neutral-200 break-all rounded bg-[#08090b] p-3">node agents/cognitive-lab/autonomous-cycles/run.mjs run</code>
    </div>}
    {summary && <>
      <div className="rounded-lg border border-[#23445a] bg-[#101113] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold">{completed?'33 cycles completed':'Latest recorded cycles'}</span>
          <span className="text-neutral-400">{summary.cycles}/{summary.targetCycles} · {progress}%</span>
        </div>
        <div className="h-2 rounded bg-neutral-800 overflow-hidden" role="progressbar" aria-label="Completed cycles" aria-valuenow={summary.cycles} aria-valuemin={0} aria-valuemax={summary.targetCycles}>
          <div className="h-full bg-neutral-500" style={{width:`${progress}%`}}/>
        </div>
        <p className="text-[11px] text-neutral-400">Latest journal event: {formattedTime(record?.lastEventAt??null)} · Data source: local, saved history · Checked every five seconds while the view is visible</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        {[
          ['Accepted fixes',summary.fixesAccepted],
          ['Rejected proposals',summary.proposalsRejected],
          ['Debt audits',summary.debtAudits],
          ['Cleanups',summary.debtCleanups],
          ['Debt blockers',summary.debtBlockers],
          ['Senior approvals',summary.seniorApprovals],
          ['Passed test cases',`${summary.reviewCasesPassed}/${summary.reviewCasesExecuted}`],
          ['Regression cycles',summary.phasesCompleted],
        ].map(([name,val])=><div key={name} className="min-w-0 rounded border border-[#17344b] bg-[#0f1012] p-2.5">
          <strong className="block text-lg font-mono text-neutral-100 tabular-nums">{val}</strong>
          <span className="block text-neutral-400 break-words leading-4">{name}</span>
        </div>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded border border-[#193348] p-3 flex gap-2"><Wrench className="w-4 h-4 shrink-0 text-neutral-300"/><div><strong>Technical Debt Steward</strong><p className="text-neutral-400 mt-1">Code cleanup and checks before the reviewer's tests. Remaining debt blocks senior approval.</p></div></div>
        <div className="rounded border border-[#193348] p-3 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-neutral-300"/><div><strong>Evidence level and publishing</strong><p className="text-neutral-400 mt-1">Journal hash chain checked. HMAC review and GitHub CI are not checked by this view. No merge to main is proven here.</p></div></div>
      </div>
      <div className="rounded border border-[#193348] p-3 text-xs space-y-1">
        <div className="flex items-center gap-1.5"><GitCommitHorizontal className="w-4 h-4 text-neutral-300"/><strong>Local Git result</strong></div>
        <p className="text-neutral-400 break-all">{summary.lastLocalGitHead||'No local commit observed'}</p>
        <p className="text-neutral-500">A local Git commit is not the same as a merge to GitHub main.</p>
      </div>
    </>}
    {record && record.timeline.length>0 && <div className="rounded border border-[#193348] p-3">
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-neutral-300"/> Latest events</h4>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {record.timeline.map(item=><article key={item.seq} className="flex flex-wrap gap-1.5 justify-between rounded bg-[#0f1012] p-2 text-xs">
          <div className="min-w-0"><p className="font-medium">{labels[item.kind]||item.kind} <span className="text-neutral-500">· cycle {item.cycle}</span></p>
            <p className="text-neutral-400 break-words">{item.role}{item.phase?` · ${item.phase}`:''}{item.blockers.length?` · Blockers: ${item.blockers.join(', ')}`:''}</p>
          </div>
          <time className="shrink-0 text-neutral-500 text-[11px]">{formattedTime(item.at)}</time>
        </article>)}
      </div>
    </div>}
    <p className="text-[11px] text-neutral-500 flex gap-1.5 items-start"><AlertTriangle className="w-3.5 h-3.5 shrink-0"/> Roles and candidate strategies in this lab are deterministic. This is an actually executed simulation result when the journal exists, not proof of independent LLM agents or a running process.</p>
  </section>;
}