export function createAbortError(): Error {
  const error = new Error('Transfer cancelled');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || /cancelled|aborted/i.test(error.message);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function bindAbort(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (!signal) {
    return () => {};
  }

  const handler = () => {
    onAbort();
  };

  if (signal.aborted) {
    handler();
    return () => {};
  }

  signal.addEventListener('abort', handler, { once: true });
  return () => signal.removeEventListener('abort', handler);
}
