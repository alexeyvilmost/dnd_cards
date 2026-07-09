import { describe, it, expect } from 'vitest';
import { deserializeMechanics, reqRowsToRequirements } from './blocks';
import { normalizeCond, normalizeWhen, type Cond } from './predicates';

// Регрессии по находкам адверсариал-ревью конструктора (все round-trip без потерь).

describe('eff_save_damage — только точный паттерн (иначе сырой JSON)', () => {
  const wrap = (it: Record<string, unknown>) => deserializeMechanics({ activation: { mode: 'passive' }, effects: [it] });

  it('точный save→урон+половина → eff_save_damage', () => {
    const d = wrap({ resolution: 'save', who: 'target', ability: 'dex', dc: '13',
      on_fail: [{ kind: 'damage', dice: '1d6', type: 'acid' }],
      on_success: [{ kind: 'damage', dice: '1d6', type: 'acid', on_success: 'half' }] });
    expect(d?.effectEntries[0].blockId).toBe('eff_save_damage');
  });

  it('save-без-урона (on_success:[]) → сырой JSON (не дописывает половину)', () => {
    const d = wrap({ resolution: 'save', who: 'target', ability: 'dex', dc: '13',
      on_fail: [{ kind: 'damage', dice: '1d6', type: 'acid' }], on_success: [] });
    expect(d?.effectEntries[0].blockId).toBe('eff_raw_json');
  });

  it('save + состояние (доп. on_fail) → сырой JSON (не теряет состояние)', () => {
    const d = wrap({ resolution: 'save', who: 'target', ability: 'con', dc: '14',
      on_fail: [{ kind: 'damage', dice: '2d6', type: 'poison' }, { kind: 'condition', value: 'poisoned' }],
      on_success: [{ kind: 'damage', dice: '2d6', type: 'poison', on_success: 'half' }] });
    expect(d?.effectEntries[0].blockId).toBe('eff_raw_json');
  });
});

describe('trigger uses не теряется', () => {
  it('безлимитный 0-hp (без uses) → trg_custom, не капается 1/отдых', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'reduced_to_0_hp', timing: 'replaces' } }, effects: [] });
    expect(d?.triggerId).toBe('trg_custom');
    expect(d?.triggerValues.uses_count).toBe('');
  });

  it('0-hp с uses+replaces → trg_zero_hp', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'reduced_to_0_hp', timing: 'replaces' } }, uses: { count: 1, per: 'long_rest' }, effects: [] });
    expect(d?.triggerId).toBe('trg_zero_hp');
  });

  it('long_rest с uses → trg_custom (простой блок потерял бы uses)', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'long_rest', timing: 'after' } }, uses: { count: 2, per: 'long_rest' }, effects: [] });
    expect(d?.triggerId).toBe('trg_custom');
    expect(d?.triggerValues.uses_count).toBe('2');
  });

  it('d20=1 с uses → trg_custom (сохраняет count/per)', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'attack_roll_made', timing: 'replaces', circumstances: [{ kind: 'd20_equals', value: 1 }] } }, uses: { count: 3, per: 'long_rest' }, effects: [] });
    expect(d?.triggerId).toBe('trg_custom');
    expect(d?.triggerValues.uses_count).toBe('3');
  });

  it('d20=1 без uses → trg_d20_one', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'attack_roll_made', timing: 'replaces', circumstances: [{ kind: 'd20_equals', value: 1 }] } }, effects: [] });
    expect(d?.triggerId).toBe('trg_d20_one');
  });
});

describe('ability_score требование пишет ability по умолчанию', () => {
  it('без явной ability → str (как в UI)', () => {
    expect(reqRowsToRequirements([{ type: 'ability_score', min: '13' }]))
      .toEqual([{ type: 'ability_score', ability: 'str', min: 13 }]);
  });
});

describe('normalizeCond рекурсивно + предметные id→value', () => {
  it('легаси condition внутри any_of.of нормализуется', () => {
    const when: Cond[] = [{ kind: 'any_of', of: [{ kind: 'condition', id: 'frightened' }] }];
    expect(normalizeWhen(when)).toEqual([{ kind: 'any_of', of: [{ kind: 'you_have_condition', value: 'frightened' }] }]);
  });

  it('item_equipped с id → value (движок читает id ?? value)', () => {
    expect(normalizeCond({ kind: 'item_equipped', id: 'shield' })).toEqual({ kind: 'item_equipped', value: 'shield' });
  });

  it('not с вложенным легаси condition нормализуется', () => {
    const c: Cond = { kind: 'not', of: { kind: 'condition', id: 'poisoned' } };
    expect(normalizeCond(c)).toEqual({ kind: 'not', of: { kind: 'you_have_condition', value: 'poisoned' } });
  });
});
