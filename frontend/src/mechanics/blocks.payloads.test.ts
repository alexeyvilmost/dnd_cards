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
  it('build кубы+тип+модификатор', () => {
    expect(build1('eff_damage', { dice: '2d6', damage_type: 'fire', ability: 'int' }))
      .toEqual({ kind: 'damage', dice: '2d6', type: 'fire', ability: 'int' });
  });
  it('ability=none не пишется', () => {
    expect(build1('eff_damage', { dice: '1d4', damage_type: 'cold', ability: 'none' }))
      .toEqual({ kind: 'damage', dice: '1d4', type: 'cold' });
  });
  it('round-trip простого урона', () => {
    expect(backBlock({ kind: 'damage', dice: '2d6', type: 'fire' })?.blockId).toBe('eff_damage');
  });
  it('урон со scaling → сырой JSON (без потерь)', () => {
    expect(backBlock({ kind: 'damage', dice: '1d6', type: 'fire', scaling: { dice: '1d6', per: 'spell_slot_above' } })?.blockId).toBe('eff_raw_json');
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
  it('eff_transform эмитит настоящий transform (не narrative)', () => {
    expect(build1('eff_transform', { into: 'wolf', max_cr: '1' })).toEqual({ kind: 'transform', into: 'wolf', max_cr: '1' });
    expect(backBlock({ kind: 'transform', into: 'wolf' })?.blockId).toBe('eff_transform');
  });
});

describe('eff_set_value расширенные цели', () => {
  it('temp_hp/max_hp', () => {
    expect(build1('eff_set_value', { target: 'temp_hp', formula: '5' })).toEqual({ kind: 'set_value', target: 'temp_hp', formula: '5' });
    expect(backBlock({ kind: 'set_value', target: 'max_hp', formula: '10' })?.blockId).toBe('eff_set_value');
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
});
