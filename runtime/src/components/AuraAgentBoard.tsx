import React, { useEffect, useState } from 'react';
import { Bot, Plus, ListChecks, X } from 'lucide-react';
import { AgentConstellation, type AgentNetworkSnapshot } from './AgentConstellation';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { AutonomousCyclesPanel } from './AutonomousCyclesPanel';

interface BoardReceipt {
  actionId: string | null; type: string | null; at: string | null;
  ok: boolean; verified: boolean; outcomeUnknown: boolean; expectedOutcome: string | null; error: string | null;
  result: { kind: string | null; status: number | null; exitCode: number | null; commit: string | null; path: string | null; sha256: string | null; evidenceRefs: string[] };
}
interface BoardMission {
  id: string; goal: string; status: string; phase: string | null; column: string;
  executor: string | null; owner: string | null; agentId: string | null;
  createdAt: string | null; updatedAt: string | null; lastActivityAt: string | null;
  planningError: string | null; completionReason: string | null; blocker: string | null;
  failures: number | null; turn: number | null; detailError: string | null;
  contractStatus: { machineVerified: boolean; missing: string[] } | null;
  execution?: {phase:string;verifiedActions:number;failedActions:number;remaining:string[];recovery:{code:string;next:string}|null}|null;
  preflight?: {status:string;at:string;blockers:string[];knowledgeRecords:number}|null;
  cancelRequested?: boolean;
  replanRequest?: {reason:string;subgoals:{title:string;objective:string}[]}|null;
  lastResult: BoardReceipt | null; receipts: BoardReceipt[];
}
export interface AgentBoardSnapshot {
  success: boolean; schema: string; observedAt: string;
  network?: AgentNetworkSnapshot;
  sources: Record<'workplace' | 'missions', { available: boolean; observedAt: string | null; error: string | null }>;
  agents: Array<{ agentId: string; name: string; role: string | null; status: string; liveSessions: number | null; lastSeenAt: string | null; permissions: Record<string, boolean>; tools: string[]; sessions?: Array<{status:string;environment:string|null;lastSeenAt:string|null}> }>;
  summary?: {connected:number;reportingWork:number;offline:number;activeMissions:number|null}|null;
  memory?: Array<{id:string;kind:string;body:string;at:string|null;agentId:string|null}>;
  memoryState?: {owner:string;git:boolean;storage:string;latestSeq:number}|null;
  missions: BoardMission[]; total: number | null; statusCounts: Record<string, number> | null; limit: number; truncated: boolean;
}
interface Props {
  snapshot: AgentBoardSnapshot | null; error: string | null;
  goal: string; onGoalChange: (value: string) => void; onStartGoal: () => void;
  submitting: boolean; notice: string | null; onReview: () => void;
  onCancelMission: (id: string) => Promise<void>;
}
const COLUMNS = [{ id: 'queue', name: 'Kö' }, { id: 'running', name: 'Pågår' }, { id: 'blocked', name: 'Blockerat' }, { id: 'review', name: 'Granskning' }, { id: 'done', name: 'Klart' }];
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('sv-SE') : 'Ej observerat';
const resultLabel = (r: BoardReceipt | null) => !r ? 'Inget resultat observerat' : r.outcomeUnknown ? 'Osäkert utfall' : !r.ok ? 'Steget misslyckades' : r.verified ? 'Verktygssteg rapporterat verifierat' : 'Steg lyckat, ej verifierat';

export function AuraAgentBoard({ snapshot, error, goal, onGoalChange, onStartGoal, submitting, notice, onReview, onCancelMission }: Props) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  async function cancelSelected(id: string) {
    setCancellingId(id); setCancelError(null);
    try { await onCancelMission(id); }
    catch (error) { setCancelError(error instanceof Error ? error.message : 'Kunde inte avsluta uppdraget.'); }
    finally { setCancellingId(null); }
  }
  const [view, setView] = useState<'network'|'missions'|'cycles'>('network');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [mobileColumn, setMobileColumn] = useState('queue');
  const [showOffline, setShowOffline] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [newGoal, setNewGoal] = useState(false);
  const selected = snapshot?.missions.find(m => m.id === selectedId) || null;
  const missions = (snapshot?.missions || []).filter(m => (filter === 'cancelled' ? m.column === 'cancelled' : filter === 'all' || !['cancelled','done'].includes(m.column)) && `${m.goal} ${m.executor || ''} ${m.id}`.toLowerCase().includes(search.toLowerCase()));
  const columns = filter === 'cancelled' ? [{ id: 'cancelled', name: 'Avbrutna' }] : [...COLUMNS, ...(missions.some(m => m.column === 'unknown') ? [{ id: 'unknown', name: 'Okänt tillstånd' }] : [])];
  const chosen = columns.some(c => c.id === mobileColumn) ? mobileColumn : columns[0].id;
  const stale = Boolean(error) || Boolean(snapshot && (Object.values(snapshot.sources).some(s => !s.available) || Date.now() - Date.parse(snapshot.observedAt) > 15000));
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#02070c] text-slate-200" data-testid="agent-board">
      <header className="p-3 border-b border-[#123047] space-y-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Bot className="w-4 h-4 text-cyan-400" /><h2 className="font-semibold text-sm">JACO och agenterna</h2>
          <span className="text-xs text-slate-500">{snapshot?.total ?? '?'} uppdrag totalt</span>
          <button className="ml-auto border border-cyan-900 rounded px-2 py-1 text-xs flex gap-1 items-center" onClick={() => setNewGoal(!newGoal)}><Plus className="w-3 h-3" />Nytt uppdrag</button>
          <button className="border border-[#123047] rounded px-2 py-1 text-xs" onClick={onReview}>Granska resultat</button>
        </div>
        <div className="agent-board-view-switch" role="group" aria-label="Visa agenter eller uppdrag">
          <button type="button" aria-pressed={view==='network'} onClick={()=>setView('network')}>Sfärer och planer</button>
          <button type="button" aria-pressed={view==='missions'} onClick={()=>setView('missions')}>Uppdrag och resultat</button>
          <button type="button" aria-pressed={view==='cycles'} onClick={()=>setView('cycles')}>Autonom utveckling</button>
        </div>
        <div className={`text-xs ${stale ? 'text-amber-300' : 'text-slate-500'}`} role="status">
          {stale ? 'Föråldrad observation — ' : 'Observerat: '}{time(snapshot?.observedAt)}{error ? ` · ${error}` : ''}
        </div>
        {!snapshot && !error && <p className="text-xs text-slate-500">Hämtar agenternas verkliga tillstånd…</p>}
        {snapshot && Object.entries(snapshot.sources).filter(([,source]) => !source.available).map(([name,source]) => <p key={name} className="text-xs text-amber-300">{name === 'workplace' ? 'Workplace' : 'Uppdragslagret'} är otillgängligt ({source.error}). Senaste lyckade observation: {time(source.observedAt)}. Tillståndet är okänt.</p>)}
        {view==='missions' && snapshot?.truncated && <p className="text-xs text-amber-300">Visar de {snapshot.limit} senaste uppdragen av {snapshot.total}. Kolumnerna gäller visad lista.</p>}
        {view==='missions' && <div className="grid grid-cols-3 gap-2" aria-label="Teamets aktuella läge">
          {[['I kontakt',stale ? '?' : snapshot?.summary?.connected ?? '?'],['Rapporterar arbete',stale ? '?' : snapshot?.summary?.reportingWork ?? '?'],['Aktiva uppdrag',stale ? '?' : snapshot?.summary?.activeMissions ?? '?']].map(([label,count]) => <div key={label} className="rounded bg-[#0a1924] p-2"><strong className="block text-lg">{count}</strong><span className="text-xs text-slate-400">{label}</span></div>)}
        </div>}
        {view==='missions' && <p className="text-xs text-slate-400">Arbete är agenternas egen statusrapport. Uppdragens steg och kvitton visar vad som faktiskt observerats.</p>}
        {view==='missions' && snapshot?.statusCounts && <p className="text-[11px] text-slate-500">Hela lagret: {Object.entries(snapshot.statusCounts).map(([status,count]) => `${status}: ${count}`).join(' · ')}</p>}
        {newGoal && <form onSubmit={e => { e.preventDefault(); onStartGoal(); }} className="flex gap-2">
          <input aria-label="Mål för nytt uppdrag" value={goal} onChange={e => onGoalChange(e.target.value)} maxLength={12000} placeholder="Vad ska uppdraget uppnå?" className="min-w-0 flex-1 bg-[#07111b] border border-[#123047] rounded p-2 text-xs" />
          <button disabled={submitting || !goal.trim()} className="px-3 text-xs border border-cyan-900 rounded disabled:opacity-40">{submitting ? 'Skapar…' : 'Ge JACO uppdraget'}</button>
        </form>}
        {notice && <p role="status" className="text-xs text-cyan-200">{notice}</p>}
        {view==='missions' && <div className="flex gap-2">
          <input aria-label="Sök uppdrag" placeholder="Sök uppdrag eller executor" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-[#07111b] border border-[#123047] rounded px-2 py-1 text-xs" />
          <select aria-label="Filtrera uppdrag" value={filter} onChange={e => setFilter(e.target.value)} className="bg-[#07111b] border border-[#123047] rounded px-2 text-xs"><option value="open">Öppna</option><option value="all">Alla utom avbrutna</option><option value="cancelled">Avbrutna</option></select>
        </div>}
      </header>
      {view==='cycles' ? <AutonomousCyclesPanel /> : view==='network' ? <AgentConstellation network={snapshot?.network || null} error={error} memory={snapshot?.memory || []}
        onSelectMission={id=>{setSelectedId(id);setView('missions');}}/> : <div className="flex-1 min-h-0 overflow-auto">
        <section aria-label="Registrerade agenter" className="p-3 border-b border-[#123047]">
          <h3 className="text-xs text-slate-400 mb-2">Vilka finns här?</h3>
          <button onClick={() => setShowOffline(!showOffline)} className="text-xs text-cyan-300 mb-2">{showOffline ? 'Dölj frånkopplade' : `Visa frånkopplade (${snapshot?.summary?.offline ?? '?'})`}</button>
          <div className="flex gap-2 overflow-x-auto pb-1">{snapshot?.agents.filter(a => showOffline || (a.liveSessions || 0) > 0).map(a => <article key={a.agentId} className="min-w-[210px] max-w-[280px] border border-[#123047] rounded p-2 text-xs bg-[#050b11]">
            <div className="font-medium">{a.name} <span className="text-cyan-500">{a.status === 'BUSY' ? 'Rapporterar arbete' : (a.liveSessions || 0) > 0 ? 'I kontakt' : 'Frånkopplad'}</span></div>
            <p className="text-slate-500">{a.role || 'Roll ej observerad'} · {a.liveSessions ?? '?'} sessioner</p>
            <p className="text-slate-500">Kontakt: {time(a.lastSeenAt)}</p>
            <p className="text-slate-300 mt-1">{snapshot.missions.filter(m => m.agentId === a.agentId && m.status === 'ACTIVE').map(m => m.goal).join(' · ') || 'Inget pågående uppdrag kopplat till denna agent i observationen.'}</p>
            {a.sessions?.filter(session => ['READY','AVAILABLE','BUSY'].includes(session.status)).map((session,i) => <p key={i} className="text-slate-500">{session.environment || 'Enhet ej uppgiven'}</p>)}
            <details><summary className="text-slate-500 mt-1 cursor-pointer">Tekniska detaljer</summary><p className="text-[10px] text-slate-500 mt-1 break-words">Behörigheter: {Object.entries(a.permissions).filter(([,allowed]) => allowed).map(([key]) => key).join(', ') || 'Inga observerade'}</p></details>
          </article>)}</div>
          {snapshot?.sources.workplace.available && !snapshot.agents.length && <p className="text-xs text-slate-500">Inga registrerade agenter i observationen.</p>}
        </section>
        <section className="p-3 border-b border-[#123047]" aria-label="Gemensamt minne">
          <button onClick={() => setShowMemory(!showMemory)} className="text-sm text-cyan-200">{showMemory ? 'Dölj' : 'Visa'} det teamet minns ({snapshot?.memory?.length ?? '?'})</button>
          <p className="text-xs text-slate-400 mt-1">{snapshot?.memoryState ? 'Sparat i Workplace på hubben · innehållet krypterat · synkas inte via Git' : 'Minneslagrets tillstånd är inte observerat.'}</p>
          {showMemory && <div className="mt-2 space-y-2">{snapshot?.memory?.map(item => <article key={item.id} className="border border-[#123047] rounded p-2 text-xs"><p className="text-slate-400">{item.kind === 'DECISION' ? 'Beslut' : item.kind === 'HANDOFF' ? 'Överlämning till nästa session' : 'Rapporterad upptäckt'} · {time(item.at)} · {snapshot.agents.find(a => a.agentId === item.agentId)?.name || 'Agent ej i aktuell lista'}</p><p className="mt-1 whitespace-pre-wrap">{item.body}</p></article>)}{!snapshot?.memory?.length && <p className="text-xs text-slate-500">Inga minnesanteckningar observerade.</p>}</div>}
        </section>
        <div className="p-3 md:hidden"><select aria-label="Välj uppdragskolumn" value={chosen} onChange={e => setMobileColumn(e.target.value)} className="w-full bg-[#07111b] border border-[#123047] rounded p-2 text-xs">{columns.map(c => <option key={c.id} value={c.id}>{c.name} ({missions.filter(m => m.column === c.id).length})</option>)}</select></div>
        <div className="flex gap-3 p-3 pt-0 md:pt-3 md:overflow-x-auto">
          {columns.map(c => <section key={c.id} aria-label={c.name} className={`${chosen === c.id ? 'block' : 'hidden'} md:block w-full md:min-w-[230px] md:w-[260px] shrink-0 rounded border border-[#123047] bg-[#050b11]`}>
            <h3 className="p-2 border-b border-[#123047] text-xs font-semibold">{c.name} <span className="text-slate-500">{missions.filter(m => m.column === c.id).length}</span></h3>
            <div className="p-2 space-y-2">{missions.filter(m => m.column === c.id).map(m => <button key={m.id} onClick={() => setSelectedId(m.id)} className="w-full text-left border border-[#173047] hover:border-cyan-700 rounded p-2 bg-[#07111b] text-xs" aria-label={`Öppna uppdrag: ${m.goal}`}>
              <p className="font-medium line-clamp-3">{m.goal}</p>
              <p className="text-slate-500 mt-2">Executor: {m.executor || 'Ej observerad'}</p>
              <p className="text-slate-500">Fas: {m.phase || 'Okänd'} · steg {m.turn ?? '?'}</p>
              <p className="text-slate-500">Aktivitet: {time(m.lastActivityAt)}</p>
              {m.blocker && <p className="text-amber-300 mt-1 line-clamp-2">{m.blocker}</p>}
              <p className={`mt-1 ${m.lastResult?.ok ? 'text-slate-400' : 'text-amber-300'}`}>{resultLabel(m.lastResult)}</p>
              {m.column === 'done' && <p className="text-slate-500">Runtime rapporterar DONE; se acceptans och evidens.</p>}
            </button>)}</div>
          </section>)}
        </div>
      </div>}
      {selected && view==='missions' && <div className="absolute inset-0 z-40 bg-black/60 flex justify-end" onClick={() => setSelectedId(null)}>
        <section role="dialog" aria-modal="true" aria-label="Uppdragsdetaljer" className="w-full max-w-xl h-full overflow-auto bg-[#050b11] border-l border-[#123047] p-4 text-xs" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelectedId(null); }}>
          <button autoFocus className="float-right p-2" aria-label="Stäng uppdragsdetaljer" onClick={() => setSelectedId(null)}><X className="w-4 h-4" /></button>
          <h3 className="font-semibold text-sm pr-8">{selected.goal}</h3>
          <p className="text-slate-500 mt-2 break-all">{selected.id}</p>
          <p className="mt-2">Rapporterad status: {selected.status} · fas: {selected.phase || 'Okänd'}</p>
          {!['CANCELLED', 'DONE'].includes(selected.status) && <button
            className="mt-3 px-3 py-2 border border-red-900 rounded text-red-200 disabled:opacity-50"
            disabled={Boolean(cancellingId) || selected.cancelRequested}
            onClick={() => void cancelSelected(selected.id)}>
            {cancellingId === selected.id || selected.cancelRequested ? 'Avslutar uppdrag…' : 'Avsluta uppdrag'}
          </button>}
          {selected.cancelRequested && <p role="status" className="mt-2 text-slate-400">Avslut registrerat. Pågående verktygssteg avslutas vid säker gräns.</p>}
          {selected.status === 'CANCELLED' && <p className="mt-2 text-slate-400">Uppdraget är avslutat. Historik och kvitton är bevarade.</p>}
          {cancelError && <p role="alert" className="mt-2 text-red-300">{cancelError}</p>}
          <p>Executor: {selected.executor || 'Ej observerad'} · agentkoppling: {selected.agentId || 'Ej observerad'}</p>
          {selected.detailError && <p className="text-amber-300 mt-2">Sessionsdetaljer saknas.</p>}
          {selected.blocker && <p className="text-amber-300 mt-2">Blockerare: {selected.blocker}</p>}
          <p className="mt-3 text-slate-400">Maskingrind: {selected.contractStatus ? selected.contractStatus.machineVerified ? 'Uppfylld enligt kontraktskontrollen' : `Saknas: ${selected.contractStatus.missing.join(', ')}` : 'Ingen kodkontraktskontroll observerad'}</p>
          {selected.preflight && <p className="mt-2">Förkontroll: {selected.preflight.status} · {time(selected.preflight.at)} · {selected.preflight.knowledgeRecords} tidigare erfarenheter{selected.preflight.blockers.length ? ` · Hinder: ${selected.preflight.blockers.join(', ')}` : ''}</p>}
          {selected.replanRequest && <div className="mt-2 text-amber-200"><p>Begärd omplanering hos SEER: {selected.replanRequest.reason}</p>{selected.replanRequest.subgoals.length > 0 && <ol className="list-decimal pl-5 mt-1">{selected.replanRequest.subgoals.map((s,i)=><li key={i}><strong>{s.title}</strong> — {s.objective}</li>)}</ol>}<p className="text-slate-400 mt-1">Begäran är sparad. Utförande och verifiering redovisas i uppdragens egna kvitton.</p></div>}
          {selected.execution && <p className="mt-2">Senaste sparade kvitton: {selected.execution.verifiedActions} verifierade steg · Fel: {selected.execution.failedActions} · Återstår: {selected.execution.remaining.join(', ') || 'Inga saknade maskingrindar'}</p>}
          {selected.execution?.recovery && <p className="mt-2 text-amber-300">Återhämtning: {selected.execution.recovery.code} · {selected.execution.recovery.next}</p>}
          <p className="mt-2 text-slate-500">Verifierade verktygssteg och HTTP-status bevisar inte i sig att huvudmålet är uppfyllt.</p>
          {selected.completionReason && <p className="mt-3 whitespace-pre-wrap">Rapporterat resultat: {selected.completionReason}</p>}
          <button onClick={onReview} className="mt-3 px-3 py-2 border border-cyan-900 rounded flex items-center gap-1"><ListChecks className="w-3 h-3" />Öppna befintlig granskning</button>
          <h4 className="font-semibold mt-4">Senaste kvitton · sparat sessionsfönster</h4>
          {!selected.receipts.length && <p className="text-slate-500 mt-2">Inga kvitton observerade.</p>}
          {selected.receipts.slice().reverse().map((r,i) => <article key={r.actionId || i} className="mt-2 border border-[#123047] rounded p-3 space-y-1">
            <p>{r.type} · {time(r.at)}</p><p className="text-slate-400">{resultLabel(r)}</p>
            {r.expectedOutcome && <p>Förväntat: {r.expectedOutcome}</p>}{r.error && <p className="text-amber-300">Fel: {r.error}</p>}
            {r.result.status !== null && <p>HTTP: {r.result.status} · transportobservation</p>}
            {r.result.exitCode !== null && <p>Exitkod: {r.result.exitCode} · {r.result.kind || 'verktyg'}</p>}
            {r.result.commit && <p className="break-all">Commit: {r.result.commit}</p>}{r.result.path && <p className="break-all">Fil: {r.result.path}</p>}
            {r.result.sha256 && <p className="break-all text-slate-500">Hash: {r.result.sha256}</p>}
            {r.result.evidenceRefs.length > 0 && <p className="break-all">Evidensreferenser: {r.result.evidenceRefs.join(', ')}</p>}
          </article>)}
        </section>
      </div>}
    </div>
  );
}


// One live read surface for both the constellation and the existing mission board.
export function AuraAgentWorkspace(props: Omit<Props, 'snapshot'|'error'>) {
  const [snapshot,setSnapshot]=useState<AgentBoardSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true,timer:number|undefined;
    const controller=new AbortController();
    async function read(){
      try {
        const data=await fetch('/api/aura/workbench/agent-board',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(readAuraResponse);
        if(data.schema!=='jaco.aura-agent-board/v1')throw new Error('Ogiltigt svar från agentregistret.');
        if(data.network?.schema!=='jaco.agent-network/v1')throw new Error('Agentkartan saknas i serverversionen. Starta om den uppdaterade JACO-servern.');
        if(active){setSnapshot(data);setError(null);}
      }catch(e:any){if(active)setError(e.message || 'Agentregistret kunde inte nås.');}
      if(active)timer=window.setTimeout(read,document.visibilityState==='hidden'?20000:3000);
    }
    void read();
    return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[]);
  return <AuraAgentBoard {...props} snapshot={snapshot} error={error}/>;
}
