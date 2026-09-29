import { describe, expect, it } from 'vitest';
import type { EntityReference } from '../api/entityReferences';
import { PASSIVE_EFFECT_TYPE_OPTIONS, type PassiveEffect } from '../types';
import { effectCategoryLabel, groupEffectsByType, hasEffectSourceCategory } from './effectPresentation';

const source = (entity_type: 'class' | 'race', name: string, level?: number): EntityReference => ({
  entity_type, name, level, entity_id: name, paths: ['mechanics.effects[0]'],
});
describe('effect categories', () => {
  it.each([
    [source('class', 'Чародей'), 'Чародей'],
    [source('class', 'Воин', 5), 'Воин, 5 уровень'],
    [source('race', 'Эльф'), 'Эльф'],
    [source('race', 'Эльф', 3), 'Эльф, 3 уровень'],
    [source('race', 'Гном', 7), 'Гном, 7 уровень'],
  ])('uses the sole mechanical class/species reference %j', (reference, expected) => {
    expect(effectCategoryLabel({ effect_type: 'passive', referenced_by: [reference] })).toBe(expected);
    expect(hasEffectSourceCategory({ referenced_by: [reference] })).toBe(true);
  });
  it('retains the effect type for no source, a non-class/species source, or more than one incoming reference', () => {
    for (const referenced_by of [
      [], [source('class', 'Воин'), source('race', 'Эльф', 3)],
      [source('class', 'Воин', 3), source('class', 'Воин', 5)],
      [{ ...source('class', 'Воин'), entity_type: 'feat' as const }],
      [{ ...source('class', 'Удалённый класс'), missing: true }],
      [{ ...source('race', 'Вид'), name: undefined }],
    ]) {
      expect(effectCategoryLabel({ effect_type: 'feat_ability', referenced_by })).toBe('Эффект черты');
      expect(hasEffectSourceCategory({ referenced_by })).toBe(false);
    }
  });
  it('groups every type in catalog order, retains within-group server order and uses states plural', () => {
    const effects = PASSIVE_EFFECT_TYPE_OPTIONS.map(({ value }, index) => ({ id: String(index), effect_type: value } as PassiveEffect)).reverse();
    effects.push({ id: 'second-state', effect_type: 'condition' } as PassiveEffect);
    const groups = groupEffectsByType(effects);
    expect(groups.slice(0, 6).map(group => group.label)).toEqual([
      'Состояния', 'Мастерство оружия', 'Боевой стиль', 'Эффект черты', 'Эффект предмета', 'Эффект заклинания',
    ]);
    expect(groups.map(group => group.type)).toEqual(PASSIVE_EFFECT_TYPE_OPTIONS.map(option => option.value));
    expect(groups[0].effects.map(effect => effect.id)).toEqual(['0', 'second-state']);
  });
});
