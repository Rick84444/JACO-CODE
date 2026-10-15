import { listJobs, markFailed } from './jobQueue.js';

/**
 * Stale-lease reaper for the hands-off work queue.
 *
 * `claimNext()` moves a job to `claimed` and stamps `claimedAt`, but nothing ever
 * un-claims it. If a worker dies, the runtime restarts, or the process is killed
 * mid-job — the ordinary case on Termux and on a free-tier host that sleeps — the
 * job stays `claimed` forever. `claimNext` only looks at `queued`, so that job is
 * never retried and never fails: it silently disappears from the loop.
 *
 * For a system whose whole promise is hands-off operation, a work item that stalls
 * without surfacing is the worst failure mode, because the dashboard still shows a
 * healthy queue. This reaper gives every claim a lease. When the lease expires the
 * job goes back through `markFailed`, which honours the existing retry budget and
 * marks the job failed once the budget is spent — so a poison job cannot loop.
 */

export interface ReaperOptions {
  leaseMs: number;
  intervalMs: number;
  onReclaim?: (job: { id: string; type: string; ageMs: number }) => void;
}

export const DEFAULT_REAPER_OPTIONS: ReaperOptions = {
  leaseMs: 10 * 60_000,
  intervalMs: 60_000,
};

let timer: NodeJS.Timeout | null = null;

export interface ReapResult {
  inspected: number;
  reclaimed: Array<{ id: string; type: string; ageMs: number }>;
}

/** One reaper pass. Exported so the verification suite can drive it deterministically. */
export function reapStaleJobs(options: Partial<ReaperOptions> = {}): ReapResult {
  const effective = { ...DEFAULT_REAPER_OPTIONS, ...options };
  const now = Date.now();
  const reclaimed: ReapResult['reclaimed'] = [];

  const inFlight = [...listJobs({ status: 'claimed' }), ...listJobs({ status: 'running' })];

  for (const job of inFlight) {
    const startedIso = job.startedAt || job.claimedAt || job.updatedAt || job.createdAt;
    const started = Date.parse(String(startedIso));
    if (!Number.isFinite(started)) continue;

    const ageMs = now - started;
    if (ageMs < effective.leaseMs) continue;

    markFailed(
      job.id,
      `lease expired: no worker progress for ${Math.round(ageMs / 1000)}s (limit ${Math.round(effective.leaseMs / 1000)}s). Job returned to the queue by the reaper.`,
    );
    const entry = { id: job.id, type: String(job.type), ageMs };
    reclaimed.push(entry);
    effective.onReclaim?.(entry);
  }

  return { inspected: inFlight.length, reclaimed };
}

export function startJobReaper(options: Partial<ReaperOptions> = {}): void {
  if (timer) return;
  const effective = { ...DEFAULT_REAPER_OPTIONS, ...options };
  timer = setInterval(() => {
    try {
      const result = reapStaleJobs(effective);
      if (result.reclaimed.length > 0) {
        console.warn(`[JACO] job reaper returned ${result.reclaimed.length} stalled job(s) to the queue`);
      }
    } catch (error) {
      console.error('[JACO] job reaper pass failed', error);
    }
  }, effective.intervalMs);
  timer.unref?.();
}

export function stopJobReaper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
