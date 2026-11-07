import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Target, ShieldAlert, MessageSquare, GitBranch } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// The plan as a person reads it: the final goal, the steps toward it with what each needs, what changed when a step did
// not lead toward the goal, and room to say what you think. Your comments reach every step as direction.
type Need = { kind: string; label: string; approval: boolean };
type Comment = { id: string; nodeKey: string | null; text: string; at: string };
type Node = { key: string; title: string; objective: string; status: string; statusText: string; failure: string | null; needs: Need[]; comments: Comment[] };
type Plan = { id: string; title: string; objective: string; status: string; progress: { done: number; total: number }; needsApproval: Need[]; nodes: Node[]; changes: Array<{ at: string | null; reason: string | null; replaced: string | null }>; comments: Comment[] };

const tone: Record<string, string> = { VERIFIED: 'text-emerald-300', FAILED: 'text-rose-300', RUNNING: 'text-sky-300', DISPATCHED: 'text-sky-300', READY: 'text-slate-200', BLOCKED: 'text-slate-400', SUPERSEDED: 'text-slate-500 line-through', CANCELLED: 'text-slate-500' };

function CommentBox({ graphId, nodeKey, onSaved }: { graphId: string; nodeKey: string | null; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    if (text.trim().length < 2) return;
    try {
      const r = await fetch('/api/aura/plan/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graphId, nodeKey, text }) }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      setText(''); setError(''); onSaved();
    } catch (e: any) { setError(String(e?.message || e)); }
  };
  return <div className="mt-1 flex gap-1">
    <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }}
      placeholder={nodeKey ? tr('Din synpunkt på det här steget…', 'Your view on this step…') : tr('Din synpunkt på hela planen…', 'Your view on the whole plan…')}
      className="flex-1 rounded border border-slate-700 bg-[#0a111c] px-2 py-1 text-xs" />
    <button type="button" onClick={() => void save()} className="rounded border border-slate-600 px-2 text-xs">{tr('Skicka', 'Send')}</button>
    {error && <span role="alert" className="text-xs text-amber-300">{error}</span>}
  </div>;
}

export function StrategyBoard() {
  const { tr } = useUiLanguage();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const r = await fetch('/api/aura/plan', { cache: 'no-store' }).then(readAuraResponse); if (r.success === false) throw new Error(r.error); setPlans(r.plans || []); setError(''); }
    catch (e: any) { setError(String(e?.message || e)); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(load, 15000); return () => window.clearInterval(t); }, [load]);

  return <section data-testid="strategy-board" className="space-y-4 p-3 text-slate-200">
    <header className="flex items-center justify-between">
      <h2 className="text-base font-semibold">{tr('Spelplanen', 'The game plan')}</h2>
      <button type="button" onClick={() => void load()} aria-label={tr('Uppdatera', 'Refresh')}><RefreshCw size={14} /></button>
    </header>
    <p className="text-xs text-slate-400">{tr('Aura delar upp ett mål i steg och visar vad varje steg behöver. Skriv dina synpunkter, så tar Aura med dem i nästa steg. Steg som inte leder mot målet byts ut, och du ser varför.', 'Aura splits a goal into steps and shows what each step needs. Write what you think, and Aura takes it into the next steps. Steps that do not lead toward the goal are replaced, and you see why.')}</p>
    {error && <p role="alert" className="text-amber-300 text-sm">{tr('Planen kunde inte läsas just nu.', 'The plan could not be read right now.')} ({error})</p>}
    {plans && plans.length === 0 && <p className="text-sm text-slate-400">{tr('Ingen plan än. Ge Aura ett större mål i chatten, så visas planen här.', 'No plan yet. Give Aura a larger goal in the chat, and the plan appears here.')}</p>}
    {(plans || []).map(plan => <article key={plan.id} className="rounded-lg border border-slate-700 bg-[#0d1726] p-3">
      <div className="flex items-start gap-2"><Target size={16} className="mt-0.5 text-sky-300" />
        <div><div className="text-xs uppercase tracking-wide text-slate-400">{tr('Slutmål', 'Final goal')}</div>
          <div className="font-medium">{plan.objective}</div>
          <div className="text-xs text-slate-400">{tr('Klart', 'Done')}: {plan.progress.done}/{plan.progress.total}</div></div></div>
      {plan.needsApproval.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300"><ShieldAlert size={13} />{tr('Behöver ditt godkännande när det blir aktuellt', 'Needs your approval when the time comes')}: {plan.needsApproval.map(n => n.label).join(', ')}</p>}
      <ol className="mt-3 space-y-2">
        {plan.nodes.map((n, i) => <li key={n.key} className="rounded border border-slate-800 p-2">
          <div className="flex items-baseline justify-between gap-2"><span className={tone[n.status] || ''}>{i + 1}. {n.title}</span><span className="text-xs text-slate-400">{n.statusText}</span></div>
          <div className="text-xs text-slate-400">{n.objective}</div>
          {n.needs.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{n.needs.map(x => <span key={x.kind + (x.label)} className={`rounded px-1.5 py-0.5 text-[11px] ${x.approval ? 'bg-amber-950 text-amber-200' : 'bg-slate-800 text-slate-300'}`}>{x.label}{x.approval ? ' ✋' : ''}</span>)}</div>}
          {n.failure && <div className="mt-1 text-xs text-rose-300">{n.failure.slice(0, 240)}</div>}
          {n.comments.map(c => <div key={c.id} className="mt-1 flex gap-1 text-xs text-slate-300"><MessageSquare size={12} />{c.text}</div>)}
          <CommentBox graphId={plan.id} nodeKey={n.key} onSaved={load} />
        </li>)}
      </ol>
      {plan.changes.length > 0 && <div className="mt-3"><div className="flex items-center gap-1 text-xs text-slate-400"><GitBranch size={12} />{tr('Ändringar i planen', 'Changes to the plan')}</div>
        {plan.changes.map((c, i) => <div key={i} className="text-xs text-slate-300">· {c.reason}</div>)}</div>}
      {plan.comments.map(c => <div key={c.id} className="mt-2 flex gap-1 text-xs text-slate-300"><MessageSquare size={12} />{c.text}</div>)}
      <div className="mt-2"><CommentBox graphId={plan.id} nodeKey={null} onSaved={load} /></div>
    </article>)}
  </section>;
}
