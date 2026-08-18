import {
  SAFE_READ_MAX_ATTEMPTS,
  waitForSafeReadRetry,
} from '../api/readRetry';

type LiveJsonReadOptions = {
  label?: string;
  timeoutMs?: number;
};

/**
 * Reads JSON from the live API with a bounded retry for a truncated 2xx body.
 * Transport/status retries remain the responsibility of the shared fetch
 * wrapper; this helper only covers failures which surface while consuming the
 * response stream or parsing its JSON payload.
 */
export async function readLiveJson<T>(
  url: string,
  options: LiveJsonReadOptions = {},
): Promise<T> {
  const label = options.label ?? url;
  const timeoutMs = options.timeoutMs ?? 15_000;
  let lastError: unknown;

  for (let attempt = 1; attempt <= SAFE_READ_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);

    try {
      return await response.json() as T;
    } catch (error) {
      lastError = error;
      if (attempt >= SAFE_READ_MAX_ATTEMPTS) break;
      await waitForSafeReadRetry(attempt);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${label}: invalid JSON after ${SAFE_READ_MAX_ATTEMPTS} attempts: ${detail}`,
  );
}
