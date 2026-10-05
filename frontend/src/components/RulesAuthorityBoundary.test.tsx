// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RulesAuthorityBoundary from './RulesAuthorityBoundary';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../api/conditionsApi', () => ({ loadConditions: mocks.load, MICRO_MVP_CONDITION_CERTIFICATION_VERSION: 'fixture' }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); mocks.load.mockReset(); host = document.createElement('div'); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it('withholds gameplay while offline and mounts it only after a verified retry', async () => {
  mocks.load.mockResolvedValueOnce({ mode: 'offline_fixture', reason: 'mismatched release' })
    .mockResolvedValueOnce({ mode: 'database_release', count: 15, setHash: 'verified' });
  await act(async () => root.render(<RulesAuthorityBoundary><button data-command>Действие</button></RulesAuthorityBoundary>));
  expect(host.querySelector('[data-command]')).toBeNull();
  expect(host.querySelector('[data-testid="offline-rules-authority"]')).not.toBeNull();
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(mocks.load.mock.calls[0][0].expectedRelease.rulesHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(host.querySelector('[data-command]')).not.toBeNull();
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not authorize an unexpected failure and stops retrying after leaving the screen', async () => {
  mocks.load.mockRejectedValue(new Error('connection failed'));
  await act(async () => root.render(<RulesAuthorityBoundary><button data-command>Действие</button></RulesAuthorityBoundary>));
  expect(host.querySelector('[data-command]')).toBeNull();
  await act(async () => root.render(<p>Библиотека</p>));
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
  expect(mocks.load).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
