import React, { useEffect, useRef, useState } from 'react';
import { Activity, TerminalSquare, X } from 'lucide-react';
import { humanChatEvents } from '../lib/humanChat';
import { auraActivityFeed } from '../lib/auraStage.mjs';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { useUiLanguage } from '../i18n/UiLanguage';
import { AuraTerminal } from './AuraTerminal';

// Presentation-only window. The canonical useCognitiveLive stream already
// owns these events; opening the window does not start another connection.
export function AuraLiveTerminalWindow({
  events, missionId, missionGoal, connection, onClose,
}: {
  events: CognitiveEvent[];
  missionId: string | null;
  missionGoal: string | null;
  connection: 'connecting' | 'live' | 'reconnecting' | 'unavailable';
  onClose: () => void;
}) {
  const { tr, language } = useUiLanguage();
  const [tab, setTab] = useState<'activity' | 'commands'>('activity');
  const [follow, setFollow] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const steps = auraActivityFeed(humanChatEvents(events, language).conversation, missionId, 80);
  const latest = steps[0]?.event.id || '';
  useEffect(() => { setFollow(true); }, [missionId]);
  useEffect(() => {
    if (tab === 'activity' && follow && viewport.current) viewport.current.scrollTop = 0;
  }, [latest, steps[0]?.count, tab, follow]);
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [onClose]);

  const connectionLabel = connection === 'live'
    ? tr('Aktivitetsflödet anslutet', 'Activity stream connected')
    : connection === 'connecting' || connection === 'reconnecting'
      ? tr('Återansluter – visar senaste observation', 'Reconnecting – showing last observation')
      : tr('Ingen liveanslutning – visar senaste observation', 'No live connection – showing last observation');

  return <aside id="aura-live-terminal" className="aura-live-terminal-window"
    data-testid="aura-live-terminal-window" role="dialog" aria-modal="false"
    aria-label={tr('Aura Live Terminal', 'Aura Live Terminal')}>
    <header className="aura-live-terminal-header">
      <span className="aura-live-terminal-heading"><TerminalSquare size={16}/><strong>Aura Live Terminal</strong></span>
      <button type="button" className="aura-live-terminal-close" onClick={onClose}
        aria-label={tr('Stäng live-terminalen', 'Close live terminal')}><X size={17}/></button>
    </header>
    <div className="aura-live-terminal-state" role="status" data-connection={connection}>
      <span className="aura-live-terminal-state-dot" aria-hidden="true"/>
      <span>{connectionLabel}</span>
    </div>
    {missionGoal && <p className="aura-live-terminal-goal" title={missionGoal}>{missionGoal}</p>}
    <div className="aura-live-terminal-tabs" role="tablist" aria-label={tr('Terminalvy', 'Terminal view')}>
      <button type="button" id="aura-live-activity-tab" role="tab" aria-selected={tab === 'activity'}
        aria-controls="aura-live-terminal-content" onClick={() => setTab('activity')}>
        <Activity size={14}/>{tr('Vad Aura gör', 'What Aura is doing')}
      </button>
      <button type="button" id="aura-live-commands-tab" role="tab" aria-selected={tab === 'commands'}
        aria-controls="aura-live-terminal-content" onClick={() => setTab('commands')}>
        <TerminalSquare size={14}/>{tr('Kommandon', 'Commands')}
      </button>
    </div>
    {tab === 'activity' ? <section id="aura-live-terminal-content" className="aura-live-terminal-activity"
      role="tabpanel" aria-labelledby="aura-live-activity-tab">
      <div className="aura-live-terminal-activity-tools">
        <span>{tr('Observerade steg', 'Observed steps')}{steps.length ? ` · ${steps.length}` : ''}</span>
        <button type="button" aria-pressed={follow} onClick={() => { setFollow(true); if (viewport.current) viewport.current.scrollTop = 0; }}>
          {follow ? tr('Följer senaste', 'Following latest') : tr('Följ senaste', 'Follow latest')}
        </button>
      </div>
      <div ref={viewport} role="log" aria-live="off" className="aura-live-terminal-activity-log"
        onScroll={() => { if (viewport.current && viewport.current.scrollTop > 48) setFollow(false); }}>
        {!steps.length && <p className="aura-live-terminal-empty">{tr(
          'Inga steg har rapporterats för det aktuella uppdraget ännu.',
          'No steps have been reported for the current mission yet.',
        )}</p>}
        <ol>
          {steps.map(({event, count}) => <li key={event.id} data-outcome={event.evidence?.outcome || 'unknown'}>
            <div className="aura-live-terminal-event-meta">
              <time dateTime={event.at}>{Number.isFinite(Date.parse(event.at)) ? new Date(event.at).toLocaleTimeString(language === 'sv' ? 'sv-SE' : 'en-GB', {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--:--:--'}</time>
              <span>{event.evidence?.outcome === 'verified' ? tr('Verifierat', 'Verified')
                : event.evidence?.outcome === 'failed' ? tr('Misslyckades', 'Failed')
                : event.evidence?.outcome === 'unknown' ? tr('Okänt utfall', 'Unknown outcome')
                : tr('Observerat', 'Observed')}</span>
            </div>
            <p>{event.text}{count > 1 ? ` (${count}×)` : ''}</p>
          </li>)}
        </ol>
      </div>
    </section> : <section id="aura-live-terminal-content" className="aura-live-terminal-commands"
      role="tabpanel" aria-labelledby="aura-live-commands-tab">
      {/* The operator console spans canonical mission receipts, including recent
          completed missions. Do not bind command visibility to a different
          currently selected mission in the Gameboard. */}
      <AuraTerminal events={events} missionId={null} connection={connection}/>
    </section>}
  </aside>;
}
