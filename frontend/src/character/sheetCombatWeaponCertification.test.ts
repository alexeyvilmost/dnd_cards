import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { bindEquippedWeaponActionContext } from '../engine/weapon';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { WEAPON_ATTACK_PRIMITIVE } from '../rules-core/weaponActionPolicies';
import {
  assertCertifiedSheetCombatActorAction,
  type CertifiedSheetCombatCatalog,
} from './sheetCombatCertifiedCatalog';

function template(marker: Record<string, unknown> = {
  resource: 'equipped_weapon_ammo', amount: 1,
}): RuleActionDefinition {
  return {
    id: 'action:shared-weapon',
    name: 'Weapon attack',
    kind: 'nonSpell',
    sourceEntityIds: ['content:shared-weapon'],
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 300,
      requiresLineOfSight: true, allowedRelations: ['enemy'],
    },
    mechanics: {
      primitive: { type: WEAPON_ATTACK_PRIMITIVE },
      activation: { mode: 'active', cost: [{ resource: 'action' }, marker] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 300, requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
      }],
    },
  };
}

function weapon(id: string, ammo?: string): Card {
  const ranged = ammo !== undefined;
  return {
    id,
    card_number: `CARD-${id.toUpperCase()}`,
    name: id,
    type: 'weapon',
    properties: [],
    description: '',
    rarity: 'common',
    is_template: 'false',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    mechanics: {
      weapon_profile: {
        weapon_type: id,
        proficiency_category: 'simple',
        attack_ability: ranged ? 'dex' : 'str',
        damage_lines: [{ dice: ranged ? '1d6' : '1d8', type: ranged ? 'piercing' : 'slashing' }],
        default_attack_mode: ranged ? 'ranged' : 'melee',
        attack_modes: ranged
          ? [{ kind: 'ranged', normal_ft: id === 'bow' ? 80 : 30, long_ft: id === 'bow' ? 320 : 120 }]
          : [{ kind: 'melee', reach_ft: 5 }],
        properties: ranged ? ['ammunition'] : [],
        mastery_effect_id: `effect:mastery:${id}`,
        ammo: ammo ? { card_id: ammo } : null,
        enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
        attunement: { required: false },
      },
    },
  } satisfies Card;
}

function actor(id: string, selected: Card): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds: ['action:shared-weapon'] },
    character: {
      abilityMods: { str: 1, dex: 2, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: [selected],
      equippedCards: [selected],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: { main_hand: selected.id },
      inventory: [],
      activeEffects: [],
    },
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['system:attack-profile'],
    },
  };
}

function bound(value: RuleActionDefinition, owner: ActorState): RuleActionDefinition {
  const cards = new Map((owner.character.knownCards ?? []).map((card) => [card.id, card]));
  const mechanics = bindEquippedWeaponActionContext(
    value.mechanics,
    owner.runtime.equipment,
    cards,
  );
  return {
    ...value,
    mechanics,
    targeting: compileDeclaredMechanicsTargeting(mechanics),
  };
}

function certified(value: RuleActionDefinition): CertifiedSheetCombatCatalog {
  return {
    catalog: { getAction: (id: string) => id === value.id ? value : undefined },
  } as unknown as CertifiedSheetCombatCatalog;
}

describe('actor-specific weapon template certification', () => {
  it('reproduces distinct bindings for two actors sharing one immutable action id', () => {
    const value = template();
    const archer = actor('archer', weapon('bow', 'arrow'));
    const slinger = actor('slinger', weapon('sling', 'bullet'));
    const archerAction = bound(value, archer);
    const slingerAction = bound(value, slinger);

    expect(archerAction.mechanics).not.toEqual(slingerAction.mechanics);
    expect(assertCertifiedSheetCombatActorAction(archerAction, archer, certified(value))).toEqual(value);
    expect(assertCertifiedSheetCombatActorAction(slingerAction, slinger, certified(value))).toEqual(value);
    expect(() => assertCertifiedSheetCombatActorAction(slingerAction, archer, certified(value)))
      .toThrow('actor-specific certified weapon binding');
  });

  it('rejects UI card_id/amount tampering and accepts a weapon that declares no ammo', () => {
    const value = template();
    const archer = actor('archer', weapon('bow', 'arrow'));
    const forged = bound(value, archer);
    const activation = forged.mechanics.activation as Record<string, unknown>;
    const cost = activation.cost as Record<string, unknown>[];
    cost[1] = { ...cost[1], card_id: 'bolt', amount: 99 };
    expect(() => assertCertifiedSheetCombatActorAction(forged, archer, certified(value)))
      .toThrow('actor-specific certified weapon binding');

    const swordOwner = actor('sword-user', weapon('sword'));
    expect(assertCertifiedSheetCombatActorAction(
      bound(value, swordOwner),
      swordOwner,
      certified(value),
    )).toEqual(value);
  });

  it('fails closed on an invalid immutable contextual marker', () => {
    const invalid = template({ resource: 'equipped_weapon_ammo', amount: 0 });
    const archer = actor('archer', weapon('bow', 'arrow'));
    expect(() => assertCertifiedSheetCombatActorAction(invalid, archer, certified(invalid)))
      .toThrow(/invalid|positive integer/i);
  });
});
