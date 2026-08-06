export const LIVE_PRODUCTION_ORIGINS = {
  frontend: 'https://bagofholding.up.railway.app',
  backend: 'https://backend-production-41c3.up.railway.app',
} as const;

export type LiveCanaryTarget = keyof typeof LIVE_PRODUCTION_ORIGINS;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function parseURL(value: string, label: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
}

/**
 * Resolve a mutation target without accepting a look-alike Railway host or a
 * URL that embeds credentials/data in components which are irrelevant to an
 * origin. Production canaries are pinned to our two deployed services;
 * explicit loopback origins remain available for rehearsing the spec locally.
 */
export function requiredLiveCanaryOrigin(
  environmentName: string,
  target: LiveCanaryTarget,
): string {
  const raw = process.env[environmentName]?.trim();
  if (!raw) throw new Error(`${environmentName} is required for the live browser canary`);

  const parsed = parseURL(raw, environmentName);
  if (parsed.username || parsed.password) {
    throw new Error(`${environmentName} must not contain URL userinfo`);
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(`${environmentName} must contain an origin only (no path, query, or fragment)`);
  }

  const loopback = LOOPBACK_HOSTS.has(parsed.hostname);
  if (loopback) {
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`${environmentName} loopback target must use HTTP or HTTPS`);
    }
    return parsed.origin;
  }

  const expected = LIVE_PRODUCTION_ORIGINS[target];
  if (parsed.protocol !== 'https:' || parsed.origin !== expected) {
    throw new Error(`${environmentName} must be exactly ${expected}, or an explicit loopback origin`);
  }
  return expected;
}

/** Assert the final response URL too, so redirects cannot escape the pin. */
export function assertLiveCanaryRequestOrigin(
  actualURL: string,
  expectedOrigin: string,
  label: string,
): void {
  const parsed = parseURL(actualURL, label);
  if (parsed.origin !== expectedOrigin) {
    throw new Error(`${label} reached unexpected origin ${parsed.origin}`);
  }
}
