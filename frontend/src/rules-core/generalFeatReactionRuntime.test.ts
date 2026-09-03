import { describe, expect, it } from 'vitest';
import type { ActorState, RuleActionDefinition } from './domain';
import { CARD_DAGGER } from '../mvp/fixtures';
import {
  DEFENSIVE_DUELIST_CAPABILITY,
  CHARGER_CAPABILITY,
  MOUNTED_COMBATANT_ADVANTAGE_PASSIVE_ID,
  MOUNTED_COMBATANT_CAPABILITY,
  POLEARM_MASTER_CAPABILITY,
  SHIELD_MASTER_CAPABILITY,
  actorHoldsShieldForFeat,
  actorWieldsFinesseWeapon,
  chargerApproachEligible,
  defensiveDuelistReactionEligible,
  mountedCombatantAttackAdvantage,
  polearmMasterButtEligible,
  polearmMasterEntryEligible,
  polearmMasterWeapon,
  shieldMasterBashEligible,
} from './generalFeatReactionRuntime';

const weapon = (properties: string[]) => ({
  ...CARD_DAGGER,
  id: 'weapon',
  mechanics: {
    ...(CARD_DAGGER.mechanics as Record<string, unknown>),
    weapon_profile: {
      ...((CARD_DAGGER.mechanics as Record<string, unknown>).weapon_profile as Record<string, unknown>),
      properties,
    },
  },
});
const actor = (properties = ['finesse', 'light', 'thrown'], capability = true): ActorState => ({
  id: 'defender', name: 'Defender', kind: 'playerCharacter', controllerId: 'defender',
  capabilities: {
    actionIds: [],
    featureSources: capability ? { [DEFENSIVE_DUELIST_CAPABILITY]: ['FEAT-0036'] } : {},
  },
  character: {
    abilityMods: { str: 1, dex: 3, con: 1, int: 0, wis: 0, cha: 0 },
    abilityScores: { str: 12, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    profBonus: 3, level: 5, equippedCards: [weapon(properties) as never],
  },
  runtime: {
    hp: { current: 20, max: 20, temp: 0 }, resources: { reaction: 1 },
    maxResources: { reaction: 1 }, equipment: { main_hand: 'weapon' }, inventory: [],
    activeEffects: [], firedThisTurn: [],
  },
});
const attack = (kind = 'weapon_melee'): RuleActionDefinition => ({
  id: 'attack', name: 'Attack', kind: 'nonSpell', sourceEntityIds: ['attack'],
  targeting: { rangeFt: 5, minTargets: 1, maxTargets: 1,
    requiresLineOfSight: true, allowedRelations: ['enemy'] },
  mechanics: { activation: { mode: 'active', cost: [] }, effects: [{
    resolution: 'attack_roll', attack_kind: kind, ability: 'str', who: 'target', on_hit: [],
  }] },
});
const facts = {
  factsSource: 'board' as const, boardRevision: 1, relation: 'enemy' as const,
  distanceFt: 5, lineOfSight: true, cover: 'none' as const,
};

describe('general feat reaction qualification', () => {
  it('offers Defensive Duelist only for its exact owned equipment and melee-hit facts', () => {
    expect(actorWieldsFinesseWeapon(actor())).toBe(true);
    expect(defensiveDuelistReactionEligible({ defender: actor(), incomingAction: attack(), facts }))
      .toBe(true);
    expect(defensiveDuelistReactionEligible({ defender: actor(['light', 'thrown'], true), incomingAction: attack(), facts }))
      .toBe(false);
    expect(defensiveDuelistReactionEligible({ defender: actor(undefined, false), incomingAction: attack(), facts }))
      .toBe(false);
    expect(defensiveDuelistReactionEligible({ defender: actor(), incomingAction: attack('weapon_ranged'), facts }))
      .toBe(false);
    expect(defensiveDuelistReactionEligible({ defender: actor(), incomingAction: attack(), facts: { ...facts, distanceFt: 10 } }))
      .toBe(false);
  });

  it('recognizes only a physically held shield', () => {
    const holder = actor();
    const shield = { id: 'shield', name: 'Shield', type: 'shield', defense_type: 'shield' };
    holder.character.equippedCards = [...(holder.character.equippedCards ?? []), shield as never];
    holder.runtime.equipment.off_hand = shield.id;
    expect(actorHoldsShieldForFeat(holder)).toBe(true);
    delete holder.runtime.equipment.off_hand;
    expect(actorHoldsShieldForFeat(holder)).toBe(false);
  });

  it('requires Shield Master ownership, a held shield, a melee hit, and 5-foot reach', () => {
    const holder = actor();
    const shield = { id: 'shield', name: 'Shield', type: 'shield', defense_type: 'shield' };
    holder.character.equippedCards = [...(holder.character.equippedCards ?? []), shield as never];
    holder.runtime.equipment.off_hand = shield.id;
    holder.capabilities.featureSources = { [SHIELD_MASTER_CAPABILITY]: ['FEAT-0032'] };
    expect(shieldMasterBashEligible({ actor: holder, sourceAction: attack(), targetDistanceFt: 5 }))
      .toBe(true);
    expect(shieldMasterBashEligible({ actor: holder, sourceAction: attack(), targetDistanceFt: 10 }))
      .toBe(false);
    expect(shieldMasterBashEligible({ actor: holder, sourceAction: attack('weapon_ranged'), targetDistanceFt: 5 }))
      .toBe(false);
    delete holder.runtime.equipment.off_hand;
    expect(shieldMasterBashEligible({ actor: holder, sourceAction: attack(), targetDistanceFt: 5 }))
      .toBe(false);
  });

  it('accepts only a current 10-foot straight Charger approach ending in melee reach', () => {
    const charger = actor();
    charger.capabilities.featureSources = { [CHARGER_CAPABILITY]: ['FEAT-0035'] };
    const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => (
      Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y)) * 5
    );
    const eligible = (movement: { from: { x: number; y: number }; to: { x: number; y: number }; distanceFt: number; round: number }) => chargerApproachEligible({
      actor: charger, movement, actorPosition: { x: 2, y: 0 }, targetPosition: { x: 3, y: 0 },
      round: 2, distance,
    });
    expect(eligible({ from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, distanceFt: 10, round: 2 }))
      .toBe(true);
    expect(eligible({ from: { x: 1, y: 0 }, to: { x: 2, y: 0 }, distanceFt: 5, round: 2 }))
      .toBe(false);
    expect(eligible({ from: { x: 0, y: 1 }, to: { x: 2, y: 0 }, distanceFt: 10, round: 2 }))
      .toBe(false);
    expect(eligible({ from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, distanceFt: 10, round: 1 }))
      .toBe(false);
  });

  it('requires an owned, held qualifying polearm for its post-Attack butt strike', () => {
    const holder = actor();
    const quarterstaff = weapon([]);
    quarterstaff.id = 'quarterstaff';
    const quarterstaffProfile = quarterstaff.mechanics.weapon_profile as Record<string, unknown>;
    quarterstaffProfile.weapon_type = 'quarterstaff';
    quarterstaffProfile.attack_ability = 'str';
    quarterstaffProfile.attack_modes = [{ kind: 'melee', reach_ft: 5 }];
    quarterstaffProfile.default_attack_mode = 'melee';
    quarterstaffProfile.damage_lines = [{ dice: '1d6', type: 'bludgeoning' }];
    holder.character.equippedCards = [quarterstaff as never];
    holder.runtime.equipment.main_hand = quarterstaff.id;
    holder.runtime.resources.bonus_action = 1;
    holder.capabilities.featureSources = { [POLEARM_MASTER_CAPABILITY]: ['EFF-general-FEAT-0028'] };

    expect(polearmMasterWeapon(holder)).toEqual({ cardId: quarterstaff.id, reachFt: 5 });
    expect(polearmMasterButtEligible({
      actor: holder, sourceAction: attack(), targetDistanceFt: 5,
      completedAttackWeaponCardId: quarterstaff.id,
    })).toBe(true);
    expect(polearmMasterButtEligible({
      actor: holder, sourceAction: attack(), targetDistanceFt: 5,
      completedAttackWeaponCardId: 'different-weapon',
    })).toBe(false);
    (quarterstaff.mechanics.weapon_profile as Record<string, unknown>).weapon_type = 'longsword';
    expect(polearmMasterButtEligible({
      actor: holder, sourceAction: attack(), targetDistanceFt: 5,
      completedAttackWeaponCardId: quarterstaff.id,
    })).toBe(false);
  });

  it('opens Polearm Master reaction only when an enemy crosses into the held weapon reach', () => {
    const holder = actor();
    const glaive = weapon(['heavy', 'reach']);
    glaive.id = 'glaive';
    (glaive.mechanics.weapon_profile as Record<string, unknown>).weapon_type = 'glaive';
    const profile = glaive.mechanics.weapon_profile as Record<string, unknown>;
    profile.attack_modes = [{ kind: 'melee', reach_ft: 10 }];
    profile.default_attack_mode = 'melee';
    profile.attack_ability = 'str';
    profile.heavy = {
      minimum_ability_score: 13,
      ability_by_mode: { melee: 'str', ranged: 'dex' },
      consequence: 'attack_disadvantage',
    };
    holder.character.equippedCards = [glaive as never];
    holder.runtime.equipment.main_hand = glaive.id;
    holder.capabilities.featureSources = { [POLEARM_MASTER_CAPABILITY]: ['EFF-general-FEAT-0028'] };

    expect(polearmMasterWeapon(holder)).toEqual({ cardId: glaive.id, reachFt: 10 });
    expect(polearmMasterEntryEligible({ actor: holder, startDistanceFt: 15, endDistanceFt: 10 }))
      .toBe(true);
    expect(polearmMasterEntryEligible({ actor: holder, startDistanceFt: 10, endDistanceFt: 5 }))
      .toBe(false);
    holder.runtime.resources.reaction = 0;
    expect(polearmMasterEntryEligible({ actor: holder, startDistanceFt: 15, endDistanceFt: 10 }))
      .toBe(false);
  });

  it('projects Mounted Strike with exact feat provenance only for the smaller adjacent target', () => {
    const rider = actor();
    rider.capabilities.featureSources = {
      [MOUNTED_COMBATANT_CAPABILITY]: ['EFF-general-FEAT-0017'],
    };
    rider.attackProfile = { attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['main_hand'], sourceEntityIds: ['rider'] };
    const mount = actor();
    mount.id = 'mount';
    mount.attackProfile = { attacksPerAction: 1, size: 3, reachFt: 5, graspingParts: ['bite'], sourceEntityIds: ['mount'] };
    const target = actor();
    target.id = 'target';
    target.attackProfile = { attacksPerAction: 1, size: 2, reachFt: 5, graspingParts: ['main_hand'], sourceEntityIds: ['target'] };

    expect(mountedCombatantAttackAdvantage({
      rider, mount, target, mountSize: 3, targetSize: 2,
      targetDistanceFromMountFt: 5, sourceAction: attack(),
    })).toMatchObject({
      id: MOUNTED_COMBATANT_ADVANTAGE_PASSIVE_ID,
      sourceEntityIds: ['EFF-general-FEAT-0017'],
      effects: [{ result: [{ kind: 'modifier', op: 'advantage' }] }],
    });
    target.attackProfile.size = 3;
    expect(mountedCombatantAttackAdvantage({
      rider, mount, target, mountSize: 3, targetSize: 3,
      targetDistanceFromMountFt: 5, sourceAction: attack(),
    })).toBeNull();
  });
});
