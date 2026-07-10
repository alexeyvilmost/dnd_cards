import { describe, it, expect } from 'vitest';
import { buildMechanics, deserializeMechanics } from './blocks';
import { normalizeWhen, emptyCond, describeCond, type Cond } from './predicates';

// S1: рекурсивный редактор предикатов — сборка/разборка `when` модификаторов + миграция легаси.

const modifierOf = (m: Record<string, unknown> | null): Record<string, unknown> => {
  const eff = (m?.effects as Array<Record<string, unknown>>) ?? [];
  const auto = eff.find((e) => e.resolution === 'auto');
  return ((auto?.result as Array<Record<string, unknown>>) ?? [])[0] ?? {};
};

describe('predicate when — build', () => {
  it('eff_bonus кладёт when в модификатор, когда условия заданы', () => {
    const when: Cond[] = [{ kind: 'you_have_condition', value: 'frightened' }];
    const m = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_bonus', values: { roll: 'ac', value: '2', when } },
    ]);
    const mod = modifierOf(m);
    expect(mod.kind).toBe('modifier');
    expect(mod.op).toBe('add');
    expect(mod.when).toEqual(when);
  });

  it('eff_bonus без условий не пишет when', () => {
    const m = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_bonus', values: { roll: 'ac', value: '2' } },
    ]);
    expect(modifierOf(m).when).toBeUndefined();
  });

  it('eff_adv всегда пишет массив when (пустой — если нет условий)', () => {
    const m = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_adv', values: { roll: 'saving_throw', op: 'advantage' } },
    ]);
    expect(modifierOf(m).when).toEqual([]);
  });
});

describe('predicate when — deserialize round-trip', () => {
  it('модификатор с when возвращается в eff_bonus с сохранением условий', () => {
    const when: Cond[] = [
      { kind: 'any_of', of: [
        { kind: 'item_equipped', value: 'shield' },
        { kind: 'you_have_condition', value: 'raging' },
      ] },
    ];
    const built = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_bonus', values: { roll: 'ac', value: '2', when } },
    ]);
    const d = deserializeMechanics(built);
    const entry = d?.effectEntries[0];
    expect(entry?.blockId).toBe('eff_bonus');
    expect(entry?.values.when).toEqual(when);
  });

  it('advantage с when → eff_adv с условиями', () => {
    const built = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_adv', values: { roll: 'attack_roll', op: 'advantage', when: [{ kind: 'target_has_condition', value: 'prone' }] } },
    ]);
    const d = deserializeMechanics(built);
    expect(d?.effectEntries[0].blockId).toBe('eff_adv');
    expect(d?.effectEntries[0].values.when).toEqual([{ kind: 'target_has_condition', value: 'prone' }]);
  });

  it('фильтрованный модификатор → eff_bonus с сохранением фильтра (PC)', () => {
    const legacy = {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'attack', filter: { hand: 'main' } }, op: 'add', value: '1' }] }],
    };
    const d = deserializeMechanics(legacy);
    expect(d?.effectEntries[0].blockId).toBe('eff_bonus');
    expect(d?.effectEntries[0].values.filter).toEqual([{ key: 'hand', value: 'main' }]);
  });

  it('модификатор с незнакомым полем (priority) → сырой JSON', () => {
    const legacy = {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '1', priority: 5 }] }],
    };
    expect(deserializeMechanics(legacy)?.effectEntries[0].blockId).toBe('eff_raw_json');
  });
});

describe('legacy {kind:condition} миграция', () => {
  it('нормализуется в you_have_condition при разборке', () => {
    const legacy = {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'saving_throw' }, op: 'advantage', when: [{ kind: 'condition', id: 'frightened' }] }] }],
    };
    const d = deserializeMechanics(legacy);
    expect(d?.effectEntries[0].blockId).toBe('eff_adv');
    expect(d?.effectEntries[0].values.when).toEqual([{ kind: 'you_have_condition', value: 'frightened' }]);
  });

  it('normalizeWhen оставляет распознанные виды нетронутыми', () => {
    const when = [{ kind: 'd20_equals', value: 20 }, { kind: 'has_advantage' }];
    expect(normalizeWhen(when)).toEqual(when);
  });
});

describe('predicate helpers', () => {
  it('emptyCond групп даёт корректную форму of', () => {
    expect(emptyCond('any_of')).toEqual({ kind: 'any_of', of: [] });
    expect(emptyCond('not').of).toEqual({ kind: 'narrative' });
    expect(emptyCond('d20_equals')).toEqual({ kind: 'd20_equals', value: 1 });
  });

  it('describeCond рекурсивно описывает группы', () => {
    const c: Cond = { kind: 'not', of: { kind: 'you_have_condition', value: 'poisoned' } };
    expect(describeCond(c)).toContain('НЕ');
  });
});
