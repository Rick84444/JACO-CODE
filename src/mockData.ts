import { OllamaModel, DeviceTelemetry, CodeFile, SocketDevice, TerminalLog, PatchHistoryItem } from './types';

export const INITIAL_MODELS: OllamaModel[] = [
  {
    id: 'nemotron-4b-instruct',
    name: 'nemotron-4b',
    tag: '4b-instruct-q4_K_M',
    size: '2.5 GB',
    quantization: 'Q4_K_M',
    family: 'nemotron',
    parameters: '4.0B',
    modifiedAt: 'Aktiv (LiteRT / Ollama v0.18)',
    contextLength: 128000,
    isLoaded: true,
    memoryRequiredMb: 2800,
    speedTokensPerSec: 78.4,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'deepseek-coder-6.7b',
    name: 'deepseek-coder',
    tag: '6.7b-instruct-q4_K_M',
    size: '3.8 GB',
    quantization: 'Q4_K_M',
    family: 'llama',
    parameters: '6.7B',
    modifiedAt: '2 hours ago',
    contextLength: 16384,
    isLoaded: false,
    memoryRequiredMb: 4100,
    speedTokensPerSec: 42.5,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'llama-3.2-3b',
    name: 'llama3.2',
    tag: '3b-instruct-fp16',
    size: '2.0 GB',
    quantization: 'FP16',
    family: 'llama',
    parameters: '3.2B',
    modifiedAt: '1 day ago',
    contextLength: 131072,
    isLoaded: false,
    memoryRequiredMb: 2400,
    speedTokensPerSec: 68.1,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'qwen-2.5-coder-7b',
    name: 'qwen2.5-coder',
    tag: '7b-instruct-q8_0',
    size: '4.7 GB',
    quantization: 'Q8_0',
    family: 'qwen2',
    parameters: '7.6B',
    modifiedAt: '3 days ago',
    contextLength: 32768,
    isLoaded: false,
    memoryRequiredMb: 5200,
    speedTokensPerSec: 35.8,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'gemma-4-latest',
    name: 'gemma-4',
    tag: 'latest-multimodal-q4_K_M',
    size: '3.2 GB',
    quantization: 'Q4_K_M',
    family: 'gemma',
    parameters: '4.8B',
    modifiedAt: 'Just added',
    contextLength: 32768,
    isLoaded: false,
    memoryRequiredMb: 3400,
    speedTokensPerSec: 72.4,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'gemma-2-2b',
    name: 'gemma2',
    tag: '2b-instruct-q4_0',
    size: '1.6 GB',
    quantization: 'Q4_0',
    family: 'gemma',
    parameters: '2.6B',
    modifiedAt: '5 mins ago',
    contextLength: 8192,
    isLoaded: false,
    memoryRequiredMb: 1800,
    speedTokensPerSec: 84.2,
    isDownloaded: true,
    npuAccelerated: true,
  },
  {
    id: 'mistral-7b-v0.3',
    name: 'mistral',
    tag: '7b-instruct-v0.3-q4_0',
    size: '4.1 GB',
    quantization: 'Q4_0',
    family: 'llama',
    parameters: '7.2B',
    modifiedAt: 'Not downloaded',
    contextLength: 32768,
    isLoaded: false,
    memoryRequiredMb: 4300,
    speedTokensPerSec: 0,
    isDownloaded: false,
    npuAccelerated: false,
  }
];

export const INITIAL_TELEMETRY: DeviceTelemetry = {
  batteryLevel: 88,
  batteryStatus: 'discharging',
  npuUsagePercent: 34,
  npuLoad: 34,
  npuHardwareType: 'Android NNAPI (Tensor Core)',
  npuFrequencyMhz: 1250,
  npuLoadState: 'OBSERVED',
  cpuUsagePercent: 18,
  ramUsedGb: 6.8,
  ramTotalGb: 12.0,
  vramUsedGb: 3.9,
  vramTotalGb: 8.0,
  temperatureC: 38.5,
  connectionType: 'Wi-Fi 6',
  localIp: '192.168.1.142',
  socketPort: 11434,
  isOfflineMode: true,
  activeServiceStatus: 'On-Device Private Mode'
};

export const INITIAL_CODE_FILES: CodeFile[] = [
  {
    id: 'file-1',
    path: 'src/server.ts',
    filename: 'server.ts',
    language: 'typescript',
    errorsCount: 1,
    warningsCount: 2,
    content: `import express from "express";
import { OllamaLocalEngine } from "./ollamaEngine";

const app = express();
app.use(express.json());

// Initialize Local On-Device NPU Ollama Model Bridge
const engine = new OllamaLocalEngine({
  model: "deepseek-coder:6.7b",
  quantization: "Q4_K_M",
  maxContext: 16384,
  gpuLayers: 33
});

app.post("/api/agent/command", async (req, res) => {
  const { voiceCommand, contextFiles } = req.body;
  
  // Real-time intent recognition
  const intent = await engine.parseVoiceIntent(voiceCommand);
  console.log("[Antigravity Voice Intent]", intent);

  // Execute Agentic Antigravity Code Refactoring Cycle
  const result = await engine.runAgenticCycle({
    intent,
    files: contextFiles,
    autoPatch: true
  });

  return res.json({ success: true, result });
});

// Wi-Fi Socket Server Sync Listener for VS Code Extension
app.listen(11434, "0.0.0.0", () => {
  console.log("Ollama Android Engine running on http://192.168.1.142:11434");
});`
  },
  {
    id: 'file-2',
    path: 'src/utils/math.ts',
    filename: 'math.ts',
    language: 'typescript',
    errorsCount: 0,
    warningsCount: 0,
    content: `/**
 * Math utility module for NPU matrix operations
 */
export function calculateTensorDotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Dimension mismatch in tensor vector product");
  }
  return a.reduce((sum, val, idx) => sum + val * b[idx], 0);
}

export function softmax(logits: number[]): number[] {
  const maxLogit = Math.max(...logits);
  const exps = logits.map(l => Math.exp(l - maxLogit));
  const sumExps = exps.reduce((acc, curr) => acc + curr, 0);
  return exps.map(e => e / sumExps);
}`
  },
  {
    id: 'file-3',
    path: 'tests/agent.test.ts',
    filename: 'agent.test.ts',
    language: 'typescript',
    errorsCount: 0,
    warningsCount: 0,
    content: `import { describe, it, expect } from "vitest";
import { calculateTensorDotProduct, softmax } from "../src/utils/math";

describe("NPU Accelerated Math Utilities", () => {
  it("computes exact dot product for 4D vector", () => {
    const vec1 = [1, 2, 3, 4];
    const vec2 = [0.5, 1, 1.5, 2];
    const result = calculateTensorDotProduct(vec1, vec2);
    expect(result).toBe(15);
  });

  it("normalizes logits using softmax", () => {
    const logits = [2.0, 1.0, 0.1];
    const probs = softmax(logits);
    const sum = probs.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });
});`
  }
];

export const INITIAL_DEVICES: SocketDevice[] = [
  {
    id: 'dev-vscode-1',
    name: 'Workstation VS Code (Antigravity Plugin)',
    deviceType: 'VS Code Extension',
    ip: '192.168.1.105',
    status: 'connected',
    pingMs: 4,
    lastSyncAt: 'Just now'
  },
  {
    id: 'dev-tablet-1',
    name: 'Galaxy Tab S9 Ultra (Display Companion)',
    deviceType: 'Android Tablet',
    ip: '192.168.1.188',
    status: 'connected',
    pingMs: 8,
    lastSyncAt: '2 mins ago'
  },
  {
    id: 'dev-macbook-1',
    name: 'MacBook Pro M3 Max (Remote Node)',
    deviceType: 'MacBook Pro',
    ip: '192.168.1.201',
    status: 'disconnected',
    pingMs: 0,
    lastSyncAt: 'Yesterday'
  }
];

export const INITIAL_TERMINAL_LOGS: TerminalLog[] = [
  {
    id: 'log-1',
    timestamp: new Date().toLocaleTimeString(),
    type: 'ollama',
    message: 'Ollama v0.3.14 (Android ARM64 / NPU Qualcomm Hexagon) started on port 11434',
    source: 'system'
  },
  {
    id: 'log-2',
    timestamp: new Date().toLocaleTimeString(),
    type: 'info',
    message: 'Loaded model deepseek-coder:6.7b-instruct-q4_K_M into VRAM (3.9 GB / 8.0 GB allocated)',
    source: 'model-runner'
  },
  {
    id: 'log-3',
    timestamp: new Date().toLocaleTimeString(),
    type: 'antigravity',
    message: 'Wi-Fi HTML Socket Server active at ws://192.168.1.142:11434/sync - 2 remote clients paired',
    source: 'socket-bridge'
  },
  {
    id: 'log-4',
    timestamp: new Date().toLocaleTimeString(),
    type: 'success',
    message: 'Voice Intent Listener initialized (WebSpeech / On-Device Whisper fallback ready)',
    source: 'voice-agent'
  }
];

export const INITIAL_PATCH_HISTORY: PatchHistoryItem[] = [
  {
    id: 'patch-001',
    workflowId: 'wf-runtime-refactor',
    workflowTitle: 'Refactor Runtime Collector to Observed-Only Model',
    agentName: 'Coder',
    targetFile: 'src/server.ts',
    patchDescription: 'Replaced hardcoded initial values with authentic live observation backend contracts and SSE snapshot endpoint.',
    diffContent: `--- a/src/server.ts
+++ b/src/server.ts
@@ -14,6 +14,12 @@
- const MOCK_TELEMETRY = { npu: 85, battery: 90 };
+ const OBSERVATION_CONTRACT = {
+   state: 'OBSERVED',
+   source: 'ollama-native-collector',
+   refreshIntervalMs: 2000
+ };
+ app.get('/api/runtime/stream', (req, res) => { ... });`,
    beforeContent: `// Legacy server mock data\nconst MOCK_TELEMETRY = { npu: 85, battery: 90 };\n`,
    afterContent: `// Runtime state observation contract\nconst OBSERVATION_CONTRACT = {\n  state: 'OBSERVED',\n  source: 'ollama-native-collector',\n  refreshIntervalMs: 2000\n};\n`,
    timestamp: new Date(Date.now() - 3600000 * 2).toLocaleString('sv-SE'),
    status: 'applied',
    linesAdded: 18,
    linesRemoved: 4,
    verificationHash: 'sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  },
  {
    id: 'patch-002',
    workflowId: 'wf-termux-hardening',
    workflowTitle: 'Termux Security Hardening & Fail-Closed Enforcement',
    agentName: 'Termux',
    targetFile: 'run_termux_node.sh',
    patchDescription: 'Added set -Eeuo pipefail shell contract and verified node target runtime syntax validation before launch.',
    diffContent: `--- a/run_termux_node.sh
+++ b/run_termux_node.sh
@@ -12,2 +12,4 @@
- set -e
+ set -Eeuo pipefail
+ IFS=$'\\n\\t'
+ trap 'die "Execution failed near line $LINENO."' ERR`,
    beforeContent: `#!/usr/bin/env bash\nset -e\n`,
    afterContent: `#!/usr/bin/env bash\nset -Eeuo pipefail\nIFS=$'\\n\\t'\ntrap 'die "Execution failed near line $LINENO."' ERR\n`,
    timestamp: new Date(Date.now() - 3600000 * 5).toLocaleString('sv-SE'),
    status: 'applied',
    linesAdded: 12,
    linesRemoved: 2,
    verificationHash: 'sha256-a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0'
  },
  {
    id: 'patch-003',
    workflowId: 'wf-litert-backend',
    workflowTitle: 'LiteRT-LM On-Device Acceleration Contract',
    agentName: 'JACO',
    targetFile: 'src/components/LiteRTMigration.tsx',
    patchDescription: 'Integrated LiteRT GPU/NPU delegates and OpenClaw fallback pipeline configuration.',
    diffContent: `--- a/src/components/LiteRTMigration.tsx
+++ b/src/components/LiteRTMigration.tsx
@@ -45,3 +45,5 @@
+ const delegate = hardwareAccel.npuAvailable ? 'HEXAGON_NPU' : 'GPU_OPENCL';
+ console.log(\`Initialized LiteRT pipeline with delegate \${delegate}\`);`,
    beforeContent: `const delegate = 'CPU';\n`,
    afterContent: `const delegate = hardwareAccel.npuAvailable ? 'HEXAGON_NPU' : 'GPU_OPENCL';\nconsole.log(\`Initialized LiteRT pipeline with delegate \${delegate}\`);\n`,
    timestamp: new Date(Date.now() - 3600000 * 12).toLocaleString('sv-SE'),
    status: 'applied',
    linesAdded: 8,
    linesRemoved: 1,
    verificationHash: 'sha256-8f3a1b2c4d5e6f7890123456789abcdef0123456789abcdef0123456789abc'
  }
];
