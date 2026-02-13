type Job = () => Promise<void>;

const jobQueue: Job[] = [];
let isProcessing = false;

async function processQueue() {
  console.log('[Queue] processQueue called');

  if (isProcessing) {
    console.log('[Queue] Already processing, exiting');
    return;
  }

  isProcessing = true;

  while (jobQueue.length > 0) {
    console.log('[Queue] Jobs in queue:', jobQueue.length);

    const job = jobQueue.shift();
    if (job) {
      try {
        console.log('[Queue] Executing job');
        await job();
        console.log('[Queue] Job finished');
      } catch (err) {
        console.error('[Queue] Job failed:', err);
      }
    }
  }

  isProcessing = false;
  console.log('[Queue] Queue empty');
}

export function enqueueJob(job: Job) {
  console.log('[Queue] enqueueJob called');

  jobQueue.push(job);

  setImmediate(() => {
    console.log('[Queue] setImmediate fired');
    processQueue();
  });
}
