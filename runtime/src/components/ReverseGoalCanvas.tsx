import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Focus, Maximize2, Minus, Plus, ShieldCheck, GitBranch, AlertTriangle } from 'lucide-react';
import { useUiLanguage } from '../i18n/UiLanguage';
import { reverseGoalLayout, REVERSE_GOAL_ROOT } from '../lib/reverseGoalLayout.mjs';

type Step = { key:string;title:string;objective:string;status:string;statusText:string;dependencies:string[];missionId?:string|null;evidenceRefs?:string[] };
type Plan = { id:string;objective:string;status:string;progress:{done:number;total:number};nodes:Step[];changes?:Array<{reason?:string|null}> };
type LayoutNode = {id:string;kind:'intuition'|'step';title:string;status:string;rawStatus:string;missionId:string|null;evidenceCount:number;childCount:number;collapsed:boolean;x:number;y:number;width:number;height:number};
type LayoutEdge = {id:string;from:string;to:string;status:'active'|'verified'|'pending';source:LayoutNode;target:LayoutNode};
type Layout = {schema:string;width:number;height:number;nodes:LayoutNode[];edges:LayoutEdge[];activeCount:number;reportedActiveCount:number;executionFresh:boolean;totalSteps:number;visibleSteps:number;revisionCount:number;hiddenSuperseded:number;activeOnly:boolean;activePathsObserved:boolean};

const CANVAS_STYLE = String.raw`
.jaco-intuition-canvas{position:relative;border:1px solid #30343a;border-radius:14px;background:radial-gradient(ellipse at 50% 4%,rgba(25,63,106,.16),transparent 65%),#05070c;overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y;min-height:320px;max-height:min(70vh,920px);scrollbar-color:#4b5563 transparent}
.jaco-intuition-stage{position:relative;transform-origin:top left;user-select:none}
.jaco-intuition-node{position:absolute;display:flex;flex-direction:column;justify-content:center;gap:4px;overflow:hidden;white-space:normal;text-align:center;padding:9px 12px;background:#080b11;border:1px solid rgba(255,255,255,.74);border-radius:12px;color:#fff;cursor:pointer;transition:border-color .22s,background-color .22s;box-shadow:0 5px 20px rgba(0,0,0,.28)}
.jaco-intuition-node:hover,.jaco-intuition-node:focus-visible{outline:2px solid #9ebdff;outline-offset:2px}
.jaco-intuition-node[data-state="active"]{border-color:#56a5ff;box-shadow:0 0 0 1px rgba(65,149,255,.3),0 0 19px rgba(60,134,240,.26);animation:jaco-intuition-nodepulse 3s ease-in-out infinite}
.jaco-intuition-node[data-state="verified"]{border:2px solid #60a5fa;background:#0d1b30}
.jaco-intuition-node[data-state="reported"],.jaco-intuition-node[data-state="stale"]{border-style:dashed;border-color:#cbd5e1}
.jaco-intuition-node[data-state="failed"]{border-color:#fb7185}
.jaco-intuition-node[data-state="approval"]{border-color:#fbbf24}
.jaco-intuition-node[data-state="intuition"]{border:2px solid #94bfff;background:#102038;box-shadow:0 0 28px rgba(40,120,220,.24)}
.jaco-intuition-line{fill:none;stroke:rgba(255,255,255,.78);stroke-width:1.6}
.jaco-intuition-line[data-state="verified"]{stroke:#60a5fa;stroke-width:2.4}
.jaco-intuition-line[data-state="active"]{stroke:#5398ef;stroke-width:2.8;stroke-dasharray:7 9;filter:drop-shadow(0 0 3px rgba(74,146,240,.62));animation:jaco-intuition-edgepulse 3.4s linear infinite}
@keyframes jaco-intuition-nodepulse{0%,100%{box-shadow:0 0 0 1px rgba(65,149,255,.23),0 0 10px rgba(60,134,240,.16)}50%{box-shadow:0 0 0 1px rgba(65,149,255,.42),0 0 25px rgba(60,134,240,.38)}}
@keyframes jaco-intuition-edgepulse{0%{stroke-dashoffset:0;opacity:.5}50%{opacity:1}100%{stroke-dashoffset:-64;opacity:.5}}
.jaco-intuition-expand{position:absolute;width:25px;height:25px;display:grid;place-items:center;border:1px solid #526174;border-radius:50%;background:#101822;color:#e2e8f0;font-size:16px;z-index:2}
.jaco-intuition-expand:focus-visible{outline:2px solid #9ebdff}
@media(prefers-reduced-motion:reduce){.jaco-intuition-line[data-state="active"],.jaco-intuition-node[data-state="active"]{animation:none;stroke-dasharray:none}}
`;

const clamp = (n:number) => Math.max(.4,Math.min(1.45,Math.round(n*100)/100));

export function ReverseGoalCanvas({
  plan,waitingOn,onSelect,onGoal,executionFresh=true,
}:{
  plan:Plan;waitingOn:Set<string>;onSelect:(key:string)=>void;onGoal:()=>void;executionFresh?:boolean;
}) {
  const {tr} = useUiLanguage();
  const [zoom,setZoom]=useState(1);
  const [collapsed,setCollapsed]=useState<string[]>([]);
  const [activeOnly,setActiveOnly]=useState(false);
  const viewport=useRef<HTMLDivElement|null>(null);
  const drag=useRef<{x:number;y:number;left:number;top:number;pointerId:number}|null>(null);
  const [problem,setProblem]=useState<string|null>(null);
  const layout=useMemo(()=>{
    try {
      const value=reverseGoalLayout(plan,{collapsed,activeOnly,waitingMissionIds:[...waitingOn],executionFresh}) as Layout;
      return value;
    } catch(error:any) {
      return {error:String(error?.message||error)} as {error:string};
    }
  },[plan,collapsed,activeOnly,waitingOn,executionFresh]);
  const ready = 'nodes' in layout ? layout as Layout : null;
  const error = 'error' in layout ? layout.error : null;
  // The root must visually share the logo's exact center regardless of how
  // wide the SEER graph happens to be. Zoom-to-fit applies only when the
  // selected goal changes, never on receipt updates.
  useEffect(()=>{
    const v=viewport.current;if(!v||!ready)return;
    setZoom(clamp(Math.min(1,(v.clientWidth-32)/ready.width,(v.clientHeight-24)/ready.height)));
    v.scrollTo({left:0,top:0});
  },[plan.id,Boolean(ready)]);
  const focus = (id:string) => {
    const current=viewport.current;
    const node=ready?.nodes.find(n=>n.id===id);
    if(!current||!node)return;
    current.scrollTo({
      left:Math.max(0,(node.x+node.width/2)*zoom-current.clientWidth/2),
      top:Math.max(0,(node.y+node.height/2)*zoom-current.clientHeight/2),
      behavior:'smooth',
    });
  };
  useEffect(()=>{setCollapsed([]);setActiveOnly(false);setZoom(1);},[plan.id]);
  const fit=()=> {
    const v=viewport.current;
    if(!v||!ready)return;
    const next=clamp(Math.min(1,(v.clientWidth-32)/ready.width,(v.clientHeight-22)/ready.height));
    setZoom(next);
    v.scrollTo({left:0,top:0});
  };
  const statusText=(n:LayoutNode)=>{
    if(n.status==='active')return tr('Arbete pågår','Work in progress');
    if(n.status==='stale')return tr('Senast aktiv · läget är inte bekräftat','Previously active · status not confirmed');
    if(n.status==='verified')return tr('Verifierad · kvitto finns','Verified · receipt attached');
    if(n.status==='reported')return tr('Rapporterat klart · kvitto saknas','Reported done · receipt missing');
    if(n.status==='approval')return tr('Väntar på ditt godkännande','Awaiting your approval');
    if(n.status==='failed')return tr('Misslyckades','Failed');
    if(n.status==='blocked')return tr('Väntar på beroenden','Waiting on dependencies');
    return tr('Ännu inte aktiv','Not active yet');
  };
  return <section aria-label={tr('Levande intuitionsträd','Living intuition tree')} data-testid="living-gameboard" className="space-y-3">
    <style>{CANVAS_STYLE}</style>
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-[#101419] px-3 py-2">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-300">
        <span><strong className="text-white">{plan.progress.done}/{plan.progress.total}</strong> {tr('rapporterade verifierade steg','reported verified steps')}</span>
        <span className="text-sky-300">{ready?.activeCount??0} {tr('aktiva','active')}</span>
        <span>{ready?.revisionCount??0} {tr('omplaneringar','replans')}</span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" aria-pressed={activeOnly} onClick={()=>setActiveOnly(v=>!v)} className={'rounded px-2 py-1 text-xs '+(activeOnly?'bg-blue-950 text-blue-100':'bg-[#25282e] text-neutral-200')} title={tr('Visa bara aktiva vägar','Show active paths only')}>{tr('Aktiv gren','Active branch')}</button>
        <button type="button" aria-label={tr('Zooma ut','Zoom out')} onClick={()=>setZoom(v=>clamp(v-.15))} className="rounded border border-neutral-700 p-1.5"><Minus size={14}/></button>
        <output aria-label={tr('Zoom','Zoom')} className="w-11 text-center text-[11px] tabular-nums">{Math.round(zoom*100)}%</output>
        <button type="button" aria-label={tr('Zooma in','Zoom in')} onClick={()=>setZoom(v=>clamp(v+.15))} className="rounded border border-neutral-700 p-1.5"><Plus size={14}/></button>
        <button type="button" aria-label={tr('Anpassa hela trädet','Fit entire tree')} onClick={fit} className="rounded border border-neutral-700 p-1.5"><Maximize2 size={14}/></button>
        <button type="button" aria-label={tr('Fokusera aktivt steg','Focus active step')} onClick={()=>{const id=ready?.nodes.find(n=>n.status==='active')?.id;if(id){focus(id);setProblem(null);}else setProblem(tr('Inget aktivt steg observerat.','No active step observed.'));}} className="rounded border border-neutral-700 p-1.5"><Focus size={14}/></button>
      </div>
    </div>
    {error && <p role="alert" className="rounded border border-rose-800 p-3 text-xs text-rose-300">{tr('Beroendegrafen kunde inte visas utan att förvanska data:','Dependency graph cannot be rendered without distorting data:')} {error}</p>}
    {problem && <p role="status" className="text-xs text-neutral-300">{problem}</p>}
    {!executionFresh && <p role="status" data-testid="gameboard-stale-warning" className="rounded border border-amber-900 p-2 text-xs text-amber-200">{tr('Planen kommer från senaste kända observation. Runtime kan inte bekräfta aktuell exekvering; därför har aktiv pulsering stoppats.','Last known plan. Runtime cannot confirm current execution; active pulses have stopped.')}</p>}
    {ready && <>
      <div ref={viewport} className="jaco-intuition-canvas" data-testid="intuition-viewport"
        onPointerDown={event=>{
          if(event.pointerType==='touch'||(event.target as HTMLElement).closest('button')||event.button!==0)return;
          drag.current={x:event.clientX,y:event.clientY,left:event.currentTarget.scrollLeft,top:event.currentTarget.scrollTop,pointerId:event.pointerId};
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event=>{
          const d=drag.current;if(!d||d.pointerId!==event.pointerId)return;
          event.currentTarget.scrollLeft=d.left+d.x-event.clientX;
          event.currentTarget.scrollTop=d.top+d.y-event.clientY;
        }}
        onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
      >
        <div style={{width:'max-content',minWidth:'100%',display:'flex',justifyContent:'center'}}>
          <div style={{width:ready.width*zoom,height:ready.height*zoom,position:'relative',flexShrink:0}}>
          <div className="jaco-intuition-stage" style={{width:ready.width,height:ready.height,transform:'scale('+zoom+')'}}>
            <svg aria-hidden="true" width={ready.width} height={ready.height} style={{position:'absolute',inset:0,pointerEvents:'none'}}>
              {ready.edges.map(e=>{
                const sx=e.source.x+e.source.width/2,sy=e.source.y+e.source.height,tx=e.target.x+e.target.width/2,ty=e.target.y;
                const mid=(sy+ty)/2;
                return <path key={e.id} data-edge-state={e.status} className="jaco-intuition-line" data-state={e.status} d={'M '+sx+' '+sy+' C '+sx+' '+mid+', '+tx+' '+mid+', '+tx+' '+ty}/>;
              })}
            </svg>
            {ready.nodes.map(n=><React.Fragment key={n.id}>
              <button type="button" aria-label={(n.kind==='intuition'?tr('Intuition: ','Intuition: '):'')+n.title}
                data-testid={n.kind==='intuition'?'intuition-root':'intuition-step'} data-node-id={n.id} data-status={n.status} data-evidence-count={n.evidenceCount}
                className="jaco-intuition-node" style={{left:n.x,top:n.y,width:n.width,height:n.height}}
                data-state={n.status} onClick={()=>n.kind==='intuition'?onGoal():onSelect(n.id)}>
                {n.kind==='intuition' && <span className="text-[10px] font-bold tracking-[.2em] text-blue-200">INTUITION</span>}
                {n.kind!=='intuition' && <span className={'text-[10px] uppercase tracking-wide '+(n.status==='active'?'text-blue-300':'text-neutral-400')}>{statusText(n)}</span>}
                <strong className="line-clamp-2 text-[12px] leading-snug">{n.title||tr('Mål utan beskrivning','Goal without description')}</strong>
                {n.kind==='step'&&n.evidenceCount>0&&<span className="flex items-center justify-center gap-1 text-[10px] text-blue-200"><ShieldCheck size={11}/>{n.evidenceCount} {tr('kvitton','receipts')}</span>}
              </button>
              {n.kind==='step'&&n.childCount>0&&<button type="button"
                aria-label={(n.collapsed?tr('Expandera beroenden för ','Expand dependencies for '):tr('Minimera beroenden för ','Collapse dependencies for '))+n.title}
                aria-expanded={!n.collapsed} className="jaco-intuition-expand"
                style={{left:n.x+n.width/2-12,top:n.y+n.height-9}}
                onClick={()=>setCollapsed(v=>v.includes(n.id)?v.filter(k=>k!==n.id):[...v,n.id])}>
                {n.collapsed?<ChevronDown size={14}/>:<ChevronUp size={14}/>}
              </button>}
            </React.Fragment>)}
          </div>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-400" aria-label={tr('Statusförklaring','Status legend')}>
        <span><span className="text-white">━━</span> {tr('Väntande','Pending')}</span>
        <span><span className="text-sky-400">━━</span> {tr('Pulserar: aktivt','Pulsing: active')}</span>
        <span><span className="text-blue-300">━━</span> {tr('Fast blå: verifierat','Solid blue: verified')}</span>
        <span><AlertTriangle size={11} className="inline text-amber-300"/> {tr('Kräver insyn','Needs review')}</span>
        <span className="ml-auto">{ready.visibleSteps}/{ready.totalSteps} {tr('synliga delsteg','visible steps')}</span>
      </div>
      {activeOnly&&!ready.activePathsObserved&&<p role="status" className="text-xs text-neutral-300">{tr('Inga aktiva steg har observerats. Det finns ingen aktiv väg att rita.','No active steps observed. No active path can be drawn.')}</p>}
      {ready.hiddenSuperseded>0&&<p className="flex items-center gap-1 text-xs text-neutral-400"><GitBranch size={12}/>{ready.hiddenSuperseded} {tr('ersatta eller avbrutna steg visas i planhistoriken, inte som pågående arbete.','replaced or cancelled steps remain in plan history, not active execution.')}</p>}
    </>}
  </section>;
}
