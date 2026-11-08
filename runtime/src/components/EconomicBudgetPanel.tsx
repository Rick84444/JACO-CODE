import React, { useEffect, useRef, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';

type Limits = { dailyCloudUsd: number | null; monthlyCloudUsd: number | null; maxCloudUsdPerTask: number | null; maxAutonomousCloudCallsPer15m: number | null };
type GeminiQuotaModel = { label?: string; category?: string; rpm: number | null; tpm: number | null; rpd: number | null; usedRpm: number; usedTpm: number; usedRpd: number; cooldownUntil?: number | null };
type GeminiQuotaSnapshot = { source: string; observedAt: string; projectAssociationVerified: boolean; providerUsageIncluded: boolean; localOnly: boolean; pacificDay: string; models: Record<string, GeminiQuotaModel> };
type Snapshot = { policy: Limits & { manualAuraCloudEnabled: boolean; novaOllamaCloudEnabled: boolean; cloudEnabled: boolean }; state: { dailySpentUsd: number; reservedUsd: number; reservations?: Record<string, { status?: string; estimatedUsd: number }> }; headroom: { dailyUsd: number | null; monthlyUsd: number | null }; geminiQuota?: GeminiQuotaSnapshot };
const fields = [ ['dailyCloudUsd', 'USD per day'], ['monthlyCloudUsd', 'USD per month'], ['maxCloudUsdPerTask', 'USD per task'] ] as const;
const money = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
// A cap the operator has not set is shown as such, never as a number.
const cap = (n: number | null, unit: string) => n == null ? `no cap ${unit}` : `${money(n)} USD${unit}`;
const draftOf = (n: number | null) => n == null ? '' : String(n);
const draftForPolicy = (policy: Limits) => ({ ...Object.fromEntries(fields.map(([key]) => [key, draftOf(policy[key])])), maxAutonomousCloudCallsPer15m: draftOf(policy.maxAutonomousCloudCallsPer15m) });

// inline: the Providers view shows the limits as fields you can change straight away (one Save button).
export function EconomicBudgetPanel({ inline = false }: { inline?: boolean } = {}) {
  const { tr, language } = useOptionalUiLanguage();
  const loc = language === 'sv' ? 'sv-SE' : 'en-US';
  const fieldLabel = (label: string) => (({ 'USD per day': tr('USD per dag', 'USD per day'), 'USD per month': tr('USD per månad', 'USD per month'), 'USD per task': tr('USD per uppdrag', 'USD per task') }) as Record<string, string>)[label] || label;
  const capT = (n: number | null, unit: string) => n == null ? tr(`ingen gräns ${unit}`, `no cap ${unit}`) : `${money(n)} USD${unit}`;
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
    } catch (e: any) { if (mounted.current) setError(`${tr('Kunde inte ändra', 'Could not change')}: ${e.message}`); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const releaseHeld = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setError(null);
    try {
      const data = await fetch('/api/aura/budget/release-unknown', { method: 'POST', signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) setSnapshot(data.economic);
    } catch (e: any) { if (mounted.current) setError(`${tr('Kunde inte frigöra', 'Could not release')}: ${e.message}`); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    // An empty field turns that cap off; a value must be zero or more.
    const dollars = Object.fromEntries(fields.map(([key]) => [key, draft[key]?.trim() ? Number(draft[key]) : null]));
    if (Object.values(dollars).some(n => n !== null && (!Number.isFinite(n) || n < 0))) { setError(tr('Skriv ett belopp på noll eller mer, eller lämna fältet tomt för ingen gräns.', 'Enter an amount of zero or more, or leave the field empty for no cap.')); return; }
    const burstText = draft.maxAutonomousCloudCallsPer15m?.trim() || '';
    const burst = burstText ? Number(burstText) : null;
    if (burst != null && (!Number.isInteger(burst) || burst < 1 || burst > 10000)) { setError(tr('Gränsen för självständiga anrop måste vara ett heltal från 1 till 10 000, eller tom för att stänga av den.', 'The autonomous rate limit must be a whole number from 1 to 10,000, or empty to turn it off.')); return; }
    const patch = { ...dollars, maxAutonomousCloudCallsPer15m: burst };
    saveInFlight.current = true; ++revision.current; setSaving(true); setSaved(false); setError(null);
    try {
      const data = await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) { setSnapshot(data.economic); setEditing(false); setDirty(false); setSaved(true); }
    } catch (e: any) { if (mounted.current) setError(tr(`Budgetändringen kunde inte bekräftas: ${e.message}. Uppdatera för att läsa den sparade inställningen.`, `The budget change could not be confirmed: ${e.message}. Refresh to read the saved policy.`)); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const shown = inline || editing;
  const held = snapshot ? (Object.values(snapshot.state.reservations || {}) as { status?: string; estimatedUsd: number }[]).filter(r => r.status === 'UNKNOWN_OUTCOME') : [];
  const heldUsd = held.reduce((n, r) => n + r.estimatedUsd, 0);
  // Never claim cloud is off/on from the legacy channel flags: the canonical
  // EconomicGovernor treats cloudEnabled as the master kill switch, and a saved channel flag can still deny chat.
  // Show what chat actually gets, so the switch never reads as on while every answer is denied.
  const cloudOn = Boolean(snapshot?.policy.cloudEnabled && snapshot?.policy.manualAuraCloudEnabled);
  // The one sentence that says what stops a cloud answer right now (or that nothing does).
  const blocking = !snapshot ? null
    : !cloudOn ? tr('Molnmodeller är avstängda: chatten och Aura använder bara lokala modeller.', 'Cloud models are off: chat and Nova use local models only.')
    : snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0 ? tr('Dagens budget är slut. Höj gränsen eller frigör reserverade belopp.', 'Today\'s budget is spent. Raise the cap or release reserved spend.')
    : snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0 ? tr('Månadens budget är slut. Höj gränsen.', 'This month\'s budget is spent. Raise the cap.')
    : snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0 ? tr('Gränsen per uppdrag är noll: inga betalda anrop går igenom.', 'The per-task cap is zero: no paid calls go through.')
    : null;
  return <div className={`${inline ? 'text-xs border border-[#505153] bg-[#292a2c] p-3 space-y-2' : 'text-[10px] border border-[#5a5b5d] p-2 space-y-1'} rounded`}>
    <div className="flex justify-between gap-2"><strong className="text-neutral-200">{tr('Gemensam molnbudget', 'Shared cloud budget')}</strong><button type="button" disabled={saving} onClick={() => { setSaved(false); void refresh(); }} className="text-neutral-200">{tr('Uppdatera budget', 'Refresh budget')}</button></div>
    {inline && snapshot && <>
      <label className="flex items-start gap-2 text-neutral-200 cursor-pointer">
        <input type="checkbox" checked={cloudOn} disabled={saving} onChange={e => void setCloud(e.target.checked)} className="mt-0.5 h-4 w-4" aria-label={tr('Tillåt molnmodeller', 'Allow cloud models')} />
        <span><strong>{tr('Tillåt molnmodeller', 'Allow cloud models')}</strong><br /><span className="text-neutral-300">{tr('Chatten och Aura får använda DeepSeek, Groq och andra, inom de gränser du sätter nedan. Av = bara lokala modeller.', 'Chat and Nova may use DeepSeek, Groq and others, within the caps you set below. Off = local models only.')}</span></span>
      </label>
      <p role="status" className={blocking ? 'text-amber-300' : 'text-emerald-400'}>{blocking || tr('Inget hindrar molnanrop just nu.', 'Nothing is blocking cloud calls right now.')}</p>
      {held.length > 0 && <p className="text-neutral-300">{held.length} {tr('anrop med okänt utfall håller', 'calls with unknown outcome hold')} {money(heldUsd)} USD {tr('reserverade (frigörs automatiskt efter en stund).', 'reserved (released automatically after a while).')} <button type="button" disabled={saving} onClick={() => void releaseHeld()} className="text-neutral-200 underline">{tr('Frigör nu', 'Release now')}</button></p>}
    </>}
    {snapshot ? <>
      <p className="text-neutral-200">{capT(snapshot.policy.dailyCloudUsd, tr('/dag', '/day'))} · {capT(snapshot.policy.monthlyCloudUsd, tr('/månad', '/month'))} · {capT(snapshot.policy.maxCloudUsdPerTask, tr('/uppdrag', '/task'))}</p>
      <p className="text-neutral-200">{tr('Gräns för självständiga anrop', 'Autonomous rate limit')}: {snapshot.policy.maxAutonomousCloudCallsPer15m == null ? tr('av', 'off') : tr(`${snapshot.policy.maxAutonomousCloudCallsPer15m} betalda anrop per 15 minuter`, `${snapshot.policy.maxAutonomousCloudCallsPer15m} paid calls per 15 minutes`)}. {tr('Gäller Auras självständiga arbete, inte din vanliga chatt.', 'Governs Nova and SEER, not your manual Aura chat.')}</p>
      <p className="text-neutral-300">{tr('Beräknad kostnad idag', 'Token-based spend estimate today')}: {money(snapshot.state.dailySpentUsd)} USD · {tr('Reserverat', 'Reserved')}: {money(snapshot.state.reservedUsd)} USD · {tr('Kvar idag', 'Headroom today')}: {snapshot.headroom.dailyUsd == null ? tr('ingen gräns', 'no cap') : `${money(snapshot.headroom.dailyUsd)} USD`}</p>
      <p className="text-neutral-400">{tr('USD-beloppen beräknas från JACO:s inställda priser eller referenspriser och är inte avstämda mot leverantörens faktura.', 'USD amounts are calculated from JACO\'s configured prices or reference prices and are not reconciled against the provider\'s invoice.')}</p>
      {snapshot.geminiQuota && <details className="border border-[#5a5b5d] rounded p-2 space-y-2">
        <summary className="text-neutral-200 cursor-pointer">Gemini · actual model limits from AI Studio ({Object.keys(snapshot.geminiQuota.models).length} models)</summary>
        <p className="text-amber-200">Imported {snapshot.geminiQuota.observedAt}. This is an operator-reported AI Studio snapshot, NOT a live Google quota balance. Limits apply per Google project; only calls from this JACO runtime are counted here. Rate limits are not pricing or proof of a free tier.</p>
        <div className="max-h-60 overflow-auto space-y-2" role="table" aria-label="Gemini quotas per model">
          {(Object.entries(snapshot.geminiQuota.models) as [string, GeminiQuotaModel][])
            .filter(([key, q]) => key === 'gemini-2.5-flash' || key === 'gemini-2.5-flash-lite' || key === 'gemini-2.5-pro' || q.usedRpm > 0 || q.usedRpd > 0)
            .slice(0, 15).map(([model, q]) => <div key={model} role="row" className="rounded border border-[#5a5b5d] px-2 py-1">
              <strong className="text-neutral-200" role="cell">{q.label || model}</strong>
              <p className="text-neutral-300" role="cell">RPM {q.usedRpm.toLocaleString('en-US')} / {q.rpm?.toLocaleString('en-US') ?? 'unlimited'} · TPM {q.usedTpm.toLocaleString('en-US')} / {q.tpm?.toLocaleString('en-US') ?? 'unlimited'} · RPD {q.usedRpd.toLocaleString('en-US')} / {q.rpd?.toLocaleString('en-US') ?? 'unlimited'}</p>
              {q.cooldownUntil && q.cooldownUntil > Date.now() && <p className="text-amber-300">Google 429: rate limited until {new Date(q.cooldownUntil).toLocaleTimeString('en-US')}</p>}
            </div>)}
        </div>
        <p className="text-neutral-400">RPD resets at midnight Pacific time. JACO keeps a 10% safety margin and keeps the autonomous call limit separate. Other models are available via /api/aura/budget/gemini-quotas.</p>
      </details>}
      <p hidden={inline} className="text-neutral-400">{tr('Aura i molnet', 'Aura cloud')}: {snapshot.policy.cloudEnabled && snapshot.policy.manualAuraCloudEnabled ? tr('tillåtet inom budget', 'allowed within budget') : tr('av', 'off')} · {tr('Auras molnleverantörer', 'Nova cloud providers')}: {snapshot.policy.cloudEnabled && snapshot.policy.novaOllamaCloudEnabled ? tr('tillåtet inom budget', 'allowed within budget') : tr('av', 'off')}</p>
      <p hidden={inline} className="text-neutral-300">{tr('Du styr de gemensamma kostnadsgränserna här. Separat stoppar gränsen för självständiga anrop för många anrop i följd, även när USD-gränserna är av.', 'You control the shared spend caps here. Separately, the autonomous rate limit stops excessive call bursts, even when the USD caps are off.')}</p>
      {((snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0) || (snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0) || (snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0)) && <p role="status" className="text-amber-300">{tr('Budgeten stoppar nya betalda anrop. Reserverade belopp räknas tills utfallet är avgjort.', 'The budget is blocking new paid calls. Reserved amounts count until the outcome is settled.')}</p>}
      {!inline && !editing && <button type="button" onClick={() => { setDraft(draftForPolicy(snapshot.policy)); setEditing(true); setSaved(false); }} className="text-neutral-200">{tr('Ändra budget', 'Change budget')}</button>}
    </> : <p className="text-neutral-400">{tr('Budgeten har inte lästs än.', 'Budget not observed.')}</p>}
    {shown && (inline ? snapshot : true) && <form onSubmit={save} className="space-y-2">
      {fields.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-neutral-200">{fieldLabel(label)}<input aria-label={fieldLabel(label)} type="number" min="0" step="any" placeholder={tr('Ingen gräns', 'No cap')} value={draft[key] || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, [key]: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#27282a] border border-[#5a5b5d] rounded`} /></label>)}
      <label className="flex items-center justify-between gap-2 text-neutral-200">{tr('Självständiga molnanrop / 15 min', 'Autonomous cloud calls / 15 min')}<input aria-label={tr('Självständiga molnanrop per 15 minuter', 'Autonomous cloud calls per 15 minutes')} type="number" min="1" max="10000" step="1" placeholder={tr('Av', 'Off')} value={draft.maxAutonomousCloudCallsPer15m || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, maxAutonomousCloudCallsPer15m: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#27282a] border border-[#5a5b5d] rounded`} /></label>
      <p className="text-neutral-400">{tr('USD-gränserna gäller för Aura tillsammans. Tomt USD-fält = ingen kostnadsgräns. Gränsen för självständiga anrop gäller Auras eget arbete, även utan USD-gräns; ett tomt fält stänger av den. Ändringar finns kvar efter omstart.', 'The USD caps apply to Aura, Nova and SEER together. Empty USD field = no spend cap. The autonomous rate limit applies to SEER/Nova only, even without a USD cap; an empty field turns it off. Changes survive restart.')}</p>
      <div className="flex gap-3"><button type="submit" disabled={saving || (inline && !dirty)} className={inline ? 'bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-3 py-1.5 text-xs font-semibold text-white' : 'text-neutral-200'}>{saving ? tr('Sparar…', 'Saving…') : tr('Spara budget', 'Save budget')}</button>{!inline && <button type="button" disabled={saving} onClick={() => setEditing(false)} className="text-neutral-300">{tr('Avbryt', 'Cancel')}</button>}</div>
    </form>}
    {saved && <p role="status" className="text-emerald-400">{tr('Budgeten är sparad och avläst igen från JACO.', 'Budget saved and read back from runtime.')}</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
