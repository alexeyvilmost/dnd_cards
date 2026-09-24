// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';

describe('OAuth browser handoff and safe destinations', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/login');
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('starts login with a fresh tab proof and SHA-256 challenge, never exposing the verifier in the URL', async () => {
    const { startOAuth } = await import('./oauth');
    const assign = vi.fn();
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000', assign } });
    await startOAuth('yandex', '/encounters/join#invite=abc');
    const proof = JSON.parse(sessionStorage.getItem('dnd-cards:oauth-proof') ?? '{}');
    const target = new URL(assign.mock.calls[0][0]);
    expect(proof.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(target.pathname).toBe('/api/auth/oauth/yandex/start');
    expect(target.searchParams.get('challenge')).toBe(createHash('sha256').update(proof.verifier).digest('base64url'));
    expect(target.searchParams.get('return_to')).toBe('/encounters/join#invite=abc');
    expect(target.toString()).not.toContain(proof.verifier);
  });

  it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/%2fevil.test', '/%252fevil.test', '/%5cevil.test', '/%0aevil', '/a/../login', '/login', '/register', '/api/auth/oauth/google/start'])('rejects unsafe destination %s', async (path) => {
    const { safeAuthPath } = await import('./oauth');
    expect(safeAuthPath(path)).toBe('/');
  });

  it('preserves explicit internal routes and invite fragments; defaults to homepage', async () => {
    const { safeAuthPath } = await import('./oauth');
    expect(safeAuthPath(undefined)).toBe('/');
    expect(safeAuthPath('/encounters/join?mode=play#invite=abc')).toBe('/encounters/join?mode=play#invite=abc');
  });

  it('removes the callback fragment immediately and exchanges once under repeated effects', async () => {
    const { authApi } = await import('../api/authApi');
    const { completeOAuth } = await import('./oauth');
    const code = 'c'.repeat(43); const verifier = 'v'.repeat(43);
    window.history.replaceState(null, '', `/login#oauth_code=${code}`);
    sessionStorage.setItem('dnd-cards:oauth-proof', JSON.stringify({ verifier, createdAt: Date.now() }));
    const exchange = vi.spyOn(authApi, 'exchangeOAuth').mockResolvedValue({ token: 'app-token', user: { id: 'user' } as never, return_path: '/encounters/join#invite=abc' });
    const first = completeOAuth();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('dnd-cards:oauth-proof')).toBeNull();
    expect(completeOAuth()).toBe(first);
    expect(await first).toMatchObject({ return_path: '/encounters/join#invite=abc' });
    expect(exchange).toHaveBeenCalledExactlyOnceWith(code, verifier);
    expect(window.location.href).not.toContain('app-token');
  });

  it.each(['missing', 'expired', 'malformed', 'future'])('rejects %s browser proof before contacting backend', async (kind) => {
    const { authApi } = await import('../api/authApi');
    const { completeOAuth } = await import('./oauth');
    window.history.replaceState(null, '', `/login#oauth_code=${'c'.repeat(43)}`);
    if (kind !== 'missing') sessionStorage.setItem('dnd-cards:oauth-proof', kind === 'malformed' ? '{' : JSON.stringify({ verifier: 'v'.repeat(43), createdAt: Date.now() + (kind === 'future' ? 60_000 : -700_000) }));
    const exchange = vi.spyOn(authApi, 'exchangeOAuth');
    await expect(completeOAuth()).rejects.toThrow('Начните вход снова');
    expect(exchange).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('presents a safe cancellation message and never echoes provider error text', async () => {
    const { completeOAuth } = await import('./oauth');
    window.history.replaceState(null, '', '/login#oauth_error=denied&error_description=untrusted');
    await expect(completeOAuth()).rejects.toThrow('Вход отменён');
    expect(window.location.hash).toBe('');
  });
});
