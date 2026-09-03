import { describe, expect, it } from 'vitest';
import type { ActiveEffectEntry, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { FIGHTER_CTX, freshFighterState } from '../mvp/fixtures';
import { executeAction } from './execute';

const elementalAdeptFire = {
  activation: { mode: 'passive' },
  effects: [{ resolution: 'auto', result: [
    { kind: 'modifier', op: 'deny', applies_to: { roll: 'damage', filter: { attackKind: 'spell', damageType: 'fire' } }, reason: 'ignore_spell_damage_resistance' },
    { kind: 'modifier', op: 'minimum_die', value: 2, applies_to: { roll: 'damage', filter: { attackKind: 'spell', damageType: 'fire' } }, reason: 'elemental_adept_minimum_die' },
  ] }],
};

function fireResistance(): ActiveEffectEntry {
  return {
    id: 'fire-resistance', name: 'Сопротивление огню', source: 'test',
    mechanics: { kind: 'resistance', damage_type: 'fire', value: 'resistance' },
  };
}

describe('spell-feat execution bridge', () => {
  it('Elemental Adept changes natural 1 to 2 and ignores matching resistance', () => {
    const target: RuntimeState = {
      ...freshFighterState(), hp: { current: 10, max: 10, temp: 0 },
      activeEffects: [fireResistance()],
    };
    const result = executeAction(freshFighterState(), {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [
        { kind: 'damage', dice: '1d6', type: 'fire' },
      ] }],
    }, {
      character: FIGHTER_CTX,
      passives: [elementalAdeptFire],
      spell: { baseLevel: 1, castLevel: 1, components: { verbal: true, somatic: true, material: false } },
      target: { id: 'target', runtimeState: target, characterContext: FIGHTER_CTX },
      rng: () => 0,
    } as ExecuteContext);

    expect(result.targetState?.hp.current).toBe(8);
    expect(result.events.find((event) => event.type === 'damage')).toMatchObject({ amount: 2, damageType: 'fire' });
    expect(result.events.some((event) => event.type === 'narrative'
      && 'damageAdjustment' in event)).toBe(false);
  });

  it('does not leak Elemental Adept into non-spell damage', () => {
    const target: RuntimeState = {
      ...freshFighterState(), hp: { current: 10, max: 10, temp: 0 },
      activeEffects: [fireResistance()],
    };
    const result = executeAction(freshFighterState(), {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [
        { kind: 'damage', dice: '1d6', type: 'fire' },
      ] }],
    }, {
      character: FIGHTER_CTX,
      passives: [elementalAdeptFire],
      target: { id: 'target', runtimeState: target, characterContext: FIGHTER_CTX },
      rng: () => 0,
    } as ExecuteContext);

    expect(result.targetState?.hp.current).toBe(10);
    expect(result.events.some((event) => event.type === 'narrative'
      && 'damageAdjustment' in event)).toBe(true);
  });
});
