import React, { useState } from 'react';
import { ChevronRight, Square } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { missionCardState } from '../lib/missionCardState.mjs';

export interface MissionCardMission { id: string; goal: string; status: string; cancelRequested?: boolean; lastAction?: { text?: string }; metadata?: { parent?: { graphId?: string } } }

const WAITING: Record<string, string> = {
  ACTIVE: 'Waiting for the next observation',
  BLOCKED: 'A blocker needs to be resolved',
  AWAITING_VERIFICATION: 'The final result needs verification',
};

// The running mission, shown beside the work (not inside the conversation). "End" stops this work and
// keeps the goal; "End goal" ends the strategic goal behind it, a separate decision that is confirmed first.
export const MissionCard: React.FC<{
  mission: MissionCardMission;
  observation?: string | null;
  presence?: { mode: string; missionId?: string | null; blocker?: string; detail?: string };
  onOpenWork?: (missionId?: string) => void;
  onCancel?: (id: string) => Promise<void>;
  onEndGoal?: (id: string) => Promise<void>;
}> = ({ mission, observation, presence, onOpenWork, onCancel, onEndGoal }) => {
  const { tr } = useUiLanguage();
  const state = missionCardState(mission, presence);
  const heading = {
    working: tr('Uppdraget arbetar', 'Mission working'),
    queued: tr('Uppdraget väntar', 'Mission queued'),
    stalled: tr('Uppdraget har stannat', 'Mission stalled'),
    blocked: tr('Uppdraget är blockerat', 'Mission blocked'),
    verifying: tr('Väntar på verifiering', 'Awaiting verification'),
    stopping: tr('Avslut begärt', 'Stop requested'),
    unknown: tr('Kontrollerar uppdraget', 'Checking mission'),
    unconfirmed: tr('Uppdrag registrerat', 'Mission registered'),
  }[state];
  const problem = ['stalled', 'blocked', 'queued', 'unknown', 'unconfirmed', 'verifying'].includes(state);
  const detail = problem
    ? (presence?.missionId === mission.id ? (presence.blocker || presence.detail || WAITING[mission.status]) : WAITING[mission.status])
    : (observation || mission.lastAction?.text || WAITING[mission.status]);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section className="cognitive-live-mission" data-mission-id={mission.id} data-mission-state={state}>
    <div className="cognitive-live-mission-heading"><span className={'cognitive-mission-dot ' + (state === 'working' ? 'active' : '')} /><span>{heading}</span>
      {onOpenWork && <button type="button" onClick={() => onOpenWork(mission.id)}>Show work<ChevronRight size={12} /></button>}
      {onCancel && <button type="button" aria-label="End the current mission" disabled={closing || Boolean(mission.cancelRequested)} onClick={async () => {
        setClosing(true); setError(null);
        try { await onCancel(mission.id); } catch (e: any) { setError(e.message); } finally { setClosing(false); }
      }}><Square size={11} />{mission.cancelRequested ? 'End requested' : 'End'}</button>}
      {onEndGoal && mission.metadata?.parent?.graphId && <button type="button" aria-label="End the strategic goal" disabled={closing} onClick={async () => {
        if (!window.confirm('End the whole goal? All work for the goal stops and the goal is not planned again.')) return;
        setClosing(true); setError(null);
        try { await onEndGoal(mission.id); } catch (e: any) { setError(e.message); } finally { setClosing(false); }
      }}>End goal</button>}
    </div>
    <p title={mission.goal}>{mission.goal}</p>
    <div className="cognitive-live-mission-detail">{detail}</div>
    {error && <div role="alert" className="cognitive-error">{error}</div>}
  </section>;
};
