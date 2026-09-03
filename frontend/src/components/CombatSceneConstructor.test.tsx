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
    sideByActorId: { 'character:owner': 'party', 'mount:horse': 'party' },
    world: {
      scene: { mode: 'encounter', initiative: ['character:owner', 'mount:horse'], activeIndex: 0, round: 1 },
      actors: {
        'character:owner': {
          id: 'character:owner', name: 'Владелец', runtime: {
            hp: { current: 10, max: 10, temp: 0 }, resources: { action: 1 }, maxResources: { action: 1 },
            equipment: {}, inventory: [], activeEffects: [],
          },
          character: { baseSize: 2, profBonus: 3, abilityMods: {} } as never,
          passives: [],
          capabilities: { actionIds: [], featureSources: { 'general_feat.mounted_combatant': ['EFF-general-FEAT-0017'] } },
          attackProfile: { attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['main_hand'], sourceEntityIds: ['owner'] },
        },
        'mount:horse': {
          id: 'mount:horse', name: 'Боевой конь', runtime: {
            hp: { current: 19, max: 19, temp: 0 }, resources: {}, maxResources: {},
            equipment: {}, inventory: [], activeEffects: [{
              id: 'goliath-large-form', name: 'Крупная форма', source: 'EFFECT-goliath-large-form',
              mechanics: {
                activation: { mode: 'passive' },
                effects: [{ resolution: 'auto', result: [{
                  kind: 'modifier', op: 'set', value: 3, applies_to: { roll: 'size' },
                }] }],
              },
            }],
          },
          character: { baseSize: 2, profBonus: 3, abilityMods: {} } as never,
          passives: [],
          capabilities: { actionIds: [], featureSources: {} },
          attackProfile: { attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['hooves'], sourceEntityIds: ['horse'] },
        },
      },
    },
    tokens: {
      'character:owner': { actorId: 'character:owner', color: '#fff', position: { x: 1, y: 1 } },
      'mount:horse': { actorId: 'mount:horse', color: '#986', position: { x: 2, y: 1 } },
    },
    initiative: [
      { actorId: 'character:owner', die: 10, bonus: 2, total: 12 },
      { actorId: 'mount:horse', die: 8, bonus: 0, total: 8 },
    ],
    log: [],
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

  it('exposes a clear mounted-combat relation for the feat owner', async () => {
    const onApply = vi.fn();
    await act(async () => {
      root.render(
        <CombatSceneConstructor
          state={state()}
          busy={false}
          onApply={onApply}
          onAddCharacter={async () => {}}
          onAddMonster={async () => {}}
          onClose={() => {}}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const mount = container.querySelector<HTMLSelectElement>('[aria-label="Скакун: Владелец"]')!;
    expect([...mount.options].map((option) => option.text)).toEqual(['Не верхом', 'Боевой конь']);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(mount, 'mount:horse');
      mount.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      mountByRiderId: { 'character:owner': 'mount:horse' },
    }));
  });
});
