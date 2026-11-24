import React, { useEffect, useState } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { inlineApprovalPresentation } from '../lib/inlineApproval.mjs';

type Approval = {
  id: string;
  kind: string;
  source: string;
  title: string;
  reason: string;
  risk: string;
  actions: string[];
  details: Record<string, any>;
};

export function InlineAuraApproval({
  approval, count, busy, error, onDecision, onAll,
}: {
  approval: Approval;
  count: number;
  busy: boolean;
  error: string | null;
  onDecision: (decision: string, explicitlyAcknowledged: boolean) => void;
  onAll: () => void;
}) {
  const { tr } = useUiLanguage();
  const [reviewing, setReviewing] = useState<string | null>(null);
  const view = inlineApprovalPresentation(approval);
  useEffect(() => setReviewing(null), [approval.id]);
  const decide = (action: string, positive: boolean) => {
    if (busy || (positive && view.missingMission)) return;
    if (positive && view.requiresReview && reviewing !== action) {
      setReviewing(action);
      return;
    }
    setReviewing(null);
    // The deliberate click on a clearly labeled positive button replaces the
    // redundant checkbox. Server-side confirmation and original approval ID remain.
    onDecision(action, positive);
  };
  const actions = view.missingMission ? [] : [...view.positive, ...view.negative];
  const label = (action: string) => ({
    approve: tr('Ja, godkänn', 'Yes, approve'),
    confirm: tr('Ja, bekräfta', 'Yes, confirm'),
    resume: tr('Ja, fortsätt', 'Yes, continue'),
    reject: tr('Nej', 'No'),
    cancel: tr('Avbryt', 'Cancel'),
  } as Record<string, string>)[action] || action;

  return <section data-testid="aura-inline-approval" aria-label={tr('Fråga från Aura om godkännande', 'Approval question from Aura')}
    className="mb-4 rounded-xl border border-[#5c6270] bg-[#25282d] px-3 py-3 text-sm text-neutral-100">
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-400">
      <span className="font-semibold text-neutral-200">Aura</span>
      <span>· {tr('Behöver ditt beslut', 'Needs your decision')}</span>
      {view.risk && <span className="rounded border border-[#555b65] px-1.5 py-0.5">{view.risk}</span>}
    </div>
    <p className="mt-2 font-medium">
      {view.missingMission
        ? tr('Uppdraget finns inte längre i exekveraren. Det går inte att godkänna.', 'The executor cannot find this mission. It cannot be approved.')
        : view.positive[0] === 'resume' ? tr('Ska jag fortsätta uppdraget?', 'Shall I continue the mission?')
        : view.positive[0] === 'confirm' ? tr('Ska jag bekräfta resultatet?', 'Should I confirm the result?')
        : view.positive[0] === 'approve' ? tr('Får jag utföra den här åtgärden?', 'May I perform this action?')
        : tr('Ett beslut krävs innan jag fortsätter.', 'A decision is needed before I continue.')}
    </p>
    <p className="mt-1 break-words text-xs text-neutral-300">{view.summary}</p>
    {view.shortReason && view.shortReason !== view.summary && <p className="mt-1 break-words text-xs text-neutral-400">{view.shortReason}</p>}
    {reviewing && <div role="status" className="mt-2 rounded border border-amber-700/60 bg-black/20 p-2 text-xs">
      <strong>{tr('Bekräfta omfattning och risk', 'Confirm scope and risk')}</strong>
      <p className="mt-1 whitespace-pre-wrap break-words">{approval.title}</p>
      {approval.reason && <p className="mt-1 whitespace-pre-wrap break-words">{approval.reason}</p>}
      <p className="mt-1 text-amber-200">{tr('Ett ytterligare tryck godkänner just detta beslut, inte framtida åtgärder.', 'A second click approves this decision only, not future actions.')}</p>
    </div>}
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map(action => {
        const positive = view.positive.includes(action);
        return <button key={action} type="button" disabled={busy}
          onClick={() => decide(action, positive)}
          className={`min-h-9 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40 ${positive ? 'border-sky-500/60 bg-[#254765] text-white' : 'border-neutral-600 bg-[#303236] text-neutral-200'}`}>
          {busy ? tr('Sparar…', 'Saving…') : positive && view.requiresReview && reviewing !== action
            ? tr('Granska och godkänn', 'Review and approve') : label(action)}
        </button>;
      })}
      <details className="basis-full text-xs text-neutral-300">
        <summary className="w-fit cursor-pointer py-1 underline underline-offset-2">{tr('Detaljer', 'Details')}</summary>
        <div className="mt-1 max-h-44 overflow-auto rounded border border-neutral-700 bg-black/20 p-2">
          <p className="whitespace-pre-wrap break-words">{approval.title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{approval.reason}</p>
          <p className="mt-1 text-neutral-400">{approval.kind} · {approval.source} · {approval.risk}</p>
          <pre className="mt-2 whitespace-pre-wrap break-all text-[10px] text-neutral-400">{JSON.stringify(approval.details || {}, null, 2)}</pre>
        </div>
      </details>
      {count > 1 && <button type="button" onClick={onAll} className="text-xs text-neutral-300 underline">
        {tr(`Alla beslut (${count})`, `All decisions (${count})`)}
      </button>}
    </div>
    {!actions.length && !view.missingMission && <p className="mt-1 text-xs text-amber-200">{tr('Ingen åtgärd är tillgänglig. Läs detaljerna.', 'No action is available. Inspect the details.')}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-amber-300">{error}</p>}
  </section>;
}
