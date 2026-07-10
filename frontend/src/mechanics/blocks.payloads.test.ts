import { describe, it, expect } from 'vitest';
import { buildMechanics, deserializeMechanics } from './blocks';

// PA: простые payload-блоки — сборка payload'а + round-trip разборки.

const payloadOf = (m: Record<string, unknown> | null): Record<string, unknown> => {
  const eff = (m?.effects as Array<Record<string, unknown>>) ?? [];
  const auto = eff.find((e) => e.resolution === 'auto');
  return ((auto?.result as Array<Record<string, unknown>>) ?? [])[0] ?? {};
};
const build1 = (blockId: string, values: Record<string, unknown>) =>
  payloadOf(buildMechanics('trg_passive', {}, [{ blockId, values }]));
const backBlock = (payload: Record<string, unknown>) =>
  deserializeMechanics({ activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [payload] }] })?.effectEntries[0];

describe('eff_damage', () => {
  it('build кубы+тип', () => {
    expect(build1('eff_damage', { dice: '2d6', damage_type: 'fire' })).toEqual({ kind: 'damage', dice: '2d6', type: 'fire' });
  });
  it('round-trip простого урона', () => {
    expect(backBlock({ kind: 'damage', dice: '2d6', type: 'fire' })?.blockId).toBe('eff_damage');
  });
  it('урон со scaling → сырой JSON (без потерь)', () => {
    expect(backBlock({ kind: 'damage', dice: '1d6', type: 'fire', scaling: { dice: '1d6', per: 'spell_slot_above' } })?.blockId).toBe('eff_raw_json');
  });
  it('урон с ability (фильтр Rage) → сырой JSON', () => {
    expect(backBlock({ kind: 'damage', dice: '1d6', type: 'necrotic', ability: 'cha' })?.blockId).toBe('eff_raw_json');
  });
});

describe('eff_condition', () => {
  it('build наложить', () => {
    expect(build1('eff_condition', { value: 'poisoned', op: 'apply' })).toEqual({ kind: 'condition', value: 'poisoned', op: 'apply' });
  });
  it('round-trip', () => {
    expect(backBlock({ kind: 'condition', value: 'prone', op: 'remove' })?.blockId).toBe('eff_condition');
  });
  it('состояние с save_ends → сырой JSON', () => {
    expect(backBlock({ kind: 'condition', value: 'poisoned', save_ends: { ability: 'con', dc: '13' } })?.blockId).toBe('eff_raw_json');
  });
  it('состояние с stack_priority → сырой JSON (влияет на стекинг)', () => {
    expect(backBlock({ kind: 'condition', value: 'frightened', op: 'apply', stack_priority: 2 })?.blockId).toBe('eff_raw_json');
  });
});

describe('прочие payload-блоки', () => {
  it('eff_movement', () => {
    expect(build1('eff_movement', { value: 'push', distance: '15' })).toEqual({ kind: 'movement', value: 'push', distance: '15' });
    expect(backBlock({ kind: 'movement', value: 'pull', distance: '10' })?.blockId).toBe('eff_movement');
  });
  it('eff_add_item', () => {
    expect(build1('eff_add_item', { card_id: 'potion', qty: 2, name: 'Зелье' })).toEqual({ kind: 'add_item', card_id: 'potion', qty: 2, name: 'Зелье' });
    expect(backBlock({ kind: 'add_item', card_id: 'potion', qty: 2 })?.blockId).toBe('eff_add_item');
  });
  it('eff_boon (applies_to из строки)', () => {
    expect(build1('eff_boon', { id: 'bardic_inspiration', die: '1d8', applies_to: 'attack_roll, ability_check' }))
      .toEqual({ kind: 'boon', id: 'bardic_inspiration', die: '1d8', applies_to: ['attack_roll', 'ability_check'] });
    const back = backBlock({ kind: 'boon', id: 'x', die: '1d6', applies_to: ['attack_roll'] });
    expect(back?.blockId).toBe('eff_boon');
    expect(back?.values.applies_to).toBe('attack_roll');
  });
  it('eff_grant_expertise', () => {
    expect(build1('eff_grant_expertise', { prof: 'skill', value: 'stealth' })).toEqual({ kind: 'grant_expertise', prof: 'skill', value: 'stealth' });
    expect(backBlock({ kind: 'grant_expertise', prof: 'skill', value: 'stealth' })?.blockId).toBe('eff_grant_expertise');
  });
  it('eff_grant_language', () => {
    expect(build1('eff_grant_language', { value: 'draconic' })).toEqual({ kind: 'grant_language', value: 'draconic' });
    expect(backBlock({ kind: 'grant_language', value: 'draconic' })?.blockId).toBe('eff_grant_language');
  });
  it('eff_value_method', () => {
    expect(build1('eff_value_method', { target: 'con', formula: '19' })).toEqual({ kind: 'value_method', target: 'con', formula: '19' });
    expect(backBlock({ kind: 'value_method', target: 'con', formula: '19' })?.blockId).toBe('eff_value_method');
  });
  it('eff_variable', () => {
    expect(build1('eff_variable', { id: 'rage_used', value: '' })).toEqual({ kind: 'variable', id: 'rage_used' });
    expect(backBlock({ kind: 'variable', id: 'rage_used' })?.blockId).toBe('eff_variable');
  });
  it('eff_transform эмитит form (движок читает form, не into), round-trip', () => {
    expect(build1('eff_transform', { into: 'wolf', max_cr: '1' })).toEqual({ kind: 'transform', form: 'wolf', max_cr: '1' });
    expect(backBlock({ kind: 'transform', form: 'wolf' })?.blockId).toBe('eff_transform');
    expect(backBlock({ kind: 'transform', into: 'wolf' })?.blockId).toBe('eff_transform');
  });
});

describe('eff_set_value расширенные цели', () => {
  it('temp_hp/max_hp', () => {
    expect(build1('eff_set_value', { target: 'temp_hp', formula: '5' })).toEqual({ kind: 'set_value', target: 'temp_hp', formula: '5' });
    expect(backBlock({ kind: 'set_value', target: 'max_hp', formula: '10' })?.blockId).toBe('eff_set_value');
  });
  it('#8: ac_base (Доспех мага) авторится блоком', () => {
    expect(build1('eff_set_value', { target: 'ac_base', formula: '13+dex' })).toEqual({ kind: 'set_value', target: 'ac_base', formula: '13+dex' });
    expect(backBlock({ kind: 'set_value', target: 'ac_base', formula: '13+dex' })?.blockId).toBe('eff_set_value');
  });
  it('set_value с payload-duration → сырой JSON (блок не несёт per-payload длительность)', () => {
    expect(backBlock({ kind: 'set_value', target: 'ac_base', formula: '13+dex', duration: { type: 'hours', amount: 8 } })?.blockId).toBe('eff_raw_json');
  });
});

describe('PC: глубина модификатора (op/scope/filter)', () => {
  it('eff_bonus: op multiply + scope target + filter', () => {
    const p = build1('eff_bonus', { roll: 'attack_roll', op: 'multiply', value: '2', scope: 'target', filter: [{ key: 'hand', value: 'main' }] });
    expect(p).toEqual({ kind: 'modifier', applies_to: { roll: 'attack_roll', filter: { hand: 'main' } }, op: 'multiply', value: '2', scope: 'target' });
  });
  it('eff_bonus: пустой фильтр не пишет applies_to.filter', () => {
    const p = build1('eff_bonus', { roll: 'ac', op: 'add', value: '1', scope: 'self', filter: [] });
    expect(p).toEqual({ kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '1' });
  });
  it('round-trip: set + filter + scope → eff_bonus', () => {
    const back = backBlock({ kind: 'modifier', applies_to: { roll: 'ac', filter: { ability: 'dex' } }, op: 'set', value: '13', scope: 'target' });
    expect(back?.blockId).toBe('eff_bonus');
    expect(back?.values.op).toBe('set');
    expect(back?.values.scope).toBe('target');
    expect(back?.values.filter).toEqual([{ key: 'ability', value: 'dex' }]);
  });
  it('eff_adv с scope target', () => {
    const p = build1('eff_adv', { roll: 'attack_roll', op: 'disadvantage', scope: 'target', filter: [] });
    expect(p).toEqual({ kind: 'modifier', applies_to: { roll: 'attack_roll' }, op: 'disadvantage', when: [], scope: 'target' });
  });
});

describe('eff_attack_damage (attack_roll)', () => {
  const buildAttack = (values: Record<string, unknown>) => {
    const m = buildMechanics('trg_passive', {}, [{ blockId: 'eff_attack_damage', values }]);
    return (m?.effects as Array<Record<string, unknown>>).find((e) => e.resolution === 'attack_roll');
  };
  it('build attack_roll + on_hit урон', () => {
    expect(buildAttack({ ability: 'dex', dice: '1d8', damage_type: 'piercing' }))
      .toEqual({ resolution: 'attack_roll', ability: 'dex', on_hit: [{ kind: 'damage', dice: '1d8', type: 'piercing' }] });
  });
  it('round-trip точного паттерна → eff_attack_damage', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, effects: [{ resolution: 'attack_roll', ability: 'auto', on_hit: [{ kind: 'damage', dice: '1d8', type: 'slashing' }] }] });
    expect(d?.effectEntries[0].blockId).toBe('eff_attack_damage');
  });
  it('attack с on_crit → сырой JSON (без потерь)', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, effects: [{ resolution: 'attack_roll', ability: 'auto', on_hit: [{ kind: 'damage', dice: '1d8', type: 'slashing' }], on_crit: [{ kind: 'damage', dice: '2d8', type: 'slashing' }] }] });
    expect(d?.effectEntries[0].blockId).toBe('eff_raw_json');
  });
  it('attack с inner scaling (каст-атака) → сырой JSON (не теряет масштабирование)', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, effects: [{ resolution: 'attack_roll', ability: 'spellcasting', on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire', scaling: { per: 'character_level', dice: '1d10' } }] }] });
    expect(d?.effectEntries[0].blockId).toBe('eff_raw_json');
  });
});
