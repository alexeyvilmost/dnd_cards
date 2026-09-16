type PageLocation = {pathname: string; search: string; hash: string};
const LOCAL_ORIGIN = 'https://local.invalid';

/** Only an internal, non-shop page can be a return destination. */
export function shopReturnTo(value: string | null): string | undefined {
  if (!value || !value.startsWith('/') || value.startsWith('//')
    || value.includes('\\') || [...value].some(character => character.charCodeAt(0) <= 32)) return undefined;
  try {
    const url = new URL(value, LOCAL_ORIGIN);
    const pathname = decodeURIComponent(url.pathname);
    if (url.origin !== LOCAL_ORIGIN || pathname.startsWith('//') || pathname.includes('\\')
      || /^\/shop(?:\/|$)/i.test(pathname)) return undefined;
    return url.pathname + url.search + url.hash;
  } catch { return undefined; }
}

/** Carry the original page through shop setup, filters and reloads. */
export function shopURLFromPage(destination: string, location: PageLocation): string {
  const from = /^\/shop(?:\/|$)/.test(location.pathname)
    ? shopReturnTo(new URLSearchParams(location.search).get('returnTo'))
    : shopReturnTo(location.pathname + location.search + location.hash);
  const url = new URL(destination, LOCAL_ORIGIN);
  if (from) url.searchParams.set('returnTo', from);
  return url.pathname + url.search + url.hash;
}
