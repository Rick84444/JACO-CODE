import { nowIso, deepClone } from './util.mjs';

const STATE_EVENT_TYPES = new Set([
  'continuity.state_updated',
  'continuity.checkpoint',
  'continuity.checkpoint_restored',
]);

function boundedString(value, max = 1000) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function boundedStrings(value, maxItems = 32, maxLen = 1000) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => boundedString(item, maxLen)).filter(Boolean))].slice(0, maxItems);
}

function compactReceipt(receipt = {}) {
  return {
    type: receipt.type || receipt.task?.type || null,
    ok: receipt.ok === true,
    verified: receipt.verified === true,
    at: receipt.at || receipt.completedAt || null,
    error: receipt.error ? String(receipt.error).slice(0, 240) : null,
  };
}

function compactMission(mission) {
  if (!mission || typeof mission !== 'object') return null;
  const receipts = Array.isArray(mission.receipts) ? mission.receipts : [];
  return {
    id: mission.id || null,
    objective: mission.goal || mission.objective || null,
    status: mission.status || mission.state || null,
    phase: mission.phase || null,
    turn: Number(mission.turn || 0),
    failures: Number(mission.failures || 0),
    receiptsTotal: receipts.length,
    recentReceipts: receipts.slice(-8).map(compactReceipt),
    allowedTasks: Array.isArray(mission.allowedTasks) ? mission.allowedTasks.slice(0, 64).map(String) : [],
  };
}

/**
 * Persistent cognitive continuity without a parallel mission/memory database.
 *
 * Canonical mission, knowledge, hypothesis and evidence owners stay where they
 * already live. Only the bounded working-state projection below is persisted,
 * as full-state events in Continuum's existing hash-chained EventStore.
 */
export class CognitiveContinuityRuntime {
  constructor({
    events,
    selfModel = null,
    hypotheses = null,
    knowledge = null,
    continuityId = process.env.JACO_CONTINUITY_ID || 'jaco:primary',
  } = {}) {
    if (!events) throw new Error('CONTINUITY_EVENT_STORE_REQUIRED');
    this.events = events;
    this.selfModel = selfModel;
    this.hypotheses = hypotheses;
    this.knowledge = knowledge;
    this.continuityId = boundedString(continuityId, 180) || 'jaco:primary';
    this.missionSource = null;
    this.missionAuthority = 'UNBOUND';
  }

  setMissionSource(source, { authority = 'CONNECTED_DURABLE_NOVA' } = {}) {
    if (!source || typeof source.current !== 'function' || typeof source.get !== 'function') {
      throw new Error('CONTINUITY_MISSION_SOURCE_INVALID');
    }
    this.missionSource = source;
    this.missionAuthority = boundedString(authority, 120) || 'CONNECTED_DURABLE_NOVA';
    return this.snapshot();
  }

  state() {
    const events = this.events.list({
      stream: 'continuity',
      entityId: this.continuityId,
      limit: 5000,
    });
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!STATE_EVENT_TYPES.has(event.type) || !event.data?.state) continue;
      return deepClone(event.data.state);
    }
    return this.#emptyState();
  }

  applyDelta(input = {}, actor = 'system') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CONTINUITY_DELTA_INVALID');
    const allowed = new Set([
      'focusMissionId',
      'focusHypothesisSetId',
      'attention',
      'openQuestions',
      'nextActions',
      'workingRefs',
      'lastModelId',
    ]);
    for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`CONTINUITY_FIELD_NOT_ALLOWED:${key}`);

    const state = this.state();

    if ('focusMissionId' in input) {
      const missionId = boundedString(input.focusMissionId, 180);
      if (missionId && !this.missionSource) throw new Error('CONTINUITY_MISSION_SOURCE_UNBOUND');
      if (missionId) this.missionSource.get(missionId);
      state.focusMissionId = missionId;
    }

    if ('focusHypothesisSetId' in input) {
      const setId = boundedString(input.focusHypothesisSetId, 180);
      if (setId && this.hypotheses?.get) this.hypotheses.get(setId);
      state.focusHypothesisSetId = setId;
    }

    if ('attention' in input) state.attention = boundedString(input.attention, 2000);
    if ('openQuestions' in input) state.openQuestions = boundedStrings(input.openQuestions, 32, 1000);
    if ('nextActions' in input) state.nextActions = boundedStrings(input.nextActions, 32, 1000);
    if ('workingRefs' in input) state.workingRefs = boundedStrings(input.workingRefs, 128, 500);
    if ('lastModelId' in input) state.lastModelId = boundedString(input.lastModelId, 180);

    state.revision = Number(state.revision || 0) + 1;
    state.updatedAt = nowIso();

    this.events.append({
      stream: 'continuity',
      type: 'continuity.state_updated',
      entityId: this.continuityId,
      actor,
      data: { state },
    });
    return deepClone(state);
  }

  checkpoint(label = 'checkpoint', actor = 'system') {
    const state = this.state();
    const mission = this.#resolveMission(state);
    const event = this.events.append({
      stream: 'continuity',
      type: 'continuity.checkpoint',
      entityId: this.continuityId,
      actor,
      data: {
        label: boundedString(label, 240) || 'checkpoint',
        state,
        mission: compactMission(mission),
        missionAuthority: this.missionAuthority,
      },
    });
    return {
      id: event.id,
      sequence: event.sequence,
      hash: event.hash,
      label: event.data.label,
      state: deepClone(state),
    };
  }

  listCheckpoints(limit = 20) {
    return this.events.list({
      stream: 'continuity',
      entityId: this.continuityId,
      type: 'continuity.checkpoint',
      limit: Math.max(1, Math.min(Number(limit) || 20, 200)),
    }).map((event) => ({
      id: event.id,
      sequence: event.sequence,
      timestamp: event.timestamp,
      label: event.data?.label || null,
      revision: Number(event.data?.state?.revision || 0),
      mission: event.data?.mission || null,
      hash: event.hash,
    }));
  }

  restoreCheckpoint(checkpointEventId, actor = 'system') {
    const id = boundedString(checkpointEventId, 240);
    if (!id) throw new Error('CONTINUITY_CHECKPOINT_ID_REQUIRED');
    const checkpoint = this.events.list({
      stream: 'continuity',
      entityId: this.continuityId,
      type: 'continuity.checkpoint',
      limit: 5000,
    }).find((event) => event.id === id);
    if (!checkpoint?.data?.state) throw new Error(`continuity checkpoint '${id}' not found`);

    const restored = deepClone(checkpoint.data.state);
    restored.revision = Number(this.state().revision || 0) + 1;
    restored.updatedAt = nowIso();

    this.events.append({
      stream: 'continuity',
      type: 'continuity.checkpoint_restored',
      entityId: this.continuityId,
      actor,
      data: {
        checkpointEventId: id,
        state: restored,
      },
    });
    return deepClone(restored);
  }

  snapshot() {
    const state = this.state();
    const mission = this.#resolveMission(state);
    const self = this.selfModel?.snapshot?.() || null;
    const openHypotheses = (this.hypotheses?.list?.() || [])
      .filter((set) => set?.status === 'OPEN')
      .slice(-12)
      .map((set) => ({
        id: set.id,
        missionId: set.missionId || null,
        problem: String(set.problem || '').slice(0, 800),
        candidates: Array.isArray(set.candidates)
          ? set.candidates.slice(0, 12).map((candidate) => ({
              id: candidate.id,
              label: candidate.label,
              status: candidate.status,
            }))
          : [],
      }));

    return deepClone({
      schema: 'jaco.cognitive-continuity.v1',
      continuityId: this.continuityId,
      generatedAt: nowIso(),
      revision: Number(state.revision || 0),
      missionAuthority: this.missionAuthority,
      objective: mission?.goal || mission?.objective || null,
      focus: {
        mission: compactMission(mission),
        hypothesisSetId: state.focusHypothesisSetId || null,
      },
      workingState: {
        attention: state.attention || null,
        openQuestions: state.openQuestions || [],
        nextActions: state.nextActions || [],
        workingRefs: state.workingRefs || [],
        lastModelId: state.lastModelId || null,
        updatedAt: state.updatedAt || null,
      },
      unresolved: {
        questions: state.openQuestions || [],
        hypotheses: openHypotheses,
      },
      epistemic: self ? {
        unknowns: Array.isArray(self.unknowns) ? self.unknowns.slice(0, 64) : [],
        repository: self.repository || null,
        knowledge: self.knowledge || null,
        capabilities: Array.isArray(self.capabilities)
          ? self.capabilities.slice(0, 64).map((capability) => ({
              capability: capability.capability,
              state: capability.state,
              verifiedAttempts: capability.verifiedAttempts,
              conservativeReliability: capability.conservativeReliability,
            }))
          : [],
      } : null,
      checkpoints: this.listCheckpoints(10),
      invariants: {
        missionStateOwnedExternally: true,
        knowledgeOwnedByKnowledgeStore: true,
        hypothesesOwnedByHypothesisEngine: true,
        continuityStateStoredInHashChainedEventLedger: true,
        checkpointRestoreAffectsWorkingStateOnly: true,
        humanInputIsNotEncodedAsUtilityFunction: true,
      },
    });
  }

  modelEnvelope() {
    const snapshot = this.snapshot();
    return {
      schema: 'jaco.cognitive-continuity-envelope.v1',
      continuityId: snapshot.continuityId,
      revision: snapshot.revision,
      missionAuthority: snapshot.missionAuthority,
      objective: snapshot.objective,
      focus: snapshot.focus,
      workingState: snapshot.workingState,
      unresolved: snapshot.unresolved,
      epistemic: snapshot.epistemic,
      invariants: snapshot.invariants,
    };
  }

  #resolveMission(state) {
    if (!this.missionSource) return null;
    try {
      if (state.focusMissionId) return this.missionSource.get(state.focusMissionId);
      return this.missionSource.current();
    } catch {
      return null;
    }
  }

  #emptyState() {
    return {
      schema: 'jaco.cognitive-continuity-state.v1',
      continuityId: this.continuityId,
      revision: 0,
      focusMissionId: null,
      focusHypothesisSetId: null,
      attention: null,
      openQuestions: [],
      nextActions: [],
      workingRefs: [],
      lastModelId: null,
      updatedAt: null,
    };
  }
}
