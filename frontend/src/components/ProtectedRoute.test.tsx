// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: useAuthMock,
}));

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from;
  return <div>login from {from?.pathname ?? 'unknown'}</div>;
}

describe('ProtectedRoute', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useAuthMock.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  const renderProtected = async (): Promise<void> => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/encounters']}>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route
              path="/encounters"
              element={(
                <ProtectedRoute>
                  <div>encounter list</div>
                </ProtectedRoute>
              )}
            />
          </Routes>
        </MemoryRouter>,
      );
    });
  };

  it('does not render protected content before server-backed session bootstrap ends', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: true });
    await renderProtected();

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Проверка сессии');
    expect(container.textContent).not.toContain('encounter list');
  });

  it('redirects an anonymous user and preserves the requested location', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    await renderProtected();

    expect(container.textContent).toContain('login from /encounters');
    expect(container.textContent).not.toContain('encounter list');
  });

  it('renders content only for a validated authenticated session', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    await renderProtected();

    expect(container.textContent).toContain('encounter list');
  });
});
