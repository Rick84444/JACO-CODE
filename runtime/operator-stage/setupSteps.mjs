// The structured start of JACO, as pure logic (operator 2026-11-25: "start the API, run an LLM or a local LLM,
// tick off fetching the vault, then connect the provider; one stepwise way to activate the whole system, in every
// place we ship the product"). Every tick comes from what the runtime reports, never from a guess:
//   1 api       JACO's runtime answers
//   2 brain     an AI model is connected (a cloud key, or a local model such as Ollama)
//   3 vault     saved credentials are fetched into JACO's own encrypted store (optional, skippable)
//   4 provider  the chosen model is connected and has answered a test question
//   5 activate  the connected tools are started and the agent runtime is ready
export const STEP_IDS = Object.freeze(['api', 'brain', 'vault', 'provider', 'activate']);

/**
 * @param {{
 *   report?: any, error?: string,
 *   vault?: { available?: boolean, keys?: string[], fetched?: string[], configured?: string[] } | null,
 *   skippedVault?: boolean,
 * }} input  report: GET /api/jaco/activation; vault: Windows vault key names, those JACO has stored, and names already configured
 * @returns {{ steps: Array<{ id: string, done: boolean, optional: boolean, skipped: boolean, detail: string }>, current: string | null, ready: boolean }}
 */
export function setupSteps({ report = null, error = '', vault = null, skippedVault = false } = {}) {
  const up = Boolean(report?.runtime?.up) && !error;
  const brain = Boolean(up && report?.providers?.some(p => p.active));
  const provider = Boolean(brain && report?.planner?.reachable === true);
  const activated = Boolean(provider && report?.tools?.toolCount > 0 && report?.ok);
  const pending = vaultRows(vault).filter(row => row.state === 'PENDING');
  const vaultDone = !pending.length;
  const steps = [
    { id: 'api', done: up, optional: false, skipped: false, detail: up ? 'RUNTIME_UP' : error ? 'RUNTIME_UNREACHABLE' : 'RUNTIME_CHECKING' },
    { id: 'brain', done: brain, optional: false, skipped: false, detail: brain ? `${report.providers.filter(p => p.active).length} active` : 'NO_MODEL' },
    { id: 'vault', done: vaultDone, optional: true, skipped: !vaultDone && skippedVault, detail: vaultDone ? 'NOTHING_TO_FETCH' : `${pending.length} to fetch` },
    { id: 'provider', done: provider, optional: false, skipped: false, detail: provider ? `${report.planner.provider}/${report.planner.model}` : report?.planner?.provider ? 'NOT_VERIFIED' : 'NO_CHOICE' },
    { id: 'activate', done: activated, optional: false, skipped: false, detail: activated ? `${report.tools.toolCount} tools` : 'NOT_STARTED' },
  ];
  const next = steps.find(step => !step.done && !step.skipped);
  return { steps, current: next ? next.id : null, ready: steps.every(step => step.done || step.skipped) && activated };
}

/**
 * Every Windows vault key with what JACO knows about it, by name: FETCHED (in JACO's encrypted store), PRESENT
 * (already configured elsewhere, such as a local environment file) or PENDING (still only in the Windows vault).
 */
export function vaultRows(vault) {
  const fetched = new Set(vault?.fetched || []), configured = new Set(vault?.configured || []);
  return (vault?.keys || []).map(name => ({ name, state: fetched.has(name) ? 'FETCHED' : configured.has(name) ? 'PRESENT' : 'PENDING' }));
}

/** The model to pre-select for a step: a connected local model first (nothing leaves the computer), then a cloud default. */
export function suggestModel(providers = []) {
  const usable = providers.filter(p => p.credentialReady !== false && Array.isArray(p.models) && p.models.length);
  const pick = list => list.find(p => p.defaultModel && p.models.includes(p.defaultModel)) || list[0];
  const local = pick(usable.filter(p => p.local)), cloud = pick(usable.filter(p => !p.local));
  const chosen = local || cloud;
  return chosen ? { provider: chosen.id, model: chosen.defaultModel && chosen.models.includes(chosen.defaultModel) ? chosen.defaultModel : chosen.models[0], local: Boolean(chosen.local) } : null;
}

/** A pasted key is never shown or stored by this module; this only decides what the field accepts. */
export function plausibleKey(value) {
  const key = String(value || '').trim();
  return key.length >= 16 && key.length <= 400 && !/\s/.test(key);
}
