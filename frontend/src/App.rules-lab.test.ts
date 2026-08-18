// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './canon/microMvpL1ReleaseIdentity';
import App from './App';

const mocks = vi.hoisted(() => ({ loadConditions: vi.fn(), useAuth: vi.fn() }));

vi.mock('./api/conditionsApi', () => ({
  loadConditions: mocks.loadConditions,
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION: 'micro-mvp-l1-rules-core-v4',
}));
vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: mocks.useAuth,
}));
vi.mock('./mobile/MobileSuggestion', () => ({ default: () => null }));
vi.mock('./pages/Login', () => {
  function LoginMock() {
    const location = useLocation();
    const from = (location.state as { from?: { pathname?: string } } | null)?.from;
    return createElement(
      'main',
      { 'data-testid': 'login-route-marker' },
      `login from ${from?.pathname ?? 'unknown'}`,
    );
  }
  return { default: LoginMock };
});
vi.mock('./pages/RulesLab', () => ({
  default: () => createElement('main', { 'data-testid': 'rules-lab-route-marker' }, 'Rules lab'),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('/rules-lab route', () => {
  afterEach(() => {
    mocks.loadConditions.mockReset();
    mocks.useAuth.mockReset();
    document.body.replaceChildren();
  });

  it.each([
    '/rules-lab',
    '/rules-lab/baseline',
    '/rules-lab/not-registered',
  ])('loads %s publicly without application API bootstrap or auth providers', async (path) => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(App),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="rules-lab-route-marker"]')).not.toBeNull();
    });
    expect(mocks.loadConditions).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it('keeps ordinary routes non-interactive until condition authority is selected', async () => {
    let finish!: () => void;
    mocks.loadConditions.mockReturnValue(new Promise((resolve) => {
      finish = () => resolve({ mode: 'database_release', count: 15, setHash: 'test' });
    }));
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: ['/character-forge'] },
        createElement(App),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.loadConditions).toHaveBeenCalledTimes(1);
    expect(mocks.loadConditions).toHaveBeenCalledWith({
      timeoutMs: 5_000,
      expectedRelease: {
        certificationVersion: 'micro-mvp-l1-rules-core-v4',
        rulesHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
        releaseContentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
        releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
      },
    });
    expect(container.textContent).toContain('Загрузка правил…');

    await act(async () => root.unmount());
    finish();
  });

  it('makes the offline rules authority visible after a fail-closed bootstrap', async () => {
    mocks.loadConditions.mockResolvedValue({
      mode: 'offline_fixture',
      reason: 'condition release is incomplete',
    });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: ['/login'] },
        createElement(App),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="offline-rules-authority"]'))
        .not.toBeNull();
    });
    expect(container.textContent).toContain('Офлайн-набор правил');

    await act(async () => root.unmount());
  });

  it.each([
    '/character-forge',
    '/character-forge/character-id',
    '/characters-forge',
    '/characters-v3/character-id',
    '/characters-v3/character-id/edit',
    '/m/characters',
    '/m/characters/new',
    '/m/characters/character-id',
    '/m/characters/character-id/edit',
    '/m/characters/character-id/level-up',
    '/m/characters/character-id/add',
    '/m/characters/character-id/add/items',
  ])('protects CharacterV3 route %s and preserves its login return path', async (path) => {
    mocks.loadConditions.mockResolvedValue({
      mode: 'database_release', count: 15, setHash: 'test',
    });
    mocks.useAuth.mockReturnValue({ isAuthenticated: false, isLoading: false });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(App),
      ));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="login-route-marker"]')).not.toBeNull();
    });
    expect(container.textContent).toContain(`login from ${path}`);

    await act(async () => root.unmount());
  });
});
