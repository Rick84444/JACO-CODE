import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useRef, useState } from 'react';

// Skills view: JACO's SKILL.md procedures as read from disk. "Run as mission" creates a Nova mission
// limited to the skill's declared tasks; its progress shows under MISSIONS like any other mission.
interface SkillSummary { id: string; name: string; description: string; tasks: string[]; source: string; error?: string }
interface SkillDetail extends SkillSummary { body: string; truncated: boolean }
// What JACO learned from its own missions (agents/lib/skill-learning.mjs); nothing is used before approval.
interface Proposal { key: string; kind: 'tool-note' | 'skill'; status: string; missionId: string; tool?: string; note?: string; id?: string; skillMd?: string; namedBy?: string | null; createdAt: string; installedAs?: string }

export const SkillsView: React.FC = () => {
  const [skillUrl,setSkillUrl]=useState('');
  const [installing,setInstalling]=useState(false),[installId,setInstallId]=useState(''),[skillContent,setSkillContent]=useState(''),[testCommands,setTestCommands]=useState('');
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [error, setError] = useState('');
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const selectionRequest = useRef(0);
  const [open, setOpen] = useState<SkillDetail | null>(null);
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  // Where the mission runs: this computer ('nova') or a joined device (Devices view).
  const [executors, setExecutors] = useState<{ executor: string; label: string }[]>([{ executor: 'nova', label: 'This computer' }]);
  const [executor, setExecutor] = useState('nova');

  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [openProposal, setOpenProposal] = useState<string | null>(null);
  const load = async () => {
    try {
      const body = await fetch('/api/aura/workbench/skills').then(readAuraResponse);
      if (!body.success) throw new Error(body.error || 'SKILLS_UNAVAILABLE');
      setSkills(body.skills); setError('');
    } catch (e: any) { setError(String(e?.message || e)); }
    try {
      const body = await fetch('/api/aura/workbench/skill-proposals').then(readAuraResponse);
      if (body.success) setProposals(body.proposals);
      setSourceErrors(current => ({ ...current, proposals: '' }));
    } catch (e: any) { setSourceErrors(current => ({ ...current, proposals: `Skill proposals unavailable: ${e.message}. The earlier observation may be stale.` })); }
    try {
      const body = await fetch('/api/aura/workbench/devices').then(readAuraResponse);
      if (body.success) setExecutors([{ executor: 'nova', label: 'This computer' }, ...body.devices.filter((d: any) => !d.revokedAt && d.kind !== 'ide')
        .map((d: any) => ({ executor: d.executor, label: `${d.name}${d.online ? '' : ' (not connected, waiting in queue)'}` }))]);
      setSourceErrors(current => ({ ...current, devices: '' }));
    } catch (e: any) { setSourceErrors(current => ({ ...current, devices: `The device list is unavailable: ${e.message}.` })); }
  };
  const decide = async (key: string, decision: 'approve' | 'reject') => {
    try {
      const body = await fetch(`/api/aura/workbench/skill-proposals/${encodeURIComponent(key)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error);
      await load();
    } catch (e: any) { setError(`The decision could not be confirmed. Refresh the proposal list: ${String(e?.message || e)}`); }
  };
  const pending = proposals.filter(p => p.status === 'PENDING');
  useEffect(() => { void load(); }, []);

  const select = async (id: string) => {
    const request = ++selectionRequest.current;
    setOpen(null); setResult(''); setInput(''); setTestCommands('');
    try {
      const body = await fetch(`/api/aura/workbench/skills/${encodeURIComponent(id)}`).then(readAuraResponse);
      if (!body.success) throw new Error(body.error);
      if (request === selectionRequest.current) setOpen(body.skill);
    } catch (e: any) { if (request === selectionRequest.current) setResult(`Could not read skill: ${String(e?.message || e)}`); }
  };
  const run = async () => {
    if (!open || !input.trim()) return;
    setBusy(true); setResult('');
    try {
      const res = await fetch(`/api/aura/workbench/skills/${encodeURIComponent(open.id)}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input, executor, testCommands:testCommands.split(/\r?\n/).filter(Boolean) }),
      });
      const body = await readAuraResponse(res);
      if (!body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setResult(`${body.mission.deduplicated ? 'Joined open mission' : 'Mission created'} ${body.mission.id}${executor === 'nova' ? '' : ` on ${executor}`} · follow it under MISSIONS`);
      setInput('');
    } catch (e: any) { setResult(`The start could not be confirmed. Check the mission list before retrying: ${String(e?.message || e)}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-neutral-400 flex items-center justify-between">
        <span>Skills</span>
        <button onClick={() => void load()} className="text-[9px] text-neutral-300 hover:text-neutral-300">Refresh</button>
      </div>
      <div className="flex-1 overflow-auto px-2 space-y-2 text-[11px] min-w-0">
        <details><summary>Add a skill</summary>
          <label>Fetch from address<input value={skillUrl} placeholder="https://github.com/…/SKILL.md" onChange={e=>setSkillUrl(e.target.value)}/></label>
          <button type="button" disabled={installing||!skillUrl.trim()} onClick={async()=>{setInstalling(true);setError('');try{const data=await fetch('/api/aura/workbench/skills/install-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:skillUrl.trim(),id:installId.trim()||undefined})}).then(readAuraResponse);setResult('Installed from address: '+data.skill.name);setSkillUrl('');setInstallId('');await load();}catch(error:any){setError(error.message);}finally{setInstalling(false);}}}>Install from address</button>
          <label>Skill ID<input value={installId} placeholder="my-skill" onChange={e=>setInstallId(e.target.value)}/></label>
          <label>Import SKILL.md<input type="file" accept=".md,text/markdown,text/plain" onChange={async e=>{const file=e.target.files?.[0];if(file){if(file.size>24000){setError('The skill file is too large.');return;}setSkillContent(await file.text());}}}/></label>
          <label>SKILL.md<textarea rows={8} value={skillContent} onChange={e=>setSkillContent(e.target.value)} placeholder={'---\nname: My skill\ndescription: What it does\ntasks: [web-fetch]\n---\nInstructions for the skill.'}/></label>
          <button type="button" disabled={installing||!installId||!skillContent} onClick={async()=>{setInstalling(true);setError('');try{const data=await fetch('/api/aura/workbench/skills/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:installId,content:skillContent})}).then(readAuraResponse);setResult('Installed: '+data.skill.name);setSkillContent('');setInstallId('');await load();}catch(error:any){setError(error.message);}finally{setInstalling(false);}}}>Install skill</button>
        </details>
        {Object.entries(sourceErrors).filter(([, message]) => message).map(([source, message]) => <div key={source} role="status" className="text-amber-300 p-2">{message}</div>)}
        {result && !open && <div role="alert" className="text-amber-300 p-2">{result}</div>}
        {error && <div className="border border-red-900 text-red-300 rounded p-2 break-words">{error}</div>}
        {pending.length > 0 && (
          <div className="border border-amber-800 bg-[#1f1a10] rounded p-2 space-y-1.5 min-w-0">
            <div className="text-[10px] text-amber-300">JACO has learned {pending.length} thing(s) from its missions. Nothing is used until you approve it.</div>
            {pending.map(p => (
              <div key={p.key} className="border border-[#3a3220] rounded p-1.5 min-w-0">
                <div className="text-[10px] text-neutral-200 break-words">
                  {p.kind === 'tool-note' ? <>Tool note for <span className="text-neutral-300">{p.tool}</span>: {p.note}</> : <>New skill: <span className="text-neutral-300">{p.id}</span></>}
                </div>
                <div className="text-[9px] text-neutral-500 break-all">from {p.missionId}{p.namedBy ? ` · named by ${p.namedBy}` : ''}</div>
                {p.kind === 'skill' && (
                  <button onClick={() => setOpenProposal(openProposal === p.key ? null : p.key)} className="text-[9px] text-neutral-300 hover:text-neutral-300">
                    {openProposal === p.key ? 'Hide' : 'Show SKILL.md'}
                  </button>
                )}
                {openProposal === p.key && <pre className="whitespace-pre-wrap break-words text-[9px] text-neutral-300 max-h-48 overflow-auto">{p.skillMd}</pre>}
                <div className="flex gap-1.5 mt-1">
                  <button onClick={() => void decide(p.key, 'approve')} className="px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white text-[9px]">Approve</button>
                  <button onClick={() => void decide(p.key, 'reject')} className="px-1.5 py-0.5 rounded bg-[#3a2a2a] hover:bg-[#4a3030] text-neutral-200 text-[9px]">Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!skills && !error && <div className="text-neutral-500 px-1">Reading skills…</div>}
        {skills?.length === 0 && <div className="text-neutral-500 px-1">No skills. Add skills/&lt;id&gt;/SKILL.md to the repository.</div>}
        {skills?.map(s => (
          <button key={s.id} disabled={busy} onClick={() => void select(s.id)}
            className={`w-full text-left border rounded p-2 min-w-0 ${open?.id === s.id ? 'border-neutral-700 bg-[#1c1d1f]' : 'border-[#323335] bg-[#1c1d1f] hover:border-[#545557]'}`}>
            <div className="text-neutral-100 truncate">{s.name}</div>
            {s.error
              ? <div className="text-red-300 text-[10px] break-words">{s.error}</div>
              : <div className="text-neutral-400 text-[10px]">{s.description}</div>}
            <div className="text-[9px] text-neutral-600 truncate">tasks: {s.tasks.join(', ') || '-'}</div>
          </button>
        ))}
        {open && (
          <div className="border border-[#323335] bg-[#131416] rounded p-2 space-y-2 min-w-0">
            <div className="text-[9px] text-neutral-500 break-all">{open.source}</div>
            {open.tasks.some(task=>task.startsWith('repo-')||task.startsWith('git-'))&&<p>Code skills run as missions in the open Git project, with their own project contract.</p>}
            <pre className="whitespace-pre-wrap break-words text-[10px] text-neutral-300 max-h-64 overflow-auto">{open.body}{open.truncated ? '\n[truncated]' : ''}</pre>
            {open.tasks.includes('repo-test')&&<label>Test commands, one per line<textarea value={testCommands} onChange={e=>setTestCommands(e.target.value)} placeholder="npm test"/></label>}
            <textarea disabled={busy} value={input} onChange={e => setInput(e.target.value)} rows={3} placeholder="Input for this run (e.g. what to look at)"
              className="w-full bg-[#0a0b0d] border border-[#323335] rounded p-1 text-[11px] text-neutral-200" />
            {executors.length > 1 && (
              <label className="flex items-center gap-1.5 text-[10px] text-neutral-400">Run on
                <select value={executor} onChange={e => setExecutor(e.target.value)} className="flex-1 min-w-0 bg-[#0a0b0d] border border-[#323335] rounded p-0.5 text-[10px] text-neutral-200">
                  {executors.map(x => <option key={x.executor} value={x.executor}>{x.label}</option>)}
                </select>
              </label>
            )}
            <button onClick={() => void run()} disabled={busy || !input.trim()}
              className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-white text-[10px] disabled:opacity-40">
              {busy ? 'Starting…' : 'Run as mission'}
            </button>
            {result && <div className="text-[10px] text-neutral-300 break-words">{result}</div>}
          </div>
        )}
      </div>
    </>
  );
};
