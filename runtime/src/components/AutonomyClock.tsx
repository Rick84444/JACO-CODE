import React, { useCallback, useEffect, useState } from 'react';

// The autonomy clock: an operator-chosen, time-boxed window in which Aura works freely inside the
// coding contract. Money, release publication, secrets and access stay on REVIEW in the runtime.
type Active = { id: string; expiresAt: string; maxHours: number; signedAt: string | null; commercial?: boolean } | null;
const CHOICES: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 timme' },
  { hours: 8, label: '8 timmar' },
  { hours: 24, label: '1 dygn' },
  { hours: 168, label: '1 vecka' },
  { hours: 720, label: '30 dagar' },
];

function remaining(expiresAt: string, now: number): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'avslutad';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days} d ${hours} h kvar`;
  if (hours > 0) return `${hours} h ${mins} min kvar`;
  return `${mins} min kvar`;
}

export function AutonomyClock() {
  const [active, setActive] = useState<Active>(null);
  const [hours, setHours] = useState(8);
  const [commercial, setCommercial] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/aura/autonomy', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok || !body.success) throw Error(body.error || 'AUTONOMY_UNAVAILABLE');
      setActive(body.active); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Refresh the countdown every 30 s and re-read the state, so expiry and external stops show at once.
  useEffect(() => {
    const tick = setInterval(() => { setNow(Date.now()); void load(); }, 30_000);
    return () => clearInterval(tick);
  }, [load]);

  const start = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/aura/autonomy/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours, commercial }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw Error(body.error || 'AUTONOMY_START_FAILED');
      setActive(body.active); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/aura/autonomy/stop', { method: 'POST' });
      const body = await response.json();
      if (!response.ok || !body.success) throw Error(body.error || 'AUTONOMY_STOP_FAILED');
      setActive(null); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="autonomy-clock" role="group" aria-label="Autonomi-klocka">
      {active ? (
        <>
          <span>{active.commercial ? 'Aura arbetar med intäktsmöjligheter' : 'Aura arbetar fritt'} · {remaining(active.expiresAt, now)}</span>
          <button type="button" onClick={stop} disabled={busy}>Stoppa</button>
        </>
      ) : (
        <>
          <span>Autonomi av</span>
          <select value={hours} onChange={e => setHours(Number(e.target.value))} disabled={busy} aria-label="Hur länge">
            {CHOICES.map(c => <option key={c.hours} value={c.hours}>{c.label}</option>)}
          </select>
          <label><input type="checkbox" checked={commercial} disabled={busy} onChange={e => setCommercial(e.target.checked)}/> Företagarläge (inga utgående betalningar)</label>
          <button type="button" onClick={start} disabled={busy}>Starta</button>
        </>
      )}
      {error ? <span role="alert"> ({error})</span> : null}
    </div>
  );
}
