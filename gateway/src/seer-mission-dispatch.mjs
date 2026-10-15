// The SEER dispatch boundary. Persist intent before crossing into Nova; replay only
// the same idempotent creation request and durably compensate a cancelled parent.
export function createMissionDispatcher({ missionGraph, createNova, cancelNova, emit = () => {} }) {
  const inFlight = new Map();
  async function complete(entry) {
    if (inFlight.has(entry.idempotency_key)) return inFlight.get(entry.idempotency_key);
    const run = (async () => {
      let nova = { id: entry.nova_mission_id };
      if (!nova.id) {
        nova = await createNova(entry.spec);
        if (!nova?.id) throw new Error('NOVA_MISSION_ID_MISSING');
        missionGraph.recordDispatch(entry.idempotency_key, nova.id);
      }
      const graph = missionGraph.get(entry.graph_id);
      if (!graph) throw new Error('MISSION_GRAPH_NOT_FOUND');
      const node = graph.nodes.find(item => item.key === entry.node_key);
      if (graph.status !== 'ACTIVE' || graph.policy?.outcome_unknown) {
        await cancelNova(nova.id);
        missionGraph.settleDispatch(entry.idempotency_key);
        emit('mission_graph.dispatch_cancelled', { graph_id: graph.id, node_key: entry.node_key, nova_mission_id: nova.id });
        return { graph: missionGraph.get(graph.id), nova, cancelled: true };
      }
      if (node?.nova_mission_id !== nova.id) missionGraph.bindNova(graph.id, entry.node_key, nova.id);
      missionGraph.settleDispatch(entry.idempotency_key);
      return { graph: missionGraph.get(graph.id), nova };
    })();
    inFlight.set(entry.idempotency_key, run);
    try { return await run; } finally { inFlight.delete(entry.idempotency_key); }
  }
  return {
    dispatch: (graphId, nodeKey) => complete(missionGraph.prepareDispatch(graphId, nodeKey)),
    async reconcile() {
      const errors = [];
      for (const entry of missionGraph.pendingDispatches()) {
        try { await complete(entry); }
        catch (error) {
          errors.push({ idempotency_key: entry.idempotency_key, error: error.message });
          emit('mission_graph.dispatch_reconcile_error', { graph_id: entry.graph_id, node_key: entry.node_key, error: error.message });
        }
      }
      return errors;
    },
  };
}
