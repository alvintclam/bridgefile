import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import {
  createRateLimitedTransform,
  getTransferSpeedLimit,
  resetTransferRateLimitState,
  setTransferPaused,
  setTransferSpeedLimit,
} from '../main/protocols/transfer-rate-limit';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

test('normalizes invalid and tiny speed-limit values', () => {
  resetTransferRateLimitState();

  assert.equal(setTransferSpeedLimit(null), null);
  assert.equal(setTransferSpeedLimit(Number.NaN), null);
  assert.equal(setTransferSpeedLimit(0), null);
  assert.equal(setTransferSpeedLimit(0.05), 0.1);
  assert.equal(getTransferSpeedLimit(), 0.1);

  resetTransferRateLimitState();
});

test('holds active transfer chunks while paused and releases them after resume', async () => {
  resetTransferRateLimitState();
  setTransferPaused(true);

  const transform = createRateLimitedTransform();
  const dataPromise = once(transform, 'data');

  transform.write(Buffer.from('bridgefile'));
  await sleep(80);

  assert.equal(transform.read(), null);

  setTransferPaused(false);

  const [chunk] = await withTimeout(dataPromise, 500);
  assert.equal(Buffer.from(chunk as Uint8Array).toString('utf8'), 'bridgefile');

  transform.destroy();
  resetTransferRateLimitState();
});
