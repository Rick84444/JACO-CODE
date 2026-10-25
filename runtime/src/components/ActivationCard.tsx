import { readAuraResponse } from '../lib/auraApi.mjs';
import { activationReadiness } from '../lib/cognitiveEvents.mjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';

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
  const { tr } = useUiLanguage();
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
      if (!body.success || !body.report) throw new Error(tr('Status kunde inte hämtas från JACO.','Could not retrieve JACO status.'));
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
  const { tr } = useUiLanguage();
  const { report, loading, starting, error, read } = activation;
  const state = activationReadiness(activation);
  const [open, setOpen] = useState(false);
  const labels: Record<string,string> = {
    'Status kunde inte hämtas':'Status unavailable',
    'Kontrollerar vad som är redo':'Checking readiness',
    'JACO behöver startas':'Start JACO',
    'Anslut en modell för att börja':'Connect a model to begin',
    'Välj en modell som svarar':'Choose a working model',
    'Verktygen behöver startas':'Tools need to be started',
    'Agentkörningen behöver kontrolleras':'Agent runtime needs inspection',
    'Redo för ditt uppdrag':'Ready for your mission',
    'Kontrollera anslutningen och försök igen.':'Check the connection and retry.',
    'Kontrollerar modell, verktyg och agentkörning.':'Checking model, tools and agent runtime.',
    'Starta JACO på datorn och kontrollera anslutningen igen.':'Start JACO and check the connection again.',
    'Välj en lokal modell eller anslut en modelltjänst.':'Select a local model or connect a model provider.',
    'Den valda planeringsmodellen har inte kunnat verifieras.':'The selected planning model has not been verified.',
    'Starta de anslutna verktygen så att JACO kan arbeta i projektet.':'Start connected tools so JACO can work in the project.',
    'Modellen svarar, men alla förutsättningar för körning är inte uppfyllda.':'The model responds, but not all execution requirements are met.',
  };
  const localized = (value:string) => tr(value, labels[value] || value);
  const connect = state.action === 'connect';
  const start = state.action === 'activate';
  return <section className="cognitive-setup" aria-label={tr('Kom igång med JACO','Get started with JACO')} data-tone={state.tone}>
    <div className="cognitive-setup-heading">
      {loading ? <Loader2 size={16} className="animate-spin"/> : report?.ok && !error ? <Check size={16}/> : <AlertTriangle size={16}/>}
      <strong role="status">{starting ? tr('Startar anslutna verktyg…','Starting connected tools…') : localized(state.label)}</strong>
      <button type="button" onClick={() => void read()} disabled={loading} aria-label={tr('Kontrollera status igen','Check status again')} title={tr('Kontrollera igen','Refresh')}><RefreshCw size={16}/></button>
    </div>
    {(!report?.ok || error) && <p>{localized(state.detail)}</p>}
    <div className="cognitive-setup-actions">
      {state.action !== 'wait' && state.action !== 'goal' && <button type="button" disabled={loading} onClick={async () => {
        if (connect) onOpenProviders();
        else if (start) { await read(true); onActivated?.(); }
        else if (state.action === 'details') setOpen(true);
        else void read();
      }}>{connect ? tr('Anslut modell','Connect model') : start ? tr('Starta verktyg','Start tools') : state.action === 'details' ? tr('Visa vad som saknas','Show missing requirements') : tr('Försök igen','Retry')}</button>}
      <button type="button" onClick={onOpenProject}>{tr('Projekt','Project')}: {projectName}</button>
      {!connect&&<button type="button" onClick={onOpenProviders}>{tr('Modellanslutningar','Model connections')}</button>}
      <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? tr('Dölj detaljer','Hide details') : tr('Anslutningsdetaljer','Connection details')}</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {open && report && <div className="cognitive-setup-details">
      <p>{report.tools.toolCount} {tr('verktyg','tools')} · {report.providers.filter(p => p.active).length} {tr('av','of')} {report.providers.length} {tr('modelltjänster svarar','model providers responding')}</p>
      {report.problems.map((problem, i) => <p key={i}>{problem}</p>)}
      {report.tools.servers.map(server => <p key={server.id}>{server.id}: {server.status === 'READY' ? `${server.tools} ${tr('verktyg','tools')}` : server.error || tr('inte redo','not ready')}</p>)}
    </div>}
  </section>;
};
