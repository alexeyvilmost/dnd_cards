import type { ActorState } from './domain';
import type { WeaponProfile } from './weaponProfile';

type Dict = Record<string, unknown>;

export const CRUSHER_CAPABILITY = 'general_feat.crusher';
export const CROSSBOW_EXPERT_CAPABILITY = 'general_feat.crossbow_expert';
export const DUAL_WIELDER_CAPABILITY = 'general_feat.dual_wielder';
export const GREAT_WEAPON_MASTER_CAPABILITY = 'general_feat.great_weapon_master';
export const HEAVY_ARMOR_MASTER_CAPABILITY = 'general_feat.heavy_armor_master';
export const PIERCER_CAPABILITY = 'general_feat.piercer';
export const SLASHER_CAPABILITY = 'general_feat.slasher';

export const CRUSHER_USE_KEY = 'general_feat.crusher.push';
export const PIERCER_USE_KEY = 'general_feat.piercer.reroll';
export const SLASHER_USE_KEY = 'general_feat.slasher.slow';

export function ownsGeneralFeatCapability(actor: ActorState, capabilityId: string): boolean {
  const sources = actor.capabilities.featureSources?.[capabilityId];
  return Array.isArray(sources) && sources.length > 0
    && sources.every((sourceId) => typeof sourceId === 'string' && sourceId.trim().length > 0);
}

function runtimePassive(
  id: string,
  name: string,
  sourceEntityIds: readonly string[],
  payload: Dict,
): Dict {
  return {
    id,
    name,
    sourceEntityIds: [...sourceEntityIds],
    effects: [{ resolution: 'auto', result: [payload] }],
  };
}

function runtimeCriticalListener(
  id: string,
  name: string,
  sourceEntityIds: readonly string[],
  damageType: 'bludgeoning' | 'slashing',
  payload: Dict,
): Dict {
  return {
    id,
    name,
    sourceEntityIds: [...sourceEntityIds],
    activation: {
      mode: 'triggered', cost: [],
      trigger: { event: 'hit', circumstances: [
        { kind: 'event_data_equals', key: 'critical', value: true },
        { kind: 'event_data_equals', key: 'damageType', value: damageType },
      ] },
    },
    effects: [{ resolution: 'auto', who: 'target', result: [payload] }],
  };
}

/**
 * Bind feat damage modifiers to immutable weapon facts before the generic
 * damage roller runs. This avoids trusting a UI-supplied "heavy/piercing"
 * flag and keeps unrelated weapons from borrowing the feat.
 */
export function generalFeatWeaponDamagePassives(input: {
  actor: ActorState;
  profile: WeaponProfile;
  attackActionId: string;
  ownTurn: boolean;
  extraAttackSource?: 'light_property' | 'other' | 'none';
}): Dict[] {
  const out: Dict[] = [];
  const sources = input.actor.capabilities.featureSources ?? {};
  if (input.ownTurn
    && input.attackActionId
    && input.profile.properties.includes('heavy')
    && ownsGeneralFeatCapability(input.actor, GREAT_WEAPON_MASTER_CAPABILITY)) {
    out.push(runtimePassive(
      'runtime:general-feat:gwm-heavy-damage',
      'Мастер большого оружия',
      sources[GREAT_WEAPON_MASTER_CAPABILITY]!,
      {
        kind: 'modifier', op: 'add', value: 'prof', modifier_kind: 'proficiency',
        reason: 'тяжёлое оружие', applies_to: { roll: 'damage' },
      },
    ));
  }
  if (input.profile.damageLines[0]?.type === 'piercing'
    && ownsGeneralFeatCapability(input.actor, PIERCER_CAPABILITY)) {
    out.push(runtimePassive(
      'runtime:general-feat:piercer-reroll',
      'Пронзатель',
      sources[PIERCER_CAPABILITY]!,
      {
        kind: 'modifier', op: 'reroll_damage', keep: 'new',
        once_per_turn: PIERCER_USE_KEY,
        applies_to: { roll: 'damage', filter: { damageType: 'piercing' } },
      },
    ));
    out.push(runtimePassive(
      'runtime:general-feat:piercer-critical-die',
      'Пронзатель',
      sources[PIERCER_CAPABILITY]!,
      {
        kind: 'modifier', op: 'critical_extra_die', value: 1,
        applies_to: {
          roll: 'damage',
          filter: { attackKind: 'weapon', damageType: 'piercing', critical: true },
        },
      },
    ));
  }
  if (input.profile.damageLines[0]?.type === 'bludgeoning'
    && ownsGeneralFeatCapability(input.actor, CRUSHER_CAPABILITY)) {
    out.push(runtimeCriticalListener(
      'runtime:general-feat:crusher-critical-advantage',
      'Крушитель',
      sources[CRUSHER_CAPABILITY]!,
      'bludgeoning',
      {
        kind: 'modifier', op: 'advantage', scope: 'target',
        applies_to: { roll: 'attack' },
        duration: { type: 'until_start_of_source_next_turn' },
      },
    ));
  }
  if (input.profile.damageLines[0]?.type === 'slashing'
    && ownsGeneralFeatCapability(input.actor, SLASHER_CAPABILITY)) {
    out.push(runtimeCriticalListener(
      'runtime:general-feat:slasher-critical-disadvantage',
      'Рубака',
      sources[SLASHER_CAPABILITY]!,
      'slashing',
      {
        kind: 'modifier', op: 'disadvantage',
        applies_to: { roll: 'attack' },
        duration: { type: 'until_start_of_source_next_turn' },
      },
    ));
  }
  if (input.extraAttackSource === 'light_property'
    && /crossbow/iu.test(input.profile.weaponType)
    && ownsGeneralFeatCapability(input.actor, CROSSBOW_EXPERT_CAPABILITY)) {
    out.push(runtimePassive(
      'runtime:general-feat:crossbow-expert-light-damage',
      'Эксперт в арбалетах',
      sources[CROSSBOW_EXPERT_CAPABILITY]!,
      {
        kind: 'modifier', op: 'add', value: 'weapon_mod',
        reason: 'дополнительная атака лёгким арбалетом',
        applies_to: {
          roll: 'damage',
          filter: {
            attackKind: 'weapon',
            extraAttackSource: 'light_property',
            abilityModifierAlreadyIncluded: false,
          },
        },
      },
    ));
  }
  return out;
}

export function generalFeatTriggeredUseKey(action: { mechanics: Dict }): string | null {
  const activation = action.mechanics.activation as Dict | undefined;
  const trigger = activation?.trigger as Dict | undefined;
  const value = trigger?.feat_once_per_turn;
  return typeof value === 'string' && value.trim() ? value : null;
}
