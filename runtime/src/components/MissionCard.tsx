import React, { useState } from 'react';
import { ChevronRight, Square } from 'lucide-react';

export interface MissionCardMission { id: string; goal: string; status: string; cancelRequested?: boolean; lastAction?: { text?: string }; metadata?: { parent?: { graphId?: string } } }

const WAITING: Record<string, string> = {
  ACTIVE: 'Väntar på nästa observation',
  BLOCKED: 'Ett hinder behöver lösas',
  AWAITING_VERIFICATION: 'Slutresultatet behöver verifieras',
};

// The running mission, shown beside the work (not inside the conversation). "Avsluta" stops this work and
// keeps the goal; "Avsluta mål" ends the strategic goal behind it, a separate decision that is confirmed first.
export const MissionCard: React.FC<{
  mission: MissionCardMission;
  observation?: string | null;
  onOpenWork?: (missionId?: string) => void;
  onCancel?: (id: string) => Promise<void>;
  onEndGoal?: (id: string) => Promise<void>;
}> = ({ mission, observation, onOpenWork, onCancel, onEndGoal }) => {
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section className="cognitive-live-mission" data-mission-id={mission.id}>
    <div className="cognitive-live-mission-heading"><span className={'cognitive-mission-dot ' + (mission.status === 'ACTIVE' ? 'active' : '')} /><span>Pågående uppdrag</span>
      {onOpenWork && <button type="button" onClick={() => onOpenWork(mission.id)}>Visa arbete<ChevronRight size={12} /></button>}
      {onCancel && <button type="button" aria-label="Avsluta aktuellt uppdrag" disabled={closing || Boolean(mission.cancelRequested)} onClick={async () => {
        setClosing(true); setError(null);
        try { await onCancel(mission.id); } catch (e: any) { setError(e.message); } finally { setClosing(false); }
      }}><Square size={11} />{mission.cancelRequested ? 'Avslut begärt' : 'Avsluta'}</button>}
      {onEndGoal && mission.metadata?.parent?.graphId && <button type="button" aria-label="Avsluta det strategiska målet" disabled={closing} onClick={async () => {
        if (!window.confirm('Avsluta hela målet? Allt arbete för målet stoppas och målet planeras inte igen.')) return;
        setClosing(true); setError(null);
        try { await onEndGoal(mission.id); } catch (e: any) { setError(e.message); } finally { setClosing(false); }
      }}>Avsluta mål</button>}
    </div>
    <p title={mission.goal}>{mission.goal}</p>
    <div className="cognitive-live-mission-detail">{observation || mission.lastAction?.text || WAITING[mission.status]}</div>
    {error && <div role="alert" className="cognitive-error">{error}</div>}
  </section>;
};
