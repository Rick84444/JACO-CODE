import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Target, ShieldAlert, MessageSquare, GitBranch, X } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// The Gameboard: each plan as a tree with the final goal at the top, the subgoals that lead to it below, and under each
// subgoal the steps it builds on. The box being worked on glows faint blue. Click a box to read what the step is for,
// why it leads to the goal, what it needs, and the notes Aura and its helpers left there. Write what you think on a box
// or on the whole plan; Aura takes it into the next steps.
type Need = { kind: string; label: string; approval: boolean; state?: 'have' | 'missing' | 'approval' | null };
type Comment = { id: string; nodeKey: string | null; text: string; at: string; author?: 'aura' | 'operator' };
type Node = { key: string; title: string; objective: string; status: string; statusText: string; failure: string | null; dependencies: string[]; needs: Need[]; comments: Comment[] };
type Plan = { id: string; title: string; objective: string; status: string; progress: { done: number; total: number }; needsApproval: Need[]; nodes: Node[]; changes: Array<{ at: string | null; reason: string | null; replaced: string | null }>; comments: Comment[]; abilities?: { missing: string[]; text: string } | null };

// Aura's text never uses emoji: the state of a need is a word and a colour.
const STATE_WORD: Record<string, [string, string]> = { have: ['har', 'have'], missing: ['saknas', 'missing'], approval: ['ditt ja', 'your yes'] };
const chip = (state?: string | null, approval?: boolean) => state === 'have' ? 'bg-emerald-950 text-emerald-200' : state === 'missing' ? 'bg-rose-950 text-rose-200' : state === 'approval' || approval ? 'bg-amber-950 text-amber-200' : 'bg-slate-800 text-slate-300';
const border: Record<string, string> = { VERIFIED: 'border-emerald-700', FAILED: 'border-rose-700', RUNNING: 'border-sky-400', DISPATCHED: 'border-sky-400', READY: 'border-slate-500', BLOCKED: 'border-slate-700', SUPERSEDED: 'border-slate-800 opacity-50', CANCELLED: 'border-slate-800 opacity-50' };
const working = (status: string) => status === 'RUNNING' || status === 'DISPATCHED';

const BLUEPRINT_CSS = `
.jaco-blueprint{background-color:#0a1a33;background-image:linear-gradient(rgba(120,170,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(120,170,255,.08) 1px,transparent 1px);background-size:24px 24px}
@keyframes jaco-working{0%,100%{box-shadow:0 0 0 0 rgba(56,189,248,.15)}50%{box-shadow:0 0 14px 3px rgba(56,189,248,.45)}}
.jaco-working{animation:jaco-working 2.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.jaco-working{animation:none;box-shadow:0 0 10px 2px rgba(56,189,248,.35)}}
.jaco-tree ul{position:relative;display:flex;justify-content:center;margin:0;padding:18px 0 0}
.jaco-tree li{position:relative;list-style:none;display:flex;flex-direction:column;align-items:center;padding:18px 5px 0}
.jaco-tree li::before,.jaco-tree li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:18px;border-top:1px solid rgba(125,180,255,.55)}
.jaco-tree li::after{right:auto;left:50%;border-left:1px solid rgba(125,180,255,.55)}
.jaco-tree li:only-child::before,.jaco-tree li:only-child::after{display:none}
.jaco-tree li:only-child{padding-top:0}
.jaco-tree li:first-child::before,.jaco-tree li:last-child::after{border:0 none}
.jaco-tree li:last-child::before{border-right:1px solid rgba(125,180,255,.55);border-radius:0 6px 0 0}
.jaco-tree li:first-child::after{border-radius:6px 0 0 0}
.jaco-tree ul ul::before{content:'';position:absolute;top:0;left:50%;height:18px;border-left:1px solid rgba(125,180,255,.55)}
.jaco-tree > ul{padding-top:0;width:max-content;min-width:100%}`;

const LIVE = (n: Node) => n.status !== 'SUPERSEDED' && n.status !== 'CANCELLED';
export type TreeItem = { node: Node; children: TreeItem[]; repeat: boolean };
// The plan's steps as a tree that leads up to the final goal: the subgoals nothing else builds on hang directly
// under the goal, and each box has the steps it builds on below it. A step that several subgoals build on is drawn
// in full once and named again where it recurs, so the tree stays a tree. Replaced steps leave the tree; the plan's
// changes below it say why.
export function planTree(nodes: Node[]): TreeItem[] {
  const live = nodes.filter(LIVE);
  const byKey = new Map(live.map(n => [n.key, n]));
  const builtOn = new Set(live.flatMap(n => n.dependencies.filter(k => byKey.has(k))));
  const seen = new Set<string>();
  const grow = (node: Node, path: Set<string>): TreeItem => {
    if (seen.has(node.key) || path.has(node.key)) return { node, children: [], repeat: true };
    seen.add(node.key);
    const next = new Set(path).add(node.key);
    const below = node.dependencies.map(k => byKey.get(k)).filter((n): n is Node => Boolean(n));
    return { node, repeat: false, children: below.map(n => grow(n, next)) };
  };
  const roots = live.filter(n => !builtOn.has(n.key));
  const tree = (roots.length ? roots : live.slice(-1)).map(n => grow(n, new Set()));
  // Anything a cycle kept out of reach still gets a place under the goal.
  for (const n of live) if (!seen.has(n.key)) tree.push(grow(n, new Set()));
  return tree;
}

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
  return <div className="mt-2 flex gap-1">
    <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }}
      placeholder={nodeKey ? tr('Din synpunkt på det här steget…', 'Your view on this step…') : tr('Din synpunkt på hela planen…', 'Your view on the whole plan…')}
      className="flex-1 rounded border border-sky-900 bg-[#081426] px-2 py-1 text-xs" />
    <button type="button" onClick={() => void save()} className="rounded border border-sky-800 px-2 text-xs">{tr('Skicka', 'Send')}</button>
    {error && <span role="alert" className="text-xs text-amber-300">{error}</span>}
  </div>;
}

function Notes({ comments }: { comments: Comment[] }) {
  const { tr } = useUiLanguage();
  if (!comments.length) return null;
  return <div className="mt-2 space-y-1">{comments.map(c => <div key={c.id} className="flex gap-1.5 text-xs">
    <MessageSquare size={12} className={c.author === 'aura' ? 'text-sky-300 mt-0.5' : 'text-slate-300 mt-0.5'} />
    <span><strong className="font-medium">{c.author === 'aura' ? 'Aura' : tr('Du', 'You')}:</strong> {c.text}</span>
  </div>)}</div>;
}

function StepDetails({ plan, node, onClose, onSaved }: { plan: Plan; node: Node; onClose: () => void; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const after = plan.nodes.filter(n => n.dependencies.includes(node.key));
  const before = plan.nodes.filter(n => node.dependencies.includes(n.key));
  return <aside role="dialog" aria-label={node.title} className="rounded-lg border border-sky-700 bg-[#081426] p-3 text-sm">
    <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{node.title}</h3>
      <button type="button" onClick={onClose} aria-label={tr('Stäng', 'Close')}><X size={14} /></button></div>
    <div className="text-xs text-slate-400">{node.statusText}</div>
    <p className="mt-2">{node.objective}</p>
    <p className="mt-2 text-xs text-slate-300"><strong>{tr('Varför', 'Why')}:</strong> {tr('steget för planen närmare slutmålet', 'the step moves the plan toward the final goal')}: {plan.objective}</p>
    {before.length > 0 && <p className="mt-1 text-xs text-slate-400">{tr('Bygger på', 'Builds on')}: {before.map(n => n.title).join(', ')}</p>}
    {after.length > 0 && <p className="text-xs text-slate-400">{tr('Leder vidare till', 'Leads on to')}: {after.map(n => n.title).join(', ')}</p>}
    {node.needs.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{node.needs.map(x => <span key={x.kind + x.label} className={`rounded px-1.5 py-0.5 text-[11px] ${chip(x.state, x.approval)}`}>{x.label}{x.state ? ` (${tr(...STATE_WORD[x.state])})` : ''}</span>)}</div>}
    {node.failure && <p className="mt-2 text-xs text-rose-300">{node.failure.slice(0, 600)}</p>}
    <Notes comments={node.comments} />
    <CommentBox graphId={plan.id} nodeKey={node.key} onSaved={onSaved} />
  </aside>;
}

const stepOrder = (plan: Plan) => new Map(plan.nodes.map((n, i) => [n.key, i + 1]));

function Branch({ item, order, selected, onPick }: { item: TreeItem; order: Map<string, number>; selected: string | null; onPick: (key: string) => void }) {
  const { tr } = useUiLanguage();
  const n = item.node;
  const box = item.repeat
    ? <button type="button" onClick={() => onPick(n.key)} className="w-40 rounded-md border border-dashed border-sky-800 bg-[#081426]/80 p-1.5 text-center text-[11px] text-sky-200/80">
        {tr('Samma steg som', 'Same step as')} {order.get(n.key)}: {n.title}</button>
    : <button type="button" onClick={() => onPick(n.key)} aria-pressed={selected === n.key} data-working={working(n.status) || undefined}
        className={`w-44 rounded-md border-2 bg-[#081426]/90 p-2 text-left ${border[n.status] || 'border-slate-700'} ${working(n.status) ? 'jaco-working' : ''} ${selected === n.key ? 'ring-1 ring-sky-300' : ''}`}>
        <div className="text-[10px] uppercase tracking-widest text-sky-300/70">{tr('Steg', 'Step')} {order.get(n.key)} · {n.statusText}</div>
        <div className="mt-0.5 text-sm font-medium leading-snug">{n.title}</div>
        {n.needs.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{n.needs.slice(0, 4).map(x => <span key={x.kind + x.label} className={`rounded px-1 text-[10px] ${chip(x.state, x.approval)}`}>{x.label}</span>)}</div>}
        {n.comments.length > 0 && <div className="mt-1 text-[10px] text-sky-300/80">{n.comments.length} {tr('anteckningar', 'notes')}</div>}
      </button>;
  return <li>{box}{item.children.length > 0 && <ul>{item.children.map(c => <React.Fragment key={c.node.key}><Branch item={c} order={order} selected={selected} onPick={onPick} /></React.Fragment>)}</ul>}</li>;
}

export function StrategyBoard({ focusPlanId = null }: { focusPlanId?: string | null }) {
  const { tr } = useUiLanguage();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ plan: string; node: string } | null>(null);
  const load = useCallback(async () => {
    try { const r = await fetch('/api/aura/plan', { cache: 'no-store' }).then(readAuraResponse); if (r.success === false) throw new Error(r.error); setPlans(r.plans || []); setError(''); }
    catch (e: any) { setError(String(e?.message || e)); }
  }, []);
  useEffect(() => { void load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, [load]);
  const shown = (plans || []).slice().sort((a, b) => (a.id === focusPlanId ? -1 : b.id === focusPlanId ? 1 : 0));

  return <section data-testid="strategy-board" className="jaco-blueprint min-h-full space-y-4 p-3 text-slate-100">
    <style>{BLUEPRINT_CSS}</style>
    <header className="flex items-center justify-between">
      <h2 className="text-base font-semibold tracking-wide">Gameboard</h2>
      <button type="button" onClick={() => void load()} aria-label={tr('Uppdatera', 'Refresh')}><RefreshCw size={14} /></button>
    </header>
    <p className="text-xs text-sky-200/80">{tr('Varje plan är ett träd: slutmålet överst, delmålen som leder dit under det, och under varje delmål stegen det bygger på. Rutan som det arbetas med lyser svagt blått. Klicka på en ruta för att se vad den är till för och vad den behöver, och skriv dina synpunkter, så tar Aura med dem i nästa steg.', 'Each plan is a tree: the final goal at the top, the subgoals that lead to it below, and under each subgoal the steps it builds on. The box being worked on glows faint blue. Click a box to see what it is for and what it needs, and write what you think; Aura takes it into the next steps.')}</p>
    {error && <p role="alert" className="text-amber-300 text-sm">{tr('Planen kunde inte läsas just nu.', 'The plan could not be read right now.')} ({error})</p>}
    {plans && plans.length === 0 && <p className="text-sm text-slate-300">{tr('Ingen plan än. Ge Aura ett större mål i chatten, så ritas planen här.', 'No plan yet. Give Aura a larger goal in the chat, and the plan is drawn here.')}</p>}
    {shown.map(plan => {
      const selected = open?.plan === plan.id ? plan.nodes.find(n => n.key === open.node) : null;
      return <article key={plan.id} id={`plan-${plan.id}`} className={`rounded-lg border p-3 ${plan.id === focusPlanId ? 'border-sky-500' : 'border-sky-900'} bg-[#0b1d3a]/70`}>
        {plan.abilities && <p className={`text-sm ${plan.abilities.missing.length ? 'text-amber-200' : 'text-emerald-300'}`} data-testid="aura-abilities">{plan.abilities.text}</p>}
        {plan.needsApproval.length > 0 && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-300"><ShieldAlert size={13} />{tr('Behöver ditt godkännande när det blir aktuellt', 'Needs your approval when the time comes')}: {plan.needsApproval.map(n => n.label).join(', ')}</p>}
        <div className="jaco-tree mt-3 overflow-x-auto pb-2" data-testid="plan-tree">
          <ul><li>
            <div className="w-64 max-w-full rounded-md border-2 border-sky-400 bg-[#0d2547] p-2 text-center">
              <div className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-widest text-sky-300"><Target size={12} />{tr('Slutmål', 'Final goal')}</div>
              <div className="mt-0.5 text-sm font-semibold leading-snug">{plan.objective}</div>
              <div className="text-[11px] text-sky-200/70">{tr('Klart', 'Done')}: {plan.progress.done}/{plan.progress.total}</div>
            </div>
            {plan.nodes.some(LIVE) && <ul>{planTree(plan.nodes).map(item => <React.Fragment key={item.node.key}><Branch item={item} order={stepOrder(plan)} selected={selected?.key || null}
              onPick={key => setOpen(open?.plan === plan.id && open.node === key ? null : { plan: plan.id, node: key })} /></React.Fragment>)}</ul>}
          </li></ul>
        </div>
        {selected && <div className="mt-3"><StepDetails plan={plan} node={selected} onClose={() => setOpen(null)} onSaved={load} /></div>}
        {plan.changes.length > 0 && <div className="mt-3"><div className="flex items-center gap-1 text-xs text-sky-200/70"><GitBranch size={12} />{tr('Ändringar i planen', 'Changes to the plan')}</div>
          {plan.changes.map((c, i) => <div key={i} className="text-xs text-slate-300">{c.reason}</div>)}</div>}
        <Notes comments={plan.comments} />
        <CommentBox graphId={plan.id} nodeKey={null} onSaved={load} />
      </article>;
    })}
  </section>;
}
