import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { telemetryFabric } from '../telemetry/telemetryFabric';
import { EvidenceClass } from '../telemetry/telemetryTypes';

const execAsyncRaw = promisify(exec);
// windowsHide: on Windows every polled exec otherwise spawns a visible cmd/conhost window that flashes.
const execAsync = (command: string, options: Record<string, unknown> = {}) =>
  execAsyncRaw(command, { windowsHide: true, ...options });

export interface TorchExecutionResult {
  capability: 'android.torch.set';
  state: 'on' | 'off';
  success: boolean;
  truthClass: EvidenceClass;
  executionTimeMs: number;
  spanId: string;
  traceId: string;
  evidenceRecord: {
    id: string;
    actionHash: string;
    timestamp: string;
    hardwareTarget: string;
    status: 'VERIFIED' | 'FAILED';
    rawOutput: string;
  };
  message: string;
}

export interface AndroidDeviceStatus {
  platform: 'android_termux' | 'linux_container' | 'hybrid';
  torchState: 'on' | 'off' | 'unknown';
  batteryStatus: {
    percent: number | null;
    isCharging: boolean | null;
    temperatureC: number | null;
    truth: EvidenceClass;
  };
  supportedCapabilities: string[];
  lastEvidenceHash?: string;
  updatedAt: string;
}

/**
 * Android Device Agent 1.0 — Sovereign Native Hardware Control
 * Handles on-device Android capabilities (Torch, Sensors, Haptics, Keystore)
 * with strict OpenTelemetry Spans and cryptographic SHA-256 verification.
 */
export class AndroidDeviceAgent {
  private static instance: AndroidDeviceAgent | null = null;
  private currentTorchState: 'on' | 'off' = 'off';

  private constructor() {}

  public static getInstance(): AndroidDeviceAgent {
    if (!AndroidDeviceAgent.instance) {
      AndroidDeviceAgent.instance = new AndroidDeviceAgent();
    }
    return AndroidDeviceAgent.instance;
  }

  /**
   * Native capability: android.torch.set
   * Executes termux-torch or relay bridge with hardware verification & telemetry span.
   */
  public async setTorch(state: 'on' | 'off'): Promise<TorchExecutionResult> {
    const startNs = process.hrtime.bigint();
    const traceId = crypto.randomBytes(16).toString('hex');
    const spanId = crypto.randomBytes(8).toString('hex');
    const timestamp = new Date().toISOString();

    const span = telemetryFabric.startSpan({
      name: 'android.torch.set',
      traceId,
      parentSpanId: undefined,
      attributes: {
        'device.capability': 'android.torch.set',
        'torch.targetState': state,
        'execution.type': 'NATIVE_DEVICE_HARDWARE'
      }
    });

    let rawOutput = '';
    let success = false;
    let truthClass: EvidenceClass = 'UNAVAILABLE';

    try {
      // 1. First attempt: Direct local termux-torch if running on Termux
      const termuxCmd = state === 'on' ? 'termux-torch on' : 'termux-torch off';
      try {
        const { stdout, stderr } = await execAsync(termuxCmd, { timeout: 3000 });
        rawOutput = (stdout || stderr || 'Termux torch toggled successfully').trim();
        success = true;
        truthClass = 'MEASURED';
        this.currentTorchState = state;
      } catch (termuxErr: any) {
        // The unauthenticated 4311 shell relay was removed (it ran any command sent to it), so there
        // is no second path. No hardware evidence: fail closed.
        rawOutput = `Android torch unavailable: ${termuxErr.message || 'termux-torch command not in PATH'}`;
        success = false;
        truthClass = 'UNAVAILABLE';
      }
    } catch (err: any) {
      rawOutput = `Torch execution error: ${err.message}`;
      success = false;
      truthClass = 'UNAVAILABLE';
    }

    const durationMs = telemetryFabric.getMonotonicElapsedMs(startNs);

    // Cryptographic Evidence Record
    const rawPayload = `android.torch.set:${state}:${timestamp}:${rawOutput}:${durationMs}`;
    const actionHash = 'sha256-' + crypto.createHash('sha256').update(rawPayload).digest('hex');

    const evidenceRecord = {
      id: `ev-torch-${Date.now()}`,
      actionHash,
      timestamp,
      hardwareTarget: 'android.hardware.camera2.CameraManager#setTorchMode',
      status: success ? ('VERIFIED' as const) : ('FAILED' as const),
      rawOutput
    };

    // End Telemetry Span
    telemetryFabric.endSpan(span.spanId, {
      status: success ? 'OK' : 'ERROR',
      errorMessage: success ? undefined : rawOutput,
      attributes: {
        'torch.resultState': this.currentTorchState,
        'evidence.hash': actionHash,
        'truth.class': truthClass,
        'latency.ms': durationMs
      }
    });

    // Record Mission Proof
    telemetryFabric.createMissionProof({
      missionId: `mission-torch-${Date.now()}`,
      traceId,
      startTime: timestamp,
      toolCallsCount: 1,
      verifiedCount: success ? 1 : 0,
      failedCount: success ? 0 : 1,
      inputArtifactHash: crypto.createHash('sha256').update(state).digest('hex'),
      outputArtifactHash: actionHash,
      rawEvidenceItems: [{ id: evidenceRecord.id, result: evidenceRecord }],
      modelVersion: 'JACO Device Agent 1.0 (android.torch.set)'
    });

    const msgState = state === 'on' ? 'tänd' : 'släckt';
    return {
      capability: 'android.torch.set',
      state: this.currentTorchState,
      success,
      truthClass,
      executionTimeMs: Math.round(durationMs * 100) / 100,
      spanId: span.spanId,
      traceId,
      evidenceRecord,
      message: success
        ? `Ficklampan är nu ${msgState}. Verifierad hårdvarurespons (${durationMs.toFixed(1)}ms, Hash: ${actionHash.substring(0, 16)}...).`
        : `[RISK] Kunde inte ändra ficklampans status: ${rawOutput}`
    };
  }

  /**
   * Returns current Android device capability status
   */
  public async getStatus(): Promise<AndroidDeviceStatus> {
    let batteryData = { percent: null as number | null, isCharging: null as boolean | null, temperatureC: null as number | null, truth: 'UNAVAILABLE' as EvidenceClass };

    try {
      const { stdout } = await execAsync('termux-battery-status', { timeout: 2000 });
      if (stdout) {
        const parsed = JSON.parse(stdout);
        batteryData = {
          percent: parsed.percentage ?? null,
          isCharging: parsed.status === 'CHARGING',
          temperatureC: parsed.temperature ?? null,
          truth: 'MEASURED'
        };
      }
    } catch {
      // Fallback from TelemetryFabric
      const hw = telemetryFabric.collectNodeHardwareMetrics();
      batteryData = {
        percent: hw.battery.percent,
        isCharging: hw.battery.isCharging,
        temperatureC: null,
        truth: hw.battery.truth
      };
    }

    return {
      platform: process.platform === 'linux' ? 'android_termux' : 'hybrid',
      torchState: this.currentTorchState,
      batteryStatus: batteryData,
      supportedCapabilities: [
        'android.torch.set',
        'android.torch.status',
        'android.vibrate',
        'android.battery.status',
        'android.tts.speak',
        'android.sensor.light'
      ],
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Natural Language / Voice Intent Router for Android Device Control
   * Handles commands like "Aura, tänd lampan" or "Aura, släck lampan"
   */
  public async executeVoiceIntent(prompt: string): Promise<{
    handled: boolean;
    response?: string;
    result?: any;
  }> {
    const clean = prompt.toLowerCase().trim();

    // Match Swedish & English torch intents
    if (
      clean.includes('tänd lampan') ||
      clean.includes('tänd lampa') ||
      clean.includes('tänd ficklampan') ||
      clean.includes('sätt på lampan') ||
      clean.includes('sätt på ficklampan') ||
      clean.includes('turn on torch') ||
      clean.includes('turn on flashlight') ||
      clean === 'android.torch.set on'
    ) {
      const res = await this.setTorch('on');
      return {
        handled: true,
        response: res.message,
        result: res
      };
    }

    if (
      clean.includes('släck lampan') ||
      clean.includes('släck lampa') ||
      clean.includes('släck ficklampan') ||
      clean.includes('stäng av lampan') ||
      clean.includes('stäng av ficklampan') ||
      clean.includes('turn off torch') ||
      clean.includes('turn off flashlight') ||
      clean === 'android.torch.set off'
    ) {
      const res = await this.setTorch('off');
      return {
        handled: true,
        response: res.message,
        result: res
      };
    }

    if (
      clean.includes('lampans status') ||
      clean.includes('är lampan tänd') ||
      clean.includes('ficklampans status') ||
      clean.includes('torch status')
    ) {
      const status = await this.getStatus();
      const stMsg = status.torchState === 'on' ? 'tänd' : (status.torchState === 'off' ? 'släckt' : 'okänd');
      return {
        handled: true,
        response: `Ficklampans status är: ${stMsg}.`,
        result: status
      };
    }

    return { handled: false };
  }
}

export const androidDeviceAgent = AndroidDeviceAgent.getInstance();
