import React, { useEffect, useRef, useState } from 'react';
import { readAuraResponse } from '../lib/auraApi.mjs';

type Limits = { dailyCloudUsd: number | null; monthlyCloudUsd: number | null; maxCloudUsdPerTask: number | null; maxAutonomousCloudCallsPer15m: number | null };
type GeminiQuotaModel = { label?: string; category?: string; rpm: number | null; tpm: number | null; rpd: number | null; usedRpm: number; usedTpm: number; usedRpd: number; cooldownUntil?: number | null };
type GeminiQuotaSnapshot = { source: string; observedAt: string; projectAssociationVerified: boolean; providerUsageIncluded: boolean; localOnly: boolean; pacificDay: string; models: Record<string, GeminiQuotaModel> };
type Snapshot = { policy: Limits & { manualAuraCloudEnabled: boolean; novaOllamaCloudEnabled: boolean; cloudEnabled: boolean }; state: { dailySpentUsd: number; reservedUsd: number; reservations?: Record<string, { status?: string; estimatedUsd: number }> }; headroom: { dailyUsd: number | null; monthlyUsd: number | null }; geminiQuota?: GeminiQuotaSnapshot };
const fields = [ ['dailyCloudUsd', 'USD per dygn'], ['monthlyCloudUsd', 'USD per månad'], ['maxCloudUsdPerTask', 'USD per uppgift'] ] as const;
const money = (n: number) => n.toLocaleString('sv-SE', { maximumFractionDigits: 6 });
// A cap the operator has not set is shown as such, never as a number.
const cap = (n: number | null, unit: string) => n == null ? `inget tak ${unit}` : `${money(n)} USD${unit}`;
const draftOf = (n: number | null) => n == null ? '' : String(n);
const draftForPolicy = (policy: Limits) => ({ ...Object.fromEntries(fields.map(([key]) => [key, draftOf(policy[key])])), maxAutonomousCloudCallsPer15m: draftOf(policy.maxAutonomousCloudCallsPer15m) });

// inline: the Providers view shows the limits as fields you can change straight away (one Spara button).
export function EconomicBudgetPanel({ inline = false }: { inline?: boolean } = {}) {
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
    } catch (e: any) { if (mounted.current) setError(`Kunde inte ändra: ${e.message}`); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const releaseHeld = async () => {
    if (saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setError(null);
    try {
      const data = await fetch('/api/aura/budget/release-unknown', { method: 'POST', signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) setSnapshot(data.economic);
    } catch (e: any) { if (mounted.current) setError(`Kunde inte frigöra: ${e.message}`); }
    finally { saveInFlight.current = false; if (mounted.current) setSaving(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    // An empty field turns that cap off; a value must be zero or more.
    const dollars = Object.fromEntries(fields.map(([key]) => [key, draft[key]?.trim() ? Number(draft[key]) : null]));
    if (Object.values(dollars).some(n => n !== null && (!Number.isFinite(n) || n < 0))) { setError('Ange ett belopp som är noll eller större, eller lämna fältet tomt för inget tak.'); return; }
    const burstText = draft.maxAutonomousCloudCallsPer15m?.trim() || '';
    const burst = burstText ? Number(burstText) : null;
    if (burst != null && (!Number.isInteger(burst) || burst < 1 || burst > 10000)) { setError('Autonom spärr måste vara ett heltal mellan 1 och 10 000, eller tomt för avstängt.'); return; }
    const patch = { ...dollars, maxAutonomousCloudCallsPer15m: burst };
    saveInFlight.current = true; ++revision.current; setSaving(true); setSaved(false); setError(null);
    try {
      const data = await fetch('/api/aura/budget', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch), signal: AbortSignal.timeout(10000) }).then(readAuraResponse);
      if (mounted.current) { setSnapshot(data.economic); setEditing(false); setDirty(false); setSaved(true); }
    } catch (e: any) { if (mounted.current) setError(`Budgetändringen kunde inte bekräftas: ${e.message}. Uppdatera för att läsa sparad policy.`); }
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
    : !cloudOn ? 'Molnmodeller är avstängda: chatten och Nova använder bara lokala modeller.'
    : snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0 ? 'Dagens budget är slut. Höj gränsen eller frigör reserverat.'
    : snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0 ? 'Månadens budget är slut. Höj gränsen.'
    : snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0 ? 'Gränsen per uppgift är noll: inga betalda anrop går igenom.'
    : null;
  return <div className={`${inline ? 'text-xs border border-[#333] bg-[#181818] p-3 space-y-2' : 'text-[10px] border border-[#343b45] p-2 space-y-1'} rounded`}>
    <div className="flex justify-between gap-2"><strong className="text-slate-300">Gemensam molnbudget</strong><button type="button" disabled={saving} onClick={() => { setSaved(false); void refresh(); }} className="text-cyan-400">Uppdatera budget</button></div>
    {inline && snapshot && <>
      <label className="flex items-start gap-2 text-slate-200 cursor-pointer">
        <input type="checkbox" checked={cloudOn} disabled={saving} onChange={e => void setCloud(e.target.checked)} className="mt-0.5 h-4 w-4" aria-label="Tillåt molnmodeller" />
        <span><strong>Tillåt molnmodeller</strong><br /><span className="text-slate-400">Chatten och Nova får använda DeepSeek, Groq med flera, inom de tak du själv har satt nedan. Av = bara lokala modeller.</span></span>
      </label>
      <p role="status" className={blocking ? 'text-amber-300' : 'text-emerald-400'}>{blocking || 'Inget blockerar molnanrop just nu.'}</p>
      {held.length > 0 && <p className="text-slate-400">{held.length} anrop med okänt utfall håller {money(heldUsd)} USD reserverat (frigörs av sig själva efter en stund). <button type="button" disabled={saving} onClick={() => void releaseHeld()} className="text-cyan-400 underline">Frigör nu</button></p>}
    </>}
    {snapshot ? <>
      <p className="text-slate-300">{cap(snapshot.policy.dailyCloudUsd, '/dygn')} · {cap(snapshot.policy.monthlyCloudUsd, '/månad')} · {cap(snapshot.policy.maxCloudUsdPerTask, '/uppgift')}</p>
      <p className="text-slate-300">Autonom säkerhetsspärr: {snapshot.policy.maxAutonomousCloudCallsPer15m == null ? 'avstängd' : `${snapshot.policy.maxAutonomousCloudCallsPer15m} betalda anrop per 15 minuter`}. Styr Nova och SEER, inte din manuella Aura-chatt.</p>
      <p className="text-slate-400">Tokenbaserat kostnadsunderlag idag: {money(snapshot.state.dailySpentUsd)} USD · Reserverat: {money(snapshot.state.reservedUsd)} USD · Kvar idag: {snapshot.headroom.dailyUsd == null ? 'inget tak' : `${money(snapshot.headroom.dailyUsd)} USD`}</p>
      <p className="text-slate-500">USD-beloppen beräknas med JACO:s konfigurerade priser eller referenspriser och är inte avstämda mot leverantörens faktura.</p>
      {snapshot.geminiQuota && <details className="border border-[#343b45] rounded p-2 space-y-2">
        <summary className="text-cyan-300 cursor-pointer">Gemini · verkliga modellgränser från AI Studio ({Object.keys(snapshot.geminiQuota.models).length} modeller)</summary>
        <p className="text-amber-200">Importerat {snapshot.geminiQuota.observedAt}. Detta är en operatörsrapporterad AI Studio-snapshot, INTE ett levande Google-kvotsaldo. Gränserna gäller per Google-projekt; bara anrop från denna JACO-runtime räknas här. Rate limits är inte pris eller bevis på gratisnivå.</p>
        <div className="max-h-60 overflow-auto space-y-2" role="table" aria-label="Gemini kvoter per modell">
          {(Object.entries(snapshot.geminiQuota.models) as [string, GeminiQuotaModel][])
            .filter(([key, q]) => key === 'gemini-2.5-flash' || key === 'gemini-2.5-flash-lite' || key === 'gemini-2.5-pro' || q.usedRpm > 0 || q.usedRpd > 0)
            .slice(0, 15).map(([model, q]) => <div key={model} role="row" className="rounded border border-[#343b45] px-2 py-1">
              <strong className="text-slate-200" role="cell">{q.label || model}</strong>
              <p className="text-slate-400" role="cell">RPM {q.usedRpm.toLocaleString('sv-SE')} / {q.rpm?.toLocaleString('sv-SE') ?? 'obegränsat'} · TPM {q.usedTpm.toLocaleString('sv-SE')} / {q.tpm?.toLocaleString('sv-SE') ?? 'obegränsat'} · RPD {q.usedRpd.toLocaleString('sv-SE')} / {q.rpd?.toLocaleString('sv-SE') ?? 'obegränsat'}</p>
              {q.cooldownUntil && q.cooldownUntil > Date.now() && <p className="text-amber-300">Google 429: spärrad tills {new Date(q.cooldownUntil).toLocaleTimeString('sv-SE')}</p>}
            </div>)}
        </div>
        <p className="text-slate-500">RPD återställs vid midnatt Pacific-tid. JACO lämnar säkerhetsmarginal på 10 % och behåller autonom anropsbegränsning separat. Övriga modeller kan hämtas via /api/aura/budget/gemini-quotas.</p>
      </details>}
      <p hidden={inline} className="text-slate-500">Aura moln: {snapshot.policy.cloudEnabled && snapshot.policy.manualAuraCloudEnabled ? 'tillåtet inom budget' : 'avstängt'} · Nova molnproviders: {snapshot.policy.cloudEnabled && snapshot.policy.novaOllamaCloudEnabled ? 'tillåtet inom budget' : 'avstängt'}</p>
      <p hidden={inline} className="text-slate-400">Du styr gemensamma kostnadstak här. Separat stoppar den autonoma säkerhetsspärren överdrivna anropsserier, även när USD-taken är avstängda.</p>
      {((snapshot.headroom.dailyUsd != null && snapshot.headroom.dailyUsd <= 0) || (snapshot.headroom.monthlyUsd != null && snapshot.headroom.monthlyUsd <= 0) || (snapshot.policy.maxCloudUsdPerTask != null && snapshot.policy.maxCloudUsdPerTask <= 0)) && <p role="status" className="text-amber-300">Budgeten stoppar nya betalda anrop. Reserverade belopp räknas in tills utfallet är fastställt.</p>}
      {!inline && !editing && <button type="button" onClick={() => { setDraft(draftForPolicy(snapshot.policy)); setEditing(true); setSaved(false); }} className="text-cyan-400">Ändra budget</button>}
    </> : <p className="text-slate-500">Budget ej observerad.</p>}
    {shown && (inline ? snapshot : true) && <form onSubmit={save} className="space-y-2">
      {fields.map(([key, label]) => <label key={key} className="flex items-center justify-between gap-2 text-slate-300">{label}<input aria-label={label} type="number" min="0" step="any" placeholder="Inget tak" value={draft[key] || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, [key]: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#111820] border border-[#343b45] rounded`} /></label>)}
      <label className="flex items-center justify-between gap-2 text-slate-300">Autonoma molnanrop / 15 min<input aria-label="Autonoma molnanrop per 15 minuter" type="number" min="1" max="10000" step="1" placeholder="Avstängd" value={draft.maxAutonomousCloudCallsPer15m || ''} disabled={saving} onChange={e => { setDirty(true); setSaved(false); setDraft(d => ({ ...d, maxAutonomousCloudCallsPer15m: e.target.value })); }} className={`${inline ? 'w-28 px-2 py-1 text-sm' : 'w-24 px-1 py-0.5'} bg-[#111820] border border-[#343b45] rounded`} /></label>
      <p className="text-slate-500">USD-taken gäller Aura, Nova och SEER gemensamt. Tomt USD-fält = inget kostnadstak. Den autonoma spärren gäller enbart SEER/Nova, även utan USD-tak; tomt fält stänger av den. Ändringarna överlever omstart.</p>
      <div className="flex gap-3"><button type="submit" disabled={saving || (inline && !dirty)} className={inline ? 'bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 rounded px-3 py-1.5 text-xs font-semibold text-white' : 'text-cyan-400'}>{saving ? 'Sparar…' : 'Spara budget'}</button>{!inline && <button type="button" disabled={saving} onClick={() => setEditing(false)} className="text-slate-400">Avbryt</button>}</div>
    </form>}
    {saved && <p role="status" className="text-emerald-400">Budgeten är sparad och avläst från runtime.</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
