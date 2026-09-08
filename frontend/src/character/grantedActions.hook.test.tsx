// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { actionsApi } from '../api/client';
import { useGrantedActions } from './grantedActions';
import type { AssembledCharacter } from './assemble';

vi.mock('../api/client', () => ({ actionsApi: { getAction: vi.fn(async () => ({ id: 'learned', name: 'Манёвр' })) } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('loads granted cards once when the optional item list is omitted', async () => {
  const assembled = { actions: [], spells: [], effects: [{
    effect: { id: 'feature', name: 'Боевое превосходство', mechanics: { effects: [{
      kind: 'grant_action', value: 'ACT-learned',
    }] } }, origin: { kind: 'class', id: 'fighter', name: 'Воин' },
  }] } as unknown as AssembledCharacter;
  function Harness() {
    const actions = useGrantedActions({ assembled, characterLevel: 3 });
    return <span>{actions.map(entry => entry.action.name).join(', ')}</span>;
  }
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toBe('Манёвр');
    expect(actionsApi.getAction).toHaveBeenCalledTimes(1);
    await act(async () => { root.render(<Harness />); });
    expect(actionsApi.getAction).toHaveBeenCalledTimes(1);
  } finally { await act(async () => { root.unmount(); }); }
});
