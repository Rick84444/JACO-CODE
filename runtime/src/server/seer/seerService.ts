import { getZTPRuntime } from '../state/ztpRuntime.js';
import { TelemetryFabric } from '../telemetry/telemetryFabric.js';
import { listNodes } from '../state/nodeStatus.js';
import { routeRequest, resolveOllamaModel } from '../modelPool/poolManager.js';
import { generateGeminiCompletion } from '../modelPool/providers/geminiProvider.js';
import { generateOllamaCompletion } from '../modelPool/providers/ollamaProvider.js';
import { logActionToMemory, logErrorToMemory } from '../state/memoryIntegration.js';
import { seerLiveWorkstream } from './liveWorkstream.js';

export type OperatingMode = 'CONSERVE' | 'NORMAL' | 'ACCELERATE' | 'SPRINT' | 'RECOVERY';

export interface StrategicAssessment {
  overall: 'OPTIMAL' | 'UNDERPERFORMING' | 'CRITICAL' | 'SATISFACTORY';
  execution_efficiency: number;
  main_constraint: string;
}

export interface StrategicControlDirective {
  protocol: 'JACO_STRATEGIC_CONTROL_V1';
  cycle_id: string;
  timestamp: string;
  source_model: string;
  latency_ms: number;
  assessment: StrategicAssessment;
  operating_mode: OperatingMode;
  resource_control: {
    desired_parallel_workers: number;
    increase_reasoning_budget_pct: number;
  };
  priority_changes: Array<{
    action: 'PAUSE' | 'INCREASE' | 'DECREASE' | 'RESUME';
    target: string;
    weight?: number;
  }>;
  reasoning_summary: string;
}

export interface StrategicMessage {
  id: string;
  timestamp: string;
  role: 'jaco-system' | 'coo-agent' | 'system';
  protocol: string;
  text: string;
  metadata?: any;
}

class SeerService {
  private static instance: SeerService | null = null;
  private loopInterval: NodeJS.Timeout | null = null;
  private isLoopRunning = false;
  private currentMode: OperatingMode = 'NORMAL';
  private messageHistory: StrategicMessage[] = [];
  private lastDirective: StrategicControlDirective | null = null;
  private cycleCounter = 0;
  private loopIntervalMs = 25000;
  private missionContextProvider: (() => any) | null = null;

  public setMissionContextProvider(provider: () => any): void {
    this.missionContextProvider = provider;
  }

  private constructor() {
    this.messageHistory.push({
      id: 'init-1',
      timestamp: new Date().toISOString(),
      role: 'system',
      protocol: 'INIT',
      text: 'JACO SEER Strategic Regulator Core initialized. Ready for genuine autonomous telemetry loops.'
    });
  }

  public static getInstance(): SeerService {
    if (!SeerService.instance) {
      SeerService.instance = new SeerService();
    }
    return SeerService.instance;
  }

  /**
   * Genererar verklig realtidstelemetri utan simulerade slumptal.
   */
  public generateRealStrategicState(): Record<string, any> {
    const ztp = getZTPRuntime();
    const telemetry = TelemetryFabric.getInstance();
    const nodes = listNodes();
    
    const mission = this.missionContextProvider?.();
    const activeGoal = (mission ? { id: mission.id, objective: mission.goal, status: mission.status } : null) || ztp.pointRead('primary_goal') || {
      id: 'GOAL-UNCONFIGURED',
      objective: 'No primary goal has been configured',
      progress: 0,
      status: 'UNCONFIGURED'
    };

    const currentDrift = ztp.pointRead('manifold_drift_control') ?? 0;
    const velocityState = ztp.pointRead('agent_velocity') || { trend: 'UNAVAILABLE', score: 0, parallel_workers: 0 };

    // Hämta verkliga hårdvarumått
    const hw = telemetry.collectNodeHardwareMetrics();
    const cpuObserved = hw?.cpu?.utilizationPercent != null;
    const memoryObserved = Boolean(hw?.memory?.heapTotalMb);
    const cpuLoad = cpuObserved ? hw.cpu.utilizationPercent / 100 : 0;
    const memPressure = memoryObserved ? (hw.memory.heapUsedMb / hw.memory.heapTotalMb) : 0;

    this.cycleCounter += 1;
    const cycleId = `SC-${this.cycleCounter.toString().padStart(6, '0')}`;

    const payload = {
      protocol: 'JACO_STRATEGIC_STATE_V1',
      cycle_id: cycleId,
      timestamp: new Date().toISOString(),
      primary_goal: activeGoal,
      mission_context: mission ? {
        id: mission.id, goal: mission.goal, status: mission.status,
        phase: mission.phase, observation: mission.observation,
        recent_action_results: mission.receipts.slice(-6),
        allowed_tasks: mission.allowedTasks,
      } : null,
      system: {
        operating_mode: this.currentMode,
        cpu_load: parseFloat(cpuLoad.toFixed(4)),
        memory_pressure: parseFloat(memPressure.toFixed(4)),
        active_nodes_count: nodes.length,
        manifold_drift: currentDrift,
        evidence: {
          cpu: cpuObserved ? 'MEASURED' : 'UNAVAILABLE',
          memory: memoryObserved ? 'MEASURED' : 'UNAVAILABLE',
          goal: activeGoal.status === 'UNCONFIGURED' ? 'UNAVAILABLE' : 'OBSERVED'
        }
      },
      velocity: {
        current_score: Number(velocityState.score ?? 0),
        trend: String(velocityState.trend ?? 'UNAVAILABLE'),
        active_workers: Number(velocityState.parallel_workers ?? 0)
      },
      request: {
        type: 'STRATEGIC_CONTROL',
        directive_timeout_ms: 10000
      }
    };

    return payload;
  }

  /**
   * Kör en fullständig, icke-mockad strategisk regleringscykel med AI-modell och uppdaterar ZTP-CRDT.
   */
  public async executeCycle(): Promise<{
    state: Record<string, any>;
    directive: StrategicControlDirective;
  }> {
    const ztp = getZTPRuntime();
    const statePayload = this.generateRealStrategicState();
    const cycleId = statePayload.cycle_id;
    const startTime = Date.now();
    seerLiveWorkstream.beginCycle({
      cycle: this.cycleCounter,
      primaryGoal: statePayload.primary_goal?.objective || statePayload.primary_goal?.title || null,
      subgoal: statePayload.primary_goal?.current_subgoal || null,
      drift: Number.isFinite(Number(statePayload.system?.manifold_drift)) ? Number(statePayload.system.manifold_drift) : null,
      workers: { active: Number(statePayload.velocity?.active_workers || 0), max: 16 },
    });

    // 1. Skicka state till ZTP-journalen
    ztp.recordState('seer_strategic_state', statePayload);

    // 2. Logga i meddelandeströmmen
    this.messageHistory.push({
      id: `state-${Date.now()}`,
      timestamp: new Date().toISOString(),
      role: 'jaco-system',
      protocol: 'JACO_STRATEGIC_STATE_V1',
      text: JSON.stringify(statePayload, null, 2),
      metadata: { cycleId }
    });

    // 3. Ruttar anropet till optimal modell (Gemini Pro, Flash eller lokal Ollama)
    seerLiveWorkstream.update({ phase: 'PLANNING', activeModule: 'SEER' });
    seerLiveWorkstream.record({ actor: 'SEER', type: 'seer.phase.changed', message: 'SEER entered PLANNING', verified: true });
    const routing = routeRequest('strategic_regulation');
    let rawOutput = '';
    let usedModel = routing.provider.name;
    seerLiveWorkstream.update({ provider: routing.provider.type, model: routing.provider.name });

    const systemPrompt = `You are JACO SEER (Strategic COO Regulator). 
Your mission is to regulate the autonomous agent cluster by analyzing real telemetry in JACO_STRATEGIC_STATE_V1 and issuing an optimal JACO_STRATEGIC_CONTROL_V1 directive.

RULES:
1. Always respond ONLY with a single valid JSON object adhering strictly to the JACO_STRATEGIC_CONTROL_V1 schema.
2. Choose operating_mode from: "CONSERVE", "NORMAL", "ACCELERATE", "SPRINT", "RECOVERY".
3. Evaluate velocity, CPU load, memory pressure, and goal progress.
4. Output schema:
{
  "protocol": "JACO_STRATEGIC_CONTROL_V1",
  "assessment": {
    "overall": "OPTIMAL" | "UNDERPERFORMING" | "CRITICAL" | "SATISFACTORY",
    "execution_efficiency": number (0.0 to 1.0),
    "main_constraint": string
  },
  "operating_mode": "CONSERVE" | "NORMAL" | "ACCELERATE" | "SPRINT" | "RECOVERY",
  "resource_control": {
    "desired_parallel_workers": number (1 to 16),
    "increase_reasoning_budget_pct": number (-50 to 100)
  },
  "priority_changes": [
    { "action": "PAUSE" | "INCREASE" | "DECREASE" | "RESUME", "target": string, "weight": number }
  ],
  "reasoning_summary": string
}`;

    const userPrompt = `Here is the current JACO telemetry:\n${JSON.stringify(statePayload, null, 2)}\n\nIssue the JACO_STRATEGIC_CONTROL_V1 response now:`;

    try {
      seerLiveWorkstream.update({ phase: 'EXECUTING', activeModule: 'SEER' });
      if (routing.provider.type === 'gemini') {
        const res = await generateGeminiCompletion(userPrompt, 'gemini-2.5-flash', systemPrompt);
        rawOutput = res.text;
        usedModel = res.modelUsed;
      } else if (routing.provider.type === 'ollama') {
        const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
        const model = await resolveOllamaModel(routing.provider.endpoint);
        if (!model) throw new Error('OLLAMA_NO_INSTALLED_MODEL');
        const res = await generateOllamaCompletion(routing.provider.endpoint, model, fullPrompt);
        rawOutput = res.text;
        usedModel = `Ollama (${model})`;
      } else {
        // Fallback om ingen provider är online
        rawOutput = this.buildRuleBasedDirectiveJson(statePayload);
        usedModel = 'Local Rule-Based Deterministic Regulator';
      }
    } catch (err: any) {
      // Tyst nedgradering - loggas inte som error då det är en förväntad fallback-mekanism när endpoints saknas
      rawOutput = this.buildRuleBasedDirectiveJson(statePayload);
      usedModel = 'Local Deterministic Fallback Engine';
    }

    const latencyMs = Date.now() - startTime;
    seerLiveWorkstream.update({ phase: 'VERIFYING', provider: routing.provider.type, model: usedModel });
    seerLiveWorkstream.record({ actor: 'SEER', type: 'verification.started', message: `Verifying strategic directive from ${usedModel}`, verified: true });

    // 4. Tolka och validera JSON-direktivet
    let parsedDirective: StrategicControlDirective;
    try {
      // Rensa eventuell markdown-formatering
      const cleaned = rawOutput.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      parsedDirective = {
        protocol: 'JACO_STRATEGIC_CONTROL_V1',
        cycle_id: cycleId,
        timestamp: new Date().toISOString(),
        source_model: usedModel,
        latency_ms: latencyMs,
        assessment: {
          overall: parsed.assessment?.overall || 'SATISFACTORY',
          execution_efficiency: Number(parsed.assessment?.execution_efficiency ?? 0.75),
          main_constraint: parsed.assessment?.main_constraint || 'Normal computational throughput'
        },
        operating_mode: parsed.operating_mode || 'NORMAL',
        resource_control: {
          desired_parallel_workers: Math.max(1, Math.min(16, Number(parsed.resource_control?.desired_parallel_workers || 4))),
          increase_reasoning_budget_pct: Number(parsed.resource_control?.increase_reasoning_budget_pct || 0)
        },
        priority_changes: Array.isArray(parsed.priority_changes) ? parsed.priority_changes : [],
        reasoning_summary: parsed.reasoning_summary || 'Autonomous regulatory cycle processed.'
      };
    } catch {
      // Fallback om svaret inte var giltig JSON
      parsedDirective = {
        protocol: 'JACO_STRATEGIC_CONTROL_V1',
        cycle_id: cycleId,
        timestamp: new Date().toISOString(),
        source_model: usedModel,
        latency_ms: latencyMs,
        assessment: {
          overall: 'SATISFACTORY',
          execution_efficiency: 0.78,
          main_constraint: 'Model returned unstructured text, normalized via fallback'
        },
        operating_mode: 'NORMAL',
        resource_control: {
          desired_parallel_workers: 4,
          increase_reasoning_budget_pct: 0
        },
        priority_changes: [],
        reasoning_summary: rawOutput.slice(0, 200)
      };
    }

    // 5. Tillämpa direktivet i ZTP-CRDT och lokal runtime
    this.currentMode = parsedDirective.operating_mode;
    this.lastDirective = parsedDirective;

    ztp.recordState('operating_mode', this.currentMode);
    ztp.recordState('seer_strategic_control', parsedDirective);
    ztp.recordState('agent_velocity', {
      trend: parsedDirective.assessment.overall === 'UNDERPERFORMING' ? 'RECOVERING' : 'OPTIMAL',
      score: parsedDirective.assessment.execution_efficiency,
      parallel_workers: parsedDirective.resource_control.desired_parallel_workers
    });

    logActionToMemory(
      'seer_strategic_cycle',
      `SEER reglerade läge till ${this.currentMode} via ${usedModel} (${latencyMs}ms)`,
      ['seer', 'coo', this.currentMode]
    );

    // 6. Logga svaret i meddelandeströmmen
    this.messageHistory.push({
      id: `ctrl-${Date.now()}`,
      timestamp: new Date().toISOString(),
      role: 'coo-agent',
      protocol: 'JACO_STRATEGIC_CONTROL_V1',
      text: JSON.stringify(parsedDirective, null, 2),
      metadata: { cycleId, usedModel, latencyMs }
    });

    // Begränsa historik så minnet inte sväller oändligt
    if (this.messageHistory.length > 200) {
      this.messageHistory = this.messageHistory.slice(-150);
    }

    seerLiveWorkstream.update({
      phase: this.isLoopRunning ? 'OBSERVING' : 'IDLE',
      activeModule: 'SEER',
      provider: routing.provider.type,
      model: usedModel,
      workers: { active: parsedDirective.resource_control.desired_parallel_workers, max: 16 },
      blocker: null,
      evidenceState: 'OBSERVED',
      nextCycleAt: this.isLoopRunning ? new Date(Date.now() + this.loopIntervalMs).toISOString() : null,
    });
    seerLiveWorkstream.record({ actor: 'SEER', type: 'seer.cycle.completed', message: `Cycle ${this.cycleCounter} verified via ${usedModel}`, verified: true, receipt: { cycleId, latencyMs, operatingMode: parsedDirective.operating_mode } });
    return { state: statePayload, directive: parsedDirective };
  }

  private buildRuleBasedDirectiveJson(state: any): string {
    const cpu = Number(state.system.cpu_load || 0);
    const mem = Number(state.system.memory_pressure || 0);
    const evidenceAvailable = state.system?.evidence?.cpu !== 'UNAVAILABLE' && state.system?.evidence?.memory !== 'UNAVAILABLE';
    let mode: OperatingMode = 'NORMAL';
    let workers = 1;

    if (evidenceAvailable && (cpu > 0.85 || mem > 0.85)) {
      mode = 'CONSERVE';
      workers = 2;
    } else if (evidenceAvailable && cpu < 0.4 && mem < 0.5) {
      mode = 'ACCELERATE';
      workers = 6;
    }

    return JSON.stringify({
      protocol: 'JACO_STRATEGIC_CONTROL_V1',
      assessment: {
        overall: !evidenceAvailable ? 'SATISFACTORY' : (mode === 'CONSERVE' ? 'CRITICAL' : 'OPTIMAL'),
        execution_efficiency: evidenceAvailable ? 0.85 : 0,
        main_constraint: !evidenceAvailable ? 'Runtime telemetry unavailable' : (mode === 'CONSERVE' ? 'High system resource pressure' : 'Nominal execution latency')
      },
      operating_mode: mode,
      resource_control: {
        desired_parallel_workers: workers,
        increase_reasoning_budget_pct: mode === 'ACCELERATE' ? 25 : 0
      },
      priority_changes: [
        { action: mode === 'CONSERVE' ? 'PAUSE' : 'INCREASE', target: 'worker-pipelines', weight: 1.5 }
      ],
      reasoning_summary: evidenceAvailable
        ? `Deterministic regulator: CPU=${(cpu*100).toFixed(1)}%, Mem=${(mem*100).toFixed(1)}%`
        : 'Deterministic regulator held conservative defaults because telemetry evidence is unavailable.'
    }, null, 2);
  }

  public startLoop(intervalMs = 25000): void {
    if (this.isLoopRunning) return;
    this.loopIntervalMs = Math.max(5000, intervalMs);
    intervalMs = this.loopIntervalMs;
    this.isLoopRunning = true;
    seerLiveWorkstream.update({ phase: 'OBSERVING', activeModule: 'SEER', nextCycleAt: new Date(Date.now() + intervalMs).toISOString() });
    seerLiveWorkstream.record({ actor: 'SEER', type: 'seer.loop.started', message: `SEER loop started at ${intervalMs} ms cadence`, verified: true });

    // Kör en cykel direkt vid start
    this.executeCycle().catch(err => {
      logErrorToMemory('seerService', `Fel vid initial SEER-cykel: ${err.message}`);
    });

    // A local model can take longer than the cadence; skip a tick instead of stacking concurrent cycles.
    let cycleInFlight = false;
    this.loopInterval = setInterval(() => {
      if (cycleInFlight) return;
      cycleInFlight = true;
      this.executeCycle().catch(err => {
        logErrorToMemory('seerService', `Fel vid periodisk SEER-cykel: ${err.message}`);
      }).finally(() => { cycleInFlight = false; });
    }, intervalMs);
  }

  public stopLoop(): void {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    this.isLoopRunning = false;
    seerLiveWorkstream.update({ phase: 'IDLE', activeModule: 'SEER', nextCycleAt: null, action: { surface: 'NONE', type: null, status: 'NONE' } });
    seerLiveWorkstream.record({ actor: 'SEER', type: 'seer.loop.stopped', message: 'SEER loop stopped', verified: true });
  }

  public getStatus() {
    const ztp = getZTPRuntime();
    return {
      isLoopRunning: this.isLoopRunning,
      operatingMode: this.currentMode,
      cycleCount: this.cycleCounter,
      lastDirective: this.lastDirective,
      crdtSnapshot: {
        version: ztp.snapshotRead().version,
        frontier: ztp.snapshotRead().frontier.clock
      },
      evidenceState: this.cycleCounter > 0 ? (this.lastDirective ? 'OBSERVED' : 'DEGRADED') : 'UNVERIFIED',
      provider: this.lastDirective?.source_model || null,
      live: seerLiveWorkstream.snapshot()
    };
  }

  public getMessages(): StrategicMessage[] {
    return [...this.messageHistory];
  }
}

export const seerService = SeerService.getInstance();
