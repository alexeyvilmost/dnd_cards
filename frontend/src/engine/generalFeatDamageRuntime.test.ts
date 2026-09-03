import { describe, expect, it } from 'vitest';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { applyIncomingDamage, executeAction } from './execute';
import {
  CRUSHER_CAPABILITY,
  CROSSBOW_EXPERT_CAPABILITY,
  GREAT_WEAPON_MASTER_CAPABILITY,
  PIERCER_CAPABILITY,
  PIERCER_USE_KEY,
  SLASHER_CAPABILITY,
  generalFeatWeaponDamagePassives,
} from '../rules-core/generalFeatDamageRuntime';
import type { ActorState } from '../rules-core/domain';
import type { WeaponProfile } from '../rules-core/weaponProfile';
import { CARD_DAGGER } from '../mvp/fixtures';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

const abilities = { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 } as const;
const armor = (defenseType: 'heavy' | 'light') => ({
  id: `armor:${defenseType}`, name: defenseType, type: 'chest', slot: 'body',
  defense_type: defenseType, bonus_type: 'defense', bonus_value: '16',
});
const character = (defenseType: 'heavy' | 'light' = 'heavy'): CharacterContext => ({
  abilityMods: abilities, abilityScores: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  profBonus: 3, level: 5, classLevels: { fighter: 5 }, equippedCards: [armor(defenseType) as never],
});
const state = (defenseType: 'heavy' | 'light' = 'heavy'): RuntimeState => ({
  hp: { current: 20, max: 20, temp: 0 }, resources: {}, maxResources: {},
  equipment: { body: `armor:${defenseType}` }, inventory: [], activeEffects: [], firedThisTurn: [],
});
const ham = {
  id: 'EFF-general-FEAT-0031', name: 'Мастер тяжёлых доспехов',
  sourceEntityIds: ['FEAT-0031', 'EFF-general-FEAT-0031'],
  capabilities: [{ id: 'general_feat.heavy_armor_master' }],
  effects: [{ resolution: 'auto', result: [{
    kind: 'reduce_damage', amount: 'prof',
    filter: { source: 'attack', damage_types: ['bludgeoning', 'piercing', 'slashing'], armor: 'heavy' },
  }] }],
};
const ctx = (defenseType: 'heavy' | 'light' = 'heavy', owned = true, attackCommandId = 'attack-1') => ({
  character: character(defenseType), rng: () => 0.5, attackCommandId,
  passives: owned ? [ham] : [],
}) as ExecuteContext;

describe('Heavy Armor Master 2024 damage continuation', () => {
  it.each(['bludgeoning', 'piercing', 'slashing'])('reduces %s attack damage by PB', (damageType) => {
    const result = applyIncomingDamage(state(), 10, ctx(), { damageType, delivery: 'attack' });
    expect(result.state.hp.current).toBe(13);
    expect(result.events).toContainEqual(expect.objectContaining({ type: 'damage_reduction', amount: 3 }));
  });

  it('does not carry the obsolete nonmagical-attack restriction', () => {
    const payload = (ham.effects[0].result[0] as { filter: Record<string, unknown> }).filter;
    expect(payload).toEqual({
      source: 'attack',
      damage_types: ['bludgeoning', 'piercing', 'slashing'],
      armor: 'heavy',
    });
    expect(payload).not.toHaveProperty('magical');
    expect(payload).not.toHaveProperty('nonmagical');
    expect(applyIncomingDamage(state(), 10, ctx(), {
      damageType: 'slashing', delivery: 'attack',
    }).state.hp.current).toBe(13);
  });

  it('fails closed without ownership, Heavy armor, attack delivery, or physical damage', () => {
    expect(applyIncomingDamage(state(), 10, ctx('heavy', false), { damageType: 'slashing', delivery: 'attack' }).state.hp.current).toBe(10);
    expect(applyIncomingDamage(state('light'), 10, ctx('light'), { damageType: 'slashing', delivery: 'attack' }).state.hp.current).toBe(10);
    expect(applyIncomingDamage(state(), 10, ctx(), { damageType: 'slashing', delivery: 'other' }).state.hp.current).toBe(10);
    expect(applyIncomingDamage(state(), 10, ctx(), { damageType: 'fire', delivery: 'attack' }).state.hp.current).toBe(10);
  });

  it('reduces once per attack command, again on the next attack, and never below zero', () => {
    const first = applyIncomingDamage(state(), 2, ctx(), { damageType: 'slashing', delivery: 'attack' });
    expect(first.state.hp.current).toBe(20);
    const sameAttackSecondPacket = applyIncomingDamage(first.state, 5, ctx(), { damageType: 'piercing', delivery: 'attack' });
    expect(sameAttackSecondPacket.state.hp.current).toBe(15);
    const nextAttack = applyIncomingDamage(sameAttackSecondPacket.state, 5, ctx('heavy', true, 'attack-2'), { damageType: 'piercing', delivery: 'attack' });
    expect(nextAttack.state.hp.current).toBe(13);
  });
});

const actor = (capabilities: string[]): ActorState => ({
  id: 'a', name: 'A', kind: 'playerCharacter', controllerId: 'a',
  capabilities: {
    actionIds: [],
    featureSources: Object.fromEntries(capabilities.map((id) => [id, [`source:${id}`]])),
  },
  character: character(), runtime: state(),
});
const profile = (properties: string[], damageType = 'slashing'): WeaponProfile => ({
  weaponType: 'greatsword', proficiencyCategory: 'martial', attackAbility: 'str',
  damageLines: [{ dice: '2d6', type: damageType }], defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reachFt: 5 }], properties, masteryEffectId: 'mastery:graze',
  ammo: null, enchantment: { attackBonus: 0, damageBonus: 0, extraDamageLines: [] },
  attunement: { required: false },
});

describe('weapon-bound General feat damage passives', () => {
  it('binds GWM only to owned Heavy weapon attacks on the actor turn', () => {
    const owned = actor([GREAT_WEAPON_MASTER_CAPABILITY]);
    expect(generalFeatWeaponDamagePassives({ actor: owned, profile: profile(['heavy']), attackActionId: 'aa', ownTurn: true })).toHaveLength(1);
    expect(generalFeatWeaponDamagePassives({ actor: owned, profile: profile([]), attackActionId: 'aa', ownTurn: true })).toHaveLength(0);
    expect(generalFeatWeaponDamagePassives({ actor: owned, profile: profile(['heavy']), attackActionId: 'aa', ownTurn: false })).toHaveLength(0);
    expect(generalFeatWeaponDamagePassives({ actor: actor([]), profile: profile(['heavy']), attackActionId: 'aa', ownTurn: true })).toHaveLength(0);
  });

  it('adds PB exactly once to a Heavy weapon damage roll', () => {
    const greatsword = withDeclaredTestWeaponProfile({ ...CARD_DAGGER, id: 'greatsword', name: 'Greatsword' }, {
      weaponType: 'greatsword', proficiencyCategory: 'martial', attackAbility: 'str',
      damageLines: [{ dice: '2d6', type: 'slashing' }], defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['heavy', 'two_handed'],
      masteryEffectId: 'mastery:graze',
    });
    const owner = actor([GREAT_WEAPON_MASTER_CAPABILITY]);
    owner.character = { ...owner.character, equippedCards: [greatsword] };
    owner.runtime = { ...owner.runtime, equipment: { main_hand: greatsword.id }, inventory: [{ cardId: greatsword.id, qty: 1 }] };
    const [passive] = generalFeatWeaponDamagePassives({ actor: owner, profile: profile(['heavy']), attackActionId: 'aa', ownTurn: true });
    const tape = [0.5, 0, 0];
    const result = executeAction(owner.runtime, {
      activation: { cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    }, {
      character: owner.character, passives: [passive], rng: () => tape.shift() ?? 0,
      target: { id: 't', ac: 1, characterContext: owner.character, runtimeState: state() },
    });
    const damage = result.events.find((event) => event.type === 'damage');
    expect(damage?.type === 'damage' ? damage.amount : 0).toBe(5);
  });

  it('binds Piercer only to an owned piercing weapon and carries its once-per-turn key', () => {
    const owned = actor([PIERCER_CAPABILITY]);
    const passives = generalFeatWeaponDamagePassives({ actor: owned, profile: profile([], 'piercing'), attackActionId: 'aa', ownTurn: true });
    expect(JSON.stringify(passives)).toContain(PIERCER_USE_KEY);
    expect(generalFeatWeaponDamagePassives({ actor: owned, profile: profile([], 'slashing'), attackActionId: 'aa', ownTurn: true })).toHaveLength(0);
    expect(generalFeatWeaponDamagePassives({ actor: actor([]), profile: profile([], 'piercing'), attackActionId: 'aa', ownTurn: true })).toHaveLength(0);
  });

  it('rerolls one piercing damage die with the new result, then closes for the turn', () => {
    const dagger = withDeclaredTestWeaponProfile(CARD_DAGGER, {
      weaponType: 'dagger', proficiencyCategory: 'simple', attackAbility: 'finesse',
      damageLines: [{ dice: '1d4', type: 'piercing' }], defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['finesse', 'light', 'thrown'],
      masteryEffectId: 'mastery:nick',
    });
    const owner = actor([PIERCER_CAPABILITY]);
    owner.character = { ...owner.character, equippedCards: [dagger] };
    owner.runtime = { ...owner.runtime, equipment: { main_hand: dagger.id }, inventory: [{ cardId: dagger.id, qty: 1 }] };
    const [passive] = generalFeatWeaponDamagePassives({ actor: owner, profile: profile([], 'piercing'), attackActionId: 'aa', ownTurn: true });
    const action = {
      activation: { cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    };
    const run = (runtime: RuntimeState) => {
      const tape = [0.9, 0, 0.9];
      return executeAction(runtime, action, {
        character: owner.character, passives: [passive], rng: () => tape.shift() ?? 0.5,
        target: { id: 't', ac: 5, characterContext: owner.character, runtimeState: state() },
      });
    };
    const first = run(owner.runtime);
    const firstDamage = first.events.find((event) => event.type === 'damage');
    expect(firstDamage?.type === 'damage' ? firstDamage.amount : 0).toBe(4);
    expect(first.state.firedThisTurn).toContain(PIERCER_USE_KEY);
    const second = run(first.state);
    const secondDamage = second.events.find((event) => event.type === 'damage');
    expect(secondDamage?.type === 'damage' ? secondDamage.amount : 0).toBe(1);
  });

  it('adds exactly one weapon die after the normal critical doubling for Piercer', () => {
    const dagger = withDeclaredTestWeaponProfile(CARD_DAGGER, {
      weaponType: 'dagger', proficiencyCategory: 'simple', attackAbility: 'finesse',
      damageLines: [{ dice: '1d4', type: 'piercing' }], defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: ['finesse', 'light', 'thrown'],
      masteryEffectId: 'mastery:nick',
    });
    const owner = actor([PIERCER_CAPABILITY]);
    owner.character = { ...owner.character, equippedCards: [dagger] };
    owner.runtime = { ...owner.runtime, equipment: { main_hand: dagger.id }, inventory: [{ cardId: dagger.id, qty: 1 }] };
    const passives = generalFeatWeaponDamagePassives({
      actor: owner, profile: profile([], 'piercing'), attackActionId: 'aa', ownTurn: true,
    });
    const tape = [0.999, 0, 0, 0.25, 0.25, 0.5];
    const result = executeAction(owner.runtime, {
      activation: { cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    }, {
      character: owner.character, passives, rng: () => tape.shift() ?? 0, selfId: owner.id,
      target: { id: 't', ac: 1, characterContext: owner.character, runtimeState: state() },
    });
    const damage = result.events.find((event) => event.type === 'damage');
    expect(damage?.type === 'damage' ? damage.amount : 0).toBe(7);
    expect(damage?.type === 'damage' ? damage.roll?.dice.filter((die) => !die.discarded) : [])
      .toHaveLength(3);
  });

  it('adds the ability modifier only to the Crossbow Expert Light-property extra attack', () => {
    const owner = actor([CROSSBOW_EXPERT_CAPABILITY]);
    const crossbow = { ...profile(['light'], 'piercing'), weaponType: 'hand_crossbow' };
    const passives = generalFeatWeaponDamagePassives({
      actor: owner, profile: crossbow, attackActionId: 'attack-1', ownTurn: true,
      extraAttackSource: 'light_property',
    });
    expect(passives).toHaveLength(1);
    expect(passives[0]).toMatchObject({
      effects: [{ result: [{
        kind: 'modifier', value: 'weapon_mod',
        applies_to: { roll: 'damage', filter: { extraAttackSource: 'light_property' } },
      }] }],
    });
    expect(generalFeatWeaponDamagePassives({
      actor: owner, profile: crossbow, attackActionId: 'attack-1', ownTurn: true,
      extraAttackSource: 'none',
    })).toHaveLength(0);
    expect(generalFeatWeaponDamagePassives({
      actor: owner, profile: { ...crossbow, weaponType: 'shortbow' },
      attackActionId: 'attack-1', ownTurn: true, extraAttackSource: 'light_property',
    })).toHaveLength(0);
  });

  it.each([
    [CRUSHER_CAPABILITY, 'bludgeoning', 'advantage'],
    [SLASHER_CAPABILITY, 'slashing', 'disadvantage'],
  ] as const)('applies the %s critical rider to the struck target', (capability, damageType, op) => {
    const weapon = withDeclaredTestWeaponProfile({ ...CARD_DAGGER, id: `weapon:${damageType}` }, {
      weaponType: damageType === 'bludgeoning' ? 'mace' : 'scimitar',
      proficiencyCategory: 'simple', attackAbility: 'str',
      damageLines: [{ dice: '1d6', type: damageType }], defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: [], masteryEffectId: 'mastery:sap',
    });
    const owner = actor([capability]);
    owner.character = { ...owner.character, equippedCards: [weapon] };
    owner.runtime = {
      ...owner.runtime, equipment: { main_hand: weapon.id }, inventory: [{ cardId: weapon.id, qty: 1 }],
    };
    const passives = generalFeatWeaponDamagePassives({
      actor: owner, profile: profile([], damageType), attackActionId: 'attack-1', ownTurn: true,
    });
    const tape = [0.999, 0, 0];
    const result = executeAction(owner.runtime, {
      activation: { cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    }, {
      character: owner.character, passives, rng: () => tape.shift() ?? 0, selfId: owner.id,
      target: { id: 't', ac: 1, characterContext: owner.character, runtimeState: state() },
    });
    expect(result.targetState?.activeEffects).toContainEqual(expect.objectContaining({
      mechanics: expect.objectContaining({ kind: 'modifier', op }),
      sourceTurnExpiry: expect.objectContaining({ sourceActorId: 'a', boundary: 'start' }),
    }));
  });

  it('does not apply Crusher or Slasher critical riders on an ordinary hit', () => {
    const weapon = withDeclaredTestWeaponProfile({ ...CARD_DAGGER, id: 'weapon:mace' }, {
      weaponType: 'mace', proficiencyCategory: 'simple', attackAbility: 'str',
      damageLines: [{ dice: '1d6', type: 'bludgeoning' }], defaultAttackMode: 'melee',
      attackModes: [{ kind: 'melee', reach_ft: 5 }], properties: [], masteryEffectId: 'mastery:sap',
    });
    const owner = actor([CRUSHER_CAPABILITY]);
    owner.character = { ...owner.character, equippedCards: [weapon] };
    owner.runtime = {
      ...owner.runtime, equipment: { main_hand: weapon.id }, inventory: [{ cardId: weapon.id, qty: 1 }],
    };
    const passives = generalFeatWeaponDamagePassives({
      actor: owner, profile: profile([], 'bludgeoning'), attackActionId: 'attack-1', ownTurn: true,
    });
    const tape = [0.5, 0];
    const result = executeAction(owner.runtime, {
      activation: { cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', who: 'target',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    }, {
      character: owner.character, passives, rng: () => tape.shift() ?? 0,
      target: { id: 't', ac: 1, characterContext: owner.character, runtimeState: state() },
    });
    expect(result.targetState?.activeEffects).toHaveLength(0);
  });

  it('keeps a granted Slasher slow tied to the attacker source turn', () => {
    const result = executeAction(state(), {
      activation: { cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [{
        kind: 'grant_effect', value: 'EFF-general-slasher-slow',
      }] }],
    }, {
      character: character(), selfId: 'attacker', rng: () => 0.5,
      target: { id: 'target', characterContext: character(), runtimeState: state() },
      grantedEffects: {
        'EFF-general-slasher-slow': {
          id: 'effect:slasher-slow', card_number: 'EFF-general-slasher-slow',
          name: 'Рубака: замедление', mechanics: {
            activation: { mode: 'passive' },
            duration: { type: 'until_start_of_source_next_turn' },
            effects: [{ resolution: 'auto', result: [{
              kind: 'modifier', op: 'add', value: -10, applies_to: { roll: 'speed' },
            }] }],
          },
        },
      },
    });
    expect(result.targetState?.activeEffects).toContainEqual(expect.objectContaining({
      sourceId: 'attacker', ownerId: 'target',
      sourceTurnExpiry: { sourceActorId: 'attacker', ownerActorId: 'target', boundary: 'start' },
    }));
  });
});

describe('Poisoner resistance policy', () => {
  it('ignores only poison resistance for source-owned poison damage', () => {
    const resistant = {
      ...state(), hp: { current: 20, max: 20, temp: 0 },
      activeEffects: [{
        id: 'poison-resistance', name: 'Poison resistance', source: 'test',
        mechanics: { kind: 'resistance', damage_type: 'poison', value: 'resistance' },
      }],
    };
    const poisoner = { activation: { mode: 'passive' }, effects: [{ resolution: 'auto', result: [{
      kind: 'modifier', op: 'ignore', applies_to: { resistance: 'poison' },
    }] }] };
    const action = {
      activation: { mode: 'active', cost: [] },
      effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', amount: '8', type: 'poison' }] }],
    };
    const owned = executeAction(state(), action, {
      character: character(), passives: [poisoner], rng: () => 0.5,
      target: { id: 'target', runtimeState: resistant, characterContext: character() },
    });
    const baseline = executeAction(state(), action, {
      character: character(), passives: [], rng: () => 0.5,
      target: { id: 'target', runtimeState: resistant, characterContext: character() },
    });
    expect(owned.targetState?.hp.current).toBe(12);
    expect(baseline.targetState?.hp.current).toBe(16);
  });
});
