// Self-written skills (operator 2026-10-03, step 2 of going beyond Claude's design).
// JACO learns from its own finished missions and proposes what it learned; the operator approves.
// Two kinds of proposal:
// - tool-note: a call that failed on its arguments and a later call of the same tool that worked.
//   Once approved, the note is shown with that tool to every planner (catalog and native schemas).
// - skill: the steps of a mission that completed with verified receipts and an answer whose claims
//   held. Once approved it is a SKILL.md in the runtime's skill root, usable by skill-load or the IDE.
// Executable learned skills and tool notes require approval. Historical outcome evidence is
// retrieved separately as context and must be revalidated against the current repository.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const stepOf = r => Number(/:turn:(\d+)$/.exec(String(r?.actionId || ''))?.[1]) || null;
const isMcp = r => r?.type === 'mcp-call' || r?.type === 'mcp-write';
const toolKey = r => isMcp(r) && r.input?.server && r.input?.tool ? `${r.input.server}.${r.input.tool}` : r?.type || null;
const argsOf = r => isMcp(r) ? (r.input?.arguments || {}) : (r?.input || {});
const short = (value, max = 160) => { const t = typeof value === 'string' ? value : JSON.stringify(value ?? null); return t.length > max ? `${t.slice(0, max)}...` : t; };
const errorText = r => String(r?.result?.output || r?.result?.error || r?.error || '').replace(/\s+/g, ' ').trim();

// A failed call followed, within the next three steps, by a successful call of the same tool with
// different arguments. Only receipts that carry their input (receipts since 2026-10-03) count.
export function toolCorrections(receipts = []) {
  const out = [];
  receipts.forEach((failed, i) => {
    if (failed?.ok !== false || !failed.input || !toolKey(failed)) return;
    const fixed = receipts.slice(i + 1, i + 4).find(r => r?.ok === true && r.input && toolKey(r) === toolKey(failed) && JSON.stringify(argsOf(r)) !== JSON.stringify(argsOf(failed)));
    if (!fixed) return;
    const failedKeys = Object.keys(argsOf(failed)).sort(), fixedKeys = Object.keys(argsOf(fixed)).sort();
    out.push({ tool: toolKey(failed), failedArgs: argsOf(failed), error: errorText(failed).slice(0, 240), workingArgs: argsOf(fixed),
      missingKeys: fixedKeys.filter(k => !failedKeys.includes(k)), wrongKeys: failedKeys.filter(k => !fixedKeys.includes(k)), steps: [stepOf(failed), stepOf(fixed)] });
  });
  return out;
}

// What a value that failed got wrong, when the shape says so; otherwise both values side by side.
function valueLesson(key, bad, good) {
  const b = typeof bad === 'string' ? bad : JSON.stringify(bad);
  if (/PLACEHOLDER|<[^>]+>|\{\{|\bTODO\b/i.test(b)) return `${key} must be a real value taken from a receipt, never a placeholder`;
  if (/\s--?[a-z]/i.test(b)) return `${key} takes a single value; options such as ${/(--?[a-z][\w-]*)/i.exec(b)[1]} are not accepted`;
  if (/\.\.\.?/.test(b) && !/\.\./.test(String(good))) return `${key} takes one ref; ranges (a..b) are not accepted`;
  return `${key}: ${short(bad, 60)} failed where ${short(good, 60)} worked`;
}

export function correctionNote(c) {
  const parts = [];
  if (c.missingKeys.length) parts.push(`pass ${c.missingKeys.join(', ')}`);
  if (c.wrongKeys.length) parts.push(`not ${c.wrongKeys.join(', ')}`);
  for (const key of Object.keys(c.workingArgs).filter(k => k in c.failedArgs)) {
    if (JSON.stringify(c.failedArgs[key]) !== JSON.stringify(c.workingArgs[key])) parts.push(valueLesson(key, c.failedArgs[key], c.workingArgs[key]));
  }
  if (!parts.length) parts.push(`a call with ${short(c.failedArgs, 120)} failed; ${short(c.workingArgs, 120)} worked`);
  return `${parts.join('; ')}${c.error ? ` (error seen: ${c.error.slice(0, 140)})` : ''}`;
}

// The steps that made up a successful mission, in order, with repeated calls of a tool collapsed.
export function procedureSteps(receipts = []) {
  const steps = [];
  for (const r of receipts.filter(r => r?.ok === true && r.verified === true)) {
    const key = toolKey(r);
    const last = steps.at(-1);
    if (last && last.tool === key) { last.times++; continue; }
    steps.push({ tool: key, type: r.type, args: Object.keys(argsOf(r)), expected: String(r.expectedOutcome || '').slice(0, 160), times: 1 });
  }
  return steps;
}
export const procedureSignature = steps => steps.map(s => s.tool).join('>');

const slug = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'learned';

export function skillProposal(mission, receipts, { name = null, description = null } = {}) {
  const steps = procedureSteps(receipts);
  const tasks = [...new Set(steps.map(s => s.type))];
  const goal = String(mission.goal || '').replace(/\s+/g, ' ').trim();
  const id = `learned-${slug(name || goal)}`.slice(0, 60).replace(/-+$/, '');
  const lines = steps.map((s, i) => `${i + 1}. ${isMcp(s) ? `${s.type} ${s.tool}` : s.tool} {${s.args.join(', ')}}${s.times > 1 ? ` (${s.times} times, one per item)` : ''}${s.expected ? `: ${s.expected}` : ''}`);
  const body = [
    `# ${name || goal.slice(0, 80)}`,
    '',
    `Learned by JACO from mission ${mission.id}, which completed with verified receipts and an answer whose claims were checked against them. Approved by the operator before use.`,
    '',
    `Original goal: ${goal.slice(0, 400)}`,
    '',
    '## Steps that worked',
    '',
    ...lines,
    '',
    '## Answer',
    '',
    'Answer in plain sentences and cite each fact as [#n]. Adapt the arguments to the new goal; do not reuse identifiers (hashes, URLs, names) from the original goal unless the new goal names them.',
  ].join('\n');
  const skillMd = `---\nname: ${(name || goal.slice(0, 60)).replace(/\n/g, ' ')}\ndescription: ${(description || `Learned procedure for goals like: ${goal.slice(0, 140)}`).replace(/\n/g, ' ')}\ntasks: [${tasks.join(', ')}]\n---\n\n${body}\n`;
  return { kind: 'skill', id, signature: procedureSignature(steps), tasks, skillMd };
}

// A short name and description from a cheap model (the claim judge's candidates); the template is
// used when none answers. The model only names the procedure; the steps come from the receipts.
export async function nameProcedure(goal, steps, { candidates = [], fetchImpl = fetch } = {}) {
  const prompt = `A software agent completed this goal: "${String(goal).slice(0, 300)}" with these steps: ${steps.map(s => s.tool).join(' -> ')}. Name the reusable procedure in the goal's language. Return JSON only: {"name":"3-6 words","description":"one sentence: when to use it"}`;
  for (const c of candidates) {
    try {
      const res = await fetchImpl(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({ model: c.model, temperature: 0, max_tokens: 400, ...(c.name === 'groq' ? { reasoning_effort: 'low' } : {}), messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(c.name === 'ollama' ? 120_000 : 30_000) });
      const text = (await res.json())?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] || 'null');
      if (parsed?.name && parsed?.description) return { name: String(parsed.name).slice(0, 60), description: String(parsed.description).slice(0, 200), by: `${c.name}/${c.model}` };
    } catch {}
  }
  return { name: null, description: null, by: null };
}

// ---- proposal store (runtime) ------------------------------------------------------------------
export function learningStore(stateDir) {
  const dir = join(stateDir, 'skill-proposals');
  const notesFile = join(stateDir, 'tool-notes.json');
  const skillsDir = join(stateDir, 'skills');
  const read = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
  const all = () => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).map(f => read(join(dir, f))).filter(Boolean) : [];
  const save = p => { mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, `${p.key}.json`), JSON.stringify(p, null, 2)); return p; };
  const notes = () => read(notesFile) || {};
  // Missions already read; kept here rather than as bus events, which the IDE's live feed shows.
  const learnedFile = join(stateDir, 'learned-missions.json');
  const learned = () => new Set(read(learnedFile) || []);
  const outcomesDir=join(stateDir,'mission-outcomes');
  const atomicOutcome=(file,value)=>{const temp=file+'.tmp';let fd;try{fd=openSync(temp,'w',0o600);writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temp,file);}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temp))unlinkSync(temp);}};
  const outcomes=()=>existsSync(outcomesDir)?readdirSync(outcomesDir).filter(f=>f.endsWith('.json')).map(f=>read(join(outcomesDir,f))).filter(Boolean):[];
  return {
    recordOutcome(mission) {
      const receipts=mission.receipts||[],scopeKey=createHash('sha256').update(JSON.stringify(mission.contract?.scope?.allowed||[])).digest('hex');
      const item={schema:'jaco.mission-reflection/v1',missionId:mission.id,status:mission.status,scopeKey,at:new Date().toISOString(),verificationStatus:mission.status==='DONE'&&mission.contractStatus?.machineVerified===true?'VERIFIED':'UNVERIFIED',
        worked:[...new Set(receipts.filter(r=>r.ok&&r.verified).map(r=>r.type))],failed:receipts.filter(r=>r.ok===false).map(r=>({tool:r.type,error:(/^[A-Z][A-Z0-9_]{2,80}/.exec(String(r.error||''))?.[0]||'TOOL_FAILED'),evidence:r.actionId})),
        unexpected:receipts.filter(r=>r.outcomeUnknown).map(r=>({tool:r.type,evidence:r.actionId})),
        evidence:receipts.filter(r=>r.ok&&r.verified).map(r=>r.actionId),repositoryRevision:mission.preflight?.repository?.revision||null,
        reusablePatterns:procedureSteps(receipts).map(s=>({tool:s.tool,arguments:s.args})),constraints:{scopeKey,requiredStages:mission.contract?.verification?.required_stages||[]}};
      mkdirSync(outcomesDir,{recursive:true});atomicOutcome(join(outcomesDir,createHash('sha256').update(mission.id).digest('hex')+'.json'),item);return item;
    },
    recallOutcome(contract,revision,{limit=3}={}) {
      const scopeKey=createHash('sha256').update(JSON.stringify(contract?.scope?.allowed||[])).digest('hex');
      return outcomes().filter(o=>o.scopeKey===scopeKey).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,limit).map(o=>({...o,verificationStatus:o.repositoryRevision&&o.repositoryRevision!==revision?'STALE':o.verificationStatus,reuseRule:'Historical evidence only; validate against current repository and contract before reuse'}));
    },
    isLearned: id => learned().has(id),
    markLearned(id) { const s = learned(); s.add(id); mkdirSync(stateDir, { recursive: true }); writeFileSync(learnedFile, JSON.stringify([...s].slice(-2000))); },
    list: () => all().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    notes,
    // A proposal with the same key (same tool lesson, or the same sequence of tools) is never made
    // twice, whatever the operator decided about the first one.
    add(proposal) {
      const key = proposal.kind === 'tool-note'
        ? `note-${createHash('sha256').update(`${proposal.tool}|${proposal.note}`).digest('hex').slice(0, 16)}`
        : `skill-${createHash('sha256').update(proposal.signature).digest('hex').slice(0, 16)}`;
      if (existsSync(join(dir, `${key}.json`))) return null;
      return save({ ...proposal, key, status: 'PENDING', createdAt: new Date().toISOString() });
    },
    decide(key, decision, note = '') {
      const p = all().find(x => x.key === key);
      if (!p) throw new Error('PROPOSAL_NOT_FOUND');
      if (p.status !== 'PENDING') throw new Error(`PROPOSAL_${p.status}`);
      if (!['approve', 'reject'].includes(decision)) throw new Error('INVALID_DECISION');
      if (decision === 'approve' && p.kind === 'tool-note') {
        const current = notes();
        current[p.tool] = [...(current[p.tool] || []), { note: p.note, missionId: p.missionId, approvedAt: new Date().toISOString() }].slice(-5);
        writeFileSync(notesFile, JSON.stringify(current, null, 2));
      }
      if (decision === 'approve' && p.kind === 'skill') {
        let id = p.id, n = 2;
        while (existsSync(join(skillsDir, id))) id = `${p.id}-${n++}`;
        mkdirSync(join(skillsDir, id), { recursive: true });
        writeFileSync(join(skillsDir, id, 'SKILL.md'), p.skillMd);
        p.installedAs = id;
      }
      return save({ ...p, status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedAt: new Date().toISOString(), decisionNote: String(note).slice(0, 300) });
    },
  };
}

// What one finished mission teaches. claimCheck: its last NOVA_CLAIM_CHECK payload, or null.
export function lessonsFrom(mission, claimCheck = null) {
  const receipts = Array.isArray(mission?.receipts) ? mission.receipts : [];
  const notes = toolCorrections(receipts).map(c => ({ kind: 'tool-note', tool: c.tool, note: correctionNote(c), missionId: mission.id, evidence: { steps: c.steps, failedArgs: c.failedArgs, workingArgs: c.workingArgs, error: c.error } }));
  const steps = procedureSteps(receipts);
  // A procedure is learned only from a mission whose answer was checked and held, that is not
  // itself a skill run, and that took at least two kinds of step.
  const learnable = mission?.status === 'DONE' && claimCheck?.ok === true && !/^Skill [a-z]/.test(String(mission.goal || '')) && new Set(steps.map(s => s.tool)).size >= 2;
  return { notes, procedure: learnable ? { steps } : null };
}
