/**
 * Runs an async operation while driving a smooth progress percentage (0..100).
 * Ensures the progress indicator remains visible for at least `minDurationMs`
 * when the underlying native operation finishes very quickly, while adding
 * zero extra delay if the operation already took >= `minDurationMs`.
 */
export async function runWithMinimumProgress<T>(
  task: () => Promise<T>,
  onProgress: (percent: number) => void,
  minDurationMs = 3500
): Promise<T> {
  const start = Date.now();
  let current = 8;
  onProgress(current);

  const tickIntervalMs = 80;
  const maxPreComplete = 88;
  const stepPerTick = (maxPreComplete - current) / Math.max(1, (minDurationMs * 0.85) / tickIntervalMs);

  const timer = window.setInterval(() => {
    current = Math.min(maxPreComplete, current + stepPerTick);
    onProgress(Math.round(current));
  }, tickIntervalMs);

  let result: T;
  try {
    result = await task();
  } finally {
    window.clearInterval(timer);
  }

  const elapsed = Date.now() - start;
  const remaining = Math.max(0, minDurationMs - elapsed);

  if (remaining > 40) {
    const finishStart = Date.now();
    const startPct = current;
    await new Promise<void>((resolve) => {
      const finishTimer = window.setInterval(() => {
        const ratio = Math.min(1, (Date.now() - finishStart) / remaining);
        const pct = Math.round(startPct + (100 - startPct) * ratio);
        onProgress(pct);
        if (ratio >= 1) {
          window.clearInterval(finishTimer);
          resolve();
        }
      }, 50);
    });
  } else {
    onProgress(100);
  }

  return result;
}
