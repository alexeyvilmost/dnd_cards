const STALE_BUNDLE_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
  /chunkloaderror/i,
  /loading chunk .+ failed/i,
];

const RECOVERY_MARKER_KEY = 'boh:stale-bundle-recovery';
const RECOVERY_QUERY_KEY = '__boh_reload';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : '';
}

export function isStaleClientBundleError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.length > 0 && STALE_BUNDLE_PATTERNS.some((pattern) => pattern.test(message));
}

export function staleBundleRecoveryUrl(href: string, cacheKey: string | number): string {
  const url = new URL(href);
  url.searchParams.set(RECOVERY_QUERY_KEY, String(cacheKey));
  return url.toString();
}

/**
 * A cached index can still reference a route chunk removed by an atomic
 * deployment. Reload the same route with a unique navigation URL once, which
 * makes the service worker check and serve the current application shell.
 */
export function recoverFromStaleClientBundle(
  error: unknown,
  { force = false }: { force?: boolean } = {},
): boolean {
  if (!isStaleClientBundleError(error) || typeof window === 'undefined') return false;
  const currentUrl = new URL(window.location.href);
  if (!force && currentUrl.searchParams.has(RECOVERY_QUERY_KEY)) return false;
  const marker = errorMessage(error);
  try {
    if (!force && window.sessionStorage.getItem(RECOVERY_MARKER_KEY) === marker) return false;
    window.sessionStorage.setItem(RECOVERY_MARKER_KEY, marker);
  } catch {
    // Storage can be disabled. The unique URL still makes the recovery useful.
  }
  window.location.replace(staleBundleRecoveryUrl(currentUrl.toString(), Date.now()));
  return true;
}
