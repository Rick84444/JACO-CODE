import path from 'node:path';
import {
  atomicWriteJson,
  readJson,
  nowIso,
  makeId,
  sha256,
  canonicalJson,
  deepClone,
} from './util.mjs';
import { procedureShapeSignature } from '../skills/traceNormalizer.mjs';

const GENERALIZABLE = new Set([
  'navigate',
  'click',
  'set_value',
  'select',
  'check',
  'scroll',
  'survey',
  'observe',
]);

/**
 * Compatibility facade for the original Continuum browser-capability API.
 *
 * Procedure identity is delegated to the canonical Skill Runtime normalizer so
 * Continuum no longer owns a competing trajectory-signature implementation.
 * The public record/compile/promote API is intentionally preserved because
 * scheduler, revenue, self-model and existing HTTP routes still consume it.
 */
export class CapabilityCompiler {
  constructor(root, events, knowledge, evidence = null) {
    this.file = path.join(root, 'capabilities.json');
    this.events = events;
    this.knowledge = knowledge;
    this.evidence = evidence;
    this.state = readJson(this.file, {
      trajectories: {},
      capabilities: {},
      updatedAt: nowIso(),
    });
  }

  recordTrajectory(input, actor = 'runtime') {
    const id = input.id ? String(input.id).slice(0, 180) : makeId('traj');
    const actions = Array.isArray(input.actions) ? input.actions.slice(0, 500) : [];
    if (!actions.length) throw new Error('trajectory requires actions');

    if (Boolean(input.verified) && this.evidence) {
      this.evidence.assertRefs(input.evidenceRefs || [], { verified: true });
    }

    const signature = procedureShapeSignature(
      actions.map(toCanonicalOperation),
      { abstractValues: false },
    );

    const trajectory = {
      schema: 'jaco.continuum.trajectory.v1',
      id,
      missionId: input.missionId ? String(input.missionId).slice(0, 180) : null,
      workflowKey: String(input.workflowKey || 'generic').slice(0, 240),
      environment: input.environment || {},
      actions,
      verified: Boolean(input.verified),
      success: Boolean(input.success),
      evidenceRefs: Array.isArray(input.evidenceRefs)
        ? input.evidenceRefs.map(String).slice(0, 500)
        : [],
      createdAt: nowIso(),
      signature,
    };

    this.state.trajectories[id] = trajectory;
    this.#save();
    this.events.append({
      stream: 'capability',
      type: 'trajectory.recorded',
      entityId: id,
      actor,
      data: {
        workflowKey: trajectory.workflowKey,
        verified: trajectory.verified,
        success: trajectory.success,
        signature: trajectory.signature,
      },
    });
    return deepClone(trajectory);
  }

  compile(workflowKey, { minimumVerifiedSuccesses = 3 } = {}, actor = 'capability-compiler') {
    const candidates = Object.values(this.state.trajectories)
      .filter(trajectory => trajectory.workflowKey === workflowKey && trajectory.verified && trajectory.success);

    if (candidates.length < minimumVerifiedSuccesses) {
      throw new Error(`need ${minimumVerifiedSuccesses} verified successful trajectories; found ${candidates.length}`);
    }

    const groups = new Map();
    for (const trajectory of candidates) {
      const list = groups.get(trajectory.signature) || [];
      list.push(trajectory);
      groups.set(trajectory.signature, list);
    }

    const [, best] = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (best.length < minimumVerifiedSuccesses) {
      throw new Error('no stable action signature has enough verified successes');
    }

    const template = best[0].actions.map((action, index) => {
      if (!GENERALIZABLE.has(action.type)) {
        throw new Error(`action '${action.type}' is not eligible for deterministic capability compilation`);
      }
      return {
        index,
        type: action.type,
        selector: action.selector || null,
        url: action.url || null,
        text: action.type === 'set_value' ? `{{input.value_${index}}}` : action.text ?? null,
        checked: action.checked,
        deltaY: action.deltaY,
        postcondition: action.postcondition || null,
      };
    });

    const capabilityId = `cap_${workflowKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}_${best[0].signature.slice(0, 10)}`;
    const capability = {
      schema: 'jaco.continuum.capability.v1',
      id: capabilityId,
      name: workflowKey,
      status: 'DRAFT_VERIFIED_PATTERN',
      workflowKey,
      sourceTrajectoryIds: best.map(trajectory => trajectory.id),
      successCount: best.length,
      totalVerifiedCount: candidates.length,
      confidence: Number((best.length / candidates.length).toFixed(4)),
      inputSchema: { type: 'object', additionalProperties: true },
      steps: template,
      permissions: [...new Set(template.map(step => `browser.${step.type}`))],
      preconditions: ['active_browser_session', 'valid_execution_lease', 'browser_grant'],
      failureModes: ['selector_drift', 'semantic_drift', 'navigation_change', 'grant_expired'],
      createdAt: nowIso(),
      contentHash: `sha256:${sha256(canonicalJson(template))}`,
    };

    this.state.capabilities[capabilityId] = capability;
    this.#save();

    const knowledge = this.knowledge.put({
      id: `knowledge_${capabilityId}`,
      kind: 'capability-pattern',
      purpose: `Reusable browser capability for ${workflowKey}`,
      confidence: capability.confidence,
      evidenceRefs: best.flatMap(trajectory => trajectory.evidenceRefs),
      usedIn: best.map(trajectory => trajectory.missionId).filter(Boolean),
      reusable: true,
      implementation: { capabilityId, steps: template },
      failureModes: capability.failureModes,
      reasoningSummary: `Compiled deterministically from ${best.length} verified successful trajectories sharing the same canonical procedure signature.`,
    }, actor);

    this.events.append({
      stream: 'capability',
      type: 'capability.compiled',
      entityId: capabilityId,
      actor,
      data: {
        workflowKey,
        successCount: best.length,
        confidence: capability.confidence,
        knowledgeId: knowledge.id,
      },
    });

    return { capability: deepClone(capability), knowledge };
  }

  promote(id, { evidenceRefs = [] } = {}, actor = 'operator') {
    const capability = this.state.capabilities[id];
    if (!capability) throw new Error('capability not found');
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.length) {
      throw new Error('promotion requires verification evidence');
    }
    if (this.evidence) this.evidence.assertRefs(evidenceRefs, { verified: true });

    capability.status = 'ACTIVE';
    capability.promotionEvidenceRefs = evidenceRefs.map(String);
    capability.promotedAt = nowIso();
    this.#save();
    this.events.append({
      stream: 'capability',
      type: 'capability.promoted',
      entityId: id,
      actor,
      data: { evidenceRefs },
    });
    return deepClone(capability);
  }

  get(id) {
    const capability = this.state.capabilities[id];
    if (!capability) throw new Error('capability not found');
    return deepClone(capability);
  }

  list() {
    return Object.values(this.state.capabilities).map(deepClone);
  }

  #save() {
    this.state.updatedAt = nowIso();
    atomicWriteJson(this.file, this.state);
  }
}

function toCanonicalOperation(action) {
  return {
    op: action.type,
    target: action.selector || action.url || null,
    input: action.type === 'set_value' ? action.text ?? null : null,
    postcondition: action.postcondition || null,
  };
}
