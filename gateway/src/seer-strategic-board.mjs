// Shared Shack reasoning protocol. SEER owns the board; executors receive context,
// never new authority. Every projection is rebuilt from durable execution states.
import { createStrategicBoard, strategicBoardSnapshot, simulateStrategicBoard, rankStrategicMoves } from '../../agents/lib/aura-strategic-board.mjs';

export function prepareStrategicPlan(nodes, obstacles = [], confidence = 0.5) {
  if (obstacles.some(obstacle => String(obstacle.state).toUpperCase() === 'CLEARED' && !obstacle.evidenceRefs?.length)) {
    throw new Error('STRATEGIC_OBSTACLE_CLEARANCE_REQUIRES_EVIDENCE');
  }
  const dependencies = item => item.dependencies ?? item.depends_on ?? [];
  const prerequisites = new Set(nodes.flatMap(dependencies));
  const board = createStrategicBoard({ goalId: 'plan', missionId: 'plan', obstacles,
    steps: nodes.map((item, index) => ({
      goalImpact: prerequisites.has(item.key) ? 0.25 : 1,
      verificationGain: 1, confidence,
      ...(item.strategy || {}),
      id: item.key || `n${index + 1}`, title: item.title, dependencies: dependencies(item), status: 'PENDING', evidenceRefs: [],
    })),
  });
  return board;
}

export function projectStrategicBoard(graph, nodes) {
  const prerequisites = new Set(nodes.flatMap(item => item.dependencies));
  const board = createStrategicBoard({ goalId: graph.id, missionId: graph.id,
    obstacles: graph.policy?.strategic_obstacles || [],
    steps: nodes.map(item => ({ goalImpact: prerequisites.has(item.key) ? 0.25 : 1, verificationGain: 1, ...item.strategy,
      id: item.key, title: item.title, dependencies: item.dependencies,
      status: item.status === 'DISPATCHED' ? 'RUNNING' : item.status,
      evidenceRefs: item.evidence_refs,
    })),
  });
  return { board, snapshot: { ...strategicBoardSnapshot(board),
    objective: graph.objective,
    authority: 'context only; mission contract and allowedTasks remain authoritative',
    forecast: simulateStrategicBoard(board),
    moves: rankStrategicMoves(board),
    observations: nodes.filter(item => item.evidence_refs?.length).map(item => ({
      stepId: item.key, status: item.status, evidenceRefs: item.evidence_refs, failure: item.failure_reason || null,
    })),
  } };
}

export function evaluateStrategicCandidate(candidate) {
  const board = prepareStrategicPlan(candidate.nodes, candidate.obstacles || [], candidate.success_probability ?? 0.5);
  const snapshot = strategicBoardSnapshot(board);
  return { ...snapshot, forecast: simulateStrategicBoard(board),
    executable: snapshot.recommendedMoves.some(move => move.executable) };
}
