// Plain-language text for what Nova does, shared by the runtime's mission summaries (server.ts) and
// the IDE, so both say the same thing: which action, on what, and with which result.
// Operator 2026-10-02: the IDE must make it clear what is being executed.

const clip = (value: unknown, max = 80) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function describeNovaTask(task: any): string {
  const type = String(task?.type || '');
  const data = task?.data || {};
  switch (type) {
    case 'github-create-repo': return `create GitHub repo ${clip(data.name, 60)}${data.private === false ? ' (public)' : ' (private)'}`;
    case 'repo-write': return `write file ${clip(data.path)}`;
    case 'repo-edit': return `edit file ${clip(data.path)}`;
    case 'repo-read': return `read file ${clip(data.path)}`;
    case 'repo-list': return `list directory ${clip(data.path || '.')}`;
    case 'repo-test': return `run ${data.kind === 'falsifier' ? 'falsifier test' : 'test'}: ${clip(data.command)}`;
    case 'git-status': return 'read git status';
    case 'git-diff': return 'read git diff';
    case 'git-commit': return `git commit "${clip(data.message, 60)}"`;
    case 'git-push': return 'git push';
    case 'git-merge': return `git merge ${clip(data.ref)}`;
    case 'web-fetch': return `fetch ${clip(data.url)}`;
    case 'browser-survey-site': return `open ${clip(data.url)}`;
    case 'browser-click': return `click "${clip(data.name, 60)}"`;
    case 'browser-type': return `type in field "${clip(data.name, 60)}"`;
    case 'shell': return `run command ${clip(data.command)}`;
    case 'invoke-worker': return `invoke worker ${clip(data.worker, 40)}`;
    case 'screenshot': return 'take a screenshot';
    case 'desktop-observe': return 'read desktop windows';
    case 'health-check': return 'health check';
    case 'detect-surfaces': return 'map surfaces';
    default: return type || 'unknown action';
  }
}

// The result of a receipt: a link or identifier when there is one, otherwise the error.
export function describeNovaResult(receipt: any): { text: string; url: string | null; state: 'verified' | 'unverified' | 'failed' } {
  const result = receipt?.result || {};
  const url = typeof result.url === 'string' && /^https?:\/\//.test(result.url) ? result.url : null;
  const unknown = receipt?.outcomeUnknown === true || result.outcomeUnknown === true;
  const failed = receipt?.ok === false || result.ok === false || Boolean(receipt?.error || result.error) || (Number.isFinite(result.exitCode) && result.exitCode !== 0);
  if (unknown) return { text: 'outcome unknown, check needed', url: null, state: 'unverified' };
  if (receipt?.ok === true && receipt?.verified === true && !failed) {
    const detail = result.existed === true ? 'already existed' : url ? url : result.commit ? `commit ${clip(result.commit, 12)}` : result.path ? clip(result.path) : 'verified';
    return { text: detail, url, state: 'verified' };
  }
  if (receipt?.ok === true && !failed) return { text: 'done but not verified', url, state: 'unverified' };
  return { text: `failed: ${clip(receipt?.error || result?.error || 'unknown error', 140)}`, url: null, state: 'failed' };
}

export interface NovaMissionSummary {
  id: string;
  goal: string;
  status: string;
  phase: string | null;
  step: number;
  maxSteps: number | null;
  source: string | null;
  // Minimal parent link for Aura's explicit "End goal" action; never expose
  // private mission metadata or capabilities in the UI projection.
  metadata?: { parent: { graphId: string } };
  createdAt: string | null;
  updatedAt: string | null;
  lastAction: { text: string; at: string | null; result: ReturnType<typeof describeNovaResult> | null; running: boolean } | null;
  verifiedReceipts: number;
  // The planner's completion reason: for a read-only mission it is the answer to the goal.
  answer: string | null;
  // Which steps the answer cites ([#n]) and whether each is a verified receipt (agents/lib/evidence.mjs).
  evidence: { cited: number[]; verified: number[]; missing: number[]; unverified: number[]; ok: boolean } | null;
  // Independent check of what the answer claims (agents/lib/claim-check.mjs); null until it has run.
  claimCheck: { ok: boolean; claims: number; facts: number; judged: number; judge: string | null; problems: { text: string; why: string }[]; partial: number[]; error: string | null } | null;
}

// lastStarted: the mission's latest NOVA_ACTION_STARTED action (receipts carry the type, not the data).
export function summarizeNovaMission(mission: any, lastStarted: any = null, completionReason: unknown = null, evidence: any = null, claimCheck: any = null): NovaMissionSummary {
  const receipts: any[] = Array.isArray(mission?.receipts) ? mission.receipts : [];
  const latest = receipts.at(-1) || null;
  // An action without a receipt yet is running only while the mission is EXECUTING.
  const running = mission?.phase === 'EXECUTING' && lastStarted && lastStarted.id !== latest?.actionId ? lastStarted : null;
  const finishedAction = latest && lastStarted?.id === latest.actionId ? lastStarted : latest ? { type: latest.type } : null;
  return {
    id: String(mission?.id || ''),
    goal: clip(mission?.goal, 300),
    status: String(mission?.status || 'UNKNOWN'),
    phase: mission?.phase || null,
    step: Number(mission?.turn ?? receipts.length) || 0,
    maxSteps: Number(mission?.contract?.budget?.max_steps) || null,
    source: mission?.source || null,
    ...(typeof mission?.metadata?.parent?.graphId === 'string' &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(mission.metadata.parent.graphId)
      ? { metadata: { parent: { graphId: mission.metadata.parent.graphId } } }
      : {}),
    createdAt: mission?.createdAt || null,
    updatedAt: mission?.updatedAt || null,
    lastAction: running
      ? { text: describeNovaTask(running), at: null, result: null, running: true }
      : finishedAction ? { text: describeNovaTask(finishedAction), at: latest?.at || null, result: describeNovaResult(latest), running: false } : null,
    verifiedReceipts: receipts.filter(r => describeNovaResult(r).state === 'verified').length,
    answer: typeof completionReason === 'string' && completionReason.trim() ? completionReason.trim().slice(0, 4000) : null,
    evidence: evidence && Array.isArray(evidence.cited) ? evidence : null,
    claimCheck: claimCheck && typeof claimCheck === 'object' ? {
      ok: claimCheck.ok === true, claims: Number(claimCheck.claims) || 0, facts: Number(claimCheck.facts) || 0, judged: Number(claimCheck.judged) || 0, judge: claimCheck.judge || null,
      problems: [
        ...(claimCheck.contradicted || []).map((x: any) => ({ text: clip(x.text, 200), why: clip(x.why, 200) })),
        ...(claimCheck.unsupportedFacts || []).map((x: any) => ({ text: clip(x.text, 200), why: `missing from the evidence: ${clip(x.fact, 80)}` })),
      ],
      partial: Array.isArray(claimCheck.partial) ? claimCheck.partial : [], error: claimCheck.error || null,
    } : null,
  };
}
