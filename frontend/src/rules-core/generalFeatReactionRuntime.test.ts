import { describe, expect, it } from 'vitest';
import type { ActorState, RuleActionDefinition } from './domain';
import { CARD_DAGGER } from '../mvp/fixtures';
import {
  DEFENSIVE_DUELIST_CAPABILITY,
  CHARGER_CAPABILITY,
  SHIELD_MASTER_CAPABILITY,
  actorHoldsShieldForFeat,
  actorWieldsFinesseWeapon,
  chargerApproachEligible,
  defensiveDuelistReactionEligible,
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
});
