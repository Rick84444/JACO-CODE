import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, atomicWriteJson, readJson, makeId, nowIso, assertString, deepClone } from './util.mjs';

const STATES = ['PROPOSED','ACTIVE','BLOCKED','VERIFYING','FULFILLED','CANCELLED'];
const TRANSITIONS = {
  PROPOSED: new Set(['ACTIVE','CANCELLED']),
  ACTIVE: new Set(['BLOCKED','VERIFYING','CANCELLED']),
  BLOCKED: new Set(['ACTIVE','CANCELLED']),
  VERIFYING: new Set(['ACTIVE','BLOCKED','FULFILLED','CANCELLED']),
  FULFILLED: new Set([]),
  CANCELLED: new Set([]),
};

export class MissionLedger {
  constructor(root, events, evidence = null) {
    this.dir = ensureDir(path.join(root, 'missions'));
    this.events = events;
    this.evidence = evidence;
  }

  create(input, actor = 'operator') {
    const id = input.id ? assertString(input.id, 'mission.id', 180) : makeId('mission');
    if (fs.existsSync(this.#file(id))) throw new Error(`mission '${id}' already exists`);
    const objective = assertString(input.objective, 'objective', 4000);
    const mission = {
      schema: 'jaco.continuum.mission.v1', id, objective,
      state: input.state === 'ACTIVE' ? 'ACTIVE' : 'PROPOSED',
      priority: Math.max(0, Math.min(100, Number(input.priority ?? 50))),
      invariants: this.#strings(input.invariants, 100, 500),
      blockers: this.#strings(input.blockers, 100, 500),
      tags: this.#strings(input.tags, 50, 120),
      budget: {
        cloudUsd: Math.max(0, Number(input.budget?.cloudUsd ?? 0)),
        maxActions: Math.max(0, Number(input.budget?.maxActions ?? 0)),
      },
      contextRefs: this.#strings(input.contextRefs, 200, 500),
      evidenceRefs: [],
      knowledgeRefs: [],
      currentCommitmentId: null,
      nextAction: input.nextAction ? String(input.nextAction).slice(0, 1000) : null,
      // Level-5 profile closes verified missions autonomously unless a mission
      // explicitly opts into a final operator signoff.
      operatorFinalSignoff: input.operatorFinalSignoff === true,
      createdAt: nowIso(), updatedAt: nowIso(), createdBy: actor,
      revision: 1,
    };
    atomicWriteJson(this.#file(id), mission);
    this.events.append({ stream: 'mission', type: 'mission.created', entityId: id, actor, data: mission });
    return deepClone(mission);
  }

  get(id) {
    const mission = readJson(this.#file(id));
    if (!mission) throw new Error(`mission '${id}' not found`);
    return deepClone(mission);
  }

  list({ state = null, limit = 200 } = {}) {
    return fs.readdirSync(this.dir).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(this.dir, name)))
      .filter(Boolean).filter((m) => !state || m.state === state)
      .sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, Math.min(1000, Number(limit)||200));
  }

  transition(id, nextState, { actor = 'system', reason = null, evidenceRefs = [] } = {}) {
    const mission = this.get(id);
    if (!STATES.includes(nextState)) throw new Error(`invalid mission state '${nextState}'`);
    if (!TRANSITIONS[mission.state]?.has(nextState)) throw new Error(`mission transition ${mission.state} -> ${nextState} is not allowed`);
    if (nextState === 'FULFILLED' && (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0)) {
      throw new Error('mission fulfillment requires evidenceRefs');
    }
    if (this.evidence && Array.isArray(evidenceRefs) && evidenceRefs.length) this.evidence.assertRefs(evidenceRefs,{verified: nextState==='FULFILLED'});
    mission.state = nextState;
    mission.updatedAt = nowIso();
    mission.revision += 1;
    if (reason) mission.lastTransitionReason = String(reason).slice(0, 1000);
    mission.evidenceRefs = [...new Set([...(mission.evidenceRefs || []), ...this.#strings(evidenceRefs, 500, 250)])];
    atomicWriteJson(this.#file(id), mission);
    this.events.append({ stream: 'mission', type: `mission.${nextState.toLowerCase()}`, entityId: id, actor, data: { reason, evidenceRefs } });
    return deepClone(mission);
  }

  patch(id, patch, actor = 'system') {
    const mission = this.get(id);
    const allowed = ['blockers','nextAction','currentCommitmentId','contextRefs','knowledgeRefs','evidenceRefs','priority'];
    for (const key of allowed) {
      if (!(key in patch)) continue;
      if (['blockers','contextRefs','knowledgeRefs','evidenceRefs'].includes(key)) mission[key] = this.#strings(patch[key], 500, 1000);
      else if (key === 'priority') mission.priority = Math.max(0, Math.min(100, Number(patch.priority)));
      else mission[key] = patch[key] == null ? null : String(patch[key]).slice(0, 1000);
    }
    mission.updatedAt = nowIso(); mission.revision += 1;
    atomicWriteJson(this.#file(id), mission);
    this.events.append({ stream: 'mission', type: 'mission.patched', entityId: id, actor, data: patch });
    return deepClone(mission);
  }

  capsule(id, { commitments = [], agentState = [], economic = null, operator = null } = {}) {
    const mission = this.get(id);
    return {
      schema: 'jaco.continuum.mission-capsule.v1',
      generatedAt: nowIso(),
      mission,
      commitments: commitments.filter((c) => c.missionId === id),
      agentState,
      economic,
      operator,
      recovery: {
        ifAgentLost: 'reconstruct_from_capsule',
        ifRuntimeRestart: 'resume_commitment_graph',
        ifEvidenceMissing: 'return_to_verifying',
      },
    };
  }

  #file(id) {
    const safe = String(id).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(this.dir, `${safe}.json`);
  }
  #strings(value, maxItems, maxLen) {
    return Array.isArray(value) ? value.slice(0,maxItems).map((v)=>String(v).trim().slice(0,maxLen)).filter(Boolean) : [];
  }
}
