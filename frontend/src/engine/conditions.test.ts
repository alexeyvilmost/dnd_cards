import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CONDITION_RULES,
  conditionLabel,
  conditionModifierPayloads,
  conditionOptions,
  conditionRule,
  registerConditions,
} from './conditions';

describe('conditions registry (data-driven, scoped)', () => {
  it('встроенные 13 состояний доступны как сид', () => {
    expect(Object.keys(BUILTIN_CONDITION_RULES)).toHaveLength(13);
    expect(conditionLabel('prone')).toBe('Распластан');
    expect(conditionRule('unknown-xyz')).toBeNull();
  });

  it('состояние несёт scope:target модификатор (проекция на атакующего) как ДАННЫЕ', () => {
    const adv = conditionModifierPayloads('restrained').find((m) => m.scope === 'target');
    expect(adv).toBeTruthy();
    expect(adv?.op).toBe('advantage');
    expect(adv?.applies_to.roll).toBe('attack');
    // Невидимость проецирует ПОМЕХУ на атакующего (данные, не код).
    expect(conditionModifierPayloads('invisible').some((m) => m.scope === 'target' && m.op === 'disadvantage')).toBe(true);
  });

  it('self-модификаторы без scope влияют на носителя', () => {
    const self = conditionModifierPayloads('poisoned');
    expect(self.every((m) => m.scope !== 'target')).toBe(true);
    expect(self).toHaveLength(2);
  });

  it('registerConditions добавляет хоумбрю-состояние данными (без перевыкатки)', () => {
    registerConditions([{ id: 'marked', label: 'Отмечен', modifiers: [{ applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target' }] }]);
    expect(conditionLabel('marked')).toBe('Отмечен');
    expect(conditionModifierPayloads('marked')[0].scope).toBe('target');
    expect(conditionOptions().some((o) => o.id === 'marked')).toBe(true);
  });
});
