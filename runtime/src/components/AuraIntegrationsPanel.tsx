import React, { useEffect, useState } from 'react';
import { PlugZap, ExternalLink, CheckCircle2 } from 'lucide-react';

interface Provider { id: string; name: string; role: string; status: string; transport?: string; credentialEnv?: string; endpoint?: string; tools: Array<{name: string; readOnly: boolean}>; error?: string | null }
interface PresenceAgent { agentId: string; name: string; status: string; liveSessions: number; lastSeenAt: string | null }
interface Props { workplace?: { reachable: boolean; agents: PresenceAgent[]; error: string | null }; observedAt?: string; providers: Provider[]; busy: string | null; onConnect: (id: string) => void; onHuggingFace: (enabled: boolean, tokenEnv: string) => void; notice: string | null }
const profiles = [
  { id: 'git', name: 'Git', category: 'Repository', description: 'History, diff and repository tools. The GitHub account is managed separately under Git.', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git' },
  { id: 'filesystem', name: 'Files', category: 'Workspace', description: 'Files within the configured workspace. Write operations follow the existing permission gates.', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
  { id: 'fetch', name: 'Web', category: 'Research', description: 'Fetch and read web content through MCP.', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Operations', description: 'Existing read-only integration for account connection and Workers inventory.', docs: 'https://developers.cloudflare.com/agents/model-context-protocol/' },
  { id: 'huggingface', name: 'Hugging Face', category: 'AI resources', description: 'Connect to the official MCP for models, datasets, papers and documentation.', docs: 'https://huggingface.co/docs/hub/agents-mcp' },
];
export function AuraIntegrationsPanel({ workplace, observedAt, providers, busy, onConnect, onHuggingFace, notice }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const fresh = Boolean(observedAt && Number.isFinite(Date.parse(observedAt)) && now - Date.parse(observedAt) <= 15000);
  const known = [
    { name: 'Codex', match: /codex/i },
    { name: 'VS Code', match: /vs[ -]?code|visual studio code/i },
    { name: 'Claude', match: /claude/i },
    { name: 'Cursor', match: /cursor/i },
    { name: 'ChatGPT', match: /chatgpt/i },
  ];
  const agents = workplace?.agents || [];
  const seen = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-US') : 'No timestamp';
  const [tokenDraft, setTokenEnv] = useState<string | null>(null);
  const tokenEnv = tokenDraft ?? providers.find(p => p.id === 'huggingface')?.credentialEnv ?? '';
  return <section aria-label="MCP integrations" className="p-3 space-y-3 border-b border-[#5a5b5d]">
    <div className="flex items-center gap-2"><PlugZap className="w-4 h-4 text-neutral-200" /><h3 className="text-xs font-semibold text-neutral-200">Integrations</h3></div>
    <section aria-label="Active agents and MCP" className="space-y-2">
      <h4 className="text-xs font-semibold text-neutral-200">Agents and connections</h4>
      <p className="text-[11px] text-neutral-300">Active means a live session in JACO Workplace. An open program or a configuration file does not confirm a connection.</p>
      <p role="status" className={fresh ? 'text-[10px] text-neutral-400' : 'text-[10px] text-amber-300'}>{fresh ? 'Observed: ' : 'Stale or missing observation: '}{seen(observedAt || null)}</p>
      {known.map(client => {
        const matches = agents.filter(agent => client.match.test(agent.name + ' ' + agent.agentId));
        const active = matches.filter(agent => agent.liveSessions > 0);
        const available = fresh && workplace?.reachable === true;
        const label = !available ? 'Unknown status' : active.length ? active.some(agent => agent.status === 'BUSY') ? 'Working' : 'Active' : matches.length ? 'Disconnected' : 'Not observed';
        return <div key={client.name} className="rounded border border-[#5a5b5d] p-2 text-[11px]">
          <div className="flex justify-between gap-2"><span>{client.name}</span><span className={available && active.length ? 'text-emerald-400' : 'text-neutral-300'}>{label}</span></div>
          {active.map(agent => <p key={agent.agentId} className="text-[10px] text-neutral-400 break-words">{agent.name} · {agent.liveSessions} live sessions · Last seen: {seen(agent.lastSeenAt)}</p>)}
          {matches.length > active.length && <p className="text-[10px] text-neutral-400">{matches.length - active.length} earlier registrations without a live session.</p>}
        </div>;
      })}
      {!workplace?.reachable && <p className="text-[10px] text-amber-300">Workplace cannot confirm the agent sessions.</p>}
      {agents.filter(agent => !known.some(client => client.match.test(agent.name + ' ' + agent.agentId))).map(agent => <div key={agent.agentId} className="rounded border border-[#5a5b5d] p-2 text-[11px]"><div className="flex justify-between gap-2"><span>{agent.name}</span><span className={fresh && workplace?.reachable && agent.liveSessions > 0 ? 'text-emerald-400' : 'text-neutral-300'}>{!fresh || !workplace?.reachable ? 'Unknown status' : agent.liveSessions > 0 ? agent.status === 'BUSY' ? 'Working' : 'Active' : 'Disconnected'}</span></div><p className="text-[10px] text-neutral-400">Last seen: {seen(agent.lastSeenAt)}</p></div>)}
      <h4 className="pt-2 text-xs font-semibold text-neutral-200">MCP servers</h4>
      <p className="text-[10px] text-neutral-400">Shows servers JACO knows about. Responding means the runtime has observed the server's response; it does not confirm that an external agent is using it.</p>
      {providers.map(provider => <div key={provider.id} className="rounded border border-[#5a5b5d] p-2 text-[11px]"><div className="flex justify-between gap-2"><span>{provider.name || provider.id}</span><span className={fresh && provider.status === 'READY' ? 'text-emerald-400' : 'text-neutral-300'}>{!fresh ? 'Unknown status' : provider.status === 'READY' ? 'Responding' : provider.status}</span></div><p className="text-[10px] text-neutral-400">{provider.transport || 'Transport not specified'} · {provider.tools.length} tools observed</p>{provider.error && <p className="text-[10px] text-amber-300 break-words">{provider.error}</p>}</div>)}
      {!providers.length && <p className="text-[11px] text-neutral-400">No MCP servers observed.</p>}
    </section>
    <p className="text-[11px] text-neutral-300">Choose an integration, connect, and check which tools the server actually advertises.</p>
    {profiles.map(profile => {
      const provider = providers.find(p => p.id === profile.id);
      const connected = provider?.status === 'READY';
      return <article key={profile.id} className="rounded-lg border border-[#5a5b5d] bg-[#27282a] p-3 space-y-2">
        <div className="flex gap-2 items-center"><h4 className="text-xs font-semibold text-neutral-200">{profile.name}</h4><span className="ml-auto text-[10px] text-neutral-300">{profile.category}</span></div>
        <p className="text-[11px] leading-relaxed text-neutral-300">{profile.description}</p>
        <div className={`text-[10px] flex items-center gap-1 ${connected ? 'text-emerald-400' : 'text-amber-300'}`}>{connected && <CheckCircle2 className="w-3 h-3" />}{provider?.status || 'Not configured'} · {profile.id === 'huggingface' ? 'Streamable HTTP' : provider?.transport || 'stdio'} · {provider?.tools.length ?? 0} tools observed</div>
        {profile.id === 'huggingface' && <>
          <label className="block text-[10px] text-neutral-300">Hugging Face authentication<select aria-label="Hugging Face authentication" value={tokenEnv} onChange={e => setTokenEnv(e.target.value)} className="block mt-1 w-full rounded border border-[#5a5b5d] bg-[#1d1e20] p-1.5 text-neutral-200"><option value="">No token — the server may require sign-in</option><option value="HUGGINGFACE_TOKEN">HUGGINGFACE_TOKEN</option><option value="HF_TOKEN">HF_TOKEN</option></select></label>
          <p className="text-[10px] text-neutral-400">The token is read on the server from the selected environment variable. Signing in to Hugging Face in the browser does not automatically pass authentication to JACO.</p>
          <p className="text-[10px] text-neutral-400">Remote tools must advertise read-only access. Writes and paid jobs require additional authority.</p>
          <a className="text-[10px] text-neutral-200" href="https://huggingface.co/settings/mcp" target="_blank" rel="noreferrer">Open Hugging Face MCP settings</a>
        </>}
        {provider?.error && <p role="status" className="text-[10px] text-amber-300 break-words">{provider.error}</p>}
        <div className="flex gap-3 items-center">
          <button aria-label={`Connect ${profile.name}`} disabled={busy !== null || (connected && profile.id !== 'huggingface') || (!provider && profile.id !== 'huggingface')} onClick={() => profile.id === 'huggingface' ? onHuggingFace(true,tokenEnv) : onConnect(profile.id)} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-200 disabled:opacity-40">{busy === profile.id ? 'Connecting…' : connected ? profile.id === 'huggingface' ? 'Reconnect' : 'Connected' : 'Connect'}</button>
          {profile.id === 'huggingface' && provider && <button disabled={busy !== null} className="text-[10px] text-neutral-300" onClick={() => onHuggingFace(false,tokenEnv)}>Disconnect</button>}
          <a href={profile.docs} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-neutral-200 flex gap-1 items-center">Documentation<ExternalLink className="w-3 h-3" /></a>
        </div>
      </article>;
    })}
    {notice && <p role="status" className="text-[11px] text-neutral-200 break-words">{notice}</p>}
  </section>;
}
