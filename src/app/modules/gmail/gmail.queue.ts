// src/app/modules/gmail/gmail.queue.ts
type Job = () => Promise<void>;

const jobQueue: Job[] = [];
let isProcessing = false;
let stopRequested = false;

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;

  while (jobQueue.length > 0) {
    if (stopRequested) {
      console.log('[Queue] Stop requested — draining queue');
      jobQueue.length = 0;
      break;
    }

    const job = jobQueue.shift();
    if (job) {
      try {
        await job();
      } catch (err) {
        console.error('[Queue] Job failed:', err);
      }
    }
  }

  isProcessing = false;
  stopRequested = false;
  console.log('[Queue] Queue empty');
}

export function enqueueJob(job: Job) {
  stopRequested = false; // reset on new job
  jobQueue.push(job);
  setImmediate(() => processQueue());
}

/**
 * Signal the queue to stop after the currently-running job finishes.
 * Pending jobs are dropped. The running job (a full provider scan) will
 * complete its current email then check isStopped() before the next one.
 */
export function cancelCurrentJob() {
  console.log('[Queue] cancelCurrentJob called');
  stopRequested = true;
}

/** Checked by the scan worker inside its per-email loop */
export function isStopped(): boolean {
  return stopRequested;
}