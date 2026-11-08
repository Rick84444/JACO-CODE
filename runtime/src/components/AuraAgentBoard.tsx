import React, { useEffect, useState } from 'react';
import { Bot, Plus, ListChecks, X } from 'lucide-react';
import { AgentConstellation, type AgentNetworkSnapshot } from './AgentConstellation';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { AutonomousCyclesPanel } from './AutonomousCyclesPanel';
const AuraOrganizationPanel = React.lazy(() => import('./AuraOrganizationPanel').then(module => ({ default: module.AuraOrganizationPanel })));

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
const COLUMNS = [{ id: 'queue', name: 'Queue' }, { id: 'running', name: 'Running' }, { id: 'blocked', name: 'Blocked' }, { id: 'review', name: 'Review' }, { id: 'done', name: 'Done' }];
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US') : 'Not observed';
const resultLabel = (r: BoardReceipt | null) => !r ? 'No result observed' : r.outcomeUnknown ? 'Unknown outcome' : !r.ok ? 'Step failed' : r.verified ? 'Tool step reported verified' : 'Step succeeded, not verified';

export function AuraAgentBoard({ snapshot, error, goal, onGoalChange, onStartGoal, submitting, notice, onReview, onCancelMission }: Props) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  async function cancelSelected(id: string) {
    setCancellingId(id); setCancelError(null);
    try { await onCancelMission(id); }
    catch (error) { setCancelError(error instanceof Error ? error.message : 'Could not cancel the mission.'); }
    finally { setCancellingId(null); }
  }
  const [view, setView] = useState<'functions'|'organization'|'network'|'missions'|'cycles'>('functions');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [mobileColumn, setMobileColumn] = useState('queue');
  const [showOffline, setShowOffline] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [newGoal, setNewGoal] = useState(false);
  const selected = snapshot?.missions.find(m => m.id === selectedId) || null;
  const missions = (snapshot?.missions || []).filter(m => (filter === 'cancelled' ? m.column === 'cancelled' : filter === 'all' || !['cancelled','done'].includes(m.column)) && `${m.goal} ${m.executor || ''} ${m.id}`.toLowerCase().includes(search.toLowerCase()));
  const columns = filter === 'cancelled' ? [{ id: 'cancelled', name: 'Cancelled' }] : [...COLUMNS, ...(missions.some(m => m.column === 'unknown') ? [{ id: 'unknown', name: 'Unknown state' }] : [])];
  const chosen = columns.some(c => c.id === mobileColumn) ? mobileColumn : columns[0].id;
  const stale = Boolean(error) || Boolean(snapshot && (Object.values(snapshot.sources).some(s => !s.available) || Date.now() - Date.parse(snapshot.observedAt) > 15000));
  return (
    <div className="h-full min-h-0 flex flex-col bg-[#050608] text-neutral-200" data-testid="agent-board">
      <header className="p-3 border-b border-[#123047] space-y-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Bot className="w-4 h-4 text-neutral-300" /><h2 className="font-semibold text-sm">Aura · functions and missions</h2>
          <span className="text-xs text-neutral-500">{snapshot?.total ?? '?'} missions total</span>
          <button className="ml-auto border border-neutral-900 rounded px-2 py-1 text-xs flex gap-1 items-center" onClick={() => setNewGoal(!newGoal)}><Plus className="w-3 h-3" />New mission</button>
          <button className="border border-[#123047] rounded px-2 py-1 text-xs" onClick={onReview}>Review results</button>
        </div>
        <div className="agent-board-view-switch" role="group" aria-label="Show Aura functions, missions or technical map">
          <button type="button" aria-pressed={view==='functions'} onClick={()=>setView('functions')}>Aura functions</button>
          <button type="button" aria-pressed={view==='organization'} onClick={()=>setView('organization')}>Organization</button>
          <button type="button" aria-pressed={view==='network'} onClick={()=>setView('network')}>Technical map</button>
          <button type="button" aria-pressed={view==='missions'} onClick={()=>setView('missions')}>Missions and results</button>
          <button type="button" aria-pressed={view==='cycles'} onClick={()=>setView('cycles')}>Autonomous development</button>
        </div>
        <div className={`text-xs ${stale ? 'text-amber-300' : 'text-neutral-500'}`} role="status">
          {stale ? 'Stale observation — ' : 'Observed: '}{time(snapshot?.observedAt)}{error ? ` · ${error}` : ''}
        </div>
        {!snapshot && !error && <p className="text-xs text-neutral-500">Fetching the agents' actual state…</p>}
        {snapshot && Object.entries(snapshot.sources).filter(([,source]) => !source.available).map(([name,source]) => <p key={name} className="text-xs text-amber-300">{name === 'workplace' ? 'Workplace' : 'Mission store'} is unavailable ({source.error}). Last successful observation: {time(source.observedAt)}. State is unknown.</p>)}
        {view==='missions' && snapshot?.truncated && <p className="text-xs text-amber-300">Showing the {snapshot.limit} latest missions of {snapshot.total}. Columns apply to the visible list.</p>}
        {view==='missions' && <div className="grid grid-cols-3 gap-2" aria-label="Current team status">
          {[['Connected',stale ? '?' : snapshot?.summary?.connected ?? '?'],['Reporting work',stale ? '?' : snapshot?.summary?.reportingWork ?? '?'],['Active missions',stale ? '?' : snapshot?.summary?.activeMissions ?? '?']].map(([label,count]) => <div key={label} className="rounded bg-[#161719] p-2"><strong className="block text-lg">{count}</strong><span className="text-xs text-neutral-400">{label}</span></div>)}
        </div>}
        {view==='missions' && <p className="text-xs text-neutral-400">Work is the agents' own status report. Mission steps and receipts show what was actually observed.</p>}
        {view==='missions' && snapshot?.statusCounts && <p className="text-[11px] text-neutral-500">Whole store: {Object.entries(snapshot.statusCounts).map(([status,count]) => `${status}: ${count}`).join(' · ')}</p>}
        {newGoal && <form onSubmit={e => { e.preventDefault(); onStartGoal(); }} className="flex gap-2">
          <input aria-label="Goal for new mission" value={goal} onChange={e => onGoalChange(e.target.value)} maxLength={12000} placeholder="What should the mission achieve?" className="min-w-0 flex-1 bg-[#0f1012] border border-[#123047] rounded p-2 text-xs" />
          <button disabled={submitting || !goal.trim()} className="px-3 text-xs border border-neutral-900 rounded disabled:opacity-40">{submitting ? 'Creating…' : 'Give JACO the mission'}</button>
        </form>}
        {notice && <p role="status" className="text-xs text-neutral-200">{notice}</p>}
        {view==='missions' && <div className="flex gap-2">
          <input aria-label="Search missions" placeholder="Search missions or executor" value={search} onChange={e => setSearch(e.target.value)} className="min-w-0 flex-1 bg-[#0f1012] border border-[#123047] rounded px-2 py-1 text-xs" />
          <select aria-label="Filter missions" value={filter} onChange={e => setFilter(e.target.value)} className="bg-[#0f1012] border border-[#123047] rounded px-2 text-xs"><option value="open">Open</option><option value="all">All except cancelled</option><option value="cancelled">Cancelled</option></select>
        </div>}
      </header>
      {view==='organization' ? <React.Suspense fallback={<div className="p-4 text-xs text-neutral-400">Loading organization…</div>}><AuraOrganizationPanel /></React.Suspense>
      : view==='functions' ? <div className="flex-1 min-h-0 overflow-auto p-3 space-y-3" data-testid="aura-functions">
        <section className="rounded border border-neutral-900 bg-[#0f1012] p-4">
          <h3 className="text-base font-semibold text-neutral-200">Aura</h3>
          <p className="text-xs text-neutral-300 mt-1">Your single operator agent. Reasoning, planning, execution, memory, tools and verification are her functions.</p>
          <p className="text-xs text-neutral-500 mt-2">Function status comes from observed services and receipts, not from claims that a model is working.</p>
        </section>
        {snapshot?.aura?.oversight && <section aria-label="Aura operations overview" className="rounded border border-[#123047] bg-[#090a0c] p-3 space-y-2">
          <div className="flex flex-wrap gap-2 justify-between items-center">
            <h4 className="text-sm font-semibold text-neutral-200">Aura control plane</h4>
            <span className="text-xs text-neutral-400">Browser: {snapshot.aura.oversight.browser.state}</span>
          </div>
          <p className="text-xs text-neutral-400">{snapshot.aura.oversight.browser.meaning}</p>
          <p className="text-xs text-neutral-300">Missions: {snapshot.aura.oversight.missions.active ?? '?'} active · {snapshot.aura.oversight.missions.blocked ?? '?'} blocked · {snapshot.aura.oversight.missions.awaitingVerification ?? '?'} awaiting verification</p>
          <p className="text-xs text-neutral-400">Unknown latest outcomes in visible missions: {snapshot.aura.oversight.missions.visibleUnknownOutcomes ?? '?'}{snapshot.aura.oversight.missions.visibleWindowTruncated ? ' (limited window)' : ''}</p>
          <details className="text-xs">
            <summary className="cursor-pointer text-neutral-300">Services · observed health</summary>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {Object.entries(snapshot.aura.oversight.services).map(([name,state]) =>
                <div key={name} className="flex justify-between gap-2 border border-[#123047] rounded p-2">
                  <span className="text-neutral-300">{name}</span>
                  <span className={state.startsWith('READY') || state.startsWith('DISCOVERABLE') ? 'text-neutral-300' : 'text-amber-300'}>{state}</span>
                </div>)}
            </div>
          </details>
          <p className="text-xs text-neutral-500">Observed service status is not proof of a completed mission. No control function grants new permissions.</p>
        </section>}
        <section aria-label="Aura functions" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {snapshot?.aura?.functions.map(fn => <article key={fn.id} className="rounded border border-[#123047] bg-[#090a0c] p-3 space-y-1">
            <div className="flex gap-2 items-center justify-between"><h4 className="font-medium text-sm">{fn.name}</h4><span className={['UNAVAILABLE','NO_MODEL_OBSERVED','NO_WORKER_OBSERVED'].includes(fn.state) ? 'text-xs text-amber-300' : 'text-xs text-neutral-400'}>{fn.state}</span></div>
            <p className="text-xs text-neutral-300">{fn.detail}</p>
            <details><summary className="text-xs text-neutral-500 cursor-pointer">Technical function</summary><p className="text-xs text-neutral-400 mt-1">{fn.implementation} · {fn.authority}</p></details>
          </article>)}
          {snapshot && !snapshot.aura && <p className="text-xs text-amber-300">The installed runtime version does not yet report Aura's function status.</p>}
          {!snapshot && <p className="text-xs text-neutral-400">Fetching observed function status…</p>}
        </section>
        <p className="text-xs text-neutral-500">SEER, Nova and Workplace are still internal runtime services. They have not been merged into one OS process. Earlier missions and receipts remain under Missions and results.</p>
      </div> : view==='cycles' ? <AutonomousCyclesPanel /> : view==='network' ? <AgentConstellation network={snapshot?.network || null} error={error} memory={snapshot?.memory || []}
        onSelectMission={id=>{setSelectedId(id);setView('missions');}}/> : <div className="flex-1 min-h-0 overflow-auto">
        <details className="p-3 border-b border-[#123047]" aria-label="Technical Workplace sessions">
          <summary className="text-xs text-neutral-400 mb-2 cursor-pointer">Technical Workplace sessions (not separate Aura personas)</summary>
          <button onClick={() => setShowOffline(!showOffline)} className="text-xs text-neutral-300 mb-2">{showOffline ? 'Hide offline' : `Show offline (${snapshot?.summary?.offline ?? '?'})`}</button>
          <div className="flex gap-2 overflow-x-auto pb-1">{snapshot?.agents.filter(a => showOffline || (a.liveSessions || 0) > 0).map(a => <article key={a.agentId} className="min-w-[210px] max-w-[280px] border border-[#123047] rounded p-2 text-xs bg-[#090a0c]">
            <div className="font-medium">{a.name} <span className="text-neutral-400">{a.status === 'BUSY' ? 'Reporting work' : (a.liveSessions || 0) > 0 ? 'Connected' : 'Offline'}</span></div>
            <p className="text-neutral-500">{a.role || 'Role not observed'} · {a.liveSessions ?? '?'} sessions</p>
            <p className="text-neutral-500">Last contact: {time(a.lastSeenAt)}</p>
            <p className="text-neutral-300 mt-1">{snapshot.missions.filter(m => m.agentId === a.agentId && m.status === 'ACTIVE').map(m => m.goal).join(' · ') || 'No running mission linked to this agent in the observation.'}</p>
            {a.sessions?.filter(session => ['READY','AVAILABLE','BUSY'].includes(session.status)).map((session,i) => <p key={i} className="text-neutral-500">{session.environment || 'Device not reported'}</p>)}
            <details><summary className="text-neutral-500 mt-1 cursor-pointer">Technical details</summary><p className="text-[10px] text-neutral-500 mt-1 break-words">Permissions: {Object.entries(a.permissions).filter(([,allowed]) => allowed).map(([key]) => key).join(', ') || 'None observed'}</p></details>
          </article>)}</div>
          {snapshot?.sources.workplace.available && !snapshot.agents.length && <p className="text-xs text-neutral-500">No registered sessions in the observation.</p>}
        </details>
        <section className="p-3 border-b border-[#123047]" aria-label="Shared memory">
          <button onClick={() => setShowMemory(!showMemory)} className="text-sm text-neutral-200">{showMemory ? 'Hide' : 'Show'} what the team remembers ({snapshot?.memory?.length ?? '?'})</button>
          <p className="text-xs text-neutral-400 mt-1">{snapshot?.memoryState ? 'Stored in Workplace on the hub · content encrypted · not synced via Git' : 'Memory store state is not observed.'}</p>
          {showMemory && <div className="mt-2 space-y-2">{snapshot?.memory?.map(item => <article key={item.id} className="border border-[#123047] rounded p-2 text-xs"><p className="text-neutral-400">{item.kind === 'DECISION' ? 'Decision' : item.kind === 'HANDOFF' ? 'Handoff to next session' : 'Reported finding'} · {time(item.at)} · {snapshot.agents.find(a => a.agentId === item.agentId)?.name || 'Agent not in current list'}</p><p className="mt-1 whitespace-pre-wrap">{item.body}</p></article>)}{!snapshot?.memory?.length && <p className="text-xs text-neutral-500">No memory notes observed.</p>}</div>}
        </section>
        <div className="p-3 md:hidden"><select aria-label="Choose mission column" value={chosen} onChange={e => setMobileColumn(e.target.value)} className="w-full bg-[#0f1012] border border-[#123047] rounded p-2 text-xs">{columns.map(c => <option key={c.id} value={c.id}>{c.name} ({missions.filter(m => m.column === c.id).length})</option>)}</select></div>
        <div className="flex gap-3 p-3 pt-0 md:pt-3 md:overflow-x-auto">
          {columns.map(c => <section key={c.id} aria-label={c.name} className={`${chosen === c.id ? 'block' : 'hidden'} md:block w-full md:min-w-[230px] md:w-[260px] shrink-0 rounded border border-[#123047] bg-[#090a0c]`}>
            <h3 className="p-2 border-b border-[#123047] text-xs font-semibold">{c.name} <span className="text-neutral-500">{missions.filter(m => m.column === c.id).length}</span></h3>
            <div className="p-2 space-y-2">{missions.filter(m => m.column === c.id).map(m => <button key={m.id} onClick={() => setSelectedId(m.id)} className="w-full text-left border border-[#173047] hover:border-neutral-700 rounded p-2 bg-[#0f1012] text-xs" aria-label={`Open mission: ${m.goal}`}>
              <p className="font-medium line-clamp-3">{m.goal}</p>
              <p className="text-neutral-500 mt-2">Executor: {m.executor || 'Not observed'}</p>
              <p className="text-neutral-500">Phase: {m.phase || 'Unknown'} · step {m.turn ?? '?'}</p>
              <p className="text-neutral-500">Activity: {time(m.lastActivityAt)}</p>
              {m.blocker && <p className="text-amber-300 mt-1 line-clamp-2">{m.blocker}</p>}
              <p className={`mt-1 ${m.lastResult?.ok ? 'text-neutral-400' : 'text-amber-300'}`}>{resultLabel(m.lastResult)}</p>
              {m.column === 'done' && <p className="text-neutral-500">Runtime reports DONE; see acceptance and evidence.</p>}
            </button>)}</div>
          </section>)}
        </div>
      </div>}
      {selected && view==='missions' && <div className="absolute inset-0 z-40 bg-black/60 flex justify-end" onClick={() => setSelectedId(null)}>
        <section role="dialog" aria-modal="true" aria-label="Mission details" className="w-full max-w-xl h-full overflow-auto bg-[#090a0c] border-l border-[#123047] p-4 text-xs" onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') setSelectedId(null); }}>
          <button autoFocus className="float-right p-2" aria-label="Close mission details" onClick={() => setSelectedId(null)}><X className="w-4 h-4" /></button>
          <h3 className="font-semibold text-sm pr-8">{selected.goal}</h3>
          <p className="text-neutral-500 mt-2 break-all">{selected.id}</p>
          <p className="mt-2">Reported status: {selected.status} · phase: {selected.phase || 'Unknown'}</p>
          {!['CANCELLED', 'DONE'].includes(selected.status) && <button
            className="mt-3 px-3 py-2 border border-red-900 rounded text-red-200 disabled:opacity-50"
            disabled={Boolean(cancellingId) || selected.cancelRequested}
            onClick={() => void cancelSelected(selected.id)}>
            {cancellingId === selected.id || selected.cancelRequested ? 'Cancelling mission…' : 'Cancel mission'}
          </button>}
          {selected.cancelRequested && <p role="status" className="mt-2 text-neutral-400">Cancellation recorded. The running tool step stops at a safe boundary.</p>}
          {selected.status === 'CANCELLED' && <p className="mt-2 text-neutral-400">The mission is cancelled. History and receipts are preserved.</p>}
          {cancelError && <p role="alert" className="mt-2 text-red-300">{cancelError}</p>}
          <p>Executor: {selected.executor || 'Not observed'} · agent link: {selected.agentId || 'Not observed'}</p>
          {selected.detailError && <p className="text-amber-300 mt-2">Session details missing.</p>}
          {selected.blocker && <p className="text-amber-300 mt-2">Blocker: {selected.blocker}</p>}
          <p className="mt-3 text-neutral-400">Machine gate: {selected.contractStatus ? selected.contractStatus.machineVerified ? 'Satisfied per contract check' : `Missing: ${selected.contractStatus.missing.join(', ')}` : 'No code contract check observed'}</p>
          {selected.preflight && <p className="mt-2">Preflight: {selected.preflight.status} · {time(selected.preflight.at)} · {selected.preflight.knowledgeRecords} prior lessons{selected.preflight.blockers.length ? ` · Blockers: ${selected.preflight.blockers.join(', ')}` : ''}</p>}
          {selected.replanRequest && <div className="mt-2 text-amber-200"><p>Replan requested from SEER: {selected.replanRequest.reason}</p>{selected.replanRequest.subgoals.length > 0 && <ol className="list-decimal pl-5 mt-1">{selected.replanRequest.subgoals.map((s,i)=><li key={i}><strong>{s.title}</strong> — {s.objective}</li>)}</ol>}<p className="text-neutral-400 mt-1">The request is saved. Execution and verification are reported in the missions' own receipts.</p></div>}
          {selected.execution && <p className="mt-2">Latest saved receipts: {selected.execution.verifiedActions} verified steps · Failed: {selected.execution.failedActions} · Remaining: {selected.execution.remaining.join(', ') || 'No missing machine gates'}</p>}
          {selected.execution?.recovery && <p className="mt-2 text-amber-300">Recovery: {selected.execution.recovery.code} · {selected.execution.recovery.next}</p>}
          <p className="mt-2 text-neutral-500">Verified tool steps and HTTP status do not by themselves prove the main goal is met.</p>
          {selected.completionReason && <p className="mt-3 whitespace-pre-wrap">Reported result: {selected.completionReason}</p>}
          <button onClick={onReview} className="mt-3 px-3 py-2 border border-neutral-900 rounded flex items-center gap-1"><ListChecks className="w-3 h-3" />Open existing review</button>
          <h4 className="font-semibold mt-4">Latest receipts · saved session window</h4>
          {!selected.receipts.length && <p className="text-neutral-500 mt-2">No receipts observed.</p>}
          {selected.receipts.slice().reverse().map((r,i) => <article key={r.actionId || i} className="mt-2 border border-[#123047] rounded p-3 space-y-1">
            <p>{r.type} · {time(r.at)}</p><p className="text-neutral-400">{resultLabel(r)}</p>
            {r.expectedOutcome && <p>Expected: {r.expectedOutcome}</p>}{r.error && <p className="text-amber-300">Error: {r.error}</p>}
            {r.result.status !== null && <p>HTTP: {r.result.status} · transport observation</p>}
            {r.result.exitCode !== null && <p>Exit code: {r.result.exitCode} · {r.result.kind || 'tool'}</p>}
            {r.result.commit && <p className="break-all">Commit: {r.result.commit}</p>}{r.result.path && <p className="break-all">File: {r.result.path}</p>}
            {r.result.sha256 && <p className="break-all text-neutral-500">Hash: {r.result.sha256}</p>}
            {r.result.evidenceRefs.length > 0 && <p className="break-all">Evidence references: {r.result.evidenceRefs.join(', ')}</p>}
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
        if(data.schema!=='jaco.aura-agent-board/v1')throw new Error('Invalid response from the agent registry.');
        if(data.network?.schema!=='jaco.agent-network/v1')throw new Error('The agent map is missing from this server version. Restart the updated JACO server.');
        if(active){setSnapshot(data);setError(null);}
      }catch(e:any){if(active)setError(e.message || 'The agent registry could not be reached.');}
      if(active)timer=window.setTimeout(read,document.visibilityState==='hidden'?20000:3000);
    }
    void read();
    return()=>{active=false;controller.abort();window.clearTimeout(timer);};
  },[]);
  return <AuraAgentBoard {...props} snapshot={snapshot} error={error}/>;
}
