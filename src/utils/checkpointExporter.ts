import { CodeFile, PatchHistoryItem, TerminalLog, DeviceTelemetry, OllamaModel } from '../types';

export interface WorkspaceCheckpointData {
  version: string;
  timestamp: string;
  appVersion: string;
  metadata: {
    exportedBy: string;
    environment: string;
    activeFilePath: string;
    fileCount: number;
    totalLines: number;
    patchCount: number;
    appliedPatches: number;
    rolledBackPatches: number;
  };
  telemetry?: DeviceTelemetry;
  activeModel?: OllamaModel;
  workspace: {
    activeFilePath: string;
    files: CodeFile[];
    patchHistory: PatchHistoryItem[];
    terminalLogs: TerminalLog[];
  };
}

export function generateWorkspaceCheckpoint(
  codeFiles: CodeFile[],
  patchHistory: PatchHistoryItem[],
  activeFilePath: string,
  terminalLogs: TerminalLog[] = [],
  telemetry?: DeviceTelemetry,
  activeModel?: OllamaModel
): WorkspaceCheckpointData {
  const totalLines = codeFiles.reduce((acc, file) => {
    return acc + (file.content ? file.content.split('\n').length : 0);
  }, 0);

  const appliedPatches = patchHistory.filter(p => p.status === 'applied').length;
  const rolledBackPatches = patchHistory.filter(p => p.status === 'rolled_back').length;

  return {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    appVersion: 'JACO-OS-v2.4',
    metadata: {
      exportedBy: 'JACO AI Studio Debugger',
      environment: 'Android Termux NPU / Cloud Run Container',
      activeFilePath,
      fileCount: codeFiles.length,
      totalLines,
      patchCount: patchHistory.length,
      appliedPatches,
      rolledBackPatches,
    },
    telemetry,
    activeModel,
    workspace: {
      activeFilePath,
      files: codeFiles,
      patchHistory,
      terminalLogs: terminalLogs.slice(-50), // keep recent 50 logs for debugging
    }
  };
}

export function downloadCheckpointJSON(checkpoint: WorkspaceCheckpointData, filename?: string): string {
  const jsonString = JSON.stringify(checkpoint, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const formattedDate = new Date().toISOString().replace(/[:.]/g, '-');
  const defaultFilename = filename || `jaco-checkpoint-${formattedDate}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = defaultFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return defaultFilename;
}

export async function exportAndBackupCheckpoint(
  codeFiles: CodeFile[],
  patchHistory: PatchHistoryItem[],
  activeFilePath: string,
  terminalLogs: TerminalLog[] = [],
  telemetry?: DeviceTelemetry,
  activeModel?: OllamaModel
): Promise<{ filename: string; checkpoint: WorkspaceCheckpointData }> {
  const checkpoint = generateWorkspaceCheckpoint(
    codeFiles,
    patchHistory,
    activeFilePath,
    terminalLogs,
    telemetry,
    activeModel
  );

  const filename = downloadCheckpointJSON(checkpoint);

  // Sync to backend server for disk-backed external debugging
  try {
    await fetch('/api/workspace/checkpoint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpoint, filename }),
    });
  } catch (err) {
    console.warn('Backend checkpoint sync warning:', err);
  }

  return { filename, checkpoint };
}
