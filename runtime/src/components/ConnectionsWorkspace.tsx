import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProviderConnect } from './ProviderConnect';
import { ApiVaultPanel } from './ApiVaultPanel';
import { McpServersPanel, type McpProvider, type McpTool } from './McpServersPanel';
import { SkillsView } from './SkillsView';
import { RoutinesPanel } from './RoutinesPanel';
import { CapabilitiesPanel } from './CapabilitiesPanel';
import { readAuraResponse } from '../lib/auraApi.mjs';
const request=async(url:string,body?:unknown)=>fetch(url,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)}).then(readAuraResponse);
const unwrap=(result:any)=>{const text=result?.content?.find((c:any)=>c.type==='text')?.text;try{return text?JSON.parse(text):result;}catch{return result;}};
export function ConnectionsWorkspace({onSelectTool,initialTab='models',onTabChange}:{initialTab?:string;onTabChange:(tab:string)=>void;onSelectTool:(provider:McpProvider,tool:McpTool)=>void}) {
  const tab=initialTab;
  const [localMode,setLocalMode]=useState('read');
  const [providers,setProviders]=useState<any[]>([]),[mcp,setMcp]=useState<any>(null);
  const [errors,setErrors]=useState<Record<string,string>>({}),[observed,setObserved]=useState(''),[busy,setBusy]=useState<string|null>(null),[notice,setNotice]=useState('');
  const [port,setPort]=useState('9222'),[targets,setTargets]=useState<any[]|null>(null),[command,setCommand]=useState('git'),[args,setArgs]=useState('["status","--short"]'),[result,setResult]=useState<any>(null);
  const [accountOrigin,setAccountOrigin]=useState(''),[accountMission,setAccountMission]=useState(''),[accountConfirmed,setAccountConfirmed]=useState(false);
  const [googleIdentity,setGoogleIdentity]=useState<any>(null),[googleError,setGoogleError]=useState('');
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
  useEffect(()=>{
    if(tab!=='browser')return;
    let active=true;
    void Promise.allSettled([request('/api/aura/google/status'),request('/api/aura/workbench')]).then(results=>{
      if(!active)return;
      if(results[0].status==='fulfilled')setGoogleIdentity(results[0].value);
      else setGoogleError(String(results[0].reason?.message||'Google connection could not be checked'));
      if(results[1].status==='fulfilled'){
        const missions=Array.isArray(results[1].value?.missions)?results[1].value.missions:[];
        const running=missions.find((m:any)=>['ACTIVE','BLOCKED','AWAITING_VERIFICATION'].includes(m.status));
        if(running?.id)setAccountMission(current=>current||String(running.id));
      }
    });
    return()=>{active=false;};
  },[tab]);
  const act=async(name:string,action:()=>Promise<any>)=>{if(busy)return;setBusy(name);setNotice('');setResult(null);try{const value=await action();setResult(value);return value;}catch(e:any){if(e.toolResult)setResult(e.toolResult);setNotice(e.message==='PLANNER_ENV_PRIMARY_AUTHORITATIVE'?"The agent's model is locked by JACO_PRIMARY_PROVIDER in the server settings. Change that setting to choose a model here.":['TimeoutError','TypeError'].includes(e.name)?'The response could not be confirmed. Check the latest MCP calls and the project state before running again. '+e.message:e.message);}finally{setBusy(null);}};
  const call=async(server:string,tool:string,arguments_:any)=>{
    const data=await request('/api/aura/workbench/mcp/call',{providerId:server,toolName:tool,arguments:arguments_});
    if(data.result?.isError)throw Object.assign(Error('The tool reported an error. See the error output and exit code in the result.'),{toolResult:unwrap(data.result)});
    return unwrap(data.result);
  };
  return <div className="connections-workspace">
    <header><h2>Connections</h2><button type="button" onClick={()=>void refresh()}>Refresh</button></header>
    <p>Models, API & Vault, local tools and skills. Models and MCP refresh every 30 seconds.</p>
    <nav aria-label="Connection type">{[['capabilities','What Aura can do'],['models','Models'],['local','Local tools'],['mcp','MCP'],['browser','Browser / CDP'],['skills','Skills'],['routines','Routines'],['vault','API & Vault']].map(([id,label])=><button key={id} type="button" aria-pressed={tab===id} onClick={()=>{onTabChange(id);setResult(null);}}>{label}</button>)}</nav>
    {observed&&<p>Last checked {new Date(observed).toLocaleTimeString('en-US')}</p>}
    {Object.entries(errors).map(([source,message])=><p key={source} role="alert">{source}: {message}. Earlier values may be stale.</p>)}
    {notice&&<p role="alert">{notice}</p>}
    {tab==='models'&&<section><h3>Available LLMs</h3><p>Responding means the model list could be read. It does not confirm the model's quality or tool capability.</p>
      {!providers.length&&<p>{errors.models?'The model list could not be checked.':'Waiting for model responses…'}</p>}{providers.map(p=><article key={p.id}><strong>{p.id}</strong><span>{errors.models?'Unknown status':({ACTIVE:'Responding',NO_KEY:'Key missing',KEY_REJECTED:'Key rejected',UNREACHABLE:'Unreachable'} as any)[p.state]||p.state}</span><p>{p.baseUrl}</p>
        {(p.modelIds||[]).map((model:string)=><div key={model} className="connection-model"><code>{model}</code><button type="button" disabled={!!busy||!!errors.models||!p.active} onClick={()=>void act('aura-model',async()=>{
          const state=await request('/api/aura/model',{provider:p.id,model});
          if(state.choice?.provider!==p.id||state.choice?.model!==model)throw Error('AURA_MODEL_NOT_CONFIRMED');
          localStorage.setItem('jaco:aura:chat-provider:v2',JSON.stringify({provider:p.id,model}));
          window.dispatchEvent(new Event('jaco:aura:provider-chosen'));
          setNotice('Aura model selected and verified for chat, planning and missions: '+p.id+'/'+model);
          return null;
        })}>Use for Aura</button></div>)}
        {!p.modelIds?.length&&<p>No available model observed.</p>}
      </article>)}<ProviderConnect onConnected={async()=>{await refresh();window.dispatchEvent(new Event('jaco:aura:provider-chosen'));}}/>
    </section>}
    {tab==='mcp'&&<McpServersPanel providers={(mcp?.providers||[]).map((p:any)=>errors.mcp?{...p,status:'UNOBSERVED'}:p)} recentCalls={mcp?.recentCalls||[]} busy={busy} selectedToolId={null} onStart={id=>void act(id,async()=>{const value=await request('/api/aura/workbench/mcp/start',{providerId:id});await refresh();return value;})} onSelectTool={onSelectTool} onChanged={message=>{setNotice(message);void refresh();}}/>}
    {tab==='local'&&<section><h3>Run a local tool</h3><p>The command is run by JACO's local MCP server. Results and errors come from the real process.</p><label>Run mode<select value={localMode} onChange={e=>setLocalMode(e.target.value)}><option value="read">Read only</option><option value="write">Project command, may change files</option></select></label><label>Program<input value={command} onChange={e=>setCommand(e.target.value)}/></label><label>Arguments as a JSON array<input value={args} onChange={e=>setArgs(e.target.value)}/></label>
      <button type="button" disabled={!!busy} onClick={()=>void act('local',async()=>{const parsed=JSON.parse(args);if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=='string'))throw Error('Arguments must be an array of strings.');return call('shell',localMode==='read'?'shell_read':'shell_run',{command,args:parsed});})}>{busy==='local'?'Running locally…':localMode==='read'?'Run read locally':'Run project command'}</button>
      <p>Runs happen in the open project. The project command mode can change files and run the project's code. Agent access is managed separately under MCP.</p></section>}
    {tab==='browser'&&<section><h3>Connect a browser tab</h3><p>Start Chrome/Chromium with remote debugging on the computer where JACO runs. Tabs are read from the given local CDP port.</p><label>CDP port<input type="number" min="1" max="65535" value={port} onChange={e=>{setPort(e.target.value);setTargets(null);setResult(null);}}/></label><button type="button" disabled={!!busy} onClick={()=>void act('targets',async()=>{setTargets(null);const value=await call('jaco','jaco_browser_targets',{port:Number(port)});setTargets(value.targets||[]);return value;})}>Fetch open tabs</button>
      {targets?.length===0&&<p>No controllable tabs were observed.</p>}{targets?.map(t=><article key={t.id||t.url}><strong>{t.title||'Browser tab'}</strong><p>{t.url}</p><button type="button" disabled={!!busy} onClick={()=>void act('attach',()=>call('jaco','jaco_browser_attach',{port:Number(port),urlIncludes:t.url.slice(0,300),targetId:t.id}))}>Connect this tab</button></article>)}
      <div className="mt-4 space-y-3 rounded-xl border border-slate-700 p-4">
        <h3>Autonomous account setup</h3>
        <p>Authorize Aura once for a named website and mission, for 30 minutes. Aura can complete ordinary registration steps. Passwords, Google sign-in/consent, verification and payments remain yours. Existing grants can be revoked here.</p>
        <label className="block">Website origin (HTTPS)<input className="w-full" type="url" placeholder="https://example.com" value={accountOrigin} onChange={e=>{setAccountOrigin(e.target.value);setAccountConfirmed(false);}} /></label>
        <label className="block">Autonomous mission ID<input className="w-full" value={accountMission} onChange={e=>{setAccountMission(e.target.value);setAccountConfirmed(false);}} placeholder="Mission ID from Aura Work" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={accountConfirmed} onChange={e=>setAccountConfirmed(e.target.checked)} />
          <span>I approve account registration for this site within this mission. I will complete passwords, Google consent and verification myself.</span></label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!!busy||!accountConfirmed||!accountOrigin.trim()||!accountMission.trim()} onClick={()=>void act('account-grant',()=>request('/api/aura/browser/account-setup-grant',{enabled:true,confirmed:true,origin:accountOrigin.trim(),missionId:accountMission.trim()}))}>Allow Aura to register</button>
          <button type="button" disabled={!!busy} onClick={()=>void act('account-revoke',()=>request('/api/aura/browser/account-setup-grant',{enabled:false}))}>Revoke browser grant</button>
        </div>
      </div>
      <div className="mt-4 space-y-2 rounded-xl border border-slate-700 p-4">
        <h3>Google authorization (operator)</h3>
        <p>Connect your Google identity to this local JACO runtime. Google will ask you to sign in and approve. This does not grant access to Gmail, Drive or third-party accounts.</p>
        {googleIdentity?.connected?<p role="status">Connected as {googleIdentity.identity?.email||'Google account'} (identity only).</p>
         :googleIdentity&&!googleIdentity.configured?<p>Google OAuth client is not configured. Provide JACO_GOOGLE_OAUTH_CLIENT_ID, JACO_GOOGLE_OAUTH_CLIENT_SECRET and a registered loopback redirect URI.</p>
         :<p>Google status: {googleIdentity?'Not connected':'Not yet checked'}</p>}
        {googleError&&<p role="alert">{googleError}</p>}
        <button type="button" disabled={!!busy||!googleIdentity?.configured} onClick={()=>void act('google',async()=>{
          const data=await request('/api/aura/google/start',{});
          const target=new URL(String(data.url||''));
          if(target.origin!=='https://accounts.google.com')throw Error('Unexpected OAuth destination');
          window.location.assign(target.href);
          return {started:true};
        })}>Connect with Google</button>
      </div>
    </section>}
    {tab==='capabilities'&&<CapabilitiesPanel mcp={(mcp?.providers||[]) as any} onMcpChanged={()=>void refresh()}/>}
    {tab==='vault'&&<ApiVaultPanel onChanged={refresh}/>}
    {tab==='skills'&&<SkillsView/>}
    {tab==='routines'&&<RoutinesPanel/>}
    {result&&tab!=='models'&&<section><h3>Latest tool result</h3><pre>{JSON.stringify(result,null,2)}</pre></section>}
  </div>;
}
