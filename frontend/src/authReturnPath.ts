interface RouterLocationLike {
  pathname?: unknown;
  search?: unknown;
  hash?: unknown;
}

/** Preserve an internal ProtectedRoute destination, including invite fragment,
 * without accepting protocol-relative or otherwise external redirects. */
export function authenticatedReturnPath(state: unknown): string {
  const from = (state && typeof state === 'object' ? (state as { from?: RouterLocationLike }).from : undefined);
  const pathname = typeof from?.pathname === 'string' ? from.pathname : '';
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\')) return '/';
  const search = typeof from?.search === 'string' && from.search.startsWith('?') ? from.search : '';
  const hash = typeof from?.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';
  return `${pathname}${search}${hash}`;
}
