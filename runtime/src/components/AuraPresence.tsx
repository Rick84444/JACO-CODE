import React from 'react';
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
const ageLabel=(seconds:number|null)=>{
  if(seconds===null)return 'Tid ej observerad';
  if(seconds<60)return seconds+' sek sedan';
  if(seconds<3600)return Math.floor(seconds/60)+' min sedan';
  return Math.floor(seconds/3600)+' tim sedan';
};
export function AuraPresence({data}:{data:AuraPresenceView}) {
  return <section className="aura-presence" data-mode={data.mode} aria-label="JACO:s observerade system- och arbetsstatus" data-testid="aura-presence">
    <div className="aura-presence-top">
      <div className="aura-presence-heading">
        <span className="aura-presence-light" aria-hidden="true"/>
        <div className="aura-presence-state">
          <strong>{data.title}</strong>
          <span>{data.connectionLabel}</span>
        </div>
      </div>

    </div>
    {data.missionId && <dl className="grid gap-2 px-3 py-3 text-xs border-t border-slate-700" aria-label="Uppdragets läge och nästa åtgärd">
      <div><dt className="text-slate-400">Aktuellt uppdrag</dt><dd className="mt-1 break-words">{data.missionGoal}<small className="block text-slate-400">{data.missionId}</small></dd></div>
      <div><dt className="text-slate-400">Senaste verkliga framsteg</dt><dd className="mt-1">{data.step || 'Inget steg rapporterat'}{data.stepAge!==null?' · '+ageLabel(data.stepAge):''}</dd></div>
      <div><dt className="text-slate-400">Vad stoppar arbetet?</dt><dd className="mt-1" role={data.mode==='stalled'||data.mode==='blocked'?'status':undefined}>{data.blocker}</dd></div>
      <div><dt className="text-slate-400">Nästa åtgärd</dt><dd className="mt-1">{data.nextAction}</dd></div>
    </dl>}
    <div className="aura-presence-bottom">

      <span className="aura-presence-step"><Activity size={13}/>{data.step || data.detail}</span>
      {data.step && <span className="aura-presence-time"><Clock3 size={12}/>{ageLabel(data.stepAge)}</span>}
      {data.approvals>0 && <span className="aura-presence-warning"><CircleAlert size={12}/>{data.approvals} beslut</span>}
    </div>
    <details className="aura-presence-details"><summary>Anslutningar och verifiering</summary><div className="aura-presence-bottom"><span className="aura-presence-phase">{data.phaseLabel}</span>      {data.maxSteps!==null && data.stepCount!==null && <span className="aura-presence-number">Steg {data.stepCount}/{data.maxSteps}</span>}
      {data.verified!==null && <span className="aura-presence-number"><CheckCheck size={12}/>{data.verified} verifierade steg</span>}
</div>      <div className="aura-presence-signals" aria-label="Kopplingar">
        <span title="Verifierad modellidentitet från senast hämtade statusrapport"><PlugZap size={12}/>{data.modelLabel}</span>
        <span><Bot size={12}/>{data.connectedAgents} agenter · {data.workingSessions} sessioner</span>
        <span><Globe2 size={12}/>{data.cdpLabel}</span>
      </div></details>
  </section>;
}
