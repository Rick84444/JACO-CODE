import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ShieldAlert, MessageSquare, GitBranch, X } from 'lucide-react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { buildOperatorConfirmation, requiresOperatorConfirmation } from '../lib/operatorApproval.mjs';
import { useUiLanguage } from '../i18n/UiLanguage';
import { LocalMemoryPanel } from './LocalMemoryPanel';

// The Gameboard: one plan at a time, drawn like a family tree read backwards. The goal (what the operator wants) is
// always first, at the top. Below it hang the subgoals that lead to it, and below each subgoal what it needs first;
// that is how Aura is meant to think: from the goal back to what has to happen. The subgoal being worked on is marked
// as active and glows faint blue. Clicking any box opens a large card with the whole description, why it is there,
// what it builds on and leads to, what it needs, and the notes Aura and its helpers left; the operator can answer
// there, and Aura takes it into the next steps.
type Need = { kind: string; label: string; approval: boolean; state?: 'have' | 'missing' | 'approval' | null };
type Comment = { id: string; nodeKey: string | null; text: string; at: string; author?: 'aura' | 'operator' };
type Node = { key: string; title: string; objective: string; status: string; statusText: string; failure: string | null; dependencies: string[]; needs: Need[]; comments: Comment[]; missionId?: string | null };
// A decision waiting for the operator (the runtime's approval center), tied to a step through its mission.
export type Decision = { id: string; kind: string; title: string; risk: string; reason: string; actions: string[]; details?: Record<string, any> };
const decisionMission = (d: Decision): string | null => d.details?.missionId || d.details?.mission_id || (d.id.startsWith('mission:') ? d.id.slice(8) : null);
type Plan = { id: string; title: string; objective: string; status: string; progress: { done: number; total: number }; needsApproval: Need[]; nodes: Node[]; changes: Array<{ at: string | null; reason: string | null; replaced: string | null }>; comments: Comment[]; abilities?: { missing: string[]; text: string } | null };

// Aura's text never uses emoji: the state of a need is a word and a colour.
const STATE_WORD: Record<string, [string, string]> = { have: ['har', 'have'], missing: ['saknas', 'missing'], approval: ['ditt ja', 'your yes'] };
const chip = (state?: string | null, approval?: boolean) => state === 'have' ? 'bg-emerald-950 text-emerald-200' : state === 'missing' ? 'bg-rose-950 text-rose-200' : state === 'approval' || approval ? 'bg-amber-950 text-amber-200' : 'bg-neutral-800 text-neutral-300';
// Every box is white; the one being worked on is blue and blinks. Whether a step is done or failed is a word.
const STATUS_TEXT: Record<string, string> = { FAILED: 'text-rose-300', VERIFIED: 'text-white/60' };
const working = (status: string) => status === 'RUNNING' || status === 'DISPATCHED';

// Lines are quiet white. The line from the active box up to the goal glows faint white: the way the work is heading.
const LINE = 'rgba(255,255,255,.28)';
const PATH = 'rgba(88,180,240,.88)';
const PATH_GLOW = 'drop-shadow(0 0 3px rgba(65,172,240,.6))';
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
@keyframes jaco-live-path{0%,100%{opacity:.50}50%{opacity:.95}}
.jaco-tree li.jp-l::before,.jaco-tree li.jp-r::after,.jaco-tree li.jp-v::after,.jaco-tree ul.jaco-path-ul::before{animation:jaco-live-path 2.5s ease-in-out infinite}
@media(prefers-reduced-motion:reduce){.jaco-tree li.jp-l::before,.jaco-tree li.jp-r::after,.jaco-tree li.jp-v::after,.jaco-tree ul.jaco-path-ul::before{animation:none;opacity:.85}}
.jaco-tree > ul{padding-top:0;width:max-content;min-width:100%}`;

// True when the work is somewhere in this branch: its line up to the goal glows.
const onPath = (item: TreeItem): boolean => !item.repeat && (working(item.node.status) || item.children.some(onPath));
// Which line pieces above child i glow: its own drop (v), and the bar from it to the middle where the parent's line
// comes down (l = left half, r = right half of each box's share of the bar).
export function litLine(items: TreeItem[]): string[] {
  const active = items.flatMap((item, index) => onPath(item) ? [index] : []);
  const c = (items.length - 1) / 2;
  // The union of paths is required when Aura works on several independent subgoals.
  // Each path connects its active branch to the middle of the parent bar.
  return items.map((_, i) => !active.length ? '' : [
    active.includes(i) ? 'jp-v' : '',
    active.some(p => i - 0.5 >= Math.min(p, c) && i <= Math.max(p, c)) ? 'jp-l' : '',
    active.some(p => i >= Math.min(p, c) && i + 0.5 <= Math.max(p, c)) ? 'jp-r' : '',
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
    {c.author === 'aura' ? <img src="/branding/aura-memory.png" alt="" aria-hidden="true" width={20} height={20} className="mt-0.5 h-5 w-5 shrink-0 rounded-full" title={tr('Sparat i minnet', 'Saved to memory')} /> : <MessageSquare size={14} className="mt-0.5 text-neutral-300" />}
    <span><strong className="font-medium">{c.author === 'aura' ? 'Aura' : tr('Du', 'You')}:</strong> {c.text}</span>
  </div>)}</div>;
}

const ACTION_WORD: Record<string, [string, string]> = {
  approve: ['Godkänn', 'Approve'], reject: ['Avslå', 'Reject'], confirm: ['Bekräfta resultatet', 'Confirm the result'],
  resume: ['Fortsätt', 'Continue'], cancel: ['Avsluta uppdraget', 'End the mission'],
};

export function decisionGuidance(decision: Decision, language: 'sv' | 'en' = 'en') {
  const positive = decision.actions.find(requiresOperatorConfirmation) || 'approve';
  const sv = language === 'sv';
  const effect = decision.kind === 'MISSION'
    ? positive === 'confirm'
      ? (sv ? 'markerar uppdragets verifierade resultat som godkänt' : 'mark the mission’s verified result as approved')
      : (sv ? 'fortsätter uppdraget en gång från det senast sparade läget' : 'continue the mission once from its latest saved state')
    : decision.kind === 'MCP_SOURCE'
      ? (sv ? 'aktiverar den här avgränsade verktygskällan' : 'activate this bounded tool source')
      : decision.kind === 'MANDATE'
        ? (sv ? 'aktiverar detta mandat inom den omfattning som visas' : 'activate this mandate within the scope shown')
        : decision.kind === 'JOB'
          ? (sv ? 'startar detta avgränsade arbete' : 'start this bounded work')
          : (sv ? 'utför den här avgränsade åtgärden en gång' : 'perform this bounded action once');
  const safer = decision.kind === 'MISSION'
    ? (sv ? 'Öppna evidensen först eller avsluta uppdraget utan att fortsätta.' : 'Review the evidence first, or end the mission without continuing it.')
    : decision.kind === 'MCP_SOURCE'
      ? (sv ? 'Låt verktyget vara avstängt och granska källan innan den aktiveras.' : 'Keep the tool disabled and inspect its source before activating it.')
      : decision.kind === 'MANDATE'
        ? (sv ? 'Begränsa mandatets tid eller omfattning innan det aktiveras.' : 'Narrow the mandate’s duration or scope before activating it.')
        : (sv ? 'Be Aura begränsa åtgärden eller börja med en skrivskyddad kontroll.' : 'Ask Aura to narrow the action or begin with a read-only check.');
  return {
    what: sv ? `Aura vill ${effect}: ${decision.title}.` : `Aura wants to ${effect}: ${decision.title}.`,
    why: decision.reason,
    safer,
    acknowledgement: sv ? `Jag förstår detta och godkänner att Aura ${effect}.` : `I understand this and approve Aura to ${effect}.`,
  };
}

// One decision with its buttons. The operator's click goes to the same approval center as the rest of JACO.
function DecisionRow({ decision, onDone, compact = false }: { decision: Decision; onDone: () => void; compact?: boolean }) {
  const { tr, language } = useUiLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const guidance = decisionGuidance(decision, language);
  const decide = async (action: string) => {
    if (requiresOperatorConfirmation(action) && !acknowledged) {
      setError(tr('Bocka i bekräftelsen först.', 'Check the confirmation box first.'));
      return;
    }
    setBusy(action); setError('');
    try {
      const r = await fetch(`/api/aura/workbench/approvals/${encodeURIComponent(decision.id)}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        decision: action,
        note: `Operator decision from the Gameboard: ${action}`,
        confirmation: buildOperatorConfirmation(decision.id, action, acknowledged, guidance.acknowledgement),
      }) }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      onDone();
    } catch (e: any) { setError(String(e?.message || e)); }
    finally { setBusy(null); }
  };
  const hasPositive = decision.actions.some(requiresOperatorConfirmation);
  return <div className="rounded-lg border border-amber-300/70 bg-amber-950/20 p-3 text-sm">
    {!compact && <div className="font-medium text-amber-100">{decision.title.split('\n')[0].slice(0, 160)}</div>}
    <div className="mt-2 space-y-2 text-[15px] leading-relaxed text-amber-50/90">
      <p><strong>{tr('Vad Aura vill göra:', 'What Aura wants to do:')}</strong> {guidance.what}</p>
      <p><strong>{tr('Varför Aura frågar:', 'Why Aura is asking:')}</strong> {guidance.why}</p>
      <p><strong>{tr('Säkrare väg:', 'Safer option:')}</strong> {guidance.safer}</p>
    </div>
    {hasPositive && <label className="mt-3 flex cursor-pointer items-start gap-2 rounded border border-amber-200/30 bg-black/30 p-2.5 text-sm leading-relaxed text-amber-50">
      <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} className="mt-1 h-4 w-4 accent-amber-300" />
      <span>{guidance.acknowledgement}</span>
    </label>}
    <div className="mt-2 flex flex-wrap gap-1.5">{decision.actions.map(a => <button key={a} type="button" disabled={busy !== null || (requiresOperatorConfirmation(a) && !acknowledged)} onClick={() => void decide(a)}
      aria-disabled={requiresOperatorConfirmation(a) && !acknowledged || undefined}
      className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${requiresOperatorConfirmation(a) && !acknowledged ? 'cursor-not-allowed opacity-40' : ''} ${a === 'cancel' || a === 'reject' ? 'border border-white/40 text-white' : 'bg-amber-300 text-black hover:bg-amber-200'}`}>{busy === a ? '…' : tr(...(ACTION_WORD[a] || [a, a]))}</button>)}</div>
    {error && <p role="alert" className="mt-1 text-xs text-rose-300">{error}</p>}
  </div>;
}

// A need that only the operator can allow: one click records the yes on the step, where Aura and her helpers read
// it as the operator's direction. Money is never allowed in advance: the payment itself still asks.
function AllowNeed({ graphId, node, need, onSaved }: { graphId: string; node: Node; need: Need; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const allowed = node.comments.some(c => c.author !== 'aura' && c.text.includes(need.label) && /^(Ja|Yes):/.test(c.text));
  if (allowed || state === 'saved') return <span className="rounded bg-emerald-950 px-2 py-0.5 text-xs text-emerald-200">{need.label}: {tr('ditt ja finns', 'you said yes')}</span>;
  const text = need.kind === 'payment'
    ? tr(`Ja: ${need.label} får förberedas i det här steget. Fråga mig vid själva betalningen.`, `Yes: ${need.label} may be prepared in this step. Ask me at the payment itself.`)
    : tr(`Ja: ${need.label} i det här steget. Säg till vad du gjorde.`, `Yes: ${need.label} in this step. Tell me what you did.`);
  const save = async () => {
    setState('saving');
    try {
      const r = await fetch('/api/aura/plan/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ graphId, nodeKey: node.key, text }) }).then(readAuraResponse);
      if (r.success === false) throw new Error(r.error);
      setState('saved'); onSaved();
    } catch { setState('idle'); }
  };
  return <button type="button" disabled={state === 'saving'} onClick={() => void save()} title={text}
    className="rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-black hover:bg-amber-200 disabled:opacity-50">{tr('Ja, det får du', 'Yes, you may')}: {need.label}</button>;
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

function StepCard({ plan, node, decisions, onPick, onClose, onSaved }: { plan: Plan; node: Node; decisions: Decision[]; onPick: (key: string | null) => void; onClose: () => void; onSaved: () => void }) {
  const { tr } = useUiLanguage();
  const waiting = decisions.filter(d => node.missionId && decisionMission(d) === node.missionId);
  const askYes = node.needs.filter(x => x.approval || x.state === 'approval');
  const after = plan.nodes.filter(n => LIVE(n) && n.dependencies.includes(node.key));
  const before = plan.nodes.filter(n => LIVE(n) && node.dependencies.includes(n.key));
  const link = (n: Node) => <button key={n.key} type="button" onClick={() => onPick(n.key)} className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:border-sky-400">{n.title}</button>;
  return <Card label={node.title} onClose={onClose}>
    <div className="text-xs uppercase tracking-widest text-neutral-400">{working(node.status) ? tr('Aktivt delmål', 'Active subgoal') : tr('Delmål', 'Subgoal')} · {node.statusText}</div>
    <h3 className="mt-1 pr-6 text-xl font-semibold leading-snug">{node.title}</h3>
    {waiting.length > 0 && <div className="mt-3 space-y-2"><div className="text-xs uppercase tracking-widest text-amber-300">{tr('Väntar på ditt beslut', 'Waiting for your decision')}</div>
      {waiting.map(d => <React.Fragment key={d.id}><DecisionRow decision={d} compact onDone={onSaved} /></React.Fragment>)}</div>}
    {askYes.length > 0 && <div className="mt-3"><div className="text-xs uppercase tracking-widest text-amber-300">{tr('Behöver ditt ja', 'Needs your yes')}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">{askYes.map(x => <React.Fragment key={x.kind + x.label}><AllowNeed graphId={plan.id} node={node} need={x} onSaved={onSaved} /></React.Fragment>)}</div></div>}
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

function Branch({ item, order, onPick, lit = '', waitingOn }: { item: TreeItem; order: Map<string, number>; onPick: (key: string) => void; lit?: string; waitingOn: Set<string> }) {
  const { tr } = useUiLanguage();
  const n = item.node;
  const waits = Boolean(n.missionId && waitingOn.has(n.missionId));
  const active = working(n.status);
  const box = item.repeat
    ? <button type="button" onClick={() => onPick(n.key)} className="w-44 rounded-lg border border-dashed border-white/30 bg-black px-3 py-2 text-center text-xs text-white/60 hover:border-white/70">
        {tr('Samma som steg', 'Same as step')} {order.get(n.key)}: {n.title}</button>
    : <button type="button" onClick={() => onPick(n.key)} data-working={active || undefined}
        className={`w-52 rounded-lg border bg-black px-3 py-2.5 text-left transition-colors hover:bg-white/[.06] ${active ? 'jaco-working border-sky-400' : 'border-white/75'}`}>
        <div className={`text-[10px] font-medium uppercase tracking-[.18em] ${active ? 'text-sky-300' : STATUS_TEXT[n.status] || 'text-white/60'}`}>{active ? tr('Aktivt delmål', 'Active subgoal') : `${tr('Steg', 'Step')} ${order.get(n.key)}`} · {n.statusText}</div>
        <div className="mt-1 text-[13px] font-medium leading-snug text-white">{n.title}</div>
        {waits && <div className="mt-1.5 inline-block rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-semibold text-black">{tr('Väntar på ditt ja', 'Waiting for your yes')}</div>}
        {(n.needs.length > 0 || n.comments.length > 0) && <div className="mt-1.5 text-[10px] text-white/50">{n.needs.slice(0, 3).map(x => x.label).join(' · ')}{n.comments.length ? `${n.needs.length ? ' · ' : ''}${n.comments.length} ${tr('anteckningar', 'notes')}` : ''}</div>}
      </button>;
  const lines = litLine(item.children);
  return <li className={lit || undefined}>{box}{item.children.length > 0 && <ul className={item.children.some(onPath) ? 'jaco-path-ul' : undefined}>{item.children.map((c, i) => <React.Fragment key={c.node.key}><Branch item={c} order={order} onPick={onPick} lit={lines[i]} waitingOn={waitingOn} /></React.Fragment>)}</ul>}</li>;
}

const short = (text: string, max = 70) => text.length > max ? text.slice(0, max - 1) + '…' : text;

export function StrategyBoard({ focusPlanId = null, focusNodeKey = null, onClose }: { focusPlanId?: string | null; focusNodeKey?: string | null; onClose?: () => void }) {
  const { tr, language } = useUiLanguage();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [observed, setObserved] = useState<{operatorGoal?:{statement:string}|null;missions?:Array<{identity:string;goal:string;status:string;verifiedActions:number}>;next?:{text:string}}|null>(null);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [chosen, setChosen] = useState<string | null>(focusPlanId);
  // The open card: a step's key, 'goal' for the goal, or nothing.
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (focusPlanId) setChosen(focusPlanId); setOpen(focusNodeKey); }, [focusPlanId, focusNodeKey]);
  const load = useCallback(async () => {
    // Planning may be late or unavailable while the operator's goal and durable
    // missions are already recorded. Read both sources independently.
    const [planned, position, approvals] = await Promise.allSettled([
      fetch(`/api/aura/plan?language=${encodeURIComponent(language)}`, {cache:'no-store'}).then(readAuraResponse),
      fetch('/api/aura/workbench/gameboard', {cache:'no-store'}).then(readAuraResponse),
      fetch('/api/aura/workbench/approvals', {cache:'no-store'}).then(readAuraResponse),
    ]);
    if (planned.status === 'fulfilled' && planned.value?.success !== false) { setPlans(planned.value.plans || []); setError(''); }
    else { setPlans([]); setError(planned.status === 'rejected' ? String(planned.reason?.message || planned.reason) : String(planned.value?.error || 'PLAN_UNAVAILABLE')); }
    if (position.status === 'fulfilled' && position.value?.schema === 'jaco.gameboard-fabric/v1') setObserved(position.value);
    else setObserved(null);
    setDecisions(approvals.status === 'fulfilled' && Array.isArray(approvals.value?.items) ? approvals.value.items : []);
  }, [language]);
  useEffect(() => { void load(); const t = window.setInterval(load, 10000); return () => window.clearInterval(t); }, [load]);
  const plan = pickPlan(plans || [], chosen);
  // The plan on screen stays on screen: the 10-second refresh must not swap it for another while the operator reads.
  useEffect(() => { if (!chosen && plan) setChosen(plan.id); }, [chosen, plan?.id]);
  const order = new Map((plan?.nodes || []).map((n, i) => [n.key, i + 1]));
  const tree = plan ? planTree(plan.nodes) : [];
  const planMissions = new Set((plan?.nodes || []).map(n => n.missionId).filter((m): m is string => Boolean(m)));
  const planDecisions = decisions.filter(d => planMissions.has(decisionMission(d) || ''));
  const waitingOn = new Set<string>(planDecisions.map(d => String(decisionMission(d) || '')));
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
        {onClose && <button type="button" onClick={onClose} title={tr('Tillbaka till Aura', 'Back to Aura')} aria-label={tr('Tillbaka till Aura', 'Back to Aura')} className="flex items-center gap-2 rounded-full border border-white/30 py-0.5 pl-0.5 pr-3 text-xs text-white/80 hover:border-sky-400"><img src="/branding/aura-avatar.png" alt="" width={30} height={30} style={{ width: 30, height: 30 }} className="rounded-full" />{tr('Tillbaka till Aura', 'Back to Aura')}</button>}
      </div>
    </header>
    <p className="text-xs text-neutral-400">{tr('Målet står alltid först. Under det ser du vad som behövs för att nå det, och under varje delmål vad det i sin tur behöver. Det aktiva delmålet lyser svagt blått. Klicka på en ruta för hela beskrivningen.', 'The goal always comes first. Below it you see what is needed to reach it, and below each subgoal what that needs in turn. The active subgoal glows faint blue. Click a box for the full description.')}</p>
    <LocalMemoryPanel missionIds={Array.from(planMissions)} />
    {planDecisions.length > 0 && <section aria-label={tr('Väntar på dig', 'Waiting for you')} className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-widest text-amber-300">{tr('Väntar på dig', 'Waiting for you')} ({planDecisions.length})</div>
      {planDecisions.map(d => <React.Fragment key={d.id}><DecisionRow decision={d} onDone={() => void load()} /></React.Fragment>)}
    </section>}
    {error && <p role="alert" className="text-sm text-amber-300">{tr('Planen kunde inte läsas just nu.', 'The plan could not be read right now.')} ({error})</p>}
    {plans && plans.length === 0 && (observed?.operatorGoal || observed?.missions?.length ? <article data-testid="strategy-goal-pending" className="space-y-3 rounded-lg border border-yellow-700 bg-[#181715] p-4">
      <div className="flex items-center gap-3"><GoalMark size={46}/><div>
        <div className="text-xs uppercase tracking-widest text-yellow-300">{tr('Registrerat mål', 'Recorded goal')}</div>
        <div className="text-sm font-semibold text-white">{observed?.operatorGoal?.statement || observed?.missions?.[0]?.goal}</div>
      </div></div>
      <p className="text-xs text-amber-200">{tr('Målet finns, men Aura har ännu inte rapporterat en SEER-plan med verifierbara delsteg. Inga steg hittas på.', 'The goal exists, but Aura has not yet reported a SEER plan with verifiable steps. No steps are fabricated.')}</p>
      {observed?.missions?.slice(0,4).map(m=><div key={m.identity} className="rounded border border-neutral-700 p-2 text-xs">
        <div className="text-neutral-100">{m.goal}</div><div className="text-neutral-400">{m.status} · {m.verifiedActions} {tr('verifierade verktygssteg', 'verified tool actions')}</div>
      </div>)}
      {observed?.next?.text&&<p className="text-xs text-neutral-300">{observed.next.text}</p>}
    </article>:<p className="text-sm text-neutral-300">{tr('Inget aktivt mål eller plan observerat. Ge Aura ett mål i chatten.', 'No active goal or plan observed. Give Aura a goal in the chat.')}</p>)}
    {plan && <div className="jaco-tree overflow-x-auto pb-4 pt-2" data-testid="plan-tree">
      <ul><li>
        <button type="button" onClick={() => setOpen('goal')} className="jaco-goal w-80 max-w-full rounded-lg border border-yellow-300 bg-black px-4 py-3 text-center transition-colors hover:bg-white/[.06]">
          <div className="flex flex-col items-center justify-center gap-1.5 text-[10px] font-medium uppercase tracking-[.2em] text-yellow-300"><GoalMark size={56} />{tr('Målet', 'The goal')}</div>
          <div className="mt-1 text-sm font-semibold leading-snug text-yellow-50">{plan.objective}</div>
          <div className="mt-1 text-[11px] text-white/50">{tr('Klart', 'Done')} {plan.progress.done}/{plan.progress.total}{plan.abilities?.missing.length ? ` · ${tr('Aura saknar något', 'Aura lacks something')}` : ''}</div>
        </button>
        {tree.length > 0 && <ul className={tree.some(onPath) ? 'jaco-path-ul' : undefined}>{tree.map((item, i) => <React.Fragment key={item.node.key}><Branch item={item} order={order} onPick={setOpen} lit={treeLines[i]} waitingOn={waitingOn} /></React.Fragment>)}</ul>}
      </li></ul>
    </div>}
    {plan && open === 'goal' && <GoalCard plan={plan} onClose={close} onSaved={load} />}
    {plan && node && <StepCard plan={plan} node={node} decisions={decisions} onPick={key => setOpen(key ?? 'goal')} onClose={close} onSaved={load} />}
  </section>;
}
