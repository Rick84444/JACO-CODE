import { OllamaModel, DeviceTelemetry, CodeFile, SocketDevice, TerminalLog, PatchHistoryItem } from './types';

// Startup state is deliberately evidence-empty. The UI hydrates these values from
// runtime APIs; unavailable sensors/models must never be represented as observed.
export const INITIAL_MODELS: OllamaModel[] = [];
export const INITIAL_CODE_FILES: CodeFile[] = [];
export const INITIAL_DEVICES: SocketDevice[] = [];
export const INITIAL_TERMINAL_LOGS: TerminalLog[] = [];
export const INITIAL_PATCH_HISTORY: PatchHistoryItem[] = [];
export const INITIAL_TELEMETRY: DeviceTelemetry = {
  batteryLevel: 0,
  batteryStatus: 'discharging',
  batteryPercent: 0,
  isCharging: false,
  npuUsagePercent: 0,
  npuLoad: 0,
  npuHardwareType: 'Emulated/Unavailable',
  npuFrequencyMhz: 0,
  npuLoadState: 'UNAVAILABLE',
  cpuUsagePercent: 0,
  ramUsedGb: 0,
  ramTotalGb: 0,
  vramUsedGb: 0,
  vramTotalGb: 0,
  temperatureC: 0,
  thermalTempC: 0,
  connectionType: 'Localhost',
  localIp: '127.0.0.1',
  socketPort: 3000,
  isOfflineMode: true,
  activeServiceStatus: 'On-Device Private Mode',
  truth: 'UNAVAILABLE',
  hardwareTruth: { cpu:'UNAVAILABLE', ram:'UNAVAILABLE', npu:'UNAVAILABLE', battery:'UNAVAILABLE', thermal:'UNAVAILABLE' }
};
