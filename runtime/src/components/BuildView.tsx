import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { Check, AlertTriangle, X, FileText, FilePen, Terminal, Globe, GitBranch, Wrench, Send, Loader2 } from 'lucide-react';
import { describeNovaTask } from '../lib/novaActivityText';

// Build view (operator 2026-10-08: "no live feeling or chat"): a chat where the operator says what to
// build and watches Nova's steps land one by one, with file changes shown as diffs. Mobile first.
// Each mission streams from GET /api/aura/missions/:id/stream (src/server/connected/liveMission.mjs).

interface Step { n: number; type: string; input: any; ok: boolean; verified: boolean; error: string | null; at: string | null; text: string | null; url: string | null }
interface LiveMission { id: string; goal: string; status: string; phase: string | null; activeTask: { type: string; data: any } | null; steps: Step[]; answer: string | null }

const STORE = 'jaco.build.missions';
const KEEP = 8;
const readIds = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE) || '[]'); return Array.isArray(v) ? v.slice(-KEEP) : []; } catch { return []; } };
const writeIds = (ids: string[]) => { try { localStorage.setItem(STORE, JSON.stringify(ids.slice(-KEEP))); } catch { /* private window: the thread just isn't remembered */ } };

const iconFor = (type: string) => {
  if (type === 'repo-edit' || type === 'repo-write') return FilePen;
  if (type === 'repo-read' || type === 'repo-list') return FileText;
  if (type === 'shell' || type === 'repo-test') return Terminal;
  if (type === 'web-fetch' || type.startsWith('browser')) return Globe;
  if (type.startsWith('git')) return GitBranch;
  return Wrench;
};

// Old/new text of a repo-edit, or a unified diff in a result, as coloured lines.
function DiffLines({ step }: { step: Step }) {
  const lines: [string, string][] = [];
  if (step.type === 'repo-edit' && typeof step.input?.old === 'string' && typeof step.input?.new === 'string') {
    step.input.old.split('\n').forEach((l: string) => lines.push(['-', l]));
    step.input.new.split('\n').forEach((l: string) => lines.push(['+', l]));
  } else if (step.text && /^(diff --git|@@|\+\+\+|---)/m.test(step.text)) {
    step.text.split('\n').forEach(l => lines.push([l[0] === '+' && !l.startsWith('+++') ? '+' : l[0] === '-' && !l.startsWith('---') ? '-' : ' ', l]));
  } else if (step.text) {
    return <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-black/40 p-2 text-[11px] text-slate-300">{step.text}</pre>;
  } else return null;
  return (
    <pre className="mt-2 max-h-72 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-snug">
      {lines.map(([sign, text], i) => (
        <div key={i} className={sign === '+' ? 'bg-emerald-950/60 text-emerald-300' : sign === '-' ? 'bg-red-950/60 text-red-300' : 'text-slate-400'}>
          {step.type === 'repo-edit' ? `${sign} ${text}` : text}
        </div>
      ))}
    </pre>
  );
}

const StepCard: React.FC<{ step: Step; autoOpen: boolean }> = ({ step, autoOpen }) => {
  const [open, setOpen] = useState(autoOpen);
  const Icon = iconFor(step.type);
  const state = step.ok && step.verified ? 'ok' : step.ok ? 'unverified' : 'failed';
  return (
    <button type="button" onClick={() => setOpen(o => !o)} className="w-full text-left rounded-lg border border-[#163049] bg-[#0b1620] px-3 py-2">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
        <span className="flex-1 text-[13px] text-slate-200 break-words">{describeNovaTask({ type: step.type, data: step.input })}</span>
        {state === 'ok' && <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-label="verifierat" />}
        {state === 'unverified' && <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label="inte verifierat" />}
        {state === 'failed' && <X className="h-4 w-4 shrink-0 text-red-400" aria-label="misslyckades" />}
      </div>
      {step.error && <div className="mt-1 text-[12px] text-red-300 break-words">{step.error}</div>}
      {step.url && <a href={step.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="mt-1 block text-[12px] text-cyan-300 underline break-all">{step.url}</a>}
      {open && <DiffLines step={step} />}
    </button>
  );
};

const MissionThread: React.FC<{ id: string; onGone: (id: string) => void }> = ({ id, onGone }) => {
  const [m, setM] = useState<LiveMission | null>(null);
  const [lost, setLost] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => {
    const source = new EventSource(`/api/aura/missions/${encodeURIComponent(id)}/stream`);
    source.addEventListener('mission', (e: MessageEvent) => { setM(JSON.parse(e.data)); setLost(''); });
    source.addEventListener('failure', () => { source.close(); onGone(id); });
    // EventSource reconnects by itself; say so instead of looking frozen.
    source.onerror = () => setLost(source.readyState === EventSource.CLOSED ? '' : 'Tappade kontakten, återansluter…');
    return () => source.close();
  }, [id]);

  const decide = async (decision: 'confirm' | 'resume' | 'cancel') => {
    setBusy(decision);
    try {
      await fetch(`/api/aura/workbench/approvals/${encodeURIComponent(`mission:${id}`)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: `Bygg-vyn: ${decision}` }),
      }).then(readAuraResponse);
    } catch (e: any) { setLost(`Kunde inte ${decision}: ${e?.message || e}`); }
    finally { setBusy(''); }
  };

  if (!m) return <div className="text-[12px] text-slate-500 px-1">Laddar uppdrag…</div>;
  const working = m.status === 'ACTIVE';
  return (
    <div className="space-y-2">
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-cyan-700/40 px-3 py-2 text-[14px] text-white break-words">{m.goal}</div>
      {m.steps.map((s, i) => <StepCard key={s.n} step={s} autoOpen={i === m.steps.length - 1 && (s.type === 'repo-edit' || s.type === 'git-diff')} />)}
      {working && (
        <div className="flex items-center gap-2 px-1 text-[13px] text-cyan-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {m.activeTask ? `Nova: ${describeNovaTask(m.activeTask)}` : 'Nova planerar nästa steg…'}
        </div>
      )}
      {m.answer && <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-[#13212e] px-3 py-2 text-[14px] text-slate-100 whitespace-pre-wrap break-words">{m.answer}</div>}
      {m.status === 'AWAITING_VERIFICATION' && (
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-[12px] text-amber-300">Nova anser att det är klart. Stämmer det?</span>
          <button disabled={!!busy} onClick={() => decide('confirm')} className="rounded-full bg-emerald-600 px-4 py-2 text-[13px] text-white">Godkänn</button>
          <button disabled={!!busy} onClick={() => decide('resume')} className="rounded-full bg-[#1d3347] px-4 py-2 text-[13px] text-slate-100">Fortsätt jobba</button>
          <button disabled={!!busy} onClick={() => decide('cancel')} className="rounded-full bg-[#2a1a1a] px-4 py-2 text-[13px] text-red-200">Avbryt</button>
        </div>
      )}
      {m.status === 'BLOCKED' && (
        <div className="flex flex-wrap gap-2">
          <span className="w-full text-[12px] text-amber-300">Nova har stannat och behöver dig.</span>
          <button disabled={!!busy} onClick={() => decide('resume')} className="rounded-full bg-[#1d3347] px-4 py-2 text-[13px] text-slate-100">Försök igen</button>
          <button disabled={!!busy} onClick={() => decide('cancel')} className="rounded-full bg-[#2a1a1a] px-4 py-2 text-[13px] text-red-200">Avbryt</button>
        </div>
      )}
      {m.status === 'DONE' && <div className="text-[12px] text-emerald-400 px-1">Klart</div>}
      {m.status === 'CANCELLED' && <div className="text-[12px] text-slate-500 px-1">Avbrutet</div>}
      {lost && <div className="text-[12px] text-amber-300 px-1">{lost}</div>}
    </div>
  );
};

export const BuildView: React.FC = () => {
  const [ids, setIds] = useState<string[]>(readIds);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [ids.length]);

  const remember = (next: string[]) => { setIds(next); writeIds(next); };
  const send = async () => {
    const goal = text.trim();
    if (!goal || busy) return;
    setBusy(true); setError('');
    try {
      const body = await fetch('/api/aura/missions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'MISSION_NOT_CREATED');
      setText('');
      remember([...ids.filter(x => x !== body.mission.id), body.mission.id]);
    } catch (e: any) { setError(`Uppdraget skapades inte: ${e?.message || e}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050b11]">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-6">
        {ids.length === 0 && (
          <div className="mt-10 px-4 text-center text-slate-400">
            <div className="text-[18px] text-slate-200">Vad vill du bygga?</div>
            <div className="mt-2 text-[13px]">Skriv vad du vill ha gjort. Du ser varje steg Nova tar, live, och varje fil som ändras.</div>
          </div>
        )}
        {ids.map(id => <MissionThread key={id} id={id} onGone={gone => remember(ids.filter(x => x !== gone))} />)}
        <div ref={end} />
      </div>
      {error && <div className="px-3 pb-1 text-[12px] text-red-300 break-words">{error}</div>}
      <form onSubmit={e => { e.preventDefault(); void send(); }} className="shrink-0 border-t border-[#123047] p-2 flex items-end gap-2">
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={1}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
          placeholder="Vad vill du bygga?"
          className="flex-1 resize-none rounded-2xl bg-[#0b1620] px-4 py-3 text-[16px] text-slate-100 placeholder:text-slate-500 outline-none focus:ring-1 focus:ring-cyan-600 max-h-40"
        />
        <button type="submit" disabled={busy || !text.trim()} aria-label="Skicka" className="h-12 w-12 shrink-0 rounded-full bg-cyan-600 disabled:bg-[#1d3347] flex items-center justify-center">
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-white" /> : <Send className="h-5 w-5 text-white" />}
        </button>
      </form>
    </div>
  );
};
