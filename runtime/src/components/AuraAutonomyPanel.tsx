import { useEffect, useState } from 'react';

type Policy = { level: number; source: string; editsGranted: boolean };
const levels = [
  '0 – Endast manuella godkännanden',
  '1 – Verifierad läsning',
  '2 – Verifierad kodutveckling',
  '3 – Verifierade uppdrag',
  '4 – Även godkända verktygsjobb',
  '5 – Full autonomi (standard)',
];

export function AuraAutonomyPanel() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/aura/autonomy', { signal: AbortSignal.timeout(10000) })
      .then(async r => {
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.error || 'Policy unavailable');
        return data.policy as Policy;
      })
      .then(p => { if (alive) setPolicy(p); })
      .catch(e => { if (alive) setError('Autonominivån kunde inte läsas: ' + String(e.message || e)); });
    return () => { alive = false; };
  }, []);

  const change = async (level: number) => {
    if (!policy || saving || level === policy.level) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/aura/autonomy', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level }), signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Save failed');
      setPolicy(data.policy);
    } catch (e: any) {
      setError('Ändringen kunde inte verifieras: ' + String(e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return <div className="border border-[#343b45] rounded px-3 py-2 space-y-2" data-aura-autonomy>
    <label className="flex flex-wrap gap-2 items-center justify-between text-slate-200">
      <strong>Autonomi</strong>
      <select aria-label="Auras autonominivå" value={policy?.level ?? 5} disabled={saving || !policy}
        onChange={e => void change(Number(e.target.value))}
        className="bg-[#111820] border border-[#343b45] rounded p-1.5 text-xs max-w-full text-slate-200">
        {levels.map((label, level) => <option key={level} value={level}>{label}</option>)}
      </select>
    </label>
    <p className="text-slate-400">
      Aura börjar på nivå 5. Bara du ändrar den här inställningen, som sparas över omstarter.
      Kodarbete, verktyg och uppdrag fortsätter självständigt inom givna behörigheter.
      Köp, abonnemang och påfyllning av API-krediter kräver ditt godkännande.
    </p>
    <p className="text-amber-200">Betalda AI-API-anrop styrs separat under Budget.
      Utan ett eget kostnadstak kan anslutna betalmodeller generera verkliga kostnader.</p>
    {saving && <p role="status" className="text-slate-400">Sparar autonominivå…</p>}
    {policy && !saving && <p role="status" className="text-slate-500">Aktiv nivå: {policy.level}/5</p>}
    {error && <p role="alert" className="text-amber-300">{error}</p>}
  </div>;
}
