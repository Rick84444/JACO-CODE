/**
 * JACO Native ADK — v1. No agent loop, permission grant, subprocess or durable
 * state is created here. Aura/SEER/Durable Nova remain the sole authorities.
 * The ADK is a developer contract + audited client for the existing runtime.
 */
import { JacoClient, JacoApiError } from '../sdk/jaco-client.mjs';

export const JACO_ADK_VERSION = '1.0.0';
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TERMINAL = new Set(['DONE', 'CANCELLED', 'AWAITING_VERIFICATION']);
const RISK = new Set(['read', 'write', 'high-impact']);

export class AuraAdkError extends Error {
  constructor(code, message = code, { outcomeUnknown = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AuraAdkError';
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}
const reject = (code, message) => { throw new AuraAdkError(code, message); };
const record = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj)
  && (Object.getPrototypeOf(obj) === Object.prototype || Object.getPrototypeOf(obj) === null);
const checkId = (id, label) => {
  if (typeof id !== 'string' || !ID.test(id)) reject('ADK_INVALID_' + label);
  return id;
};
const checkGoal = goal => {
  if (typeof goal !== 'string' || !goal.trim() || goal.trim().length > 12000)
    reject('ADK_INVALID_GOAL');
  return goal.trim();
};
const safeSize = (value, max) => {
  let json;
  try { json = JSON.stringify(value); } catch { reject('ADK_ARGUMENTS_NOT_JSON'); }
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > max)
    reject('ADK_ARGUMENTS_TOO_LARGE');
  return json;
};
const safeJson = (value, depth = 0) => {
  if (depth > 16) reject('ADK_ARGUMENTS_TOO_DEEP');
  if (Array.isArray(value)) return value.map(item => safeJson(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    if (!record(value)) reject('ADK_ARGUMENTS_NOT_PLAIN');
    const result = Object.create(null);
    for (const [key, val] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) reject('ADK_ARGUMENT_KEY_DENIED');
      result[key] = safeJson(val, depth + 1);
    }
    return result;
  }
  if (value !== null && !['string', 'boolean', 'number'].includes(typeof value))
    reject('ADK_ARGUMENTS_NOT_JSON');
  if (typeof value === 'number' && !Number.isFinite(value)) reject('ADK_ARGUMENTS_NOT_JSON');
  return value;
};
const freeze = value => {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

export function defineAuraProgram(spec) {
  if (!record(spec)) reject('ADK_PROGRAM_REQUIRED');
  const allowed = new Set(['id', 'version', 'description', 'execution', 'readTools']);
  if (Object.keys(spec).some(key => !allowed.has(key))) reject('ADK_UNRECOGNIZED_PROGRAM_FIELD');
  if (typeof spec.id !== 'string' || !NAME.test(spec.id) || spec.id.length > 64)
    reject('ADK_PROGRAM_ID_INVALID');
  if (typeof spec.version !== 'string' || !VERSION.test(spec.version))
    reject('ADK_PROGRAM_VERSION_INVALID');
  if (typeof spec.description !== 'string' || !spec.description.trim() || spec.description.length > 600)
    reject('ADK_PROGRAM_DESCRIPTION_INVALID');
  if (!record(spec.execution) || !['goal', 'skill'].includes(spec.execution.type))
    reject('ADK_EXECUTION_INVALID');
  if (Object.keys(spec.execution).some(key => !['type', 'skillId'].includes(key)))
    reject('ADK_EXECUTION_FIELD_INVALID');
  if (spec.execution.type === 'skill') checkId(spec.execution.skillId, 'SKILL_ID');
  else if (spec.execution.skillId !== undefined) reject('ADK_GOAL_HAS_SKILL_ID');
  if (spec.readTools !== undefined && (!Array.isArray(spec.readTools) || spec.readTools.length > 32))
    reject('ADK_READ_TOOLS_INVALID');
  const seen = new Set();
  const readTools = (spec.readTools || []).map(tool => {
    if (!record(tool) || Object.keys(tool).some(k => !['providerId', 'toolName'].includes(k)))
      reject('ADK_TOOL_DECLARATION_INVALID');
    const providerId = checkId(tool.providerId, 'PROVIDER_ID');
    const toolName = checkId(tool.toolName, 'TOOL_NAME');
    const key = providerId + ':' + toolName;
    if (seen.has(key)) reject('ADK_DUPLICATE_TOOL');
    seen.add(key);
    return { providerId, toolName, mode: 'read' };
  });
  return freeze({
    schema: 'jaco.adk.program/v1',
    id: spec.id, version: spec.version, description: spec.description.trim(),
    execution: { type: spec.execution.type, ...(spec.execution.type === 'skill' ? { skillId: spec.execution.skillId } : {}) },
    readTools,
    operatorIdentity: 'aura',
  });
}
const programRequired = program => {
  if (!record(program) || program.schema !== 'jaco.adk.program/v1' || program.operatorIdentity !== 'aura'
      || !Object.isFrozen(program)) reject('ADK_DEFINE_PROGRAM_FIRST');
  return program;
};

const stateOf = body => {
  const mission = body?.mission || body;
  if (!record(mission) || typeof mission.status !== 'string') reject('ADK_MISSION_SCHEMA_INVALID');
  const status = mission.status;
  const receipts = Array.isArray(mission.receipts) ? mission.receipts : null;
  return {
    schema: 'jaco.adk.mission-observation/v1',
    id: checkId(mission.id, 'MISSION_ID'), status,
    phase: typeof mission.phase === 'string' ? mission.phase : null,
    observedAt: new Date().toISOString(),
    receiptCount: receipts ? receipts.length : null,
    verifiedSteps: receipts ? receipts.filter(r => r?.verified === true && r?.ok === true && r?.outcomeUnknown !== true).length : null,
    uncertainOutcomes: receipts ? receipts.filter(r => r?.outcomeUnknown === true).length : null,
    machineVerified: mission.contractStatus?.machineVerified === true,
    completionClaimed: status === 'DONE',
    // DONE and individual verified steps are NOT evidence of external goal acceptance.
    accepted: false,
    terminal: TERMINAL.has(status),
  };
};

async function pause(ms, signal) {
  if (signal?.aborted) throw new AuraAdkError('ADK_ABORTED');
  await new Promise((resolve, rejectPromise) => {
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      rejectPromise(new AuraAdkError('ADK_ABORTED'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

export class AuraAdk {
  constructor({ client, endpoint, token, onEvent, maxObservationAgeMs = 30000 } = {}) {
    this.client = client || new JacoClient({ endpoint, token });
    if (typeof this.client.request !== 'function') reject('ADK_CLIENT_INVALID');
    // The existing /api/aura/workbench endpoints are loopback-only.
    // Do not imply that a token turns this into a remote-facing API.
    if (this.client.endpoint) {
      const url = new URL(this.client.endpoint);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        reject('ADK_LOCAL_ONLY');
    }
    if (!Number.isSafeInteger(maxObservationAgeMs) || maxObservationAgeMs < 1000 || maxObservationAgeMs > 120000)
      reject('ADK_OBSERVATION_AGE_INVALID');
    this.maxObservationAgeMs = maxObservationAgeMs;
    this.onEvent = typeof onEvent === 'function' ? onEvent : null;
  }

  emit(type, data = {}) {
    if (!this.onEvent) return;
    try { this.onEvent(Object.freeze({ schema: 'jaco.adk.event/v1', type, at: new Date().toISOString(), ...data })); }
    catch { /* Telemetry observers cannot change mission outcomes. */ }
  }

  async inspect({ signal } = {}) {
    const body = await this.client.request('/api/aura/workbench/agent-board', { signal });
    if (body?.success !== true || body?.schema !== 'jaco.aura-agent-board/v1'
        || body?.aura?.identity?.id !== 'aura' || body?.aura?.identity?.agentCount !== 1
        || body?.aura?.runtimeConsolidated !== false || !body?.aura?.oversight)
      reject('ADK_AURA_SCHEMA_MISMATCH');
    const age = Date.now() - Date.parse(body.observedAt || '');
    if (!Number.isFinite(age) || age < -5000 || age > this.maxObservationAgeMs)
      reject('ADK_AURA_OBSERVATION_STALE');
    const result = {
      schema: 'jaco.adk.runtime/v1',
      operator: 'aura',
      observedAt: body.observedAt,
      sources: {
        workplace: body.sources?.workplace?.available === true,
        missions: body.sources?.missions?.available === true,
      },
      runtimeConsolidated: false,
      functions: (body.aura.functions || []).map(f => ({ id: f.id, state: f.state })),
      oversight: body.aura.oversight,
    };
    this.emit('runtime.observed', { degraded: !result.sources.workplace || !result.sources.missions });
    return result;
  }

  async dispatch(program, { goal, input = '', testCommands = [], operatorAuthorized = false, signal } = {}) {
    programRequired(program);
    if (operatorAuthorized !== true) reject('ADK_OPERATOR_AUTHORIZATION_REQUIRED');
    if (signal?.aborted) reject('ADK_ABORTED');
    let path, body;
    if (program.execution.type === 'goal') {
      path = '/api/aura/workbench/start-goal';
      body = { goal: checkGoal(goal) };
    } else {
      if (typeof input !== 'string' || input.length > 10000) reject('ADK_INVALID_SKILL_INPUT');
      if (!Array.isArray(testCommands) || testCommands.length > 8
          || testCommands.some(t => typeof t !== 'string' || !t.trim() || t.length > 500))
        reject('ADK_INVALID_TEST_COMMANDS');
      path = '/api/aura/workbench/skills/' + encodeURIComponent(program.execution.skillId) + '/run';
      body = { input, testCommands };
    }
    let response;
    try {
      // Never retry a mutation. A dropped response can mean an unknown outcome.
      response = await this.client.request(path, { method: 'POST', body, signal });
    } catch (error) {
      if (signal?.aborted) throw new AuraAdkError('ADK_DISPATCH_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true, cause: error });
      if (error instanceof JacoApiError && error.status >= 400 && error.status < 500) throw error;
      throw new AuraAdkError('ADK_DISPATCH_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true, cause: error });
    }
    if (response?.success !== true)
      throw new AuraAdkError('ADK_DISPATCH_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true });
    const goalId = response.goal?.id;
    const missionId = response.mission?.id;
    const kind = program.execution.type === 'skill' || (response.lite === true) ? 'nova-mission' : 'seer-goal';
    const id = kind === 'nova-mission' ? missionId : goalId;
    if (!id || typeof id !== 'string' || !ID.test(id))
      throw new AuraAdkError('ADK_DISPATCH_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true });
    const result = Object.freeze({ schema: 'jaco.adk.dispatch/v1',
      kind, id, programId: program.id, state: 'SUBMITTED', executionVerified: false });
    this.emit('dispatch.submitted', { programId: program.id, kind, id });
    return result;
  }

  async mission(id, { signal } = {}) {
    checkId(id, 'MISSION_ID');
    const body = await this.client.request('/api/connected/nova/missions/' + encodeURIComponent(id), { signal });
    const result = stateOf(body);
    if (result.id !== id) reject('ADK_MISSION_ID_MISMATCH');
    this.emit('mission.observed', { id, status: result.status, uncertain: result.uncertainOutcomes });
    return result;
  }

  async awaitMission(id, { intervalMs = 2000, timeoutMs = 60000, signal } = {}) {
    checkId(id, 'MISSION_ID');
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 250 || intervalMs > 30000)
      reject('ADK_POLL_INTERVAL_INVALID');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 600000)
      reject('ADK_POLL_TIMEOUT_INVALID');
    const deadline = Date.now() + timeoutMs;
    while (true) {
      if (signal?.aborted) reject('ADK_ABORTED');
      const observation = await this.mission(id, { signal });
      if (observation.terminal) return observation;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new AuraAdkError('ADK_WAIT_TIMEOUT', 'Mission still owned by the server; no cancellation or replay was performed');
      await pause(Math.min(intervalMs, remaining), signal);
    }
  }

  async reviewMission(id, { signal } = {}) {
    checkId(id, 'MISSION_ID');
    const result = await this.client.request('/api/aura/workbench/missions/' + encodeURIComponent(id) + '/review', { signal });
    if (result?.success !== true || !record(result.review)) reject('ADK_REVIEW_UNAVAILABLE');
    // Review is a read-only server projection. It is not an ADK approval.
    return result.review;
  }

  async cancelMission(id, { operatorAuthorized = false, signal } = {}) {
    checkId(id, 'MISSION_ID');
    if (operatorAuthorized !== true) reject('ADK_OPERATOR_AUTHORIZATION_REQUIRED');
    try {
      const result = await this.client.request('/api/aura/workbench/missions/' + encodeURIComponent(id) + '/cancel',
        { method: 'POST', signal });
      if (result?.success !== true) reject('ADK_CANCEL_UNCONFIRMED');
      this.emit('mission.cancel.requested', { id });
      return { id, requested: true, server: result };
    } catch (error) {
      if (error instanceof JacoApiError && error.status >= 400 && error.status < 500) throw error;
      throw new AuraAdkError('ADK_CANCEL_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true, cause: error });
    }
  }

  async readTool(program, { providerId, toolName, args = {}, signal } = {}) {
    programRequired(program);
    checkId(providerId, 'PROVIDER_ID');
    checkId(toolName, 'TOOL_NAME');
    if (!program.readTools.some(t => t.providerId === providerId && t.toolName === toolName))
      reject('ADK_TOOL_NOT_DECLARED');
    if (!record(args)) reject('ADK_ARGUMENTS_NOT_PLAIN');
    const argumentsSafe = safeJson(args);
    safeSize(argumentsSafe, 8192);
    // MCP metadata is advisory; the canonical server still enforces authority.
    // No arbitrary remote code is loaded and no tool definition grants a capability.
    if (typeof this.client.tools?.list !== 'function') reject('ADK_TOOL_DISCOVERY_UNAVAILABLE');
    const registered = await this.client.tools.list();
    const tool = Array.isArray(registered) ? registered.find(t =>
      t.providerId === providerId && t.name === toolName) : null;
    if (!tool || !(tool.readOnly === true || tool.annotations?.readOnlyHint === true))
      reject('ADK_TOOL_READ_ONLY_NOT_ATTESTED');
    let response;
    try {
      response = await this.client.request('/api/aura/workbench/mcp/call', { method: 'POST',
        body: { providerId, toolName, arguments: argumentsSafe }, signal });
    } catch (error) {
      if (error instanceof JacoApiError && error.status >= 400 && error.status < 500) throw error;
      throw new AuraAdkError('ADK_TOOL_OUTCOME_UNKNOWN', undefined, { outcomeUnknown: true, cause: error });
    }
    if (response?.success !== true || response?.result?.isError === true)
      reject('ADK_TOOL_REJECTED');
    this.emit('tool.read.observed', { providerId, toolName });
    return response.result;
  }
}

export function createAuraAdk(options = {}) { return new AuraAdk(options); }
