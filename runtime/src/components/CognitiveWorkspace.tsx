import React, { useEffect, useRef } from 'react';
import { MessageSquare, Code2, Eye, ShieldCheck, Folder, GitBranch, Wrench, PlugZap, BookOpen, MonitorSmartphone, Search, CircleDollarSign, CircleAlert, ChevronRight, X, LogOut, Network, Smartphone, MoreHorizontal, Bot, Pin, PinOff } from 'lucide-react';
import { JacoWordmark } from './JacoWordmark';
import { CostChip } from './CostChip';

export type CognitiveCanvas='conversation'|'stage'|'agents'|'code'|'preview'|'evidence'|'gameboard'|'voice'|'connections';
type Sidebar='explorer'|'source-control'|'tools'|'skills'|'devices'|'providers'|'revenue';
interface Props {
  canvas:CognitiveCanvas;onCanvas:(view:CognitiveCanvas)=>void;conversation:React.ReactNode;detail:React.ReactNode;
  stage:React.ReactNode;stagePinned:boolean;onTogglePin:()=>void;
  sidePanel:React.ReactNode;sidebar:Sidebar;sidePanelOpen:boolean;onSidebar:(view:Sidebar)=>void;onCloseSidebar:()=>void;
  status:{label:string;tone:string};projectName:string;branch?:string|null;changes:number;
  approvalCount:number;onApprovals:()=>void;onCommands:()=>void;onSignOut:()=>void;
  lastObservedAt:string|null;error:string|null;
  attention?:React.ReactNode;
}
const views=[['conversation',MessageSquare,'Samtal'],['agents',Bot,'Agenter'],['code',Code2,'Kod'],['connections',PlugZap,'Anslutningar'],['preview',Eye,'Förhandsvisa'],['evidence',ShieldCheck,'Belägg'],['gameboard',Network,'Spelplan'],['voice',Smartphone,'WhatsApp']] as const;
const tools=[['explorer',Folder,'Projektfiler'],['source-control',GitBranch,'Git & ändringar'],['tools',Wrench,'Verktyg'],['skills',BookOpen,'Färdigheter'],['providers',PlugZap,'Modellanslutningar'],['devices',MonitorSmartphone,'Enheter'],['revenue',CircleDollarSign,'Budget & ekonomi']] as const;

export function CognitiveWorkspace(props:Props) {
  const menu = useRef<HTMLDialogElement>(null);
  // Desktop shortcuts are intentionally inactive while composing chat, editing
  // code or using another control. No agent authority is changed by navigation.
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !event.ctrlKey && !event.metaKey || event.altKey || !event.shiftKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"], .monaco-editor, dialog[open]'))) return;
      const views: Record<string, CognitiveCanvas> = { Digit1: 'stage', Digit2: 'code', Digit3: 'preview', Digit4: 'evidence' };
      const view = views[event.code];
      if (!view) return;
      event.preventDefault();
      props.onCanvas(view);
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, [props.onCanvas]);
  const navigate = (view:CognitiveCanvas) => { props.onCloseSidebar(); props.onCanvas(view); menu.current?.close(); };
  const openPanel = (view:Sidebar) => { props.onSidebar(view); menu.current?.close(); };
  const hasDetail=props.canvas!=='conversation' && props.canvas!=='stage';
  const showStage=props.canvas!=='conversation';
  return <div className="cognitive-workspace" data-cognitive-workspace="true">
    <header className="cognitive-topbar">
      <div className="cognitive-brand"><JacoWordmark/><span className="cognitive-brand-divider"/><span className="cognitive-product">Aura</span></div>
      <button type="button" className="cognitive-project" aria-label={`Öppna projekt: ${props.projectName}`} onClick={()=>openPanel('explorer')}><Folder size={14}/><span>{props.projectName}</span><ChevronRight size={12}/><span className="cognitive-branch">{props.branch || 'Projekt'}</span></button>
      <div className="cognitive-top-actions">
        <CostChip onOpen={()=>props.onSidebar('providers')}/>
        {props.approvalCount>0 && <button type="button" className="cognitive-approval-button" aria-label={`${props.approvalCount} beslut behöver dig`} onClick={props.onApprovals}><CircleAlert size={14}/><span>{props.approvalCount} beslut</span></button>}
        <button type="button" aria-label="Sök verktyg och kommandon" title="Sök · Ctrl+Shift+P" onClick={props.onCommands}><Search size={16}/></button>
      </div>
    </header>
    <div className="cognitive-body">
      <nav className="cognitive-rail" aria-label="Projektverktyg">
        <button type="button" onClick={()=>{props.onCanvas('conversation');props.onCloseSidebar();}} aria-label="Visa samtalet" title="Samtal" className={!showStage&&!props.sidePanelOpen?'active':''}><MessageSquare size={19}/></button>
        <span className="cognitive-rail-separator"/>
        {tools.map(([id,Icon,label])=><button key={id} type="button" onClick={()=>props.onSidebar(id)} aria-label={label} title={label} aria-pressed={props.sidePanelOpen&&props.sidebar===id} className={props.sidePanelOpen&&props.sidebar===id?'active':''}><Icon size={18}/>{id==='source-control'&&props.changes>0&&<span className="cognitive-rail-count">{props.changes}</span>}</button>)}
        <div className="cognitive-rail-spacer"/>
        <button type="button" onClick={props.onApprovals} aria-label="Visa beslut som kräver godkännande" title="Godkännanden"><ShieldCheck size={18}/></button>
        <button type="button" onClick={props.onSignOut} aria-label="Logga ut" title="Logga ut"><LogOut size={17}/></button>
      </nav>
      <div className="cognitive-working-area">
        <div className="cognitive-contextbar">
          <div className="cognitive-status" data-tone={props.status.tone} role="status"><span/>{props.status.label}</div>
          <nav className="cognitive-stage-switcher" aria-label="Arbetsyta">
            {([['stage', Eye, 'Arbete'], ['code', Code2, 'Kod'], ['preview', Eye, 'Förhandsvisa'], ['evidence', ShieldCheck, 'Belägg']] as const).map(([view, Icon, label]) =>
              <button key={view} type="button" title={label+' · Ctrl/Cmd+Shift+'+({stage:1,code:2,preview:3,evidence:4} as Record<string,number>)[view]} aria-pressed={props.canvas===view || (view==='stage' && props.canvas==='conversation')} onClick={()=>props.onCanvas(view)}><Icon size={14}/><span>{label}</span></button>)}
          </nav>
          <button type="button" className="cognitive-mobile-focus" onClick={()=>props.onCanvas(showStage?'conversation':'stage')}>
            {showStage ? <MessageSquare size={15}/> : <Eye size={15}/>}
            {showStage ? 'Visa samtalet' : 'Visa Auras arbete'}
          </button>
        </div>
        {props.error && <div className="cognitive-connection-notice" role="alert"><CircleAlert size={14}/><span>Runtime kan inte nås just nu. Tidigare observationer visas tills anslutningen är tillbaka.</span></div>}
        {props.attention}
        <main className="cognitive-main" data-canvas="true" data-focus={showStage?'stage':'conversation'}>
          <section className="cognitive-conversation" aria-label="Aura-konversation">{props.conversation}</section>
          <aside className="cognitive-canvas" aria-label="Aura Live Workspace">
            <div className="cognitive-canvas-bar">
              <span>{hasDetail ? (views.find(v=>v[0]===props.canvas)?.[2] || 'Arbetsyta') : 'Auras arbete'}</span>
              <div className="cognitive-stage-actions">
                {hasDetail ? <button type="button" onClick={()=>{if(props.stagePinned)props.onTogglePin();props.onCanvas('stage');}} aria-label="Återgå till Auras arbete">Visa senaste arbetet</button>
                  : <button type="button" onClick={props.onTogglePin} aria-pressed={props.stagePinned} aria-label={props.stagePinned?'Följ nytt arbete':'Fäst visat resultat'} title={props.stagePinned?'Följ Auras arbete':'Behåll detta resultat'}>{props.stagePinned?<><PinOff size={15}/><span>Följ arbetet</span></>:<><Pin size={15}/><span>Fäst resultat</span></>}</button>}
              </div>
            </div>
            <div className="cognitive-canvas-content">{hasDetail?props.detail:props.stage}</div>
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
    <nav className="cognitive-mobile-nav" aria-label="Mobilnavigation">
      {([['conversation', MessageSquare, 'Samtal'], ['stage', Eye, 'Arbete'], ['agents', Bot, 'Agenter']] as const).map(([id, Icon, label]) =>
        <button key={id} type="button" aria-pressed={!props.sidePanelOpen && props.canvas===id} onClick={()=>navigate(id)}><Icon size={21}/><span>{label}</span></button>)}
      <button type="button" aria-pressed={props.sidePanelOpen && props.sidebar==='explorer'} onClick={()=>openPanel('explorer')}><Folder size={21}/><span>Filer</span></button>
      <button type="button" aria-label="Fler funktioner" onClick={()=>menu.current?.showModal()}><MoreHorizontal size={21}/><span>Mer</span></button>
    </nav>
    <dialog ref={menu} className="cognitive-mobile-menu" aria-labelledby="mobile-menu-title" onClick={event=>{if(event.target===event.currentTarget)menu.current?.close();}}>
      <div className="cognitive-mobile-menu-body">
        <header><h2 id="mobile-menu-title">Din arbetsyta</h2><button type="button" aria-label="Stäng menyn" onClick={()=>menu.current?.close()}><X size={21}/></button></header>
        <p>Modeller, verktyg och projektinställningar</p>
        <div className="cognitive-mobile-menu-grid">
          {views.filter(([id])=>!['conversation','agents'].includes(id)).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>navigate(id)}><Icon size={20}/>{label}</button>)}
          {tools.filter(([id])=>['source-control','devices','revenue'].includes(id)).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>openPanel(id)}><Icon size={20}/>{label}</button>)}
          <button type="button" onClick={()=>{menu.current?.close();props.onApprovals();}}><ShieldCheck size={20}/>Beslut{props.approvalCount>0 ? ` (${props.approvalCount})` : ''}</button>
          <button type="button" onClick={()=>{menu.current?.close();props.onCommands();}}><Search size={20}/>Sök funktion</button>
          <button type="button" onClick={()=>{menu.current?.close();props.onSignOut();}}><LogOut size={20}/>Logga ut</button>
        </div>
      </div>
    </dialog>
  </div>;
}
