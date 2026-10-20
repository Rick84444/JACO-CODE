// Read-only projection. SEER's graph nodes are durable task-agent contexts, not extra OS processes.
// No registry, scheduler or authority is created by this view.
export function projectAgentNetwork({ agents, missions, graphs, coordinator, workers = [], missionTruncated = false, text, now }) {
  const nodes = [], links = [], plans = [];
  const root = 'coordinator:seer';
  const taskId = (graphId, key) => 'task:' + JSON.stringify([text(String(graphId), 200), text(String(key), 120)]);
  const health = coordinator?.reachable === true;
  nodes.push({ id:root,kind:'coordinator',name:'JACO',role:'Samordnare',parentId:null,
    status:health ? 'CONNECTED' : 'UNAVAILABLE',purpose:'Tar emot dina mål genom Aura, samordnar planer och följer upp resultaten.',
    model:text(coordinator?.health?.local_model?.model,200),source:'SEER',missionIds:[],planIds:[],lastSeenAt:health ? now : null });
  let truncated=missionTruncated || agents.length>200 || workers.length>100 || (Array.isArray(graphs)&&graphs.length>50);
  const agentIds = new Map();
  for (const agent of agents.slice(0,200)) {
    if(agent.stableId==='seer' && agent.role==='strategic-governor') {
      agentIds.set(agent.agentId,root);
      nodes[0].source='SEER + Workplace';
      nodes[0].missionIds=missions.filter(m=>m.agentId===agent.agentId).map(m=>m.id);
      continue;
    }
    const id='agent:'+agent.agentId;
    agentIds.set(agent.agentId,id);
    nodes.push({ id,kind:'agent',name:agent.name,role:agent.role || 'Ansluten agent',parentId:null,
      status:agent.liveSessions > 0 ? agent.status : 'OFFLINE',purpose:agent.role,
      model:agent.model || null,source:'Workplace',missionIds:missions.filter(m=>m.agentId===agent.agentId).map(m=>m.id),planIds:[],lastSeenAt:agent.lastSeenAt });
    links.push({from:root,to:id,kind:'connection'});
  }
  for (const worker of workers.slice(0,100)) {
    const id='worker:'+text(worker.id,240);
    const fresh=Number.isFinite(Date.parse(worker.heartbeatAt)) && Date.parse(now)-Date.parse(worker.heartbeatAt) <= 180000;
    nodes.push({ id,kind:'worker',name:text(worker.metadata?.name || worker.id,160),role:'Körprocess',parentId:null,
      status:fresh ? text(worker.status,80) : 'OFFLINE',purpose:null,model:null,source:'Durable bus',
      missionIds:[],planIds:[],lastSeenAt:text(worker.heartbeatAt,80) });
    links.push({from:root,to:id,kind:'connection'});
  }
  const bound = new Set();
  for (const graph of (graphs || []).slice(0,50)) {
    const graphNodes=(Array.isArray(graph.nodes) ? graph.nodes : []).slice(0,Math.min(200,Math.max(0,1000-nodes.length)));
    if (graph.nodes?.length > graphNodes.length) truncated=true;
    const keys=new Set(graphNodes.map(n=>n.key));
    const planId='plan:'+text(String(graph.id),200);
    const ids=[];
    for (const item of graphNodes) {
      const id=taskId(graph.id,item.key);
      const parentKey=typeof item.strategy?.delegatedFrom === 'string' && item.strategy.delegatedFrom!==item.key && keys.has(item.strategy.delegatedFrom) ? item.strategy.delegatedFrom : null;
      const parentId=parentKey ? taskId(graph.id,parentKey) : root;
      const mission=missions.find(m=>m.id===item.nova_mission_id);
      if (item.nova_mission_id) bound.add(item.nova_mission_id);
      ids.push(id);
      nodes.push({ id,kind:'task-agent',name:text(item.title || item.key,300),role:'Uppdragsagent',parentId,
        status:text(item.status,80),purpose:text(item.objective,12000),model:null,source:'SEER Mission Graph',
        missionIds:mission ? [mission.id] : [],planIds:[planId],lastSeenAt:mission?.lastActivityAt || null,
        graphId:text(String(graph.id),200),nodeKey:text(item.key,120),
        executorId:mission?.agentId ? agentIds.get(mission.agentId) || null : null,
        dependencies:(item.dependencies || []).map(key=>taskId(graph.id,key)),
        receipts:mission?.receipts || [],blocker:mission?.blocker || null,
        nextSteps:mission?.replanRequest?.subgoals || [],
        execution:mission?.execution || null,
      });
      links.push({from:parentId,to:id,kind:'delegation'});
      for (const dependency of item.dependencies || []) if (keys.has(dependency)) links.push({from:taskId(graph.id,dependency),to:id,kind:'dependency'});
      if (mission?.agentId && agentIds.has(mission.agentId)) links.push({from:agentIds.get(mission.agentId),to:id,kind:'execution'});
    }
    plans.push({id:planId,title:text(graph.title,300),objective:text(graph.objective,12000),status:text(graph.status,80),agentIds:ids,
      replans:(graph.replans || []).slice(-20).map(r=>({reason:text(r.reason,1000),from:taskId(graph.id,r.failed_node_key),to:taskId(graph.id,r.replacement_node_key)})) });
  }
  for (const mission of missions.filter(m=>!bound.has(m.id))) {
    const id='mission:'+mission.id;
    nodes.push({id,kind:'task-agent',name:mission.goal,purpose:mission.goal,role:'Uppdragsagent',parentId:root,
      status:mission.status,model:null,source:'Durable Nova',missionIds:[mission.id],planIds:[],lastSeenAt:mission.lastActivityAt,
      executorId:mission.agentId ? agentIds.get(mission.agentId) || null : null,dependencies:[],receipts:mission.receipts,
      blocker:mission.blocker,nextSteps:mission.replanRequest?.subgoals || [],execution:mission.execution || null});
    links.push({from:root,to:id,kind:'delegation'});
    if (mission.agentId && agentIds.has(mission.agentId)) links.push({from:agentIds.get(mission.agentId),to:id,kind:'execution'});
  }
  // Drop invalid relationships rather than drawing an invented parent. Layout also guards cycles.
  const ids=new Set(nodes.map(n=>n.id));
  return {schema:'jaco.agent-network/v1',observedAt:now,coordinatorId:root,nodes,plans,
    links:links.filter(l=>ids.has(l.from)&&ids.has(l.to)&&l.from!==l.to),
    planningAvailable:Array.isArray(graphs),coordinatorAvailable:health,truncated,
    semantics:'Task agents are durable execution contexts. Connections are observed sessions; spheres are not extra processes.'};
}
