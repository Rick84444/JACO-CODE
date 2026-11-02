export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'abandoned';

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  relevanceScore?: number;
}

export interface StepAuditLog {
  timestamp: string;
  actor: string;
  action: string;
  result: 'passed' | 'failed' | 'warning' | 'info';
  details: string;
  proofHash?: string;
}

export interface InnerReasoningLogEntry {
  id: string;
  timestamp: string;
  stepId?: string;
  subgoalId?: string;
  type: 'adversarial_debate' | 'web_recovery' | 'autonomous_dispatch' | 'jaco_gate_check';
  explorerProposal: string;
  falsifierCritique: string;
  synthesizedResolution: string;
  survived: boolean;
  assignedAgent: string;
  proofHash?: string;
}

export interface SystemBlocker {
  id: string;
  stepId: string;
  subgoalId: string;
  title: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  autoRecoveryAttempted: boolean;
  userActionRequired?: string;
  createdAt: string;
  resolved: boolean;
}

export interface JacoFinalApproval {
  approved: boolean;
  approvedBy: string;
  signedAt?: string;
  proofHash?: string;
  notes?: string;
  verifiedArtifacts?: string[];
}

export interface PlanStep {
  id: string;
  subgoalId: string;
  description: string;
  toolName: string;           // points to a tool: git, terminal, model.generate, etc.
  expectedOutcome: string;    // what the step should achieve
  status: StepStatus;
  jobId: string | null;       // links to a JobRecord in the job queue
  attempts: number;
  lastResult: string | null;
  
  // Blueprint & execution details
  assignedAgent?: string;     // E.g. 'Code Refactor Agent', 'Security Auditor Agent', 'Marketplace Broker'
  liveCommand?: string;       // The actual CLI/API command run during the step
  estimatedMinutes?: number;  // Time required
  plannedStart?: string;      // Planned start time (ISO)
  plannedEnd?: string;        // Planned end time (ISO)
  actualCompletedAt?: string; // Actual completion time
  progressPercent?: number;   // 0 - 100%
  toolsRequired?: string[];   // List of specific tools/binaries (e.g. ['git', 'tsc', 'ripgrep', 'esbuild'])
  howToComplete?: string;     // Step-by-step instructions for completing it
  userActionRequired?: string;// What the operator must fix/approve manually
  auditLogs?: StepAuditLog[]; // Full audit log for this step
  webResearch?: {
    query: string;
    summary: string;
    results: WebSearchResultItem[];
  };
}

export interface Subgoal {
  id: string;
  goalId: string;
  description: string;
  status: StepStatus;
  progressPercent?: number;
  assignedAgents?: string[];
  plannedDate?: string;
  estimatedDurationHours?: number;
  strategicValue?: string;    // Reasoned benefit for the whole
  targetMilestone?: string;   // End goal for this particular subgoal
  howItIsCompleted?: string;  // Strategic explanation of how it is completed
  whatUserMustFix?: string;   // What the operator needs to do
  webResearchSummary?: string;
  webSources?: WebSearchResultItem[];
  // Memory links & external measurement targets
  linkedMemoryIds?: string[];           // IDs of related memory nodes in IndexedDB MemoryStore
  linkedCompressedMemory?: string;       // Compressed insight from competitor analysis that strengthens this subgoal
  externalMeasurementTarget?: {          // External measurable target linked to the subgoal
    metricKey: string;
    targetValue: number;
    currentValue: number;
    unit: string;
    verificationSource: string;
    achieved: boolean;
  };
  steps: PlanStep[];
}

export interface Plan {
  id: string;
  goalDescription: string;
  createdAt: string;
  updatedAt: string;
  status: 'active' | 'awaiting_jaco_final_approval' | 'completed' | 'abandoned';
  subgoals: Subgoal[];
  /** Counts consecutive failures on the current subgoal — triggers replanning. */
  consecutiveFailures: number;

  // Overall blueprint metadata
  finalObjective?: string;     // The ultimate end goal
  estimatedTotalHours?: number;
  overallProgressPercent?: number;
  valueProposition?: string;   // Reasoning about benefit, efficiency and ROI
  riskAssessment?: string;     // Identified risks and mitigation
  activeAgentsCount?: number;

  // Autonomy, memory links & external measurement targets
  linkedMemoryIds?: string[];               // Linked memory references for the whole plan
  compressedMemoryDigest?: string;          // Summarized compressed knowledge used during generation
  externalMeasurementTargets?: Array<{      // External measurable targets for the whole plan
    id: string;
    title: string;
    metricKey: string;
    targetValue: number;
    currentValue: number;
    unit: string;
    status: 'pending' | 'achieved' | 'measuring' | 'failed';
  }>;

  // Inner reasoning & gatekeeper
  jacoFinalApproval?: JacoFinalApproval;
  innerReasoningLogs?: InnerReasoningLogEntry[];
  blockers?: SystemBlocker[];
  lastAutonomousPing?: string;
  autoExecutedStepsCount?: number;
}

/** Finds the next step to run: the first 'pending' step in the active subgoal. */
export function getNextStep(plan: Plan): { step: PlanStep; subgoal: Subgoal } | null {
  for (const subgoal of plan.subgoals) {
    if (subgoal.status === 'abandoned' || subgoal.status === 'completed') continue;
    const step = subgoal.steps.find((s) => s.status === 'pending' || s.status === 'active');
    if (step) return { step, subgoal };
  }
  return null;
}

/**
 * Decides whether the plan needs replanning. This is the explicit "change of strategy"
 * trigger — without it the agent just keeps running the same sub-plan until
 * it runs out, even when it obviously is not working.
 */
export function needsReplanning(plan: Plan, failureThreshold: number = 2): boolean {
  return plan.consecutiveFailures >= failureThreshold;
}

/** Marks a step done or failed and updates the replanning counter. */
export function recordStepOutcome(
  plan: Plan,
  stepId: string,
  outcome: { success: boolean; result: string }
): Plan {
  const updatedSubgoals = plan.subgoals.map((subgoal) => ({
    ...subgoal,
    steps: subgoal.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            status: (outcome.success ? 'completed' : 'failed') as StepStatus,
            lastResult: outcome.result,
            attempts: step.attempts + 1,
          }
        : step
    ),
  }));

  // Check whether the whole subgoal is completed (all steps completed)
  const finalSubgoals = updatedSubgoals.map((subgoal) => {
    if (subgoal.status === 'abandoned' || subgoal.status === 'completed') return subgoal;
    const allStepsDone = subgoal.steps.length > 0 && subgoal.steps.every((s) => s.status === 'completed');
    if (allStepsDone) {
      return { ...subgoal, status: 'completed' as StepStatus };
    }
    return subgoal;
  });

  // Check whether the whole plan is completed (all subgoals completed/abandoned)
  const allSubgoalsDone = finalSubgoals.every((sg) => sg.status === 'completed' || sg.status === 'abandoned');
  const planStatus = allSubgoalsDone ? 'completed' : plan.status;

  return {
    ...plan,
    status: planStatus,
    subgoals: finalSubgoals,
    consecutiveFailures: outcome.success ? 0 : plan.consecutiveFailures + 1,
    updatedAt: new Date().toISOString(),
  };
}

/** Marks a subgoal as abandoned — the rest of its steps never run. */
export function abandonSubgoal(plan: Plan, subgoalId: string): Plan {
  return {
    ...plan,
    subgoals: plan.subgoals.map((sg) =>
      sg.id === subgoalId
        ? {
            ...sg,
            status: 'abandoned' as StepStatus,
            steps: sg.steps.map((st) => ({ ...st, status: 'abandoned' as StepStatus }))
          }
        : sg
    ),
    consecutiveFailures: 0,
    updatedAt: new Date().toISOString(),
  };
}
