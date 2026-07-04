import {
  normalizeCharacter,
  type InitiativeTrackerState,
} from '../types/initiative';

/**
 * Сохранение/шаринг боя без синхронизации: всё состояние кодируется в ссылку
 * (#combat=...). Открывший ссылку получает снимок боя в свой localStorage.
 */
const HASH_KEY = 'combat';

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeCombatState(state: InitiativeTrackerState): string {
  return toBase64Url(JSON.stringify(state));
}

export function decodeCombatState(encoded: string): InitiativeTrackerState | null {
  try {
    const parsed = JSON.parse(fromBase64Url(encoded));
    if (!parsed || !Array.isArray(parsed.characters)) return null;
    return {
      characters: parsed.characters.map(normalizeCharacter),
      activeIndex: typeof parsed.activeIndex === 'number' ? parsed.activeIndex : 0,
      round: typeof parsed.round === 'number' ? parsed.round : 1,
    };
  } catch {
    return null;
  }
}

export function buildShareUrl(state: InitiativeTrackerState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${HASH_KEY}=${encodeCombatState(state)}`;
}

/** Читает состояние боя из хэша текущего URL (если он там есть). */
export function readCombatFromHash(): InitiativeTrackerState | null {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  return decodeCombatState(encoded);
}

/** Убирает combat-хэш из адресной строки, не трогая историю переходов. */
export function clearCombatHash(): void {
  if (!window.location.hash.includes(`${HASH_KEY}=`)) return;
  const { origin, pathname, search } = window.location;
  window.history.replaceState(null, '', `${origin}${pathname}${search}`);
}
