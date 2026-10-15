export function createToolHandlers({ core, system, modelId, workplace = null }) {
  return Object.freeze({
    jaco_identity: async()=>core.identity(), jaco_system_status:async()=>system.status(), jaco_system_activate:async({profile='full'}={})=>system.activate(profile), jaco_system_update:async()=>system.update(),
    jaco_hands_off_status:async()=>core.unifiedStatus(), jaco_browser_targets:async({port}={})=>core.targets(port), jaco_browser_attach:async a=>core.attach(a), jaco_browser_survey:async(a={})=>core.survey(a),
    jaco_nova_begin:async a=>core.novaBegin(a), jaco_nova_target:async a=>core.novaTarget(a), jaco_mandates:async()=>core.mandates(), jaco_relay_action:async a=>core.relayAction({...a,modelId}), jaco_browser_receipts:async({limit=20}={})=>core.browserReceipts(limit),
    jaco_connected_status:async()=>core.connectedStatus(), jaco_seer_live:async()=>core.seerLive(), jaco_seer_goal:async a=>core.seerGoal(a), jaco_mission_list:async({limit=100}={})=>core.missionList(limit), jaco_mission_tickets:async(a={})=>core.missionTickets(a), jaco_mission_tick:async()=>core.missionTick(),
    jaco_providers:async()=>core.providers(), jaco_provider_register:async a=>core.providerRegister(a), jaco_provider_probe:async({id})=>core.providerProbe(id), jaco_aura_provider_chat:async a=>core.auraProviderChat(a),
    jaco_wordpress_status:async()=>core.wordpressStatus(), jaco_wordpress_pages:async(a={})=>core.wordpressPages(a), jaco_wordpress_update_page:async a=>core.wordpressUpdate(a), jaco_wordpress_improve:async a=>core.wordpressImprove(a), jaco_wordpress_apply_css:async a=>core.wordpressCss({...a,modelId}),
    jaco_a2a_discover:async a=>core.a2aDiscover(a), jaco_a2a_outbound:async a=>core.a2aOutbound(a),
    jaco_workplace_status:async()=>workplace?.status?.()||{state:'UNAVAILABLE'},
    jaco_workplace_agents:async()=>workplace?.agents?.()||{agents:[],bridge:{state:'UNAVAILABLE'}},
    jaco_workplace_inbox:async(a={})=>workplace?.messages?.(a)||{events:[],bridge:{state:'UNAVAILABLE'}},
    jaco_workplace_post:async a=>{
      if(!workplace?.post) throw new Error('WORKPLACE_BRIDGE_UNAVAILABLE');
      return workplace.post(a);
    }
  });
}
export const JACO_MCP_TOOL_NAMES=Object.freeze(['jaco_identity','jaco_system_status','jaco_system_activate','jaco_system_update','jaco_hands_off_status','jaco_browser_targets','jaco_browser_attach','jaco_browser_survey','jaco_nova_begin','jaco_nova_target','jaco_mandates','jaco_relay_action','jaco_browser_receipts','jaco_connected_status','jaco_seer_live','jaco_seer_goal','jaco_mission_list','jaco_mission_tickets','jaco_mission_tick','jaco_providers','jaco_provider_register','jaco_provider_probe','jaco_aura_provider_chat','jaco_wordpress_status','jaco_wordpress_pages','jaco_wordpress_update_page','jaco_wordpress_improve','jaco_wordpress_apply_css','jaco_a2a_discover','jaco_a2a_outbound','jaco_workplace_status','jaco_workplace_agents','jaco_workplace_inbox','jaco_workplace_post']);
