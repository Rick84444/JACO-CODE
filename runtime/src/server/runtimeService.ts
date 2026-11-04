import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { telemetryFabric } from './telemetry/telemetryFabric';
import { NodeHardwareMetrics, EvidenceClass } from './telemetry/telemetryTypes';

export interface RuntimeNode {
  id: string;
  name: string;
  platform: 'android_termux' | 'linux_server' | 'cloud_container' | 'local_node';
  hostUrl: string;
  status: 'ONLINE' | 'ACTIVE_LOOP' | 'IDLE' | 'OFFLINE';
  lastHeartbeat: string;
  telemetry: {
    cpuUsagePercent: number;
    ramUsedMb: number;
    ramTotalMb: number;
    npuAccelerated: boolean;
    temperatureC?: number;
    batteryPercent?: number;
    truth?: EvidenceClass;
    hardwareDetails?: NodeHardwareMetrics;
  };
  activeAgent: string;
  currentGoal?: string;
  totalAgentCalls: number;
  lastL4Proof?: string;
}

export interface RuntimeAction {
  id: string;
  type: 'ast_patch' | 'shell_command' | 'save_memory' | 'publish_skill' | 'a2a_dispatch' | 'telemetry_log';
  target?: string;
  payload: any;
  status: 'PENDING' | 'EXECUTED' | 'FAILED';
  result?: string;
  l4Proof?: string;
}

export interface RuntimeAgentCallRequest {
  nodeId: string;
  nodeName?: string;
  platform?: 'android_termux' | 'linux_server' | 'cloud_container' | 'local_node';
  telemetry?: {
    cpuUsagePercent?: number;
    ramUsedMb?: number;
    ramTotalMb?: number;
    npuAccelerated?: boolean;
    temperatureC?: number;
    batteryPercent?: number;
  };
  currentGoal?: string;
  podarPhase?: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
  context?: {
    lastError?: string;
    pendingTasksCount?: number;
    localFiles?: string[];
    customPrompt?: string;
  };
}

export interface RuntimeAgentCallResponse {
  success: boolean;
  nodeId: string;
  timestamp: string;
  podarPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
  nextPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
  assignedAgent: string;
  reasoning: string;
  decision: string;
  actions: RuntimeAction[];
  suggestedIntervalMs: number;
  l4Proof: string;
}

class RuntimeService {
  private nodes: Map<string, RuntimeNode> = new Map();
  private actionHistory: RuntimeAction[] = [];
  private memoryDir: string;
  private genAI: GoogleGenAI | null = null;
  private autonomousLoopRunning: boolean = true;
  private autonomousIntervalMs: number = 4000;
  private autonomousTimer: NodeJS.Timeout | null = null;
  private serverPodarPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT' = 'PERCEIVE';
  private autonomousCycleCount: number = 0;
  private autonomousGoal: string = 'Autonomous NPU-accelerated orchestration & A2A market monitoring';

  constructor() {
    this.memoryDir = path.join(process.cwd(), '.jaco', 'memory', 'runtime');
    try {
      if (!fs.existsSync(this.memoryDir)) {
        fs.mkdirSync(this.memoryDir, { recursive: true });
      }
    } catch {
      // Ignore errors during initialization
    }

    // Collect verified hardware telemetry from the start via TelemetryFabric (no mocked numbers)
    const initialHw = telemetryFabric.collectNodeHardwareMetrics();

    // Register the base Cloud Run Master Node with real measurements
    this.registerNode({
      id: 'cloud-run-master-node',
      name: 'JACO Cloud Sovereign Hub',
      platform: 'cloud_container',
      hostUrl: 'https://mimirpower.com',
      status: 'ACTIVE_LOOP',
      lastHeartbeat: new Date().toISOString(),
      telemetry: {
        cpuUsagePercent: initialHw.cpu.utilizationPercent !== null ? Math.round(initialHw.cpu.utilizationPercent) : 0,
        ramUsedMb: initialHw.memory.heapUsedMb,
        ramTotalMb: initialHw.memory.systemTotalMb || initialHw.memory.heapTotalMb,
        npuAccelerated: initialHw.npu.truth === 'MEASURED',
        temperatureC: initialHw.thermal.temperatureC !== null ? initialHw.thermal.temperatureC : undefined,
        batteryPercent: initialHw.battery.percent !== null ? initialHw.battery.percent : undefined,
        truth: initialHw.cpu.truth,
        hardwareDetails: initialHw
      },
      activeAgent: 'Neo-Architect',
      currentGoal: this.autonomousGoal,
      totalAgentCalls: 1,
      lastL4Proof: 'sha256:' + crypto.createHash('sha256').update('cloud-master-init').digest('hex')
    });

    // Start the autonomous server loop immediately
    this.startAutonomousLoop();
  }

  public startAutonomousLoop(intervalMs?: number): boolean {
    if (intervalMs && intervalMs >= 1000) {
      this.autonomousIntervalMs = intervalMs;
    }
    this.autonomousLoopRunning = true;
    if (this.autonomousTimer) {
      clearInterval(this.autonomousTimer);
    }

    this.autonomousTimer = setInterval(async () => {
      if (!this.autonomousLoopRunning) return;
      await this.runAutonomousHeartbeatTick();
    }, this.autonomousIntervalMs);

    return true;
  }

  public stopAutonomousLoop(): boolean {
    this.autonomousLoopRunning = false;
    if (this.autonomousTimer) {
      clearInterval(this.autonomousTimer);
      this.autonomousTimer = null;
    }
    const master = this.nodes.get('cloud-run-master-node');
    if (master) {
      master.status = 'IDLE';
    }
    return false;
  }

  public isAutonomousLoopRunning(): boolean {
    return this.autonomousLoopRunning;
  }

  public getAutonomousStatus(): {
    running: boolean;
    intervalMs: number;
    cycleCount: number;
    currentPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT';
    goal: string;
    lastTick: string;
  } {
    return {
      running: this.autonomousLoopRunning,
      intervalMs: this.autonomousIntervalMs,
      cycleCount: this.autonomousCycleCount,
      currentPhase: this.serverPodarPhase,
      goal: this.autonomousGoal,
      lastTick: new Date().toISOString()
    };
  }

  public setAutonomousGoal(goal: string): void {
    this.autonomousGoal = goal;
    const master = this.nodes.get('cloud-run-master-node');
    if (master) master.currentGoal = goal;
  }

  /**
   * Runs an autonomous PODAR heartbeat (Perceive -> Orient -> Decide -> Act -> Reflect) directly on the server
   */
  private async runAutonomousHeartbeatTick(): Promise<void> {
    this.autonomousCycleCount++;
    const timestamp = new Date().toISOString();

    // 1. Telemetry collection via TelemetryFabric 1.0 (no Math.random())
    const hw = telemetryFabric.collectNodeHardwareMetrics();
    const ramUsedMb = hw.memory.heapUsedMb;
    const ramTotalMb = hw.memory.heapTotalMb;
    const cpuUsagePercent = hw.cpu.utilizationPercent !== null ? Math.round(hw.cpu.utilizationPercent) : 0;

    const telemetry = {
      cpuUsagePercent,
      ramUsedMb,
      ramTotalMb: Math.max(ramTotalMb, hw.memory.systemTotalMb || 1024),
      npuAccelerated: hw.npu.truth === 'MEASURED',
      temperatureC: hw.thermal.temperatureC !== null ? hw.thermal.temperatureC : undefined,
      batteryPercent: hw.battery.percent !== null ? hw.battery.percent : undefined,
      truth: hw.cpu.truth,
      hardwareDetails: hw
    };

    // Emit point to Telemetry Fabric
    telemetryFabric.emitPoint({
      metric: 'jaco.runtime.cpu.utilization',
      value: hw.cpu.utilizationPercent,
      unit: '%',
      type: 'gauge',
      truth: hw.cpu.truth,
      source: { collector: hw.cpu.collector },
      quality: { confidence: 1.0, stale: false, ageMs: 0 },
      context: {
        nodeId: 'cloud-run-master-node',
        service: 'jaco-runtime-daemon',
        goalId: this.autonomousGoal
      }
    });

    // Update the master node
    const masterNode = this.updateHeartbeat('cloud-run-master-node', telemetry, this.autonomousGoal);
    masterNode.totalAgentCalls = (masterNode.totalAgentCalls || 0) + 1;

    // Process through the agent call engine
    const phase = this.serverPodarPhase;
    let nextPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT' = 'ORIENT';
    if (phase === 'PERCEIVE') nextPhase = 'ORIENT';
    else if (phase === 'ORIENT') nextPhase = 'DECIDE';
    else if (phase === 'DECIDE') nextPhase = 'ACT';
    else if (phase === 'ACT') nextPhase = 'REFLECT';
    else if (phase === 'REFLECT') nextPhase = 'PERCEIVE';

    let reasoning = '';
    let decision = '';
    const actions: RuntimeAction[] = [];

    if (phase === 'PERCEIVE') {
      reasoning = `Telemetry read: Heap ${ramUsedMb}MB / ${ramTotalMb}MB, CPU ${cpuUsagePercent}%.`;
      decision = 'No action; fixed phase rotation (no decision model in this loop).';
    } else if (phase === 'ORIENT') {
      reasoning = `Goal \"${this.autonomousGoal}\" registered. No rule check runs in this loop.`;
      decision = 'No action.';
    } else if (phase === 'DECIDE') {
      reasoning = `Queuing save of cycle status.`;
      decision = 'Save cycle status (awaiting execution).';
      actions.push({
        id: 'act-' + crypto.randomBytes(4).toString('hex'),
        type: 'save_memory',
        target: '.jaco/memory/runtime/cloud-master-sync.json',
        payload: { cycle: this.autonomousCycleCount, timestamp, goal: this.autonomousGoal },
        status: 'PENDING'
      });
    } else if (phase === 'ACT') {
      reasoning = `Cycle #${this.autonomousCycleCount}: queuing telemetry save.`;
      decision = 'Save telemetry (awaiting execution).';
      actions.push({
        id: 'act-' + crypto.randomBytes(4).toString('hex'),
        type: 'telemetry_log',
        target: '.jaco/memory/runtime/telemetry.json',
        payload: { timestamp, telemetry },
        status: 'PENDING'
      });
    } else {
      reasoning = `Cycle #${this.autonomousCycleCount} finished.`;
      decision = 'Returning to PERCEIVE for the next autonomous heartbeat.';
    }

    const proofData = `cloud-master-node:${timestamp}:${phase}:${decision}`;
    const l4Proof = 'sha256:' + crypto.createHash('sha256').update(proofData).digest('hex');
    masterNode.lastL4Proof = l4Proof;

    actions.forEach(a => {
      a.l4Proof = l4Proof;
      this.actionHistory.unshift(a);
    });
    if (this.actionHistory.length > 50) {
      this.actionHistory.length = 50;
    }

    this.serverPodarPhase = nextPhase;
  }

  private getGenAI(): GoogleGenAI | null {
    if (!this.genAI && process.env.GEMINI_API_KEY) {
      try {
        this.genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      } catch (err) {
        console.warn('[RuntimeService] Could not initialize Gemini SDK:', err);
      }
    }
    return this.genAI;
  }

  public registerNode(node: RuntimeNode): void {
    this.nodes.set(node.id, node);
  }

  public updateHeartbeat(nodeId: string, telemetry?: any, currentGoal?: string): RuntimeNode {
    let node = this.nodes.get(nodeId);
    const hw = telemetryFabric.collectNodeHardwareMetrics();
    const fallbackCpu = hw.cpu.utilizationPercent !== null ? Math.round(hw.cpu.utilizationPercent) : 0;
    const fallbackRamUsed = hw.memory.heapUsedMb;
    const fallbackRamTotal = hw.memory.systemTotalMb || hw.memory.heapTotalMb;

    if (!node) {
      node = {
        id: nodeId,
        name: nodeId.includes('termux') ? 'Android Termux Edge Node' : 'JACO Autonomous Worker',
        platform: nodeId.includes('termux') ? 'android_termux' : 'linux_server',
        hostUrl: 'http://localhost:3000',
        status: 'ACTIVE_LOOP',
        lastHeartbeat: new Date().toISOString(),
        telemetry: {
          cpuUsagePercent: telemetry?.cpuUsagePercent ?? fallbackCpu,
          ramUsedMb: telemetry?.ramUsedMb ?? fallbackRamUsed,
          ramTotalMb: telemetry?.ramTotalMb ?? fallbackRamTotal,
          npuAccelerated: telemetry?.npuAccelerated ?? (hw.npu.truth === 'MEASURED'),
          temperatureC: telemetry?.temperatureC ?? (hw.thermal.temperatureC !== null ? hw.thermal.temperatureC : undefined),
          batteryPercent: telemetry?.batteryPercent ?? (hw.battery.percent !== null ? hw.battery.percent : undefined),
          truth: telemetry?.truth ?? hw.cpu.truth,
          hardwareDetails: hw
        },
        activeAgent: 'Nova-Agent',
        currentGoal: currentGoal || 'Autonomous local hardware and AST monitoring',
        totalAgentCalls: 0
      };
    } else {
      node.lastHeartbeat = new Date().toISOString();
      node.status = 'ACTIVE_LOOP';
      if (telemetry) {
        node.telemetry = { 
          ...node.telemetry, 
          ...telemetry,
          truth: telemetry.truth ?? node.telemetry.truth ?? hw.cpu.truth,
          hardwareDetails: hw
        };
      }
      if (currentGoal) {
        node.currentGoal = currentGoal;
      }
    }
    this.nodes.set(nodeId, node);
    return node;
  }

  public getNodes(): RuntimeNode[] {
    const now = Date.now();
    return Array.from(this.nodes.values()).map(node => {
      const diffMs = now - new Date(node.lastHeartbeat).getTime();
      const status: 'ONLINE' | 'ACTIVE_LOOP' | 'IDLE' | 'OFFLINE' = 
        diffMs < 30000 ? 'ACTIVE_LOOP' : diffMs < 120000 ? 'ONLINE' : 'OFFLINE';
      return { ...node, status };
    });
  }

  public async processAgentCall(req: RuntimeAgentCallRequest): Promise<RuntimeAgentCallResponse> {
    const nodeId = req.nodeId || 'termux-node-' + Date.now();
    const node = this.updateHeartbeat(nodeId, req.telemetry, req.currentGoal);
    node.totalAgentCalls = (node.totalAgentCalls || 0) + 1;

    const currentPhase = req.podarPhase || 'PERCEIVE';
    let nextPhase: 'PERCEIVE' | 'ORIENT' | 'DECIDE' | 'ACT' | 'REFLECT' = 'ORIENT';
    if (currentPhase === 'PERCEIVE') nextPhase = 'ORIENT';
    else if (currentPhase === 'ORIENT') nextPhase = 'DECIDE';
    else if (currentPhase === 'DECIDE') nextPhase = 'ACT';
    else if (currentPhase === 'ACT') nextPhase = 'REFLECT';
    else if (currentPhase === 'REFLECT') nextPhase = 'PERCEIVE';

    const timestamp = new Date().toISOString();
    const actions: RuntimeAction[] = [];
    let reasoning = '';
    let decision = '';
    const assignedAgent = req.platform === 'android_termux' ? 'Nova-Agent (NPU Core)' : 'Neo-Architect (Master Core)';

    // Generate autonomous actions based on state and telemetry
    const ai = this.getGenAI();
    let generatedByAI = false;

    if (ai && req.context?.customPrompt) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `You are the JACO Master Agent. A runtime on the platform "${req.platform || 'android_termux'}" calls you with the following telemetry and goal:
Goal: ${req.currentGoal || 'Autonomous system optimization'}
Phase: ${currentPhase}
Prompt / Event: ${req.context.customPrompt}
Telemetry: ${JSON.stringify(req.telemetry || {})}

Generate a short, precise JSON answer in the format:
{
  "reasoning": "Technical rationale without emojis",
  "decision": "System decision",
  "actions": [
    {
      "type": "telemetry_log" | "save_memory" | "shell_command",
      "target": "file name or module",
      "payload": {}
    }
  ]
}`
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          reasoning = parsed.reasoning || 'Cognitive operations analysis performed.';
          decision = parsed.decision || 'Updated system state.';
          if (Array.isArray(parsed.actions)) {
            parsed.actions.forEach((act: any) => {
              actions.push({
                id: 'act-' + crypto.randomBytes(4).toString('hex'),
                type: act.type || 'telemetry_log',
                target: act.target || 'system.log',
                payload: act.payload || {},
                status: 'PENDING'
              });
            });
          }
          generatedByAI = true;
        }
      } catch (err) {
        console.warn('[RuntimeService] AI call fell back to local deterministic logic:', err);
      }
    }

    if (!generatedByAI) {
      if (currentPhase === 'PERCEIVE') {
        reasoning = `Read telemetry from node ${nodeId}: CPU ${node.telemetry.cpuUsagePercent}%, RAM ${node.telemetry.ramUsedMb}MB / ${node.telemetry.ramTotalMb}MB (Truth: ${node.telemetry.truth || 'DERIVED'}), NPU ${node.telemetry.npuAccelerated ? 'Active (MEASURED)' : 'Passive (UNAVAILABLE)'}.`;
        decision = 'Logging telemetry.';
        actions.push({
          id: 'act-' + crypto.randomBytes(4).toString('hex'),
          type: 'telemetry_log',
          target: '.jaco/memory/runtime/telemetry.json',
          payload: { timestamp, telemetry: req.telemetry },
          status: 'PENDING'
        });
      } else if (currentPhase === 'ORIENT') {
        reasoning = `Goal \"${req.currentGoal || 'Autonomous system optimization'}\" registered. No rule check runs without a decision model.`;
        decision = 'Saving phase status.';
        actions.push({
          id: 'act-' + crypto.randomBytes(4).toString('hex'),
          type: 'save_memory',
          target: `.jaco/memory/runtime/${nodeId}-orient.json`,
          payload: { timestamp, goal: req.currentGoal, phase: 'ORIENT' },
          status: 'PENDING'
        });
      } else if (currentPhase === 'DECIDE') {
        reasoning = 'No decision model was called (requires customPrompt and GEMINI_API_KEY).';
        decision = 'No action.';
      } else if (currentPhase === 'ACT') {
        reasoning = 'No missions to execute in this phase.';
        decision = 'No action.';
      } else {
        reasoning = 'Cycle finished.';
        decision = 'Return to PERCEIVE for the next autonomous cycle.';
      }
    }

    const proofData = `${nodeId}:${timestamp}:${currentPhase}:${decision}`;
    const l4Proof = 'sha256:' + crypto.createHash('sha256').update(proofData).digest('hex');
    node.lastL4Proof = l4Proof;

    // Save actions in history
    actions.forEach(a => {
      a.l4Proof = l4Proof;
      this.actionHistory.unshift(a);
    });
    if (this.actionHistory.length > 50) {
      this.actionHistory.length = 50;
    }

    return {
      success: true,
      nodeId,
      timestamp,
      podarPhase: currentPhase,
      nextPhase,
      assignedAgent,
      reasoning,
      decision,
      actions,
      suggestedIntervalMs: 5000,
      l4Proof
    };
  }

  public getActionHistory(): RuntimeAction[] {
    return this.actionHistory;
  }
}

export const runtimeService = new RuntimeService();
