// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Login from '../pages/Login';
import Register from '../pages/Register';
import AuthenticatedSectionGate from '../components/AuthenticatedSectionGate';
import { authApi } from '../api/authApi';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { useAuthMock, login, register } = vi.hoisted(() => ({ useAuthMock: vi.fn(), login: vi.fn(), register: vi.fn() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: useAuthMock }));

function Destination() {
  const location = useLocation();
  return <output>{location.pathname + location.search + location.hash}</output>;
}

describe('green/gold auth forms retain sign-in behavior', () => {
  let container: HTMLDivElement;
  let root: Root;
  const defaultAuth = () => ({ login, register, logout: vi.fn(), user: null, isAuthenticated: false, isLoading: false, oauthError: null, oauthReturnPath: null });
  beforeEach(() => {
    login.mockReset().mockResolvedValue(undefined); register.mockReset().mockResolvedValue(undefined);
    useAuthMock.mockReturnValue(defaultAuth());
    vi.spyOn(authApi, 'oauthProviders').mockResolvedValue({ providers: [
      { id: 'google', name: 'Google', enabled: false, reason: 'unconfigured' },
      { id: 'yandex', name: 'Яндекс', enabled: false, reason: 'unconfigured' },
    ] });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const render = async (path: '/login' | '/register', state?: object) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[{ pathname: path, state }]}><Routes>
      <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} /><Route path="*" element={<Destination />} />
    </Routes></MemoryRouter>));
  };
  const fill = async (values: Record<string, string>) => {
    await act(async () => {
      for (const [name, value] of Object.entries(values)) {
        const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  };
  const submit = async () => { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); };
  const registration = { username: 'test-hero', email: 'hero@example.test', display_name: 'Hero', password: 'secret123', confirmPassword: 'secret123' };

  it.each(['/login', '/register'] as const)('renders %s within one shared Layout header with labelled required fields', async (page) => {
    await render(page);
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(container.querySelector('.auth-shell-art')?.getAttribute('src')).toBe('/images/home/interactive.jpg');
    expect(container.querySelectorAll('input')).toHaveLength(page === '/login' ? 2 : 5);
    for (const input of container.querySelectorAll<HTMLInputElement>('input')) {
      expect(input.required).toBe(true);
      expect(input.labels?.length).toBe(1);
      expect(input.autocomplete).not.toBe('');
    }
    expect(container.querySelector('[title]')).toBeNull();
    expect(container.querySelectorAll('.auth-oauth button:disabled')).toHaveLength(2);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  });

  it('has accessible independent password visibility controls without submitting the form', async () => {
    await render('/register');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Показать пароль"]')!.click());
    expect(container.querySelector<HTMLInputElement>('#password')!.type).toBe('text');
    expect(container.querySelector<HTMLInputElement>('#confirmPassword')!.type).toBe('password');
    expect(container.querySelector('[aria-label="Скрыть пароль"]')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Показать подтверждение пароля"]')!.click());
    expect(container.querySelector<HTMLInputElement>('#confirmPassword')!.type).toBe('text');
    expect(register).not.toHaveBeenCalled();
  });

  it.each(['/login', '/register'] as const)('returns %s to the homepage by default', async (page) => {
    await render(page);
    await fill(page === '/login' ? { username: 'test-hero', password: 'secret123' } : registration);
    await submit();
    expect(container.querySelector('output')?.textContent).toBe('/');
    if (page === '/login') expect(login).toHaveBeenCalledExactlyOnceWith({ username: 'test-hero', password: 'secret123' });
    else expect(register).toHaveBeenCalledExactlyOnceWith({ username: 'test-hero', email: 'hero@example.test', display_name: 'Hero', password: 'secret123' });
  });

  it('preserves the guest destination when switching from login to registration', async () => {
    await render('/login', { from: { pathname: '/roguelike/run-42', search: '?view=party', hash: '#turn=2' } });
    await act(async () => container.querySelector<HTMLAnchorElement>('.auth-switch a')!.click());
    await fill(registration); await submit();
    expect(container.querySelector('output')?.textContent).toBe('/roguelike/run-42?view=party#turn=2');
  });

  it('keeps registration validation and the server error visible', async () => {
    await render('/register');
    await fill({ ...registration, confirmPassword: 'different' }); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Пароли не совпадают');
    expect(register).not.toHaveBeenCalled();
    await fill({ password: 'short', confirmPassword: 'short' }); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('минимум 6');
    await fill({ password: 'secret123', confirmPassword: 'secret123' });
    register.mockRejectedValueOnce(new Error('Имя уже занято')); await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Имя уже занято');
  });

  it('retains password login failure and OAuth callback errors', async () => {
    useAuthMock.mockReturnValue({ ...defaultAuth(), oauthError: 'Вход отменён. Попробуйте снова.' });
    await render('/login');
    await fill({ username: 'test-hero', password: 'wrong' });
    login.mockRejectedValueOnce(new Error('Неверный пароль')); await submit();
    expect(Array.from(container.querySelectorAll('[role="alert"]')).map(el => el.textContent)).toEqual(['Вход отменён. Попробуйте снова.', 'Неверный пароль']);
  });

  it('keeps password and provider buttons disabled during OAuth bootstrap', async () => {
    useAuthMock.mockReturnValue({ ...defaultAuth(), isLoading: true });
    await render('/login');
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Проверяем вход…');
  });

  it('keeps authenticated section content unmounted through the real guest → login → registration UI', async () => {
    const mounted = vi.fn();
    function PrivateSection() { mounted(); return <div>private</div>; }
    await act(async () => root.render(<MemoryRouter initialEntries={['/characters-forge?sort=name#party']}><Routes>
      <Route path="/characters-forge" element={<AuthenticatedSectionGate section="characters"><PrivateSection /></AuthenticatedSectionGate>} />
      <Route path="/login" element={<Login />} /><Route path="/register" element={<Register />} />
    </Routes></MemoryRouter>));
    await act(async () => container.querySelector<HTMLAnchorElement>('.guest-section-actions a[href="/login"]')!.click());
    await act(async () => container.querySelector<HTMLAnchorElement>('.auth-switch a')!.click());
    expect(container.querySelector('.auth-shell-register')).not.toBeNull();
    expect(mounted).not.toHaveBeenCalled();
    expect(container.querySelectorAll('header')).toHaveLength(1);
  });
});
