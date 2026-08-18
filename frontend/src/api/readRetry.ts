export const SAFE_READ_MAX_ATTEMPTS = 3;

const TRANSIENT_READ_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function isSafeReadMethod(method: string | undefined): boolean {
  const normalized = (method || 'get').toLowerCase();
  return normalized === 'get' || normalized === 'head';
}

export function isTransientReadFailure(
  method: string | undefined,
  status: number | undefined,
): boolean {
  return isSafeReadMethod(method)
    && (status === undefined || TRANSIENT_READ_STATUSES.has(status));
}

export async function waitForSafeReadRetry(completedAttempts: number): Promise<void> {
  const delayMs = Math.min(400, 75 * Math.max(1, completedAttempts));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
