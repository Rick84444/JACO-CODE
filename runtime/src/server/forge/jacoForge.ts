/**
 * JACO Forge 1.0 Core Engine
 * Intuition Contract Compiler, project/agent orchestration,
 * Operator Subsystem, Device Journey Runner, and Transactional Changeset Manager.
 */

import crypto from 'crypto';
import { workspaceJournal, WorkspaceEvent } from '../workspace/workspaceJournal.js';
import { telemetryFabric } from '../telemetry/telemetryFabric.js';
import { androidDeviceAgent } from '../android/androidDeviceAgent.js';

export interface GoalContract {
  id: string;
  rawPrompt: string;
  goal: string;
  desiredOutcome: string;
  fixedConstraints: string[];
  completionCriteria: string[];
  autonomyTier: 'LOCAL_AUTO' | 'MANDATE_REQUIRED' | 'HUMAN_APPROVAL_REQUIRED';
  createdAt: string;
}

export interface DeviceJourney {
  id: string;
  name: string;
  description: string;
  steps: Array<{
    stepNumber: number;
    intent: string;
    expectedTool: string;
    uiAssertion: string;
    nativeStateAssertion: string;
    status: 'PENDING' | 'EXECUTING' | 'PASSED' | 'FAILED';
    durationMs?: number;
    evidenceHash?: string;
  }>;
  status: 'PENDING' | 'PASSED' | 'FAILED';
  executedAt?: string;
}

export interface ChangesetRecord {
  id: string;
  intent: string;
  beforeSnapshot: {
    gitCommit: string;
    siteSnapshotHash: string;
    dnsState: string;
    cloudflareState: string;
  };
  changes: Array<{
    filePath: string;
    action: 'CREATE' | 'MODIFY' | 'DELETE';
    diffSummary: string;
  }>;
  testResults: {
    total: number;
    passed: number;
    failed: number;
    durationMs: number;
  };
  postConditions: Array<{
    condition: string;
    passed: boolean;
  }>;
  status: 'COMMITTED' | 'ROLLED_BACK';
  evidenceHash: string;
  timestamp: string;
}

export interface TemporaryWorkerContext {
  id: string;
  role: string;
  missionId: string;
  spawnedAt: string;
  status: 'SPAWNED' | 'ACTIVE' | 'COMPLETED' | 'DESTROYED';
  findings: string[];
}

export class JacoForgeEngine {
  private static instance: JacoForgeEngine;

  private activeContracts: Map<string, GoalContract> = new Map();
  private journeys: Map<string, DeviceJourney> = new Map();
  private changesets: Map<string, ChangesetRecord> = new Map();
  private activeWorkers: Map<string, TemporaryWorkerContext> = new Map();

  private constructor() {
    this.seedDefaultJourneys();
  }

  public static getInstance(): JacoForgeEngine {
    if (!JacoForgeEngine.instance) {
      JacoForgeEngine.instance = new JacoForgeEngine();
    }
    return JacoForgeEngine.instance;
  }

  private seedDefaultJourneys(): void {
    // Templates are intentionally PENDING until a real device/site journey is run.
    // No preloaded PASS, latency, or evidence hashes are allowed in release state.
    const torchJourney: DeviceJourney = {
      id: 'journey-torch-control',
      name: 'Android Torch Control Journey',
      description: 'End-to-end verification of flashlight hardware invocation and native state assertion.',
      status: 'PENDING',
      steps: [
        { stepNumber: 1, intent: 'Turn torch on', expectedTool: 'android.torch.set(on)', uiAssertion: 'verified receipt required', nativeStateAssertion: 'native callback required', status: 'PENDING' },
        { stepNumber: 2, intent: 'Turn torch off', expectedTool: 'android.torch.set(off)', uiAssertion: 'verified receipt required', nativeStateAssertion: 'native callback required', status: 'PENDING' }
      ]
    };
    const siteJourney: DeviceJourney = {
      id: 'journey-web-render-smoke',
      name: 'Web Render Smoke Test Journey',
      description: 'Template only. Must execute real HTTP/browser checks before PASS.',
      status: 'PENDING',
      steps: [
        { stepNumber: 1, intent: 'Verify public page render', expectedTool: 'wordpress.render.verify', uiAssertion: 'HTTP receipt required', nativeStateAssertion: 'public render hash required', status: 'PENDING' }
      ]
    };
    this.journeys.set(torchJourney.id, torchJourney);
    this.journeys.set(siteJourney.id, siteJourney);
  }

  /**
   * Intuition Layer: Compiles free-text human intent into structured GoalContract
   */
  public compileIntuition(prompt: string): GoalContract {
    const id = `goal-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const now = new Date().toISOString();

    const isSiteOps = prompt.toLowerCase().includes('mimirpower') || prompt.toLowerCase().includes('webb') || prompt.toLowerCase().includes('site') || prompt.toLowerCase().includes('uppgradera');
    const isAndroid = prompt.toLowerCase().includes('android') || prompt.toLowerCase().includes('lampa') || prompt.toLowerCase().includes('torch') || prompt.toLowerCase().includes('app') || prompt.toLowerCase().includes('ficklampa');
    const isDestructive = prompt.toLowerCase().includes('delete') || prompt.toLowerCase().includes('ta bort') || prompt.toLowerCase().includes('betala') || prompt.toLowerCase().includes('deploy prod');

    let goal = prompt;
    let desiredOutcome = 'Verified high-reliability execution with deterministic evidence';
    let fixedConstraints = [
      'Preserve existing data & configuration without destructive loss',
      'Continuous telemetry tracking via JACO Telemetry Fabric',
      'Rollback capability if postconditions fail'
    ];
    let completionCriteria = [
      'Linter & TypeScript compiler checks pass (0 errors)',
      'Deterministic sandbox evaluations pass >= 95%',
      'Cryptographic SHA-256 mission proof generated'
    ];

    let autonomyTier: GoalContract['autonomyTier'] = 'LOCAL_AUTO';

    if (isSiteOps) {
      goal = 'Production Upgrade & Optimization for mimirpower.se';
      desiredOutcome = 'Modern, high-performance, validated production site without regression';
      fixedConstraints.push('Production site must remain reachable at all times', 'Automatic pre-change backup required');
      completionCriteria.push('TLS & DNS valid', 'Visual regression suite accepted', 'TTFB < 200ms');
      autonomyTier = 'MANDATE_REQUIRED';
    } else if (isAndroid) {
      goal = 'Android Native Journey & Hardware Integration';
      desiredOutcome = 'Hardware capability executed and verified via native device assertion';
      fixedConstraints.push('Hardware sensor must be checked via Qualcomm/Android HAL', 'No UI blocking');
      completionCriteria.push('Device state verified via Android native callback');
    }

    if (isDestructive) {
      autonomyTier = 'HUMAN_APPROVAL_REQUIRED';
    }

    const contract: GoalContract = {
      id,
      rawPrompt: prompt,
      goal,
      desiredOutcome,
      fixedConstraints,
      completionCriteria,
      autonomyTier,
      createdAt: now
    };

    this.activeContracts.set(id, contract);

    // Record on Workspace Journal
    workspaceJournal.appendEvent({
      actor: 'aura-intuition-compiler',
      kind: 'GOAL_DEFINED',
      priority: 'HIGH',
      wake: true,
      payload: contract
    });

    return contract;
  }

  /**
   * Compiler 1: Project Compiler
   */
  public compileProject(goalContract: GoalContract): {
    projectId: string;
    structure: string[];
    generatedFiles: number;
    assignedJourneys: string[];
  } {
    const projectId = `proj-${Date.now()}`;
    const assignedJourneys = Array.from(this.journeys.keys());

    workspaceJournal.appendEvent({
      actor: 'forge-project-compiler',
      kind: 'MISSION_STARTED',
      priority: 'HIGH',
      wake: false,
      payload: {
        missionId: projectId,
        title: `Project: ${goalContract.goal}`,
        autonomyTier: goalContract.autonomyTier
      }
    });

    return {
      projectId,
      structure: [
        'src/components/',
        'src/server/forge/',
        'src/server/workspace/',
        'src/server/android/',
        'src/server/telemetry/'
      ],
      generatedFiles: 4,
      assignedJourneys
    };
  }

  /**
   * Compiler 2: Agent Compiler (Ephemeral Specialist Contexts)
   */
  public spawnTemporaryWorker(role: string, missionId: string): TemporaryWorkerContext {
    const id = `worker-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const worker: TemporaryWorkerContext = {
      id,
      role,
      missionId,
      spawnedAt: new Date().toISOString(),
      status: 'ACTIVE',
      findings: []
    };

    this.activeWorkers.set(id, worker);
    return worker;
  }

  public completeAndDestroyWorker(workerId: string, findingSummary?: string): void {
    const worker = this.activeWorkers.get(workerId);
    if (!worker) return;

    worker.status = 'COMPLETED';
    if (findingSummary) {
      worker.findings.push(findingSummary);
      workspaceJournal.appendEvent({
        actor: worker.role,
        kind: 'FINDING_RECORDED',
        priority: 'NORMAL',
        wake: false,
        payload: {
          workerId,
          summary: findingSummary
        }
      });
    }

    worker.status = 'DESTROYED';
    this.activeWorkers.delete(workerId);
  }

  /**
   * Device Journey Runner
   */
  public async runJourney(journeyId: string): Promise<DeviceJourney | null> {
    const journey = this.journeys.get(journeyId);
    if (!journey) return null;

    journey.status = 'PENDING';
    const startNs = process.hrtime.bigint();

    for (const step of journey.steps) {
      step.status = 'EXECUTING';

      if (step.expectedTool.includes('android.torch.set')) {
        const state = step.expectedTool.includes('on') ? 'on' : 'off';
        const res = await androidDeviceAgent.setTorch(state);
        step.status = res.success ? 'PASSED' : 'FAILED';
        step.durationMs = res.executionTimeMs;
        step.evidenceHash = res.evidenceRecord.actionHash;
      } else {
        // Unsupported journey tools must never receive synthetic verification evidence.
        step.status = 'FAILED';
        step.durationMs = 0;
        step.evidenceHash = undefined;
      }
    }

    const allPassed = journey.steps.every(s => s.status === 'PASSED');
    journey.status = allPassed ? 'PASSED' : 'FAILED';
    journey.executedAt = new Date().toISOString();

    workspaceJournal.appendEvent({
      actor: 'forge-journey-runner',
      kind: 'JOURNEY_EXECUTED',
      priority: 'NORMAL',
      wake: false,
      payload: {
        journeyId: journey.id,
        status: journey.status,
        durationMs: telemetryFabric.getMonotonicElapsedMs(startNs)
      }
    });

    return journey;
  }

  /**
   * Transactional Changeset Manager (Rollback on Failure)
   */
  public createChangeset(params: {
    intent: string;
    changes: Array<{ filePath: string; action: 'CREATE' | 'MODIFY' | 'DELETE'; diffSummary: string }>;
  }): ChangesetRecord {
    const id = `cs-${Date.now()}`;
    const now = new Date().toISOString();
    const evidenceHash = crypto.createHash('sha256').update(JSON.stringify({ id, intent: params.intent, changes: params.changes, now })).digest('hex');
    const record: ChangesetRecord = {
      id,
      intent: params.intent,
      beforeSnapshot: {
        gitCommit: 'UNVERIFIED',
        siteSnapshotHash: 'UNVERIFIED',
        dnsState: 'UNVERIFIED',
        cloudflareState: 'UNVERIFIED'
      },
      changes: params.changes,
      testResults: { total: 0, passed: 0, failed: 0, durationMs: 0 },
      postConditions: [],
      status: 'ROLLED_BACK',
      evidenceHash,
      timestamp: now
    };
    this.changesets.set(id, record);
    workspaceJournal.appendEvent({
      actor: 'forge-changeset-engine',
      kind: 'CHANGESET_PROPOSED',
      priority: 'HIGH',
      wake: true,
      payload: { ...record, status: 'UNVERIFIED_PROPOSAL' }
    } as any);
    return record;
  }

  public getContracts(): GoalContract[] {
    return Array.from(this.activeContracts.values());
  }

  public getJourneys(): DeviceJourney[] {
    return Array.from(this.journeys.values());
  }

  public getChangesets(): ChangesetRecord[] {
    return Array.from(this.changesets.values());
  }

  public getActiveWorkers(): TemporaryWorkerContext[] {
    return Array.from(this.activeWorkers.values());
  }
}

export const jacoForgeEngine = JacoForgeEngine.getInstance();
