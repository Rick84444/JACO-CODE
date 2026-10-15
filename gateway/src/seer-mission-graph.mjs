// SEER Long-Horizon Mission Graph v1
// SEER owns orchestration state; Nova remains the sole execution owner.
import { prepareStrategicPlan, projectStrategicBoard } from './seer-strategic-board.mjs';
import { isStrategicStepExecutable } from '../../agents/lib/aura-strategic-board.mjs';
import { compactStrategicBoard } from '../../agents/lib/strategic-context.mjs';

const NODE_STATES = new Set(['BLOCKED','READY','DISPATCHED','RUNNING','VERIFIED','FAILED','SUPERSEDED','CANCELLED']);

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value) {
  return [...new Set(asArray(value).map(String).map(x => x.trim()).filter(Boolean))];
}

function validateNodeKey(key) {
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(key)) throw new Error('INVALID_NODE_KEY');
  return key;
}

function assertDag(nodes) {
  const keys = new Set(nodes.map(node => node.key));
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!keys.has(dependency)) throw new Error(`UNKNOWN_DEPENDENCY:${dependency}`);
      if (dependency === node.key) throw new Error(`SELF_DEPENDENCY:${node.key}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(nodes.map(node => [node.key, node]));
  const visit = key => {
    if (visiting.has(key)) throw new Error('MISSION_GRAPH_CYCLE');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dep of byKey.get(key).dependencies) visit(dep);
    visiting.delete(key);
    visited.add(key);
  };
  for (const node of nodes) visit(node.key);
}

export function createMissionGraph({ db, emit = () => {}, uid, now, js = JSON.stringify, jp = parseJson }) {
  if (!db || !uid || !now) throw new Error('createMissionGraph requires db, uid and now');

  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_graph_dispatches (
      idempotency_key TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      spec TEXT NOT NULL,
      nova_mission_id TEXT,
      state TEXT NOT NULL DEFAULT 'PREPARED',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mission_graphs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      policy TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS mission_graph_nodes (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      node_key TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      contract TEXT NOT NULL DEFAULT '{}',
      dependencies TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      nova_mission_id TEXT,
      attempt INTEGER NOT NULL DEFAULT 0,
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      failure_reason TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(graph_id,node_key),
      FOREIGN KEY(graph_id) REFERENCES mission_graphs(id)
    );
    CREATE TABLE IF NOT EXISTS mission_graph_checkpoints (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      node_key TEXT,
      label TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY(graph_id) REFERENCES mission_graphs(id)
    );
    CREATE TABLE IF NOT EXISTS mission_graph_replans (
      id TEXT PRIMARY KEY,
      graph_id TEXT NOT NULL,
      failed_node_key TEXT NOT NULL,
      replacement_node_key TEXT NOT NULL,
      reason TEXT NOT NULL,
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY(graph_id) REFERENCES mission_graphs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mission_graph_status ON mission_graphs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_mission_graph_nodes_graph ON mission_graph_nodes(graph_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_mission_graph_nodes_nova ON mission_graph_nodes(nova_mission_id);
  `);
  if (!db.prepare('PRAGMA table_info(mission_graph_nodes)').all().some(column => column.name === 'strategy')) {
    db.exec("ALTER TABLE mission_graph_nodes ADD COLUMN strategy TEXT NOT NULL DEFAULT '{}'");
  }

  const tx = fn => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  const parseNode = row => row && ({
    ...row,
    key: row.node_key,
    contract: jp(row.contract, {}),
    dependencies: jp(row.dependencies, []),
    evidence_refs: jp(row.evidence_refs, []),
    strategy: jp(row.strategy, {}),
  });

  const node = (graphId, key) => parseNode(
    db.prepare('SELECT * FROM mission_graph_nodes WHERE graph_id=? AND node_key=?').get(graphId, key),
  );

  const nodeRows = graphId => db.prepare(
    'SELECT * FROM mission_graph_nodes WHERE graph_id=? ORDER BY created_at ASC,rowid ASC',
  ).all(graphId).map(parseNode);

  const checkpointRows = graphId => db.prepare(
    'SELECT * FROM mission_graph_checkpoints WHERE graph_id=? ORDER BY created_at ASC,rowid ASC',
  ).all(graphId).map(row => ({
    ...row,
    snapshot: jp(row.snapshot, {}),
    evidence_refs: jp(row.evidence_refs, []),
  }));

  const replanRows = graphId => db.prepare(
    'SELECT * FROM mission_graph_replans WHERE graph_id=? ORDER BY created_at ASC,rowid ASC',
  ).all(graphId).map(row => ({ ...row, evidence_refs: jp(row.evidence_refs, []) }));

  const summarize = nodes => ({
    total: nodes.length,
    blocked: nodes.filter(x => x.status === 'BLOCKED').length,
    ready: nodes.filter(x => x.status === 'READY').length,
    dispatched: nodes.filter(x => x.status === 'DISPATCHED').length,
    running: nodes.filter(x => x.status === 'RUNNING').length,
    verified: nodes.filter(x => x.status === 'VERIFIED').length,
    failed: nodes.filter(x => x.status === 'FAILED').length,
    superseded: nodes.filter(x => x.status === 'SUPERSEDED').length,
  });

  const rawGraph = id => db.prepare('SELECT * FROM mission_graphs WHERE id=?').get(id);

  function assertOutcomeKnown(graphId) {
    if (jp(rawGraph(graphId)?.policy, {}).outcome_unknown || nodeRows(graphId).some(item =>
      ['NOVA_UNCERTAIN_OUTCOME_BUDGET_EXHAUSTED','NOVA_BINDING_MISSING_OUTCOME_UNKNOWN'].includes(item.failure_reason))) {
      throw new Error('GRAPH_OUTCOME_UNKNOWN');
    }
  }

  function quarantine(graphId, key, reason, evidence_refs = []) {
    return tx(() => {
      const existing = rawGraph(graphId);
      if (!existing) throw new Error('MISSION_GRAPH_NOT_FOUND');
      if (existing.status === 'CANCELLED') return get(graphId);
      const policy = { ...jp(existing.policy, {}), outcome_unknown: { node_key: key, reason, at: now(), evidence_refs } };
      db.prepare('UPDATE mission_graphs SET status=?,policy=?,updated_at=? WHERE id=?')
        .run('EXHAUSTED', js(policy), now(), graphId);
      emit('mission_graph.outcome_quarantined', { graph_id: graphId, node_key: key, reason, evidence_refs });
      return get(graphId);
    });
  }

  function projection(graphId, rows = nodeRows(graphId)) {
    const graph = rawGraph(graphId);
    return projectStrategicBoard({ ...graph, policy: jp(graph.policy, {}) }, rows);
  }

  function refresh(graphId) {
    // A CANCELLED graph is a real terminal state (replan attempts exhausted with no path
    // forward). It must never be recomputed back to ACTIVE/NEEDS_REPLAN/VERIFIED, or a graph
    // that can never make progress would sit in NEEDS_REPLAN forever, permanently consuming the
    // governor's single active-work admission slot.
    if (['CANCELLED','EXHAUSTED'].includes(rawGraph(graphId)?.status)) return nodeRows(graphId);
    const rows = nodeRows(graphId);
    const { board } = projection(graphId, rows);
    for (const item of rows) {
      if (!['BLOCKED','READY'].includes(item.status)) continue;
      const status = isStrategicStepExecutable(board, item.key) ? 'READY' : 'BLOCKED';
      if (item.status !== status) {
        db.prepare('UPDATE mission_graph_nodes SET status=?,updated_at=? WHERE graph_id=? AND node_key=?')
          .run(status, now(), graphId, item.key);
        emit(`mission_graph.node.${status.toLowerCase()}`, { graph_id: graphId, node_key: item.key });
      }
    }
    const next = nodeRows(graphId);
    // EXHAUSTED is an explicit terminal decision and is never re-derived from node states.
    if (rawGraph(graphId)?.status === 'EXHAUSTED') return next;
    const active = next.filter(item => !['VERIFIED','SUPERSEDED','CANCELLED'].includes(item.status));
    const status = next.length && active.length === 0 ? 'VERIFIED'
      : next.some(item => item.status === 'FAILED') ? 'NEEDS_REPLAN'
        : 'ACTIVE';
    db.prepare('UPDATE mission_graphs SET status=?,updated_at=? WHERE id=?').run(status, now(), graphId);
    return next;
  }

  function get(graphId) {
    const graph = rawGraph(graphId);
    if (!graph) return null;
    const nodes = refresh(graphId);
    const updated = rawGraph(graphId);
    return {
      ...updated,
      policy: jp(updated.policy, {}),
      nodes,
      strategic_board: projection(graphId, nodes).snapshot,
      summary: summarize(nodes),
      checkpoints: checkpointRows(graphId),
      replans: replanRows(graphId),
    };
  }

  function create(input = {}) {
    if (!input.title || !input.objective) throw new Error('GRAPH_TITLE_AND_OBJECTIVE_REQUIRED');
    if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new Error('GRAPH_NODES_REQUIRED');
    const prepared = input.nodes.map((item, index) => ({
      key: validateNodeKey(String(item.key || `n${index + 1}`)),
      title: String(item.title || item.key || `Node ${index + 1}`).trim(),
      objective: String(item.objective || '').trim(),
      contract: item.contract || {},
      dependencies: uniqueStrings(item.dependencies),
      strategy: item.strategy || {},
    }));
    if (new Set(prepared.map(item => item.key)).size !== prepared.length) throw new Error('DUPLICATE_NODE_KEY');
    if (prepared.some(item => !item.title || !item.objective)) throw new Error('NODE_TITLE_AND_OBJECTIVE_REQUIRED');
    assertDag(prepared);
    const plan = prepareStrategicPlan(prepared, input.obstacles || input.policy?.strategic_obstacles || []);
    for (const item of prepared) item.strategy = plan.steps.find(step => step.id === item.key);

    return tx(() => {
      const graphId = input.id ? String(input.id) : uid();
      db.prepare('INSERT INTO mission_graphs(id,title,objective,status,policy,updated_at) VALUES(?,?,?,?,?,?)')
        .run(graphId, String(input.title), String(input.objective), 'ACTIVE', js({ ...input.policy, strategic_obstacles: plan.obstacles }), now());
      for (const item of prepared) {
        const status = item.dependencies.length ? 'BLOCKED' : 'READY';
        db.prepare(`INSERT INTO mission_graph_nodes
          (id,graph_id,node_key,title,objective,contract,dependencies,status,updated_at,strategy)
          VALUES(?,?,?,?,?,?,?,?,?,?)`)
          .run(uid(), graphId, item.key, item.title, item.objective, js(item.contract), js(item.dependencies), status, now(), js(item.strategy));
      }
      emit('mission_graph.created', { graph_id: graphId, nodes: prepared.length, objective: input.objective });
      return get(graphId);
    });
  }

  function list(status = null) {
    const rows = status
      ? db.prepare('SELECT id FROM mission_graphs WHERE status=? ORDER BY updated_at DESC').all(status)
      : db.prepare('SELECT id FROM mission_graphs ORDER BY updated_at DESC').all();
    return rows.map(row => get(row.id));
  }

  function ready(graphId) {
    if (!rawGraph(graphId)) throw new Error('MISSION_GRAPH_NOT_FOUND');
    const graph = get(graphId);
    if (graph.status !== 'ACTIVE') return [];
    const byKey = new Map(graph.nodes.map(item => [item.key, item]));
    return graph.strategic_board.moves.filter(move => move.executable).map(move => ({ ...byKey.get(move.stepId), strategic_move: move }));
  }

  function dispatchSpec(graphId, key) {
    const graph = get(graphId);
    if (!graph) throw new Error('MISSION_GRAPH_NOT_FOUND');
    if (graph.status !== 'ACTIVE') throw new Error(`GRAPH_NOT_ACTIVE:${graph.status}`);
    const item = node(graphId, key);
    if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
    if (item.status !== 'READY') throw new Error(`NODE_NOT_READY:${item.status}`);
    return {
      goal: item.objective,
      idempotencyKey: `seer-graph:${graphId}:${item.key}:attempt:${item.attempt + 1}`,
      source: 'seer-mission-graph',
      parent:{graphId,nodeKey:key,mainGoal:graph.objective,dependencies:item.dependencies,
        strategicBoard: compactStrategicBoard(graph.strategic_board), selectedMove: graph.strategic_board.moves.find(move => move.stepId === key)},
      ...(graph.policy?.executor ? {executor:graph.policy.executor} : {}),
      ...(Array.isArray(graph.policy?.allowedTasks) ? {allowedTasks:graph.policy.allowedTasks} : {}),
      ...(item.contract && Object.keys(item.contract).length ? { contract: item.contract } : {}),
      ...(graph.policy?.project_root ? { projectRoot: graph.policy.project_root } : {}),
    };
  }

  function bindNova(graphId, key, novaMissionId) {
    if (!novaMissionId) throw new Error('NOVA_MISSION_ID_REQUIRED');
    dispatchSpec(graphId, key);
    return tx(() => {
      const item = node(graphId, key);
      if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
      if (item.status !== 'READY') throw new Error(`NODE_NOT_READY:${item.status}`);
      db.prepare(`UPDATE mission_graph_nodes
        SET status='DISPATCHED',nova_mission_id=?,attempt=attempt+1,updated_at=?
        WHERE graph_id=? AND node_key=?`)
        .run(String(novaMissionId), now(), graphId, key);
      emit('mission_graph.node.dispatched', { graph_id: graphId, node_key: key, nova_mission_id: String(novaMissionId) });
      return get(graphId);
    });
  }

  function prepareDispatch(graphId, key) {
    return tx(() => {
      const spec = dispatchSpec(graphId, key);
      db.prepare(`INSERT OR IGNORE INTO mission_graph_dispatches
        (idempotency_key,graph_id,node_key,spec,updated_at) VALUES(?,?,?,?,?)`)
        .run(spec.idempotencyKey, graphId, key, js(spec), now());
      return pendingDispatches().find(row => row.idempotency_key === spec.idempotencyKey);
    });
  }

  function pendingDispatches() {
    return db.prepare("SELECT * FROM mission_graph_dispatches WHERE state!='SETTLED' ORDER BY updated_at,idempotency_key")
      .all().map(row => ({ ...row, spec: jp(row.spec, {}) }));
  }

  function recordDispatch(key, novaMissionId) {
    db.prepare("UPDATE mission_graph_dispatches SET nova_mission_id=?,state='CREATED',updated_at=? WHERE idempotency_key=? AND state!='SETTLED'")
      .run(novaMissionId, now(), key);
  }

  function settleDispatch(key) {
    db.prepare("UPDATE mission_graph_dispatches SET state='SETTLED',updated_at=? WHERE idempotency_key=?")
      .run(now(), key);
  }

  function running(graphId, key, novaMissionId = null) {
    return tx(() => {
      const item = node(graphId, key);
      if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
      if (!['DISPATCHED','RUNNING'].includes(item.status)) throw new Error(`NODE_NOT_DISPATCHED:${item.status}`);
      if (novaMissionId && item.nova_mission_id && String(novaMissionId) !== item.nova_mission_id) throw new Error('NOVA_MISSION_BINDING_MISMATCH');
      db.prepare("UPDATE mission_graph_nodes SET status='RUNNING',updated_at=? WHERE graph_id=? AND node_key=?")
        .run(now(), graphId, key);
      emit('mission_graph.node.running', { graph_id: graphId, node_key: key, nova_mission_id: item.nova_mission_id });
      return get(graphId);
    });
  }

  function makeCheckpoint(graphId, { label, node_key = null, evidence_refs = [] } = {}) {
    if (!label) throw new Error('CHECKPOINT_LABEL_REQUIRED');
    const graph = rawGraph(graphId);
    if (!graph) throw new Error('MISSION_GRAPH_NOT_FOUND');
    const refs = uniqueStrings(evidence_refs);
    const nodes = nodeRows(graphId);
    const snapshot = {
      graph_status: graph.status,
      nodes: Object.fromEntries(nodes.map(item => [item.key, {
        status: item.status,
        nova_mission_id: item.nova_mission_id,
        attempt: item.attempt,
        evidence_refs: item.evidence_refs,
      }])),
    };
    const id = uid();
    db.prepare(`INSERT INTO mission_graph_checkpoints(id,graph_id,node_key,label,snapshot,evidence_refs)
      VALUES(?,?,?,?,?,?)`).run(id, graphId, node_key, String(label), js(snapshot), js(refs));
    emit('mission_graph.checkpoint.created', { graph_id: graphId, checkpoint_id: id, node_key, label });
    return checkpointRows(graphId).find(item => item.id === id);
  }

  function verify(graphId, key, input = {}) {
    return tx(() => {
      assertOutcomeKnown(graphId);
      const item = node(graphId, key);
      if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
      if (!['DISPATCHED','RUNNING'].includes(item.status)) throw new Error(`NODE_NOT_VERIFIABLE:${item.status}`);
      if (input.verified !== true) throw new Error('VERIFIED_RECEIPT_REQUIRED');
      const refs = uniqueStrings(input.evidence_refs);
      if (!refs.length) throw new Error('EVIDENCE_REFS_REQUIRED');
      db.prepare(`UPDATE mission_graph_nodes
        SET status='VERIFIED',evidence_refs=?,failure_reason=NULL,updated_at=?
        WHERE graph_id=? AND node_key=?`).run(js(refs), now(), graphId, key);
      emit('mission_graph.node.verified', { graph_id: graphId, node_key: key, evidence_refs: refs, nova_mission_id: item.nova_mission_id });
      if (input.checkpoint_label) makeCheckpoint(graphId, {
        label: input.checkpoint_label,
        node_key: key,
        evidence_refs: refs,
      });
      refresh(graphId);
      return get(graphId);
    });
  }

  function fail(graphId, key, input = {}) {
    return tx(() => {
      if (rawGraph(graphId)?.status === 'CANCELLED') throw new Error('GRAPH_CANCELLED');
      assertOutcomeKnown(graphId);
      const item = node(graphId, key);
      if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
      if (!['DISPATCHED','RUNNING','READY'].includes(item.status)) throw new Error(`NODE_NOT_FAILABLE:${item.status}`);
      const reason = String(input.reason || '').trim();
      if (!reason) throw new Error('FAILURE_REASON_REQUIRED');
      const refs = uniqueStrings(input.evidence_refs);
      db.prepare(`UPDATE mission_graph_nodes
        SET status='FAILED',failure_reason=?,evidence_refs=?,updated_at=?
        WHERE graph_id=? AND node_key=?`).run(reason, js(refs), now(), graphId, key);
      db.prepare("UPDATE mission_graphs SET status='NEEDS_REPLAN',updated_at=? WHERE id=?").run(now(), graphId);
      emit('mission_graph.node.failed', { graph_id: graphId, node_key: key, reason, evidence_refs: refs, nova_mission_id: item.nova_mission_id });
      return get(graphId);
    });
  }

  // Terminal stop for a graph whose repair budget is spent. It frees the governor's
  // work slot without claiming success: the failed node keeps its failure reason.
  function exhaust(graphId, input = {}) {
    return tx(() => {
      const graph = rawGraph(graphId);
      if (!graph) throw new Error('MISSION_GRAPH_NOT_FOUND');
      if (graph.status !== 'NEEDS_REPLAN') throw new Error(`GRAPH_NOT_EXHAUSTIBLE:${graph.status}`);
      const reason = String(input.reason || '').trim();
      if (!reason) throw new Error('EXHAUST_REASON_REQUIRED');
      db.prepare("UPDATE mission_graphs SET status='EXHAUSTED',updated_at=? WHERE id=?").run(now(), graphId);
      emit('mission_graph.exhausted', { graph_id: graphId, node_key: input.node_key || null, reason });
      return get(graphId);
    });
  }

  function replan(graphId, input = {}) {
    return tx(() => {
      if (rawGraph(graphId)?.status === 'CANCELLED') throw new Error('GRAPH_CANCELLED');
      assertOutcomeKnown(graphId);
      const failedKey = validateNodeKey(String(input.failed_key || ''));
      const failed = node(graphId, failedKey);
      if (!failed) throw new Error('FAILED_NODE_NOT_FOUND');
      if (failed.status !== 'FAILED') throw new Error('REPLAN_REQUIRES_FAILED_NODE');
      const replacements = input.replacements || [input.replacement || {}];
      if (!Array.isArray(replacements) || !replacements.length || replacements.length > 8) throw new Error('REPLAN_NODE_LIMIT');
      const existing = nodeRows(graphId);
      const keys = new Set(existing.map(item => item.key));
      const inserts = replacements.map((replacement, index) => {
        const key = validateNodeKey(String(replacement.key || `${failedKey}.retry.${failed.attempt + 1}`));
        if (keys.has(key)) throw new Error('REPLACEMENT_NODE_EXISTS');
        keys.add(key);
        return { key, title: String(replacement.title || `${failed.title} (replan)`), objective: String(replacement.objective || failed.objective),
          strategy: { ...failed.strategy, ...(replacement.strategy || {}) },
          contract: replacements.length > 1 ? structuredClone(failed.contract || {}) : replacement.contract || failed.contract || {},
          dependencies: uniqueStrings(replacement.dependencies ?? (index ? [replacements[index - 1].key] : failed.dependencies)) };
      });
      for (const item of inserts) {
        if (item.dependencies.includes(failedKey)) throw new Error(`INVALID_REPLAN_DEPENDENCY:${failedKey}`);
        // Divide per-node execution limits rather than multiply the original budget by the split.
        if (replacements.length > 1 && item.contract.budget) {
          for (const field of ['max_steps','max_tool_calls','max_duration_ms']) {
            const value = item.contract.budget[field];
            if (value == null) continue;
            const remaining = input.remaining_budget?.[field];
            if (remaining !== undefined && (!Number.isFinite(remaining) || remaining < 0)) throw new Error('REPLAN_BUDGET_INVALID');
            const divided = Math.floor(Math.min(value, remaining ?? value) / replacements.length);
            if (divided < (field === 'max_duration_ms' ? 1000 : 1)) throw new Error('REPLAN_BUDGET_TOO_SMALL');
            item.contract.budget[field] = divided;
          }
        }
      }
      const replacementKey = inserts.at(-1).key;
      // The final replacement carries the complete original obligation, not just the last suggestion.
      if (inserts.length > 1) inserts.at(-1).objective = `${failed.objective}\nINTEGRATION AND FINAL ACCEPTANCE: ${inserts.at(-1).objective}`.slice(0,12000);
      const rewiredNodes = existing.map(item => ({ ...item, dependencies: item.dependencies.map(dep => dep === failedKey ? replacementKey : dep) }));
      assertDag([...rewiredNodes, ...inserts]);
      const states = new Map(existing.map(item => [item.key, item.status]));
      for (const item of inserts) {
        const status = item.dependencies.every(dep => states.get(dep) === 'VERIFIED') ? 'READY' : 'BLOCKED';
        db.prepare(`INSERT INTO mission_graph_nodes
          (id,graph_id,node_key,title,objective,contract,dependencies,status,updated_at,strategy)
          VALUES(?,?,?,?,?,?,?,?,?,?)`).run(uid(), graphId, item.key, item.title, item.objective, js(item.contract), js(item.dependencies), status, now(), js(item.strategy));
      }

      const dependents = nodeRows(graphId).filter(item => item.dependencies.includes(failedKey));
      for (const dependent of dependents) {
        const rewired = dependent.dependencies.map(dep => dep === failedKey ? replacementKey : dep);
        db.prepare("UPDATE mission_graph_nodes SET dependencies=?,status='BLOCKED',updated_at=? WHERE graph_id=? AND node_key=?")
          .run(js(rewired), now(), graphId, dependent.key);
      }

      db.prepare("UPDATE mission_graph_nodes SET status='SUPERSEDED',updated_at=? WHERE graph_id=? AND node_key=?")
        .run(now(), graphId, failedKey);
      const policy = jp(rawGraph(graphId).policy, {});
      policy.strategic_obstacles = (policy.strategic_obstacles || []).map(obstacle => ({ ...obstacle,
        clearBy: obstacle.clearBy.map(key => key === failedKey ? replacementKey : key),
        blocks: obstacle.blocks.flatMap(key => key === failedKey ? inserts.map(item => item.key) : [key]),
      }));
      db.prepare('UPDATE mission_graphs SET policy=? WHERE id=?').run(js(policy), graphId);
      const reason = String(input.reason || failed.failure_reason || 'selective replan');
      const refs = uniqueStrings(input.evidence_refs ?? failed.evidence_refs);
      const id = uid();
      db.prepare(`INSERT INTO mission_graph_replans
        (id,graph_id,failed_node_key,replacement_node_key,reason,evidence_refs)
        VALUES(?,?,?,?,?,?)`).run(id, graphId, failedKey, replacementKey, reason, js(refs));
      db.prepare("UPDATE mission_graphs SET status='ACTIVE',updated_at=? WHERE id=?").run(now(), graphId);
      emit('mission_graph.replanned', {
        graph_id: graphId,
        failed_node_key: failedKey,
        replacement_node_key: replacementKey,
        rewired_dependents: dependents.map(item => item.key),
        reason,
      });
      refresh(graphId);
      return get(graphId);
    });
  }

  function recover(graphId, checkpointId) {
    return tx(() => {
      if (rawGraph(graphId)?.status === 'CANCELLED') throw new Error('GRAPH_CANCELLED');
      assertOutcomeKnown(graphId);
      const checkpoint = db.prepare(
        'SELECT * FROM mission_graph_checkpoints WHERE id=? AND graph_id=?',
      ).get(checkpointId, graphId);
      if (!checkpoint) throw new Error('CHECKPOINT_NOT_FOUND');
      const snapshot = jp(checkpoint.snapshot, {});
      for (const item of nodeRows(graphId)) {
        if (item.status === 'VERIFIED' || item.status === 'SUPERSEDED') continue;
        const saved = snapshot.nodes?.[item.key];
        if (!saved || !NODE_STATES.has(saved.status)) continue;
        const restored = ['FAILED','CANCELLED','SUPERSEDED','VERIFIED','DISPATCHED','RUNNING'].includes(saved.status)
          ? 'BLOCKED'
          : saved.status;
        db.prepare(`UPDATE mission_graph_nodes
          SET status=?,nova_mission_id=?,evidence_refs=?,failure_reason=NULL,updated_at=?
          WHERE graph_id=? AND node_key=?`).run(
            restored,
            saved.nova_mission_id || null,
            js(saved.evidence_refs || []),
            now(), graphId, item.key,
          );
      }
      db.prepare("UPDATE mission_graphs SET status='ACTIVE',updated_at=? WHERE id=?").run(now(), graphId);
      emit('mission_graph.recovered', { graph_id: graphId, checkpoint_id: checkpointId });
      refresh(graphId);
      return get(graphId);
    });
  }

  function reconcileNova(graphId, key, novaMission = {}) {
    const item = node(graphId, key);
    if (!item) throw new Error('MISSION_GRAPH_NODE_NOT_FOUND');
    if (!item.nova_mission_id) throw new Error('NOVA_MISSION_NOT_BOUND');
    if (!novaMission?.id || String(novaMission.id) !== item.nova_mission_id) throw new Error('NOVA_MISSION_BINDING_MISMATCH');
    if (rawGraph(graphId)?.status === 'CANCELLED') {
      return { outcome: 'cancelled', nova_status: novaMission.status || null, graph: get(graphId) };
    }
    if (String(novaMission.status || '').toUpperCase() === 'CANCELLED') {
      return { outcome: 'cancelled', graph: cancel(graphId, { reason: 'NOVA_MISSION_CANCELLED', actor: 'nova-reconciliation' }) };
    }
    if (jp(rawGraph(graphId)?.policy, {}).outcome_unknown) {
      return { outcome: 'quarantined', reason: 'NOVA_BLOCKED_OUTCOME_UNCERTAIN', graph: get(graphId) };
    }

    if (['VERIFIED','SUPERSEDED','CANCELLED'].includes(item.status)) {
      return { outcome: 'terminal', nova_status: novaMission.status || null, graph: get(graphId) };
    }

    const novaStatus = String(novaMission.status || '').toUpperCase();
    const unresolved = asArray(novaMission.receipts).filter(receipt => receipt?.outcomeUnknown === true ||
      (receipt?.ok === true && receipt?.verified !== true));
    if (novaMission.phase === 'INTERRUPTED' || unresolved.length) {
      return { outcome: 'quarantined', nova_status: novaStatus, reason: 'NOVA_BLOCKED_OUTCOME_UNCERTAIN',
        graph: quarantine(graphId, key, 'NOVA_BLOCKED_OUTCOME_UNCERTAIN', unresolved.map(receipt =>
          `nova:${novaMission.id}:uncertain:${receipt.actionId || receipt.at || 'uncertain'}`)) };
    }
    if (novaStatus === 'MISSING' && novaMission.observedMissing === true) {
      return { outcome: 'quarantined', nova_status: novaStatus, graph: tx(() => {
        db.prepare("UPDATE mission_graph_nodes SET status='FAILED',failure_reason=?,updated_at=? WHERE graph_id=? AND node_key=?")
          .run('NOVA_BINDING_MISSING_OUTCOME_UNKNOWN', now(), graphId, key);
        db.prepare("UPDATE mission_graphs SET status='EXHAUSTED',updated_at=? WHERE id=?").run(now(), graphId);
        emit('mission_graph.binding_quarantined', { graph_id: graphId, node_key: key, nova_mission_id: item.nova_mission_id, reason: 'NOVA_BINDING_MISSING_OUTCOME_UNKNOWN', observed_at: novaMission.observedAt });
        return get(graphId);
      }) };
    }
    const verifiedReceipts = asArray(novaMission.receipts).filter(receipt => receipt?.ok === true && receipt?.verified === true);
    const evidenceRefs = verifiedReceipts.map(receipt =>
      `nova:${novaMission.id}:receipt:${receipt.actionId || receipt.at || 'verified'}`
    );

    if (novaStatus === 'DONE') {
      if (novaMission.contract && novaMission.contractStatus?.machineVerified !== true) {
        throw new Error('NOVA_CONTRACT_NOT_MACHINE_VERIFIED');
      }
      if (!evidenceRefs.length) throw new Error('NOVA_VERIFIED_EVIDENCE_REQUIRED');
      if (item.status === 'DISPATCHED') running(graphId, key, novaMission.id);
      const current = node(graphId, key);
      if (current.status !== 'RUNNING') throw new Error(`NODE_NOT_RECONCILABLE:${current.status}`);
      return {
        outcome: 'verified',
        nova_status: novaStatus,
        graph: verify(graphId, key, { verified: true, evidence_refs: evidenceRefs }),
      };
    }

    if (novaStatus === 'CANCELLED') {
      return {
        outcome: 'cancelled',
        nova_status: novaStatus,
        graph: cancel(graphId, { reason: 'NOVA_MISSION_CANCELLED', actor: 'nova-reconciliation' }),
      };
    }

    if (['ACTIVE','AWAITING_VERIFICATION'].includes(novaStatus)) {
      if (item.status === 'DISPATCHED') running(graphId, key, novaMission.id);
      return { outcome: novaStatus === 'AWAITING_VERIFICATION' ? 'awaiting_operator' : 'running', nova_status: novaStatus, graph: get(graphId) };
    }

    if (novaStatus === 'BLOCKED' && novaMission.replanRequest && novaMission.phase !== 'INTERRUPTED' && !asArray(novaMission.receipts).some(r => r.outcomeUnknown || (r.ok && !r.verified))) {
      return { outcome: 'failed', nova_status: novaStatus, graph: fail(graphId, key, {
        reason: `NOVA_REPLAN_REQUEST:${JSON.stringify(novaMission.replanRequest)}`,
        evidence_refs: novaMission.replanRequest.evidence_refs || [],
      }) };
    }

    if (novaStatus === 'BLOCKED') {
      const receipts = asArray(novaMission.receipts);
      const latest = receipts.at(-1) || null;
      const knownFailures = receipts.filter(receipt =>
        receipt?.ok === false && receipt?.outcomeUnknown !== true
      );
      if (Number(novaMission.failures || 0) >= 3 && knownFailures.length) {
        const refs = knownFailures.slice(-3).map(receipt =>
          `nova:${novaMission.id}:known-failure:${receipt.actionId || receipt.at || 'failed'}`
        );
        const reason = String(latest?.error || latest?.result?.error || 'NOVA_KNOWN_FAILURE_BUDGET_EXHAUSTED').slice(0, 1000);
        return {
          outcome: 'failed',
          nova_status: novaStatus,
          reason,
          graph: fail(graphId, key, {
            reason: `NOVA_KNOWN_FAILURE:${reason}`,
            evidence_refs: refs,
          }),
        };
      }

      return { outcome: 'blocked', nova_status: novaStatus, graph: get(graphId) };
    }

    return { outcome: 'unchanged', nova_status: novaStatus || null, graph: get(graphId) };
  }

  function context() {
    return list().filter(graph => ['ACTIVE','NEEDS_REPLAN'].includes(graph.status)).map(graph => ({
      id: graph.id,
      title: graph.title,
      objective: graph.objective,
      status: graph.status,
      summary: graph.summary,
      strategic_board: graph.strategic_board,
      ready: ready(graph.id).map(item => ({
        key: item.key,
        objective: item.objective,
        dependencies: item.dependencies,
      })),
      failed: graph.nodes.filter(item => item.status === 'FAILED').map(item => ({
        key: item.key,
        reason: item.failure_reason,
        evidence_refs: item.evidence_refs,
      })),
    }));
  }

  function cancel(graphId, { reason, actor = 'system' } = {}) {
    return tx(() => {
      const existing = rawGraph(graphId);
      if (!existing) throw new Error('MISSION_GRAPH_NOT_FOUND');
      if (existing.status === 'CANCELLED') return get(graphId);
      const policy = { ...jp(existing.policy, {}), cancelled_reason: String(reason || '').slice(0, 2000) || null,
        cancelled_at: now(), cancelled_by: actor };
      db.prepare('UPDATE mission_graphs SET status=?,policy=?,updated_at=? WHERE id=?')
        .run('CANCELLED', js(policy), now(), graphId);
      emit('mission_graph.cancelled', { graph_id: graphId, reason: policy.cancelled_reason, actor });
      return get(graphId);
    });
  }

  return {
    create,
    get,
    list,
    ready,
    dispatchSpec,
    bindNova,
    running,
    verify,
    fail,
    exhaust,
    checkpoint: makeCheckpoint,
    replan,
    recover,
    reconcileNova,
    cancel,
    quarantine,
    prepareDispatch,
    pendingDispatches,
    recordDispatch,
    settleDispatch,
    context,
  };
}

