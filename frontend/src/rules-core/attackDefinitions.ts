import type {ActorState, RuleActionDefinition} from './domain';
import {getSystemActionDefinition, SYSTEM_ACTION_IDS} from './systemActions';
import {resolveUnarmedDamageProfile} from './fightingStyleComplexPrimitives';
import {actorHoldsCanonicalShield} from './protectionRuntime';

function actorCard(actor: ActorState, cardId: string) {
  return [...(actor.character.knownCards ?? []), ...(actor.character.equippedCards ?? [])]
    .find(card => card.id === cardId);
}

export function systemActionAsRuleDefinition(
  id: string,
  mechanics: Record<string, unknown>,
): RuleActionDefinition {
  const definition = getSystemActionDefinition(id);
  if (!definition) throw new Error(`Missing immutable system action ${id}`);
  return {
    id: definition.id,
    name: definition.name,
    kind: 'nonSpell',
    sourceEntityIds: [...definition.sourceEntityIds] as [string, ...string[]],
    mechanics,
  };
}

export const CORE_WEAPON_ATTACK = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.weaponAttack, {
  activation: { mode: 'attack_entry', cost: [] },
  effects: [{
    ability: 'auto',
    attack_kind: 'weapon_melee',
    resolution: 'attack_roll',
    vs: 'ac',
    on_hit: [{ ability: 'auto', dice: 'weapon', kind: 'damage', type: 'weapon' }],
  }],
});

const CORE_UNARMED_DAMAGE = systemActionAsRuleDefinition(SYSTEM_ACTION_IDS.unarmedDamage, {
  activation: { mode: 'attack_entry', cost: [] },
  effects: [{
    ability: 'str',
    attack_kind: 'unarmed',
    resolution: 'attack_roll',
    vs: 'ac',
    on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
  }],
});

export function unarmedDamageActionFor(actor: ActorState): RuleActionDefinition {
  const holdsWeapon = (['main_hand', 'off_hand'] as const).some((slot) => {
    const cardId = actor.runtime.equipment[slot];
    return !!cardId && actorCard(actor, cardId)?.type === 'weapon';
  });
  const wearingArmorOrShield = Object.values(actor.runtime.equipment).some((cardId) => (
    !!cardId && actorCard(actor, cardId)?.defense_type != null
  ));
  const profile = resolveUnarmedDamageProfile(actor.passives ?? [], {
    holdingWeaponOrShield: holdsWeapon || actorHoldsCanonicalShield(actor),
    wearingArmorOrShield,
    variables: actor.character.variables,
    abilityMods: actor.character.abilityMods,
  });
  if (!profile) return CORE_UNARMED_DAMAGE;
  return {
    ...CORE_UNARMED_DAMAGE,
    mechanics: {
      ...CORE_UNARMED_DAMAGE.mechanics,
      effects: [{
        ability: profile.ability,
        attack_kind: 'unarmed',
        resolution: 'attack_roll',
        vs: 'ac',
        on_hit: [{
          amount: `${profile.dice} + ${profile.ability}`,
          kind: 'damage',
          type: profile.damageType,
        }],
      }],
    },
  };
}

export function weaponAttackAction(
  hand: 'main' | 'off',
  rangeKind: 'melee' | 'ranged',
): RuleActionDefinition {
  const effect = (CORE_WEAPON_ATTACK.mechanics.effects as Record<string, unknown>[])[0];
  return {
    ...CORE_WEAPON_ATTACK,
    mechanics: {
      ...CORE_WEAPON_ATTACK.mechanics,
      effects: [{
        ...effect,
        attack_kind: rangeKind === 'ranged' ? 'weapon_ranged' : 'weapon_melee',
        ...(hand === 'off' ? { tags: ['off_hand'] } : {}),
      }],
    },
  };
}

