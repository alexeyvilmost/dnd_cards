import { describe, expect, it } from 'vitest';
import {
  applyArmorOfAgathysCast,
  armorOfAgathysEffectIssue,
  armorOfAgathysValues,
  createArmorOfAgathysEffect,
  endArmorOfAgathysWithoutTemporaryHp,
  temporaryHpMeleeRetaliationPolicyFromMechanics,
  temporaryHpMeleeRetaliations,
  type ArmorOfAgathysEffectEntry,
  type ArmorOfAgathysPolicy,
  type ArmorOfAgathysRuntimeState,
} from './armorOfAgathys';

const ARMOR_OF_AGATHYS_CARD = 'SPELL-0189';
const POLICY: ArmorOfAgathysPolicy = {
  temporaryHpPerSlot: 5,
  retaliationDamagePerSlot: 5,
  retaliationDamageType: 'cold',
  retaliationTrigger: 'hit_by_melee_attack_roll',
  durationRounds: 600,
  endWhenNoTemporaryHp: true,
  minimumSlotLevel: 1,
  maximumSlotLevel: 9,
};

function effect(slotLevel = 1): ArmorOfAgathysEffectEntry {
  return createArmorOfAgathysEffect({
    id: `agathys:${slotLevel}`,
    actorId: 'warlock',
    actionId: 'spell:armor-of-agathys',
    name: 'Armor of Agathys',
    slotLevel,
    policy: POLICY,
    sourceEntityIds: ['spell-uuid', ARMOR_OF_AGATHYS_CARD],
  });
}

function state(temp = 0, activeEffects: ArmorOfAgathysEffectEntry[] = []): ArmorOfAgathysRuntimeState {
  return { hp: { current: 12, max: 12, temp }, activeEffects };
}

describe('Armor of Agathys 2024 pure lifecycle', () => {
  it('accepts only a complete data-owned Temporary HP retaliation primitive', () => {
    const valid = {
      type: 'temporary_hp_melee_retaliation',
      temporary_hp_per_slot: 5,
      retaliation_damage_per_slot: 5,
      retaliation_damage_type: 'cold',
      retaliation_trigger: 'hit_by_melee_attack_roll',
      duration_rounds: 600,
      end_when_no_temporary_hp: true,
      minimum_slot_level: 1,
      maximum_slot_level: 9,
    };
    expect(temporaryHpMeleeRetaliationPolicyFromMechanics(valid)).toEqual(POLICY);

    const invalid: unknown[] = [
      undefined,
      null,
      [],
      {},
      { ...valid, type: 'temporary_hp' },
      { ...valid, temporary_hp_per_slot: 1.5 },
      { ...valid, temporary_hp_per_slot: 0 },
      { ...valid, retaliation_damage_per_slot: 1.5 },
      { ...valid, retaliation_damage_per_slot: 0 },
      { ...valid, retaliation_damage_type: 5 },
      { ...valid, retaliation_damage_type: ' ' },
      { ...valid, retaliation_trigger: 'damaged' },
      { ...valid, duration_rounds: 1.5 },
      { ...valid, duration_rounds: 0 },
      { ...valid, end_when_no_temporary_hp: false },
      { ...valid, minimum_slot_level: 1.5 },
      { ...valid, minimum_slot_level: 0 },
      { ...valid, maximum_slot_level: 1.5 },
      { ...valid, maximum_slot_level: 0 },
    ];
    for (const mechanics of invalid) {
      expect(temporaryHpMeleeRetaliationPolicyFromMechanics(mechanics)).toBeNull();
    }
  });

  it('scales both Temporary HP and Cold retaliation by exactly 5 per slot level', () => {
    for (let level = 1; level <= 9; level += 1) {
      expect(armorOfAgathysValues(level, POLICY)).toEqual({
        temporaryHp: level * 5,
        retaliationDamage: level * 5,
      });
      expect(effect(level)).toMatchObject({
        roundsLeft: POLICY.durationRounds,
        ownerId: 'warlock', sourceId: 'warlock',
        mechanics: {
          kind: 'temporary_hp_melee_retaliation', slotLevel: level,
          temporaryHpPerSlot: 5,
          retaliationDamagePerSlot: 5,
          retaliationDamage: level * 5,
          retaliationDamageType: 'cold',
          endWhenNoTemporaryHp: true,
          trigger: { event: 'hit_by_melee_attack_roll' },
          sourceEntityIds: [ARMOR_OF_AGATHYS_CARD, 'spell-uuid'],
        },
      });
    }
    for (const level of [0, 1.5, 10, Number.NaN]) {
      expect(() => armorOfAgathysValues(level, POLICY)).toThrow(/slot level/);
    }
  });

  it('applies the general Temporary HP choice and replaces only the actor’s previous copy', () => {
    const foreign = { ...effect(1), id: 'foreign', ownerId: 'other', sourceId: 'other' };
    const old = effect(1);
    const otherAction = createArmorOfAgathysEffect({
      id: 'other-action', actorId: 'warlock', actionId: 'spell:other-ward',
      name: 'Other Ward', slotLevel: 1, policy: POLICY, sourceEntityIds: ['CARD-other-ward'],
    });
    const base = state(8, [old, otherAction, foreign]);
    const kept = applyArmorOfAgathysCast({
      state: base, effect: effect(2), temporaryHpChoice: 'keep_current',
    });
    expect(kept.hp.temp).toBe(8);
    expect(kept.activeEffects.map(({ id }) => id)).toEqual([
      'other-action', 'foreign', 'agathys:2',
    ]);
    const taken = applyArmorOfAgathysCast({
      state: base, effect: effect(2), temporaryHpChoice: 'take_spell',
    });
    expect(taken.hp.temp).toBe(10);
    expect(base).toEqual(state(8, [old, otherAction, foreign]));

    const immediateEnd = applyArmorOfAgathysCast({
      state: state(0, [old]), effect: effect(1), temporaryHpChoice: 'keep_current',
    });
    expect(immediateEnd.activeEffects).toEqual([]);
    expect(() => applyArmorOfAgathysCast({
      state: state(-1), effect: effect(1), temporaryHpChoice: 'take_spell',
    })).toThrow(/Temporary HP state/);
    expect(() => applyArmorOfAgathysCast({
      state: state(), effect: effect(1),
      temporaryHpChoice: 'forged' as 'take_spell',
    })).toThrow(/explicit Temporary HP choice/);
  });

  it('retaliates on a creature’s successful melee attack roll using pre-hit Temporary HP', () => {
    const retaliation = temporaryHpMeleeRetaliations({
      effects: [effect(1)],
      facts: {
        defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
        attackRollKind: 'melee', temporaryHpBeforeHit: 5,
      },
    });
    expect(retaliation).toEqual([{
      effectId: 'agathys:1', sourceActionId: 'spell:armor-of-agathys',
      damageType: 'cold', amount: 5,
      sourceEntityIds: [ARMOR_OF_AGATHYS_CARD, 'spell-uuid'],
    }]);
    expect(temporaryHpMeleeRetaliations({
      effects: [effect(1), effect(2)],
      facts: {
        defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
        attackRollKind: 'melee', temporaryHpBeforeHit: 1,
      },
    }).map(({ amount }) => amount)).toEqual([5, 10]);
    const tied = temporaryHpMeleeRetaliations({
      effects: [{ ...effect(1), id: 'z-effect' }, { ...effect(1), id: 'a-effect' }],
      facts: {
        defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
        attackRollKind: 'melee', temporaryHpBeforeHit: 5,
      },
    });
    expect(tied.map(({ effectId }) => effectId)).toEqual(['a-effect', 'z-effect']);
    expect(temporaryHpMeleeRetaliations({
      effects: [{ ...effect(1), ownerId: 'forged' }],
      facts: {
        defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
        attackRollKind: 'melee', temporaryHpBeforeHit: 5,
      },
    })).toEqual([]);
    expect(temporaryHpMeleeRetaliations({
      effects: [{
        id: 'unrelated',
        name: 'Bless',
        mechanics: { kind: 'modifier' },
        source: 'Bless',
      }],
      facts: {
        defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
        attackRollKind: 'melee', temporaryHpBeforeHit: 5,
      },
    })).toEqual([]);
  });

  it('does not retaliate on misses, ranged/non-attack hits, self hits, or no pre-hit Temporary HP', () => {
    const base = {
      defenderActorId: 'warlock', attackerActorId: 'fighter', hit: true,
      attackRollKind: 'melee' as const, temporaryHpBeforeHit: 5,
    };
    for (const facts of [
      { ...base, hit: false },
      { ...base, attackRollKind: 'ranged' as const },
      { ...base, attackRollKind: 'none' as const },
      { ...base, attackerActorId: 'warlock' },
      { ...base, temporaryHpBeforeHit: 0 },
      { ...base, temporaryHpBeforeHit: 1.5 },
    ]) {
      expect(temporaryHpMeleeRetaliations({ effects: [effect(1)], facts })).toEqual([]);
    }
    expect(temporaryHpMeleeRetaliations({ effects: [], facts: base })).toEqual([]);
  });

  it('ends only its own active effect once the defender has no Temporary HP', () => {
    const other = {
      id: 'other', name: 'Other', mechanics: { kind: 'modifier' }, source: 'Other',
    } as ArmorOfAgathysEffectEntry;
    const active = state(1, [effect(1), other]);
    expect(endArmorOfAgathysWithoutTemporaryHp(active)).toBe(active);
    const ended = endArmorOfAgathysWithoutTemporaryHp(state(0, [effect(1), other]));
    expect(ended.activeEffects).toEqual([other]);
    const unchanged = state(0, [other]);
    expect(endArmorOfAgathysWithoutTemporaryHp(unchanged)).toBe(unchanged);
  });

  it('validates persisted retaliation state fail-closed and ignores unrelated effects', () => {
    const valid = effect(1);
    expect(armorOfAgathysEffectIssue(valid, 'warlock')).toBeNull();
    expect(armorOfAgathysEffectIssue({
      ...valid,
      name: 'Доспех Агатиса',
      source: 'перевод:ru',
      mechanics: { ...valid.mechanics, sourceEntityIds: ['custom-spell-entity'] },
    }, 'warlock')).toBeNull();
    const cases: Array<[unknown, RegExp]> = [
      [{ ...valid, id: ' ' }, /stable identity/],
      [{ ...valid, name: ' ' }, /stable identity/],
      [{ ...valid, source: ' ' }, /stable identity/],
      [{ ...valid, ownerId: 'other' }, /owner and source/],
      [{ ...valid, sourceId: 'other' }, /owner and source/],
      [{ ...valid, roundsLeft: 0 }, /duration/],
      [{ ...valid, roundsLeft: 601 }, /duration/],
      [{ ...valid, mechanics: { ...valid.mechanics, retaliationDamage: 6 } }, /inconsistent/],
      [{ ...valid, mechanics: { ...valid.mechanics, slotLevel: 1.5 } }, /inconsistent/],
      [{ ...valid, mechanics: { ...valid.mechanics, actionId: ' ' } }, /source action/],
      [{ ...valid, mechanics: { ...valid.mechanics, trigger: { event: 'hit' } } }, /trigger/],
      [{ ...valid, mechanics: { ...valid.mechanics, endWhenNoTemporaryHp: false } }, /trigger/],
      [{ ...valid, mechanics: { ...valid.mechanics, sourceEntityIds: [] } }, /provenance/],
      [{ ...valid, mechanics: {
        ...valid.mechanics, sourceEntityIds: [ARMOR_OF_AGATHYS_CARD, ARMOR_OF_AGATHYS_CARD],
      } }, /provenance/],
      [{ ...valid, mechanics: {
        ...valid.mechanics, sourceEntityIds: ['spell-uuid', ARMOR_OF_AGATHYS_CARD],
      } }, /provenance/],
      [{ ...valid, mechanics: {
        ...valid.mechanics, sourceEntityIds: [ARMOR_OF_AGATHYS_CARD, null],
      } }, /provenance/],
      [{ ...valid, mechanics: {
        ...valid.mechanics, sourceEntityIds: [` ${ARMOR_OF_AGATHYS_CARD}`],
      } }, /provenance/],
    ];
    for (const [candidate, message] of cases) {
      expect(armorOfAgathysEffectIssue(candidate, 'warlock')).toMatch(message);
    }
    expect(armorOfAgathysEffectIssue({
      id: 'other', mechanics: { kind: 'resistance' },
    }, 'warlock')).toBeNull();
    expect(armorOfAgathysEffectIssue(undefined, 'warlock')).toBeNull();
    expect(armorOfAgathysEffectIssue({
      ...valid, mechanics: { ...valid.mechanics, sourceEntityIds: 'forged' },
    }, 'warlock')).toMatch(/provenance/);
    expect(() => applyArmorOfAgathysCast({
      state: state(), effect: { ...valid, ownerId: undefined },
      temporaryHpChoice: 'take_spell',
    })).toThrow(/owner and source/);
    expect(() => createArmorOfAgathysEffect({
      id: '', actorId: 'warlock', actionId: 'spell', slotLevel: 1,
      name: 'Armor of Agathys', policy: POLICY,
      sourceEntityIds: [ARMOR_OF_AGATHYS_CARD],
    })).toThrow(/stable id/);
    expect(() => createArmorOfAgathysEffect({
      id: 'effect', actorId: '', actionId: 'spell', slotLevel: 1,
      name: 'Armor of Agathys', policy: POLICY,
      sourceEntityIds: [ARMOR_OF_AGATHYS_CARD],
    })).toThrow(/stable id/);
    expect(() => createArmorOfAgathysEffect({
      id: 'effect', actorId: 'warlock', actionId: '', slotLevel: 1,
      name: 'Armor of Agathys', policy: POLICY,
      sourceEntityIds: [ARMOR_OF_AGATHYS_CARD],
    })).toThrow(/stable id/);
    expect(createArmorOfAgathysEffect({
      id: 'effect', actorId: 'warlock', actionId: 'spell', slotLevel: 1,
      name: 'Armor of Agathys', policy: POLICY,
      sourceEntityIds: ['foreign'],
    }).mechanics.sourceEntityIds).toEqual(['foreign']);
    expect(() => createArmorOfAgathysEffect({
      id: 'effect', actorId: 'warlock', actionId: 'spell', slotLevel: 1,
      name: 'Armor of Agathys', policy: POLICY,
      sourceEntityIds: [],
    })).toThrow(/provenance/);
  });
});
