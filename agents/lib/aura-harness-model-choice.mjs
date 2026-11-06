// A single operator selection for Aura chat and the existing SEER/Nova planning
// harness. This does not introduce a new provider registry, spend policy or model
// process. It is invoked only when the operator explicitly starts a goal from chat.
import { readPlannerChoice, validatePlannerChoice, validPlannerModelId, writePlannerChoice } from './planner-choice.mjs';

/**
 * @param {{providerId:string,model:string}|undefined|null} selection
 * @param {{file:string,env?:NodeJS.ProcessEnv,connectedChoices?:Record<string,any>,probe?:(choice:any)=>Promise<{ok:boolean}>}} options
 */
export async function synchronizeAuraHarnessModel(selection, { file, env = process.env, connectedChoices = {}, probe } = {}) {
  if (!file) throw new Error('AURA_HARNESS_CHOICE_FILE_REQUIRED');
  // Existing API clients (and Aura's canonical/default route) keep the current
  // planner selection; never reset a running system on an omitted preference.
  if (selection === undefined || selection === null) return {
    synchronized: false, choice: readPlannerChoice(file), source: 'existing',
  };
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
      || Object.keys(selection).some(key => !['providerId','model'].includes(key))) {
    throw new Error('AURA_HARNESS_MODEL_SELECTION_INVALID');
  }
  const providerId = selection.providerId;
  const model = selection.model;
  if (typeof providerId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(providerId)
      || providerId === 'seer' || typeof model !== 'string' || !validPlannerModelId(model)) {
    throw new Error('AURA_HARNESS_MODEL_SELECTION_INVALID');
  }
  // Environment authority cannot silently be replaced by a GUI selection.
  if (env.JACO_PRIMARY_PROVIDER && env.JACO_AURA_UNIFIED_RUNTIME !== '1') throw new Error('PLANNER_ENV_PRIMARY_AUTHORITATIVE');
  const validated = validatePlannerChoice({ provider: providerId, model }, env, connectedChoices);
  if (validated.provider !== providerId || validated.model !== model) throw new Error('AURA_HARNESS_MODEL_CHANGED_DURING_VALIDATION');
  const before = readPlannerChoice(file);
  if (before?.by === 'operator' && before.provider === providerId && before.model === model) {
    return { synchronized: true, choice: { provider: providerId, model, by: 'operator' }, changed: false, source: 'operator' };
  }
  // A plain text completion is an availability probe, not proof of native tool
  // calling. The probe runs through the EXISTING Continuum cloud reservation;
  // never use a direct unmetered provider fetch here.
  if (typeof probe !== 'function') throw new Error('AURA_HARNESS_MODEL_PROBE_REQUIRED');
  const check = await probe(validated);
  if (check?.ok !== true) throw new Error('AURA_HARNESS_MODEL_TEXT_PROBE_FAILED');
  const saved = writePlannerChoice(file, { provider: providerId, model }, 'operator');
  return {
    synchronized: true, choice: { provider: saved.provider, model: saved.model, by: saved.by },
    changed: true, source: 'operator', verifiedText: true, verifiedToolCalling: false,
  };
}

/**
 * Choose the protocol, not a different model. Native function calls are best
 * when supported; a selected provider without tool-call support uses JACO's
 * existing schema/text planner and the SAME pinned provider/model.
 */
export function auraHarnessPlannerProtocol(provider, { nativeToolsAllowed = true, nativeToolsRejected = false } = {}) {
  return provider?.chosen && (!nativeToolsAllowed || nativeToolsRejected) ? 'structured' : 'native';
}
