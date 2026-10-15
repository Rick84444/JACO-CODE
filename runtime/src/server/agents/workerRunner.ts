import { claimNext, markRunning, markCompleted, markFailed } from '../queue/jobQueue';
import { JobRecord, JobType } from '../queue/jobTypes';
import { runCodeRefactor } from './workers/codeRefactorWorker';
import { runQualityAudit } from './workers/qualityAuditorWorker';
import { runGitOps } from './workers/gitOpsWorker';
import { generateOnDevice } from '../modelPool/providers/litertProvider';

let isRunnerActive = false;
let pollingInterval: NodeJS.Timeout | null = null;

const SUPPORTED_TYPES: JobType[] = [
  'code_refactor',
  'quality_audit',
  'git_ops',
  'npu_inference',
  'model_benchmark',
  'system_patch'
];

export async function processSingleJob(job: JobRecord): Promise<any> {
  markRunning(job.id);

  try {
    let result: any = null;

    switch (job.type) {
      case 'code_refactor':
        result = await runCodeRefactor(job.payload);
        break;

      case 'quality_audit':
        result = await runQualityAudit(job.payload);
        break;

      case 'git_ops':
        result = await runGitOps(job.payload);
        break;

      case 'npu_inference':
        result = await generateOnDevice(job.payload?.prompt || 'System Health Check');
        // No completion means nothing ran; the job must not be recorded as completed.
        if (!result) throw new Error('LITERT_UNAVAILABLE');
        break;

      default:
        throw new Error(`UNSUPPORTED_JOB_TYPE:${job.type}`);
    }

    markCompleted(job.id, result);
    return result;
  } catch (err: any) {
    const errorMsg = err?.message || 'Oväntat körningsfel i worker';
    markFailed(job.id, errorMsg);
    throw err;
  }
}

// Deprecated polling methods for Termux phantom process compatibility
export function startWorkerLoop(workerId: string = 'worker_main', intervalMs: number = 1000): void {
  console.warn('[WorkerRunner] startWorkerLoop is deprecated. Migration to Android 17 AppFunctions (Push-model) active.');
  isRunnerActive = false; // Intentionally disabled to prevent phantom process killer
}

export function stopWorkerLoop(): void {
  isRunnerActive = false;
}

export function isWorkerRunning(): boolean {
  return isRunnerActive;
}
