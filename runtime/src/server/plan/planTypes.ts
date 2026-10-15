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
  toolName: string;           // pekar på ett verktyg: git, terminal, model.generate, etc.
  expectedOutcome: string;    // vad steget ska uppnå
  status: StepStatus;
  jobId: string | null;       // kopplar till JobRecord i job queue
  attempts: number;
  lastResult: string | null;
  
  // Blueprint & exekveringsdetaljer
  assignedAgent?: string;     // F.ex. 'Code Refactor Agent', 'Security Auditor Agent', 'Marketplace Broker'
  liveCommand?: string;       // Det faktiska CLI/API-kommandot som körs under steget
  estimatedMinutes?: number;  // Tidsåtgång
  plannedStart?: string;      // Planerad starttid (ISO)
  plannedEnd?: string;        // Planerad sluttid (ISO)
  actualCompletedAt?: string; // Faktisk tidpunkt för slutförande
  progressPercent?: number;   // 0 - 100%
  toolsRequired?: string[];   // Lista med specifika verktyg/binärer (t.ex. ['git', 'tsc', 'ripgrep', 'esbuild'])
  howToComplete?: string;     // Steg-för-steg instruktion för hur det slutförs
  userActionRequired?: string;// Vad operatören manuellt behöver åtgärda/godkänna
  auditLogs?: StepAuditLog[]; // Fullständig audit-logg för detta steg
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
  strategicValue?: string;    // Resonerad vinst/nytta för helheten
  targetMilestone?: string;   // Slutmål för just detta delmål
  howItIsCompleted?: string;  // Strategisk förklaring till hur det slutförs
  whatUserMustFix?: string;   // Vad operatören behöver göra
  webResearchSummary?: string;
  webSources?: WebSearchResultItem[];
  // Minneskoppling & Externa Mätmål
  linkedMemoryIds?: string[];           // ID till relaterade minnesnoder i IndexedDB MemoryStore
  linkedCompressedMemory?: string;       // Komprimerad insikt från konkurrentanalys som stärker detta delmål
  externalMeasurementTarget?: {          // Externt mätbart mål kopplat till delmålet
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
  /** Räknar konsekutiva misslyckanden på aktuellt delmål — triggar omplanering. */
  consecutiveFailures: number;

  // Övergripande blueprint-metadata
  finalObjective?: string;     // Det ultimata slutmålet
  estimatedTotalHours?: number;
  overallProgressPercent?: number;
  valueProposition?: string;   // Resonemang kring vinst, effektivitet och ROI
  riskAssessment?: string;     // Identifierade risker och mitigering
  activeAgentsCount?: number;

  // Autonomi, Minnesanknytning & Externa Mätmål
  linkedMemoryIds?: string[];               // Kopplade minnesreferenser för hela planen
  compressedMemoryDigest?: string;          // Sammanfattad komprimerad kunskap som använts vid generering
  externalMeasurementTargets?: Array<{      // Externa mätbara mål för hela planen
    id: string;
    title: string;
    metricKey: string;
    targetValue: number;
    currentValue: number;
    unit: string;
    status: 'pending' | 'achieved' | 'measuring' | 'failed';
  }>;

  // Inre Resonemang & Gatekeeper
  jacoFinalApproval?: JacoFinalApproval;
  innerReasoningLogs?: InnerReasoningLogEntry[];
  blockers?: SystemBlocker[];
  lastAutonomousPing?: string;
  autoExecutedStepsCount?: number;
}

/** Hittar nästa steg som ska köras: första 'pending' steget i aktivt delmål. */
export function getNextStep(plan: Plan): { step: PlanStep; subgoal: Subgoal } | null {
  for (const subgoal of plan.subgoals) {
    if (subgoal.status === 'abandoned' || subgoal.status === 'completed') continue;
    const step = subgoal.steps.find((s) => s.status === 'pending' || s.status === 'active');
    if (step) return { step, subgoal };
  }
  return null;
}

/**
 * Avgör om planen behöver omplaneras. Detta är den explicita "strategibyte"-
 * triggern — utan den fortsätter agenten bara köra samma delplan tills
 * den tar slut, även om den uppenbart inte fungerar.
 */
export function needsReplanning(plan: Plan, failureThreshold: number = 2): boolean {
  return plan.consecutiveFailures >= failureThreshold;
}

/** Markerar ett steg klart eller misslyckat och uppdaterar räknaren för omplanering. */
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

  // Kontrollera om hela delmålet blev completed (alla steg är completed)
  const finalSubgoals = updatedSubgoals.map((subgoal) => {
    if (subgoal.status === 'abandoned' || subgoal.status === 'completed') return subgoal;
    const allStepsDone = subgoal.steps.length > 0 && subgoal.steps.every((s) => s.status === 'completed');
    if (allStepsDone) {
      return { ...subgoal, status: 'completed' as StepStatus };
    }
    return subgoal;
  });

  // Kontrollera om hela planen blev completed (alla subgoals completed/abandoned)
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

/** Markerar ett delmål som övergivet — resten av dess steg körs aldrig. */
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
