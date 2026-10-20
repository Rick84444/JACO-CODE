import { readAuraResponse } from '../lib/auraApi.mjs';
import React, { useEffect, useRef, useState } from 'react';

// Skills view: JACO's SKILL.md procedures as read from disk. "Run as mission" creates a Nova mission
// limited to the skill's declared tasks; its progress shows under MISSIONS like any other mission.
interface SkillSummary { id: string; name: string; description: string; tasks: string[]; source: string; error?: string }
interface SkillDetail extends SkillSummary { body: string; truncated: boolean }
// What JACO learned from its own missions (agents/lib/skill-learning.mjs); nothing is used before approval.
interface Proposal { key: string; kind: 'tool-note' | 'skill'; status: string; missionId: string; tool?: string; note?: string; id?: string; skillMd?: string; namedBy?: string | null; createdAt: string; installedAs?: string }

export const SkillsView: React.FC = () => {
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
  const [executors, setExecutors] = useState<{ executor: string; label: string }[]>([{ executor: 'nova', label: 'Den här datorn' }]);
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
    } catch (e: any) { setSourceErrors(current => ({ ...current, proposals: `Skill-förslag otillgängliga: ${e.message}. Tidigare observation kan vara föråldrad.` })); }
    try {
      const body = await fetch('/api/aura/workbench/devices').then(readAuraResponse);
      if (body.success) setExecutors([{ executor: 'nova', label: 'Den här datorn' }, ...body.devices.filter((d: any) => !d.revokedAt && d.kind !== 'ide')
        .map((d: any) => ({ executor: d.executor, label: `${d.name}${d.online ? '' : ' (ej ansluten, väntar i kö)'}` }))]);
      setSourceErrors(current => ({ ...current, devices: '' }));
    } catch (e: any) { setSourceErrors(current => ({ ...current, devices: `Enhetslistan är otillgänglig: ${e.message}.` })); }
  };
  const decide = async (key: string, decision: 'approve' | 'reject') => {
    try {
      const body = await fetch(`/api/aura/workbench/skill-proposals/${encodeURIComponent(key)}/decision`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }),
      }).then(readAuraResponse);
      if (!body.success) throw new Error(body.error);
      await load();
    } catch (e: any) { setError(`Beslutet kunde inte bekräftas. Uppdatera förslagslistan: ${String(e?.message || e)}`); }
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
    } catch (e: any) { setResult(`Start kunde inte bekräftas. Kontrollera uppdragslistan före nytt försök: ${String(e?.message || e)}`); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-400 flex items-center justify-between">
        <span>Skills</span>
        <button onClick={() => void load()} className="text-[9px] text-cyan-400 hover:text-cyan-300">Refresh</button>
      </div>
      <div className="flex-1 overflow-auto px-2 space-y-2 text-[11px] min-w-0">
        <details><summary>Lägg till en skill</summary>
          <label>Skill-ID<input value={installId} placeholder="min-fardighet" onChange={e=>setInstallId(e.target.value)}/></label>
          <label>Importera SKILL.md<input type="file" accept=".md,text/markdown,text/plain" onChange={async e=>{const file=e.target.files?.[0];if(file){if(file.size>24000){setError('Skill-filen är för stor.');return;}setSkillContent(await file.text());}}}/></label>
          <label>SKILL.md<textarea rows={8} value={skillContent} onChange={e=>setSkillContent(e.target.value)} placeholder={'---\nname: Min färdighet\ndescription: Vad den gör\ntasks: [web-fetch]\n---\nInstruktioner för färdigheten.'}/></label>
          <button type="button" disabled={installing||!installId||!skillContent} onClick={async()=>{setInstalling(true);setError('');try{const data=await fetch('/api/aura/workbench/skills/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:installId,content:skillContent})}).then(readAuraResponse);setResult('Installerad: '+data.skill.name);setSkillContent('');setInstallId('');await load();}catch(error:any){setError(error.message);}finally{setInstalling(false);}}}>Installera skill</button>
        </details>
        {Object.entries(sourceErrors).filter(([, message]) => message).map(([source, message]) => <div key={source} role="status" className="text-amber-300 p-2">{message}</div>)}
        {result && !open && <div role="alert" className="text-amber-300 p-2">{result}</div>}
        {error && <div className="border border-red-900 text-red-300 rounded p-2 break-words">{error}</div>}
        {pending.length > 0 && (
          <div className="border border-amber-800 bg-[#1f1a10] rounded p-2 space-y-1.5 min-w-0">
            <div className="text-[10px] text-amber-300">JACO har lärt sig {pending.length} sak(er) av sina uppdrag. Inget används innan du godkänner det.</div>
            {pending.map(p => (
              <div key={p.key} className="border border-[#3a3220] rounded p-1.5 min-w-0">
                <div className="text-[10px] text-slate-200 break-words">
                  {p.kind === 'tool-note' ? <>Verktygsnotering för <span className="text-cyan-300">{p.tool}</span>: {p.note}</> : <>Ny skill: <span className="text-cyan-300">{p.id}</span></>}
                </div>
                <div className="text-[9px] text-slate-500 break-all">från {p.missionId}{p.namedBy ? ` · namngiven av ${p.namedBy}` : ''}</div>
                {p.kind === 'skill' && (
                  <button onClick={() => setOpenProposal(openProposal === p.key ? null : p.key)} className="text-[9px] text-cyan-400 hover:text-cyan-300">
                    {openProposal === p.key ? 'Dölj' : 'Visa SKILL.md'}
                  </button>
                )}
                {openProposal === p.key && <pre className="whitespace-pre-wrap break-words text-[9px] text-slate-300 max-h-48 overflow-auto">{p.skillMd}</pre>}
                <div className="flex gap-1.5 mt-1">
                  <button onClick={() => void decide(p.key, 'approve')} className="px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-white text-[9px]">Godkänn</button>
                  <button onClick={() => void decide(p.key, 'reject')} className="px-1.5 py-0.5 rounded bg-[#3a2a2a] hover:bg-[#4a3030] text-slate-200 text-[9px]">Avvisa</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!skills && !error && <div className="text-slate-500 px-1">Reading skills…</div>}
        {skills?.length === 0 && <div className="text-slate-500 px-1">No skills. Add skills/&lt;id&gt;/SKILL.md to the repository.</div>}
        {skills?.map(s => (
          <button key={s.id} disabled={busy} onClick={() => void select(s.id)}
            className={`w-full text-left border rounded p-2 min-w-0 ${open?.id === s.id ? 'border-cyan-700 bg-[#10202a]' : 'border-[#333] bg-[#1d1d1d] hover:border-[#555]'}`}>
            <div className="text-slate-100 truncate">{s.name}</div>
            {s.error
              ? <div className="text-red-300 text-[10px] break-words">{s.error}</div>
              : <div className="text-slate-400 text-[10px]">{s.description}</div>}
            <div className="text-[9px] text-slate-600 truncate">tasks: {s.tasks.join(', ') || '-'}</div>
          </button>
        ))}
        {open && (
          <div className="border border-[#333] bg-[#141414] rounded p-2 space-y-2 min-w-0">
            <div className="text-[9px] text-slate-500 break-all">{open.source}</div>
            {open.tasks.some(task=>task.startsWith('repo-')||task.startsWith('git-'))&&<p>Kodskills körs som uppdrag i det öppna Git-projektet, med ett eget projektkontrakt.</p>}
            <pre className="whitespace-pre-wrap break-words text-[10px] text-slate-300 max-h-64 overflow-auto">{open.body}{open.truncated ? '\n[truncated]' : ''}</pre>
            {open.tasks.includes('repo-test')&&<label>Testkommandon, ett per rad<textarea value={testCommands} onChange={e=>setTestCommands(e.target.value)} placeholder="npm test"/></label>}
            <textarea disabled={busy} value={input} onChange={e => setInput(e.target.value)} rows={3} placeholder="Input for this run (e.g. what to look at)"
              className="w-full bg-[#0b0b0b] border border-[#333] rounded p-1 text-[11px] text-slate-200" />
            {executors.length > 1 && (
              <label className="flex items-center gap-1.5 text-[10px] text-slate-400">Kör på
                <select value={executor} onChange={e => setExecutor(e.target.value)} className="flex-1 min-w-0 bg-[#0b0b0b] border border-[#333] rounded p-0.5 text-[10px] text-slate-200">
                  {executors.map(x => <option key={x.executor} value={x.executor}>{x.label}</option>)}
                </select>
              </label>
            )}
            <button onClick={() => void run()} disabled={busy || !input.trim()}
              className="px-2 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-white text-[10px] disabled:opacity-40">
              {busy ? 'Starting…' : 'Run as mission'}
            </button>
            {result && <div className="text-[10px] text-slate-300 break-words">{result}</div>}
          </div>
        )}
      </div>
    </>
  );
};
