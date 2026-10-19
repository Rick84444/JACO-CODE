import { readAuraResponse } from '../lib/auraApi.mjs';
import { activationReadiness } from '../lib/cognitiveEvents.mjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';

// One report for the workspace and its status bar. Read checks never activate services.
interface Report {
  ok: boolean;
  runtime: { up: boolean };
  tools: { toolCount: number; ready: number; servers: Array<{ id: string; status: string; tools: number; error?: string }> };
  providers: Array<{ id: string; active: boolean; state: string; models: number }>;
  planner: { provider: string | null; model: string | null; reachable: boolean | null } | null;
  problems: string[];
}

export function useActivationReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const refreshQueued = useRef(false);
  const mounted = useRef(false);
  const read = useCallback(async (start = false) => {
    if (pending.current) { if (!start) refreshQueued.current = true; return; }
    pending.current = true;
    setLoading(true); setStarting(start); setError('');
    try {
      const body = await fetch(start ? '/api/jaco/activate' : '/api/jaco/activation', {
        method: start ? 'POST' : 'GET', cache: 'no-store',
        signal: AbortSignal.timeout(start ? 180_000 : 60_000),
      }).then(readAuraResponse);
      if (!body.success || !body.report) throw new Error('Status kunde inte hämtas från JACO.');
      if (mounted.current) setReport(body.report);
    } catch (e: any) { if (mounted.current) setError(String(e?.message || e)); }
    finally {
      pending.current = false;
      if (mounted.current) { setLoading(false); setStarting(false); }
      if (refreshQueued.current && mounted.current) {
        refreshQueued.current = false;
        void read();
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void read();
    const refresh = () => { if (document.visibilityState === 'visible') void read(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('jaco:aura:provider-chosen', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      mounted.current = false; window.clearInterval(timer);
      window.removeEventListener('jaco:aura:provider-chosen', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [read]);
  return { report, loading, starting, error, read };
}

export const ActivationCard: React.FC<{
  activation: ReturnType<typeof useActivationReport>;
  onActivated?: () => void;
  onOpenProviders: () => void;
  onOpenProject: () => void;
  projectName: string;
}> = ({ activation, onActivated, onOpenProviders, onOpenProject, projectName }) => {
  const { report, loading, starting, error, read } = activation;
  const state = activationReadiness(activation);
  const [open, setOpen] = useState(false);
  const connect = state.action === 'connect';
  const start = state.action === 'activate';
  return <section className="cognitive-setup" aria-label="Kom igång med JACO" data-tone={state.tone}>
    <div className="cognitive-setup-heading">
      {loading ? <Loader2 size={16} className="animate-spin"/> : report?.ok && !error ? <Check size={16}/> : <AlertTriangle size={16}/>}
      <strong role="status">{starting ? 'Startar anslutna verktyg…' : state.label}</strong>
      <button type="button" onClick={() => void read()} disabled={loading} aria-label="Kontrollera status igen" title="Kontrollera igen"><RefreshCw size={16}/></button>
    </div>
    {(!report?.ok || error) && <p>{state.detail}</p>}
    <div className="cognitive-setup-actions">
      {state.action !== 'wait' && state.action !== 'goal' && <button type="button" disabled={loading} onClick={async () => {
        if (connect) onOpenProviders();
        else if (start) { await read(true); onActivated?.(); }
        else if (state.action === 'details') setOpen(true);
        else void read();
      }}>{connect ? 'Anslut modell' : start ? 'Starta verktyg' : state.action === 'details' ? 'Visa vad som saknas' : 'Försök igen'}</button>}
      <button type="button" onClick={onOpenProject}>Projekt: {projectName}</button>
      <button type="button" onClick={onOpenProviders}>Modellanslutningar</button>
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Dölj detaljer' : 'Anslutningsdetaljer'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {open && report && <div className="cognitive-setup-details">
      <p>{report.tools.toolCount} verktyg · {report.providers.filter(p => p.active).length} av {report.providers.length} modelltjänster svarar</p>
      {report.problems.map((problem, i) => <p key={i}>{problem}</p>)}
      {report.tools.servers.map(server => <p key={server.id}>{server.id}: {server.status === 'READY' ? `${server.tools} verktyg` : server.error || 'inte redo'}</p>)}
    </div>}
  </section>;
};
