import { describe, expect, it } from 'vitest';
import { appendManualEntityIds, manualEntityAlreadyAdded, type ManualEntity } from './manualEntityAddition';
import type { ForgeCharacter } from './types';

const entity = (id: string, repeatable = false): ManualEntity => ({
  id,
  name: id,
  description: '',
  repeatable,
  source: { id, name: id } as ManualEntity['source'],
});

const character = {
  action_ids: ['action-1'],
  effect_ids: ['effect-1'],
  spell_ids: ['spell-1'],
} as ForgeCharacter;

describe('ручное добавление сущностей в лист', () => {
  it('не дублирует обычную сущность и поддерживает повторяемые эффекты', () => {
    expect(appendManualEntityIds(['one'], [
      { entity: entity('one'), amount: 1 },
      { entity: entity('repeat', true), amount: 3 },
    ], true)).toEqual(['one', 'repeat', 'repeat', 'repeat']);
  });

  it('определяет уже добавленные действия, эффекты и заклинания; предмет можно добавить снова', () => {
    expect(manualEntityAlreadyAdded(character, 'actions', entity('action-1'))).toBe(true);
    expect(manualEntityAlreadyAdded(character, 'effects', entity('effect-1'))).toBe(true);
    expect(manualEntityAlreadyAdded(character, 'spells', entity('spell-1'))).toBe(true);
    expect(manualEntityAlreadyAdded(character, 'items', entity('item-1'))).toBe(false);
    expect(manualEntityAlreadyAdded(character, 'effects', entity('effect-1', true))).toBe(false);
  });
});
