// Capability observations for Aura (docs/aura/OPERATING_CONTRACT.md, section 3).
//
// One record per (agent, tool, provider) that says what is known about the tool, and how well:
//   registered  the tool is declared in a catalog
//   enabled     the operator has not switched it off, and the agent's capsule allows it
//   reachable   a bounded probe reached the provider in the last window
//   verified    a real execution produced a receipt with verified = true
//   failed      the latest real execution failed
//   unknown     nothing is observed yet, or the last observation is too old to trust
//
// A status is derived from evidence only. Registration and enablement never count as verification.
// Gameboard, planning and blockers read these records; nothing is inferred from a goal's wording.
import { createHash } from 'node:crypto';

export const OBSERVATION_SCHEMA = 'jaco.capability-observation/v1';
export const STATUS = Object.freeze(['registered', 'enabled', 'reachable', 'verified', 'failed', 'unknown']);
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PROBE_MAX_AGE_MS = 15 * 60 * 1000;

const clip = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ID = /^[a-z][a-z0-9._:-]{0,120}$/;

export function observationId(agentId, tool, provider = 'jaco') {
  for (const part of [agentId, tool, provider]) if (!ID.test(String(part))) throw new Error('CAPABILITY_ID_INVALID');
  return `cap-${createHash('sha256').update(`${agentId}|${provider}|${tool}`).digest('hex').slice(0, 16)}`;
}

// Derives the status from the record's evidence. `now` is injected so the rule is testable.
export function deriveStatus(record, now = Date.now()) {
  const at = t => (typeof t === 'string' && Number.isFinite(Date.parse(t)) ? Date.parse(t) : null);
  const exec = at(record.lastExecution?.at), probe = at(record.lastProbe?.at);
  if (record.lastExecution && exec !== null && now - exec <= MAX_AGE_MS) {
    if (record.lastExecution.ok === false) return 'failed';
    if (record.lastExecution.ok === true && record.lastExecution.verified === true) return 'verified';
  }
  if (record.lastProbe && probe !== null && now - probe <= PROBE_MAX_AGE_MS && record.lastProbe.ok === true) return 'reachable';
  if (record.operatorEnabled === true && record.capsuleAllowed !== false) return 'enabled';
  if (record.registered === true) return 'registered';
  return 'unknown';
}

// Builds the record from its evidence, keeping the source of every claim.
export function observe({ agentId, tool, provider = 'jaco', registered = false, operatorEnabled = null, capsuleAllowed = null,
  probe = null, execution = null, now = Date.now() } = {}) {
  const record = {
    schema: OBSERVATION_SCHEMA,
    id: observationId(agentId, tool, provider),
    agentId: clip(agentId, 60), tool: clip(tool, 120), provider: clip(provider, 60),
    registered: registered === true,
    operatorEnabled: operatorEnabled === null ? null : operatorEnabled === true,
    capsuleAllowed: capsuleAllowed === null ? null : capsuleAllowed === true,
    lastProbe: probe ? { ok: probe.ok === true, at: probe.at, source: clip(probe.source, 120), error: clip(probe.error, 160) || null } : null,
    lastExecution: execution ? {
      ok: execution.ok === true, verified: execution.verified === true, at: execution.at,
      receipt: clip(execution.receipt, 160) || null, error: clip(execution.error, 160) || null,
    } : null,
    observedAt: new Date(now).toISOString(),
  };
  return { ...record, status: deriveStatus(record, now) };
}

// Merges a newer piece of evidence into an existing record without losing the older kind.
export function withEvidence(record, { probe = null, execution = null, now = Date.now() } = {}) {
  const next = { ...record };
  if (probe) next.lastProbe = { ok: probe.ok === true, at: probe.at, source: clip(probe.source, 120), error: clip(probe.error, 160) || null };
  // A real execution outranks a probe: it is the only evidence that the tool did something.
  if (execution) next.lastExecution = { ok: execution.ok === true, verified: execution.verified === true, at: execution.at, receipt: clip(execution.receipt, 160) || null, error: clip(execution.error, 160) || null };
  next.observedAt = new Date(now).toISOString();
  return { ...next, status: deriveStatus(next, now) };
}

// What the operator sees and what a planner may rely on. Only `verified` counts as proven.
export function plannerView(records = [], now = Date.now()) {
  const rows = records.map(r => ({ ...r, status: deriveStatus(r, now) }));
  const counts = Object.fromEntries(STATUS.map(s => [s, 0]));
  for (const r of rows) counts[r.status]++;
  return { schema: OBSERVATION_SCHEMA, counts, usable: rows.filter(r => r.status === 'verified' || r.status === 'reachable').map(r => r.tool),
    blocked: rows.filter(r => r.status === 'failed').map(r => ({ tool: r.tool, error: r.lastExecution?.error || null, receipt: r.lastExecution?.receipt || null })) };
}
