import { useUiLanguage } from '../i18n/UiLanguage';
import React from 'react';
import { Activity, Bot, CheckCheck, CircleAlert, Clock3, Globe2, Layers3, PlugZap, Radio, ShieldCheck } from 'lucide-react';

export type AuraPresenceView = {
  mode:string; title:string; detail:string; connected:boolean;
  connectionLabel:string;modelLabel:string;cdpLabel:string;
  connectedAgents:number;workingSessions:number;approvals:number;
  phaseLabel:string;step:string;stepAge:number|null;latestAt:string|null;
  verified:number|null;stepCount:number|null;maxSteps:number|null;
  streamAge:number|null;snapshotAge:number|null;
};
const ageLabel=(seconds:number|null)=>{
  if(seconds===null)return "Time not observed";
  if(seconds<60)return seconds+" sec ago";
  if(seconds<3600)return Math.floor(seconds/60)+" min ago";
  return Math.floor(seconds/3600)+" h ago";
};
export function AuraPresence({data}:{data:AuraPresenceView}) {
  const { t: uiText } = useUiLanguage();
  return <section className="aura-presence" data-mode={data.mode} aria-label={uiText("JACO system and work status")} data-testid="aura-presence">
    <div className="aura-presence-top">
      <div className="aura-presence-heading">
        <span className="aura-presence-light" aria-hidden="true"/>
        <div className="aura-presence-state">
          <strong>{uiText(data.title)}</strong>
          <span>{uiText(data.connectionLabel)}</span>
        </div>
      </div>

    </div>
    <div className="aura-presence-bottom">

      <span className="aura-presence-step"><Activity size={13}/>{uiText(data.step || data.detail)}</span>
      {data.step && <span className="aura-presence-time"><Clock3 size={12}/>{uiText(ageLabel(data.stepAge))}</span>}
      {data.approvals>0 && <span className="aura-presence-warning"><CircleAlert size={12}/>{data.approvals} {' '}{uiText("decisions")}</span>}
    </div>
    <details className="aura-presence-details"><summary>{uiText("Connections and verification")}</summary><div className="aura-presence-bottom"><span className="aura-presence-phase">{uiText(data.phaseLabel)}</span>      {data.maxSteps!==null && data.stepCount!==null && <span className="aura-presence-number">{uiText("Step")}{' '}{data.stepCount}/{data.maxSteps}</span>}
      {data.verified!==null && <span className="aura-presence-number"><CheckCheck size={12}/>{data.verified} {' '}{uiText("verified steps")}</span>}
</div>      <div className="aura-presence-signals" aria-label={uiText("Connections")}>
        <span title={uiText("Verified model identity from the latest status report")}><PlugZap size={12}/>{uiText(data.modelLabel)}</span>
        <span><Bot size={12}/>{data.connectedAgents} {' '}{uiText("agents ·")}{' '}{data.workingSessions} {' '}{uiText("sessions")}</span>
        <span><Globe2 size={12}/>{uiText(data.cdpLabel)}</span>
      </div></details>
  </section>;
}
