import { useUiLanguage } from '../i18n/UiLanguage';
import React, { useEffect, useState } from 'react';
import { PlugZap, ExternalLink, CheckCircle2 } from 'lucide-react';

interface Provider { id: string; name: string; role: string; status: string; transport?: string; credentialEnv?: string; endpoint?: string; tools: Array<{name: string; readOnly: boolean}>; error?: string | null }
interface PresenceAgent { agentId: string; name: string; status: string; liveSessions: number; lastSeenAt: string | null }
interface Props { workplace?: { reachable: boolean; agents: PresenceAgent[]; error: string | null }; observedAt?: string; providers: Provider[]; busy: string | null; onConnect: (id: string) => void; onHuggingFace: (enabled: boolean, tokenEnv: string) => void; notice: string | null }
const profiles = [
  { id: 'git', name: 'Git', category: 'Repository', description: 'Historik, diff och repository-verktyg. GitHub-konto hanteras separat under Git.', docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git' },
  { id: 'filesystem', name: "Files", category: "Workspace", description: "Files in the configured workspace. Changes follow existing permissions.", docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem' },
  { id: 'fetch', name: 'Webb', category: 'Research', description: "Retrieve and read web content through tools.", docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch' },
  { id: 'cloudflare', name: 'Cloudflare', category: 'Drift', description: "Read-only connection for account access and Workers inventory.", docs: 'https://developers.cloudflare.com/agents/model-context-protocol/' },
  { id: 'huggingface', name: 'Hugging Face', category: 'AI-resurser', description: "Connect the official tool server for models, datasets, papers and documentation.", docs: 'https://huggingface.co/docs/hub/agents-mcp' },
];
export function AuraIntegrationsPanel({ workplace, observedAt, providers, busy, onConnect, onHuggingFace, notice }: Props) {
  const { t: uiText } = useUiLanguage();
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
  const seen = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('sv-SE') : uiText("No timestamp");
  const [tokenDraft, setTokenEnv] = useState<string | null>(null);
  const tokenEnv = tokenDraft ?? providers.find(p => p.id === 'huggingface')?.credentialEnv ?? '';
  return <section aria-label={uiText("Tool connections")} className="p-3 space-y-3 border-b border-[#343b45]">
    <div className="flex items-center gap-2"><PlugZap className="w-4 h-4 text-cyan-400" /><h3 className="text-xs font-semibold text-slate-200">{uiText("Connections")}</h3></div>
    <section aria-label={uiText("Active agents and tools")} className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-200">{uiText("Agents and connections")}</h4>
      <p className="text-[11px] text-slate-400">{uiText("Active means a live execution session. An open application or configuration file does not confirm a connection.")}</p>
      <p role="status" className={fresh ? 'text-[10px] text-slate-500' : 'text-[10px] text-amber-300'}>{fresh ? uiText("Observed: ") : uiText("Outdated or missing observation: ")}{seen(observedAt || null)}</p>
      {known.map(client => {
        const matches = agents.filter(agent => client.match.test(agent.name + ' ' + agent.agentId));
        const active = matches.filter(agent => agent.liveSessions > 0);
        const available = fresh && workplace?.reachable === true;
        const label = !available ? uiText("Unknown status") : active.length ? active.some(agent => agent.status === 'BUSY') ? uiText("Working") : uiText("Active") : matches.length ? uiText("Disconnected") : uiText("Not observed");
        return <div key={client.name} className="rounded border border-[#343b45] p-2 text-[11px]">
          <div className="flex justify-between gap-2"><span>{client.name}</span><span className={available && active.length ? 'text-emerald-400' : 'text-slate-400'}>{label}</span></div>
          {active.map(agent => <p key={agent.agentId} className="text-[10px] text-slate-500 break-words">{agent.name} · {agent.liveSessions} {' '}{uiText("live sessions · Last seen:")}{' '}{seen(agent.lastSeenAt)}</p>)}
          {matches.length > active.length && <p className="text-[10px] text-slate-500">{matches.length - active.length} {' '}{uiText("earlier registrations without a live session.")}</p>}
        </div>;
      })}
      {!workplace?.reachable && <p className="text-[10px] text-amber-300">{uiText("The coordination service cannot confirm agent sessions.")}</p>}
      {agents.filter(agent => !known.some(client => client.match.test(agent.name + ' ' + agent.agentId))).map(agent => <div key={agent.agentId} className="rounded border border-[#343b45] p-2 text-[11px]"><div className="flex justify-between gap-2"><span>{agent.name}</span><span className={fresh && workplace?.reachable && agent.liveSessions > 0 ? 'text-emerald-400' : 'text-slate-400'}>{!fresh || !workplace?.reachable ? uiText("Unknown status") : agent.liveSessions > 0 ? agent.status === 'BUSY' ? uiText("Working") : uiText("Active") : uiText("Disconnected")}</span></div><p className="text-[10px] text-slate-500">{uiText("Last seen:")}{' '}{seen(agent.lastSeenAt)}</p></div>)}
      <h4 className="pt-2 text-xs font-semibold text-slate-200">{uiText("Tool servers (MCP)")}</h4>
      <p className="text-[10px] text-slate-500">{uiText("Known tool servers. Responding means JACO observed a server response; it does not confirm use by an external agent.")}</p>
      {providers.map(provider => <div key={provider.id} className="rounded border border-[#343b45] p-2 text-[11px]"><div className="flex justify-between gap-2"><span>{provider.name || provider.id}</span><span className={fresh && provider.status === 'READY' ? 'text-emerald-400' : 'text-slate-400'}>{!fresh ? uiText("Unknown status") : provider.status === 'READY' ? uiText("Responding") : provider.status}</span></div><p className="text-[10px] text-slate-500">{provider.transport || uiText("Transport not provided")} · {provider.tools.length} {' '}{uiText("tools observed")}</p>{provider.error && <p className="text-[10px] text-amber-300 break-words">{provider.error}</p>}</div>)}
      {!providers.length && <p className="text-[11px] text-slate-500">{uiText("No tool servers observed.")}</p>}
    </section>
    <p className="text-[11px] text-slate-400">{uiText("Choose a connection, connect it and check the tools it announces.")}</p>
    {profiles.map(profile => {
      const provider = providers.find(p => p.id === profile.id);
      const connected = provider?.status === 'READY';
      return <article key={profile.id} className="rounded-lg border border-[#343b45] bg-[#111820] p-3 space-y-2">
        <div className="flex gap-2 items-center"><h4 className="text-xs font-semibold text-slate-200">{profile.name}</h4><span className="ml-auto text-[10px] text-slate-400">{profile.category}</span></div>
        <p className="text-[11px] leading-relaxed text-slate-400">{profile.description}</p>
        <div className={`text-[10px] flex items-center gap-1 ${connected ? 'text-emerald-400' : 'text-amber-300'}`}>{connected && <CheckCircle2 className="w-3 h-3" />}{provider?.status || uiText("Not configured")} · {profile.id === 'huggingface' ? 'Streamable HTTP' : provider?.transport || 'stdio'} · {provider?.tools.length ?? 0} {' '}{uiText("tools observed")}</div>
        {profile.id === 'huggingface' && <>
          <label className="block text-[10px] text-slate-400">{uiText("Hugging Face authentication")}<select aria-label={uiText("Hugging Face authentication")} value={tokenEnv} onChange={e => setTokenEnv(e.target.value)} className="block mt-1 w-full rounded border border-[#343b45] bg-[#07111b] p-1.5 text-slate-200"><option value="">{uiText("Without a token — the server may require sign-in")}</option><option value="HUGGINGFACE_TOKEN">{uiText("HUGGINGFACE_TOKEN")}</option><option value="HF_TOKEN">{uiText("HF_TOKEN")}</option></select></label>
          <p className="text-[10px] text-slate-500">{uiText("The server reads the token from the selected environment variable. Signing into Hugging Face in a browser does not connect JACO automatically.")}</p>
          <p className="text-[10px] text-slate-500">{uiText("Remote tools must advertise read access. Changes and paid work require additional permission.")}</p>
          <a className="text-[10px] text-cyan-400" href="https://huggingface.co/settings/mcp" target="_blank" rel="noreferrer">{uiText("Open Hugging Face tool settings")}</a>
        </>}
        {provider?.error && <p role="status" className="text-[10px] text-amber-300 break-words">{provider.error}</p>}
        <div className="flex gap-3 items-center">
          <button aria-label={`Anslut ${profile.name}`} disabled={busy !== null || (connected && profile.id !== 'huggingface') || (!provider && profile.id !== 'huggingface')} onClick={() => profile.id === 'huggingface' ? onHuggingFace(true,tokenEnv) : onConnect(profile.id)} className="rounded border border-cyan-800 px-2 py-1 text-[11px] text-cyan-300 disabled:opacity-40">{busy === profile.id ? uiText("Connecting…") : connected ? profile.id === 'huggingface' ? uiText("Reconnect") : 'Ansluten' : uiText("Connect")}</button>
          {profile.id === 'huggingface' && provider && <button disabled={busy !== null} className="text-[10px] text-slate-400" onClick={() => onHuggingFace(false,tokenEnv)}>{uiText("Disconnect")}</button>}
          <a href={profile.docs} target="_blank" rel="noreferrer" className="ml-auto text-[10px] text-cyan-400 flex gap-1 items-center">{uiText("Documentation")}<ExternalLink className="w-3 h-3" /></a>
        </div>
      </article>;
    })}
    {notice && <p role="status" className="text-[11px] text-cyan-200 break-words">{notice}</p>}
  </section>;
}
