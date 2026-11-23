import React, { useState } from 'react';
import { Code2, Globe, Terminal, FlaskConical, GitBranch, Wrench, Pin, PinOff, ShieldCheck } from 'lucide-react';
import { projectAuraLiveWorkspace } from '../lib/liveWorkspaceProjection.mjs';
import type { CognitiveEvent } from '../hooks/useCognitiveLive';
import { useUiLanguage } from '../i18n/UiLanguage';

type Connection = 'connecting' | 'live' | 'reconnecting' | 'unavailable';
type Props = {
  events: CognitiveEvent[];
  missionId: string | null;
  connection: Connection;
  onInspect: (event: CognitiveEvent) => void;
  onOpenFile: (path: string) => void;
  onOpenPlan: (graphId: string, nodeKey: string | null) => void;
};
const symbols = {
  code: Code2, browser: Globe, terminal: Terminal,
  tests: FlaskConical, git: GitBranch, tools: Wrench
};
const headings: Record<string, [string, string]> = {
  code: ['Kod', 'Code'], browser: ['Webbläsare', 'Browser'],
  terminal: ['Terminal', 'Terminal'], tests: ['Tester', 'Tests'],
  git: ['Git', 'Git'], tools: ['Verktyg', 'Tools']
};
const statuses: Record<string, [string, string]> = {
  RUNNING: ['Startat, väntar på resultat', 'Started, awaiting result'],
  VERIFIED: ['Verifierat resultat', 'Verified result'],
  FAILED: ['Misslyckades', 'Failed'],
  UNKNOWN: ['Okänt resultat', 'Unknown outcome'],
  UNVERIFIED: ['Inte verifierat', 'Not verified'],
  OBSERVATION_INTERRUPTED: ['Anslutning avbruten', 'Observation interrupted'],
  NO_RECENT_OBSERVATION: ['Ingen färsk observation', 'No recent observation']
};

// A visual observation of existing execution only. Never runs or retries a tool.
export function AuraLiveToolSurfaces({ events, missionId, connection, onInspect, onOpenFile, onOpenPlan }: Props) {
  const { tr } = useUiLanguage();
  const [pinned, setPinned] = useState<string | null>(null);
  const projection = projectAuraLiveWorkspace(events, {
    missionId, connection, pinnedSurface: pinned
  });
  return <section className="aura-live-tool-surfaces" aria-label={tr('Auras verktyg i arbete', 'Aura tools at work')} data-testid="aura-live-tool-surfaces">
    <header>
      <strong><Wrench size={14}/>{tr('Levande arbetsverktyg', 'Live work tools')}</strong>
      <small>{projection.actionCount} {tr('observerade verktygssteg', 'observed tool actions')}</small>
    </header>
    {projection.surfaces.length === 0
      ? <p className="aura-live-tool-empty">{tr('Inga faktiska verktygssteg har rapporterats för detta uppdrag ännu.', 'No actual tool execution has been reported for this mission yet.')}</p>
      : <div className="aura-live-tool-grid">
          {projection.surfaces.map(surface => {
            const Icon = symbols[surface.id as keyof typeof symbols] || Wrench;
            const current = surface.primary;
            const path = current.evidence?.path;
            const isPinned = pinned === surface.id;
            const status = statuses[current.state] || statuses.UNVERIFIED;
            return <article key={surface.id} data-surface={surface.id} data-status={current.state} className="aura-live-tool-card">
              <div className="aura-live-tool-head">
                <Icon size={15} aria-hidden="true"/>
                <strong>{tr(...headings[surface.id])}</strong>
                <span className="aura-live-tool-count">{surface.count}</span>
                <button type="button" aria-label={isPinned ? tr('Frigör verktygsvyn', 'Unpin tool view') : tr('Fäst verktygsvyn', 'Pin tool view')}
                  aria-pressed={isPinned} title={tr('Prioritera denna arbetsyta', 'Prioritize this surface')}
                  onClick={() => setPinned(isPinned ? null : surface.id)}>{isPinned ? <PinOff size={14}/> : <Pin size={14}/>}</button>
              </div>
              <button type="button" className="aura-live-tool-primary"
                onClick={() => path && surface.id === 'code' ? onOpenFile(path) : onInspect(current.event)}
                title={tr('Öppna källhändelsen', 'Inspect source event')}>
                <span className="aura-live-tool-kind">{current.toolType}</span>
                <span data-outcome={current.state} className="aura-live-tool-status">{current.state === 'VERIFIED' && <ShieldCheck size={12}/>} {tr(...status)}</span>
                <small>{current.actionId}</small>
              </button>
              {current.planId && <button type="button" className="aura-live-tool-plan"
                onClick={() => onOpenPlan(current.planId, current.nodeKey)}>
                {tr('Visa delmålet i Gameboard', 'Show subgoal in Gameboard')}
              </button>}
              {surface.entries.length > 1 && <details className="aura-live-tool-details">
                <summary>{tr('Fler verktygssteg', 'More tool actions')} ({surface.entries.length - 1})</summary>
                {surface.entries.slice(1).map(item => <button type="button" key={item.id}
                  onClick={() => item.evidence?.path && surface.id === 'code' ? onOpenFile(item.evidence.path) : onInspect(item.event)}>
                  <span>{item.toolType}</span><small>{tr(...(statuses[item.state] || statuses.UNVERIFIED))}</small>
                </button>)}
              </details>}
            </article>;
          })}
        </div>}
    <p className="aura-live-tool-footnote">{tr('Visar verkligt rapporterade handlingar. Verktygsregistrering och planering räknas inte som körning.', 'Only reported tool actions are shown. Tool registration and planning do not count as execution.')}</p>
  </section>;
}
