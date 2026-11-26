import React, { useState } from 'react';
import { MCP_LOGOS } from './mcpLogos';
import { MCP_INTEGRATION_CATALOG, mcpCatalogDraft, mcpConnectionState } from '../lib/mcpIntegrationCatalog.mjs';

// JACO's MCP servers as the operator manages them (operator 2026-10-09): each with its logo, what it
// answered, what agents may do with it, and the last calls. Servers are added here without editing
// .jaco/mcp/servers.json by hand. Every number shown is the host's own record (stdioMcpHost.mjs).
export interface McpTool { name: string; description: string; readOnly: boolean; agentAllowed?: boolean; inputSchema?: Record<string, any> }
export interface McpCallRecord { server?: string; tool: string; actor: string; outcome: string; error: string | null; ms: number; at: string }
export interface McpProvider {
  id: string; name: string; role: string; status: string; transport?: string; endpoint?: string; error: string | null; tools: McpTool[];
  credentialEnv?: string; credentialConfigured?: boolean | null; allowOpenLogin?: boolean;
  icon?: string; agentAccess?: 'off' | 'read' | 'write'; deny?: string[]; builtIn?: boolean;
  stats?: { calls: number; failures: number; refused: number; lastCall: McpCallRecord | null };
}
interface Props {
  providers: McpProvider[];
  recentCalls: McpCallRecord[];
  busy: string | null;
  selectedToolId: string | null;
  onStart: (id: string) => void;
  onSelectTool: (provider: McpProvider, tool: McpTool) => void;
  onChanged: (notice: string) => void;
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

export function McpServersPanel({ providers, recentCalls, busy, selectedToolId, onStart, onSelectTool, onChanged }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: '', name: '', target: '', icon: 'mcp', agentAccess: 'read', tokenEnv: '', allowOpenLogin: false });
  const [query, setQuery] = useState('');
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
    const target = draft.target.trim();
    const http = /^https:\/\//i.test(target);
    const parts = http ? [] : splitCommandLine(target);
    if (!draft.id.trim() || !target || (!http && !parts.length)) { setFormError('Enter an id and a command or https address.'); return; }
    if (http && draft.tokenEnv && !/^[A-Z][A-Z0-9_]{0,79}$/.test(draft.tokenEnv.trim())) { setFormError('Enter a variable name, not a token value.'); return; }
    if (providers.some(p=>p.id===draft.id.trim()) && !window.confirm('Replace this existing connection configuration?')) return;
    const entry = http
      ? { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), transport: 'http', url: target, tokenEnv: draft.tokenEnv.trim() || null, icon: draft.icon, agentAccess: draft.agentAccess, allowOpenLogin: draft.allowOpenLogin === true }
      : { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), command: parts[0], args: parts.slice(1), icon: draft.icon, agentAccess: draft.agentAccess };
    setWorking('__add');
    try {
      await send('/api/aura/workbench/mcp/servers', 'POST', entry);
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
      {failedCustom.length > 0 && <button onClick={() => void quarantineFailed()} disabled={working !== null} title="Disable observed failed custom connections without deleting their configuration. Built-in and healthy servers remain unchanged." className="ml-auto text-[9px] text-amber-300 border border-amber-800 rounded px-1.5 py-0.5 disabled:opacity-40">Disable failed ({failedCustom.length})</button>}
      <button onClick={() => setAdding(v => !v)} className={`${failedCustom.length ? 'ml-1.5' : 'ml-auto'} text-[9px] text-neutral-200 border border-neutral-800 rounded px-1.5 py-0.5 hover:bg-neutral-900/30`}>{adding ? 'Close' : '+ Add'}</button>
    </div>

    <div className="mx-3 mb-3 rounded border border-neutral-700 p-3 space-y-2" aria-label="Official MCP integrations">
      <h3 className="text-sm font-semibold text-neutral-200">Plugin Center</h3>
      <p className="text-xs text-neutral-400">Official endpoints. Select a connection to review its configuration. Nothing is installed or authenticated until you explicitly save and connect.</p>
      <input aria-label="Search integration catalog" placeholder="Search providers" value={query} onChange={e=>setQuery(e.target.value)} className="w-full rounded border border-neutral-700 bg-[#1d1e20] px-2 py-1 text-sm"/>
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
        {MCP_INTEGRATION_CATALOG.filter(p=>(p.name+' '+p.auth).toLowerCase().includes(query.trim().toLowerCase())).map(p=>{
          const current=providers.find(v=>v.id===p.id);
          return <article key={p.id} className="rounded border border-neutral-700 p-2 space-y-1">
            <div className="flex items-center gap-2"><McpLogo icon={p.icon}/><strong className="text-xs">{p.name}</strong></div>
            <div className="text-xs text-neutral-400" role="status">{mcpConnectionState(current).replaceAll('_',' ')}</div>
            <details className="text-xs text-neutral-400"><summary>Authentication</summary><p>{p.auth}</p></details>
            <div className="flex flex-wrap items-center gap-2"><button type="button" disabled={working!==null} onClick={()=>{setDraft({...mcpCatalogDraft(p.id),allowOpenLogin:current?.allowOpenLogin===true});setFormError(null);setAdding(true);}} className="rounded border border-neutral-600 px-2 py-1 text-xs">{current?'Review configuration':'Configure'}</button>
            <a className="text-xs underline text-neutral-300" href={p.docs} target="_blank" rel="noopener noreferrer">Official setup</a></div>
          </article>;
        })}
      </div>
    </div>

    {adding && <div className="mx-3 mb-2 p-2 rounded border border-[#5a5b5d] bg-[#27282a] space-y-1.5" aria-label="Add MCP server">
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
          {Object.entries(ACCESS_LABEL).map(([v, l]) => <option key={v} value={v}>Agents: {l}</option>)}
        </select>
      </div>
      {/^https:\/\//i.test(draft.target.trim())&&<label className="block text-xs text-neutral-300">Bearer credential environment variable (optional)
        <input aria-label="Credential environment variable" value={draft.tokenEnv} onChange={e=>setDraft({...draft,tokenEnv:e.target.value,allowOpenLogin:false})} placeholder="e.g. RENDER_API_KEY" className="block w-full rounded border border-neutral-700 bg-[#1d1e20] px-2 py-1"/>
      </label>}
      {MCP_INTEGRATION_CATALOG.some(p=>p.id===draft.id && p.target===draft.target && p.loginUrl) && <label className="flex items-start gap-2 text-xs text-neutral-300"><input type="checkbox" checked={draft.allowOpenLogin} onChange={e=>setDraft({...draft,allowOpenLogin:e.target.checked})}/>Allow Aura to open this provider's official sign-in page when authentication is needed. Does not grant access to passwords, consent or new scopes.</label>}
      <p className="text-xs text-neutral-400">Use an existing environment variable name, never paste the secret here. Remote writes require explicit server write access and an applicable signed operator mandate. Browser-based OAuth is not yet implemented in this MCP host.</p>
      {formError && <p role="status" className="text-[10px] text-amber-300 break-words">{formError}</p>}
      <button onClick={() => void add()} disabled={working !== null} className="w-full rounded border border-neutral-700 py-1 text-[10px] text-neutral-200 disabled:opacity-40">{working === '__add' ? 'Connecting…' : 'Save and connect'}</button>
    </div>}

    {providers.map(p => {
      const s = p.stats;
      const last = s?.lastCall;
      return <div key={p.id} className="border-b border-[#414244]">
        <div className="px-3 py-1.5 flex items-start gap-2">
          <span className={`mt-0.5 ${p.status === 'READY' ? '' : 'opacity-50'}`}><McpLogo icon={p.icon} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-neutral-200">{p.name}</div>
            <div className="text-[8px] text-neutral-500 truncate" title={p.endpoint}>{p.role}</div>
          </div>
          <span className={`text-[8px] ${p.status === 'READY' ? 'text-emerald-400' : p.status === 'FAILED' ? 'text-amber-400' : 'text-neutral-500'}`}>{mcpConnectionState(p).replaceAll('_',' ')}</span>
          {managed(p) && p.status !== 'READY' && <button onClick={() => onStart(p.id)} disabled={busy !== null} className="text-[8px] border border-violet-800 text-violet-300 rounded px-1.5 py-0.5 hover:bg-violet-950/30 disabled:opacity-40">{busy === p.id ? 'Starting…' : 'Start'}</button>}
        </div>
        {managed(p) && <div className="px-3 pb-1.5 flex items-center gap-2 text-[9px]">
          <label className="text-neutral-400 flex items-center gap-1">Agents
            <select aria-label={`Agent access ${p.name}`} value={p.agentAccess || 'read'} disabled={working !== null} onChange={e => void setAccess(p.id, e.target.value)} className="bg-[#1d1e20] border border-[#505153] rounded px-1 py-0.5 text-[9px] text-neutral-200 disabled:opacity-60">
              {Object.entries(ACCESS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {!!p.deny?.length && <span className="text-neutral-500 truncate" title={`Never for agents: ${p.deny.join(', ')}`}>blocked: {p.deny.join(', ')}</span>}
          <button onClick={() => void remove(p)} disabled={working !== null} className="ml-auto text-neutral-400 hover:text-red-300 disabled:opacity-40">{p.builtIn ? 'Turn off' : 'Remove'}</button>
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
