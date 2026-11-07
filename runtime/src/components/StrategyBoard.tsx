import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, MessageSquare, GitBranch, X } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';

// The Gameboard: one plan at a time, drawn like a family tree read backwards. The goal (what the operator wants) is
// always first, at the top. Below it hang the subgoals that lead to it, and below each subgoal what it needs first;
// that is how Aura is meant to think: from the goal back to what has to happen. The subgoal being worked on is marked
// as active and glows faint blue. Clicking any box opens a large card with the whole description, why it is there,
// what it builds on and leads to, what it needs, and the notes Aura and its helpers left; the operator can answer
// there, and Aura takes it into the next steps.
type Need = { kind: string; label: string; approval: boolean; state?: 'have' | 'missing' | 'approval' | null };
type Comment = { id: string; nodeKey: string | null; text: string; at: string; author?: 'aura' | 'operator' };
type Node = { key: string; title: string; objective: string; status: string; statusText: string; failure: string | null; dependencies: string[]; needs: Need[]; comments: Comment[] };
type Plan = { id: string; title: string; objective: string; status: string; progress: { done: number; total: number }; needsApproval: Need[]; nodes: Node[]; changes: Array<{ at: string | null; reason: string | null; replaced: string | null }>; comments: Comment[]; abilities?: { missing: string[]; text: string } | null };

// Aura's text never uses emoji: the state of a need is a word and a colour.
const STATE_WORD: Record<string, [string, string]> = { have: ['har', 'have'], missing: ['saknas', 'missing'], approval: ['ditt ja', 'your yes'] };
const chip = (state?: string | null, approval?: boolean) => state === 'have' ? 'bg-emerald-950 text-emerald-200' : state === 'missing' ? 'bg-rose-950 text-rose-200' : state === 'approval' || approval ? 'bg-amber-950 text-amber-200' : 'bg-neutral-800 text-neutral-300';
// Every box is white; the one being worked on is blue and blinks. Whether a step is done or failed is a word.
const STATUS_TEXT: Record<string, string> = { FAILED: 'text-rose-300', VERIFIED: 'text-white/60' };
const working = (status: string) => status === 'RUNNING' || status === 'DISPATCHED';

// Lines are quiet white. The line from the active box up to the goal glows faint white: the way the work is heading.
const LINE = 'rgba(255,255,255,.28)';
const PATH = 'rgba(255,255,255,.95)';
const PATH_GLOW = 'drop-shadow(0 0 3px rgba(255,255,255,.75))';
const BOARD_CSS = `
@keyframes jaco-working{0%,100%{border-color:rgba(56,189,248,.55);box-shadow:0 0 0 0 rgba(56,189,248,0)}50%{border-color:rgba(56,189,248,1);box-shadow:0 0 18px 2px rgba(56,189,248,.55)}}
.jaco-working{animation:jaco-working 1.8s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.jaco-working{animation:none;border-color:rgb(56,189,248);box-shadow:0 0 14px 2px rgba(56,189,248,.45)}}
.jaco-goal{box-shadow:0 0 28px 6px rgba(255,255,255,.16),0 0 2px rgba(253,224,71,.6)}
.jaco-tree ul{position:relative;display:flex;justify-content:center;margin:0;padding:26px 0 0}
.jaco-tree li{position:relative;list-style:none;display:flex;flex-direction:column;align-items:center;padding:26px 8px 0}
.jaco-tree li::before,.jaco-tree li::after{content:'';position:absolute;top:0;right:50%;width:50%;height:26px;border-top:1px solid ${LINE}}
.jaco-tree li::after{right:auto;left:50%;border-left:1px solid ${LINE}}
.jaco-tree li:only-child::before,.jaco-tree li:only-child::after{display:none}
.jaco-tree li:only-child{padding-top:0}
.jaco-tree li:first-child::before,.jaco-tree li:last-child::after{border:0 none}
.jaco-tree li:last-child::before{border-right:1px solid ${LINE};border-radius:0 8px 0 0}
.jaco-tree li:first-child::after{border-radius:8px 0 0 0}
.jaco-tree ul ul::before{content:'';position:absolute;top:0;left:50%;height:26px;border-left:1px solid ${LINE}}
.jaco-tree li.jp-l::before{border-top-color:${PATH};filter:${PATH_GLOW}}
.jaco-tree li.jp-r::after{border-top-color:${PATH};filter:${PATH_GLOW}}
.jaco-tree li.jp-v::after{border-left-color:${PATH};filter:${PATH_GLOW}}
.jaco-tree li.jp-v:last-child::before{border-right-color:${PATH};filter:${PATH_GLOW}}
.jaco-tree ul.jaco-path-ul::before{border-color:${PATH};filter:${PATH_GLOW}}
.jaco-tree > ul{padding-top:0;width:max-content;min-width:100%}`;

// True when the work is somewhere in this branch: its line up to the goal glows.
const onPath = (item: TreeItem): boolean => !item.repeat && (working(item.node.status) || item.children.some(onPath));
// Which line pieces above child i glow: its own drop (v), and the bar from it to the middle where the parent's line
// comes down (l = left half, r = right half of each box's share of the bar).
export function litLine(items: TreeItem[]): string[] {
  const p = items.findIndex(onPath);
  const c = (items.length - 1) / 2;
  // Box i owns the bar from i-0.5 to i+0.5; a half glows when it lies between the active box and the middle.
  const lo = Math.min(p, c), hi = Math.max(p, c);
  return items.map((_, i) => p < 0 ? '' : [
    i === p ? 'jp-v' : '',
    i - 0.5 >= lo && i <= hi ? 'jp-l' : '',
    i >= lo && i + 0.5 <= hi ? 'jp-r' : '',
  ].filter(Boolean).join(' '));

}

const LIVE = (n: Node) => n.status !== 'SUPERSEDED' && n.status !== 'CANCELLED';
export type TreeItem = { node: Node; children: TreeItem[]; repeat: boolean };
// The plan's steps as a tree read backwards from the goal: the subgoals nothing else builds on hang directly under the
// goal, and each box has what it needs first below it. A step that several subgoals need is drawn in full once and
// named again where it recurs, so the tree stays a tree. Replaced steps leave the tree; the goal's card says why.
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

// The plan to show first: the one asked for, else the one Aura is working on, else the newest.
export function pickPlan(plans: Plan[], focus: string | null): Plan | null {
  return plans.find(p => p.id === focus) || plans.find(p => p.nodes.some(n => working(n.status))) || plans.find(p => p.status === 'ACTIVE') || plans[0] || null;
}

// The thinker at the board: the mark of the goal and of the Gameboard itself.
const GoalMark = ({ size }: { size: number }) => <img src="/branding/gameboard-goal.png" alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size }} className="shrink-0 rounded-full" />;

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
  return <div className="mt-3 flex gap-1">
    <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void save(); }}
      placeholder={nodeKey ? tr('Din synpunkt på det här steget…', 'Your view on this step…') : tr('Din synpunkt på hela planen…', 'Your view on the whole plan…')}
      className="flex-1 rounded border border-neutral-700 bg-black px-2 py-1.5 text-sm" />
    <button type="button" onClick={() => void save()} className="rounded border border-neutral-600 px-3 text-sm">{tr('Skicka', 'Send')}</button>
    {error && <span role="alert" className="text-xs text-amber-300">{error}</span>}
  </div>;
}

function Notes({ comments }: { comments: Comment[] }) {
  const { tr } = useUiLanguage();
  if (!comments.length) return null;
  return <div className="mt-3 space-y-1.5">{comments.map(c => <div key={c.id} className="flex gap-1.5 text-sm">
    <MessageSquare size={14} className={c.author === 'aura' ? 'mt-0.5 text-sky-300' : 'mt-0.5 text-neutral-300'} />
    <span><strong className="font-medium">{c.author === 'aura' ? 'Aura' : tr('Du', 'You')}:</strong> {c.text}</span>
  </div>)}</div>;
}

// The large card a click opens, over the tree. Escape or the cross closes it.
function Card({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  const { tr } = useUiLanguage();
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-12" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={label} onClick={e => e.stopPropagation()}
      className="relative w-full max-w-2xl rounded-xl border border-neutral-600 bg-neutral-950 p-5 text-neutral-100 shadow-2xl">
      <button type="button" onClick={onClose} aria-label={tr('Stäng', 'Close')} className="absolute right-3 top-3 text-neutral-400 hover:text-white"><X size={18} /></button>
      {children}
    </div>
  </div>;
}

function StepCard({ plan, node, onPick, onClose, onSaved }: { plan: Plan; node: Node; onPick: (key: string | null) => void; onClose: () => void; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const after = plan.nodes.filter(n => LIVE(n) && n.dependencies.includes(node.key));
  const before = plan.nodes.filter(n => LIVE(n) && node.dependencies.includes(n.key));
  const link = (n: Node) => <button key={n.key} type="button" onClick={() => onPick(n.key)} className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-sky-400">{n.title}</button>;
  return <Card label={node.title} onClose={onClose}>
    <div className="text-xs uppercase tracking-widest text-neutral-400">{working(node.status) ? tr('Aktivt delmål', 'Active subgoal') : tr('Delmål', 'Subgoal')} · {node.statusText}</div>
    <h3 className="mt-1 pr-6 text-xl font-semibold leading-snug">{node.title}</h3>
    <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-neutral-200">{node.objective}</p>
    <div className="mt-4 rounded-lg border border-neutral-800 p-3 text-sm">
      <div className="text-xs uppercase tracking-widest text-neutral-400">{tr('Varför', 'Why')}</div>
      <p className="mt-1">{after.length
        ? tr('Det behövs för att nå', 'It is needed to reach') + ': ' + after.map(n => n.title).join(', ') + '. ' + tr('Det leder i sin tur mot målet', 'That in turn leads to the goal') + ': '
        : tr('Det leder direkt till målet', 'It leads directly to the goal') + ': '}{plan.objective}</p>
    </div>
    {before.length > 0 && <div className="mt-3 text-sm"><div className="text-xs uppercase tracking-widest text-neutral-400">{tr('Behöver först', 'Needs first')}</div><div className="mt-1 flex flex-wrap gap-1">{before.map(link)}</div></div>}
    {after.length > 0 && <div className="mt-3 text-sm"><div className="text-xs uppercase tracking-widest text-neutral-400">{tr('Leder vidare till', 'Leads on to')}</div><div className="mt-1 flex flex-wrap gap-1">{after.map(link)}</div></div>}
    {node.needs.length > 0 && <div className="mt-3"><div className="text-xs uppercase tracking-widest text-neutral-400">{tr('Vad steget behöver', 'What the step needs')}</div>
      <div className="mt-1 flex flex-wrap gap-1">{node.needs.map(x => <span key={x.kind + x.label} className={`rounded px-2 py-0.5 text-xs ${chip(x.state, x.approval)}`}>{x.label}{x.state ? ` (${tr(...STATE_WORD[x.state])})` : ''}</span>)}</div></div>}
    {node.failure && <p className="mt-3 text-sm text-rose-300">{node.failure.slice(0, 900)}</p>}
    <Notes comments={node.comments} />
    <CommentBox graphId={plan.id} nodeKey={node.key} onSaved={onSaved} />
    <button type="button" onClick={() => onPick(null)} className="mt-4 text-xs text-sky-300 hover:underline">{tr('Visa målet', 'Show the goal')}</button>
  </Card>;
}

function GoalCard({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  return <Card label={plan.objective} onClose={onClose}>
    <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-yellow-300"><GoalMark size={40} />{tr('Målet', 'The goal')} · {tr('Klart', 'Done')} {plan.progress.done}/{plan.progress.total}</div>
    <h3 className="mt-1 pr-6 text-xl font-semibold leading-snug">{plan.objective}</h3>
    {plan.abilities && <p className={`mt-3 text-sm ${plan.abilities.missing.length ? 'text-amber-200' : 'text-emerald-300'}`} data-testid="aura-abilities">{plan.abilities.text}</p>}
    {plan.needsApproval.length > 0 && <p className="mt-3 flex items-center gap-1.5 text-sm text-amber-300"><ShieldAlert size={14} />{tr('Behöver ditt godkännande när det blir aktuellt', 'Needs your approval when the time comes')}: {plan.needsApproval.map(n => n.label).join(', ')}</p>}
    {plan.changes.length > 0 && <div className="mt-4"><div className="flex items-center gap-1 text-xs uppercase tracking-widest text-neutral-400"><GitBranch size={12} />{tr('Ändringar i planen', 'Changes to the plan')}</div>
      {plan.changes.map((c, i) => <p key={i} className="mt-1 text-sm text-neutral-300">{c.reason}</p>)}</div>}
    <Notes comments={plan.comments} />
    <CommentBox graphId={plan.id} nodeKey={null} onSaved={onSaved} />
  </Card>;
}

function Branch({ item, order, onPick, lit = '' }: { item: TreeItem; order: Map<string, number>; onPick: (key: string) => void; lit?: string }) {
  const { tr } = useUiLanguage();
  const n = item.node;
  const active = working(n.status);
  const box = item.repeat
    ? <button type="button" onClick={() => onPick(n.key)} className="w-44 rounded-lg border border-dashed border-white/30 bg-black px-3 py-2 text-center text-xs text-white/60 hover:border-white/70">
        {tr('Samma som steg', 'Same as step')} {order.get(n.key)}: {n.title}</button>
    : <button type="button" onClick={() => onPick(n.key)} data-working={active || undefined}
        className={`w-52 rounded-lg border bg-black px-3 py-2.5 text-left transition-colors hover:bg-white/[.06] ${active ? 'jaco-working border-sky-400' : 'border-white/75'}`}>
        <div className={`text-[10px] font-medium uppercase tracking-[.18em] ${active ? 'text-sky-300' : STATUS_TEXT[n.status] || 'text-white/60'}`}>{active ? tr('Aktivt delmål', 'Active subgoal') : `${tr('Steg', 'Step')} ${order.get(n.key)}`} · {n.statusText}</div>
        <div className="mt-1 text-[13px] font-medium leading-snug text-white">{n.title}</div>
        {(n.needs.length > 0 || n.comments.length > 0) && <div className="mt-1.5 text-[10px] text-white/50">{n.needs.slice(0, 3).map(x => x.label).join(' · ')}{n.comments.length ? `${n.needs.length ? ' · ' : ''}${n.comments.length} ${tr('anteckningar', 'notes')}` : ''}</div>}
      </button>;
  const lines = litLine(item.children);
  return <li className={lit || undefined}>{box}{item.children.length > 0 && <ul className={item.children.some(onPath) ? 'jaco-path-ul' : undefined}>{item.children.map((c, i) => <React.Fragment key={c.node.key}><Branch item={c} order={order} onPick={onPick} lit={lines[i]} /></React.Fragment>)}</ul>}</li>;
}

const short = (text: string, max = 70) => text.length > max ? text.slice(0, max - 1) + '…' : text;

export function StrategyBoard({ focusPlanId = null }: { focusPlanId?: string | null }) {
  const { tr, language } = useUiLanguage();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<string | null>(focusPlanId);
  // The open card: a step's key, 'goal' for the goal, or nothing.
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (focusPlanId) { setChosen(focusPlanId); setOpen(null); } }, [focusPlanId]);
  const load = useCallback(async () => {
    try { const r = await fetch(`/api/aura/plan?language=${encodeURIComponent(language)}`, { cache: 'no-store' }).then(readAuraResponse); if (r.success === false) throw new Error(r.error); setPlans(r.plans || []); setError(''); }
    catch (e: any) { setError(String(e?.message || e)); }
  }, [language]);
  useEffect(() => { void load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, [load]);
  const plan = pickPlan(plans || [], chosen);
  // The plan on screen stays on screen: the 10-second refresh must not swap it for another while the operator reads.
  useEffect(() => { if (!chosen && plan) setChosen(plan.id); }, [chosen, plan?.id]);
  const order = new Map((plan?.nodes || []).map((n, i) => [n.key, i + 1]));
  const tree = plan ? planTree(plan.nodes) : [];
  const treeLines = litLine(tree);
  const node = plan && open && open !== 'goal' ? plan.nodes.find(n => n.key === open) || null : null;
  const close = useCallback(() => setOpen(null), []);

  return <section data-testid="strategy-board" className="min-h-full space-y-3 bg-black p-4 text-neutral-100">
    <style>{BOARD_CSS}</style>
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-wide"><GoalMark size={30} />Gameboard</h2>
      <div className="flex items-center gap-2">
        {plans && plans.length > 1 && <select aria-label={tr('Välj plan', 'Choose plan')} value={plan?.id || ''} onChange={e => { setChosen(e.target.value); setOpen(null); }}
          className="max-w-[22rem] rounded border border-neutral-700 bg-black px-2 py-1 text-xs">
          {plans.map(p => <option key={p.id} value={p.id}>{short(p.objective)}</option>)}
        </select>}
        <button type="button" onClick={() => void load()} aria-label={tr('Uppdatera', 'Refresh')}><RefreshCw size={14} /></button>
      </div>
    </header>
    <p className="text-xs text-neutral-400">{tr('Målet står alltid först. Under det ser du vad som behövs för att nå det, och under varje delmål vad det i sin tur behöver. Det aktiva delmålet lyser svagt blått. Klicka på en ruta för hela beskrivningen.', 'The goal always comes first. Below it you see what is needed to reach it, and below each subgoal what that needs in turn. The active subgoal glows faint blue. Click a box for the full description.')}</p>
    {error && <p role="alert" className="text-sm text-amber-300">{tr('Planen kunde inte läsas just nu.', 'The plan could not be read right now.')} ({error})</p>}
    {plans && plans.length === 0 && <p className="text-sm text-neutral-300">{tr('Ingen plan än. Ge Aura ett större mål i chatten, så ritas planen här.', 'No plan yet. Give Aura a larger goal in the chat, and the plan is drawn here.')}</p>}
    {plan && <div className="jaco-tree overflow-x-auto pb-4 pt-2" data-testid="plan-tree">
      <ul><li>
        <button type="button" onClick={() => setOpen('goal')} className="jaco-goal w-80 max-w-full rounded-lg border border-yellow-300 bg-black px-4 py-3 text-center transition-colors hover:bg-white/[.06]">
          <div className="flex flex-col items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-[.2em] text-yellow-300"><GoalMark size={56} />{tr('Målet', 'The goal')}</div>
          <div className="mt-1 text-sm font-semibold leading-snug text-yellow-50">{plan.objective}</div>
          <div className="mt-1 text-[11px] text-white/50">{tr('Klart', 'Done')} {plan.progress.done}/{plan.progress.total}{plan.abilities?.missing.length ? ` · ${tr('Aura saknar något', 'Aura lacks something')}` : ''}</div>
        </button>
        {tree.length > 0 && <ul className={tree.some(onPath) ? 'jaco-path-ul' : undefined}>{tree.map((item, i) => <React.Fragment key={item.node.key}><Branch item={item} order={order} onPick={setOpen} lit={treeLines[i]} /></React.Fragment>)}</ul>}
      </li></ul>
    </div>}
    {plan && open === 'goal' && <GoalCard plan={plan} onClose={close} onSaved={load} />}
    {plan && node && <StepCard plan={plan} node={node} onPick={key => setOpen(key ?? 'goal')} onClose={close} onSaved={load} />}
  </section>;
}
