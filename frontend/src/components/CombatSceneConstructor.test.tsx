// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloCombatState } from '../solo-combat/types';
import CombatSceneConstructor from './CombatSceneConstructor';

vi.mock('../character/api', () => ({
  charactersV3Api: {
    listPreviews: vi.fn(async () => [{ id: 'character:new', name: 'Новый герой' }]),
  },
}));

vi.mock('../monsters/api', () => ({
  monstersApi: {
    list: vi.fn(async () => ({
      monsters: [{ id: 'monster:goblin', name: 'Гоблин-воин' }],
      total: 1,
      page: 1,
      limit: 100,
    })),
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function state(): SoloCombatState {
  return {
    characterId: 'character:owner',
    controlledCharacterIds: ['character:owner'],
    world: {
      scene: { mode: 'encounter', initiative: ['character:owner'], activeIndex: 0, round: 1 },
      actors: {
        'character:owner': {
          id: 'character:owner', name: 'Владелец', runtime: {
            resources: { action: 1 }, maxResources: { action: 1 },
          },
        },
      },
    },
    tokens: { 'character:owner': { actorId: 'character:owner', color: '#fff', position: { x: 1, y: 1 } } },
    initiative: [{ actorId: 'character:owner', die: 10, bonus: 2, total: 12 }],
  } as unknown as SoloCombatState;
}

describe('CombatSceneConstructor participant controls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('loads and adds both a catalog monster and another owned character', async () => {
    const onAddMonster = vi.fn(async () => {});
    const onAddCharacter = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <CombatSceneConstructor
          state={state()}
          busy={false}
          onApply={() => {}}
          onAddCharacter={onAddCharacter}
          onAddMonster={onAddMonster}
          onClose={() => {}}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const addSection = container.querySelector<HTMLElement>('[aria-label="Добавить участника"]')!;
    expect(addSection.textContent).toContain('Гоблин-воин');
    await act(async () => {
      [...addSection.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить в сцену'))!.click();
      await Promise.resolve();
    });
    expect(onAddMonster).toHaveBeenCalledWith('monster:goblin');

    const kind = addSection.querySelectorAll('select')[0];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(kind, 'character');
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(addSection.textContent).toContain('Новый герой');
    await act(async () => {
      [...addSection.querySelectorAll('button')].find((button) => button.textContent?.includes('Добавить в сцену'))!.click();
      await Promise.resolve();
    });
    expect(onAddCharacter).toHaveBeenCalledWith('character:new');
  });
});
