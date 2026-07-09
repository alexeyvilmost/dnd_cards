import { describe, it, expect } from 'vitest';
import { buildMechanics, deserializeMechanics, costRowsToCost } from './blocks';

// S3: гейты-разрешения (while / consumes_self / ammo / uses.recharge / доп. стоимость) и
// новый блок eff_grant_action с level_gate.

describe('deserialize gates', () => {
  it('извлекает while / consumes_self / ammo / recharge', () => {
    const d = deserializeMechanics({
      activation: { mode: 'passive', while: 'attuned', consumes_self: true },
      uses: { count: 1, per: 'long_rest', recharge: '5-6' },
      ammo: 'arrow',
      effects: [],
    });
    expect(d?.itemWhile).toBe('attuned');
    expect(d?.consumesSelf).toBe(true);
    expect(d?.ammo).toBe('arrow');
    expect(d?.recharge).toBe('5-6');
  });

  it('ammo-объект → card_id строкой', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, ammo: { card_id: 'bolt', name: 'Болт' }, effects: [] });
    expect(d?.ammo).toBe('bolt');
  });

  it('top-level mechanics.while тоже читается', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, while: 'carried', effects: [] });
    expect(d?.itemWhile).toBe('carried');
  });

  it('невалидный while игнорируется', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive', while: 'nonsense' }, effects: [] });
    expect(d?.itemWhile).toBe('');
  });
});

describe('cost partition', () => {
  it('active: простая экономика → мультиселект, остальное → extraCost', () => {
    const d = deserializeMechanics({
      activation: { mode: 'active', cost: [
        { resource: 'action' },
        { resource: 'spell_slot', level: 2 },
        { resource: 'item', card_id: 'potion', amount: 1 },
      ] },
      uses: { count: 'prof_bonus', per: 'long_rest' },
      effects: [],
    });
    expect(d?.triggerValues.resources).toEqual(['action']);
    expect(d?.extraCost).toEqual([
      { resource: 'spell_slot', level: '2' },
      { resource: 'item', card_id: 'potion', amount: '1' },
    ]);
  });

  it('не-active: весь cost → extraCost', () => {
    const d = deserializeMechanics({
      activation: { mode: 'reaction', trigger: { event: 'hit' }, cost: [{ resource: 'reaction' }, { resource: 'superiority_die' }] },
      effects: [],
    });
    // trg_custom не читает resources; вся стоимость идёт в extraCost
    expect(d?.extraCost).toEqual([{ resource: 'reaction' }, { resource: 'superiority_die' }]);
  });

  it('costRowsToCost конвертирует уровень/кол-во в числа', () => {
    expect(costRowsToCost([{ resource: 'spell_slot', level: '2' }])).toEqual([{ resource: 'spell_slot', level: 2 }]);
    expect(costRowsToCost([{ resource: 'item', card_id: 'potion', amount: '1' }])).toEqual([{ resource: 'item', amount: 1, card_id: 'potion' }]);
    expect(costRowsToCost([{ resource: 'hp', amount: 'self_level' }])).toEqual([{ resource: 'hp', amount: 'self_level' }]);
    expect(costRowsToCost([{ resource: '' }])).toEqual([]);
  });
});

describe('eff_grant_action', () => {
  it('build даёт grant_action с level_gate', () => {
    const m = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_grant_action', values: { value: 'second_wind', level_gate: 5 } },
    ]);
    const eff = (m?.effects as Array<Record<string, unknown>>)[0];
    const p = ((eff.result as Array<Record<string, unknown>>) ?? [])[0];
    expect(p).toEqual({ kind: 'grant_action', value: 'second_wind', level_gate: 5 });
  });

  it('level_gate 0 не пишется', () => {
    const m = buildMechanics('trg_passive', {}, [
      { blockId: 'eff_grant_action', values: { value: 'dodge', level_gate: 0 } },
    ]);
    const p = (((m?.effects as Array<Record<string, unknown>>)[0].result as Array<Record<string, unknown>>))[0];
    expect(p).toEqual({ kind: 'grant_action', value: 'dodge' });
  });

  it('deserialize grant_action(value≠dash) → eff_grant_action', () => {
    const d = deserializeMechanics({
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: 'second_wind', level_gate: 5 }] }],
    });
    expect(d?.effectEntries[0].blockId).toBe('eff_grant_action');
    expect(d?.effectEntries[0].values).toEqual({ value: 'second_wind', level_gate: 5 });
  });

  it('dash остаётся eff_dash', () => {
    const d = deserializeMechanics({
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'grant_action', value: 'dash' }] }],
    });
    expect(d?.effectEntries[0].blockId).toBe('eff_dash');
  });
});
