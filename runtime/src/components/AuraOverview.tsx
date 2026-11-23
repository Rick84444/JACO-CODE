import React, { useCallback, useEffect, useState } from 'react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { summarizeAuraWork } from '../lib/auraOverview.mjs';

// The operator's overview of Aura's work, read from the observed Gameboard. Nothing here starts,
// approves or changes work; it only shows what is verified, what is in the way and what needs the operator.
type Summary = ReturnType<typeof summarizeAuraWork>;

export function AuraOverview() {
  const { tr } = useUiLanguage();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/aura/workbench/gameboard', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok || !body.success) throw Error(body.error || 'OVERVIEW_UNAVAILABLE');
      setSummary(summarizeAuraWork(body)); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const label: Record<string, string> = {
    WORKING: tr('Aura arbetar', 'Aura is working'),
    WAITING_MODEL: tr('Väntar på modellen (tillfälligt)', 'Waiting for the model (temporary)'),
    BLOCKED: tr('Blockerad, behöver dig', 'Blocked, needs you'),
    IDLE: tr('Inget aktivt uppdrag', 'No active mission'),
  };

  return (
    <section className="aura-overview" aria-label={tr('Översikt', 'Overview')}>
      {error && !summary ? <p className="cognitive-muted">{tr('Översikten kan inte läsas just nu', 'The overview cannot be read right now')} ({error})</p> : null}
      {summary ? (
        <>
          <p className={`aura-overview-state aura-overview-${summary.state.toLowerCase()}`}><strong>{label[summary.state]}</strong></p>
          {summary.goal ? <p><span className="cognitive-muted">{tr('Mål', 'Goal')}: </span>{summary.goal}</p> : null}
          {summary.running ? <p><span className="cognitive-muted">{tr('Gör nu', 'Doing now')}: </span>{summary.running}</p> : null}
          {summary.nextStep ? <p><span className="cognitive-muted">{tr('Nästa', 'Next')}: </span>{summary.nextStep}</p> : null}
          <p>
            <span className="cognitive-muted">{tr('Verifierat', 'Verified')}: </span>
            {summary.progress.total ? `${summary.progress.verified}/${summary.progress.total} ${tr('steg', 'steps')}` : tr('inga steg ännu', 'no steps yet')}
            {` · ${summary.verifiedActions} ${tr('verifierade åtgärder', 'verified actions')}`}
          </p>
          {summary.blockers.length ? (
            <ul className="aura-overview-blockers">
              {summary.blockers.slice(0, 3).map(b => <li key={b.mission + b.code}>{b.code}: <span className="cognitive-muted">{b.detail}</span></li>)}
            </ul>
          ) : null}
          {summary.waitingForOperator.length ? (
            <p className="aura-overview-needs">{tr('Väntar på dig', 'Waiting for you')}: {summary.waitingForOperator.length}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
