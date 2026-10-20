import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CircleDot, Network, ZoomIn, ZoomOut, ArrowUpRight } from 'lucide-react';
import { layoutAgentNetwork } from '../lib/agentNetworkLayout.mjs';

export interface NetworkNode {
  id:string;kind:'coordinator'|'agent'|'worker'|'task-agent';name:string;role:string;parentId:string|null;
  status:string;purpose:string|null;model:string|null;source:string;missionIds:string[];planIds:string[];lastSeenAt:string|null;
  executorId?:string|null;dependencies?:string[];blocker?:string|null;
  nextSteps?:Array<{title:string;objective:string}>;
  receipts?:Array<{actionId:string|null;type:string|null;ok:boolean;verified:boolean;outcomeUnknown:boolean;error:string|null}>;
}
export interface AgentNetworkSnapshot {
  schema:string;observedAt:string;coordinatorId:string;nodes:NetworkNode[];
  links:Array<{from:string;to:string;kind:'connection'|'delegation'|'dependency'|'execution'}>;
  plans:Array<{id:string;title:string;objective:string;status:string;agentIds:string[];replans:Array<{reason:string;from:string;to:string}>}>;
  planningAvailable:boolean;coordinatorAvailable:boolean;truncated:boolean;
}
const kindLabel={coordinator:'Samordnare',agent:'Ansluten agent',worker:'Körprocess','task-agent':'Uppdragsagent'};
const labels:Record<string,string>={CONNECTED:'I kontakt',UNAVAILABLE:'Inte nåbar',OFFLINE:'Frånkopplad',READY:'Redo',AVAILABLE:'Tillgänglig',IDLE:'Vilar',BUSY:'Rapporterar arbete',ACTIVE:'Aktiv',BLOCKED:'Väntar på förutsättning',DISPATCHED:'Tilldelad för körning',RUNNING:'Arbetar',PLANNING:'Planerar',EXECUTING:'Arbetar',VERIFIED:'Verifierad',DONE:'Avslutad',FAILED:'Misslyckad',SUPERSEDED:'Ersatt av underplan',CANCELLED:'Avbruten',NEEDS_REPLAN:'Omplanering behövs',AWAITING_VERIFICATION:'Väntar på kontroll',EXHAUSTED:'Gränsen nådd'};
const tone=(status:string)=>['RUNNING','BUSY','ACTIVE','EXECUTING','PLANNING'].includes(status)?'active':['VERIFIED','DONE','CONNECTED','READY','AVAILABLE'].includes(status)?'ready':['BLOCKED','FAILED','UNAVAILABLE','NEEDS_REPLAN','EXHAUSTED'].includes(status)?'waiting':'quiet';
const statusText=(status:string)=>labels[status]||'Tillstånd ej tolkat';

export function AgentConstellation({network,error,onSelectMission,memory=[]}:{network:AgentNetworkSnapshot|null;error:string|null;onSelectMission:(id:string)=>void;memory?:Array<{id:string;kind:string;body:string;at:string|null}>}) {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [planId,setPlanId]=useState('');
  const [page,setPage]=useState(0);
  const [zoom,setZoom]=useState(0.75);
  const scrollRef=useRef<HTMLDivElement>(null);
  const detailRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(selectedId && window.matchMedia('(max-width:1100px)').matches) detailRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});
  },[selectedId]);
  const marker=useId().replace(/:/g,'');
  const selected=network?.nodes.find(n=>n.id===selectedId)||network?.nodes.find(n=>n.id===network.coordinatorId)||null;
  const filtered=useMemo(()=>network?.nodes.filter(node=>node.id!==network.coordinatorId && (!planId||node.planIds.includes(planId)) && `${node.name} ${node.role} ${node.purpose||''}`.toLocaleLowerCase('sv-SE').includes(query.toLocaleLowerCase('sv-SE')))||[],[network,query,planId]);
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/60)-1));
  const visible=useMemo(()=>{
    if(!network)return [];
    const byId=new Map(network.nodes.map(node=>[node.id,node]));
    const ids=new Set([network.coordinatorId,...filtered.slice(currentPage*60,currentPage*60+60).map(n=>n.id)]);
    for(const id of [...ids]){
      let parent=byId.get(id)?.parentId;const visited=new Set([id]);
      while(parent&&byId.has(parent)&&!visited.has(parent)&&visited.size<64){ids.add(parent);visited.add(parent);parent=byId.get(parent)?.parentId;}
    }
    return network.nodes.filter(n=>ids.has(n.id));
  },[network,filtered,currentPage]);
  const layout=useMemo(()=>layoutAgentNetwork(visible,network?.coordinatorId),[visible,network?.coordinatorId]);
  useEffect(()=>{
    const el=scrollRef.current;
    if(el){el.scrollLeft=Math.max(0,layout.width*zoom/2-el.clientWidth/2);el.scrollTop=Math.max(0,layout.height*zoom/2-el.clientHeight/2);}
  },[layout.width,layout.height,zoom,network?.coordinatorId]);
  const children=network?.nodes.filter(n=>n.parentId===selected?.id)||[];
  const assignments=network?.nodes.filter(n=>n.executorId===selected?.id)||[];
  const plans=network?.plans.filter(plan=>selected?.kind==='coordinator'||selected?.planIds.includes(plan.id)||assignments.some(n=>n.planIds.includes(plan.id)))||[];
  if(!network)return <div className="agent-network-empty" role="status"><Network size={32}/><h3>{error?'Agentkartan kunde inte hämtas':'Hämtar agenternas tillstånd…'}</h3><p>Agenter och planer visas när tjänsterna rapporterar dem.</p></div>;
  return <div className="agent-network">
    <div className="agent-network-controls">
      <label><span>Sök agent eller mål</span><input value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} placeholder="Namn, roll eller uppgift"/></label>
      <label><span>Plan</span><select value={planId} onChange={e=>{setPlanId(e.target.value);setPage(0);}}><option value="">Alla planer och agenter</option>{network.plans.map(plan=><option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label>
      <div className="agent-network-zoom"><button type="button" aria-label="Zooma ut agentkartan" disabled={zoom<=0.45} onClick={()=>setZoom(v=>Math.max(0.45,v-0.15))}><ZoomOut size={18}/></button><span>{Math.round(zoom*100)} %</span><button type="button" aria-label="Zooma in agentkartan" disabled={zoom>=1.5} onClick={()=>setZoom(v=>Math.min(1.5,v+0.15))}><ZoomIn size={18}/></button></div>
    </div>
    {(!network.planningAvailable||!network.coordinatorAvailable||error)&&<p className="agent-network-warning" role="status">{error?'Anslutningen är bruten. Senaste observationen visas. ':''}{!network.coordinatorAvailable?'Samordnaren svarar inte. ':''}{!network.planningAvailable?'Planerna kunde inte hämtas. Ett tomt område betyder inte att alla uppdrag är klara.':''}</p>}
    {network.truncated&&<p className="agent-network-warning">Källan visar ett begränsat fönster av historiken. Alla tidigare agenter och planer finns inte i den här observationen.</p>}
    <div className="agent-network-body">
      <section className="agent-network-map" aria-label="Agenternas relationer">
        <div className="agent-network-legend"><span><i className="agent-link-solid"/>Delegering</span><span><i className="agent-link-dotted"/>Anslutning</span><span><i className="agent-link-dashed"/>Beroende / utförande</span></div>
        <div ref={scrollRef} className="agent-network-scroll" tabIndex={0} aria-label="Flytta kartan genom att rulla. Välj en sfär för att läsa dess plan.">
          <div style={{width:layout.width*zoom,height:layout.height*zoom}}><div className="agent-network-stage" style={{width:layout.width,height:layout.height,transform:`scale(${zoom})`}}>
            <svg className="agent-network-lines" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="currentColor"/></marker></defs>{network.links.map((link,i)=>{
              const from=layout.positions[link.from],to=layout.positions[link.to];if(!from||!to)return null;
              return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} data-kind={link.kind} data-selected={link.from===selected?.id||link.to===selected?.id} markerEnd={link.kind==='dependency'?`url(#${marker})`:undefined}/>;
            })}</svg>
            {visible.map(node=>{const position=layout.positions[node.id];return <button key={node.id} type="button" className="agent-sphere" data-kind={node.kind} data-tone={tone(node.status)} aria-pressed={selected?.id===node.id} aria-label={`${node.name}, ${kindLabel[node.kind]}, ${statusText(node.status)}`} style={{left:position.x,top:position.y}} onClick={()=>setSelectedId(node.id)}>
              <span className="agent-sphere-orb"><CircleDot size={node.kind==='coordinator'?35:23}/></span><strong>{node.name}</strong><small>{kindLabel[node.kind]} · {statusText(node.status)}</small>
            </button>;})}
          </div></div>
        </div>
        <div className="agent-network-pagination"><span>{filtered.length} agenter / uppdragskontexter{filtered.length>60?` · sida ${currentPage+1} av ${Math.ceil(filtered.length/60)}`:''}</span>{filtered.length>60&&<><button type="button" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Föregående</button><button type="button" disabled={(currentPage+1)*60>=filtered.length} onClick={()=>setPage(currentPage+1)}>Nästa</button></>}</div>
        <p className="agent-network-note">Uppdragsagenter har egna mål och beständiga körkontexter. De kan dela körprocess. Sfärerna visar relationer och tillstånd, inte privata tankar.</p>
      </section>
      {selected&&<aside ref={detailRef} className="agent-network-detail" aria-label="Vald agents mål och plan">
        <p className="agent-detail-kicker">{kindLabel[selected.kind]} · {statusText(selected.status)}</p><h3>{selected.name}</h3>
        {selected.kind==='coordinator'&&<p>Aura är ditt gränssnitt. JACO håller ihop målet, fördelar arbetet efter behov och följer upp resultaten.</p>}
        {selected.purpose&&<section><h4>Uppgift</h4><p>{selected.purpose}</p></section>}
        {selected.model&&<p>Observerad modell: {selected.model}</p>}
        {selected.parentId&&<button type="button" className="agent-detail-link" onClick={()=>setSelectedId(selected.parentId)}>Delegerad av {network.nodes.find(n=>n.id===selected.parentId)?.name||'samordnaren'}</button>}
        {selected.blocker&&<p className="agent-network-warning">Hinder: {selected.blocker}</p>}
        {selected.executorId&&<button type="button" className="agent-detail-link" onClick={()=>setSelectedId(selected.executorId!)}>Körs av {network.nodes.find(n=>n.id===selected.executorId)?.name}</button>}
        {children.length>0&&<section><h4>Underagenter · {children.length}</h4>{children.map(node=><button className="agent-detail-row" type="button" key={node.id} onClick={()=>setSelectedId(node.id)}><span>{node.name}</span><small>{statusText(node.status)}</small></button>)}</section>}
        {assignments.length>0&&<section><h4>Tilldelade uppdrag</h4>{assignments.map(node=><button className="agent-detail-row" type="button" key={node.id} onClick={()=>setSelectedId(node.id)}>{node.name}</button>)}</section>}
        <section><h4>Planer och nästa steg</h4>{!plans.length&&<p>Ingen plan är kopplad till denna agent i den aktuella observationen.</p>}{plans.map(plan=><article className="agent-detail-plan" key={plan.id}><strong>{plan.title}</strong><p>{plan.objective}</p><ul>{plan.agentIds.map(id=>network.nodes.find(n=>n.id===id)).filter(Boolean).map(node=><li key={node!.id}><button type="button" onClick={()=>setSelectedId(node!.id)}>{node!.name}</button><small>{statusText(node!.status)}</small>{node!.dependencies?.length ? <p>Efter: {node!.dependencies.map(id=>network.nodes.find(n=>n.id===id)?.name||'tidigare steg').join(', ')}</p> : null}</li>)}</ul>{plan.replans.length>0&&<details><summary>Varför planen ändrades</summary>{plan.replans.map((replan,index)=><p key={index}>{replan.reason}</p>)}</details>}</article>)}</section>
        {Boolean(selected.nextSteps?.length)&&<section><h4>Föreslagen omplanering</h4>{selected.nextSteps!.map((step,index)=><p key={index}><strong>{step.title}</strong> — {step.objective}</p>)}</section>}
        {Boolean(selected.receipts?.length)&&<section><h4>Senaste observerade resultat</h4>{selected.receipts!.slice(-3).map((receipt,index)=><p key={receipt.actionId||index}>{receipt.type}: {receipt.outcomeUnknown?'osäkert utfall':!receipt.ok?'misslyckat':receipt.verified?'verktyget rapporterar verifierat':'ej verifierat'}{receipt.error?` — ${receipt.error}`:''}</p>)}</section>}
        {selected.missionIds.map(id=><button className="agent-detail-link" type="button" key={id} onClick={()=>onSelectMission(id)}>Öppna uppdrag och kvitton<ArrowUpRight size={14}/></button>)}
        {selected.kind==='coordinator'&&memory.length>0&&<section><h4>Delade upptäckter</h4>{memory.slice(0,4).map(item=><p key={item.id}>{item.body}</p>)}</section>}
        <p className="agent-network-note">Källa: {selected.source}. Planer och rapporterad aktivitet är inte bevis på ett färdigt resultat.</p>
      </aside>}
    </div>
  </div>;
}
