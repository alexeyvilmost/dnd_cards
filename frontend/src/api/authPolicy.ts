const PUBLIC_CATALOG_ROOTS = new Set([
  'actions',
  'backgrounds',
  'cards',
  'classes',
  'concepts',
  'content-images',
  'effects',
  'feats',
  'monsters',
  'races',
  'resources',
  'spells',
  'variables',
]);

function apiRoot(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const pathname = new URL(url, 'https://bagofholding.invalid').pathname;
    const match = pathname.match(/^\/api\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function apiPath(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url, 'https://bagofholding.invalid').pathname;
  } catch {
    return null;
  }
}

/** Public catalog GETs must remain anonymous even in an authenticated UI. */
export function shouldAttachAuthToken(method: string | undefined, url: string | undefined): boolean {
  const normalizedMethod = (method ?? 'get').toLowerCase();
  if (normalizedMethod !== 'get' && normalizedMethod !== 'head') return true;
  const path = apiPath(url);
  if (path?.startsWith('/api/integrations/ttg/bestiary/')) return false;
  const root = apiRoot(url);
  return root == null || !PUBLIC_CATALOG_ROOTS.has(root);
}
