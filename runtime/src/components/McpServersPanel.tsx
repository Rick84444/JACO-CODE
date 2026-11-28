import React, { useEffect, useRef, useState } from 'react';
import { MCP_LOGOS } from './mcpLogos';
import { FINANCIAL_LOGOS } from './financialLogos';
import {LinearOAuthPanel} from './LinearOAuthPanel';
import { MCP_INTEGRATION_CATALOG, mcpCatalogDraft, mcpConnectionState, pluginCategory, marketplaceEntries, pluginEnvironment, pluginEvidence, observationFresh } from '../lib/mcpIntegrationCatalog.mjs';

// JACO's MCP servers as the operator manages them (operator 2026-10-09): each with its logo, what it
// answered, what agents may do with it, and the last calls. Servers are added here without editing
// .jaco/mcp/servers.json by hand. Every number shown is the host's own record (stdioMcpHost.mjs).
export interface McpTool { name: string; description: string; readOnly: boolean; agentAllowed?: boolean; inputSchema?: Record<string, any> }
export interface McpCallRecord { server?: string; tool: string; actor: string; outcome: string; error: string | null; ms: number; at: string }
export interface McpProvider {
  id: string; name: string; role: string; status: string; transport?: string; endpoint?: string; error: string | null; tools: McpTool[];
  oauthState?: string; accountVerifiedAt?: string|null;
  credentialEnv?: string; credentialConfigured?: boolean | null; allowOpenLogin?: boolean; catalogMatch?: boolean; loginOpeningSupported?: boolean; startedAt?: string | null;
  icon?: string; agentAccess?: 'off' | 'read' | 'write'; deny?: string[]; builtIn?: boolean;
  stats?: { calls: number; failures: number; refused: number; lastCall: McpCallRecord | null };
}
interface Props {
  observedAt?: string | null;
  observationFailed?: boolean;
  providers: McpProvider[];
  recentCalls: McpCallRecord[];
  busy: string | null;
  selectedToolId: string | null;
  onStart: (id: string) => void;
  onSelectTool: (provider: McpProvider, tool: McpTool) => void;
  onChanged: (notice: string) => void;
}

export function PluginLogo({id,name,icon,size=24}:{id:string;name:string;icon?:string;size?:number}){
  const aliases:Record<string,string>={'paypal-sandbox':'paypal','mailchimp-docs':'mailchimp','tiktok-direct':'tiktok','openai-docs':'openai','microsoft-learn':'microsoft','cloudflare-docs':'cloudflare','cloudflare-api':'cloudflare','github-remote':'github'};
  const key=aliases[id]||id;
  const brand=FINANCIAL_LOGOS[key];
  if(brand?.path)return <svg role="img" aria-label={brand.title} viewBox="0 0 24 24" width={size} height={size} className="shrink-0"><path fill={brand.color} d={brand.path}/></svg>;
  if(MCP_LOGOS[key])return <McpLogo icon={key} size={size}/>;
  if(icon&&icon!=='mcp'&&MCP_LOGOS[icon])return <McpLogo icon={icon} size={size}/>;
  return <span role="img" aria-label={name+' monogram'} className="inline-flex shrink-0 items-center justify-center rounded bg-neutral-800 border border-neutral-600 font-semibold" style={{width:size,height:size,color:brand?.color||'#A8C5E8',fontSize:Math.max(8,size*.36)}}>{brand?.monogram||name.slice(0,2).toUpperCase()}</span>;
}

export function McpLogo({ icon, size = 14 }: { icon?: string; size?: number }) {
  if (icon === 'jaco') return <img src="/branding/jaco-orb.webp" alt="JACO" width={size} height={size} className="rounded-sm shrink-0" />;
  const logo = MCP_LOGOS[icon || 'mcp'] || MCP_LOGOS.mcp;
  return <svg role="img" aria-label={logo.title} viewBox="0 0 24 24" width={size} height={size} className="shrink-0"><title>{logo.title}</title><path d={logo.path} fill={logo.color} /></svg>;
}

// "npx -y @scope/server /path" -> ['npx', '-y', '@scope/server', '/path']; quotes keep spaces.
export function splitCommandLine(line: string): string[] {
  const parts: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) parts.push(m[1] ?? m[2] ?? m[3]);
  return parts;
}

const ACCESS_LABEL: Record<string, string> = { off: 'Off', read: 'Read', write: 'Read and write' };
const OUTCOME_LABEL: Record<string, string> = { ok: 'ok', tool_error: 'tool error', failed: 'error', refused: 'refused' };
const outcomeClass = (o: string) => o === 'ok' ? 'text-emerald-400' : o === 'refused' ? 'text-amber-300' : 'text-red-400';
const when = (at: string) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('en-US') : ''; };
const ICON_CHOICES = Object.keys(MCP_LOGOS).concat('jaco');

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP_${res.status}`);
  return data;
}

export function McpServersPanel({ providers, recentCalls, busy, selectedToolId, onStart, onSelectTool, onChanged, observedAt, observationFailed=false }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: '', name: '', target: '', icon: 'mcp', agentAccess: 'read', tokenEnv: '', allowOpenLogin: false });
  const [query, setQuery] = useState('');
  const [category,setCategory]=useState('all');
  const [scope,setScope]=useState<'all'|'configured'|'available'|'directory'>(providers.some(p=>MCP_INTEGRATION_CATALOG.some(c=>c.id===p.id))?'configured':'available');
  const [selectedPlugin,setSelectedPlugin]=useState('');
  const [clock,setClock]=useState(Date.now());
  const modal=useRef<HTMLDialogElement>(null);
  const setupModal=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=setupModal.current;if(adding&&dialog&&!dialog.open)dialog.showModal();else if(!adding&&dialog?.open)dialog.close();},[adding]);
  useEffect(()=>{const t=window.setInterval(()=>setClock(Date.now()),5000);return()=>window.clearInterval(t);},[]);
  const fresh=!observationFailed&&observationFresh(observedAt,clock);
  const preset=MCP_INTEGRATION_CATALOG.find(p=>p.id===selectedPlugin);
  const directory=marketplaceEntries(providers).find(p=>p.id===selectedPlugin);
  const selected=preset||directory;
  const current=providers.find(p=>p.id===selectedPlugin);
  const evidence=pluginEvidence(current,fresh);
  useEffect(()=>{
    const dialog=modal.current;
    if(selectedPlugin&&dialog&&!dialog.open)dialog.showModal();
    else if(!selectedPlugin&&dialog?.open)dialog.close();
  },[selectedPlugin]);
  const statusLabel=(value:string)=>(({AVAILABLE:'Not configured',UNOBSERVED:'Observation unavailable',CUSTOM_CONFIGURATION:'Custom configuration',TOOLS_DISCOVERED:'Tools discovered',AUTH_REQUIRED:'Authentication required',AGENT_ACCESS_OFF:'Agent access disabled',CONFIGURED:'Configured · not connected',ERROR:'Connection failed',CONNECTING:'Connecting',ADAPTER_REQUIRED:'Adapter required',OAUTH_REQUIRED:'OAuth required'} as Record<string,string>)[value]||value.replaceAll('_',' '));
  const environmentLabel=(id:string)=>(({SANDBOX:'Sandbox / test',PUBLIC_DATA:'Public data',ACCOUNT_SCOPE_UNVERIFIED:'Account scope not verified'} as Record<string,string>)[pluginEnvironment(id)]||'Account scope not verified');
  const updateLoginAccess=async(enabled:boolean)=>{
    if(!current||!fresh||working)return;
    setWorking(current.id);setFormError(null);
    try{await send('/api/aura/workbench/mcp/servers/'+encodeURIComponent(current.id)+'/access','PATCH',{allowOpenLogin:enabled});onChanged(current.name+': login-opening permission '+(enabled?'enabled':'revoked'));}
    catch(e:any){setFormError(String(e?.message||'Permission change failed'));}
    finally{setWorking(null);}
  };

  const [registryQuery,setRegistryQuery]=useState('');
  const [registryBusy,setRegistryBusy]=useState(false);
  const [registryError,setRegistryError]=useState('');
  const [registry,setRegistry]=useState<{entries:{name:string;title:string;description:string;version:string;state:string}[];hasMore:boolean}|null>(null);
  const searchRegistry=async()=>{
    if(registryBusy||registryQuery.trim().length<3)return;
    setRegistryBusy(true);setRegistryError('');setRegistry(null);
    try{setRegistry(await send('/api/aura/workbench/mcp/registry?q='+encodeURIComponent(registryQuery.trim()),'GET'));}
    catch(e:any){setRegistryError(String(e?.message||'Registry unavailable'));}
    finally{setRegistryBusy(false);}
  };
  const matches=(p:{name:string;auth?:string;purpose?:string})=>(p.name+' '+(p.auth||'')+' '+(p.purpose||'')).toLowerCase().includes(query.trim().toLowerCase());
  const [formError, setFormError] = useState<string | null>(null);
  const failedCustom = providers.filter(p => p.status === 'FAILED' && p.builtIn === false);
  const quarantineFailed = async () => {
    setWorking('__quarantine');
    try {
      const result = await send('/api/aura/workbench/mcp/quarantine-failed', 'POST', {});
      const n = Array.isArray(result.disabled) ? result.disabled.length : 0;
      onChanged(`${n} failed custom MCP connections disabled. Their definitions are preserved for later repair.`);
    } catch (error: any) {
      onChanged(`Could not disable failed connections: ${error.message}`);
    } finally { setWorking(null); }
  };

  const setAccess = async (id: string, agentAccess: string) => {
    setWorking(id);
    try { await send(`/api/aura/workbench/mcp/servers/${encodeURIComponent(id)}/access`, 'PATCH', { agentAccess }); onChanged(`Agents on ${id}: ${ACCESS_LABEL[agentAccess]}`); }
    catch (e: any) { onChanged(`Could not change access for ${id}: ${e.message}`); }
    finally { setWorking(null); }
  };
  const remove = async (p: McpProvider) => {
    if (!window.confirm(p.builtIn ? `Turn off ${p.name}? It can be turned on again by adding it.` : `Remove ${p.name}?`)) return;
    setWorking(p.id);
    try { const r = await send(`/api/aura/workbench/mcp/servers/${encodeURIComponent(p.id)}`, 'DELETE'); onChanged(`${p.name} ${r.removed ? 'removed' : 'turned off'}`); }
    catch (e: any) { onChanged(`Could not remove ${p.name}: ${e.message}`); }
    finally { setWorking(null); }
  };
  const add = async () => {
    setFormError(null);
    if(!fresh){setFormError('Refresh connection status before changing configuration.');return;}
    const target = draft.target.trim();
    const http = /^https:\/\//i.test(target);
    const parts = http ? [] : splitCommandLine(target);
    if (!draft.id.trim() || !target || (!http && !parts.length)) { setFormError('Enter an id and a command or https address.'); return; }
    if (http && draft.tokenEnv && !/^[A-Z][A-Z0-9_]{0,79}$/.test(draft.tokenEnv.trim())) { setFormError('Enter a variable name, not a token value.'); return; }
    if (providers.some(p=>p.id===draft.id.trim())) { setFormError('This ID is already configured. Manage access on its existing connection; use a different ID for a new connection.'); return; }
    const entry = http
      ? { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), transport: 'http', url: target, tokenEnv: draft.tokenEnv.trim() || null, icon: draft.icon, agentAccess: draft.agentAccess, allowOpenLogin: draft.allowOpenLogin === true }
      : { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), command: parts[0], args: parts.slice(1), icon: draft.icon, agentAccess: draft.agentAccess };
    setWorking('__add');
    try {
      await send('/api/aura/workbench/mcp/servers', 'POST', {...entry,createOnly:true});
      try { const started=await send('/api/aura/workbench/mcp/start','POST',{providerId:entry.id}); onChanged(`${entry.name}: ${Array.isArray(started.tools)?started.tools.length:0} tools discovered. Individual tool execution is not yet verified.`); }
      catch(error:any) { onChanged(`${entry.name} saved, but the connection failed: ${error.message}`); }
      setDraft({ id: '', name: '', target: '', icon: 'mcp', agentAccess: 'read', tokenEnv: '', allowOpenLogin: false }); setAdding(false);
    } catch (e: any) { setFormError(e.message); }
    finally { setWorking(null); }
  };

  const managed = (p: McpProvider) => ['stdio', 'http'].includes(p.transport || '');
  return <section aria-label="MCP servers" className="pb-2">
    <div className="px-3 py-1.5 mt-2 flex items-center">
      <span className="text-[9px] uppercase tracking-wider text-neutral-500">Connected MCP and tools</span>
      {failedCustom.length > 0 && <button onClick={() => void quarantineFailed()} disabled={!fresh||working !== null} title="Disable observed failed custom connections without deleting their configuration. Built-in and healthy servers remain unchanged." className="ml-auto text-[9px] text-amber-300 border border-amber-800 rounded px-1.5 py-0.5 disabled:opacity-40">Disable failed ({failedCustom.length})</button>}
      <button onClick={() => setAdding(v => !v)} className={`${failedCustom.length ? 'ml-1.5' : 'ml-auto'} text-[9px] text-neutral-200 border border-neutral-800 rounded px-1.5 py-0.5 hover:bg-neutral-900/30`}>{adding ? 'Close' : '+ Add'}</button>
    </div>

    <section className="mx-3 mb-3 rounded-xl border border-neutral-700 bg-[#1d2025] p-3 space-y-3" aria-label="Integration management">
      <header className="flex flex-wrap justify-between items-start gap-2">
        <div><h3 className="text-sm font-semibold tracking-wide text-neutral-100">Integrations</h3><p className="mt-1 text-[11px] text-neutral-400">Manage connections, access and provider catalog.</p></div>
        <span className="text-[10px] text-neutral-400">{fresh?'Runtime observation current':'Runtime observation unavailable or stale'}</span>
      </header>
      <div className="grid grid-cols-3 gap-2" aria-label="Connection summary">
        {[['Configured',fresh?providers.filter(p=>['http','stdio'].includes(p.transport||'')).length:'—'],['Tools discovered',fresh?providers.filter(p=>mcpConnectionState(p)==='TOOLS_DISCOVERED').length:'—'],['Attention required',fresh?providers.filter(p=>['AUTH_REQUIRED','ERROR','CUSTOM_CONFIGURATION'].includes(mcpConnectionState(p))).length:'—']].map(([label,value])=><div key={label} className="min-w-0 border border-neutral-700 rounded-md p-2"><div className="text-lg font-semibold tabular-nums">{value}</div><div className="text-[10px] text-neutral-400">{label}</div></div>)}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-neutral-700 pb-2" aria-label="Integration views">
        {([['all','All'],['configured','Configured'],['available','Available'],['directory','Directory']] as const).map(([id,label])=><button key={id} type="button" onClick={()=>setScope(id)} aria-pressed={scope===id} className={'rounded px-2 py-1.5 text-xs '+(scope===id?'bg-[#31445a] text-sky-100':'text-neutral-400 hover:text-white')}>{label}</button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label="Search integration catalog" placeholder="Search integrations" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-[120px] flex-1 rounded border border-neutral-700 bg-[#15171a] px-3 py-2 text-xs"/>
        <select aria-label="Plugin category" value={category} onChange={e=>setCategory(e.target.value)} className="min-w-0 rounded border border-neutral-700 bg-[#15171a] p-2 text-xs">
          {[['all','All categories'],['development','Development'],['cloud','Cloud'],['marketing','Marketing'],['commerce','Commerce'],['finance','Finance'],['marketplace','Marketplace']].map(([id,label])=><option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      {!fresh&&<p role="status" className="text-[11px] text-neutral-400">Refresh the runtime observation before changing a connection. Select All or Directory to browse documentation.</p>}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
        {MCP_INTEGRATION_CATALOG.filter(p=>(category==='all'||pluginCategory(p)===category)&&matches(p)&&scope!=='directory'&&(scope==='all'||(fresh&&(scope==='configured'?providers.some(v=>v.id===p.id):!providers.some(v=>v.id===p.id))))).map(p=>{
          const row=providers.find(v=>v.id===p.id);
          const state=mcpConnectionState(row,fresh);
          return <button type="button" key={p.id} aria-haspopup="dialog" aria-label={"Review "+p.name+" integration"} onClick={()=>{setFormError(null);setSelectedPlugin(p.id);}} className="rounded-lg border border-neutral-700 bg-[#22262c] px-3 py-3 text-left hover:border-sky-700 focus-visible:outline focus-visible:outline-sky-300">
            <div className="flex items-center gap-3"><PluginLogo id={p.id} name={p.name} icon={p.icon} size={28}/><div className="min-w-0 flex-1"><strong className="block text-xs text-neutral-100">{p.name}</strong><span className="block text-[10px] text-neutral-400">{environmentLabel(p.id)}</span></div><span aria-hidden="true" className="text-neutral-500">›</span></div>
            <div className="mt-2 text-[10px] text-neutral-300">{statusLabel(state)}</div>
          </button>;
        })}
        {marketplaceEntries(providers).filter(p=>(category==='all'||p.category===category)&&matches(p)&&(scope==='all'||scope==='directory'||(scope==='configured'&&fresh&&p.status==='EXISTING_HOST'&&providers.some(v=>v.id===p.id)))).map(p=><button type="button" key={p.id} aria-haspopup="dialog" aria-label={"Review "+p.name+" integration"} onClick={()=>{setFormError(null);setSelectedPlugin(p.id);}} className="rounded-lg border border-neutral-700 bg-[#22262c] px-3 py-3 text-left hover:border-sky-700 focus-visible:outline focus-visible:outline-sky-300">
          <div className="flex gap-3 items-center"><PluginLogo id={p.id} name={p.name} size={28}/><div className="min-w-0 flex-1"><strong className="block text-xs text-neutral-100">{p.name}</strong><span className="block text-[10px] text-neutral-400"> {p.status==='EXISTING_HOST'?'Existing integration':'Directory entry'}</span></div><span aria-hidden="true" className="text-neutral-500">›</span></div>
          <div className="mt-2 text-[10px] text-neutral-300">{statusLabel(p.status==='EXISTING_HOST'&&!fresh?'UNOBSERVED':p.state)}</div>
        </button>)}
      </div>
      <dialog ref={modal} aria-labelledby="plugin-detail-title" onClose={()=>{setSelectedPlugin('');setFormError(null);}} onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.close();}} className="m-auto w-[min(94vw,480px)] max-h-[85dvh] overflow-auto rounded-xl border border-neutral-600 bg-[#1c2026] p-0 text-neutral-100 backdrop:bg-black/70">
        {selected&&<div className="p-5 space-y-4">
          <header className="flex items-center gap-3"><PluginLogo id={selected.id} name={selected.name} size={36}/><div className="min-w-0 flex-1"><h3 id="plugin-detail-title" className="font-semibold">{selected.name}</h3><p className="text-xs text-neutral-400">{environmentLabel(selected.id)}</p></div><button autoFocus type="button" aria-label="Close integration details" onClick={()=>modal.current?.close()} className="rounded border border-neutral-600 px-2 py-1">×</button></header>
          <p className="text-xs text-neutral-300">{selected.purpose||'Connection and account settings'}</p>
          <dl className="space-y-2 rounded-lg border border-neutral-700 p-3 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-neutral-400">Connection</dt><dd>{statusLabel(preset?evidence.state:directory?.status==='EXISTING_HOST'&&!fresh?'UNOBSERVED':directory?.state||'UNOBSERVED')}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-neutral-400">Agent access</dt><dd>{evidence.agentAccess?ACCESS_LABEL[evidence.agentAccess]:'Not observed'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-neutral-400">Discovered / allowed read tools</dt><dd>{evidence.toolsDiscovered??'—'} / {evidence.allowedReadTools??'—'}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-neutral-400">Last recorded tool call</dt><dd className="text-right">{evidence.lastCall?evidence.lastCall.outcome+' · '+new Date(evidence.lastCall.at).toLocaleString():'Not observed'}</dd></div>
          </dl>
          {preset&&<div className="space-y-2 text-xs"><h4 className="font-semibold">Authentication</h4><p className="text-neutral-400">{preset.auth}</p><p className="break-all text-neutral-400">{preset.target}</p>{preset.tokenEnv&&<p className="text-neutral-400">Credential reference: <code>{preset.tokenEnv}</code></p>}</div>}
          {selectedPlugin==='linear'&&<LinearOAuthPanel fresh={fresh} onChanged={onChanged}/>}
          {current&&fresh&&<div className="space-y-2 text-xs">
            {current.catalogMatch===false&&<p role="status" className="text-amber-300">This ID has a custom configuration. Catalog settings are not applied.</p>}
            {current.credentialEnv!=='JACO_MCP_OAUTH_LINEAR'&&(current.loginOpeningSupported||current.allowOpenLogin)&&<label className="flex gap-2 items-start"><input type="checkbox" checked={current.allowOpenLogin===true} disabled={working!==null||(!current.allowOpenLogin&&!current.loginOpeningSupported)} onChange={e=>void updateLoginAccess(e.target.checked)}/><span>Allow Aura to open the approved account page. No credential submission or consent.</span></label>}
            <button type="button" disabled={busy!==null||working!==null} onClick={()=>onStart(current.id)} className="rounded border border-neutral-600 px-3 py-2 disabled:opacity-40">Discover tools</button>
          </div>}
          {!current&&fresh&&preset&&preset.id!=='linear'&&<button type="button" disabled={working!==null} onClick={()=>{setDraft(mcpCatalogDraft(preset.id));modal.current?.close();setAdding(true);}} className="rounded bg-[#314a66] px-4 py-2 text-xs font-medium">Configure connection</button>}
          {formError&&<p role="alert" className="text-xs text-amber-300">{formError}</p>}
          <div className="border-t border-neutral-700 pt-3 flex justify-between gap-2"><a href={selected.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-300 underline">Provider documentation</a><button type="button" onClick={()=>modal.current?.close()} className="text-xs text-neutral-300">Close</button></div>
          <p className="text-[10px] text-neutral-400">Tool discovery or a transport acknowledgement does not verify a business outcome.</p>
        </div>}
      </dialog>
      <details className="rounded border border-neutral-700 p-2">
        <summary className="cursor-pointer text-xs font-semibold">MCP Marketplace · Search public registry</summary>
        <form className="flex gap-2 mt-2" onSubmit={e=>{e.preventDefault();void searchRegistry();}}>
          <input className="min-w-0 flex-1 bg-[#1d1e20] border border-neutral-700 rounded px-2 text-xs" aria-label="Search public MCP Registry" placeholder="e.g. marketing" maxLength={100} value={registryQuery} onChange={e=>setRegistryQuery(e.target.value)}/>
          <button className="border border-neutral-600 rounded px-2 py-1 text-xs disabled:opacity-40" disabled={registryBusy||registryQuery.trim().length<3}>Search</button>
        </form>
        <p className="text-xs text-neutral-400 mt-2">Directory listings are not trusted installations. Review publisher, credentials, permissions and costs separately.</p>
        {registryBusy&&<p role="status">Searching…</p>}{registryError&&<p role="alert">{registryError}</p>}
        {registry&&<ul className="space-y-2 max-h-72 overflow-auto mt-2">{registry.entries.map((r,i)=><li key={r.name+'@'+r.version+'-'+i} className="border-b border-neutral-700 pb-1 text-xs break-words"><strong>{r.title||r.name}</strong><div>{r.name} · {r.version}</div><p>{r.description}</p><span className="text-neutral-400">Discovered · not verified</span></li>)}{!registry.entries.length&&<li>No active latest entries on this page.</li>}{registry.hasMore&&<li>More results exist. Narrow your search.</li>}</ul>}
      </details>
    </section>

    <dialog ref={setupModal} aria-labelledby="mcp-setup-title" onClose={()=>{setAdding(false);setFormError(null);}} className="m-auto w-[min(94vw,480px)] max-h-[85dvh] overflow-auto rounded-xl border border-neutral-600 bg-[#1c2026] p-0 text-neutral-100 backdrop:bg-black/70">{adding&&<div className="p-5 space-y-3" aria-label="Add MCP server"><header className="flex items-center justify-between gap-2"><h3 id="mcp-setup-title" className="font-semibold">Configure integration</h3><button type="button" aria-label="Close setup" onClick={()=>setupModal.current?.close()} className="rounded border border-neutral-600 px-2 py-1">×</button></header>
      <div className="flex gap-1.5">
        <input aria-label="Server id" value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value.toLowerCase(),allowOpenLogin:false })} placeholder="id, e.g. github" className="min-w-0 flex-1 bg-[#1d1e20] border border-[#505153] rounded px-2 py-1 text-[10px] outline-none" />
        <input aria-label="Name" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name" className="min-w-0 flex-1 bg-[#1d1e20] border border-[#505153] rounded px-2 py-1 text-[10px] outline-none" />
      </div>
      <input aria-label="Command or address" value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value, tokenEnv: '',allowOpenLogin:false })} placeholder="npx -y @modelcontextprotocol/server-memory  or  https://…/mcp" className="w-full bg-[#1d1e20] border border-[#505153] rounded px-2 py-1 text-[10px] font-mono outline-none" />
      <div className="flex gap-1.5 items-center">
        <select aria-label="Logo" value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value })} className="bg-[#1d1e20] border border-[#505153] rounded px-1 py-1 text-[10px]">
          {ICON_CHOICES.map(i => <option key={i} value={i}>{i === 'jaco' ? 'JACO' : MCP_LOGOS[i].title}</option>)}
        </select>
        <McpLogo icon={draft.icon} />
        <select aria-label="Agent access" value={draft.agentAccess} onChange={e => setDraft({ ...draft, agentAccess: e.target.value })} className="ml-auto bg-[#1d1e20] border border-[#505153] rounded px-1 py-1 text-[10px]">
          {Object.entries(ACCESS_LABEL).filter(([v])=>draft.tokenEnv.trim()!=='JACO_MCP_OAUTH_LINEAR'||v!=='write').map(([v, l]) => <option key={v} value={v}>Agents: {l}</option>)}
        </select>
      </div>
      {/^https:\/\//i.test(draft.target.trim())&&<label className="block text-xs text-neutral-300">Bearer credential environment variable (optional)
        <input aria-label="Credential environment variable" value={draft.tokenEnv} onChange={e=>setDraft({...draft,tokenEnv:e.target.value,allowOpenLogin:false})} placeholder="e.g. RENDER_API_KEY" className="block w-full rounded border border-neutral-700 bg-[#1d1e20] px-2 py-1"/>
      </label>}
      {MCP_INTEGRATION_CATALOG.some(p=>p.id===draft.id && p.target===draft.target && p.loginUrl) && <label className="flex items-start gap-2 text-xs text-neutral-300"><input type="checkbox" checked={draft.allowOpenLogin} onChange={e=>setDraft({...draft,allowOpenLogin:e.target.checked})}/>Allow Aura to open this provider's official sign-in page when authentication is needed. Does not grant access to passwords, consent or new scopes.</label>}
      <p className="text-xs text-neutral-400">Use an existing environment variable name, never paste the secret here. Remote writes require explicit server write access and an applicable signed operator mandate. For supported account sign-in, use the provider dialog.</p>
      {formError && <p role="status" className="text-[10px] text-amber-300 break-words">{formError}</p>}
      <button onClick={() => void add()} disabled={!fresh||working !== null} className="w-full rounded border border-neutral-700 py-1 text-[10px] text-neutral-200 disabled:opacity-40">{working === '__add' ? 'Connecting…' : 'Save and connect'}</button>
    </div>}</dialog>

    {providers.map(p => {
      const s = p.stats;
      const last = s?.lastCall;
      return <div key={p.id} className="border-b border-[#414244]">
        <div className="px-3 py-1.5 flex items-start gap-2">
          <span className={`mt-0.5 ${fresh && p.status === 'READY' ? '' : 'opacity-50'}`}><PluginLogo id={p.id} name={p.name} icon={p.icon} size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-neutral-200">{p.name}</div>
            <div className="text-[8px] text-neutral-500 truncate" title={p.endpoint}>{p.role}</div>
          </div>
          <span className={`text-[8px] ${fresh && p.status === 'READY' && p.catalogMatch!==false ? 'text-emerald-400' : p.status === 'FAILED' ? 'text-amber-400' : 'text-neutral-500'}`}>{statusLabel(mcpConnectionState(p,fresh))}</span>
          {managed(p) && p.status !== 'READY' && <button onClick={() => onStart(p.id)} disabled={!fresh||busy !== null} className="text-[8px] border border-violet-800 text-violet-300 rounded px-1.5 py-0.5 hover:bg-violet-950/30 disabled:opacity-40">{busy === p.id ? 'Starting…' : 'Start'}</button>}
        </div>
        {managed(p) && <div className="px-3 pb-1.5 flex items-center gap-2 text-[9px]">
          <label className="text-neutral-400 flex items-center gap-1">Agents
            <select aria-label={`Agent access ${p.name}`} value={p.agentAccess || 'read'} disabled={!fresh||working !== null} onChange={e => void setAccess(p.id, e.target.value)} className="bg-[#1d1e20] border border-[#505153] rounded px-1 py-0.5 text-[9px] text-neutral-200 disabled:opacity-60">
              {Object.entries(ACCESS_LABEL).filter(([v])=>p.credentialEnv!=='JACO_MCP_OAUTH_LINEAR'||v!=='write').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {!!p.deny?.length && <span className="text-neutral-500 truncate" title={`Never for agents: ${p.deny.join(', ')}`}>blocked: {p.deny.join(', ')}</span>}
          <button onClick={() => p.credentialEnv==='JACO_MCP_OAUTH_LINEAR'?setSelectedPlugin('linear'):void remove(p)} disabled={working !== null} className="ml-auto text-neutral-400 hover:text-red-300 disabled:opacity-40">{p.credentialEnv==='JACO_MCP_OAUTH_LINEAR'?'Manage account':p.builtIn ? 'Turn off' : 'Remove'}</button>
        </div>}
        {s && (s.calls > 0 || s.refused > 0) && <div className="px-3 pb-1 text-[9px] text-neutral-400">
          {s.calls} calls · {s.failures} errors · {s.refused} refused
          {last && <span className="block truncate" title={last.error || ''}>Last {when(last.at)}: {last.tool} by {last.actor === 'agent' ? 'agent' : 'operator'} → <span className={outcomeClass(last.outcome)}>{OUTCOME_LABEL[last.outcome] || last.outcome}</span> ({last.ms} ms){last.error ? ` · ${last.error}` : ''}</span>}
        </div>}
        {p.error && p.status !== 'READY' && <div className="px-5 pb-1 text-[8px] text-amber-500/80 break-words">{p.error}</div>}
        {p.tools.map(t => <button key={t.name} onClick={() => onSelectTool(p, t)} disabled={p.status !== 'READY'} title={t.description}
          className={`w-full text-left px-5 py-1.5 hover:bg-[#464749] disabled:opacity-30 flex items-center gap-2 ${selectedToolId === `mcp:${p.id}:${t.name}` ? 'bg-[#3d3e40]' : ''}`}>
          <span className={`w-2 h-2 rounded-full ${t.readOnly ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`} />
          <span className="text-[10px] text-neutral-200 truncate">{t.name}</span>
          <span className="ml-auto text-[8px] text-neutral-500">{t.readOnly ? 'reads' : 'writes'}{t.agentAllowed === false ? ' · not for agents' : ''}</span>
        </button>)}
      </div>;
    })}

    {recentCalls.length > 0 && <div className="px-3 pt-2" aria-label="Latest MCP calls">
      <div className="text-[9px] uppercase tracking-wider text-neutral-500 mb-1">Latest calls</div>
      {recentCalls.slice(0, 10).map((c, i) => <div key={`${c.at}-${i}`} className="text-[9px] text-neutral-400 truncate" title={c.error || ''}>
        {when(c.at)} {c.server}.{c.tool} · {c.actor === 'agent' ? 'agent' : 'operator'} → <span className={outcomeClass(c.outcome)}>{OUTCOME_LABEL[c.outcome] || c.outcome}</span> {c.ms} ms
      </div>)}
    </div>}
  </section>;
}
