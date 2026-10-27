import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderConnect } from './ProviderConnect';
import { ApiVaultPanel } from './ApiVaultPanel';
import { McpServersPanel, type McpProvider, type McpTool } from './McpServersPanel';
import { SkillsView } from './SkillsView';
import { readAuraResponse } from '../lib/auraApi.mjs';
const request=async(url:string,body?:unknown)=>fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}).then(readAuraResponse);
const unwrap=(result:any)=>{const text=result?.content?.find((c:any)=>c.type==='text')?.text;try{return text?JSON.parse(text):result;}catch{return result;}};
export function ConnectionsWorkspace({onSelectTool,initialTab='models',onTabChange}:{initialTab?:string;onTabChange:(tab:string)=>void;onSelectTool:(provider:McpProvider,tool:McpTool)=>void}) {
  const tab=initialTab;
  const [localMode,setLocalMode]=useState('read');
  const [providers,setProviders]=useState<any[]>([]),[mcp,setMcp]=useState<any>(null);
  const [errors,setErrors]=useState<Record<string,string>>({}),[observed,setObserved]=useState(''),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  const [port,setPort]=useState('9222'),[targets,setTargets]=useState<any[]|null>(null),[command,setCommand]=useState('git'),[args,setArgs]=useState('["status","--short"]'),[result,setResult]=useState<any>(null);
  const loading=useRef(false),alive=useRef(true);
  useEffect(()=>{setResult(null);},[initialTab]);
  const refresh=useCallback(async()=>{
    if(loading.current)return;loading.current=true;
    try {
      const responses=await Promise.allSettled([request('/api/aura/workbench/providers/scan'),request('/api/aura/workbench/mcp')]);
      if(!alive.current)return;
      const next:Record<string,string>={};
      responses.forEach((r,i)=>{const key=i?'mcp':'models';if(r.status==='rejected')next[key]=r.reason.message;else if(i)setMcp(r.value);else setProviders(r.value.providers||[]);});
      setErrors(next);setObserved(new Date().toISOString());
    }finally{loading.current=false;}
  },[]);
  useEffect(()=>{alive.current=true;void refresh();const timer=setInterval(()=>{if(!document.hidden)void refresh();},30000);return()=>{alive.current=false;clearInterval(timer);};},[refresh]);
  const act=async(name:string,action:()=>Promise<any>)=>{if(busy)return;setBusy(name);setNotice('');setResult(null);try{const value=await action();setResult(value);return value;}catch(e:any){if(e.toolResult)setResult(e.toolResult);setNotice(e.message==='PLANNER_ENV_PRIMARY_AUTHORITATIVE'?'Agentens modell är låst av JACO_PRIMARY_PROVIDER i serverns inställningar. Ändra den inställningen för att kunna välja här.':['TimeoutError','TypeError'].includes(e.name)?'Svaret kunde inte bekräftas. Kontrollera senaste MCP-anrop och projektets tillstånd innan du kör igen. '+e.message:e.message);}finally{setBusy(null);}};
  const call=async(server:string,tool:string,arguments_:any)=>{
    const data=await request('/api/aura/workbench/mcp/call',{providerId:server,toolName:tool,arguments:arguments_});
    if(data.result?.isError)throw Object.assign(Error('Verktyget rapporterade fel. Se resultatets felutdata och exitkod.'),{toolResult:unwrap(data.result)});
    return unwrap(data.result);
  };
  return <div className="connections-workspace">
    <header><h2>Anslutningar</h2><button type="button" onClick={()=>void refresh()}>Uppdatera</button></header>
    <p>Modeller, API & Vault, lokala verktyg och färdigheter. Modeller och MCP uppdateras var 30:e sekund.</p>
    <nav aria-label="Anslutningstyp">{[['models','Modeller'],['local','Lokala verktyg'],['mcp','MCP'],['browser','Webbläsare / CDP'],['skills','Skills'],['vault','API & Vault']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{onTabChange(id);setResult(null);}}>{label}</button>)}</nav>
    {observed&&<p>Senast kontrollerat {new Date(observed).toLocaleTimeString('sv-SE')}</p>}
    {Object.entries(errors).map(([source,message])=><p key={source} role="alert">{source}: {message}. Tidigare värden kan vara föråldrade.</p>)}
    {notice&&<p role="alert">{notice}</p>}
    {tab==='models'&&<section><h3>Tillgängliga LLM</h3><p>Svarar betyder att modellistan kunde läsas. Det bekräftar inte modellens kvalitet eller verktygsförmåga.</p>
      {!providers.length&&<p>{errors.models?'Modellistan kunde inte kontrolleras.':'Väntar på modellernas svar…'}</p>}{providers.map(p=><article key={p.id}><strong>{p.id}</strong><span>{errors.models?'Okänd status':({ACTIVE:'Svarar',NO_KEY:'Nyckel saknas',KEY_REJECTED:'Nyckel nekas',UNREACHABLE:'Kan inte nås'} as any)[p.state]||p.state}</span><p>{p.baseUrl}</p>
        {(p.modelIds||[]).map((model:string)=><div key={model} className="connection-model"><code>{model}</code><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>{localStorage.setItem('jaco:aura:chat-provider:v2',JSON.stringify({provider:p.id,model}));window.dispatchEvent(new Event('jaco:aura:provider-chosen'));setNotice('Vald för Aura: '+model);}}>Använd i samtal</button><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>void act('planner',async()=>{await request('/api/nova/planner',{provider:p.id,model});window.dispatchEvent(new Event('jaco:aura:provider-chosen'));setNotice('Vald för agentens nästa planering: '+model);return null;})}>Använd för agenten</button></div>)}
        {!p.modelIds?.length&&<p>Ingen tillgänglig modell observerad.</p>}
      </article>)}<ProviderConnect onConnected={async()=>{await refresh();window.dispatchEvent(new Event('jaco:aura:provider-chosen'));}}/>
    </section>}
    {tab==='mcp'&&<McpServersPanel providers={(mcp?.providers||[]).map((p:any)=>errors.mcp?{...p,status:'UNOBSERVED'}:p)} recentCalls={mcp?.recentCalls||[]} busy={busy} selectedToolId={null} onStart={id=>void act(id,async()=>{const value=await request('/api/aura/workbench/mcp/start',{providerId:id});await refresh();return value;})} onSelectTool={onSelectTool} onChanged={message=>{setNotice(message);void refresh();}}/>}
    {tab==='local'&&<section><h3>Kör ett lokalt verktyg</h3><p>Kommandot körs av JACOs lokala MCP-server. Resultat och fel kommer från den verkliga processen.</p><label>Körsätt<select value={localMode} onChange={e=>setLocalMode(e.target.value)}><option value="read">Endast läsning</option><option value="write">Projektkommando, kan ändra filer</option></select></label><label>Program<input value={command} onChange={e=>setCommand(e.target.value)}/></label><label>Argument som JSON-array<input value={args} onChange={e=>setArgs(e.target.value)}/></label>
      <button type="button" disabled={!!busy} onClick={()=>void act('local',async()=>{const parsed=JSON.parse(args);if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string'))throw Error('Argument måste vara en array av strängar.');return call('shell',localMode==='read'?'shell_read':'shell_run',{command,args:parsed});})}>{busy==='local'?'Kör lokalt…':localMode==='read'?'Kör läsning lokalt':'Kör projektkommando'}</button>
      <p>Körning sker i det öppna projektet. Körsättet för projektkommandon kan ändra filer och köra projektets kod. Agenternas åtkomst hanteras separat under MCP.</p></section>}
    {tab==='browser'&&<section><h3>Anslut en webbläsarflik</h3><p>Starta Chrome/Chromium med fjärrfelsökning på datorn där JACO körs. Flikarna läses från den angivna lokala CDP-porten.</p><label>CDP-port<input type="number" min="1" max="65535" value={port} onChange={e=>{setPort(e.target.value);setTargets(null);setResult(null);}}/></label><button type="button" disabled={!!busy} onClick={()=>void act('targets',async()=>{setTargets(null);const value=await call('jaco','jaco_browser_targets',{port:Number(port)});setTargets(value.targets||[]);return value;})}>Hämta öppna flikar</button>
      {targets?.length===0&&<p>Inga styrbara flikar observerades.</p>}{targets?.map(t=><article key={t.id||t.url}><strong>{t.title||'Webbläsarflik'}</strong><p>{t.url}</p><button type="button" disabled={!!busy} onClick={()=>void act('attach',()=>call('jaco','jaco_browser_attach',{port:Number(port),urlIncludes:t.url.slice(0,300),targetId:t.id}))}>Anslut den här fliken</button></article>)}
    </section>}
    {tab==='vault'&&<ApiVaultPanel onChanged={refresh}/>}
    {tab==='skills'&&<SkillsView/>}
    {result&&tab!=='models'&&<section><h3>Senaste verktygsresultat</h3><pre>{JSON.stringify(result,null,2)}</pre></section>}
  </div>;
}
