import React, { useCallback, useEffect, useState } from 'react';

// The operator edits one durable standing authority. This component is a view
// over the canonical AutonomyMandateStore; it never grants permissions itself.
// An authenticated change is a deliberate operator act, not model-generated
// policy text or another per-mission "autonomy clock".
type Consequence = 'READ' | 'LOCAL_MUTATION' | 'EXTERNAL_MUTATION' | 'PUBLISH' | 'AUTH' | 'SECURITY' | 'DESTRUCTIVE';
type Decision = 'ALLOW' | 'REVIEW' | 'DENY';
type Mandate = {
  id: string; name: string; revision: number; validity?: 'STANDING' | 'TIMED';
  expiresAt: string | null; signedAt: string | null; enabled: boolean;
  additionalRules?: string; decisions: Record<Consequence | 'FINANCIAL', Decision>;
};
const ACTIONS: Array<{ id: Consequence; label: string }> = [
  { id: 'READ', label: 'Läsa projekt, dokument och tillgängliga resurser' },
  { id: 'LOCAL_MUTATION', label: 'Skriva kod, köra tester och göra lokala ändringar' },
  { id: 'EXTERNAL_MUTATION', label: 'Ändra i anslutna externa tjänster inom valt scope' },
  { id: 'PUBLISH', label: 'Publicera, pusha och driftsätta inom valt scope' },
  { id: 'AUTH', label: 'Använda redan anslutna konton enligt deras behörigheter' },
  { id: 'SECURITY', label: 'Utföra tillåtna system- och säkerhetsåtgärder' },
  { id: 'DESTRUCTIVE', label: 'Utföra destruktiva åtgärder inom godkänd scope' },
];
const endpoint = '/api/aura/standing-mandate';

export function StandingMandatePanel() {
  const [mandate, setMandate] = useState<Mandate | null>(null);
  const [draft, setDraft] = useState<Mandate | null>(null);
  const [active, setActive] = useState(false);
  const [authRequired, setAuthRequired] = useState(true);
  const [operatorKey, setOperatorKey] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const headers = () => ({ 'Content-Type': 'application/json', ...(operatorKey ? { 'x-jaco-operator-token': operatorKey } : {}) });

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw Error(typeof result.error === 'string' ? result.error : 'MANDATE_READ_FAILED');
    setMandate(result.mandate);
    setDraft(result.mandate);
    setActive(result.active === true);
    setAuthRequired(result.mutationAuthRequired !== false);
  }, []);

  useEffect(() => { void load().catch(e => setError(String(e.message || e))); }, [load]);

  const perform = async (action: 'save' | 'sign' | 'revoke') => {
    if (!mandate || !draft || busy) return;
    setBusy(true); setError('');
    try {
      const url = action === 'save' ? endpoint : `${endpoint}/${action}`;
      const body = action === 'save'
        ? { expectedRevision: mandate.revision, patch: {
            validity: 'STANDING', decisions: draft.decisions, additionalRules: draft.additionalRules ?? '',
          } }
        : { expectedRevision: mandate.revision };
      const response = await fetch(url, { method: action === 'save' ? 'PATCH' : 'POST', headers: headers(), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.success) throw Error(typeof result.error === 'string' ? result.error : 'MANDATE_WRITE_FAILED');
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
      if (String(e?.message || '').includes('REVISION_CONFLICT')) {
        await load().catch(() => {});
      }
    } finally { setBusy(false); }
  };

  const dirty = Boolean(mandate && draft && (
    mandate.validity !== 'STANDING' || JSON.stringify(mandate.decisions) !== JSON.stringify(draft.decisions)
    || (mandate.additionalRules ?? '') !== (draft.additionalRules ?? '')
  ));

  return <section aria-label="Stående mandat för Aura" className="rounded-xl border border-neutral-600 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <strong>Stående mandat · Aura</strong>
        <p className="text-xs opacity-75">{active ? 'Aktivt tills du ändrar eller återkallar det' : 'Inte aktiverat'}{mandate ? ` · revision ${mandate.revision}` : ''}</p>
      </div>
      <button type="button" onClick={() => setExpanded(v => !v)}>{expanded ? 'Dölj policy' : 'Visa / ändra policy'}</button>
    </div>
    {expanded && draft && <>
      <p className="mt-2 text-xs">Inställningarna gäller över nya uppdrag och omstarter. Aura får agera inom mandatet utan nya frågor för samma befogenhet. Verktyg måste fortfarande vara anslutna och nåbara.</p>
      {authRequired && <label className="mt-2 block text-xs">Operatörsnyckel (lagras inte)
        <input type="password" autoComplete="off" value={operatorKey} onChange={e => setOperatorKey(e.target.value)} placeholder="JACO_ORG_OPERATOR_TOKEN" className="mt-1 block w-full"/>
      </label>}
      <div className="mt-3 space-y-2">
        {ACTIONS.map(item => <label key={item.id} className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={draft.decisions[item.id] === 'ALLOW'} disabled={busy}
            onChange={e => setDraft(old => old ? { ...old, decisions: { ...old.decisions, [item.id]: e.target.checked ? 'ALLOW' : 'DENY' } } : old)}/>
          <span>{item.label}</span>
        </label>)}
        <label className="flex items-start gap-2 text-sm opacity-75">
          <input type="checkbox" checked={false} disabled readOnly/>
          <span>Utgående betalningar kräver alltid ditt uttryckliga beslut</span>
        </label>
      </div>
      <label className="mt-3 block text-sm">Ytterligare regler för Aura
        <textarea className="mt-1 block w-full" rows={3} maxLength={4000} value={draft.additionalRules ?? ''} disabled={busy}
          placeholder="Exempel: Ändra inte arkitekturen utan tester. Återanvänd befintliga moduler."
          onChange={e => setDraft(old => old ? { ...old, additionalRules: e.target.value } : old)}/>
      </label>
      <p className="text-xs opacity-75">Extra regler sparas som mandattext. De ger aldrig fler behörigheter än kryssrutorna och är ännu inte garanterat injicerade i varje planeringsväg.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy || !dirty || (authRequired && !operatorKey)} onClick={() => void perform('save')}>Spara stående policy</button>
        {active
          ? <button type="button" disabled={busy || dirty || (authRequired && !operatorKey)} onClick={() => void perform('revoke')}>Återkalla mandat</button>
          : <button type="button" disabled={busy || dirty || (authRequired && !operatorKey)} onClick={() => void perform('sign')}>Aktivera mandat</button>}
        <button type="button" disabled={busy} onClick={() => void load().catch(e => setError(String(e.message || e)))}>Läs om från runtime</button>
      </div>
      {dirty && <p className="text-xs">Osparade ändringar. Spara först för att uppdatera ett aktivt mandat.</p>}
    </>}
    {error && <p role="alert" className="mt-2 text-sm text-amber-400">{error}</p>}
  </section>;
}
