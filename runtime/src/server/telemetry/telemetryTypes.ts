/**
 * JACO Telemetry Fabric 1.0 — Canonical Specification & Type Definitions
 * 
 * Implements OpenTelemetry Semantic Conventions for GenAI & Autonomous Agents,
 * Canonical Telemetry Envelope, 5-Tier Evidence Class Hierarchy,
 * and Monotonic Clock Profiling.
 */

export type EvidenceClass = 
  | 'MEASURED'      // Verifierad fysisk/kernel-mätning via sysfs/proc/perf/API
  | 'DERIVED'       // Deterministiskt matematiskt härledd från verifierade basmätningar
  | 'ESTIMATED'     // Statistisk inferens eller Bayesian prior
  | 'SIMULATED'     // Mockad eller simulerad i UI/testläge
  | 'UNAVAILABLE';  // Ingen tillgänglig sensor/mätare (aldrig fallback till gissningar)

export type TelemetryMetricType = 'gauge' | 'counter' | 'histogram' | 'event';

export type SpanStatusCode = 'UNSET' | 'OK' | 'ERROR';

export interface TelemetryPoint {
  schemaVersion: 'jaco.telemetry.v1';
  metric: string;
  value: number | string | boolean | null;
  unit?: string;
  type: TelemetryMetricType;
  truth: EvidenceClass;
  source: {
    collector: string;
    device?: string;
    interface?: string;
    rawSource?: string;
  };
  quality: {
    confidence: number;
    stale: boolean;
    ageMs: number;
  };
  time: {
    wallClock: string;
    monotonicNs: string;
  };
  context: {
    nodeId: string;
    service: string;
    missionId?: string;
    goalId?: string;
    planId?: string;
    decisionId?: string;
    agentId?: string;
    toolName?: string;
    model?: string;
  };
  evidence?: {
    rawHash?: string;
    provenanceId?: string;
  };
}

export interface TelemetrySpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string; // e.g. 'invoke_agent', 'decide', 'execute_tool', 'model_inference'
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
  startTimeWall: string;
  startTimeMonotonicNs: string;
  endTimeWall?: string;
  endTimeMonotonicNs?: string;
  durationMs?: number;
  status: {
    code: SpanStatusCode;
    message?: string;
  };
  attributes: Record<string, string | number | boolean | null | undefined>;
  events: Array<{
    name: string;
    timestamp: string;
    attributes?: Record<string, any>;
  }>;
}

export interface GenAiInferenceMetrics {
  operationName: 'generate_content' | 'chat_completion' | 'embedding' | 'tool_call';
  model: string;
  provider: 'gemini' | 'ollama' | 'litert' | 'lmstudio' | 'vllm' | 'sglang' | 'custom';
  device: 'npu' | 'gpu' | 'cpu' | 'cloud_tpu' | 'cloud_gpu';
  
  // Timing & Latency (Monotonic ns converted to ms)
  durationMs: number;
  queueDurationMs?: number;
  ttftMs?: number;               // Time to First Token
  tpotMs?: number;               // Time Per Output Token
  prefillDurationMs?: number;
  decodeDurationMs?: number;

  // Token Usage
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;

  // Context & Cache
  contextUsedTokens?: number;
  contextCapacityTokens?: number;
  cacheHitRatio?: number;

  // Truth Classification
  truth: EvidenceClass;
  provenanceHash?: string;
}

export interface MissionProofRecord {
  traceId: string;
  missionId: string;
  goalId?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  toolCallsCount: number;
  verifiedCount: number;
  failedCount: number;
  inputArtifactHash: string;
  outputArtifactHash: string;
  evidenceMerkleRoot: string;
  decisionPolicyVersion: string;
  runtimeVersion: string;
  modelVersion: string;
  leafHashes: string[];
}

export interface NodeHardwareMetrics {
  cpu: {
    utilizationPercent: number | null;
    coreCount: number;
    loadAvg: [number, number, number];
    truth: EvidenceClass;
    collector: string;
    observedAt: string;
  };
  memory: {
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    systemUsedMb: number | null;
    systemTotalMb: number | null;
    truth: EvidenceClass;
    collector: string;
    observedAt: string;
  };
  npu: {
    utilizationPercent: number | null;
    frequencyMhz: number | null;
    hardwareType: string;
    truth: EvidenceClass;
    collector: string;
    reasonIfUnavailable?: string;
    observedAt: string;
  };
  thermal: {
    temperatureC: number | null;
    throttlingActive: boolean;
    truth: EvidenceClass;
    collector: string;
    observedAt: string;
  };
  battery: {
    percent: number | null;
    isCharging: boolean | null;
    voltageMv?: number | null;
    truth: EvidenceClass;
    collector: string;
    observedAt: string;
  };
}
