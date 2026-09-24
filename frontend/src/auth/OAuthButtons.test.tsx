// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/authApi';
import { OAuthButtons } from './OAuthButtons';
import * as oauth from './oauth';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('OAuth login/registration buttons', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const mount = async () => { await act(async () => { root.render(<OAuthButtons returnPath="/encounters/join#invite=abc" />); }); };

  it('shows both unconfigured providers disabled, with visible explanation', async () => {
    vi.spyOn(authApi, 'oauthProviders').mockResolvedValue({ providers: [
      { id: 'google', name: 'Google', enabled: false, reason: 'unconfigured' },
      { id: 'yandex', name: 'Яндекс', enabled: false, reason: 'unconfigured' },
    ] });
    await mount();
    expect(Array.from(container.querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain('пока не настроены');
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('starts an enabled provider with the explicit destination', async () => {
    vi.spyOn(authApi, 'oauthProviders').mockResolvedValue({ providers: [
      { id: 'google', name: 'Google', enabled: true, reason: '' },
      { id: 'yandex', name: 'Яндекс', enabled: false, reason: 'unconfigured' },
    ] });
    const start = vi.spyOn(oauth, 'startOAuth').mockResolvedValue();
    await mount();
    const buttons = container.querySelectorAll('button');
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(true);
    await act(async () => { buttons[0].click(); });
    expect(start).toHaveBeenCalledExactlyOnceWith('google', '/encounters/join#invite=abc');
    expect(buttons[0].disabled).toBe(true);
  });

  it('keeps the password alternative visible when provider discovery fails', async () => {
    vi.spyOn(authApi, 'oauthProviders').mockRejectedValue(new Error('offline'));
    await mount();
    expect(container.textContent).toContain('Не удалось проверить');
    expect(container.textContent).toContain('или с помощью пароля');
    expect(Array.from(container.querySelectorAll('button')).every((button) => button.disabled)).toBe(true);
  });
});
