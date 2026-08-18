import {
  isTransientReadFailure,
  SAFE_READ_MAX_ATTEMPTS,
  waitForSafeReadRetry,
} from '../api/readRetry';

type MarkedFetch = typeof fetch & { __dndMvpSafeReadRetry?: true };

const currentFetch = globalThis.fetch as MarkedFetch;

// setupFiles may be evaluated for every isolated test file in one worker.
// Mark the wrapper so retries never multiply through accidental re-wrapping.
if (!currentFetch.__dndMvpSafeReadRetry) {
  const nativeFetch = currentFetch.bind(globalThis);
  const retryingFetch: MarkedFetch = async (input, init) => {
    const inputMethod = typeof input === 'object' && input !== null && 'method' in input
      ? String(input.method)
      : undefined;
    const method = init?.method ?? inputMethod ?? 'GET';

    for (let attempt = 1; attempt <= SAFE_READ_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await nativeFetch(input, init);
        if (attempt >= SAFE_READ_MAX_ATTEMPTS
          || !isTransientReadFailure(method, response.status)) return response;
        await response.body?.cancel().catch(() => undefined);
      } catch (error) {
        if (attempt >= SAFE_READ_MAX_ATTEMPTS
          || !isTransientReadFailure(method, undefined)) throw error;
      }
      await waitForSafeReadRetry(attempt);
    }

    throw new Error('safe read retry loop exhausted without a response');
  };
  Object.defineProperty(retryingFetch, '__dndMvpSafeReadRetry', { value: true });
  globalThis.fetch = retryingFetch;
}
