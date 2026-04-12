import { Transform } from 'stream';
import { createAbortError } from './transfer-abort';

const BYTES_PER_MEGABYTE = 1024 * 1024;

let speedLimitMbps: number | null = null;
let transferPaused = false;
let nextAvailableAt = Date.now();
let scheduleChain: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scheduleChunk(bytes: number, isCancelled: () => boolean): Promise<void> {
  while (true) {
    if (isCancelled()) {
      throw createAbortError();
    }

    if (transferPaused) {
      await sleep(50);
      continue;
    }

    const limitMbps = speedLimitMbps;
    if (!limitMbps || limitMbps <= 0 || bytes <= 0) {
      return;
    }

    const bytesPerSecond = limitMbps * BYTES_PER_MEGABYTE;
    const startAt = Math.max(Date.now(), nextAvailableAt);
    const delayMs = startAt - Date.now();

    if (delayMs > 50) {
      await sleep(50);
      continue;
    }

    if (delayMs > 1) {
      await sleep(delayMs);
      continue;
    }

    nextAvailableAt = Date.now() + (bytes / bytesPerSecond) * 1000;
    return;
  }
}

export function setTransferSpeedLimit(limitMbps: number | null): number | null {
  if (limitMbps == null || !Number.isFinite(limitMbps) || limitMbps <= 0) {
    speedLimitMbps = null;
  } else {
    speedLimitMbps = Math.max(0.1, limitMbps);
  }

  nextAvailableAt = Date.now();
  return speedLimitMbps;
}

export function setTransferPaused(paused: boolean): boolean {
  transferPaused = paused;
  if (!paused) {
    nextAvailableAt = Date.now();
  }
  return transferPaused;
}

export function getTransferSpeedLimit(): number | null {
  return speedLimitMbps;
}

export function resetTransferRateLimitState(): void {
  speedLimitMbps = null;
  transferPaused = false;
  nextAvailableAt = Date.now();
  scheduleChain = Promise.resolve();
}

export function createRateLimitedTransform(
  onChunk?: (chunkBytes: number) => void,
): Transform {
  return new Transform({
    transform(chunk, _encoding, callback) {
      const chunkBytes = Buffer.isBuffer(chunk)
        ? chunk.length
        : Buffer.byteLength(String(chunk));

      const scheduled = scheduleChain.then(async () => {
        await scheduleChunk(chunkBytes, () => this.destroyed);
      });

      scheduleChain = scheduled.catch(() => {});

      scheduled
        .then(() => {
          onChunk?.(chunkBytes);
          callback(null, chunk);
        })
        .catch((error) => {
          callback(error as Error);
        });
    },
  });
}
