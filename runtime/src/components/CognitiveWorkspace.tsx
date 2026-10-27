import React, { useEffect, useRef } from 'react';
import { MessageSquare, Code2, Eye, ShieldCheck, Folder, GitBranch, Wrench, PlugZap, BookOpen, MonitorSmartphone, Search, CircleDollarSign, CircleAlert, ChevronRight, X, LogOut, Network, Smartphone, MoreHorizontal, Bot, Pin, PinOff } from 'lucide-react';
import { JacoWordmark } from './JacoWordmark';
import { CostChip } from './CostChip';
import { useUiLanguage } from '../i18n/UiLanguage';

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

const EN_LABELS: Record<string, string> = {
  "Samtal": "Conversation",
  "Agenter": "Agents",
  "Kod": "Code",
  "Anslutningar": "Connections",
  "Förhandsvisa": "Preview",
  "Belägg": "Evidence",
  "Spelplan": "Gameboard",
  "Projektfiler": "Project files",
  "Git & ändringar": "Git & changes",
  "Verktyg": "Tools",
  "Färdigheter": "Skills",
  "Modellanslutningar": "Model connections",
  "Enheter": "Devices",
  "Budget & ekonomi": "Budget & spending",
  "Arbete": "Work",
  "Filer": "Files",
  "Mer": "More",
  "Beslut": "Decisions",
  "Sök funktion": "Search commands",
  "Logga ut": "Sign out",
  "Anslutningen behöver återställas": "Connection needs recovery",
  "Ansluter till arbetsytan": "Connecting to workspace",
  "Ett beslut behöver dig": "Decision required",
  "Registrerar uppdrag": "Registering mission",
  "Anropar verktyg": "Calling tools",
  "Väntar på modellens svar": "Waiting for model",
  "Planerar nästa steg": "Planning next step",
  "Arbetar": "Working",
  "Kontrollerar resultat": "Verifying results",
  "Väntar på nästa steg": "Waiting for next step",
  "Uppdrag pågår": "Mission in progress",
  "Ett uppdrag har ett hinder": "Mission blocked",
  "Resultat väntar på kontroll": "Result awaiting verification",
  "Runtime är pausad": "Runtime paused",
  "Redo för ditt uppdrag": "Ready for your mission",
  "Kontrollerar vad som är redo": "Checking readiness",
  "JACO behöver startas": "Start JACO",
  "Anslut en modell för att börja": "Connect a model to begin",
  "Välj en modell som svarar": "Choose a responsive model",
  "Verktygen behöver startas": "Tools need to be started",
  "Agentkörningen behöver kontrolleras": "Agent runtime needs inspection",
  "Status kunde inte hämtas": "Status unavailable"
};

export function CognitiveWorkspace(props:Props) {
  const { language, setLanguage, tr } = useUiLanguage();
  const L = (text: string) => tr(text, EN_LABELS[text] || text);
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
      <button type="button" className="cognitive-project" aria-label={`${tr('Öppna projekt', 'Open project')}: ${props.projectName}`} onClick={()=>openPanel('explorer')}><Folder size={14}/><span>{props.projectName}</span><ChevronRight size={12}/><span className="cognitive-branch">{props.branch || tr('Projekt', 'Project')}</span></button>
      <div className="cognitive-top-actions">
        <CostChip onOpen={()=>props.onSidebar('providers')}/>
        <select className="cognitive-language-select" aria-label={tr('Språk', 'Language')} title={tr('Språk', 'Language')} value={language} onChange={event => setLanguage(event.target.value === 'sv' ? 'sv' : 'en')} style={{color:'inherit',background:'#171d24',border:'1px solid #3b4652',borderRadius:6,padding:'4px 5px',fontSize:11}}><option value="en">EN</option><option value="sv">SV</option></select>
        {props.approvalCount>0 && <button type="button" className="cognitive-approval-button" aria-label={`${props.approvalCount} ${tr('beslut behöver dig', 'decisions need your attention')}`} onClick={props.onApprovals}><CircleAlert size={14}/><span>{props.approvalCount} {tr('beslut','decisions')}</span></button>}
        <button type="button" aria-label={tr('Sök verktyg och kommandon', 'Search tools and commands')} title={tr('Sök', 'Search')+' · Ctrl+Shift+P'} onClick={props.onCommands}><Search size={16}/></button>
      </div>
    </header>
    <div className="cognitive-body">
      <nav className="cognitive-rail" aria-label={tr('Projektverktyg', 'Project tools')}>
        <button type="button" onClick={()=>{props.onCanvas('conversation');props.onCloseSidebar();}} aria-label={tr('Visa samtalet', 'Show conversation')} title={L('Samtal')} className={!showStage&&!props.sidePanelOpen?'active':''}><MessageSquare size={19}/></button>
        <span className="cognitive-rail-separator"/>
        {tools.map(([id,Icon,label])=><button key={id} type="button" onClick={()=>props.onSidebar(id)} aria-label={L(label)} title={L(label)} aria-pressed={props.sidePanelOpen&&props.sidebar===id} className={props.sidePanelOpen&&props.sidebar===id?'active':''}><Icon size={18}/>{id==='source-control'&&props.changes>0&&<span className="cognitive-rail-count">{props.changes}</span>}</button>)}
        <div className="cognitive-rail-spacer"/>
        <button type="button" onClick={props.onApprovals} aria-label={tr('Visa beslut som kräver godkännande', 'Show decisions requiring approval')} title={tr('Godkännanden', 'Approvals')}><ShieldCheck size={18}/></button>
        <button type="button" onClick={props.onSignOut} aria-label={L('Logga ut')} title={L('Logga ut')}><LogOut size={17}/></button>
      </nav>
      <div className="cognitive-working-area">
        <div className="cognitive-contextbar">
          {props.status.tone !== 'idle' && <div className="cognitive-status" data-tone={props.status.tone} role="status"><span/>{L(props.status.label)}</div>}
          <nav className="cognitive-stage-switcher" aria-label={tr('Arbetsyta','Workspace')}>
            {([['stage', Eye, 'Arbete'], ['code', Code2, 'Kod'], ['preview', Eye, 'Förhandsvisa'], ['evidence', ShieldCheck, 'Belägg']] as const).map(([view, Icon, label]) =>
              <button key={view} type="button" title={L(label)+' · Ctrl/Cmd+Shift+'+({stage:1,code:2,preview:3,evidence:4} as Record<string,number>)[view]} aria-pressed={props.canvas===view || (view==='stage' && props.canvas==='conversation')} onClick={()=>props.onCanvas(view)}><Icon size={14}/><span>{L(label)}</span></button>)}
          </nav>
          <button type="button" className="cognitive-mobile-focus" onClick={()=>props.onCanvas(showStage?'conversation':'stage')}>
            {showStage ? <MessageSquare size={15}/> : <Eye size={15}/>}
            {showStage ? tr('Visa samtalet','Show conversation') : tr('Visa Auras arbete','Show Aura’s work')}
          </button>
        </div>
        {props.error && <div className="cognitive-connection-notice" role="alert"><CircleAlert size={14}/><span>{tr('Runtime kan inte nås just nu. Tidigare observationer visas tills anslutningen är tillbaka.','Runtime is currently unreachable. Earlier observations remain visible until the connection returns.')}</span></div>}
        {props.attention}
        <main className="cognitive-main" data-canvas="true" data-focus={showStage?'stage':'conversation'}>
          <section className="cognitive-conversation" aria-label={tr('Aura-konversation','Aura conversation')}>{props.conversation}</section>
          <aside className="cognitive-canvas" aria-label="Aura Live Workspace">
            <div className="cognitive-canvas-bar">
              <span>{hasDetail ? (L(views.find(v=>v[0]===props.canvas)?.[2] || 'Arbetsyta')) : tr('Auras arbete','Aura’s work')}</span>
              <div className="cognitive-stage-actions">
                {hasDetail ? <button type="button" onClick={()=>{if(props.stagePinned)props.onTogglePin();props.onCanvas('stage');}} aria-label={tr('Återgå till Auras arbete','Return to Aura’s work')}>{tr('Visa senaste arbetet','Show latest work')}</button>
                  : <button type="button" onClick={props.onTogglePin} aria-pressed={props.stagePinned} aria-label={props.stagePinned?tr('Följ nytt arbete','Follow new work'):tr('Fäst visat resultat','Pin visible result')} title={props.stagePinned?tr('Följ Auras arbete','Follow Aura’s work'):tr('Behåll detta resultat','Keep this result')}>{props.stagePinned?<><PinOff size={15}/><span>{tr('Följ arbetet','Follow work')}</span></>:<><Pin size={15}/><span>{tr('Fäst resultat','Pin result')}</span></>}</button>}
              </div>
            </div>
            <div className="cognitive-canvas-content">{hasDetail?props.detail:props.stage}</div>
          </aside>
        </main>
        <footer className="cognitive-footbar"><span><span className="cognitive-footer-dot"/>JACO CODE · Aura</span><span>{props.lastObservedAt ? tr('Senast observerat','Last observed')+' '+new Date(props.lastObservedAt).toLocaleTimeString(language === 'sv' ? 'sv-SE' : 'en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'}) : tr('Väntar på första observationen', 'Waiting for first observation')}</span></footer>
      </div>
      {props.sidePanelOpen&&<>
        <button type="button" className="cognitive-sidebar-scrim" aria-label={tr('Stäng projektpanelen','Close project panel')} onClick={props.onCloseSidebar}/>
        <aside className="cognitive-sidebar" aria-label={L(tools.find(t=>t[0]===props.sidebar)?.[2] || '')}>
          <div className="cognitive-sidebar-header"><span>{tools.find(t=>t[0]===props.sidebar)?.[2]}</span><button type="button" onClick={props.onCloseSidebar} aria-label="Stäng projektpanelen"><X size={16}/></button></div>
          <div className="cognitive-sidebar-content">{props.sidePanel}</div>
        </aside>
      </>}
    </div>
    <nav className="cognitive-mobile-nav" aria-label={tr('Mobilnavigation','Mobile navigation')}>
      {([['conversation', MessageSquare, 'Samtal'], ['stage', Eye, 'Arbete'], ['agents', Bot, 'Agenter']] as const).map(([id, Icon, label]) =>
        <button key={id} type="button" aria-pressed={!props.sidePanelOpen && props.canvas===id} onClick={()=>navigate(id)}><Icon size={21}/><span>{L(label)}</span></button>)}
      <button type="button" aria-pressed={props.sidePanelOpen && props.sidebar==='explorer'} onClick={()=>openPanel('explorer')}><Folder size={21}/><span>{L('Filer')}</span></button>
      <button type="button" aria-label={tr('Fler funktioner','More features')} onClick={()=>menu.current?.showModal()}><MoreHorizontal size={21}/><span>{L('Mer')}</span></button>
    </nav>
    <dialog ref={menu} className="cognitive-mobile-menu" aria-labelledby="mobile-menu-title" onClick={event=>{if(event.target===event.currentTarget)menu.current?.close();}}>
      <div className="cognitive-mobile-menu-body">
        <header><h2 id="mobile-menu-title">{tr('Din arbetsyta','Your workspace')}</h2><button type="button" aria-label={tr('Stäng menyn','Close menu')} onClick={()=>menu.current?.close()}><X size={21}/></button></header>
        <p>{tr('Modeller, verktyg och projektinställningar','Models, tools and project settings')}</p>
        <div className="cognitive-mobile-menu-grid">
          {views.filter(([id])=>!['conversation','agents'].includes(id)).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>navigate(id)}><Icon size={20}/>{L(label)}</button>)}
          {tools.filter(([id])=>['source-control','devices','revenue'].includes(id)).map(([id,Icon,label])=><button key={id} type="button" onClick={()=>openPanel(id)}><Icon size={20}/>{label}</button>)}
          <button type="button" onClick={()=>{menu.current?.close();props.onApprovals();}}><ShieldCheck size={20}/>{L('Beslut')}{props.approvalCount>0 ? ` (${props.approvalCount})` : ''}</button>
          <button type="button" onClick={()=>{menu.current?.close();props.onCommands();}}><Search size={20}/>{L('Sök funktion')}</button>
          <button type="button" onClick={()=>{menu.current?.close();props.onSignOut();}}><LogOut size={20}/>{L('Logga ut')}</button>
        </div>
      </div>
    </dialog>
  </div>;
}
