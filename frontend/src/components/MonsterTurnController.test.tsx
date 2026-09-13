// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, expect, it, vi} from 'vitest';
import type {SoloCombatState} from '../solo-combat/types';
import MonsterTurnController from './MonsterTurnController';

vi.mock('../solo-combat/engine', () => ({activeActor: () => ({id: 'monster', kind: 'monster'}), runMonsterTurn: (state: SoloCombatState) => state}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.useRealTimers());

it('resumes a pending monster turn after a presentation dialog cancels its timer, exactly once', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  const root = createRoot(container);
  const state = {outcome: 'active', world: {revision: 2}} as SoloCombatState;
  const transition = vi.fn();
  const render = (disabled: boolean) => root.render(<MonsterTurnController state={state} disabled={disabled} onTransition={transition} onError={vi.fn()}/>);
  try {
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTime(200));
    await act(async () => render(true));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(transition).not.toHaveBeenCalled();
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTime(500));
    expect(transition).toHaveBeenCalledTimes(1);
    await act(async () => render(false));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(transition).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
  }
});
