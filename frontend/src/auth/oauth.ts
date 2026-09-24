import { authApi } from '../api/authApi';
import { API_BASE_URL } from '../api/client';
import type { AuthResponse } from '../types';

export type OAuthProviderID = 'google' | 'yandex';
export interface OAuthProviderStatus {
  id: OAuthProviderID;
  name: string;
  enabled: boolean;
  reason: '' | 'unconfigured' | 'unavailable';
}
export interface OAuthLoginResponse extends AuthResponse { return_path: string }

const proofKey = 'dnd-cards:oauth-proof';
const proofPattern = /^[A-Za-z0-9_-]{43}$/;

function hasUnsafePathCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return character === '\\' || code <= 0x20 || code === 0x7f;
  });
}

// Keep this contract aligned with safeOAuthReturnPath on the server. A return
// destination is always an internal path, never an OAuth callback URI.
export function safeAuthPath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048) return '/';
  let path = value.split(/[?#]/, 1)[0];
  for (let i = 0; i < 4; i += 1) {
    if (!path.startsWith('/') || path.startsWith('//') || hasUnsafePathCharacter(path)
      || path.split('/').some((part) => part === '.' || part === '..')
      || /^\/(?:login|register)\/?$/i.test(path) || /^\/api\//i.test(path)) return '/';
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return value;
      path = decoded;
    } catch { return '/'; }
  }
  return '/';
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function startOAuth(provider: OAuthProviderID, returnPath: string): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  // sessionStorage survives a provider redirect and remains private to this tab.
  // Failure to save aborts navigation, since the callback could not be redeemed.
  sessionStorage.setItem(proofKey, JSON.stringify({ verifier, createdAt: Date.now() }));
  const target = new URL(`${API_BASE_URL.replace(/\/+$/, '')}/api/auth/oauth/${provider}/start`, window.location.origin);
  target.search = new URLSearchParams({ challenge, return_to: safeAuthPath(returnPath) }).toString();
  window.location.assign(target.toString());
}

export function hasOAuthCallback(): boolean {
  return window.location.pathname === '/login' && /^#oauth_(?:code|error)=/.test(window.location.hash);
}

// One promise per document also survives React StrictMode's effect replay.
// Do not retry a consumed login code or let bootstrap overwrite the new session.
let callbackPromise: Promise<OAuthLoginResponse> | undefined;
export function completeOAuth(): Promise<OAuthLoginResponse> {
  if (callbackPromise) return callbackPromise;
  if (!hasOAuthCallback()) return Promise.reject(new Error('Нет активной попытки входа'));
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  callbackPromise = (async () => {
    const saved = sessionStorage.getItem(proofKey);
    sessionStorage.removeItem(proofKey);
    if (params.has('oauth_error')) {
      const errors: Record<string, string> = {
        denied: 'Вход отменён. Вы можете попробовать снова.',
        unavailable: 'Этот способ входа пока недоступен.',
        expired: 'Попытка входа истекла. Начните вход снова.',
      };
      throw new Error(errors[params.get('oauth_error') ?? ''] ?? 'Не удалось войти через провайдера. Попробуйте снова.');
    }
    const code = params.get('oauth_code') ?? '';
    let proof: { verifier?: unknown; createdAt?: unknown } = {};
    try { proof = JSON.parse(saved ?? '{}'); } catch { /* Invalid local proof fails closed. */ }
    if (!proof || !proofPattern.test(code) || params.getAll('oauth_code').length !== 1
      || typeof proof.verifier !== 'string' || !proofPattern.test(proof.verifier)
      || typeof proof.createdAt !== 'number' || Date.now() - proof.createdAt > 11 * 60_000
      || proof.createdAt > Date.now()) {
      throw new Error('Попытка входа истекла или открыта в другой вкладке. Начните вход снова.');
    }
    const result = await authApi.exchangeOAuth(code, proof.verifier);
    return { ...result, return_path: safeAuthPath(result.return_path) };
  })();
  return callbackPromise;
}
