import {
  Plan,
  PlanStep,
  Subgoal,
  getNextStep,
  needsReplanning,
  recordStepOutcome,
  abandonSubgoal
} from './planTypes.js';
import {
  savePlan,
  loadPlan,
  listActivePlans as listActiveDbPlans,
  createPlan as createDbPlan
} from './planDb.js';

export function createPlan(
  goalDescription: string,
  subgoalsInput?: Array<{ description: string; steps: Array<{ description: string; toolName: string; expectedOutcome: string }> }>
): Plan {
  if (!subgoalsInput || subgoalsInput.length === 0) {
    return createDbPlan(goalDescription);
  }

  const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const subgoals: Subgoal[] = subgoalsInput.map((sg, sgIdx) => {
    const subgoalId = `sg_${planId}_${sgIdx + 1}`;
    const steps: PlanStep[] = sg.steps.map((st, stIdx) => ({
      id: `step_${subgoalId}_${stIdx + 1}`,
      subgoalId,
      description: st.description,
      toolName: st.toolName || 'system',
      expectedOutcome: st.expectedOutcome || 'Completed without errors',
      status: 'pending',
      jobId: null,
      attempts: 0,
      lastResult: null
    }));

    return {
      id: subgoalId,
      goalId: planId,
      description: sg.description,
      status: 'pending',
      steps
    };
  });

  const plan: Plan = {
    id: planId,
    goalDescription,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    subgoals,
    consecutiveFailures: 0
  };

  savePlan(plan);
  return plan;
}

export function getPlan(planId: string): Plan | undefined {
  const loaded = loadPlan(planId);
  return loaded || undefined;
}

export function getActivePlan(): Plan | undefined {
  const active = listActiveDbPlans();
  return active.length > 0 ? active[0] : undefined;
}

export function listPlans(): Plan[] {
  return listActiveDbPlans();
}

export function updatePlanOutcome(planId: string, stepId: string, outcome: { success: boolean; result: string }): Plan | undefined {
  const existing = getPlan(planId);
  if (!existing) return undefined;

  const updated = recordStepOutcome(existing, stepId, outcome);
  savePlan(updated);
  return updated;
}

export function abandonSubgoalInPlan(planId: string, subgoalId: string): Plan | undefined {
  const existing = getPlan(planId);
  if (!existing) return undefined;

  const updated = abandonSubgoal(existing, subgoalId);
  savePlan(updated);
  return updated;
}

export function addSubgoalToPlan(
  planId: string,
  subgoalInput: {
    description: string;
    targetMilestone?: string;
    strategicValue?: string;
    howItIsCompleted?: string;
    whatUserMustFix?: string;
    assignedAgents?: string[];
    estimatedDurationHours?: number;
    steps?: Array<{
      description: string;
      toolName?: string;
      expectedOutcome?: string;
      assignedAgent?: string;
      liveCommand?: string;
      estimatedMinutes?: number;
      toolsRequired?: string[];
      howToComplete?: string;
      userActionRequired?: string;
    }>;
  }
): Plan | undefined {
  const existing = getPlan(planId);
  if (!existing) return undefined;

  const subgoalId = `sg_${planId}_${existing.subgoals.length + 1}_${Date.now()}`;
  const now = new Date();

  const steps: PlanStep[] = (subgoalInput.steps || []).map((st, stIdx) => ({
    id: `step_${subgoalId}_${stIdx + 1}`,
    subgoalId,
    description: st.description,
    toolName: st.toolName || 'terminal.exec',
    expectedOutcome: st.expectedOutcome || 'Completed without errors',
    status: 'pending',
    jobId: null,
    attempts: 0,
    lastResult: null,
    assignedAgent: st.assignedAgent || 'Code Refactor Agent',
    liveCommand: st.liveCommand || `npx tsx scripts/step_${stIdx + 1}.ts`,
    estimatedMinutes: st.estimatedMinutes || 20,
    plannedStart: now.toISOString(),
    plannedEnd: new Date(now.getTime() + (st.estimatedMinutes || 20) * 60000).toISOString(),
    progressPercent: 0,
    toolsRequired: st.toolsRequired || ['git', 'node'],
    howToComplete: st.howToComplete || 'Runs in an isolated sandbox and is validated with the TypeScript linter.',
    userActionRequired: st.userActionRequired || 'No manual action required.',
    auditLogs: [
      {
        timestamp: now.toISOString(),
        actor: st.assignedAgent || 'Operator Action',
        action: 'Subgoal Step Added',
        result: 'info',
        details: 'Dynamic sub-subgoal added by the operator'
      }
    ]
  }));

  const newSubgoal: Subgoal = {
    id: subgoalId,
    goalId: planId,
    description: subgoalInput.description,
    status: 'pending',
    progressPercent: 0,
    assignedAgents: subgoalInput.assignedAgents || ['Code Refactor Agent'],
    plannedDate: now.toLocaleDateString('en-US'),
    estimatedDurationHours: subgoalInput.estimatedDurationHours || 2,
    strategicValue: subgoalInput.strategicValue || 'Contributes to meeting the primary goal sub-requirements.',
    targetMilestone: subgoalInput.targetMilestone || 'All sub-steps completed and verified.',
    howItIsCompleted: subgoalInput.howItIsCompleted || 'Carried out via a standardized sub-agent loop.',
    whatUserMustFix: subgoalInput.whatUserMustFix || 'No action required.',
    webResearchSummary: 'Synthesized analysis for the added sub-subgoal.',
    steps
  };

  const updatedPlan: Plan = {
    ...existing,
    subgoals: [...existing.subgoals, newSubgoal],
    updatedAt: new Date().toISOString()
  };

  savePlan(updatedPlan);
  return updatedPlan;
}

export { getNextStep, needsReplanning, savePlan, loadPlan, listActiveDbPlans };

