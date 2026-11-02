import { AURA_FUNCTION_DEFINITIONS } from './auraFunctions.mjs';
// Questions inspect the current run. Starting work is the explicit mission action in the composer.
const readTools = new Set(['attachment_read','health','termux_services','repo_list','repo_read','mission_get','mission_list','agent_team','aura_runtime','git_status','git_log','seer_goals','seer_memory','web_fetch','policy_get']);

export function cognitiveQuestionToolbox(toolbox, readCurrentWork) {
  const tools=Object.fromEntries(Object.entries(toolbox.tools || {}).filter(([name])=>readTools.has(name)));
  // Aura capabilities are stable contracts, not a claim that a service is healthy.
  // This read-only introspection tool adds no agent, permission or subprocess.
  tools.aura_functions = {
    description: 'List the six canonical functions of the single Aura operator agent. This is a static contract, not a live readiness or execution claim. args: {}',
    run: async () => ({ identity: 'Aura', runtimeConsolidated: false, functions: AURA_FUNCTION_DEFINITIONS }),
  };
  // This is a hard read-only tool boundary, not a prompt suggestion.
  // Even an explicit natural-language request to change policy cannot grant a
  // mutating tool in Manual/Planning. The operator uses the separately gated
  // action runtime or existing settings to make a real policy change.
  const currentWork={
    description:'Observed current mission events and evidence. These are runtime observations, not inferred thoughts. args: {}',
    run:async()=>readCurrentWork(),
  };
  tools.current_work=currentWork;
  tools.runtime_events=currentWork;
  return {observe:toolbox.observe,tools};
}
