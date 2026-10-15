const cleanText = value => String(value ?? '').trim();

function parseModelJson(result) {
  const text = typeof result === 'string' ? result : result?.text;
  if (!text) return null;
  const cleaned = String(text)
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch {}
  }
  return null;
}

function rootRepairKey(key) {
  return String(key || '').replace(/\.repair\.\d+(?::part:\d+)?$/, '');
}

function repairCount(graph, failedKey) {
  const root = rootRepairKey(failedKey);
  return (graph.replans || []).filter(item =>
    rootRepairKey(item.failed_node_key) === root ||
    rootRepairKey(item.replacement_node_key) === root
  ).length;
}

function safeRepairCandidate(graph, failed, parsed, sequence) {
  const externalSpend = Number(parsed?.external_spend ?? 0);
  const reversible = parsed?.reversible !== false;
  const parsedObjective = cleanText(parsed?.objective);
  const parsedTitle = cleanText(parsed?.title);
  const parsedReason = cleanText(parsed?.reason);

  const fallbackObjective = [
    failed.objective,
    '',
    'AUTONOMOUS REPAIR CONTEXT:',
    `The previous attempt failed with a known outcome: ${failed.failure_reason || 'unknown failure'}.`,
    'Diagnose the concrete root cause from existing evidence before acting.',
    'Choose a materially different reversible approach when the previous approach is implicated.',
    'Do not repeat an action whose outcome is uncertain.',
    'Run the required verification and finish only with verified evidence.',
  ].join('\n');

  return {
    key: `${rootRepairKey(failed.key)}.repair.${sequence}`,
    title: parsedTitle || `${failed.title || failed.key} (autonomous repair ${sequence})`,
    objective: reversible && externalSpend <= 0 && parsedObjective ? parsedObjective : fallbackObjective,
    contract: failed.contract || {},
    dependencies: Array.isArray(failed.dependencies) ? failed.dependencies : [],
    reason: reversible && externalSpend <= 0 && parsedReason
      ? parsedReason
      : `Autonomous repair after known failure: ${failed.failure_reason || 'unknown failure'}`,
    model_candidate_accepted: Boolean(reversible && externalSpend <= 0 && parsedObjective),
  };
}

export function shouldAutoConfirmNova(graph = {}, mission = {}) {
  if (graph?.policy?.outcome_unknown || ['CANCELLED','EXHAUSTED'].includes(graph.status)) return false;
  if (graph?.policy?.autonomy !== 'closed-loop') return false;
  if (graph?.policy?.operator_confirmation_required_for_release === true) return false;
  if (String(mission?.status || '').toUpperCase() !== 'AWAITING_VERIFICATION') return false;
  if (mission?.source !== 'seer-mission-graph') return false;

  const receipts = Array.isArray(mission?.receipts) ? mission.receipts : [];
  if (!receipts.some(receipt => receipt?.ok === true && receipt?.verified === true)) return false;
  if (receipts.some(receipt => receipt?.outcomeUnknown === true || (receipt?.ok === true && receipt?.verified !== true))) return false;
  if (mission?.contract && mission?.contractStatus?.machineVerified !== true) return false;
  return true;
}

export function createAutonomyLoop({
  missionGraph,
  callLLM,
  dispatch,
  emit = () => {},
  maxReplans = 3,
  maxDispatchPerTurn = 2,
} = {}) {
  if (!missionGraph?.list || !missionGraph?.ready || !missionGraph?.replan) {
    throw new Error('AUTONOMY_LOOP_MISSION_GRAPH_REQUIRED');
  }
  if (typeof dispatch !== 'function') throw new Error('AUTONOMY_LOOP_DISPATCH_REQUIRED');

  let inFlight = false;

  async function proposeRepair(graph, failed, sequence) {
    let parsed = null;
    if (failed.failure_reason?.startsWith('NOVA_REPLAN_REQUEST:')) {
      const request = parseModelJson(failed.failure_reason.slice('NOVA_REPLAN_REQUEST:'.length));
      if (Array.isArray(request?.subgoals) && request.subgoals.length >= 2 && request.subgoals.length <= 8 && request.subgoals.every(s => typeof s?.title === 'string' && s.title.trim() && typeof s.objective === 'string' && s.objective.trim())) {
        const base = `${rootRepairKey(failed.key)}.repair.${sequence}`;
        return { reason: request.reason, remaining_budget: request.remaining_budget, model_candidate_accepted: true, replacements: request.subgoals.map((s,index) => ({
          key: `${base}:part:${index + 1}`, title: s.title, objective: s.objective,
          dependencies: index ? [`${base}:part:${index}`] : failed.dependencies,
        })) };
      }
    }
    if (typeof callLLM === 'function') {
      try {
        const result = await callLLM({
          system: [
            'You are SEER repair planning.',
            'Return JSON only.',
            'You may change the implementation approach, but not authority, budget, protected scope, or verification requirements.',
            'No external spend. No destructive action. Preserve the failed node contract.',
          ].join(' '),
          user: JSON.stringify({
            graph: {
              id: graph.id,
              title: graph.title,
              objective: graph.objective,
              policy: graph.policy || {},
            },
            failed_node: {
              key: failed.key,
              title: failed.title,
              objective: failed.objective,
              failure_reason: failed.failure_reason,
              evidence_refs: failed.evidence_refs || [],
              attempt: failed.attempt,
            },
            prior_replans: (graph.replans || []).slice(-5),
            strategic_board: graph.strategic_board || null,
            response_schema: {
              title: 'short repair title',
              objective: 'concrete replacement objective',
              reason: 'why this approach differs and addresses the failure',
              reversible: true,
              external_spend: 0,
            },
          }),
          max_tokens: 700,
          temperature: 0.2,
        });
        if (result?.ok !== false) parsed = parseModelJson(result);
      } catch (error) {
        emit('autonomy.repair_planner_error', {
          graph_id: graph.id,
          node_key: failed.key,
          error: error.message,
        });
      }
    }
    return safeRepairCandidate(graph, failed, parsed, sequence);
  }

  async function replanFailures(report) {
    const graphs = missionGraph.list().filter(graph => graph.status === 'NEEDS_REPLAN');
    for (const graph of graphs) {
      const failedNodes = graph.nodes.filter(node => node.status === 'FAILED');
      for (const failed of failedNodes) {
        if (['NOVA_UNCERTAIN_OUTCOME_BUDGET_EXHAUSTED','NOVA_BINDING_MISSING_OUTCOME_UNKNOWN'].includes(failed.failure_reason)) {
          missionGraph.quarantine(graph.id, failed.key, failed.failure_reason, failed.evidence_refs || []);
          break;
        }
        // Older persisted graphs classified an operator stop as a repairable failure.
        if (failed.failure_reason === 'NOVA_MISSION_CANCELLED') {
          missionGraph.cancel(graph.id, { reason: failed.failure_reason, actor: 'cancellation-reconciliation' });
          break;
        }
        const used = repairCount(graph, failed.key);
        if (used >= maxReplans) {
          report.exhausted.push({ graph_id: graph.id, node_key: failed.key, replans: used });
          emit('autonomy.replan_exhausted', {
            graph_id: graph.id,
            node_key: failed.key,
            failure_reason: failed.failure_reason,
            replans: used,
            max_replans: maxReplans,
          });
          // Without a terminal state the graph stays NEEDS_REPLAN forever, holds the
          // governor's only work slot and re-emits this event every turn.
          try {
            missionGraph.exhaust(graph.id, {
              node_key: failed.key,
              reason: `replan budget ${used}/${maxReplans} spent; last failure: ${failed.failure_reason || 'unknown'}`,
            });
          } catch (error) {
            report.errors.push({ phase: 'exhaust', graph_id: graph.id, node_key: failed.key, error: error.message });
          }
          break;
        }

        const sequence = used + 1;
        const candidate = await proposeRepair(graph, failed, sequence);
        try {
          const replanned = missionGraph.replan(graph.id, {
            failed_key: failed.key,
            remaining_budget: candidate.remaining_budget,
            ...(candidate.replacements ? { replacements: candidate.replacements } : { replacement: {
              key: candidate.key,
              title: candidate.title,
              objective: candidate.objective,
              contract: candidate.contract,
              dependencies: candidate.dependencies,
            } }),
            reason: candidate.reason,
            evidence_refs: failed.evidence_refs || [],
          });
          report.replanned.push({
            graph_id: graph.id,
            failed_node_key: failed.key,
            replacement_node_key: candidate.key || candidate.replacements.at(-1).key,
            replacement_node_keys: candidate.replacements?.map(n => n.key) || [candidate.key],
            model_candidate_accepted: candidate.model_candidate_accepted,
          });
          emit('autonomy.replanned', {
            graph_id: graph.id,
            failed_node_key: failed.key,
            replacement_node_key: candidate.key || candidate.replacements.at(-1).key,
            model_candidate_accepted: candidate.model_candidate_accepted,
            graph_status: replanned.status,
          });
        } catch (error) {
          if (error.message === 'REPLAN_BUDGET_TOO_SMALL') {
            missionGraph.exhaust(graph.id, { node_key: failed.key, reason: 'Requested subgoals exceed the remaining execution budget; no authority or budget was expanded.' });
            report.exhausted.push({ graph_id: graph.id, node_key: failed.key, reason: error.message });
          }
          report.errors.push({ phase: 'replan', graph_id: graph.id, node_key: failed.key, error: error.message });
          emit('autonomy.replan_error', { graph_id: graph.id, node_key: failed.key, error: error.message });
        }
      }
    }
  }

  async function dispatchReady(report) {
    let remaining = Math.max(0, Number(maxDispatchPerTurn) || 0);
    if (!remaining) return;

    const graphs = missionGraph.list().filter(graph => graph.status === 'ACTIVE');
    for (const graph of graphs) {
      if (!remaining) break;
      const readyNodes = missionGraph.ready(graph.id);
      for (const node of readyNodes) {
        if (!remaining) break;
        // Failed attempts consume the same per-turn budget as successful dispatches.
        remaining--;
        try {
          const result = await dispatch(graph.id, node.key);
          report.dispatched.push({
            graph_id: graph.id,
            node_key: node.key,
            nova_mission_id: result?.nova?.id || null,
          });
          emit('autonomy.node_dispatched', {
            graph_id: graph.id,
            node_key: node.key,
            nova_mission_id: result?.nova?.id || null,
          });
        } catch (error) {
          report.errors.push({ phase: 'dispatch', graph_id: graph.id, node_key: node.key, error: error.message });
          emit('autonomy.dispatch_error', { graph_id: graph.id, node_key: node.key, error: error.message });
        }
      }
    }
  }

  async function turn() {
    if (inFlight) return { skipped: 'in_flight', replanned: [], dispatched: [], exhausted: [], errors: [] };
    inFlight = true;
    const report = { replanned: [], dispatched: [], exhausted: [], errors: [] };
    try {
      await replanFailures(report);
      await dispatchReady(report);
      return report;
    } finally {
      inFlight = false;
    }
  }

  return {
    turn,
    state: () => ({ in_flight: inFlight, max_replans: maxReplans, max_dispatch_per_turn: maxDispatchPerTurn }),
  };
}

export { parseModelJson };

