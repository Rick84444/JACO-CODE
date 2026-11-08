import React from 'react';
import { humanPresence, presenceAge } from '../lib/humanPresence';
import { Activity, Bot, CheckCheck, CircleAlert, Clock3, Globe2, Layers3, PlugZap, Radio, ShieldCheck } from 'lucide-react';

export type AuraPresenceView = {
  mode:string; title:string; detail:string; connected:boolean;
  missionGoal?:string;missionId?:string|null;blocker?:string;nextAction?:string;
  connectionLabel:string;modelLabel:string;cdpLabel:string;
  connectedAgents:number;workingSessions:number;approvals:number;
  phaseLabel:string;step:string;stepAge:number|null;latestAt:string|null;
  verified:number|null;stepCount:number|null;maxSteps:number|null;
  streamAge:number|null;snapshotAge:number|null;
};
export function AuraPresence({data:raw,language='sv'}:{data:AuraPresenceView;language?:string}) {
  const data=humanPresence(raw,language);
  const tr=(sv:string,en:string)=>language==='sv'?sv:en;
  const ageLabel=(seconds:number|null)=>presenceAge(seconds,language);
  return <section className="aura-presence" data-mode={data.mode} aria-label={tr('Auras läge och arbete','Aura status and work')} data-testid="aura-presence">
    <div className="aura-presence-top">
      <div className="aura-presence-heading">
        <span className="aura-presence-light" aria-hidden="true"/>
        <div className="aura-presence-state">
          <strong>{data.title}</strong>
          <span>{data.connectionLabel}</span>
        </div>
      </div>

    </div>
    {data.missionId && <dl className="grid gap-2 px-3 py-3 text-xs border-t border-neutral-600" aria-label={tr('Uppdraget och nästa steg','The mission and the next step')}>
      <div><dt className="text-neutral-300">{tr('Aktuellt uppdrag','Current mission')}</dt><dd className="mt-1 break-words">{data.missionGoal}</dd></div>
      <div><dt className="text-neutral-300">{tr('Senaste steget','Latest step')}</dt><dd className="mt-1">{data.step || tr('Inget steg rapporterat','No step reported')}{data.stepAge!==null?' · '+ageLabel(data.stepAge):''}</dd></div>
      <div><dt className="text-neutral-300">{tr('Vad stoppar arbetet?','What is stopping the work?')}</dt><dd className="mt-1" role={data.mode==='stalled'||data.mode==='blocked'?'status':undefined}>{data.blocker}</dd></div>
      <div><dt className="text-neutral-300">{tr('Nästa steg','Next step')}</dt><dd className="mt-1">{data.nextAction}</dd></div>
    </dl>}
    <div className="aura-presence-bottom">

      <span className="aura-presence-step"><Activity size={13}/>{data.step || data.detail}</span>
      {data.step && <span className="aura-presence-time"><Clock3 size={12}/>{ageLabel(data.stepAge)}</span>}
      {data.approvals>0 && <span className="aura-presence-warning"><CircleAlert size={12}/>{data.approvals} {data.approvals===1?tr('beslut','decision'):tr('beslut','decisions')}</span>}
    </div>
    <details className="aura-presence-details"><summary>{tr('Anslutningar och kontroll','Connections and checks')}</summary><div className="aura-presence-bottom"><span className="aura-presence-phase">{data.phaseLabel}</span>      {data.maxSteps!==null && data.stepCount!==null && <span className="aura-presence-number">{tr('Steg','Step')} {data.stepCount}/{data.maxSteps}</span>}
      {data.verified!==null && <span className="aura-presence-number"><CheckCheck size={12}/>{data.verified} {tr('kontrollerade steg','checked steps')}</span>}
</div>      <div className="aura-presence-signals" aria-label={tr('Anslutningar','Connections')}>
        <span title={tr('Modellen som svarade senast','The model that answered last')}><PlugZap size={12}/>{data.modelLabel}</span>
        <span><Bot size={12}/>{data.connectedAgents} {tr('agenter','agents')} · {data.workingSessions} {tr('pågående','working')}</span>
        <span><Globe2 size={12}/>{data.cdpLabel}</span>
      </div></details>
  </section>;
}
