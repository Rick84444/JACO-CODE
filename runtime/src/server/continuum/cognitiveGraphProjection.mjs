import { createHash } from 'node:crypto';

const INACTIVE = new Set(['STALE', 'SUPERSEDED', 'CONTRADICTED', 'INVALID']);
const clamp = (value, fallback, maximum) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(maximum, Math.trunc(n))) : fallback;
};
const unique = values => [...new Set((Array.isArray(values) ? values : []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))];
const digest = data => 'sha256:' + createHash('sha256').update(JSON.stringify(data)).digest('hex');

/**
 * Read-only, bounded graph over canonical KnowledgeStore, EvidenceLedger and
 * SemanticRepositoryModel. It has no write path or competing source of truth.
 * All edge types derive from explicit stored references or observed imports.
 */
export class CognitiveGraphProjection {
  constructor({ knowledge, evidence, repository }) {
    if (!knowledge?.list || !evidence?.get || !repository?.snapshot) throw new Error('COGNITIVE_GRAPH_SOURCES_REQUIRED');
    this.knowledge = knowledge;
    this.evidence = evidence;
    this.repository = repository;
  }

  build({ includeInactive = false } = {}) {
    const repo = this.repository.snapshot();
    const revision = repo.snapshotHash || null;
    const files = (Array.isArray(repo.files) ? repo.files : []).slice(0, 5000);
    const knownFiles = new Map(files.map(file => [file.path, file]));
    const knowledge = this.knowledge.list({ limit: 1000 });
    const knownKnowledge = new Map(knowledge.map(item => [item.id, item]));
    const effective = new Map();
    const verifiedEvidence = new Map();

    for (const item of knowledge) {
      let state = item.verificationStatus || 'UNVERIFIED';
      const boundRevision = item.metrics?.repositorySnapshotHash || item.implementation?.repositorySnapshotHash || null;
      if (revision && boundRevision && revision !== boundRevision) state = 'STALE';
      for (const id of unique(item.evidenceRefs)) {
        let exists = verifiedEvidence.get(id);
        if (exists === undefined) {
          try { exists = this.evidence.get(id); } catch { exists = null; }
          verifiedEvidence.set(id, exists);
        }
        if (state === 'VERIFIED' && !exists?.verified) state = 'UNVERIFIED';
      }
      effective.set(item.id, state);
    }
    // Invalidation propagates only through explicit, resolved knowledge dependencies.
    for (let iteration = 0; iteration < knowledge.length; iteration++) {
      let changed = false;
      for (const item of knowledge) {
        if (effective.get(item.id) !== 'VERIFIED') continue;
        if (unique(item.dependencies).some(id => knownKnowledge.has(id) && effective.get(id) !== 'VERIFIED')) {
          effective.set(item.id, 'STALE');
          changed = true;
        }
      }
      if (!changed) break;
    }

    const nodes = new Map();
    const edges = new Map();
    const putNode = (id, type, attributes) => {
      if (nodes.size >= 7500 || nodes.has(id)) return;
      nodes.set(id, { id, type, ...attributes });
    };
    const putEdge = (from, to, type, source, observedAt = null) => {
      if (edges.size >= 30000 || !nodes.has(from) || !nodes.has(to)) return;
      const id = digest([from, type, to]);
      if (!edges.has(id)) edges.set(id, { id, from, to, type, source, observedAt });
    };

    for (const file of files) {
      putNode(`file:${file.path}`, 'FILE', {
        label: file.path,
        revision: file.sha256 || null,
        parser: file.parser || 'unverified',
        symbols: (file.symbols || []).slice(0, 100),
        verificationStatus: 'OBSERVED',
        source: 'semantic-repository',
      });
    }
    for (const item of knowledge) {
      const state = effective.get(item.id);
      if (!includeInactive && INACTIVE.has(state)) continue;
      putNode(`knowledge:${item.id}`, 'KNOWLEDGE', {
        label: String(item.purpose || item.id).slice(0, 250),
        kind: item.kind,
        confidence: item.confidence,
        verificationStatus: state,
        storedVerificationStatus: item.verificationStatus,
        contentHash: item.contentHash || null,
        revision: item.revision,
        observedAt: item.updatedAt || null,
        source: 'knowledge-store',
      });
    }

    for (const item of knowledge) {
      const from = `knowledge:${item.id}`;
      if (!nodes.has(from)) continue;
      for (const dependency of unique(item.dependencies)) {
        const target = knownKnowledge.has(dependency) ? `knowledge:${dependency}` : knownFiles.has(dependency) ? `file:${dependency}` : null;
        if (target) putEdge(from, target, 'DEPENDS_ON', 'knowledge-store', item.updatedAt || null);
      }
      for (const target of unique(item.usedIn)) {
        if (knownFiles.has(target)) putEdge(from, `file:${target}`, 'USED_IN', 'knowledge-store', item.updatedAt || null);
      }
      for (const id of unique(item.evidenceRefs)) {
        const receipt = verifiedEvidence.get(id);
        if (!receipt) continue;
        const evidenceId = `evidence:${id}`;
        putNode(evidenceId, 'EVIDENCE', {
          label: String(receipt.claim || id).slice(0, 250),
          verified: receipt.verified === true,
          kind: receipt.kind,
          revision: receipt.contentHash || null,
          observedAt: receipt.observedAt || null,
          source: 'evidence-ledger',
        });
        putEdge(from, evidenceId, 'SUPPORTED_BY', 'knowledge-store', item.updatedAt || null);
      }
    }
    for (const edge of (Array.isArray(repo.edges) ? repo.edges : []).slice(0, 30000)) {
      if (edge.type === 'IMPORTS') putEdge(`file:${edge.from}`, `file:${edge.to}`, 'IMPORTS', 'semantic-repository', repo.updatedAt || null);
    }
    const result = { schema: 'jaco.cognitive-graph.projection.v1', authority: 'DERIVED_READ_ONLY',
      repositorySnapshotHash: revision, repositoryStatus: repo.status || 'EMPTY',
      sourceKnowledgeCount: knowledge.length,
      sourceFileCount: (repo.files || []).length,
      truncatedSources: knowledge.length >= 1000 || (repo.files || []).length > 5000,
      nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    };
    result.graphHash = digest({ nodes: result.nodes, edges: result.edges, repositorySnapshotHash: revision });
    return result;
  }

  snapshot({ limit = 200, includeInactive = false } = {}) {
    const graph = this.build({ includeInactive });
    const max = clamp(limit, 200, 1000);
    const nodes = graph.nodes.slice(0, max);
    const ids = new Set(nodes.map(node => node.id));
    return { ...graph, totalNodes: graph.nodes.length, totalEdges: graph.edges.length,
      partial: graph.truncatedSources || nodes.length !== graph.nodes.length,
      nodes, edges: graph.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)).slice(0, 3000) };
  }

  search(query, { limit = 20, includeInactive = false } = {}) {
    const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 20);
    if (!terms.length) return { schema: 'jaco.cognitive-graph.search.v1', matches: [], graphHash: null };
    const graph = this.build({ includeInactive });
    const matches = graph.nodes.map(node => {
      const hay = [node.label, node.id, node.kind, ...(node.symbols || [])].join(' ').toLowerCase();
      const score = terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
      return { score, node };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id))
      .slice(0, clamp(limit, 20, 100));
    return { schema: 'jaco.cognitive-graph.search.v1', graphHash: graph.graphHash,
      matches, repositorySnapshotHash: graph.repositorySnapshotHash, partial: graph.truncatedSources };
  }

  neighbors(id, { depth = 1, limit = 100, includeInactive = false } = {}) {
    const graph = this.build({ includeInactive });
    const start = String(id || '');
    if (!graph.nodes.some(node => node.id === start)) throw new Error('COGNITIVE_GRAPH_NODE_NOT_FOUND');
    const adjacent = new Map();
    for (const edge of graph.edges) {
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]]) {
        if (!adjacent.has(a)) adjacent.set(a, []);
        adjacent.get(a).push({ next: b, edge });
      }
    }
    const seen = new Set([start]), collected = new Map();
    let frontier = [start];
    const max = clamp(limit, 100, 500);
    for (let i = 0; i < clamp(depth, 1, 3) && frontier.length; i++) {
      const next = [];
      for (const nodeId of frontier) {
        for (const { next: target, edge } of adjacent.get(nodeId) || []) {
          if (seen.size >= max && !seen.has(target)) continue;
          collected.set(edge.id, edge);
          if (!seen.has(target)) { seen.add(target); next.push(target); }
        }
      }
      frontier = next;
    }
    return { schema: 'jaco.cognitive-graph.neighbors.v1', graphHash: graph.graphHash,
      root: start, nodes: graph.nodes.filter(node => seen.has(node.id)),
      edges: [...collected.values()], partial: graph.truncatedSources || seen.size >= max };
  }
}
