import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CONDITION_RULES,
  conditionLabel,
  conditionModifierPayloads,
  conditionOptions,
  conditionProjectedModifiers,
  conditionRule,
  registerConditions,
} from './conditions';

describe('conditions registry (фаза D)', () => {
  it('встроенные 13 состояний доступны как сид', () => {
    expect(Object.keys(BUILTIN_CONDITION_RULES)).toHaveLength(13);
    expect(conditionLabel('prone')).toBe('Распластан');
    expect(conditionModifierPayloads('restrained')).toHaveLength(2);
    expect(conditionRule('unknown-xyz')).toBeNull();
  });

  it('registerConditions добавляет хоумбрю-состояние данными (без перевыкатки)', () => {
    registerConditions([{
      id: 'marked', label: 'Отмечен',
      modifiers: [{ applies_to: { roll: 'attack' }, op: 'advantage' }],
      projected: [{ applies_to: { roll: 'attack' }, op: 'advantage' }],
      note: 'Хоумбрю',
    }]);
    expect(conditionLabel('marked')).toBe('Отмечен');
    expect(conditionModifierPayloads('marked')).toHaveLength(1);
    expect(conditionProjectedModifiers('marked')).toHaveLength(1);
    expect(conditionOptions().some((o) => o.id === 'marked')).toBe(true);
  });

  it('registerConditions переопределяет по id (последнее выигрывает)', () => {
    registerConditions([{ id: 'zzz', label: 'A', modifiers: [] }]);
    registerConditions([{ id: 'zzz', label: 'B', modifiers: [] }]);
    expect(conditionLabel('zzz')).toBe('B');
  });
});
