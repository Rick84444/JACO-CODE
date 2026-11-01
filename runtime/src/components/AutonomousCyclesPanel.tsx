import { useUiLanguage } from '../i18n/UiLanguage';
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
  'mission.scoped':"Requirements defined", 'git.researched':"Git history reviewed",
  'code.changed':"Code proposal", 'debt.cleaned':"Technical debt cleaned",
  'debt.audited':"Code quality check", 'debt.blocked':"Blocked by code quality check",
  'review.attested':"Independent test record", 'debug.diagnosed':"Error analyzed",
  'senior.rejected':"Final review rejected", 'senior.approved':"Final review approved",
  'skill.promoted':"Knowledge saved", 'cycle.completed':"Cycle completed",
};
const formattedTime = (input: string | null) => input && Number.isFinite(Date.parse(input))
  ? new Date(input).toLocaleString('sv-SE') : "Not observed";

export function AutonomousCyclesPanel() {
  const { t: uiText } = useUiLanguage();
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
      if(result.schema!=='jaco.continuum.cognitive-lab-lease.v1')throw Error(uiText("Unsupported execution session version."));
      if(!signal?.aborted){setLive(result);setLeaseError(null)}
    } catch(e){if(!signal?.aborted)setLeaseError(e instanceof Error?e.message:uiText("The development service could not be reached."))}
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
        if(!result.lease?.id)throw Error(uiText("Execution session ID is missing."));
        setLease({id:result.lease.id,expiresAt:result.lease.expiresAt});
        setLeaseNotice(uiText("Execution session created: one local task, no cloud spending."));
      } else {
        setLeaseNotice(operation==='run'?uiText("Run started. History refreshes automatically."):uiText("Stop requested; uncertain outcomes will be held for review."));
      }
      await readLease();
    } catch(e){setLeaseError(e instanceof Error?e.message:uiText("Could not change the execution session."));}
    finally {setLeaseBusy(false)}
  },[lease,live,readLease,record?.summary?.cycles]);


  const refresh=useCallback(async (signal?:AbortSignal) => {
    setLoading(true);
    try {
      const response=await fetch('/api/aura/workbench/autonomous-cycles',{
        cache:'no-store',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      const data=await readAuraResponse(response) as CycleStatus;
      if(!data.success||data.schema!=='jaco.autonomous-cycle-board/v1') throw new Error(uiText("The development report has an unsupported format."));
      if(signal?.aborted)return;
      setRecord(data);setError(null);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:uiText("Could not read development history."));}
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
  return <section className="min-w-0 h-full overflow-y-auto bg-[#02070c] p-3 sm:p-5 text-slate-200 space-y-4" data-testid="autonomous-cycles-panel" aria-label={uiText("Autonomous development history")}>
    <header className="flex flex-wrap justify-between items-start gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold flex gap-2 items-center"><Activity className="w-4 h-4 text-cyan-400"/> {' '}{uiText("Autonomous development")}</h3>
        <p className="text-xs text-slate-400">{uiText("Requirements → Research → Development → Debugging → Code quality → Review → Approval → Local Git")}</p>
      </div>
      <button type="button" onClick={()=>void refresh()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded border border-cyan-800 text-cyan-200 text-xs disabled:opacity-50" aria-label={uiText("Refresh development history")}>
        <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> {loading?uiText("Loading…"):uiText("Refresh")}
      </button>
    </header>
    <div className="rounded-lg border border-cyan-900/70 bg-[#061420] p-3 space-y-2" data-testid="cognitive-lease-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{uiText("Bounded development session")}</strong>
        <span className="text-xs text-slate-400">{live?.state||uiText("Not connected")} {' '}{uiText("· Deterministic lab only")}</span>
      </div>
      <p className="text-xs text-slate-400">{uiText("Runs change the local development workspace only. A valid execution session is required. Runs do not merge to GitHub or use paid cloud models.")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={leaseBusy||live?.state==='RUNNING'||live?.state==='STOPPING'||live?.state==='RECONCILIATION_REQUIRED'||live?.state==='UNAVAILABLE'} onClick={()=>void mutateLease('lease')} className="px-3 py-2 border border-cyan-800 text-xs rounded disabled:opacity-40">{uiText("Allow a 5-minute session")}</button>
        <button type="button" disabled={leaseBusy||!lease||!live||live.state==='RUNNING'||live.state==='STOPPING'||live.state==='RECONCILIATION_REQUIRED'||live.state==='UNAVAILABLE'||record?.state==='COMPLETED'} onClick={()=>void mutateLease('run')} className="px-3 py-2 rounded bg-cyan-900/70 text-xs disabled:opacity-40">{uiText("Run next 3 cycles")}</button>
        <button type="button" disabled={leaseBusy||!live?.run?.leaseId||!['RUNNING','STOPPING'].includes(live?.state||'')} onClick={()=>void mutateLease('stop')} className="px-3 py-2 border border-red-900 text-red-200 text-xs rounded disabled:opacity-40">{uiText("Stop")}</button>
      </div>
      {lease && <p className="text-xs text-slate-500 break-all">{uiText("Execution session")}{' '}{lease.id} {' '}{uiText("· Expires")}{' '}{formattedTime(lease.expiresAt)}</p>}
      {live?.run && <p className="text-xs text-slate-400 break-words">{uiText("Operation")}{' '}{live.run.operationId} {' '}{uiText("· Completed cycle")}{' '}{live.run.lastCompletedCycle}/{live.run.targetCycle}{live.run.receiptRef?` · Lokalt kvitto ${live.run.receiptRef}`:''}</p>}
      {live?.state==='UNAVAILABLE' && <p role="status" className="text-xs text-amber-200">{uiText("The development lab is not included in this installation. The workspace remains available. Install the full JACO source distribution to run the lab.")}</p>}
      {live?.state==='RECONCILIATION_REQUIRED' && <p role="alert" className="text-xs text-amber-200">{uiText("Outcome uncertain after a stop or crash. Review the history and execution session before running again.")}</p>}
      {leaseNotice && <p role="status" className="text-xs text-cyan-200">{leaseNotice}</p>}
      {leaseError && <p role="alert" className="text-xs text-amber-300">{uiText("Development service:")}{' '}{leaseError}{uiText(". A signed-in JACO session or valid gateway authentication may be required.")}</p>}
    </div>
    {error && <div role="alert" className="rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">{uiText("Could not verify local history:")}{' '}{error}{uiText(". Earlier observations do not confirm current status.")}</div>}
    {!record&&!error && <p role="status" className="text-xs text-slate-400">{uiText("Reading local development history…")}</p>}
    {record?.state==='NOT_STARTED' && <div className="rounded-lg border border-[#23445a] bg-[#081622] p-4 space-y-2">
      <p className="font-medium text-sm">{uiText("No local development run recorded")}</p>
      <p className="text-xs text-slate-400">{uiText("This view does not start runs or merge to GitHub automatically. The following command creates a local deterministic development history:")}</p>
      <code className="block text-xs text-cyan-200 break-all rounded bg-[#030a11] p-3">{uiText("node agents/cognitive-lab/autonomous-cycles/run.mjs run")}</code>
    </div>}
    {summary && <>
      <div className="rounded-lg border border-[#23445a] bg-[#07131f] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold">{completed?uiText("33 cycles completed"):uiText("Latest recorded cycles")}</span>
          <span className="text-slate-400">{summary.cycles}/{summary.targetCycles} · {progress}%</span>
        </div>
        <div className="h-2 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-label={uiText("Completed cycles")} aria-valuenow={summary.cycles} aria-valuemin={0} aria-valuemax={summary.targetCycles}>
          <div className="h-full bg-cyan-500" style={{width:`${progress}%`}}/>
        </div>
        <p className="text-[11px] text-slate-400">{uiText("Latest recorded event:")}{' '}{formattedTime(record?.lastEventAt??null)} {' '}{uiText("· Source: saved local history · Checked every five seconds while this view is visible")}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        {[
          [uiText("Accepted fixes"),summary.fixesAccepted],
          [uiText("Rejected proposals"),summary.proposalsRejected],
          [uiText("Code quality checks"),summary.debtAudits],
          [uiText("Cleanups"),summary.debtCleanups],
          [uiText("Code quality blockers"),summary.debtBlockers],
          [uiText("Final approvals"),summary.seniorApprovals],
          [uiText("Passed test cases"),`${summary.reviewCasesPassed}/${summary.reviewCasesExecuted}`],
          [uiText("Regression cycles"),summary.phasesCompleted],
        ].map(([name,val])=><div key={name} className="min-w-0 rounded border border-[#17344b] bg-[#07121d] p-2.5">
          <strong className="block text-lg font-mono text-cyan-100 tabular-nums">{val}</strong>
          <span className="block text-slate-400 break-words leading-4">{name}</span>
        </div>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded border border-[#193348] p-3 flex gap-2"><Wrench className="w-4 h-4 shrink-0 text-cyan-300"/><div><strong>{uiText("Code quality checks")}</strong><p className="text-slate-400 mt-1">{uiText("Code cleanup and checks before review tests. Unresolved technical debt blocks final approval.")}</p></div></div>
        <div className="rounded border border-[#193348] p-3 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-cyan-300"/><div><strong>{uiText("Verification and publication")}</strong><p className="text-slate-400 mt-1">{uiText("The history hash chain has been checked. This view does not check HMAC verification or GitHub CI, and does not confirm a merge to main.")}</p></div></div>
      </div>
      <div className="rounded border border-[#193348] p-3 text-xs space-y-1">
        <div className="flex items-center gap-1.5"><GitCommitHorizontal className="w-4 h-4 text-cyan-400"/><strong>{uiText("Local Git result")}</strong></div>
        <p className="text-slate-400 break-all">{summary.lastLocalGitHead||uiText("No local commit observed")}</p>
        <p className="text-slate-500">{uiText("A local Git commit does not confirm a merge to GitHub main.")}</p>
      </div>
    </>}
    {record && record.timeline.length>0 && <div className="rounded border border-[#193348] p-3">
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400"/> {' '}{uiText("Recent events")}</h4>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {record.timeline.map(item=><article key={item.seq} className="flex flex-wrap gap-1.5 justify-between rounded bg-[#07121c] p-2 text-xs">
          <div className="min-w-0"><p className="font-medium">{uiText(labels[item.kind]||item.kind)} <span className="text-slate-500">{uiText("· cycle")}{' '}{item.cycle}</span></p>
            <p className="text-slate-400 break-words">{item.role}{item.phase?` · ${item.phase}`:''}{item.blockers.length?` · Hinder: ${item.blockers.join(', ')}`:''}</p>
          </div>
          <time className="shrink-0 text-slate-500 text-[11px]">{formattedTime(item.at)}</time>
        </article>)}
      </div>
    </div>}
    <p className="text-[11px] text-slate-500 flex gap-1.5 items-start"><AlertTriangle className="w-3.5 h-3.5 shrink-0"/> {' '}{uiText("Roles and candidate strategies in this lab are deterministic. Recorded history shows a simulation run. It does not prove independent model agents or a currently running process.")}</p>
  </section>;
}