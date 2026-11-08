import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderConnect } from './ProviderConnect';
import { ApiVaultPanel } from './ApiVaultPanel';
import { McpServersPanel, type McpProvider, type McpTool } from './McpServersPanel';
import { SkillsView } from './SkillsView';
import { RoutinesPanel } from './RoutinesPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { readAuraResponse } from '../lib/auraApi.mjs';
import { SiteLoginsPanel } from './SiteLoginsPanel';
import { useOptionalUiLanguage } from '../i18n/UiLanguage';
const request=async(url:string,body?:unknown)=>fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}).then(readAuraResponse);
const unwrap=(result:any)=>{const text=result?.content?.find((c:any)=>c.type==='text')?.text;try{return text?JSON.parse(text):result;}catch{return result;}};
export function ConnectionsWorkspace({onSelectTool,initialTab='models',onTabChange}:{initialTab?:string;onTabChange:(tab:string)=>void;onSelectTool:(provider:McpProvider,tool:McpTool)=>void}) {
  const tab=initialTab;
  const {tr,language}=useOptionalUiLanguage();
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
  const act=async(name:string,action:()=>Promise<any>)=>{if(busy)return;setBusy(name);setNotice('');setResult(null);try{const value=await action();setResult(value);return value;}catch(e:any){if(e.toolResult)setResult(e.toolResult);setNotice(e.message==='PLANNER_ENV_PRIMARY_AUTHORITATIVE'?"The agent's model is locked by JACO_PRIMARY_PROVIDER in the server settings. Change that setting to choose a model here.":['TimeoutError','TypeError'].includes(e.name)?'The response could not be confirmed. Check the latest MCP calls and the project state before running again. '+e.message:e.message);}finally{setBusy(null);}};
  const call=async(server:string,tool:string,arguments_:any)=>{
    const data=await request('/api/aura/workbench/mcp/call',{providerId:server,toolName:tool,arguments:arguments_});
    if(data.result?.isError)throw Object.assign(Error(tr('Verktyget rapporterade ett fel. Se felutdata och slutkod i resultatet.','The tool reported an error. See the error output and exit code in the result.')),{toolResult:unwrap(data.result)});
    return unwrap(data.result);
  };
  return <div className="connections-workspace">
    <header><h2>{tr('Anslutningar','Connections')}</h2><button type="button" onClick={()=>void refresh()}>{tr('Uppdatera','Refresh')}</button></header>
    <p>{tr('Modeller, API och kassaskåp, lokala verktyg och färdigheter. Modeller och MCP uppdateras var 30:e sekund.','Models, API & Vault, local tools and skills. Models and MCP refresh every 30 seconds.')}</p>
    <nav aria-label={tr('Typ av anslutning','Connection type')}>{[['capabilities',tr('Vad Aura kan','What Aura can do')],['models',tr('Modeller','Models')],['local',tr('Lokala verktyg','Local tools')],['mcp','MCP'],['browser',tr('Webbläsare / CDP','Browser / CDP')],['skills',tr('Färdigheter','Skills')],['routines',tr('Rutiner','Routines')],['logins',tr('Inloggningar','Sign-ins')],['vault',tr('API och kassaskåp','API & Vault')]].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{onTabChange(id);setResult(null);}}>{label}</button>)}</nav>
    {observed&&<p>{tr('Senast kontrollerad','Last checked')} {new Date(observed).toLocaleTimeString(language==='sv'?'sv-SE':'en-US')}</p>}
    {Object.entries(errors).map(([source,message])=><p key={source} role="alert">{source}: {message}. {tr('Tidigare värden kan vara inaktuella.','Earlier values may be stale.')}</p>)}
    {notice&&<p role="alert">{notice}</p>}
    {tab==='models'&&<section><h3>{tr('Tillgängliga modeller','Available LLMs')}</h3><p>{tr('Svarar betyder att modellistan gick att läsa. Det intygar inte modellens kvalitet eller förmåga att använda verktyg.','Responding means the model list could be read. It does not confirm the model\'s quality or tool capability.')}</p>
      {!providers.length&&<p>{errors.models?tr('Modellistan gick inte att kontrollera.','The model list could not be checked.'):tr('Väntar på svar från modellerna…','Waiting for model responses…')}</p>}{providers.map(p=><article key={p.id}><strong>{p.id}</strong><span>{errors.models?tr('Okänd status','Unknown status'):({ACTIVE:tr('Svarar','Responding'),NO_KEY:tr('Nyckel saknas','Key missing'),KEY_REJECTED:tr('Nyckeln avvisades','Key rejected'),UNREACHABLE:tr('Nås inte','Unreachable')} as any)[p.state]||p.state}</span><p>{p.baseUrl}</p>
        {(p.modelIds||[]).map((model:string)=><div key={model} className="connection-model"><code>{model}</code><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>void act('aura-model',async()=>{
          const state=await request('/api/aura/model',{provider:p.id,model});
          if(state.choice?.provider!==p.id||state.choice?.model!==model)throw Error('AURA_MODEL_NOT_CONFIRMED');
          localStorage.setItem('jaco:aura:chat-provider:v2',JSON.stringify({provider:p.id,model}));
          window.dispatchEvent(new Event('jaco:aura:provider-chosen'));
          setNotice(tr('Aura använder nu och har kontrollerat modellen för chatt, planering och uppdrag: ','Aura model selected and verified for chat, planning and missions: ')+p.id+'/'+model);
          return null;
        })}>{tr('Använd för Aura','Use for Aura')}</button></div>)}
        {!p.modelIds?.length&&<p>{tr('Ingen tillgänglig modell hittades.','No available model observed.')}</p>}
      </article>)}<ProviderConnect onConnected={async()=>{await refresh();window.dispatchEvent(new Event('jaco:aura:provider-chosen'));}}/>
    </section>}
    {tab==='logins'&&<SiteLoginsPanel/>}
    {tab==='mcp'&&<McpServersPanel providers={(mcp?.providers||[]).map((p:any)=>errors.mcp?{...p,status:'UNOBSERVED'}:p)} recentCalls={mcp?.recentCalls||[]} busy={busy} selectedToolId={null} onStart={id=>void act(id,async()=>{const value=await request('/api/aura/workbench/mcp/start',{providerId:id});await refresh();return value;})} onSelectTool={onSelectTool} onChanged={message=>{setNotice(message);void refresh();}}/>}
    {tab==='local'&&<section><h3>{tr('Kör ett lokalt verktyg','Run a local tool')}</h3><p>{tr('Kommandot körs av JACO:s lokala MCP-server. Resultat och fel kommer från den verkliga processen.','The command is run by JACO\'s local MCP server. Results and errors come from the real process.')}</p><label>{tr('Körläge','Run mode')}<select value={localMode} onChange={e=>setLocalMode(e.target.value)}><option value="read">{tr('Bara läsa','Read only')}</option><option value="write">{tr('Projektkommando, kan ändra filer','Project command, may change files')}</option></select></label><label>{tr('Program','Program')}<input value={command} onChange={e=>setCommand(e.target.value)}/></label><label>{tr('Argument som JSON-lista','Arguments as a JSON array')}<input value={args} onChange={e=>setArgs(e.target.value)}/></label>
      <button type="button" disabled={!!busy} onClick={()=>void act('local',async()=>{const parsed=JSON.parse(args);if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string'))throw Error(tr('Argumenten måste vara en lista med textsträngar.','Arguments must be an array of strings.'));return call('shell',localMode==='read'?'shell_read':'shell_run',{command,args:parsed});})}>{busy==='local'?tr('Kör lokalt…','Running locally…'):localMode==='read'?tr('Kör läsning lokalt','Run read locally'):tr('Kör projektkommando','Run project command')}</button>
      <p>{tr('Körningar sker i det öppna projektet. Projektkommando kan ändra filer och köra projektets kod. Agentens åtkomst hanteras separat under MCP.','Runs happen in the open project. The project command mode can change files and run the project\'s code. Agent access is managed separately under MCP.')}</p></section>}
    {tab==='browser'&&<section><h3>{tr('Anslut en webbläsarflik','Connect a browser tab')}</h3><p>{tr('Starta Chrome eller Chromium med fjärrfelsökning på datorn där JACO körs. Flikarna läses från den angivna lokala CDP-porten.','Start Chrome/Chromium with remote debugging on the computer where JACO runs. Tabs are read from the given local CDP port.')}</p><label>{tr('CDP-port','CDP port')}<input type="number" min="1" max="65535" value={port} onChange={e=>{setPort(e.target.value);setTargets(null);setResult(null);}}/></label><button type="button" disabled={!!busy} onClick={()=>void act('targets',async()=>{setTargets(null);const value=await call('jaco','jaco_browser_targets',{port:Number(port)});setTargets(value.targets||[]);return value;})}>{tr('Hämta öppna flikar','Fetch open tabs')}</button>
      {targets?.length===0&&<p>{tr('Inga flikar som går att styra hittades.','No controllable tabs were observed.')}</p>}{targets?.map(t=><article key={t.id||t.url}><strong>{t.title||tr('Webbläsarflik','Browser tab')}</strong><p>{t.url}</p><button type="button" disabled={!!busy} onClick={()=>void act('attach',()=>call('jaco','jaco_browser_attach',{port:Number(port),urlIncludes:t.url.slice(0,300),targetId:t.id}))}>{tr('Anslut den här fliken','Connect this tab')}</button></article>)}
    </section>}
    {tab==='capabilities'&&<CapabilitiesPanel mcp={(mcp?.providers||[]) as any} onMcpChanged={()=>void refresh()}/>}
    {tab==='vault'&&<ApiVaultPanel onChanged={refresh}/>}
    {tab==='skills'&&<SkillsView/>}
    {tab==='routines'&&<RoutinesPanel/>}
    {result&&tab!=='models'&&<section><h3>{tr('Senaste verktygsresultat','Latest tool result')}</h3><pre>{JSON.stringify(result,null,2)}</pre></section>}
  </div>;
}
