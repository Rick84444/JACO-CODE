import { createHash } from 'node:crypto';
import { AURA_FUNCTION_DEFINITIONS } from './auraFunctions.mjs';
// Questions inspect the current run. Starting work is the explicit mission action in the composer.
const readTools = new Set(['attachment_read','health','termux_services','mcp_catalog','mcp_discover','repo_list','repo_read','jaco_source','mission_get','mission_list','agent_team','aura_runtime','org_mandate','causal_workspace','git_status','git_log','git_pr','mcp_read','seer_goals','seer_memory','web_fetch','policy_get','dom_track','laser_vision']);

// The existing mcp_read tool is the sole authority for these convenience entry points.
export function withPerceptionTools(tools) {
  if (typeof tools.mcp_read?.run !== 'function') return tools;
  const read = async (tool) => {
    const result = await tools.mcp_read.run({server:'cdp',tool,arguments:{}});
    if (result?.isError === true) throw Error('PERCEPTION_MCP_READ_FAILED:' + tool);
    return result;
  };
  const validate = (args, allowed) => {
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(key => !allowed.includes(key))) throw Error('PERCEPTION_ARGUMENTS_INVALID');
  };
  return {...tools,
    dom_track: {
      description:'DOM TRACK: read the currently pinned allowed browser page. view: observe (default), accessibility or html. Read-only; respects the existing CDP and organization policy. args: {view?}',
      run: async (args = {}) => {
        validate(args,['view']);
        const views={observe:'nova_observe',accessibility:'nova_ax',html:'nova_html'};
        const view=args.view ?? 'observe';
        if (typeof view !== 'string' || !Object.hasOwn(views,view)) throw Error('DOM_TRACK_VIEW_INVALID');
        return read(views[view]);
      },
    },
    laser_vision: {
      description:'LASER VISION: capture the pinned allowed browser page. Returns capture evidence, not visual interpretation in text chat. For pixel analysis use the existing vision-capable mission screenshot workflow. args: {}',
      run: async (args = {}) => {
        validate(args,[]);
        const result=await read('nova_screenshot');
        const image=result?.content?.find(item=>item.type==='image' && item.mimeType==='image/png');
        if (typeof image?.data !== 'string' || image.data.length > 8_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw Error('LASER_VISION_IMAGE_UNAVAILABLE');
        const bytes=Buffer.from(image.data,'base64');
        if (bytes.length < 24 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw Error('LASER_VISION_INVALID_PNG');
        return {captured:true,source:'cdp/nova_screenshot',bytes:bytes.length,imageSha256:createHash('sha256').update(bytes).digest('hex'),visualAnalysis:'NOT_PERFORMED',note:'Pixels are not sent to the text chat model. For visual interpretation use the existing mission screenshot workflow with a compatible model.'};
      },
    },
  };
}

// Operator 2026-11-19: Aura must be able to fix her own stack when a service is down, also in conversation.
// stack_repair only relaunches local JACO services that are down; it changes no file, mission, policy or remote,
// and it is still gated by her commands.run mandate.
const selfRepairTools = new Set(['stack_repair']);

export function cognitiveQuestionToolbox(toolbox, readCurrentWork, _operatorMessage = '') {
  const tools=Object.fromEntries(Object.entries(toolbox.tools || {}).filter(([name])=>readTools.has(name) || selfRepairTools.has(name)));
  // Aura capabilities are stable contracts, not a claim that a service is healthy.
  // This read-only introspection tool adds no agent, permission or subprocess.
  tools.aura_functions = {
    description: 'List the six canonical functions of the single Aura operator agent. This is a static contract, not a live readiness or execution claim. args: {}',
    run: async () => ({ identity: 'Aura', runtimeConsolidated: false, functions: AURA_FUNCTION_DEFINITIONS }),
  };
  // Manual and Planning are always read-only. A conversation request alone never
  // grants policy mutation; authorized changes use the existing operator control plane.
  const currentWork={
    description:'Observed current mission events and evidence. These are runtime observations, not inferred thoughts. args: {}',
    run:async()=>readCurrentWork(),
  };
  tools.current_work=currentWork;
  tools.runtime_events=currentWork;
  return {observe:toolbox.observe,tools};
}
