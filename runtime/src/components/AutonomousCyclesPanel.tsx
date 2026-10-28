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
  state: 'NOT_STARTED'|'RECORDED'|'COMPLETED'|'RUNNING'|'STOPPING'|'RECONCILIATION_REQUIRED';
  simulation: 'DETERMINISTIC';
  run: null | {leaseId:string;operationId:string;targetCycle:number;lastCompletedCycle:number;error:string|null;receiptRef:string|null};
  unresolved: Array<{leaseId:string;operationId:string;status:string}>;
  remoteMainUpdated: false;
  independentModelDecisions: false;
};
const labels: Record<string, string> = {
  'mission.scoped':'Krav fastställda', 'git.researched':'Git-historik undersökt',
  'code.changed':'Kodförslag', 'debt.cleaned':'Teknisk skuld rensad',
  'debt.audited':'Skuldkontroll', 'debt.blocked':'Stoppad av skuldagent',
  'review.attested':'Oberoende testprotokoll', 'debug.diagnosed':'Fel analyserat',
  'senior.rejected':'Senior avvisade', 'senior.approved':'Senior godkände',
  'skill.promoted':'Kunskap bevarad', 'cycle.completed':'Cykel avslutad',
};
const formattedTime = (input: string | null) => input && Number.isFinite(Date.parse(input))
  ? new Date(input).toLocaleString('sv-SE') : 'Inte observerat';

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
      if(result.schema!=='jaco.continuum.cognitive-lab-lease.v1')throw Error('Fel version på körleash.');
      if(!signal?.aborted){setLive(result);setLeaseError(null)}
    } catch(e){if(!signal?.aborted)setLeaseError(e instanceof Error?e.message:'Continuum kan inte nås.')}
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
        if(!result.lease?.id)throw Error('Leasens ID saknas.');
        setLease({id:result.lease.id,expiresAt:result.lease.expiresAt});
        setLeaseNotice('Execution lease skapad: ett lokalt uppdrag, 0 USD molnbudget.');
      } else {
        setLeaseNotice(operation==='run'?'Körning startad. Journalen uppdateras automatiskt.':'Stopp begärt; osäkert utfall spärras.');
      }
      await readLease();
    } catch(e){setLeaseError(e instanceof Error?e.message:'Kunde inte ändra körleash.');}
    finally {setLeaseBusy(false)}
  },[lease,live,readLease,record?.summary?.cycles]);


  const refresh=useCallback(async (signal?:AbortSignal) => {
    setLoading(true);
    try {
      const response=await fetch('/api/aura/workbench/autonomous-cycles',{
        cache:'no-store',signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      const data=await readAuraResponse(response) as CycleStatus;
      if(!data.success||data.schema!=='jaco.autonomous-cycle-board/v1') throw new Error('Cykelrapporten har fel schema.');
      if(signal?.aborted)return;
      setRecord(data);setError(null);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Kunde inte läsa utvecklingsjournalen.');}
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
  return <section className="min-w-0 h-full overflow-y-auto bg-[#02070c] p-3 sm:p-5 text-slate-200 space-y-4" data-testid="autonomous-cycles-panel" aria-label="Autonom utvecklingsjournal">
    <header className="flex flex-wrap justify-between items-start gap-3">
      <div className="min-w-0 space-y-1">
        <h3 className="text-base font-semibold flex gap-2 items-center"><Activity className="w-4 h-4 text-cyan-400"/> Autonom utveckling</h3>
        <p className="text-xs text-slate-400">User → Git Researcher → Developer → Debugger → Technical Debt Steward → Reviewer → Senior → lokal Git</p>
      </div>
      <button type="button" onClick={()=>void refresh()} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 rounded border border-cyan-800 text-cyan-200 text-xs disabled:opacity-50" aria-label="Uppdatera utvecklingsjournalen">
        <RefreshCw className={`w-3.5 h-3.5 ${loading?'animate-spin':''}`}/> {loading?'Hämtar…':'Uppdatera'}
      </button>
    </header>
    <div className="rounded-lg border border-cyan-900/70 bg-[#061420] p-3 space-y-2" data-testid="cognitive-lease-controls">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">Continuum Execution Leash</strong>
        <span className="text-xs text-slate-400">{live?.state||'Ej ansluten'} · Enbart deterministiskt laboratorium</span>
      </div>
      <p className="text-xs text-slate-400">En körning ändrar bara labbets lokala .jaco-arbetsyta. Kräver riktig Continuum-lease; inget automatiskt GitHub-merge eller molnkostnad.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={leaseBusy||live?.state==='RUNNING'||live?.state==='STOPPING'||live?.state==='RECONCILIATION_REQUIRED'} onClick={()=>void mutateLease('lease')} className="px-3 py-2 border border-cyan-800 text-xs rounded disabled:opacity-40">Ge 5 min lease</button>
        <button type="button" disabled={leaseBusy||!lease||!live||live.state==='RUNNING'||live.state==='STOPPING'||live.state==='RECONCILIATION_REQUIRED'||record?.state==='COMPLETED'} onClick={()=>void mutateLease('run')} className="px-3 py-2 rounded bg-cyan-900/70 text-xs disabled:opacity-40">Kör nästa 3 cykler</button>
        <button type="button" disabled={leaseBusy||!live?.run?.leaseId||!['RUNNING','STOPPING'].includes(live?.state||'')} onClick={()=>void mutateLease('stop')} className="px-3 py-2 border border-red-900 text-red-200 text-xs rounded disabled:opacity-40">Stoppa</button>
      </div>
      {lease && <p className="text-xs text-slate-500 break-all">Lease {lease.id} · Utgår {formattedTime(lease.expiresAt)}</p>}
      {live?.run && <p className="text-xs text-slate-400 break-words">Operation {live.run.operationId} · Genomförd cykel {live.run.lastCompletedCycle}/{live.run.targetCycle}{live.run.receiptRef?` · Lokalt kvitto ${live.run.receiptRef}`:''}</p>}
      {live?.state==='RECONCILIATION_REQUIRED' && <p role="alert" className="text-xs text-amber-200">Osäkert utfall efter stopp/krasch. Ingen automatisk omkörning. Kräver manuell avstämning av journal och lease.</p>}
      {leaseNotice && <p role="status" className="text-xs text-cyan-200">{leaseNotice}</p>}
      {leaseError && <p role="alert" className="text-xs text-amber-300">Continuum: {leaseError}. Ansluten IDE-session eller giltig gateway-autentisering kan krävas.</p>}
    </div>
    {error && <div role="alert" className="rounded border border-amber-800 bg-amber-950/30 p-3 text-xs text-amber-200">Kan inte verifiera den lokala journalen: {error}. Tidigare observationer är inte aktuell status.</div>}
    {!record&&!error && <p role="status" className="text-xs text-slate-400">Läser lokal utvecklingsjournal…</p>}
    {record?.state==='NOT_STARTED' && <div className="rounded-lg border border-[#23445a] bg-[#081622] p-4 space-y-2">
      <p className="font-medium text-sm">Ingen lokal cykelkörning registrerad</p>
      <p className="text-xs text-slate-400">Körning och GitHub-merge startas inte automatiskt av denna vy. Följande kommando skapar en lokal, deterministisk körjournal i arbetsytan:</p>
      <code className="block text-xs text-cyan-200 break-all rounded bg-[#030a11] p-3">node agents/cognitive-lab/autonomous-cycles/run.mjs run</code>
    </div>}
    {summary && <>
      <div className="rounded-lg border border-[#23445a] bg-[#07131f] p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold">{completed?'33 cykler avslutade':'Senast registrerade cykler'}</span>
          <span className="text-slate-400">{summary.cycles}/{summary.targetCycles} · {progress}%</span>
        </div>
        <div className="h-2 rounded bg-slate-800 overflow-hidden" role="progressbar" aria-label="Genomförda cykler" aria-valuenow={summary.cycles} aria-valuemin={0} aria-valuemax={summary.targetCycles}>
          <div className="h-full bg-cyan-500" style={{width:`${progress}%`}}/>
        </div>
        <p className="text-[11px] text-slate-400">Senaste journalhändelse: {formattedTime(record?.lastEventAt??null)} · Datakälla: lokal, sparad historik · Kontrolleras var femte sekund när vyn är synlig</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        {[
          ['Godkända reparationer',summary.fixesAccepted],
          ['Avvisade förslag',summary.proposalsRejected],
          ['Skuldkontroller',summary.debtAudits],
          ['Rensningar',summary.debtCleanups],
          ['Skuldblockeringar',summary.debtBlockers],
          ['Seniorgodkännanden',summary.seniorApprovals],
          ['Godkända testfall',`${summary.reviewCasesPassed}/${summary.reviewCasesExecuted}`],
          ['Regressionscykler',summary.phasesCompleted],
        ].map(([name,val])=><div key={name} className="min-w-0 rounded border border-[#17344b] bg-[#07121d] p-2.5">
          <strong className="block text-lg font-mono text-cyan-100 tabular-nums">{val}</strong>
          <span className="block text-slate-400 break-words leading-4">{name}</span>
        </div>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded border border-[#193348] p-3 flex gap-2"><Wrench className="w-4 h-4 shrink-0 text-cyan-300"/><div><strong>Technical Debt Steward</strong><p className="text-slate-400 mt-1">Kodstädning och kontroll före granskarens tester. Kvarvarande skuld stoppar seniorgodkännande.</p></div></div>
        <div className="rounded border border-[#193348] p-3 flex gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-cyan-300"/><div><strong>Bevisnivå och publicering</strong><p className="text-slate-400 mt-1">Journalens hashkedja kontrollerad. HMAC-granskning och GitHub CI kontrolleras inte av denna vy. Inget merge till main är bevisat här.</p></div></div>
      </div>
      <div className="rounded border border-[#193348] p-3 text-xs space-y-1">
        <div className="flex items-center gap-1.5"><GitCommitHorizontal className="w-4 h-4 text-cyan-400"/><strong>Lokalt Git-resultat</strong></div>
        <p className="text-slate-400 break-all">{summary.lastLocalGitHead||'Ingen lokal commit observerad'}</p>
        <p className="text-slate-500">Lokal Git-commit är inte detsamma som merge till GitHub main.</p>
      </div>
    </>}
    {record && record.timeline.length>0 && <div className="rounded border border-[#193348] p-3">
      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-cyan-400"/> Senaste händelser</h4>
      <div className="space-y-1.5 max-h-80 overflow-y-auto">
        {record.timeline.map(item=><article key={item.seq} className="flex flex-wrap gap-1.5 justify-between rounded bg-[#07121c] p-2 text-xs">
          <div className="min-w-0"><p className="font-medium">{labels[item.kind]||item.kind} <span className="text-slate-500">· cykel {item.cycle}</span></p>
            <p className="text-slate-400 break-words">{item.role}{item.phase?` · ${item.phase}`:''}{item.blockers.length?` · Hinder: ${item.blockers.join(', ')}`:''}</p>
          </div>
          <time className="shrink-0 text-slate-500 text-[11px]">{formattedTime(item.at)}</time>
        </article>)}
      </div>
    </div>}
    <p className="text-[11px] text-slate-500 flex gap-1.5 items-start"><AlertTriangle className="w-3.5 h-3.5 shrink-0"/> Roller och kandidatstrategier i detta laboratorium är deterministiska. Detta är ett faktiskt kört simuleringsresultat när journalen finns, inte bevis för fristående LLM-agenter eller en pågående process.</p>
  </section>;
}