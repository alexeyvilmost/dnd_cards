import { describe, expect, it } from 'vitest';
import { collectModifiers } from './modifiers';
import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';

function stateWith(activeEffects: ActiveEffectEntry[]): RuntimeState {
  return {
    hp: { current: 10, max: 10, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [], activeEffects,
  };
}

function modEffect(payload: Record<string, unknown>, name = 'эффект'): ActiveEffectEntry {
  return { id: `fx-${name}`, name, mechanics: payload, source: name };
}

describe('collectModifiers (фаза C)', () => {
  it('формульное значение модификатора вычисляется (rage_bonus)', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: 'rage_bonus' }, 'Ярость');
    const out = collectModifiers(stateWith([eff]), [], { roll: 'attack', formulaCtx: { rageBonus: 2 } });
    expect(out.modifiers).toEqual([{ value: 2, source: 'Ярость' }]);
  });

  it('формульный модификатор с переменной вычисляется', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: 'prof_bonus' }, 'Благословение');
    const out = collectModifiers(stateWith([eff]), [], { roll: 'attack', formulaCtx: { profBonus: 3 } });
    expect(out.modifiers).toEqual([{ value: 3, source: 'Благословение' }]);
  });

  it('без formulaCtx формульный модификатор мягко пропускается', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: 'rage_bonus' });
    const out = collectModifiers(stateWith([eff]), [], { roll: 'attack' });
    expect(out.modifiers).toEqual([]);
  });

  it('литеральный +2 работает и без formulaCtx', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+2' });
    const out = collectModifiers(stateWith([eff]), [], { roll: 'attack' });
    expect(out.modifiers[0].value).toBe(2);
  });

  it('when гейтит модификатор по состоянию цели', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', when: [{ kind: 'target_has_condition', value: 'prone' }] });
    const noAdv = collectModifiers(stateWith([eff]), [], { roll: 'attack', evalCtx: { targetConditions: new Set() } });
    expect(noAdv.advantage).toBe('none');
    const adv = collectModifiers(stateWith([eff]), [], { roll: 'attack', evalCtx: { targetConditions: new Set(['prone']) } });
    expect(adv.advantage).toBe('advantage');
  });

  it('when без evalCtx не блокирует (обратная совместимость)', () => {
    const eff = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', when: [{ kind: 'target_has_condition', value: 'prone' }] });
    const out = collectModifiers(stateWith([eff]), [], { roll: 'attack' });
    expect(out.advantage).toBe('advantage');
  });

  it('преимущество+помеха = none (2024)', () => {
    const a = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage' }, 'a');
    const d = modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage' }, 'd');
    const out = collectModifiers(stateWith([a, d]), [], { roll: 'attack' });
    expect(out.advantage).toBe('none');
  });

  it('фильтр по ability для спасбросков', () => {
    const dexOnly = modEffect({ kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'add', value: '+1' });
    const dex = collectModifiers(stateWith([dexOnly]), [], { roll: 'saving_throw', filter: { ability: 'dex' } });
    const con = collectModifiers(stateWith([dexOnly]), [], { roll: 'saving_throw', filter: { ability: 'con' } });
    expect(dex.modifiers).toHaveLength(1);
    expect(con.modifiers).toHaveLength(0);
  });
});

describe('C7 — свёртка преимущества/помехи порядко-независима (RAW 2024)', () => {
  const adv = (n: string) => modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage' }, n);
  const dis = (n: string) => modEffect({ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'disadvantage' }, n);
  const advOf = (effs: ActiveEffectEntry[]) => collectModifiers(stateWith(effs), [], { roll: 'attack' }).advantage;

  it('и преимущество, и помеха → none независимо от ПОРЯДКА и числа источников', () => {
    expect(advOf([adv('a'), dis('b'), adv('c')])).toBe('none'); // раньше бинарная свёртка давала 'advantage'
    expect(advOf([adv('a'), adv('b'), dis('c')])).toBe('none');
    expect(advOf([dis('a'), adv('b'), adv('c')])).toBe('none');
  });

  it('только преимущество → advantage; только помеха → disadvantage', () => {
    expect(advOf([adv('a'), adv('b')])).toBe('advantage');
    expect(advOf([dis('a')])).toBe('disadvantage');
  });

  it('флаги наличия выставлены (для порядко-независимого межпроходного объединения)', () => {
    const out = collectModifiers(stateWith([adv('a'), dis('b')]), [], { roll: 'attack' });
    expect(out.hasAdvantage).toBe(true);
    expect(out.hasDisadvantage).toBe(true);
    expect(out.advantage).toBe('none');
  });
});
