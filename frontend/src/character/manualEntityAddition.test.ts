import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendManualEntityIds,
  FEAT_CATEGORY_LABELS,
  manualEntityAlreadyAdded,
  addManualEntities,
  loadManualEntities,
  type ManualEntity,
} from './manualEntityAddition';
import type { ForgeCharacter } from './types';
import { spellsApi } from '../api/client';
import { charactersV3Api } from './api';
import type { Spell } from '../types';

afterEach(() => vi.restoreAllMocks());

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
  feat_ids: ['feat-1'],
} as ForgeCharacter;

describe('ручное добавление сущностей в лист', () => {
  it('offers parent spells and ordinary spells, while excluding children of different families', async () => {
    const rows = ['parent-command', 'parent-hex'].flatMap((id) => [
      { id, name: id, level: 1, mechanics: { spell_variant_ids: [`${id}-child`] } } as unknown as Spell,
      { id: `${id}-child`, name: `${id}-child`, level: 1, mechanics: { variant_of_spell_id: id } } as unknown as Spell,
    ]);
    const read = vi.spyOn(spellsApi, 'getSpells').mockResolvedValue({ spells: rows, total: rows.length, page: 1, limit: 100 });
    expect((await loadManualEntities('spells')).map((entry) => entry.id)).toEqual(['parent-command', 'parent-hex']);
    expect(read).toHaveBeenCalledOnce();
  });

  it('rejects a stale manually selected child before saving the character', async () => {
    const save = vi.spyOn(charactersV3Api, 'update');
    const child = entity('child');
    child.source = { id: child.id, mechanics: { variant_of_spell_id: 'parent' } } as unknown as Spell;
    await expect(addManualEntities(character, 'spells', [{ entity: child, amount: 1 }])).rejects.toThrow('только при наложении родительского');
    expect(save).not.toHaveBeenCalled();
  });

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
    expect(manualEntityAlreadyAdded(character, 'feats', entity('feat-1'))).toBe(true);
    expect(manualEntityAlreadyAdded(character, 'items', entity('item-1'))).toBe(false);
    expect(manualEntityAlreadyAdded(character, 'effects', entity('effect-1', true))).toBe(false);
    expect(manualEntityAlreadyAdded(character, 'feats', entity('feat-1', true))).toBe(false);
  });

  it('сохраняет повторяемые черты в выбранном количестве', () => {
    expect(appendManualEntityIds(['feat-1'], [
      { entity: entity('feat-1'), amount: 1 },
      { entity: entity('repeatable-feat', true), amount: 2 },
    ], true)).toEqual(['feat-1', 'repeatable-feat', 'repeatable-feat']);
  });

  it('охватывает все категории черт', () => {
    expect(FEAT_CATEGORY_LABELS).toEqual({
      origin: 'Черта происхождения',
      general: 'Общая черта',
      fighting_style: 'Боевой стиль',
      epic_boon: 'Эпическая милость',
    });
  });
});
