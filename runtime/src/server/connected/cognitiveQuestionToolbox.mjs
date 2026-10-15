// Questions inspect the current run. Starting work is the explicit mission action in the composer.
const readTools = new Set(['health','repo_list','repo_read','mission_get','mission_list','git_status','git_log','seer_goals','seer_memory','web_fetch','policy_get']);

export function cognitiveQuestionToolbox(toolbox, readCurrentWork, operatorMessage = '') {
  const tools=Object.fromEntries(Object.entries(toolbox.tools || {}).filter(([name])=>readTools.has(name)));
  // An explicit request to change approvals is an operator action, even in the conversation view.
  // Ordinary status questions still expose no mutation tools. Existing grant and hard stops apply.
  const request = String(operatorMessage).trim();
  const policyRequest = /^(?:jag vill (?:att du )?|ändra |sätt |minska |öka |blockera |godkänn inte )/i.test(request)
    && /godkänn|approve|autonomi|polic|regler/i.test(request)
    && !/^(?:hur|varför|kan du förklara|vad händer)/i.test(request);
  if (policyRequest && toolbox.tools?.policy_update) tools.policy_update = toolbox.tools.policy_update;
  const currentWork={
    description:'Observed current mission events and evidence. These are runtime observations, not inferred thoughts. args: {}',
    run:async()=>readCurrentWork(),
  };
  tools.current_work=currentWork;
  tools.runtime_events=currentWork;
  return {observe:toolbox.observe,tools};
}
