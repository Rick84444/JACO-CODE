export interface NodeStatusRecord {
  nodeId: string;
  role: string;
  isAlive: boolean;
  lastHeartbeat: string;
  uptimeSeconds: number;
  activeJobsCount: number;
}

const nodes = new Map<string, NodeStatusRecord>();

export function recordHeartbeat(nodeId: string, role: string, activeJobsCount: number = 0): NodeStatusRecord {
  const now = new Date().toISOString();
  const existing = nodes.get(nodeId);

  const updated: NodeStatusRecord = {
    nodeId,
    role,
    isAlive: true,
    lastHeartbeat: now,
    uptimeSeconds: existing ? existing.uptimeSeconds + 5 : 5,
    activeJobsCount
  };

  nodes.set(nodeId, updated);
  return updated;
}

export function listNodes(): NodeStatusRecord[] {
  return Array.from(nodes.values());
}
