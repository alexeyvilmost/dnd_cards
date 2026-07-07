import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import { breakdownValue } from './breakdown';
import { seededRng } from '../mvp/fixtures';
import type { ActiveEffectEntry, CharacterContext, EngineEvent, RuntimeState } from '../mvp/contracts';

const character: CharacterContext = {
  abilityMods: { str: 2, dex: 1, con: 1, int: 0, wis: 1, cha: 0 },
  profBonus: 2,
  level: 1,
};

function freshState(activeEffects: ActiveEffectEntry[] = []): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects,
  };
}

function modEffect(payload: Record<string, unknown>, name = 'бафф'): ActiveEffectEntry {
  return { id: `fx-${name}`, name, mechanics: payload, source: name };
}

function rollEvents(events: EngineEvent[]): Extract<EngineEvent, { type: 'roll' }>[] {
  return events.filter((e): e is Extract<EngineEvent, { type: 'roll' }> => e.type === 'roll');
}

describe('Фаза C — интеграция через executeAction', () => {
  it('проверка характеристики получает модификатор эффекта (раньше игнорировался)', () => {
    const state = freshState([modEffect({ kind: 'modifier', applies_to: { roll: 'ability_check' }, op: 'add', value: '+3' })]);
    const mech = { name: 'Проверка Силы', activation: { cost: [] }, effects: [{ resolution: 'ability_check', ability: 'str' }] };
    const { events } = executeAction(state, mech, { character, rng: seededRng(1) });
    const check = rollEvents(events).find((e) => e.label.startsWith('Проверка'));
    expect(check).toBeTruthy();
    expect(check!.roll.modifiers.some((m) => m.value === 3)).toBe(true);
  });

  it('формульный модификатор атаки (переменная) применяется через executeAction', () => {
    const state = freshState([modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: 'my_bonus' }, 'Бафф')]);
    const mech = { name: 'Атака', activation: { cost: [] }, effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [] }] };
    const char: CharacterContext = { ...character, variables: { my_bonus: 2 } };
    const { events } = executeAction(state, mech, { character: char, rng: seededRng(3), target: { ac: 5 } });
    const atk = rollEvents(events).find((e) => e.label === 'Атака');
    expect(atk).toBeTruthy();
    expect(atk!.roll.modifiers.some((m) => m.value === 2)).toBe(true);
  });
});

describe('Фаза C — модификаторы эффектов на спасбросках/навыках листа', () => {
  const savePassive = { effects: [{ result: [{ kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'wis' } }, op: 'add', value: '+2' }] }] };

  it('спасбросок показывает модификатор эффекта (Аура защиты / Благословение)', () => {
    const bd = breakdownValue('save:wis', character, freshState(), [savePassive]);
    expect(bd.parts.some((p) => p.value === 2)).toBe(true);
    expect(bd.value).toBe(3); // МДР +1, не владение, +2 эффект
  });

  it('модификатор спасброска не течёт на другую характеристику (фильтр по ability)', () => {
    const bd = breakdownValue('save:con', character, freshState(), [savePassive]);
    expect(bd.value).toBe(1); // только ТЕЛ +1
  });

  it('навык показывает модификатор эффекта', () => {
    const skillPassive = { effects: [{ result: [{ kind: 'modifier', applies_to: { roll: 'ability_check', filter: { skill: 'stealth' } }, op: 'add', value: '+1' }] }] };
    const bd = breakdownValue('skill:stealth', character, freshState(), [skillPassive]);
    expect(bd.parts.some((p) => p.value === 1)).toBe(true);
  });
});
