// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/authApi';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import Login from '../pages/Login';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Destination() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  return <output data-authenticated={isAuthenticated} data-user={user?.id}>{location.pathname + location.search + location.hash}</output>;
}

describe('OAuth Login and AuthContext integration', () => {
  it('finishes a callback once in StrictMode, persists the session and navigates to the explicit safe path', async () => {
    const verifier = 'v'.repeat(43); const code = 'c'.repeat(43);
    window.history.replaceState(null, '', `/login#oauth_code=${code}`);
    sessionStorage.setItem('dnd-cards:oauth-proof', JSON.stringify({ verifier, createdAt: Date.now() }));
    const exchange = vi.spyOn(authApi, 'exchangeOAuth').mockResolvedValue({ token: 'application-jwt', user: { id: 'oauth-user', username: 'google_opaque', email: '', display_name: 'Test User', created_at: '', updated_at: '' }, return_path: '/encounters/join?mode=play#invite=abc' });
    const profile = vi.spyOn(authApi, 'getProfile');
    vi.spyOn(authApi, 'oauthProviders').mockResolvedValue({ providers: [] });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => { root.render(<StrictMode><AuthProvider><MemoryRouter initialEntries={['/login']}><Routes><Route path="/login" element={<Login />} /><Route path="*" element={<Destination />} /></Routes></MemoryRouter></AuthProvider></StrictMode>); });
      await vi.waitFor(() => expect(container.querySelector('output')?.dataset.authenticated).toBe('true'));
      expect(container.textContent).toBe('/encounters/join?mode=play#invite=abc');
      expect(container.querySelector('output')?.dataset.user).toBe('oauth-user');
      expect(exchange).toHaveBeenCalledExactlyOnceWith(code, verifier);
      expect(profile).not.toHaveBeenCalled();
      expect(localStorage.getItem('auth_token')).toBe('application-jwt');
      expect(JSON.parse(localStorage.getItem('user') ?? '{}').id).toBe('oauth-user');
      expect(window.location.hash).toBe('');
    } finally {
      await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/');
    }
  });
});
