import { useUiLanguage } from '../i18n/UiLanguage';
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
  aura?: { identity: { id: string; name: string; agentCount: number; meaning: string }; runtimeConsolidated: boolean; functions: Array<{ id: string; name: string; implementation: string; authority: string; reads: string[]; state: string; detail: string }>;
    oversight?: { schema:string; observedAt:string; scope:string; runtimeConsolidated:boolean;
      services:Record<string,string>; browser:{state:string;meaning:string};
      missions:{active:number|null;blocked:number|null;awaitingVerification:number|null;visibleUnknownOutcomes:number|null;visibleWindowTruncated:boolean} };
  };
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
const COLUMNS = [{ id: 'queue', name: "Queue" }, { id: 'running', name: "In progress" }, { id: 'blocked', name: "Blocked" }, { id: 'review', name: "Review" }, { id: 'done', name: "Done" }];
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('sv-SE') : "Not observed";
const resultLabel = (r: BoardReceipt | null) => !r ? "No result observed" : r.outcomeUnknown ? "Uncertain outcome" : !r.ok ? "The step failed" : r.verified ? "Tool step reported as verified" : "Step succeeded, not verified";

export function AuraAgentBoard({ snapshot, error, goal, onGoalChange, onStartGoal, submitting, notice, onReview, onCancelMission }: Props) {
  const { t: uiText } = useUiLanguage();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  async function cancelSelected(id: string) {
    setCancellingId(id); setCancelError(null);
    try { await onCancelMission(id); }
    catch (error) { setCancelError(error instanceof Error ? error.message : uiText("Could not end the task.")); }
    finally { setCancellingId(null); }
  }
  const [view, setView] = useState<'functions'|'network'|'missions'|'cycles'>('functions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [mobileColumn, setMobileColumn] = useState('queue');
  const [showOffline, setShowOffline] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [newGoal, setNewGoal] = useState(false);
  const selected = snapshot?.missions.find(m => m.id === selectedId) || null;
  const missions = (snapshot?.missions || []).filter(m => (filter === 'cancelled' ? m.column === 'cancelled' : filter === 'all' || !['cancelled','done'].includes(m.column)) && `${m.goal} ${m.executor || ''} ${m.id}`.toLowerCase().includes(search.toLowerCase()));
  const columns = filter === 'cancelled' ? [{ id: 'cancelled', name: uiText("Cancelled") }] : [...COLUMNS, ...(missions.some(m => m.column === 'unknown') ? [{ id: 'unknown', name: uiText("Unknown state") }] : [])];
  const chosen = columns.some(c => c.id === mobileColumn) ? mobileColumn : columns[0].id;
  const stale = Boolean(error) || Boolean(snapshot && (Object.values(snapshot.sources).some(s => !s.available) || Date.now() - Date.parse(snapshot.observedAt) > 15000));
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#02070c] text-slate-200" data-testid="agent-board">
      <header className="p-3 border-b border-[#123047] space-y-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Bot className="w-4 h-4 text-cyan-400" /><h2 className="font-semibold text-sm">{uiText("Aura · capabilities and tasks")}</h2>
          <span className="text-xs text-slate-500">{snapshot?.total ?? '?'} {' '}{uiText("total tasks")}</span>
          <button className="ml-auto border border-cyan-900 rounded px-2 py-1 text-xs flex gap-1 items-center" onClick={() => setNewGoal(!newGoal)}><Plus className="w-3 h-3" />{uiText("New task")}</button>
          <button className="border border-[#123047] rounded px-2 py-1 text-xs" onClick={onReview}>{uiText("Review results")}</button>
        </div>
        <div className="agent-board-view-switch" role="group" aria-label={uiText("Show Aura capabilities, tasks or technical map")}>
          <button type="button" aria-pressed={view==='functions'} onClick={()=>setView('functions')}>{uiText("Aura capabilities")}</button>
          <button type="button" aria-pressed={view==='network'} onClick={()=>setView('network')}>{uiText("Technical map")}</button>
          <button type="button" aria-pressed={view==='missions'} onClick={()=>setView('missions')}>{uiText("Tasks and results")}</button>
          <button type="button" aria-pressed={view==='cycles'} onClick={()=>setView('cycles')}>{uiText("Autonomous development")}</button>
        </div>
        <div className={`text-xs ${stale ? 'text-amber-300' : 'text-slate-500'}`} role="status">
          {stale ? uiText("Outdated observation — ") : uiText("Observed: ")}{time(snapshot?.observedAt)}{error ? ` · ${error}` : ''}
        </div>
        {!snapshot && !error && <p className="text-xs text-slate-500">{uiText("Loading observed agent state…")}</p>}
        {snapshot && Object.entries(snapshot.sources).filter(([,source]) => !source.available).map(([name,source]) => <p key={name} className="text-xs text-amber-300">{name === 'workplace' ? uiText("Coordination service") : uiText("Task store")} {' '}{uiText("is unavailable (")}{source.error}{uiText("). Last successful observation:")}{' '}{time(source.observedAt)}{uiText(". The state is unknown.")}</p>)}
        {view==='missions' && snapshot?.truncated && <p className="text-xs text-amber-300">{uiText("Showing the")}{' '}{snapshot.limit} {' '}{uiText("latest tasks of")}{' '}{snapshot.total}{uiText(". Columns apply to the displayed list.")}</p>}
        {view==='missions' && <div className="grid grid-cols-3 gap-2" aria-label={uiText("Current team status")}>
          {[[uiText("Connected"),stale ? '?' : snapshot?.summary?.connected ?? '?'],[uiText("Reporting work"),stale ? '?' : snapshot?.summary?.reportingWork ?? '?'],[uiText("Active tasks"),stale ? '?' : snapshot?.summary?.activeMissions ?? '?']].map(([label,count]) => <div key={label} className="rounded bg-[#0a1924] p-2"><strong className="block text-lg">{count}</strong><span className="text-xs text-slate-400">{label}</span></div>)}
        </div>}
        {view==='missions' && <p className="text-xs text-slate-400">{uiText("Agent activity is self-reported. Task steps and recorded results show what was observed.")}</p>}
        {view==='missions' && snapshot?.statusCounts && <p className="text-[11px] text-slate-500">{uiText("Full store:")}{' '}{Object.entries(snapshot.statusCounts).map(([status,count]) => `${status}: ${count}`).join(' · ')}</p>}
        {newGoal && <form onSubmit={e => { e.preventDefault(); onStartGoal(); }} className="flex gap-2">
          <input aria-label={uiText("New task goal")} value={goal} onChange={e => onGoalChange(e.target.value)} maxLength={12000} placeholder={uiText("What should this task achieve?")} className="min-w-0 flex-1 bg-[#07111b] border border-[#123047] rounded p-2 text-xs" />
          <button disabled={submitting || !goal.trim()} className="px-3 text-xs border border-cyan-900 rounded disabled:opacity-40">{submitting ? uiText("Creating…") : uiText("Start task")}</button>
        </form>}
        {notice && <p role="status" className="text-xs text-cyan-200">{notice}</p>}
        {view==='missions' && <div className="flex gap-2">
          <input aria-label={uiText("Search tasks")} placeholder={uiText("Search task or execution service")} value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-[#07111b] border border-[#123047] rounded px-2 py-1 text-xs" />
          <select aria-label={uiText("Filter tasks")} value={filter} onChange={e => setFilter(e.target.value)} className="bg-[#07111b] border border-[#123047] rounded px-2 text-xs"><option value="open">{uiText("Open")}</option><option value="all">{uiText("All except cancelled")}</option><option value="cancelled">{uiText("Cancelled")}</option></select>
        </div>}
      </header>
      {view==='functions' ? <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3" data-testid="aura-functions">
        <section className="rounded border border-cyan-900 bg-[#07111b] p-4">
          <h3 className="text-base font-semibold text-cyan-200">{uiText("Aura")}</h3>
          <p className="text-xs text-slate-300 mt-1">{uiText("Your agent for reasoning, planning, execution, memory, tools and verification.")}</p>
          <p className="text-xs text-slate-500 mt-2">{uiText("Capability status comes from observed services and recorded results.")}</p>
        </section>
        {snapshot?.aura?.oversight && <section aria-label={uiText("Aura system overview")} className="rounded border border-[#123047] bg-[#050b11] p-3 space-y-2">
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <h4 className="text-sm font-semibold text-cyan-200">{uiText("Aura system controls")}</h4>
            <span className="text-xs text-slate-400">{uiText("Browser:")}{' '}{snapshot.aura.oversight.browser.state}</span>
          </div>
          <p className="text-xs text-slate-400">{uiText(snapshot.aura.oversight.browser.meaning)}</p>
          <p className="text-xs text-slate-300">{uiText("Task:")}{' '}{snapshot.aura.oversight.missions.active ?? '?'} {' '}{uiText("active ·")}{' '}{snapshot.aura.oversight.missions.blocked ?? '?'} {' '}{uiText("blocked ·")}{' '}{snapshot.aura.oversight.missions.awaitingVerification ?? '?'} {' '}{uiText("awaiting verification")}</p>
          <p className="text-xs text-slate-400">{uiText("Recent uncertain outcomes in displayed tasks:")}{' '}{snapshot.aura.oversight.missions.visibleUnknownOutcomes ?? '?'}{snapshot.aura.oversight.missions.visibleWindowTruncated ? uiText(" (limited sample)") : ''}</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-cyan-300">{uiText("Services · observed health")}</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {Object.entries(snapshot.aura.oversight.services).map(([name,state]) =>
                <div key={name} className="flex justify-between gap-2 border border-[#123047] rounded p-2">
                  <span className="text-slate-300">{name}</span>
                  <span className={state.startsWith('READY') || state.startsWith('DISCOVERABLE') ? 'text-slate-300' : 'text-amber-300'}>{state}</span>
                </div>)}
            </div>
          </details>
          <p className="text-xs text-slate-500">{uiText("Service health does not prove that a task is complete. These controls do not grant new permissions.")}</p>
        </section>}
        <section aria-label={uiText("Aura capabilities")} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {snapshot?.aura?.functions.map(fn => <article key={fn.id} className="rounded border border-[#123047] bg-[#050b11] p-3 space-y-1">
            <div className="flex gap-2 items-center justify-between"><h4 className="font-medium text-sm">{uiText(fn.name)}</h4><span className={['UNAVAILABLE','NO_MODEL_OBSERVED','NO_WORKER_OBSERVED'].includes(fn.state) ? 'text-xs text-amber-300' : 'text-xs text-slate-400'}>{fn.state}</span></div>
            <p className="text-xs text-slate-300">{uiText(fn.detail)}</p>
            <details><summary className="text-xs text-slate-500 cursor-pointer">{uiText("Technical capability")}</summary><p className="text-xs text-slate-400 mt-1">{fn.implementation} · {fn.authority}</p></details>
          </article>)}
          {snapshot && !snapshot.aura && <p className="text-xs text-amber-300">{uiText("The installed version does not report Aura’s capability status yet.")}</p>}
          {!snapshot && <p className="text-xs text-slate-400">{uiText("Loading observed capability status…")}</p>}
        </section>
        <p className="text-xs text-slate-500">{uiText("Planning, execution and coordination run as internal services. Task history and recorded results remain available under Tasks and results.")}</p>
      </div> : view==='cycles' ? <AutonomousCyclesPanel /> : view==='network' ? <AgentConstellation network={snapshot?.network || null} error={error} memory={snapshot?.memory || []}
        onSelectMission={id=>{setSelectedId(id);setView('missions');}}/> : <div className="flex-1 min-h-0 overflow-auto">
        <details className="p-3 border-b border-[#123047]" aria-label={uiText("Execution sessions")}>
          <summary className="text-xs text-slate-400 mb-2 cursor-pointer">{uiText("Execution sessions (internal services)")}</summary>
          <button onClick={() => setShowOffline(!showOffline)} className="text-xs text-cyan-300 mb-2">{showOffline ? uiText("Hide disconnected") : uiText("Show disconnected ({0})", [snapshot?.summary?.offline ?? '?'])}</button>
          <div className="flex gap-2 overflow-x-auto pb-1">{snapshot?.agents.filter(a => showOffline || (a.liveSessions || 0) > 0).map(a => <article key={a.agentId} className="min-w-[210px] max-w-[280px] border border-[#123047] rounded p-2 text-xs bg-[#050b11]">
            <div className="font-medium">{a.name} <span className="text-cyan-500">{a.status === 'BUSY' ? uiText("Reporting work") : (a.liveSessions || 0) > 0 ? uiText("Connected") : uiText("Disconnected")}</span></div>
            <p className="text-slate-500">{a.role || uiText("Role not observed")} · {a.liveSessions ?? '?'} {' '}{uiText("sessions")}</p>
            <p className="text-slate-500">{uiText("Contact:")}{' '}{time(a.lastSeenAt)}</p>
            <p className="text-slate-300 mt-1">{snapshot.missions.filter(m => m.agentId === a.agentId && m.status === 'ACTIVE').map(m => m.goal).join(' · ') || uiText("No active task is linked to this agent in this observation.")}</p>
            {a.sessions?.filter(session => ['READY','AVAILABLE','BUSY'].includes(session.status)).map((session,i) => <p key={i} className="text-slate-500">{session.environment || uiText("Device not provided")}</p>)}
            <details><summary className="text-slate-500 mt-1 cursor-pointer">{uiText("Technical details")}</summary><p className="text-[10px] text-slate-500 mt-1 break-words">{uiText("Permissions:")}{' '}{Object.entries(a.permissions).filter(([,allowed]) => allowed).map(([key]) => key).join(', ') || uiText("None observed")}</p></details>
          </article>)}</div>
          {snapshot?.sources.workplace.available && !snapshot.agents.length && <p className="text-xs text-slate-500">{uiText("No sessions registered in this observation.")}</p>}
        </details>
        <section className="p-3 border-b border-[#123047]" aria-label={uiText("Shared memory")}>
          <button onClick={() => setShowMemory(!showMemory)} className="text-sm text-cyan-200">{showMemory ? uiText("Hide") : uiText("Show")} {' '}{uiText("team memory (")}{snapshot?.memory?.length ?? '?'})</button>
          <p className="text-xs text-slate-400 mt-1">{snapshot?.memoryState ? uiText("Saved on the coordination server · encrypted content · excluded from Git sync") : uiText("The memory store has not been observed.")}</p>
          {showMemory && <div className="mt-2 space-y-2">{snapshot?.memory?.map(item => <article key={item.id} className="border border-[#123047] rounded p-2 text-xs"><p className="text-slate-400">{item.kind === 'DECISION' ? uiText("Decisions") : item.kind === 'HANDOFF' ? uiText("Handoff to next session") : uiText("Reported discovery")} · {time(item.at)} · {snapshot.agents.find(a => a.agentId === item.agentId)?.name || uiText("Agent outside the current list")}</p><p className="mt-1 whitespace-pre-wrap">{item.body}</p></article>)}{!snapshot?.memory?.length && <p className="text-xs text-slate-500">{uiText("No memory notes observed.")}</p>}</div>}
        </section>
        <div className="p-3 md:hidden"><select aria-label={uiText("Choose task column")} value={chosen} onChange={e => setMobileColumn(e.target.value)} className="w-full bg-[#07111b] border border-[#123047] rounded p-2 text-xs">{columns.map(c => <option key={c.id} value={c.id}>{uiText(c.name)} ({missions.filter(m => m.column === c.id).length})</option>)}</select></div>
        <div className="flex gap-3 p-3 pt-0 md:pt-3 md:overflow-x-auto">
          {columns.map(c => <section key={c.id} aria-label={uiText(c.name)} className={`${chosen === c.id ? 'block' : 'hidden'} md:block w-full md:min-w-[230px] md:w-[260px] shrink-0 rounded border border-[#123047] bg-[#050b11]`}>
            <h3 className="p-2 border-b border-[#123047] text-xs font-semibold">{uiText(c.name)} <span className="text-slate-500">{missions.filter(m => m.column === c.id).length}</span></h3>
            <div className="p-2 space-y-2">{missions.filter(m => m.column === c.id).map(m => <button key={m.id} onClick={() => setSelectedId(m.id)} className="w-full text-left border border-[#173047] hover:border-cyan-700 rounded p-2 bg-[#07111b] text-xs" aria-label={uiText("Open task: {0}", [m.goal])}>
              <p className="font-medium line-clamp-3">{m.goal}</p>
              <p className="text-slate-500 mt-2">{uiText("Executor:")}{' '}{m.executor || uiText("Not observed")}</p>
              <p className="text-slate-500">{uiText("Phase:")}{' '}{m.phase || uiText("Unknown")} {' '}{uiText("· step")}{' '}{m.turn ?? '?'}</p>
              <p className="text-slate-500">{uiText("Activity:")}{' '}{time(m.lastActivityAt)}</p>
              {m.blocker && <p className="text-amber-300 mt-1 line-clamp-2">{m.blocker}</p>}
              <p className={`mt-1 ${m.lastResult?.ok ? 'text-slate-400' : 'text-amber-300'}`}>{uiText(resultLabel(m.lastResult))}</p>
              {m.column === 'done' && <p className="text-slate-500">{uiText("The system reports completion; review acceptance checks and evidence.")}</p>}
            </button>)}</div>
          </section>)}
        </div>
      </div>}
      {selected && view==='missions' && <div className="absolute inset-0 z-40 bg-black/60 flex justify-end" onClick={() => setSelectedId(null)}>
        <section role="dialog" aria-modal="true" aria-label={uiText("Task details")} className="w-full max-w-xl h-full overflow-auto bg-[#050b11] border-l border-[#123047] p-4 text-xs" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelectedId(null); }}>
          <button autoFocus className="float-right p-2" aria-label={uiText("Close task details")} onClick={() => setSelectedId(null)}><X className="w-4 h-4" /></button>
          <h3 className="font-semibold text-sm pr-8">{selected.goal}</h3>
          <p className="text-slate-500 mt-2 break-all">{selected.id}</p>
          <p className="mt-2">{uiText("Reported status:")}{' '}{selected.status} {' '}{uiText("· phase:")}{' '}{selected.phase || uiText("Unknown")}</p>
          {!['CANCELLED', 'DONE'].includes(selected.status) && <button
            className="mt-3 px-3 py-2 border border-red-900 rounded text-red-200 disabled:opacity-50"
            disabled={Boolean(cancellingId) || selected.cancelRequested}
            onClick={() => void cancelSelected(selected.id)}>
            {cancellingId === selected.id || selected.cancelRequested ? uiText("Ending task…") : uiText("End task")}
          </button>}
          {selected.cancelRequested && <p role="status" className="mt-2 text-slate-400">{uiText("Cancellation recorded. Current tool steps will finish at a safe boundary.")}</p>}
          {selected.status === 'CANCELLED' && <p className="mt-2 text-slate-400">{uiText("The task has ended. History and recorded results are preserved.")}</p>}
          {cancelError && <p role="alert" className="mt-2 text-red-300">{cancelError}</p>}
          <p>{uiText("Executor:")}{' '}{selected.executor || uiText("Not observed")} {' '}{uiText("· agent link:")}{' '}{selected.agentId || uiText("Not observed")}</p>
          {selected.detailError && <p className="text-amber-300 mt-2">{uiText("Session details unavailable.")}</p>}
          {selected.blocker && <p className="text-amber-300 mt-2">{uiText("Blockers:")}{' '}{selected.blocker}</p>}
          <p className="mt-3 text-slate-400">{uiText("Automated check:")}{' '}{selected.contractStatus ? selected.contractStatus.machineVerified ? uiText("Passed the task checks") : uiText("Missing: {0}", [selected.contractStatus.missing.join(', ')]) : uiText("No coding task check observed")}</p>
          {selected.preflight && <p className="mt-2">{uiText("Preflight:")}{' '}{selected.preflight.status} · {time(selected.preflight.at)} · {selected.preflight.knowledgeRecords} {' '}{uiText("previous experiences")}{selected.preflight.blockers.length ? uiText(" · Blockers: {0}", [selected.preflight.blockers.join(', ')]) : ''}</p>}
          {selected.replanRequest && <div className="mt-2 text-amber-200"><p>{uiText("Replanning requested:")}{' '}{selected.replanRequest.reason}</p>{selected.replanRequest.subgoals.length > 0 && <ol className="list-decimal pl-5 mt-1">{selected.replanRequest.subgoals.map((s,i)=><li key={i}><strong>{s.title}</strong> — {s.objective}</li>)}</ol>}<p className="text-slate-400 mt-1">{uiText("Request saved. Follow execution and verification in the task’s recorded results.")}</p></div>}
          {selected.execution && <p className="mt-2">{uiText("Latest recorded results:")}{' '}{selected.execution.verifiedActions} {' '}{uiText("verified steps · Errors:")}{' '}{selected.execution.failedActions} {' '}{uiText("· Remaining:")}{' '}{selected.execution.remaining.join(', ') || uiText("No missing automated checks")}</p>}
          {selected.execution?.recovery && <p className="mt-2 text-amber-300">{uiText("Recovery:")}{' '}{selected.execution.recovery.code} · {selected.execution.recovery.next}</p>}
          <p className="mt-2 text-slate-500">{uiText("Verified tool steps and HTTP status alone do not prove that the goal has been achieved.")}</p>
          {selected.completionReason && <p className="mt-3 whitespace-pre-wrap">{uiText("Reported result:")}{' '}{selected.completionReason}</p>}
          <button onClick={onReview} className="mt-3 px-3 py-2 border border-cyan-900 rounded flex items-center gap-1"><ListChecks className="w-3 h-3" />{uiText("Open existing review")}</button>
          <h4 className="font-semibold mt-4">{uiText("Recent results · saved session window")}</h4>
          {!selected.receipts.length && <p className="text-slate-500 mt-2">{uiText("No recorded results observed.")}</p>}
          {selected.receipts.slice().reverse().map((r,i) => <article key={r.actionId || i} className="mt-2 border border-[#123047] rounded p-3 space-y-1">
            <p>{r.type} · {time(r.at)}</p><p className="text-slate-400">{uiText(resultLabel(r))}</p>
            {r.expectedOutcome && <p>{uiText("Expected:")}{' '}{r.expectedOutcome}</p>}{r.error && <p className="text-amber-300">{uiText("Errors:")}{' '}{r.error}</p>}
            {r.result.status !== null && <p>{uiText("HTTP:")}{' '}{r.result.status} {' '}{uiText("· connection observation")}</p>}
            {r.result.exitCode !== null && <p>{uiText("Exit code:")}{' '}{r.result.exitCode} · {r.result.kind || uiText("tools")}</p>}
            {r.result.commit && <p className="break-all">{uiText("Commit:")}{' '}{r.result.commit}</p>}{r.result.path && <p className="break-all">{uiText("File:")}{' '}{r.result.path}</p>}
            {r.result.sha256 && <p className="break-all text-slate-500">{uiText("Hash:")}{' '}{r.result.sha256}</p>}
            {r.result.evidenceRefs.length > 0 && <p className="break-all">{uiText("Evidence references:")}{' '}{r.result.evidenceRefs.join(', ')}</p>}
          </article>)}
        </section>
      </div>}
    </div>
  );
}


// One live read surface for both the constellation and the existing mission board.
export function AuraAgentWorkspace(props: Omit<Props, 'snapshot'|'error'>) {
  const { t: uiText } = useUiLanguage();
  const [snapshot,setSnapshot]=useState<AgentBoardSnapshot|null>(null);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    let active=true,timer:number|undefined;
    const controller=new AbortController();
    async function read(){
      try {
        const data=await fetch('/api/aura/workbench/agent-board',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])}).then(readAuraResponse);
        if(data.schema!=='jaco.aura-agent-board/v1')throw new Error(uiText("The agent registry returned an invalid response."));
        if(data.network?.schema!=='jaco.agent-network/v1')throw new Error('Agentkartan saknas i serverversionen. Starta om den uppdaterade JACO-servern.');
        if(active){setSnapshot(data);setError(null);}
      }catch(e:any){if(active)setError(e.message || uiText("The agent registry could not be reached."));}
      if(active)timer=window.setTimeout(read,document.visibilityState==='hidden'?20000:3000);
    }
    void read();
    return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[]);
  return <AuraAgentBoard {...props} snapshot={snapshot} error={error}/>;
}
