// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AuthenticatedSectionGate from './AuthenticatedSectionGate';
import type { GuestSection } from '../pages/GuestSectionPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { useAuthMock, mounted } = vi.hoisted(() => ({ useAuthMock: vi.fn(), mounted: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: useAuthMock }));

function PrivateChild() {
  useEffect(() => { mounted(); }, []);
  return <div data-private-content>Private section</div>;
}

function AuthDestination() {
  const location = useLocation();
  return <output>{JSON.stringify({ path: location.pathname, from: location.state?.from })}</output>;
}

describe('AuthenticatedSectionGate public entrances', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    mounted.mockReset();
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false, user: null, logout: vi.fn() });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
  const render = async (section: GuestSection, path = '/roguelike/run-42?view=party#turn=2') => {
    await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes>
      <Route path="/login" element={<AuthDestination />} /><Route path="/register" element={<AuthDestination />} />
      <Route path="*" element={<AuthenticatedSectionGate section={section}><PrivateChild /></AuthenticatedSectionGate>} />
    </Routes></MemoryRouter>));
  };

  it.each([false, true])('waits for bootstrap even when cached authentication is %s', async (isAuthenticated) => {
    useAuthMock.mockReturnValue({ isAuthenticated, isLoading: true, user: null, logout: vi.fn() });
    await render('characters');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Проверяем сессию');
    expect(container.querySelector('.guest-section-hero')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
  });

  it.each(['characters', 'runs'] as const)('shows the illustrated %s introduction without mounting game content', async (section) => {
    await render(section, section === 'characters' ? '/characters-forge' : '/roguelike');
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toContain(section === 'characters' ? 'Ваш герой.' : 'Впереди');
    expect(container.querySelector('.guest-section-art')?.getAttribute('src')).toBe(`/images/home/${section === 'characters' ? 'interactive' : 'runs'}.jpg`);
    expect(container.querySelectorAll('.guest-section-features li')).toHaveLength(3);
    expect(container.querySelector('.guest-section-actions a[href="/login"]')).not.toBeNull();
    expect(container.querySelector('.guest-section-actions a[href="/register"]')).not.toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();
  });

  it.each(['/login', '/register'])('preserves the full run detail address through the %s CTA', async (destination) => {
    await render('runs');
    await act(async () => container.querySelector<HTMLAnchorElement>(`.guest-section-actions a[href="${destination}"]`)!.click());
    expect(JSON.parse(container.querySelector('output')!.textContent!)).toEqual({ path: destination, from: { pathname: '/roguelike/run-42', search: '?view=party', hash: '#turn=2' } });
    expect(mounted).not.toHaveBeenCalled();
  });

  it('renders authenticated children without an extra header/layout', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    await render('runs');
    expect(container.textContent).toBe('Private section');
    expect(container.querySelector('header')).toBeNull();
    expect(mounted).toHaveBeenCalledOnce();
  });
});
