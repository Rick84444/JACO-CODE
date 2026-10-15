import { normalizeSkillIR } from './skillIR.mjs';

export class CapabilityLinker {
  constructor({ index }) {
    if (!index) throw new Error('SKILL_INDEX_REQUIRED');
    this.index = index;
  }

  link({ id = 'linked-capability', goal = '', requirements = [], substrates = [] } = {}) {
    if (!Array.isArray(requirements) || !requirements.length) throw new Error('CAPABILITY_REQUIREMENTS_REQUIRED');

    const selected = [];
    for (const requirement of requirements) {
      const intent = typeof requirement === 'string' ? requirement : String(requirement.intent || '');
      const requiredSubstrates = typeof requirement === 'string'
        ? substrates
        : (Array.isArray(requirement.substrates) ? requirement.substrates : substrates);
      const matches = this.index.search(intent, { limit: 16, substrates: requiredSubstrates });
      const match = matches.find(candidate => candidate.status === 'ACTIVE') || matches[0];
      if (!match) throw new Error('CAPABILITY_UNRESOLVED:' + intent);
      selected.push({ intent, skillId: match.id });
    }

    const nodes = new Map();
    const edges = [];
    const visiting = new Set();
    const visited = new Set();

    const visit = (skillId) => {
      if (visited.has(skillId)) return;
      if (visiting.has(skillId)) throw new Error('CAPABILITY_DEPENDENCY_CYCLE:' + skillId);
      visiting.add(skillId);
      const manifest = this.index.getDescriptor(skillId);
      if (manifest.status !== 'ACTIVE') throw new Error('CAPABILITY_DEPENDENCY_NOT_ACTIVE:' + skillId);
      nodes.set(skillId, {
        id: skillId,
        version: manifest.version,
        name: manifest.name,
        substrates: manifest.substrates,
      });
      for (const dependency of manifest.dependencies) {
        visit(dependency);
        edges.push({ from: dependency, to: skillId, type: 'REQUIRES' });
      }
      visiting.delete(skillId);
      visited.add(skillId);
    };

    for (const item of selected) visit(item.skillId);

    const order = topologicalOrder([...nodes.keys()], edges);
    const operations = order.map((skillId, index) => ({
      id: 'call_' + (index + 1),
      op: 'CALL',
      target: skillId,
      input: index === 0 ? '$input' : { input: '$input', previous: '$ops.call_' + index },
      metadata: { linkedSkill: true },
    }));
    operations.push({
      id: 'result',
      op: 'RETURN',
      input: order.length ? '$ops.call_' + order.length : '$input',
    });

    const ir = normalizeSkillIR({
      id,
      goal,
      operations,
      metadata: {
        selected,
        graph: { nodes: [...nodes.values()], edges, order },
      },
    });

    return {
      schema: 'jaco.capability.link.v1',
      goal,
      requirements,
      selected,
      nodes: [...nodes.values()],
      edges,
      order,
      ir,
    };
  }
}

function topologicalOrder(nodes, edges) {
  const incoming = new Map(nodes.map(node => [node, 0]));
  const outgoing = new Map(nodes.map(node => [node, []]));
  for (const edge of edges) {
    if (!incoming.has(edge.from) || !incoming.has(edge.to)) continue;
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }
  const queue = [...nodes.filter(node => incoming.get(node) === 0)].sort();
  const order = [];
  while (queue.length) {
    const node = queue.shift();
    order.push(node);
    for (const next of outgoing.get(node)) {
      incoming.set(next, incoming.get(next) - 1);
      if (incoming.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (order.length !== nodes.length) throw new Error('CAPABILITY_DEPENDENCY_CYCLE');
  return order;
}
