import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useRef, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Limits = { dailyCloudUsd: number | null; monthlyCloudUsd: number | null; maxCloudUsdPerTask: number | null; maxAutonomousCloudCallsPer15m: number | null };
type GeminiQuotaModel = { label?: string; category?: string; rpm: number | null; tpm: number | null; rpd: number | null; usedRpm: number; usedTpm: number; usedRpd: number; cooldownUntil?: number | null };
type GeminiQuotaSnapshot = { source: string; observedAt: string; projectAssociationVerified: boolean; providerUsageIncluded: boolean; localOnly: boolean; pacificDay: string; models: Record<string, GeminiQuotaModel> };
type Snapshot = { policy: Limits & { manualAuraCloudEnabled: boolean; novaOllamaCloudEnabled: boolean; cloudEnabled: boolean }; state: { dailySpentUsd: number; reservedUsd: number; reservations?: Record<string, { status?: string; estimatedUsd: number }> }; headroom: { dailyUsd: number | null; monthlyUsd: number | null }; geminiQuota?: GeminiQuotaSnapshot };
const fields = [ ['dailyCloudUsd', "USD per day"], ['monthlyCloudUsd', "USD per month"], ['maxCloudUsdPerTask', "USD per task"] ] as const;
const money = (n: number) => n.toLocaleString('sv-SE', { maximumFractionDigits: 6 });
// A cap the operator has not set is shown as such, never as a number.
const cap = (n: number | null, unit: string) => n == null ? `no limit ${unit}` : `${money(n)} USD${unit}`;
const draftOf = (n: number | null) => n == null ? '' : String(n);
const draftForPolicy = (policy: Limits) => ({ ...Object.fromEntries(fields.map(([key]) => [key, draftOf(policy[key])])), maxAutonomousCloudCallsPer15m: draftOf(policy.maxAutonomousCloudCallsPer15m) });

// inline: the Providers view shows the limits as fields you can change straight away (one Spara button).
export function EconomicBudgetPanel({ inline = false }: { inline?: boolean } = {}) {
  const { t: uiText } = useUiLanguage();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const revision = useRef(0);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const refresh = async () => {
    if (saveInFlight.current) return;
    const request = ++revision.current;
    try {
      const data = await fetch('/api/aura/budget', { signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current && request === revision.current) { setSnapshot(data.economic); setError(null); if (inline) setDirty(d => { if (!d) setDraft(draftForPolicy(data.economic.policy)); return d; }); }
    } catch (e: any) { if (mounted.current && request === revision.current) setError(e.message); }
  };
  useEffect(() => {
    mounted.current = true; void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    const changed = () => { void refresh(); };
    window.addEventListener('jaco:economic:refresh', changed);
    return () => { mounted.current = false; ++revision.current; window.clearInterval(timer); window.removeEventListener('jaco:economic:refresh', changed); };
  }, []);
  // One switch for cloud models (Aura chat and Nova), saved at once; the limits below still apply.
  const setCloud = async (enabled: boolean) => {
    if (saveInFlight.current) return;
    saveInFlight.current = true; ++revision.current; setSaving(true); setError(null);
    try {
      const data = await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cloudEnabled: enabled }), signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) setSnapshot(data.economic);
    } catch (e: any) { if (mounted.current) setError(uiText("Could not change: {0}", [e.message])); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const releaseHeld = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setError(null);
    try {
      const data = await fetch('/api/aura/budget/release-unknown', { method: 'POST', signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) setSnapshot(data.economic);
    } catch (e: any) { if (mounted.current) setError(uiText("Could not release: {0}", [e.message])); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    // An empty field turns that cap off; a value must be zero or more.
    const dollars = Object.fromEntries(fields.map(([key]) => [key, draft[key]?.trim() ? Number(draft[key]) : null]));
    if (Object.values(dollars).some(n => n !== null && (!Number.isFinite(n) || n < 0))) { setError(uiText("Enter zero or a positive amount, or leave the field empty for no limit.")); return; }
    const burstText = draft.maxAutonomousCloudCallsPer15m?.trim() || '';
    const burst = burstText ? Number(burstText) : null;
    if (burst != null && (!Number.isInteger(burst) || burst < 1 || burst > 10000)) { setError(uiText("The autonomous request limit must be a whole number from 1 to 10,000, or empty to disable it.")); return; }
    const patch = { ...dollars, maxAutonomousCloudCallsPer15m: burst };
    saveInFlight.current = true; ++revision.current; setSaving(true); setSaved(false); setError(null);
    try {
      const data = await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) { setSnapshot(data.economic); setEditing(false); setDirty(false); setSaved(true); }
    } catch (e: any) { if (mounted.current) setError(uiText("The budget change could not be confirmed: {0}. Refresh to read the saved settings.", [e.message])); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const shown = inline || editing;
  const held = snapshot ? (Object.values(snapshot.state.reservations || {}) as { status?: string; estimatedUsd: number }[]).filter(r => r.status === 'UNKNOWN_OUTCOME') : [];
  const heldUsd = held.reduce((n, r) => n + r.estimatedUsd, 0);
  // Never claim cloud is off/on from the legacy channel flags: the canonical
  // EconomicGovernor treats cloudEnabled as the master kill switch.
  const cloudOn = Boolean(snapshot?.policy.cloudEnabled);
  // The one sentence that says what stops a cloud answer right now (or that nothing does).
  const blocking = !snapshot ? null
    : !cloudOn ? uiText("Cloud models are off. Conversation and tasks use local models only.")
    : snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0 ? uiText("The daily budget is exhausted. Adjust the limit or review reserved amounts.")
    : snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0 ? uiText("The monthly budget is exhausted. Adjust the limit to continue.")
    : snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0 ? uiText("The per-task limit is zero: paid calls are blocked.")
    : null;
  return <div className={`${inline ? 'text-xs border border-[#333] bg-[#181818] p-3 space-y-2' : 'text-[10px] border border-[#343b45] p-2 space-y-1'} rounded`}>
    <div className="flex justify-between gap-2"><strong className="text-slate-300">{uiText("Shared cloud budget")}</strong><button type="button" disabled={saving} onClick={() => { setSaved(false); void refresh(); }} className="text-cyan-400">{uiText("Refresh budget")}</button></div>
    {inline && snapshot && <>
      <label className="flex items-start gap-2 text-slate-200 cursor-pointer">
        <input type="checkbox" checked={cloudOn} disabled={saving} onChange={e => void setCloud(e.target.checked)} className="mt-0.5 h-4 w-4" aria-label={uiText("Allow cloud models")} />
        <span><strong>{uiText("Allow cloud models")}</strong><br /><span className="text-slate-400">{uiText("Conversation and tasks can use cloud providers within your limits below. Turn off to use local models only.")}</span></span>
      </label>
      <p role="status" className={blocking ? 'text-amber-300' : 'text-emerald-400'}>{blocking || uiText("Cloud calls are currently permitted.")}</p>
      {held.length > 0 && <p className="text-slate-400">{held.length} {' '}{uiText("calls with unknown outcomes hold")}{' '}{money(heldUsd)} {' '}{uiText("USD reserved (released automatically after a while).")}{' '}<button type="button" disabled={saving} onClick={() => void releaseHeld()} className="text-cyan-400 underline">{uiText("Release now")}</button></p>}
    </>}
    {snapshot ? <>
      <p className="text-slate-300">{cap(snapshot.policy.dailyCloudUsd, '/dygn')} · {cap(snapshot.policy.monthlyCloudUsd, uiText("/month"))} · {cap(snapshot.policy.maxCloudUsdPerTask, '/uppgift')}</p>
      <p className="text-slate-300">{uiText("Autonomous request limit:")}{' '}{snapshot.policy.maxAutonomousCloudCallsPer15m == null ? uiText("disabled") : uiText("{0} paid requests per 15 minutes", [snapshot.policy.maxAutonomousCloudCallsPer15m])}{uiText(". Applies to autonomous tasks, separately from your manual Aura conversation.")}</p>
      <p className="text-slate-400">{uiText("Today’s token-based cost estimate:")}{' '}{money(snapshot.state.dailySpentUsd)} {' '}{uiText("USD · Reserved:")}{' '}{money(snapshot.state.reservedUsd)} {' '}{uiText("USD · Remaining today:")}{' '}{snapshot.headroom.dailyUsd == null ? uiText("no limit") : `${money(snapshot.headroom.dailyUsd)} USD`}</p>
      <p className="text-slate-500">{uiText("USD amounts use configured or reference prices and have not been reconciled with the provider’s invoice.")}</p>
      {snapshot.geminiQuota && <details className="border border-[#343b45] rounded p-2 space-y-2">
        <summary className="text-cyan-300 cursor-pointer">{uiText("Gemini · model limits entered from AI Studio (")}{Object.keys(snapshot.geminiQuota.models).length} {' '}{uiText("models)")}</summary>
        <p className="text-amber-200">{uiText("Imported")}{' '}{snapshot.geminiQuota.observedAt}{uiText(". These AI Studio limits were entered by the operator. They are not a live Google quota balance. Limits apply per Google project; usage here counts JACO calls only. Rate limits do not confirm pricing or free access.")}</p>
        <div className="max-h-60 overflow-auto space-y-2" role="table" aria-label={uiText("Gemini limits by model")}>
          {(Object.entries(snapshot.geminiQuota.models) as [string, GeminiQuotaModel][])
            .filter(([key, q]) => key === 'gemini-2.5-flash' || key === 'gemini-2.5-flash-lite' || key === 'gemini-2.5-pro' || q.usedRpm > 0 || q.usedRpd > 0)
            .slice(0, 15).map(([model, q]) => <div key={model} role="row" className="rounded border border-[#343b45] px-2 py-1">
              <strong className="text-slate-200" role="cell">{q.label || model}</strong>
              <p className="text-slate-400" role="cell">{uiText("RPM")}{' '}{q.usedRpm.toLocaleString('sv-SE')} / {q.rpm?.toLocaleString('sv-SE') ?? uiText("unlimited")} {' '}{uiText("· TPM")}{' '}{q.usedTpm.toLocaleString('sv-SE')} / {q.tpm?.toLocaleString('sv-SE') ?? uiText("unlimited")} {' '}{uiText("· RPD")}{' '}{q.usedRpd.toLocaleString('sv-SE')} / {q.rpd?.toLocaleString('sv-SE') ?? uiText("unlimited")}</p>
              {q.cooldownUntil && q.cooldownUntil > Date.now() && <p className="text-amber-300">{uiText("Google rate limit: paused until")}{' '}{new Date(q.cooldownUntil).toLocaleTimeString('sv-SE')}</p>}
            </div>)}
        </div>
        <p className="text-slate-500">{uiText("Daily requests reset at midnight Pacific Time. JACO keeps a 10% margin and a separate autonomous request limit. Other model limits are available in the quota API.")}</p>
      </details>}
      <p hidden={inline} className="text-slate-500">{uiText("Conversation cloud access:")}{' '}{snapshot.policy.cloudEnabled && snapshot.policy.manualAuraCloudEnabled ? uiText("allowed within budget") : uiText("disabled")} {' '}{uiText("· Task cloud access:")}{' '}{snapshot.policy.cloudEnabled && snapshot.policy.novaOllamaCloudEnabled ? uiText("allowed within budget") : uiText("disabled")}</p>
      <p hidden={inline} className="text-slate-400">{uiText("Set shared spending limits here. A separate autonomous request limit can stop excessive calls even without a USD limit.")}</p>
      {((snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0) || (snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0) || (snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0)) && <p role="status" className="text-amber-300">{uiText("Budget limits stop new paid calls. Reserved amounts count until their outcomes are known.")}</p>}
      {!inline && !editing && <button type="button" onClick={() => { setDraft(draftForPolicy(snapshot.policy)); setEditing(true); setSaved(false); }} className="text-cyan-400">{uiText("Edit budget")}</button>}
    </> : <p className="text-slate-500">{uiText("Budget not observed.")}</p>}
    {shown && (inline ? snapshot : true) && <form onSubmit={save} className="space-y-2">
      {fields.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-slate-300">{label}<input aria-label={label} type="number" min="0" step="any" placeholder={uiText("No limit")} value={draft[key] || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, [key]: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#111820] border border-[#343b45] rounded`} /></label>)}
      <label className="flex items-center justify-between gap-2 text-slate-300">{uiText("Autonomous cloud requests / 15 min")}<input aria-label={uiText("Autonomous cloud requests per 15 minutes")} type="number" min="1" max="10000" step="1" placeholder={uiText("Disabled")} value={draft.maxAutonomousCloudCallsPer15m || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, maxAutonomousCloudCallsPer15m: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#111820] border border-[#343b45] rounded`} /></label>
      <p className="text-slate-500">{uiText("USD limits are shared by conversation and tasks. An empty USD field means no spending limit. The autonomous request limit applies to tasks only; leave it empty to disable it. Settings persist after restart.")}</p>
      <div className="flex gap-3"><button type="submit" disabled={saving || (inline && !dirty)} className={inline ? 'bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-3 py-1.5 text-xs font-semibold text-white' : 'text-cyan-400'}>{saving ? uiText("Saving…") : uiText("Save budget")}</button>{!inline && <button type="button" disabled={saving} onClick={() => setEditing(false)} className="text-slate-400">{uiText("Cancel")}</button>}</div>
    </form>}
    {saved && <p role="status" className="text-emerald-400">{uiText("Budget saved and read back from JACO.")}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
