import React from 'react';
import { MessageSquare, Code2, PanelRightClose, Eye, ShieldCheck, Folder, GitBranch, Wrench, PlugZap, BookOpen, MonitorSmartphone, Search, CircleDollarSign, CircleAlert, ChevronRight, X, LogOut, Network, Smartphone, MoreHorizontal, Bot } from 'lucide-react';
import { JacoWordmark } from './JacoWordmark';
import { CostChip } from './CostChip';

export type CognitiveCanvas='conversation'|'agents'|'code'|'preview'|'evidence'|'gameboard'|'voice'|'connections';
type Sidebar='explorer'|'source-control'|'tools'|'skills'|'devices'|'providers'|'revenue';
interface Props {
  canvas:CognitiveCanvas;onCanvas:(view:CognitiveCanvas)=>void;conversation:React.ReactNode;detail:React.ReactNode;
  sidePanel:React.ReactNode;sidebar:Sidebar;sidePanelOpen:boolean;onSidebar:(view:Sidebar)=>void;onCloseSidebar:()=>void;
  status:{label:string;tone:string};projectName:string;branch?:string|null;changes:number;
  approvalCount:number;onApprovals:()=>void;onCommands:()=>void;onSignOut:()=>void;
  lastObservedAt:string|null;error:string|null;
  attention?:React.ReactNode;
}
const views=[['conversation',MessageSquare,'Samtal'],['agents',Bot,'Agenter'],['code',Code2,'Kod'],['connections',PlugZap,'Anslutningar'],['preview',Eye,'Förhandsvisa'],['evidence',ShieldCheck,'Belägg'],['gameboard',Network,'Spelplan'],['voice',Smartphone,'WhatsApp']] as const;
const tools=[['explorer',Folder,'Projektfiler'],['source-control',GitBranch,'Git & ändringar'],['tools',Wrench,'Verktyg'],['skills',BookOpen,'Färdigheter'],['providers',PlugZap,'Modellanslutningar'],['devices',MonitorSmartphone,'Enheter'],['revenue',CircleDollarSign,'Budget & ekonomi']] as const;

export function CognitiveWorkspace(props:Props) {
  const hasCanvas=props.canvas!=='conversation';
  return <div className="cognitive-workspace" data-cognitive-workspace="true">
    <header className="cognitive-topbar">
      <div className="cognitive-brand"><JacoWordmark/><span className="cognitive-brand-divider"/><span className="cognitive-product">Aura</span></div>
      <div className="cognitive-project"><Folder size={14}/><span>{props.projectName}</span><ChevronRight size={12}/><span className="cognitive-branch">{props.branch || 'Projekt'}</span></div>
      <div className="cognitive-top-actions">
        <CostChip onOpen={()=>props.onSidebar('providers')}/>
        {props.approvalCount>0 && <button type="button" className="cognitive-approval-button" aria-label={`${props.approvalCount} beslut behöver dig`} onClick={props.onApprovals}><CircleAlert size={14}/><span>{props.approvalCount} beslut</span></button>}
        <button type="button" aria-label="Sök verktyg och kommandon" title="Sök · Ctrl+Shift+P" onClick={props.onCommands}><Search size={16}/></button>
      </div>
    </header>
    <div className="cognitive-body">
      <nav className="cognitive-rail" aria-label="Projektverktyg">
        <button type="button" onClick={()=>{props.onCanvas('conversation');props.onCloseSidebar();}} aria-label="Visa samtalet" title="Samtal" className={!hasCanvas&&!props.sidePanelOpen?'active':''}><MessageSquare size={19}/></button>
        <span className="cognitive-rail-separator"/>
        {tools.map(([id,Icon,label])=><button key={id} type="button" onClick={()=>props.onSidebar(id)} aria-label={label} title={label} aria-pressed={props.sidePanelOpen&&props.sidebar===id} className={props.sidePanelOpen&&props.sidebar===id?'active':''}><Icon size={18}/>{id==='source-control'&&props.changes>0&&<span className="cognitive-rail-count">{props.changes}</span>}</button>)}
        <div className="cognitive-rail-spacer"/>
        <button type="button" onClick={props.onApprovals} aria-label="Visa beslut som kräver godkännande" title="Godkännanden"><ShieldCheck size={18}/></button>
        <button type="button" onClick={props.onSignOut} aria-label="Logga ut" title="Logga ut"><LogOut size={17}/></button>
      </nav>
      <div className="cognitive-working-area">
        <div className="cognitive-contextbar">
          <div className="cognitive-status" data-tone={props.status.tone} role="status"><span/>{props.status.label}</div>
          <nav className="cognitive-view-tabs" aria-label="Arbetsyta">
            {views.slice(0,4).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>props.onCanvas(id)} aria-label={label} title={label} aria-pressed={props.canvas===id}><Icon size={14}/><span>{label}</span></button>)}
            <details className="cognitive-more-views">
              <summary aria-label="Fler arbetsvyer"><MoreHorizontal size={16}/><span>{views.slice(4).find(view => view[0] === props.canvas)?.[2] || 'Mer'}</span></summary>
              <div>{views.slice(4).map(([id, Icon, label]) => <button key={id} type="button" aria-pressed={props.canvas === id}
                onClick={event => { props.onCanvas(id); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Icon size={16}/>{label}</button>)}</div>
            </details>
          </nav>
        </div>
        {props.error && <div className="cognitive-connection-notice" role="alert"><CircleAlert size={14}/><span>Runtime kan inte nås just nu. Tidigare observationer visas tills anslutningen är tillbaka.</span></div>}
        {props.attention}
        <main className="cognitive-main" data-canvas={hasCanvas}>
          <section className="cognitive-conversation" aria-label="JACO livekonversation">{props.conversation}</section>
          <aside className="cognitive-canvas" hidden={!hasCanvas} aria-label="Aktuell arbetsyta">
            <div className="cognitive-canvas-bar"><span>{views.find(v=>v[0]===props.canvas)?.[2]}</span><button type="button" onClick={()=>props.onCanvas('conversation')} aria-label="Stäng arbetsytan"><PanelRightClose size={16}/></button></div>
            <div className="cognitive-canvas-content">{props.detail}</div>
          </aside>
        </main>
        <footer className="cognitive-footbar"><span><span className="cognitive-footer-dot"/>JACO CODE · Aura</span><span>{props.lastObservedAt ? 'Senast observerat '+new Date(props.lastObservedAt).toLocaleTimeString('sv-SE',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : 'Väntar på första observationen'}</span></footer>
      </div>
      {props.sidePanelOpen&&<>
        <button type="button" className="cognitive-sidebar-scrim" aria-label="Stäng projektpanelen" onClick={props.onCloseSidebar}/>
        <aside className="cognitive-sidebar" aria-label={tools.find(t=>t[0]===props.sidebar)?.[2]}>
          <div className="cognitive-sidebar-header"><span>{tools.find(t=>t[0]===props.sidebar)?.[2]}</span><button type="button" onClick={props.onCloseSidebar} aria-label="Stäng projektpanelen"><X size={16}/></button></div>
          <div className="cognitive-sidebar-content">{props.sidePanel}</div>
        </aside>
      </>}
    </div>
  </div>;
}
