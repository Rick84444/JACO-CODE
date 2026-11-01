import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useState } from 'react';
import { MCP_LOGOS } from './mcpLogos';

// JACO's MCP servers as the operator manages them (operator 2026-10-09): each with its logo, what it
// answered, what agents may do with it, and the last calls. Servers are added here without editing
// .jaco/mcp/servers.json by hand. Every number shown is the host's own record (stdioMcpHost.mjs).
export interface McpTool { name: string; description: string; readOnly: boolean; agentAllowed?: boolean; inputSchema?: Record<string, any> }
export interface McpCallRecord { server?: string; tool: string; actor: string; outcome: string; error: string | null; ms: number; at: string }
export interface McpProvider {
  id: string; name: string; role: string; status: string; transport?: string; endpoint?: string; error: string | null; tools: McpTool[];
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
  const { t: uiText } = useUiLanguage();
  if (icon === 'jaco') return <img src="/branding/jaco-icon-192.png" alt={uiText("JACO")} width={size} height={size} className="rounded-sm shrink-0" />;
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

const ACCESS_LABEL: Record<string, string> = { off: "Off", read: "Read", write: "Read and write" };
const OUTCOME_LABEL: Record<string, string> = { ok: 'ok', tool_error: "tool error", failed: "error", refused: "refused" };
const outcomeClass = (o: string) => o === 'ok' ? 'text-emerald-400' : o === 'refused' ? 'text-amber-300' : 'text-red-400';
const when = (at: string) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t).toLocaleTimeString('sv-SE') : ''; };
const ICON_CHOICES = Object.keys(MCP_LOGOS).concat('jaco');

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `HTTP_${res.status}`);
  return data;
}

export function McpServersPanel({ providers, recentCalls, busy, selectedToolId, onStart, onSelectTool, onChanged }: Props) {
  const { t: uiText } = useUiLanguage();
  const [working, setWorking] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ id: '', name: '', target: '', icon: 'mcp', agentAccess: 'read' });
  const [formError, setFormError] = useState<string | null>(null);

  const setAccess = async (id: string, agentAccess: string) => {
    setWorking(id);
    try { await send(`/api/aura/workbench/mcp/servers/${encodeURIComponent(id)}/access`, 'PATCH', { agentAccess }); onChanged(uiText("Agent access on {0}: {1}", [id, ACCESS_LABEL[agentAccess]])); }
    catch (e: any) { onChanged(uiText("Could not change access to {0}: {1}", [id, e.message])); }
    finally { setWorking(null); }
  };
  const remove = async (p: McpProvider) => {
    if (!window.confirm(p.builtIn ? uiText("Disable {0}? Add it again to enable it.", [p.name]) : uiText("Remove {0}?", [p.name]))) return;
    setWorking(p.id);
    try { const r = await send(`/api/aura/workbench/mcp/servers/${encodeURIComponent(p.id)}`, 'DELETE'); onChanged(uiText("{0} {1}", [p.name, r.removed ? 'borttagen' : uiText("disabled")])); }
    catch (e: any) { onChanged(uiText("Could not remove {0}: {1}", [p.name, e.message])); }
    finally { setWorking(null); }
  };
  const add = async () => {
    setFormError(null);
    const target = draft.target.trim();
    const http = /^https:\/\//i.test(target);
    const parts = http ? [] : splitCommandLine(target);
    if (!draft.id.trim() || !target || (!http && !parts.length)) { setFormError(uiText("Enter an ID and a command or HTTPS address.")); return; }
    const entry = http
      ? { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), transport: 'http', url: target, icon: draft.icon, agentAccess: draft.agentAccess }
      : { id: draft.id.trim(), name: draft.name.trim() || draft.id.trim(), command: parts[0], args: parts.slice(1), icon: draft.icon, agentAccess: draft.agentAccess };
    setWorking('__add');
    try {
      await send('/api/aura/workbench/mcp/servers', 'POST', entry);
      try { await send('/api/aura/workbench/mcp/start','POST',{providerId:entry.id}); onChanged(uiText("{0} connected. Tool list received.", [entry.name])); }
      catch(error:any) { onChanged(uiText("{0} saved, but the connection failed: {1}", [entry.name, error.message])); }
      setDraft({ id: '', name: '', target: '', icon: 'mcp', agentAccess: 'read' }); setAdding(false);
    } catch (e: any) { setFormError(e.message); }
    finally { setWorking(null); }
  };

  const managed = (p: McpProvider) => ['stdio', 'http'].includes(p.transport || '');
  return <section aria-label={uiText("Tool servers (MCP)")} className="pb-2">
    <div className="px-3 py-1.5 mt-2 flex items-center">
      <span className="text-[9px] uppercase tracking-wider text-slate-600">{uiText("Connected tool servers")}</span>
      <button onClick={() => setAdding(v => !v)} className="ml-auto text-[9px] text-cyan-300 border border-cyan-900 rounded px-1.5 py-0.5 hover:bg-cyan-950/30">{adding ? uiText("Close") : uiText("+ Add")}</button>
    </div>

    {adding && <div className="mx-3 mb-2 p-2 rounded border border-[#343b45] bg-[#111820] space-y-1.5" aria-label={uiText("Add tool server")}>
      <div className="flex gap-1.5">
        <input aria-label={uiText("Server ID")} value={draft.id} onChange={e => setDraft({ ...draft, id: e.target.value.toLowerCase() })} placeholder={uiText("id, for example github")} className="min-w-0 flex-1 bg-[#07111b] border border-[#333] rounded px-2 py-1 text-[10px] outline-none" />
        <input aria-label={uiText("Name")} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={uiText("Name")} className="min-w-0 flex-1 bg-[#07111b] border border-[#333] rounded px-2 py-1 text-[10px] outline-none" />
      </div>
      <input aria-label={uiText("Command or address")} value={draft.target} onChange={e => setDraft({ ...draft, target: e.target.value })} placeholder={uiText("npx -y @modelcontextprotocol/server-memory  or  https://…/mcp")} className="w-full bg-[#07111b] border border-[#333] rounded px-2 py-1 text-[10px] font-mono outline-none" />
      <div className="flex gap-1.5 items-center">
        <select aria-label={uiText("Icon")} value={draft.icon} onChange={e => setDraft({ ...draft, icon: e.target.value })} className="bg-[#07111b] border border-[#333] rounded px-1 py-1 text-[10px]">
          {ICON_CHOICES.map(i => <option key={i} value={i}>{i === 'jaco' ? 'JACO' : MCP_LOGOS[i].title}</option>)}
        </select>
        <McpLogo icon={draft.icon} />
        <select aria-label={uiText("Agent access")} value={draft.agentAccess} onChange={e => setDraft({ ...draft, agentAccess: e.target.value })} className="ml-auto bg-[#07111b] border border-[#333] rounded px-1 py-1 text-[10px]">
          {Object.entries(ACCESS_LABEL).map(([v, l]) => <option key={v} value={v}>{uiText("Agents:")}{' '}{uiText(l)}</option>)}
        </select>
      </div>
      <p className="text-[9px] text-slate-500">{uiText("Use credential references such as $")}{'{'}{uiText("NAME")}{'}'} {' '}{uiText("and read from .env. Values are never saved in this configuration. Remote HTTPS servers allow agents to read only.")}</p>
      {formError && <p role="status" className="text-[10px] text-amber-300 break-words">{formError}</p>}
      <button onClick={() => void add()} disabled={working !== null} className="w-full rounded border border-cyan-800 py-1 text-[10px] text-cyan-300 disabled:opacity-40">{working === '__add' ? uiText("Connecting…") : uiText("Save and connect")}</button>
    </div>}

    {providers.map(p => {
      const s = p.stats;
      const last = s?.lastCall;
      return <div key={p.id} className="border-b border-[#292929]">
        <div className="px-3 py-1.5 flex items-start gap-2">
          <span className={`mt-0.5 ${p.status === 'READY' ? '' : 'opacity-50'}`}><McpLogo icon={p.icon} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-slate-300">{p.name}</div>
            <div className="text-[8px] text-slate-600 truncate" title={p.endpoint}>{p.role}</div>
          </div>
          <span className={`text-[8px] ${p.status === 'READY' ? 'text-emerald-400' : p.status === 'FAILED' ? 'text-amber-400' : 'text-slate-600'}`}>{p.status}</span>
          {managed(p) && p.status !== 'READY' && <button onClick={() => onStart(p.id)} disabled={busy !== null} className="text-[8px] border border-violet-800 text-violet-300 rounded px-1.5 py-0.5 hover:bg-violet-950/30 disabled:opacity-40">{busy === p.id ? uiText("Starting…") : uiText("Start")}</button>}
        </div>
        {managed(p) && <div className="px-3 pb-1.5 flex items-center gap-2 text-[9px]">
          <label className="text-slate-500 flex items-center gap-1">{uiText("Agents")}{' '}<select aria-label={uiText("Agent access to {0}", [p.name])} value={p.agentAccess || 'read'} disabled={working !== null || p.transport === 'http'} onChange={e => void setAccess(p.id, e.target.value)} className="bg-[#07111b] border border-[#333] rounded px-1 py-0.5 text-[9px] text-slate-200 disabled:opacity-60">
              {Object.entries(ACCESS_LABEL).filter(([v]) => p.transport !== 'http' || v !== 'write').map(([v, l]) => <option key={v} value={v}>{uiText(l)}</option>)}
            </select>
          </label>
          {!!p.deny?.length && <span className="text-slate-600 truncate" title={uiText("Blocked for agents: {0}", [p.deny.join(', ')])}>{uiText("blocked:")}{' '}{p.deny.join(', ')}</span>}
          <button onClick={() => void remove(p)} disabled={working !== null} className="ml-auto text-slate-500 hover:text-red-300 disabled:opacity-40">{p.builtIn ? uiText("Disable") : uiText("Remove")}</button>
        </div>}
        {s && (s.calls > 0 || s.refused > 0) && <div className="px-3 pb-1 text-[9px] text-slate-500">
          {s.calls} {' '}{uiText("calls ·")}{' '}{s.failures} {' '}{uiText("errors ·")}{' '}{s.refused} {' '}{uiText("refused")}{' '}{last && <span className="block truncate" title={last.error || ''}>{uiText("Last")}{' '}{when(last.at)}: {last.tool} {' '}{uiText("by")}{' '}{last.actor === 'agent' ? 'agent' : uiText("operator")} → <span className={outcomeClass(last.outcome)}>{uiText(OUTCOME_LABEL[last.outcome] || last.outcome)}</span> ({last.ms} {' '}{uiText("ms)")}{last.error ? ` · ${last.error}` : ''}</span>}
        </div>}
        {p.error && p.status !== 'READY' && <div className="px-5 pb-1 text-[8px] text-amber-500/80 break-words">{p.error}</div>}
        {p.tools.map(t => <button key={t.name} onClick={() => onSelectTool(p, t)} disabled={p.status !== 'READY'} title={t.description}
          className={`w-full text-left px-5 py-1.5 hover:bg-[#2a2d2e] disabled:opacity-30 flex items-center gap-2 ${selectedToolId === `mcp:${p.id}:${t.name}` ? 'bg-[#2b2240]' : ''}`}>
          <span className={`w-2 h-2 rounded-full ${t.readOnly ? 'bg-emerald-500/70' : 'bg-amber-500/70'}`} />
          <span className="text-[10px] text-slate-300 truncate">{t.name}</span>
          <span className="ml-auto text-[8px] text-slate-600">{t.readOnly ? uiText("reads") : uiText("writes")}{t.agentAllowed === false ? uiText(" · agents blocked") : ''}</span>
        </button>)}
      </div>;
    })}

    {recentCalls.length > 0 && <div className="px-3 pt-2" aria-label={uiText("Recent tool calls")}>
      <div className="text-[9px] uppercase tracking-wider text-slate-600 mb-1">{uiText("Recent calls")}</div>
      {recentCalls.slice(0, 10).map((c, i) => <div key={`${c.at}-${i}`} className="text-[9px] text-slate-500 truncate" title={c.error || ''}>
        {when(c.at)} {c.server}.{c.tool} · {c.actor === 'agent' ? 'agent' : uiText("operator")} → <span className={outcomeClass(c.outcome)}>{uiText(OUTCOME_LABEL[c.outcome] || c.outcome)}</span> {c.ms} {' '}{uiText("ms")}{' '}</div>)}
    </div>}
  </section>;
}
