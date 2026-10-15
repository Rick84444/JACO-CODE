import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { JobRecord, JobStatus, JobType, EnqueueOptions } from './jobTypes';

// In-Memory map med asynkron fil-persistens till .jaco/job_queue.json
// Detta ger blixtsnabb access och noll C++ kompileringsberoenden (fungerar direkt i alla miljöer: Node, Bun, Cloud Run och Termux).

const STORAGE_DIR = path.join(process.cwd(), '.jaco');
const STORAGE_FILE = path.join(STORAGE_DIR, 'job_queue.json');

const jobs = new Map<string, JobRecord>();
let isInitialized = false;

function tryRecoverCorruptedJson(raw: string): JobRecord[] | null {
  let lastClose = raw.lastIndexOf('  }');
  if (lastClose === -1) {
    lastClose = raw.lastIndexOf('}');
  }
  while (lastClose > 0) {
    const candidate = raw.slice(0, lastClose + 1) + '\n]';
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      lastClose = raw.lastIndexOf('}', lastClose - 1);
    }
  }
  return null;
}

function ensureStorage(): void {
  if (isInitialized) return;
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }
    if (fs.existsSync(STORAGE_FILE)) {
      const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
      if (raw.trim()) {
        try {
          const list: JobRecord[] = JSON.parse(raw);
          jobs.clear();
          for (const job of list) {
            if (job && job.id) {
              jobs.set(job.id, job);
            }
          }
        } catch (parseErr) {
          console.warn('[JobQueue] Parse warning, attempting recovery:', parseErr);
          const recovered = tryRecoverCorruptedJson(raw);
          if (recovered && recovered.length > 0) {
            console.log(`[JobQueue] Successfully recovered ${recovered.length} jobs from corrupted storage file.`);
            jobs.clear();
            for (const job of recovered) {
              if (job && job.id) {
                jobs.set(job.id, job);
              }
            }
            persist();
          } else {
            console.error('[JobQueue] Could not recover corrupted JSON, backing up and resetting queue.');
            const backupFile = path.join(STORAGE_DIR, `job_queue.corrupt.${Date.now()}.json`);
            try {
              fs.writeFileSync(backupFile, raw, 'utf-8');
            } catch {}
            jobs.clear();
            persist();
          }
        }
      }
    }
    isInitialized = true;
  } catch (err) {
    console.error('[JobQueue] Init error:', err);
    isInitialized = true;
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORAGE_DIR)) {
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
    }

    // Prune finished jobs if history exceeds 200 items to prevent unbounded file growth
    const activeJobs: JobRecord[] = [];
    const finishedJobs: JobRecord[] = [];

    for (const job of jobs.values()) {
      if (
        job.status === 'queued' ||
        job.status === 'running' ||
        job.status === 'claimed' ||
        job.status === 'awaiting_approval'
      ) {
        activeJobs.push(job);
      } else {
        finishedJobs.push(job);
      }
    }

    if (finishedJobs.length > 200) {
      finishedJobs.sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime()
      );
      const prunedFinished = finishedJobs.slice(0, 200);

      jobs.clear();
      for (const j of activeJobs) jobs.set(j.id, j);
      for (const j of prunedFinished) jobs.set(j.id, j);
    }

    const list = Array.from(jobs.values());
    const tempFile = `${STORAGE_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(list, null, 2), 'utf-8');
    fs.renameSync(tempFile, STORAGE_FILE);
  } catch (err) {
    console.error('[JobQueue] Persist error:', err);
  }
}

export function enqueue<TPayload = any>(options: EnqueueOptions<TPayload>): JobRecord<TPayload> {
  ensureStorage();

  const id = `job_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date().toISOString();

  const isApprovalRequired = options.requiresApproval ?? (options.riskLevel === 'HIGH' || options.riskLevel === 'CRITICAL');

  const initialStatus: JobStatus = isApprovalRequired ? 'awaiting_approval' : 'queued';

  const job: JobRecord<TPayload> = {
    id,
    type: options.type,
    status: initialStatus,
    priority: options.priority ?? 50,
    payload: options.payload,
    policy: {
      requiresOperatorApproval: isApprovalRequired,
      governanceCategory: options.governanceCategory ?? 'filesystem',
      riskLevel: options.riskLevel ?? 'LOW',
      description: options.description ?? `${options.type} operation`
    },
    retryCount: 0,
    maxRetries: options.maxRetries ?? 3,
    createdAt: now,
    updatedAt: now
  };

  jobs.set(id, job);
  persist();
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  ensureStorage();
  return jobs.get(id);
}

export function listJobs(filter?: { status?: JobStatus; type?: JobType }): JobRecord[] {
  ensureStorage();
  let list = Array.from(jobs.values());

  if (filter?.status) {
    list = list.filter((j) => j.status === filter.status);
  }
  if (filter?.type) {
    list = list.filter((j) => j.type === filter.type);
  }

  // Sortera efter prioritet (högst först), därefter datum
  return list.sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

export function listByStatus(status: JobStatus): JobRecord[] {
  return listJobs({ status });
}

export function claimNext(workerId: string, supportedTypes?: JobType[]): JobRecord | undefined {
  ensureStorage();
  const queuedJobs = listJobs({ status: 'queued' });

  const candidate = queuedJobs.find((j) => {
    if (!supportedTypes || supportedTypes.length === 0) return true;
    return supportedTypes.includes(j.type);
  });

  if (!candidate) return undefined;

  const now = new Date().toISOString();
  candidate.status = 'claimed';
  candidate.workerId = workerId;
  candidate.claimedAt = now;
  candidate.updatedAt = now;

  jobs.set(candidate.id, candidate);
  persist();
  return candidate;
}

export function markRunning(id: string): JobRecord | undefined {
  ensureStorage();
  const job = jobs.get(id);
  if (!job) return undefined;

  const now = new Date().toISOString();
  job.status = 'running';
  job.startedAt = now;
  job.updatedAt = now;

  jobs.set(id, job);
  persist();
  return job;
}

export function markCompleted<TResult = any>(id: string, result?: TResult): JobRecord | undefined {
  ensureStorage();
  const job = jobs.get(id);
  if (!job) return undefined;

  const now = new Date().toISOString();
  job.status = 'completed';
  job.result = result;
  job.finishedAt = now;
  job.updatedAt = now;

  jobs.set(id, job);
  persist();
  return job;
}

export function markFailed(id: string, error: string): JobRecord | undefined {
  ensureStorage();
  const job = jobs.get(id);
  if (!job) return undefined;

  const now = new Date().toISOString();
  job.retryCount += 1;

  if (job.retryCount < job.maxRetries) {
    // Försök igen: återgå till 'queued'
    job.status = 'queued';
    job.error = `[Attempt ${job.retryCount}/${job.maxRetries} Failed]: ${error}`;
  } else {
    job.status = 'failed';
    job.error = error;
    job.finishedAt = now;
  }

  job.updatedAt = now;
  jobs.set(id, job);
  persist();
  return job;
}

export function approve(id: string, operatorName: string = 'Operator'): JobRecord | undefined {
  ensureStorage();
  const job = jobs.get(id);
  if (!job || job.status !== 'awaiting_approval') return undefined;

  const now = new Date().toISOString();
  job.status = 'queued';
  job.approvedBy = operatorName;
  job.updatedAt = now;

  jobs.set(id, job);
  persist();
  return job;
}

export function reject(id: string, reason: string = 'Rejected by operator'): JobRecord | undefined {
  ensureStorage();
  const job = jobs.get(id);
  if (!job || job.status !== 'awaiting_approval') return undefined;

  const now = new Date().toISOString();
  job.status = 'rejected';
  job.rejectedReason = reason;
  job.finishedAt = now;
  job.updatedAt = now;

  jobs.set(id, job);
  persist();
  return job;
}

export function clearQueue(): void {
  jobs.clear();
  persist();
}
