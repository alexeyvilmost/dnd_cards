import { describe, expect, it } from 'vitest';
import type { WeaponContext } from '../mvp/contracts';
import {
  compileWeaponMasteryEffects,
  hasUsedCleaveThisTurn,
  weaponMasteryCleaveUseKey,
  weaponMasteryEvent,
  weaponMasteryPrimitive,
  weaponMasteryNickUseKey,
  type WeaponMasteryPrimitive,
} from './weaponMastery2024';
import {
  WEAPON_MASTERY_GRAZE_CHOICE_ID,
  WEAPON_MASTERY_PUSH_CHOICE_ID,
  WEAPON_MASTERY_SLOW_CHOICE_ID,
  WEAPON_MASTERY_TOPPLE_CHOICE_ID,
} from './testing/weaponMastery2024Fixtures';

const WEAPON: WeaponContext = {
  cardId: 'card:canonical-weapon',
  name: 'Canonical weapon',
  dice: '1d8',
  ability: 'str',
  damageType: 'slashing',
  damages: [{ dice: '1d8', type: 'slashing' }],
  enchant: 0,
  attackEnchant: 0,
  damageEnchant: 0,
  properties: [],
  weaponType: 'longsword',
  proficiencyCategory: 'martial',
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reachFt: 5 }],
  mastery: 'effect:canonical-mastery',
};

const MASTERIES = {
  topple: {
    type: 'topple', saveAbility: 'con', dc: '8+prof_bonus+weapon_mod',
    condition: 'prone', choiceId: WEAPON_MASTERY_TOPPLE_CHOICE_ID,
  },
  sap: {
    type: 'sap', consume: 'next', expires: 'start_of_source_next_turn',
  },
  slow: {
    type: 'slow', penaltyFt: 10, requiresDamage: true,
    expires: 'start_of_source_next_turn', choiceId: WEAPON_MASTERY_SLOW_CHOICE_ID,
  },
  vex: {
    type: 'vex', consume: 'next', targetLocked: true, requiresDamage: true,
    expires: 'end_of_source_next_turn',
  },
  push: {
    type: 'push', maxDistanceFt: 10, maxTargetSize: 'large',
    choiceId: WEAPON_MASTERY_PUSH_CHOICE_ID,
  },
  graze: {
    type: 'graze', damage: 'max(weapon_mod,0)', choiceId: WEAPON_MASTERY_GRAZE_CHOICE_ID,
  },
  nick: {
    type: 'nick', timing: 'attack_action', maximumPerTurn: 1,
  },
  cleave: {
    type: 'cleave', maximumPerTurn: 1, secondaryWithinPrimaryFt: 5,
    sameWeapon: true, positiveAbilityModifier: false, expires: 'end_of_turn',
  },
} satisfies Record<WeaponMasteryPrimitive['type'], WeaponMasteryPrimitive>;

const facts = (overrides: Record<string, unknown> = {}) => ({
  weapon: WEAPON,
  weaponMod: 3,
  targetActorId: 'pc:defender',
  targetSize: 2,
  attackRange: 'melee' as const,
  dealtDamage: true,
  attackActionId: 'attack-action:1',
  attackCommandId: 'command:hit',
  sourceEntityId: 'effect:canonical-mastery',
  firedThisTurn: [] as string[],
  ...overrides,
});

describe('PHB 2024 Weapon Mastery primitive compiler', () => {
  it('recognizes only complete exact declarations for all eight mastery types', () => {
    const types = Object.keys(MASTERIES) as WeaponMasteryPrimitive['type'][];
    for (const type of types) {
      const declaration = MASTERIES[type];
      expect(weaponMasteryPrimitive({ weapon_mastery: declaration })).toEqual(declaration);
      for (const field of Object.keys(declaration)) {
        if (field === 'type') continue;
        const incomplete = { ...declaration } as Record<string, unknown>;
        delete incomplete[field];
        expect(
          weaponMasteryPrimitive({ weapon_mastery: incomplete }),
          `${type} must reject an omitted ${field}`,
        ).toBeNull();
      }
    }
    expect(weaponMasteryPrimitive({ weapon_mastery: { type: 'EFFECT-0248' } })).toBeNull();
    expect(weaponMasteryPrimitive({ effects: [] })).toBeNull();
    expect(weaponMasteryPrimitive({ weapon_mastery: { ...MASTERIES.push, maxDistanceFt: -10 } }))
      .toBeNull();
    expect(weaponMasteryPrimitive({ weapon_mastery: { ...MASTERIES.vex, targetLocked: 'yes' } }))
      .toBeNull();
    expect(weaponMasteryPrimitive({ weapon_mastery: { ...MASTERIES.nick, maximumPerTurn: 2 } }))
      .toBeNull();
    expect(weaponMasteryPrimitive({ weapon_mastery: { ...MASTERIES.sap, unknown: true } }))
      .toBeNull();
    expect(types.map((type) => weaponMasteryEvent(MASTERIES[type])))
      .toEqual(['hit', 'hit', 'hit', 'hit', 'hit', 'miss', 'passive', 'hit']);
  });

  it('Topple compiles the canonical CON save and formula-derived DC', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.topple, facts())).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.topple, facts({ choices: {
      [WEAPON_MASTERY_TOPPLE_CHOICE_ID]: 'use',
    } }))).toEqual([{
      resolution: 'save', who: 'target', ability: 'con',
      dc: '8+prof_bonus+weapon_mod',
      on_fail: [{ kind: 'condition', value: 'prone' }], on_success: [],
    }]);
  });

  it('Sap is target-owned, consumes only the next attack and expires at source next turn', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.sap, facts())[0]).toMatchObject({
      resolution: 'auto', who: 'target', result: [{
        kind: 'modifier', op: 'disadvantage', consume: 'next',
        applies_to: { roll: 'attack' },
        duration: { type: 'until_start_of_source_next_turn' },
      }],
    });
  });

  it('Slow requires actual damage and remains a non-stacking 10-foot penalty', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.slow, facts({ dealtDamage: false }))).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.slow, facts())).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.slow, facts({ choices: {
      [WEAPON_MASTERY_SLOW_CHOICE_ID]: 'use',
    } }))[0]).toMatchObject({
      who: 'target', result: [{
        applies_to: { roll: 'speed' }, op: 'add', value: '-10',
        stack_id: 'weapon-mastery:slow', stack_type: 'overwrite',
        duration: { type: 'until_start_of_source_next_turn' },
      }],
    });
  });

  it('Vex locks advantage and consumption to the exact damaged target', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.vex, facts({ dealtDamage: false }))).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.vex, facts())[0]).toMatchObject({
      result: [{
        applies_to: { roll: 'attack', filter: { targetActorId: 'pc:defender' } },
        op: 'advantage', consume: 'next',
        duration: { type: 'until_end_of_source_next_turn' },
        stack_id: 'weapon-mastery:vex:pc:defender',
      }],
    });
  });

  it('Push accepts an explicit 0..10-foot choice only for a Large-or-smaller target', () => {
    const selected = { choices: { [WEAPON_MASTERY_PUSH_CHOICE_ID]: '10' } };
    expect(compileWeaponMasteryEffects(MASTERIES.push, facts(selected))).toEqual([{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'movement', value: 'push', distance: 10 }],
    }]);
    expect(compileWeaponMasteryEffects(MASTERIES.push, facts({ ...selected, targetSize: 4 })))
      .toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.push, facts({ ...selected, choices: {
      [WEAPON_MASTERY_PUSH_CHOICE_ID]: '15',
    } }))).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.push, facts())).toEqual([]);
  });

  it('Graze clamps a negative modifier to zero and suppresses unrelated damage modifiers', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.graze, facts())).toEqual([]);
    expect(compileWeaponMasteryEffects(MASTERIES.graze, facts({ choices: {
      [WEAPON_MASTERY_GRAZE_CHOICE_ID]: 'use',
    } }))[0]).toMatchObject({
      who: 'target', result: [{
        kind: 'damage', amount: 'max(weapon_mod,0)', type: 'slashing',
        suppress_damage_modifiers: true,
      }],
    });
  });

  it('Nick is an action-economy declaration and owns a per-turn identity', () => {
    expect(compileWeaponMasteryEffects(MASTERIES.nick, facts())).toEqual([]);
    expect(weaponMasteryNickUseKey('encounter:1:0:pc')).toBe(
      'system:dnd5e-2024:weapon-mastery:nick:encounter:1:0:pc',
    );
  });

  it('Cleave opens one melee, same-weapon, target-linked serializable follow-up per turn', () => {
    const [effect] = compileWeaponMasteryEffects(MASTERIES.cleave, facts());
    expect(effect).toMatchObject({
      resolution: 'auto', result: [{
        kind: 'attack_follow_up', follow_up: 'cleave',
        weaponCardId: WEAPON.cardId,
        primaryTargetActorId: 'pc:defender',
        attackActionId: 'attack-action:1',
        openedByCommandId: 'command:hit',
        sourceEntityId: 'effect:canonical-mastery',
        secondaryWithinPrimaryFt: 5,
        duration: { type: 'until_end_of_turn' },
      }],
    });
    expect(compileWeaponMasteryEffects(MASTERIES.cleave, facts({ attackRange: 'ranged' })))
      .toEqual([]);
    const key = weaponMasteryCleaveUseKey('encounter:1:0:pc');
    expect(hasUsedCleaveThisTurn([key])).toBe(true);
    expect(compileWeaponMasteryEffects(MASTERIES.cleave, facts({ firedThisTurn: [key] })))
      .toEqual([]);
  });

  it('takes supported rule values from declarations rather than named mastery defaults', () => {
    const topple = {
      ...MASTERIES.topple,
      saveAbility: 'wis' as const,
      dc: '12+weapon_mod',
      condition: 'restrained',
      choiceId: 'test.topple',
    };
    expect(compileWeaponMasteryEffects(topple, facts({
      choices: { 'test.topple': 'use' },
    }))[0]).toMatchObject({
      ability: 'wis', dc: '12+weapon_mod',
      on_fail: [{ kind: 'condition', value: 'restrained' }],
    });

    const slow = { ...MASTERIES.slow, penaltyFt: 15, choiceId: 'test.slow' };
    expect(compileWeaponMasteryEffects(slow, facts({
      choices: { 'test.slow': 'use' },
    }))[0]).toMatchObject({ result: [{ value: '-15' }] });

    const push = {
      ...MASTERIES.push,
      maxDistanceFt: 20,
      maxTargetSize: 'huge' as const,
      choiceId: 'test.push',
    };
    expect(compileWeaponMasteryEffects(push, facts({
      targetSize: 4,
      choices: { 'test.push': '20' },
    }))[0]).toMatchObject({ result: [{ distance: 20 }] });

    const cleave = { ...MASTERIES.cleave, secondaryWithinPrimaryFt: 15 };
    expect(compileWeaponMasteryEffects(cleave, facts())[0]).toMatchObject({
      result: [{ secondaryWithinPrimaryFt: 15 }],
    });
  });
});
