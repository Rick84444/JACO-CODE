import { createHash } from 'node:crypto';
import { AURA_FUNCTION_DEFINITIONS } from './auraFunctions.mjs';
// Questions inspect the current run. Starting work is the explicit mission action in the composer.
const readTools = new Set(['attachment_read','health','termux_services','mcp_catalog','mcp_discover','repo_list','repo_read','jaco_source','mission_get','mission_list','agent_team','aura_runtime','org_mandate','causal_workspace','git_status','git_log','git_pr','mcp_read','seer_goals','seer_memory','web_fetch','policy_get','target_track','dom_track','laser_vision']);

// The existing mcp_read tool is the sole authority for these convenience entry points.
export function withPerceptionTools(tools) {
  if (typeof tools.mcp_read?.run !== 'function') return tools;
  const read = async (tool) => {
    const result = await tools.mcp_read.run({server:'browser',tool,arguments:{}});
    if (result?.isError === true) throw Error('PERCEPTION_MCP_READ_FAILED:' + tool);
    return result;
  };
  const validate = (args, allowed) => {
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(key => !allowed.includes(key))) throw Error('PERCEPTION_ARGUMENTS_INVALID');
  };
  const perceptionTools = {...tools,
    dom_track: {
      description:'Legacy DOM TRACK alias for TARGET TRACK (browser/CDP): read the currently pinned allowed browser page. view: observe (default), accessibility or html. Read-only; respects the existing CDP and organization policy. args: {view?}',
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
        return {captured:true,source:'browser/nova_screenshot',bytes:bytes.length,imageSha256:createHash('sha256').update(bytes).digest('hex'),visualAnalysis:'NOT_PERFORMED',note:'Pixels are not sent to the text chat model. For visual interpretation use the existing mission screenshot workflow with a compatible model.'};
      },
    },
  };
  // A single intent-oriented browser observation replaces several manual
  // DOM/AX commands. This is NOT an actuator or a cross-platform permission:
  // desktop/UIA and Android still use their own signed mission tools.
  const parsePage = receipt => {
    const message = receipt?.content?.find(item => item?.type === 'text' && typeof item.text === 'string')?.text;
    if (typeof message !== 'string' || message.length > 100_000) return null;
    try {
      const page = JSON.parse(message);
      return page?.ok === true && Array.isArray(page.targets) && typeof page.url === 'string' ? page : null;
    } catch { return null; }
  };
  const candidate = node => ({
    role: String(node.role || '').slice(0, 50),
    text: String(node.text || '').slice(0, 160),
    // A selector from a read-only observation is only a hint, never an action lock.
    selectorHint: String(node.selector || '').slice(0, 300),
  });
  perceptionTools.target_track = {
    description: 'TARGET TRACK (browser/CDP): one read-only goal-driven inspection. Give {target:"Save"} to find a visible control with one observation; automatically inspect accessibility if not found. Defaults to a compact page survey. view: auto (default), observe, accessibility or html. The result is NOT a click or a verified action. Windows/Android use their own authorized mission tools. args: {target?,view?,surface?}',
    run: async (args = {}) => {
      validate(args, ['target', 'view', 'surface']);
      const { target = '', view = 'auto', surface = 'browser' } = args;
      if (surface !== 'browser') throw Error('TARGET_TRACK_SURFACE_UNAVAILABLE_USE_MISSION_TOOLS');
      if (typeof target !== 'string' || target.length > 120) throw Error('TARGET_TRACK_TARGET_INVALID');
      if (typeof view !== 'string' || !['auto', 'observe', 'accessibility', 'html'].includes(view)) throw Error('TARGET_TRACK_VIEW_INVALID');
      // Explicit modes preserve the legacy raw reads without extra calls.
      if (view !== 'auto') return perceptionTools.dom_track.run({ view });
      const receipt = await read('nova_observe');
      const page = parsePage(receipt);
      const query = target.trim().toLocaleLowerCase();
      if (!page) return {
        schema: 'jaco.target-track/v1', surface, mode: 'read-only', status: 'UNPARSED_OBSERVATION',
        usedTools: ['nova_observe'], verifiedTarget: false, actionDispatched: false,
        observation: receipt,
      };
      // The receipt must be fresh; mismatched clocks or unknown timestamps
      // cannot establish a target candidate that might already have moved.
      const ageMs = Date.now() - Date.parse(page.at || '');
      if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > 15_000) return {
        schema: 'jaco.target-track/v1', surface, adapter: 'cdp', mode: 'read-only',
        status: 'STALE_OBSERVATION', usedTools: ['nova_observe'],
        verifiedTarget: false, actionDispatched: false,
      };
      // Only visible controls can become candidates. This does not bind a
      // control to the future actuator; browser-click re-identifies it later.
      const visible = page.targets.filter(node => node && typeof node === 'object' && node.visible === true);
      const matched = query ? visible.filter(node => String(node.text || '').toLocaleLowerCase().includes(query)) : visible;
      const exact = query ? matched.filter(node => String(node.text || '').trim().toLocaleLowerCase() === query) : [];
      const candidates = (exact.length ? exact : matched).slice(0, 12).map(candidate);
      const usedTools = ['nova_observe'];
      let accessibility = null;
      if (query && candidates.length === 0) {
        // Fallback is an authorized *read*, not a retry of a failed operation.
        // Refused/failed observations fail closed and are never masked.
        accessibility = await read('nova_ax');
        usedTools.push('nova_ax');
      }
      return {
        schema: 'jaco.target-track/v1', surface, adapter: 'cdp', mode: 'read-only',
        query: target.trim(), observedAt: typeof page.at === 'string' ? page.at : null,
        page: { title: String(page.title || '').slice(0, 160),
          // The browser observation may contain credential-bearing URL parameters.
          url: (() => { try { const u = new URL(page.url); u.search = ''; u.hash = ''; return u.toString().slice(0, 512); } catch { return 'URL_UNAVAILABLE'; } })() },
        status: query ? (candidates.length === 1 ? 'CANDIDATE' : candidates.length > 1 ? 'AMBIGUOUS' : 'NOT_FOUND') : 'OBSERVED',
        candidates, usedTools, verifiedTarget: false, actionDispatched: false,
        ...(accessibility ? { accessibility } : {}),
        note: 'Read-only candidate information; use the existing signed browser actuator to re-identify before any action.',
      };
    },
  };
  // The old ID and its response shape are unchanged.
  return perceptionTools;
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
