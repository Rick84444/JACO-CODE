/* ============================================================================
 * JACO Cognitive Decision Engine
 * ----------------------------------------------------------------------------
 * Goal:
 *   Convert goals + current plan + evidence + execution history + permissions
 *   into a calibrated, auditable next decision.
 *
 * Design:
 *   Candidate Generation
 *        ↓
 *   Preconditions / Hard Gates
 *        ↓
 *   Historical Bayesian Prior
 *        ↓
 *   Multi-objective Utility
 *        ↓
 *   Adversarial Critique
 *        ↓
 *   Pareto Selection
 *        ↓
 *   Approval / Mandate Gate
 *        ↓
 *   EXECUTE | VERIFY | GATHER | REPLAN | APPROVAL | HALT
 *
 * No external dependencies.
 * ========================================================================== */

import { generate } from '../modelPool/poolManager.js';
import { getCompressedMemoryForPlanning, listExternalMeasurementTargets } from '../agents/competitorIntelligence.js';
import { marketWatchService } from '../agents/marketWatchService.js';
import type { Plan, PlanStep, Subgoal } from './planTree.js';

export type DecisionKind =
  | "EXECUTE"
  | "VERIFY"
  | "GATHER_EVIDENCE"
  | "REQUEST_APPROVAL"
  | "REPLAN"
  | "ABANDON_SUBGOAL"
  | "HALT";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ApprovalMode = "AUTO" | "MANDATE" | "HUMAN";

export interface DecisionPolicy {
  weights: {
    goalProgress: number;
    strategicAlignment: number;
    successProbability: number;
    evidenceGain: number;
    reversibility: number;
    historicalReuse: number;

    risk: number;
    uncertainty: number;
    cost: number;
    latency: number;
    approvalFriction: number;
    loopPenalty: number;
    adversarialPenalty: number;
  };

  minExecuteConfidence: number;
  minExecuteUtility: number;
  maxAutoRisk: number;

  maxRepeatedAction: number;
  minEvidenceForHighRisk: number;

  explorationStrength: number;
  uncertaintyGatherThreshold: number;

  requireRollbackForHighRisk: boolean;
}

export const DEFAULT_POLICY: DecisionPolicy = {
  weights: {
    goalProgress: 2.8,
    strategicAlignment: 2.4,
    successProbability: 2.7,
    evidenceGain: 1.5,
    reversibility: 1.3,
    historicalReuse: 1.1,

    risk: 3.5,
    uncertainty: 2.0,
    cost: 0.8,
    latency: 0.5,
    approvalFriction: 0.7,
    loopPenalty: 2.2,
    adversarialPenalty: 2.8
  },

  minExecuteConfidence: 0.67,
  minExecuteUtility: 0.05,
  maxAutoRisk: 0.32,

  maxRepeatedAction: 3,
  minEvidenceForHighRisk: 0.75,

  explorationStrength: 0.08,
  uncertaintyGatherThreshold: 0.48,

  requireRollbackForHighRisk: true
};

/* -------------------------------------------------------------------------- */
/* Runtime structures                                                         */
/* -------------------------------------------------------------------------- */

export interface StepLike {
  id: string;
  title: string;
  description?: string;

  status:
    | "pending"
    | "ready"
    | "running"
    | "completed"
    | "failed"
    | "blocked"
    | string;

  tool?: string;
  dependsOn?: string[];

  priority?: number;

  expectedProgress?: number;
  expectedCost?: number;
  expectedLatency?: number;

  reversible?: boolean;
  verificationRequired?: boolean;

  writesFiles?: boolean;
  deletesFiles?: boolean;
  networkWrite?: boolean;
  touchesSecrets?: boolean;
  production?: boolean;
  payment?: boolean;
  root?: boolean;

  evidence?: unknown[];

  metadata?: Record<string, unknown>;
}

export interface CandidateAction {
  id: string;

  kind:
    | "STEP"
    | "VERIFY"
    | "GATHER"
    | "REPAIR"
    | "REPLAN";

  step?: StepLike;

  title: string;
  tool?: string;

  goalProgress: number;
  strategicAlignment: number;
  evidenceGain: number;

  cost: number;
  latency: number;

  reversible: number;
  uncertainty: number;

  risk: number;
  riskLevel: RiskLevel;

  historicalSuccess: number;
  historicalAttempts: number;

  approvalMode: ApprovalMode;

  blockedReasons: string[];

  adversarialFindings: string[];

  components?: ScoreComponents;

  utility?: number;
  confidence?: number;
}

export interface ScoreComponents {
  positive: {
    goalProgress: number;
    strategicAlignment: number;
    successProbability: number;
    evidenceGain: number;
    reversibility: number;
    historicalReuse: number;
  };

  negative: {
    risk: number;
    uncertainty: number;
    cost: number;
    latency: number;
    approvalFriction: number;
    loopPenalty: number;
    adversarialPenalty: number;
  };
}

export interface DecisionResult {
  decisionId: string;

  kind: DecisionKind;

  selectedCandidate?: CandidateAction;

  rankedCandidates: CandidateAction[];

  approval: {
    required: boolean;
    mode: ApprovalMode;
    reason?: string;
  };

  confidence: number;
  utility: number;

  rationale: string[];

  guardrails: string[];

  metrics: {
    candidateCount: number;
    executableCandidateCount: number;

    uncertainty: number;
    historicalAttempts: number;

    topScoreGap: number;
  };

  timestamp: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const safeNumber = (
  value: unknown,
  fallback: number
): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

/*
 * Stable pseudo-random value.
 * Used only as tiny exploration tie-breaker.
 * It does NOT determine safety.
 */
function stable01(input: string): number {
  let h = 2166136261;

  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return (h >>> 0) / 0xffffffff;
}

function parseHistoryArray(history: any): any[] {
  if (Array.isArray(history)) return history;
  if (typeof history === 'string' && history.trim()) {
    try {
      const parsed = JSON.parse(history);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return history.split('\n').filter(Boolean).map(line => ({
        title: line,
        action: line,
        step: line,
        status: (line.includes('PASSED') || line.includes('success') || line.includes('completed'))
          ? 'success'
          : (line.includes('fel') || line.includes('error') || line.includes('failed') ? 'failed' : 'info')
      }));
    }
  }
  return [];
}

function normalizeStep(raw: any, index: number): StepLike {
  return {
    id: String(raw?.id ?? `step-${index + 1}`),

    title: String(
      raw?.title ??
      raw?.description ??
      raw?.name ??
      `Step ${index + 1}`
    ),

    description: raw?.description,

    status: String(
      raw?.status ??
      (raw?.completed ? "completed" : "pending")
    ),

    tool: raw?.tool ?? raw?.toolName,

    dependsOn:
      Array.isArray(raw?.dependsOn)
        ? raw.dependsOn.map(String)
        : [],

    priority: safeNumber(raw?.priority, 0.5),

    expectedProgress:
      clamp01(
        safeNumber(
          raw?.expectedProgress ?? raw?.progressPercent ? (raw.progressPercent / 100) : undefined,
          0.35
        )
      ),

    expectedCost:
      clamp01(
        safeNumber(raw?.expectedCost, 0.2)
      ),

    expectedLatency:
      clamp01(
        safeNumber(raw?.expectedLatency, 0.2)
      ),

    reversible:
      raw?.reversible !== false,

    verificationRequired:
      raw?.verificationRequired !== false,

    writesFiles:
      Boolean(raw?.writesFiles || (raw?.toolName && String(raw.toolName).includes('file.write'))),

    deletesFiles:
      Boolean(raw?.deletesFiles),

    networkWrite:
      Boolean(raw?.networkWrite || (raw?.toolName && String(raw.toolName).includes('git.push'))),

    touchesSecrets:
      Boolean(raw?.touchesSecrets),

    production:
      Boolean(raw?.production),

    payment:
      Boolean(raw?.payment),

    root:
      Boolean(raw?.root),

    evidence:
      Array.isArray(raw?.evidence)
        ? raw.evidence
        : [],

    metadata: raw?.metadata ?? {}
  };
}

function completed(step: StepLike): boolean {
  return step.status === "completed";
}

function dependencyReady(
  step: StepLike,
  steps: StepLike[]
): boolean {
  if (!step.dependsOn?.length) return true;

  return step.dependsOn.every(dep => {
    const dependency = steps.find(s => s.id === dep);
    return dependency && completed(dependency);
  });
}

/* -------------------------------------------------------------------------- */
/* Risk engine                                                                */
/* -------------------------------------------------------------------------- */

function calculateRisk(step: StepLike): number {
  let risk = 0.06;

  if (step.writesFiles) risk += 0.12;
  if (step.networkWrite) risk += 0.20;
  if (step.deletesFiles) risk += 0.35;
  if (step.touchesSecrets) risk += 0.36;
  if (step.production) risk += 0.40;
  if (step.payment) risk += 0.46;
  if (step.root) risk += 0.60;

  if (!step.reversible) risk += 0.18;

  return clamp01(risk);
}

function riskLevel(risk: number): RiskLevel {
  if (risk >= 0.80) return "CRITICAL";
  if (risk >= 0.55) return "HIGH";
  if (risk >= 0.28) return "MEDIUM";

  return "LOW";
}

function approvalMode(
  step: StepLike,
  _risk: number
): ApprovalMode {
  // Level-5 operator profile: execution is autonomous by default. The one
  // mandatory human gate is an outgoing payment/financial commitment.
  if (step.payment) return "HUMAN";
  return "AUTO";
}

/* -------------------------------------------------------------------------- */
/* Evidence                                                                  */
/* -------------------------------------------------------------------------- */

function evidenceQuality(step: StepLike): number {
  if (!step.evidence?.length) return 0;
  return clamp01(step.evidence.length / 4);
}

/* -------------------------------------------------------------------------- */
/* Historical Bayesian prior                                                 */
/* -------------------------------------------------------------------------- */

interface HistoryStats {
  successes: number;
  failures: number;
  attempts: number;
  posteriorSuccess: number;
}

function getHistoryStats(
  action: CandidateAction,
  history: any[]
): HistoryStats {
  let successes = 0;
  let failures = 0;

  const tool = action.tool?.toLowerCase();
  const title = action.title.toLowerCase();

  for (const event of history ?? []) {
    const eventTool = String(
      event?.tool ??
      event?.toolName ??
      event?.toolCall?.name ??
      ""
    ).toLowerCase();

    const eventTitle = String(
      event?.title ??
      event?.action ??
      event?.step ??
      event?.description ??
      ""
    ).toLowerCase();

    const relevant =
      (tool && eventTool === tool) ||
      eventTitle.includes(title) ||
      title.includes(eventTitle);

    if (!relevant) continue;

    const status = String(
      event?.status ?? event?.result ?? ""
    ).toLowerCase();

    if (
      status === "success" ||
      status === "completed" ||
      status === "verified" ||
      status === "passed"
    ) {
      successes++;
    }

    if (
      status === "failed" ||
      status === "error" ||
      status === "rejected"
    ) {
      failures++;
    }
  }

  // Beta(2,2) prior avoids 100% confidence from one success
  const alpha = 2 + successes;
  const beta = 2 + failures;

  return {
    successes,
    failures,
    attempts: successes + failures,
    posteriorSuccess: alpha / (alpha + beta)
  };
}

/* -------------------------------------------------------------------------- */
/* Loop detection                                                             */
/* -------------------------------------------------------------------------- */

function repeatedActionCount(
  candidate: CandidateAction,
  history: any[]
): number {
  const key = `${candidate.tool ?? ""}:${candidate.title}`
    .toLowerCase();

  let count = 0;

  for (
    let i = history.length - 1;
    i >= 0;
    i--
  ) {
    const h = history[i];

    const hKey = `${h?.tool ?? h?.toolName ?? h?.toolCall?.name ?? ""}:${
      h?.title ?? h?.action ?? h?.step ?? h?.description ?? ""
    }`.toLowerCase();

    if (hKey === key) {
      count++;
    } else if (count > 0) {
      break;
    }
  }

  return count;
}

/* -------------------------------------------------------------------------- */
/* Hard policy gates                                                         */
/* -------------------------------------------------------------------------- */

function hardGate(
  step: StepLike,
  plan: any
): string[] {
  const blocked: string[] = [];

  const permissions =
    plan?.context?.permissions ??
    plan?.permissions ??
    {};

  // Explicit mission-level denies are still honored. Absence of a flag is not
  // a blocker under the operator-approved Level-5 profile.
  if (step.root && permissions.root === false) blocked.push("ROOT_PERMISSION_DENIED");
  if (step.deletesFiles && permissions.deleteFiles === false) blocked.push("DELETE_PERMISSION_DENIED");
  if (step.networkWrite && permissions.network === false) blocked.push("NETWORK_WRITE_DENIED");
  if (step.touchesSecrets && permissions.secrets === false) blocked.push("SECRET_ACCESS_DENIED");

  // Outgoing payment remains the canonical operator decision.
  if (step.payment && permissions.payment !== true) blocked.push("PAYMENT_PERMISSION_DENIED");

  return blocked;
}

/* -------------------------------------------------------------------------- */
/* Adversarial critic                                                        */
/* -------------------------------------------------------------------------- */

function adversarialCritique(
  candidate: CandidateAction,
  plan: any,
  history: any[],
  policy: DecisionPolicy
): string[] {
  const issues: string[] = [];

  const step = candidate.step;

  if (!step) return issues;

  if (
    candidate.risk >= 0.55 &&
    !step.reversible &&
    policy.requireRollbackForHighRisk
  ) {
    issues.push(
      "HIGH_RISK_WITHOUT_ROLLBACK"
    );
  }

  if (
    candidate.risk >= 0.55 &&
    evidenceQuality(step) <
      policy.minEvidenceForHighRisk
  ) {
    issues.push(
      "INSUFFICIENT_EVIDENCE_FOR_HIGH_RISK_ACTION"
    );
  }

  if (
    step.verificationRequired &&
    candidate.evidenceGain < 0.2
  ) {
    issues.push(
      "WEAK_POST_ACTION_VERIFICATION"
    );
  }

  const repeats =
    repeatedActionCount(
      candidate,
      history
    );

  if (
    repeats >=
    policy.maxRepeatedAction
  ) {
    issues.push(
      "POSSIBLE_EXECUTION_LOOP"
    );
  }

  if (
    step.production &&
    !plan?.context?.rollbackAvailable
  ) {
    issues.push(
      "PRODUCTION_WITHOUT_ROLLBACK"
    );
  }

  return issues;
}

/* -------------------------------------------------------------------------- */
/* Candidate creation                                                        */
/* -------------------------------------------------------------------------- */

function stepCandidate(
  step: StepLike,
  steps: StepLike[],
  plan: any
): CandidateAction {
  const risk = calculateRisk(step);

  const blockedReasons =
    hardGate(step, plan);

  if (!dependencyReady(step, steps)) {
    blockedReasons.push(
      "DEPENDENCY_NOT_SATISFIED"
    );
  }

  return {
    id: `step:${step.id}`,
    kind: "STEP",
    step,

    title: step.title,
    tool: step.tool,

    goalProgress:
      clamp01(
        step.expectedProgress ??
        0.35
      ),

    strategicAlignment:
      clamp01(
        0.55 +
        safeNumber(step.priority, 0.5) *
          0.35
      ),

    evidenceGain:
      step.verificationRequired
        ? 0.55
        : 0.25,

    cost:
      step.expectedCost ?? 0.2,

    latency:
      step.expectedLatency ?? 0.2,

    reversible:
      step.reversible ? 1 : 0.1,

    uncertainty:
      clamp01(
        1 - evidenceQuality(step)
      ),

    risk,
    riskLevel: riskLevel(risk),

    historicalSuccess: 0.5,
    historicalAttempts: 0,

    approvalMode:
      approvalMode(step, risk),

    blockedReasons,
    adversarialFindings: []
  };
}

/* -------------------------------------------------------------------------- */
/* Multi-objective scorer                                                    */
/* -------------------------------------------------------------------------- */

function scoreCandidate(
  candidate: CandidateAction,
  history: any[],
  policy: DecisionPolicy
): CandidateAction {
  const stats =
    getHistoryStats(candidate, history);

  candidate.historicalSuccess =
    stats.posteriorSuccess;

  candidate.historicalAttempts =
    stats.attempts;

  const loopCount =
    repeatedActionCount(
      candidate,
      history
    );

  const approvalFriction =
    candidate.approvalMode === "AUTO"
      ? 0
      : candidate.approvalMode === "MANDATE"
        ? 0.25
        : 0.65;

  const adversarialPenalty =
    clamp01(
      candidate.adversarialFindings.length /
        4
    );

  const historicalReuse =
    clamp01(
      stats.attempts / 8
    );

  const positive = {
    goalProgress:
      candidate.goalProgress *
      policy.weights.goalProgress,

    strategicAlignment:
      candidate.strategicAlignment *
      policy.weights.strategicAlignment,

    successProbability:
      stats.posteriorSuccess *
      policy.weights.successProbability,

    evidenceGain:
      candidate.evidenceGain *
      policy.weights.evidenceGain,

    reversibility:
      candidate.reversible *
      policy.weights.reversibility,

    historicalReuse:
      historicalReuse *
      policy.weights.historicalReuse
  };

  const negative = {
    risk:
      candidate.risk *
      policy.weights.risk,

    uncertainty:
      candidate.uncertainty *
      policy.weights.uncertainty,

    cost:
      candidate.cost *
      policy.weights.cost,

    latency:
      candidate.latency *
      policy.weights.latency,

    approvalFriction:
      approvalFriction *
      policy.weights.approvalFriction,

    loopPenalty:
      clamp01(
        loopCount /
          policy.maxRepeatedAction
      ) *
      policy.weights.loopPenalty,

    adversarialPenalty:
      adversarialPenalty *
      policy.weights.adversarialPenalty
  };

  const positiveTotal =
    Object.values(positive)
      .reduce((a, b) => a + b, 0);

  const negativeTotal =
    Object.values(negative)
      .reduce((a, b) => a + b, 0);

  const exploration =
    policy.explorationStrength *
    stable01(candidate.id);

  candidate.utility =
    positiveTotal -
    negativeTotal +
    exploration;

  const dataConfidence =
    clamp01(
      stats.attempts / 10
    );

  const evidenceConfidence =
    1 - candidate.uncertainty;

  candidate.confidence =
    clamp01(
      0.25 +
      stats.posteriorSuccess * 0.35 +
      evidenceConfidence * 0.25 +
      dataConfidence * 0.15
    );

  candidate.components = {
    positive,
    negative
  };

  return candidate;
}

/* -------------------------------------------------------------------------- */
/* Pareto dominance                                                          */
/* -------------------------------------------------------------------------- */

function dominates(
  a: CandidateAction,
  b: CandidateAction
): boolean {
  const noWorse =
    a.goalProgress >= b.goalProgress &&
    a.historicalSuccess >=
      b.historicalSuccess &&
    a.evidenceGain >= b.evidenceGain &&
    a.risk <= b.risk &&
    a.cost <= b.cost;

  const strictlyBetter =
    a.goalProgress > b.goalProgress ||
    a.historicalSuccess >
      b.historicalSuccess ||
    a.evidenceGain > b.evidenceGain ||
    a.risk < b.risk ||
    a.cost < b.cost;

  return noWorse && strictlyBetter;
}

function paretoFrontier(
  candidates: CandidateAction[]
): CandidateAction[] {
  return candidates.filter(
    candidate =>
      !candidates.some(
        other =>
          other.id !== candidate.id &&
          dominates(other, candidate)
      )
  );
}

/* -------------------------------------------------------------------------- */
/* Expand subgoal into steps                                                  */
/* -------------------------------------------------------------------------- */

export async function expandSubgoalIntoSteps(
  subgoal: any,
  contextOrGoalDesc: any = {}
): Promise<any[]> {
  const title = String(
    subgoal?.description ??
    subgoal?.title ??
    "Unnamed subgoal"
  );

  const subgoalId = subgoal?.id || "sg";

  return [
    {
      id: `${subgoalId}:inspect`,
      subgoalId,
      title: `Inspektera nuläge för: ${title}`,
      description: `Inspektera nuläge för: ${title}`,
      status: "pending",
      tool: "Repository.inspect",
      toolName: "terminal.exec",
      expectedOutcome: "Analys av arkitektur & AST genomförd",
      expectedProgress: 0.12,
      expectedCost: 0.05,
      reversible: true,
      verificationRequired: true
    },
    {
      id: `${subgoalId}:hypothesize`,
      subgoalId,
      title: `Generera kandidatlösningar för: ${title}`,
      description: `Generera kandidatlösningar för: ${title}`,
      status: "pending",
      tool: "HypothesisEngine.generate",
      toolName: "model.generate",
      expectedOutcome: "Kandidatstrategier syntetiserade",
      expectedProgress: 0.18,
      expectedCost: 0.08,
      reversible: true,
      verificationRequired: false
    },
    {
      id: `${subgoalId}:evaluate`,
      subgoalId,
      title: `Utvärdera kandidatlösningar för: ${title}`,
      description: `Utvärdera kandidatlösningar för: ${title}`,
      status: "pending",
      tool: "DecisionEngine.rank",
      toolName: "model.generate",
      expectedOutcome: "Pareto-rankning och riskbedömning klar",
      expectedProgress: 0.20,
      expectedCost: 0.06,
      reversible: true,
      verificationRequired: true
    },
    {
      id: `${subgoalId}:execute`,
      subgoalId,
      title: `Implementera vald lösning för: ${title}`,
      description: `Implementera vald lösning för: ${title}`,
      status: "pending",
      tool: "ToolDispatcher.execute",
      toolName: "file.write",
      expectedOutcome: "Kodpatch applicerad och verifierad",
      expectedProgress: 0.32,
      expectedCost: 0.30,
      reversible: true,
      writesFiles: true,
      verificationRequired: true
    },
    {
      id: `${subgoalId}:verify`,
      subgoalId,
      title: `Verifiera faktisk outcome för: ${title}`,
      description: `Verifiera faktisk outcome för: ${title}`,
      status: "pending",
      tool: "VerificationEngine.verify",
      toolName: "terminal.exec",
      expectedOutcome: "Kompilering och linter passerar med 0 fel",
      expectedProgress: 0.12,
      expectedCost: 0.10,
      reversible: true,
      verificationRequired: true
    },
    {
      id: `${subgoalId}:learn`,
      subgoalId,
      title: `Reflektera och lagra Knowledge Object för: ${title}`,
      description: `Reflektera och lagra Knowledge Object för: ${title}`,
      status: "pending",
      tool: "MemoryEngine.learn",
      toolName: "git.savepoint",
      expectedOutcome: "Checkpoint sparad i JACO Audit Trail",
      expectedProgress: 0.06,
      expectedCost: 0.04,
      reversible: true,
      verificationRequired: true
    }
  ];
}

/* -------------------------------------------------------------------------- */
/* MAIN DECISION FUNCTION                                                    */
/* -------------------------------------------------------------------------- */

export async function decideNextStep(
  plan: any,
  recentHistory: any = [],
  useAdversarial = true,
  policy: DecisionPolicy = DEFAULT_POLICY
): Promise<DecisionResult> {
  const historyList = parseHistoryArray(recentHistory);

  const rawSteps =
    Array.isArray(plan?.steps)
      ? plan.steps
      : Array.isArray(plan?.currentPlan)
        ? plan.currentPlan
        : Array.isArray(plan?.subgoals)
          ? plan.subgoals.flatMap((sg: any) => sg.steps || [])
          : [];

  const steps =
    rawSteps.map(normalizeStep);

  const unfinished =
    steps.filter(
      step =>
        !completed(step) &&
        step.status !== "abandoned"
    );

  if (!unfinished.length) {
    return {
      decisionId: makeId("decision"),

      kind: "REPLAN",

      rankedCandidates: [],

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence: 0.98,
      utility: 0,

      rationale: [
        "No unfinished executable steps remain.",
        "Planner should evaluate whether the goal is complete or generate a new subgoal."
      ],

      guardrails: [],

      metrics: {
        candidateCount: 0,
        executableCandidateCount: 0,
        uncertainty: 0,
        historicalAttempts: 0,
        topScoreGap: 0
      },

      timestamp:
        new Date().toISOString()
    };
  }

  let candidates =
    unfinished.map(step =>
      stepCandidate(
        step,
        steps,
        plan
      )
    );

  /*
   * Adversarial pass.
   */

  if (useAdversarial) {
    candidates =
      candidates.map(candidate => {
        candidate.adversarialFindings =
          adversarialCritique(
            candidate,
            plan,
            historyList,
            policy
          );

        return candidate;
      });
  }

  /*
   * Score.
   */

  candidates =
    candidates.map(candidate =>
      scoreCandidate(
        candidate,
        historyList,
        policy
      )
    );

  /*
   * Hard-blocked actions are never sent to executor.
   */

  const executable =
    candidates.filter(
      c =>
        c.blockedReasons.length === 0
    );

  if (!executable.length) {
    return {
      decisionId: makeId("decision"),

      kind: "REPLAN",

      rankedCandidates:
        candidates.sort(
          (a, b) =>
            (b.utility ?? -Infinity) -
            (a.utility ?? -Infinity)
        ),

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence: 0.92,
      utility: -1,

      rationale: [
        "Every current candidate is blocked by a hard policy or dependency gate."
      ],

      guardrails: [
        ...new Set<string>(
          candidates.flatMap(
            c => c.blockedReasons
          )
        )
      ],

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount: 0,

        uncertainty: 1,

        historicalAttempts: 0,

        topScoreGap: 0
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * Pareto pruning before final ranking.
   */

  const frontier =
    paretoFrontier(executable);

  const ranked =
    [...frontier].sort(
      (a, b) =>
        (b.utility ?? -Infinity) -
        (a.utility ?? -Infinity)
    );

  const selected =
    ranked[0];

  const second =
    ranked[1];

  const scoreGap =
    second
      ? (selected.utility ?? 0) -
        (second.utility ?? 0)
      : Math.abs(
          selected.utility ?? 0
        );

  /*
   * Confidence calibration using score separation.
   */

  const separationConfidence =
    clamp01(
      0.5 +
      scoreGap / 4
    );

  const calibratedConfidence =
    clamp01(
      (selected.confidence ?? 0.5) *
        0.75 +
      separationConfidence *
        0.25
    );

  selected.confidence =
    calibratedConfidence;

  const repeated =
    repeatedActionCount(
      selected,
      historyList
    );

  /*
   * Loop breaker.
   */

  if (
    repeated >=
    policy.maxRepeatedAction
  ) {
    return {
      decisionId:
        makeId("decision"),

      kind: "REPLAN",

      selectedCandidate:
        selected,

      rankedCandidates:
        ranked,

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence:
        calibratedConfidence,

      utility:
        selected.utility ?? 0,

      rationale: [
        `Selected action has repeated ${repeated} consecutive times.`,
        "Execution loop detected; planner must create an alternative strategy."
      ],

      guardrails: [
        "LOOP_BREAKER"
      ],

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount:
          executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * High uncertainty => learn before acting.
   */

  if (
    selected.uncertainty >=
      policy.uncertaintyGatherThreshold &&
    selected.risk >= 0.28
  ) {
    return {
      decisionId:
        makeId("decision"),

      kind:
        "GATHER_EVIDENCE",

      selectedCandidate:
        selected,

      rankedCandidates:
        ranked,

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence:
        calibratedConfidence,

      utility:
        selected.utility ?? 0,

      rationale: [
        "The best action is materially uncertain.",
        "Gathering evidence has higher expected value than immediately committing to the action."
      ],

      guardrails: [
        "VALUE_OF_INFORMATION_GATE"
      ],

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount:
          executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * No candidate is good enough.
   */

  if (
    (selected.utility ?? 0) <
      policy.minExecuteUtility
  ) {
    return {
      decisionId:
        makeId("decision"),

      kind: "REPLAN",

      selectedCandidate:
        selected,

      rankedCandidates:
        ranked,

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence:
        calibratedConfidence,

      utility:
        selected.utility ?? 0,

      rationale: [
        "No candidate currently has positive enough expected utility.",
        "Continuing the current plan is inferior to replanning."
      ],

      guardrails: [
        "MINIMUM_EXPECTED_UTILITY"
      ],

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount:
          executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * Confidence gate.
   */

  if (
    calibratedConfidence <
      policy.minExecuteConfidence
  ) {
    return {
      decisionId:
        makeId("decision"),

      kind:
        "GATHER_EVIDENCE",

      selectedCandidate:
        selected,

      rankedCandidates:
        ranked,

      approval: {
        required: false,
        mode: "AUTO"
      },

      confidence:
        calibratedConfidence,

      utility:
        selected.utility ?? 0,

      rationale: [
        "The preferred action does not yet meet the calibrated execution-confidence threshold."
      ],

      guardrails: [
        "CONFIDENCE_GATE"
      ],

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount:
          executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * Human approval.
   */

  if (
    selected.approvalMode ===
    "HUMAN"
  ) {
    return {
      decisionId:
        makeId("decision"),

      kind:
        "REQUEST_APPROVAL",

      selectedCandidate:
        selected,

      rankedCandidates:
        ranked,

      approval: {
        required: true,
        mode: "HUMAN",
        reason:
          `Action classified ${selected.riskLevel} risk`
      },

      confidence:
        calibratedConfidence,

      utility:
        selected.utility ?? 0,

      rationale: [
        "The candidate has acceptable expected utility but crosses a human-approval boundary."
      ],

      guardrails:
        selected.adversarialFindings,

      metrics: {
        candidateCount:
          candidates.length,

        executableCandidateCount:
          executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
    };
  }

  /*
   * Time-bound capability mandate.
   */

  if (
    selected.approvalMode ===
    "MANDATE"
  ) {
    const mandateValid =
      Boolean(
        plan?.context?.mandateValid || plan?.mandateValid
      );

    if (!mandateValid) {
      return {
        decisionId:
          makeId("decision"),

        kind:
          "REQUEST_APPROVAL",

        selectedCandidate:
          selected,

        rankedCandidates:
          ranked,

        approval: {
          required: true,
          mode: "MANDATE",
          reason:
            "Action needs a valid time-bound capability mandate."
        },

        confidence:
          calibratedConfidence,

        utility:
          selected.utility ?? 0,

        rationale: [
          "The candidate is eligible for delegated autonomy, but no active mandate currently authorizes it."
        ],

        guardrails: [
          "MANDATE_REQUIRED"
        ],

        metrics: {
          candidateCount:
            candidates.length,

          executableCandidateCount:
            executable.length,

        uncertainty:
          selected.uncertainty,

        historicalAttempts:
          selected.historicalAttempts,

        topScoreGap:
          scoreGap
      },

      timestamp:
        new Date().toISOString()
      };
    }
  }

  /*
   * EXECUTE.
   */

  return {
    decisionId:
      makeId("decision"),

    kind: "EXECUTE",

    selectedCandidate:
      selected,

    rankedCandidates:
      ranked,

    approval: {
      required: false,
      mode:
        selected.approvalMode
    },

    confidence:
      calibratedConfidence,

    utility:
      selected.utility ?? 0,

    rationale: [
      "Candidate passed dependency and permission gates.",
      `Risk classified ${selected.riskLevel}.`,
      `Historical success posterior ${(selected.historicalSuccess * 100).toFixed(1)}%.`,
      `Calibrated confidence ${(calibratedConfidence * 100).toFixed(1)}%.`,
      "Candidate is Pareto-efficient against available alternatives."
    ],

    guardrails:
      selected.adversarialFindings,

    metrics: {
      candidateCount:
        candidates.length,

      executableCandidateCount:
        executable.length,

      uncertainty:
        selected.uncertainty,

      historicalAttempts:
        selected.historicalAttempts,

      topScoreGap:
        scoreGap
    },

    timestamp:
      new Date().toISOString()
  };
}

/* -------------------------------------------------------------------------- */
/* Blueprint synthesis generator                                             */
/* -------------------------------------------------------------------------- */

export async function generateComprehensiveBlueprint(goalDescription: string): Promise<Plan> {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date();

  const compressedMemoryContext = getCompressedMemoryForPlanning();
  const marketWatchContext = marketWatchService.getMarketWatchReasoningContext();
  const availableExternalTargets = listExternalMeasurementTargets();

  const prompt = `
Du är en ledande AI-systemarkitekt och agent-orkestrerare i JACO OS.
Operatören vill upprätta en komplett, hög-granular Blueprint och exekveringsplan för följande mål:
"${goalDescription}"

${marketWatchContext}

KOMPRIMERAT MINNE & SYSTEMDIREKTIV:
${compressedMemoryContext}

Generera en djupgående, professionell plan i strikt JSON-format (inget annat än JSON).
KRAV: Bryt ner planen i MÅNGA SMÅ, ATOMÄRA DELMÅL (5-8 delmål) istället för få stora klumpar, för maximal determinism och spårbarhet.
Format:
{
  "finalObjective": "...",
  "valueProposition": "...",
  "riskAssessment": "...",
  "estimatedTotalHours": 12,
  "compressedMemoryDigest": "...",
  "externalMeasurementTargets": [ ... ],
  "subgoals": [ ... ]
}
`.trim();

  try {
    const result = await generate({
      prompt,
      systemPrompt: 'Du är en senior AI-systemarkitekt för JACO Autonomous Agent Orchestrator. Svara uteslutande med valid JSON.'
    });

    const cleaned = result.text.replace(/```json|```/g, '').trim();
    const data = JSON.parse(cleaned);

    let currentScheduleOffsetMinutes = 0;

    const subgoals: Subgoal[] = (data.subgoals || []).map((sg: any, sgIdx: number) => {
      const subgoalId = `sg_${planId}_${sgIdx + 1}`;
      const sgDurationHours = sg.estimatedDurationHours || 1.5;
      const plannedDate = new Date(now.getTime() + currentScheduleOffsetMinutes * 60000).toLocaleString('sv-SE', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const steps: PlanStep[] = (sg.steps || []).map((st: any, stIdx: number) => {
        const stepEstMin = st.estimatedMinutes || 15;
        const stepStart = new Date(now.getTime() + currentScheduleOffsetMinutes * 60000).toISOString();
        currentScheduleOffsetMinutes += stepEstMin;
        const stepEnd = new Date(now.getTime() + currentScheduleOffsetMinutes * 60000).toISOString();

        return {
          id: `step_${subgoalId}_${stIdx + 1}`,
          subgoalId,
          description: st.description || `Steg ${stIdx + 1}`,
          toolName: st.toolName || 'terminal.exec',
          expectedOutcome: st.expectedOutcome || 'Slutfört utan regressioner',
          status: 'pending',
          jobId: null,
          attempts: 0,
          lastResult: null,
          assignedAgent: st.assignedAgent || (sg.assignedAgents && sg.assignedAgents[0]) || 'Code Refactor Agent',
          liveCommand: st.liveCommand || `npx tsx scripts/run_${stIdx + 1}.ts`,
          estimatedMinutes: stepEstMin,
          plannedStart: stepStart,
          plannedEnd: stepEnd,
          progressPercent: 0,
          toolsRequired: Array.isArray(st.toolsRequired) ? st.toolsRequired : ['git', 'node'],
          howToComplete: st.howToComplete || 'Exekveras i en isolerad sandbox och verifieras med enhetstester.',
          userActionRequired: st.userActionRequired || 'Ingen manuell åtgärd krävs.',
          auditLogs: [
            {
              timestamp: new Date().toISOString(),
              actor: st.assignedAgent || 'Blueprint Synthesizer',
              action: 'Plan Step Initialized',
              result: 'info',
              details: `Initialiserat plansteg med kommandot: ${st.liveCommand || 'npx tsx'}`
            }
          ]
        };
      });

      return {
        id: subgoalId,
        goalId: planId,
        description: sg.description || `Delmål ${sgIdx + 1}`,
        status: 'pending',
        progressPercent: 0,
        assignedAgents: Array.isArray(sg.assignedAgents) ? sg.assignedAgents : ['Code Refactor Agent', 'Security Auditor'],
        plannedDate,
        estimatedDurationHours: sgDurationHours,
        strategicValue: sg.strategicValue || 'Ökar systemets tillförlitlighet och autonomi.',
        targetMilestone: sg.targetMilestone || 'Alla delsteg verifierade med 100% testtäckning.',
        howItIsCompleted: sg.howItIsCompleted || 'Genomförs sekventiellt med kontinuerlig AST-analys.',
        whatUserMustFix: sg.whatUserMustFix || 'Ingen manuell åtgärd krävs för tillfället.',
        linkedMemoryIds: [`mem_node_${sgIdx + 1}`, `intel_digest_${sgIdx + 1}`],
        linkedCompressedMemory: sg.linkedCompressedMemory || 'Tillämpar atomär modulering och test-gate verifiering.',
        externalMeasurementTarget: sg.externalMeasurementTarget || {
          metricKey: `subgoal_metric_${sgIdx + 1}`,
          targetValue: 100,
          currentValue: 0,
          unit: '%',
          verificationSource: 'Automated CI/CD Sandbox',
          achieved: false
        },
        steps
      };
    });

    const parsedTargets = Array.isArray(data.externalMeasurementTargets) && data.externalMeasurementTargets.length > 0
      ? data.externalMeasurementTargets.map((t: any, idx: number) => ({
          id: `ext_target_${idx + 1}`,
          title: t.title || `Mätmål ${idx + 1}`,
          metricKey: t.metricKey || `metric_${idx + 1}`,
          targetValue: t.targetValue ?? 100,
          currentValue: t.currentValue ?? 0,
          unit: t.unit || '%',
          status: (t.currentValue >= t.targetValue ? 'achieved' : 'measuring') as 'achieved' | 'measuring' | 'pending'
        }))
      : availableExternalTargets.slice(0, 4).map(t => ({
          id: t.id,
          title: t.title,
          metricKey: t.metricKey,
          targetValue: t.targetValue,
          currentValue: t.currentValue,
          unit: t.unit,
          status: t.status
        }));

    const generatedPlan: Plan = {
      id: planId,
      goalDescription,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'active',
      subgoals,
      consecutiveFailures: 0,
      finalObjective: data.finalObjective || goalDescription,
      valueProposition: data.valueProposition || 'Skapar mätbart värde genom automatiserad exekvering och full spårbarhet.',
      riskAssessment: data.riskAssessment || 'Låg teknisk risk under förutsättning att linter och byggtester körs.',
      estimatedTotalHours: data.estimatedTotalHours || 8,
      overallProgressPercent: 0,
      activeAgentsCount: 4,
      linkedMemoryIds: ['indexeddb_core_rag', 'competitor_intel_mesh'],
      compressedMemoryDigest: data.compressedMemoryDigest || 'Optimering: Hög-granular dekomposition med test-gates och komprimerad minneslagring.',
      externalMeasurementTargets: parsedTargets
    };

    return generatedPlan;
  } catch (err) {
    console.warn('[PlanDecide] Fallback blueprint generation:', err);
    return {
      id: planId,
      goalDescription,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      status: 'active',
      consecutiveFailures: 0,
      finalObjective: goalDescription,
      valueProposition: 'Maximerar utvecklingseffektivitet med automatiserade sub-agenter och felkorrigering.',
      riskAssessment: 'Standard kontroll av linter- och byggstatus.',
      estimatedTotalHours: 6,
      overallProgressPercent: 0,
      activeAgentsCount: 3,
      linkedMemoryIds: ['indexeddb_core_rag'],
      compressedMemoryDigest: 'Fallback optimering: Minneslagring med kontinuerlig telemetri.',
      externalMeasurementTargets: availableExternalTargets.slice(0, 3).map(t => ({
        id: t.id,
        title: t.title,
        metricKey: t.metricKey,
        targetValue: t.targetValue,
        currentValue: t.currentValue,
        unit: t.unit,
        status: t.status
      })),
      subgoals: []
    };
  }
}
