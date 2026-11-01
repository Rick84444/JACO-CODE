import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderConnect } from './ProviderConnect';
import { ApiVaultPanel } from './ApiVaultPanel';
import { McpServersPanel, type McpProvider, type McpTool } from './McpServersPanel';
import { SkillsView } from './SkillsView';
import { readAuraResponse } from '../lib/auraApi.mjs';
const request=async(url:string,body?:unknown)=>fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}).then(readAuraResponse);
const unwrap=(result:any)=>{const text=result?.content?.find((c:any)=>c.type==='text')?.text;try{return text?JSON.parse(text):result;}catch{return result;}};
export function ConnectionsWorkspace({onSelectTool,initialTab='models',onTabChange}:{initialTab?:string;onTabChange:(tab:string)=>void;onSelectTool:(provider:McpProvider,tool:McpTool)=>void}) {
  const { t: uiText } = useUiLanguage();
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
  const act=async(name:string,action:()=>Promise<any>)=>{if(busy)return;setBusy(name);setNotice('');setResult(null);try{const value=await action();setResult(value);return value;}catch(e:any){if(e.toolResult)setResult(e.toolResult);setNotice(e.message==='PLANNER_ENV_PRIMARY_AUTHORITATIVE'?uiText("The task model is set by JACO_PRIMARY_PROVIDER in the server configuration. Change that setting to choose a model here."):['TimeoutError','TypeError'].includes(e.name)?uiText("The response could not be confirmed. Check recent tool calls and the project state before trying again. ")+e.message:e.message);}finally{setBusy(null);}};
  const call=async(server:string,tool:string,arguments_:any)=>{
    const data=await request('/api/aura/workbench/mcp/call',{providerId:server,toolName:tool,arguments:arguments_});
    if(data.result?.isError)throw Object.assign(Error(uiText("The tool reported an error. Check its output and exit code.")),{toolResult:unwrap(data.result)});
    return unwrap(data.result);
  };
  return <div className="connections-workspace">
    <header><h2>{uiText("Connections")}</h2><a href="/connect.html">{uiText("Setup")}</a><button type="button" onClick={()=>void refresh()}>{uiText("Refresh")}</button></header>
    <p>{uiText("Models, credentials, local tools and skills. Models and tool connections refresh every 30 seconds.")}</p>
    <nav aria-label={uiText("Connection type")}>{[['models',uiText("Models")],['local',uiText("Local tools")],['mcp','MCP'],['browser',uiText("Browser / CDP")],['skills','Skills'],['vault',uiText("API & credentials")]].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{onTabChange(id);setResult(null);}}>{label}</button>)}</nav>
    {observed&&<p>{uiText("Last checked")}{' '}{new Date(observed).toLocaleTimeString('sv-SE')}</p>}
    {Object.entries(errors).map(([source,message])=><p key={source} role="alert">{source}: {message}{uiText(". Earlier values may be out of date.")}</p>)}
    {notice&&<p role="alert">{notice}</p>}
    {tab==='models'&&<section><h3>{uiText("Available models")}</h3><p>{uiText("Responding means the model list was readable. Model quality and tool support still need to be tested.")}</p>
      {!providers.length&&<p>{errors.models?uiText("The model list could not be checked."):uiText("Waiting for model services…")}</p>}{providers.map(p=><article key={p.id}><strong>{p.id}</strong><span>{errors.models?uiText("Unknown status"):({ACTIVE:uiText("Responding"),NO_KEY:uiText("Key required"),KEY_REJECTED:uiText("Key rejected"),UNREACHABLE:uiText("Unreachable")} as any)[p.state]||p.state}</span><p>{p.baseUrl}</p>
        {(p.modelIds||[]).map((model:string)=><div key={model} className="connection-model"><code>{model}</code><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>{localStorage.setItem('jaco:aura:chat-provider:v2',JSON.stringify({provider:p.id,model}));window.dispatchEvent(new Event('jaco:aura:provider-chosen'));setNotice(uiText("Selected for Aura: ")+model);}}>{uiText("Use in conversation")}</button><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>void act('planner',async()=>{await request('/api/nova/planner',{provider:p.id,model});window.dispatchEvent(new Event('jaco:aura:provider-chosen'));setNotice(uiText("Selected for the next task planning turn: ")+model);return null;})}>{uiText("Use for tasks")}</button></div>)}
        {!p.modelIds?.length&&<p>{uiText("No available model observed.")}</p>}
      </article>)}<ProviderConnect onConnected={async()=>{await refresh();window.dispatchEvent(new Event('jaco:aura:provider-chosen'));}}/>
    </section>}
    {tab==='mcp'&&<McpServersPanel providers={(mcp?.providers||[]).map((p:any)=>errors.mcp?{...p,status:'UNOBSERVED'}:p)} recentCalls={mcp?.recentCalls||[]} busy={busy} selectedToolId={null} onStart={id=>void act(id,async()=>{const value=await request('/api/aura/workbench/mcp/start',{providerId:id});await refresh();return value;})} onSelectTool={onSelectTool} onChanged={message=>{setNotice(message);void refresh();}}/>}
    {tab==='local'&&<section><h3>{uiText("Run a local tool")}</h3><p>{uiText("Commands run through JACO’s local tool server. Output and errors come from the actual process.")}</p><label>{uiText("Run mode")}<select value={localMode} onChange={e=>setLocalMode(e.target.value)}><option value="read">{uiText("Read only")}</option><option value="write">{uiText("Project command, may change files")}</option></select></label><label>{uiText("Program")}<input value={command} onChange={e=>setCommand(e.target.value)}/></label><label>{uiText("Arguments as a JSON array")}<input value={args} onChange={e=>setArgs(e.target.value)}/></label>
      <button type="button" disabled={!!busy} onClick={()=>void act('local',async()=>{const parsed=JSON.parse(args);if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string'))throw Error(uiText("Arguments must be an array of strings."));return call('shell',localMode==='read'?'shell_read':'shell_run',{command,args:parsed});})}>{busy==='local'?uiText("Running locally…"):localMode==='read'?uiText("Run a local read"):uiText("Run project command")}</button>
      <p>{uiText("Commands run in the open project. Project commands can change files and execute project code. Manage agent permissions under MCP.")}</p></section>}
    {tab==='browser'&&<section><h3>{uiText("Connect a browser tab")}</h3><p>{uiText("Start Chrome or Chromium with remote debugging on the device running JACO. Tabs are read from the local CDP port below.")}</p><label>{uiText("CDP port")}<input type="number" min="1" max="65535" value={port} onChange={e=>{setPort(e.target.value);setTargets(null);setResult(null);}}/></label><button type="button" disabled={!!busy} onClick={()=>void act('targets',async()=>{setTargets(null);const value=await call('jaco','jaco_browser_targets',{port:Number(port)});setTargets(value.targets||[]);return value;})}>{uiText("Find open tabs")}</button>
      {targets?.length===0&&<p>{uiText("No controllable tabs observed.")}</p>}{targets?.map(t=><article key={t.id||t.url}><strong>{t.title||uiText("Browser tab")}</strong><p>{t.url}</p><button type="button" disabled={!!busy} onClick={()=>void act('attach',()=>call('jaco','jaco_browser_attach',{port:Number(port),urlIncludes:t.url.slice(0,300),targetId:t.id}))}>{uiText("Connect this tab")}</button></article>)}
    </section>}
    {tab==='vault'&&<ApiVaultPanel onChanged={refresh}/>}
    {tab==='skills'&&<SkillsView/>}
    {result&&tab!=='models'&&<section><h3>{uiText("Latest tool result")}</h3><pre>{JSON.stringify(result,null,2)}</pre></section>}
  </div>;
}
