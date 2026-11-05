import React, { useCallback, useEffect, useState } from 'react';

// "What Aura can do": everything is on from the start, the operator unticks what they do not want.
// Plain words on purpose. Tasks and skills are switched by /api/aura/capabilities; connected tools (MCP)
// keep their own access and deny list.
interface Task { id: string; label: string; enabled: boolean }
interface Group { id: string; name: string; description: string; tasks: Task[] }
interface Skill { id: string; name: string; description: string; enabled: boolean }
interface Fixed { id: string; label: string; why: string }
interface McpTool { name: string; description?: string }
interface McpServer { id: string; name: string; role?: string; status?: string; agentAccess?: string; deny?: string[]; tools?: McpTool[] }

const READ_ONLY_PRESET = ['repo-write', 'repo-edit', 'repo-service', 'git-commit', 'git-push', 'git-merge', 'github-create-repo', 'shell', 'invoke-worker',
  'browser-click', 'browser-type', 'desktop-action', 'desktop-invoke', 'mouse-move', 'mouse-click', 'mouse-scroll', 'key-press', 'type-text',
  'android-open-app', 'android-tap', 'android-type', 'android-scroll', 'android-back', 'android-home', 'mcp-write', 'secret-store', 'vault-generate-secret'];

const send = (body: unknown, url = '/api/aura/capabilities', method = 'PATCH') =>
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    .then(async r => { const data = await r.json().catch(() => ({})); if (!r.ok || data.success === false) throw new Error(String(data.error || `HTTP ${r.status}`)); return data; });

function Check({ checked, mixed, onChange, label }: { checked: boolean; mixed?: boolean; onChange: (on: boolean) => void; label: string }) {
  return <input type="checkbox" aria-label={label} checked={checked} ref={el => { if (el) el.indeterminate = Boolean(mixed) && !checked; }}
    onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18, flex: '0 0 auto' }} />;
}

export function CapabilitiesPanel({ mcp, onMcpChanged }: { mcp: McpServer[]; onMcpChanged: () => void }) {
  const [groups, setGroups] = useState<Group[]>([]), [skills, setSkills] = useState<Skill[]>([]), [fixed, setFixed] = useState<Fixed[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/aura/capabilities', { cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(r => r.json());
      if (data.success === false) throw new Error(data.error);
      setGroups(data.groups || []); setSkills(data.skills || []); setFixed(data.alwaysAsk || []); setError('');
    } catch (e: any) { setError(String(e?.message || e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const change = async (run: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try { await run(); await load(); onMcpChanged(); } catch (e: any) { setError(String(e?.message || e)); } finally { setBusy(false); }
  };
  const setTasks = (ids: string[], on: boolean) => change(() => send({ tasks: Object.fromEntries(ids.map(id => [id, on])) }));
  const all = groups.flatMap(g => g.tasks);
  const off = all.filter(t => !t.enabled).length;
  const mcpTools = mcp.flatMap(s => (s.tools || []).map(t => ({ s, t })));
  const mcpOn = mcpTools.filter(({ s, t }) => s.agentAccess !== 'off' && !(s.deny || []).includes(t.name)).length;
  const preset = (name: 'everything' | 'no-computer' | 'look-only') => {
    const ids = all.map(t => t.id);
    const wanted = new Set(name === 'everything' ? [] : name === 'look-only' ? READ_ONLY_PRESET
      : groups.filter(g => g.id === 'desktop' || g.id === 'android').flatMap(g => g.tasks.map(t => t.id)));
    return change(() => send({ tasks: Object.fromEntries(ids.map(id => [id, !wanted.has(id)])) }));
  };
  const setServer = (s: McpServer, on: boolean) =>
    change(() => send({ agentAccess: on ? 'write' : 'off' }, `/api/aura/workbench/mcp/servers/${encodeURIComponent(s.id)}/access`));
  const setTool = (s: McpServer, tool: string, on: boolean) => {
    const deny = new Set(s.deny || []);
    if (on) deny.delete(tool); else deny.add(tool);
    return change(() => send({ deny: [...deny] }, `/api/aura/workbench/mcp/servers/${encodeURIComponent(s.id)}/access`));
  };

  return <section className="capabilities" aria-label="What Aura can do">
    <h3>What Aura can do</h3>
    <p>Everything below is switched on from the start, so Aura can use your computer, the web and your tools to get a job done on its own.
      Untick what you do not want. A change counts from Aura's next step.</p>
    <p role="status"><strong>{all.length - off + mcpOn + skills.filter(s => s.enabled).length}</strong> abilities on
      {off + (mcpTools.length - mcpOn) + skills.filter(s => !s.enabled).length > 0 ? <> · <strong>{off + (mcpTools.length - mcpOn) + skills.filter(s => !s.enabled).length}</strong> turned off by you</> : null}</p>
    {error && <p role="alert">{error}</p>}
    <div className="capabilities-presets" role="group" aria-label="Quick choices">
      <button type="button" disabled={busy} onClick={() => void preset('everything')}>Everything on</button>
      <button type="button" disabled={busy} onClick={() => void preset('no-computer')}>Without controlling my computer or phone</button>
      <button type="button" disabled={busy} onClick={() => void preset('look-only')}>Look and read only</button>
    </div>
    {fixed.length > 0 && <article className="capabilities-fixed"><strong>Aura always asks you first about</strong>
      <ul>{fixed.map(f => <li key={f.id}><strong>{f.label}.</strong> {f.why}</li>)}</ul></article>}

    {groups.map(group => {
      const on = group.tasks.filter(t => t.enabled).length;
      return <details key={group.id} className="capabilities-group">
        <summary><Check label={group.name} checked={on === group.tasks.length} mixed={on > 0} onChange={v => void setTasks(group.tasks.map(t => t.id), v)} />
          <span><strong>{group.name}</strong><small>{group.description}</small></span><em>{on}/{group.tasks.length}</em></summary>
        <ul>{group.tasks.map(task => <li key={task.id}><label><Check label={task.label} checked={task.enabled} onChange={v => void setTasks([task.id], v)} /> {task.label}</label></li>)}</ul>
      </details>;
    })}

    {mcp.length > 0 && <details className="capabilities-group">
      <summary><span><strong>Connected tools (MCP)</strong><small>Programs Aura can call: files, git, web fetch, JACO itself and more.</small></span><em>{mcpOn}/{mcpTools.length}</em></summary>
      {mcp.map(s => <div key={s.id} className="capabilities-server">
        <label><Check label={s.name} checked={s.agentAccess !== 'off'} onChange={v => void setServer(s, v)} /> <strong>{s.name}</strong> <small>{s.role}</small></label>
        {s.agentAccess !== 'off' && <ul>{(s.tools || []).map(t => <li key={t.name}><label><Check label={t.name} checked={!(s.deny || []).includes(t.name)} onChange={v => void setTool(s, t.name, v)} /> {t.name}</label></li>)}</ul>}
      </div>)}
    </details>}

    {skills.length > 0 && <details className="capabilities-group">
      <summary><span><strong>Skills</strong><small>Ready-made ways of doing things that Aura can follow.</small></span><em>{skills.filter(s => s.enabled).length}/{skills.length}</em></summary>
      <ul>{skills.map(s => <li key={s.id}><label><Check label={s.name} checked={s.enabled} onChange={v => void change(() => send({ skills: { [s.id]: v } }))} /> <strong>{s.name}</strong> <small>{s.description}</small></label></li>)}</ul>
    </details>}
  </section>;
}
