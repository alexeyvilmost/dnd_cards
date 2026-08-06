/**
 * Ruleset-owned D&D 2024 actions that every creature can use without a
 * content-card grant.  These definitions are deliberately independent from
 * the mutable content catalog and from rules-core command schemas: a future
 * command handler can consume this pure API without treating a database row
 * or a client payload as the authority for the base rules.
 */

export const SYSTEM_ACTION_IDS = Object.freeze({
  attack: 'core.action.attack',
  weaponAttack: 'core.attack.weapon',
  lightExtraAttack: 'core.bonus-action.light-extra-attack',
  unarmedDamage: 'core.attack.unarmed.damage',
  unarmedGrapple: 'core.attack.unarmed.grapple',
  unarmedShove: 'core.attack.unarmed.shove',
  escapeGrapple: 'core.action.escape-grapple',
  releaseGrapple: 'core.free.release-grapple',
} as const);

export type SystemActionId = typeof SYSTEM_ACTION_IDS[keyof typeof SYSTEM_ACTION_IDS];
export type SystemUnarmedStrikeOption = 'damage' | 'grapple' | 'shove';
export type ShoveOutcome = 'push_5ft' | 'prone';

export interface SystemActionTargeting {
  shape: 'self' | 'single_creature' | 'grapple_relation';
  rangeFt: number | 'equipped_weapon';
}

interface SystemActionDefinitionBase {
  id: SystemActionId;
  name: string;
  rulesetSystemId: 'dnd5e-2024';
  sourceEntityIds: readonly [string, ...string[]];
  targeting: Readonly<SystemActionTargeting>;
}

export interface AttackActionSystemDefinition extends SystemActionDefinitionBase {
  kind: 'attack_action';
  timing: 'action';
  actionCost: 1;
  attackBudgetSource: 'compiled_actor_profile';
  weaponEquipAllowance: 'one_before_or_after_each_attack';
  movementBetweenAttacks: true;
}

export interface WeaponAttackSystemDefinition extends SystemActionDefinitionBase {
  kind: 'attack_entry';
  timing: 'attack_entry';
  entryKind: 'weapon_attack';
  consumesAttacks: 1;
  resolution: 'attack_roll';
  weaponRequirement: 'owned_equipped_weapon';
  proficiencyRule: 'weapon_proficiency';
}

export interface LightPropertyExtraAttackSystemDefinition extends SystemActionDefinitionBase {
  kind: 'light_property_extra_attack';
  timing: 'bonus_action';
  bonusActionCost: 1;
  resolution: 'attack_roll';
  qualifyingSource: 'persisted_attack_action_light_weapon_entry';
  extraWeaponRequirement: 'different_owned_equipped_light_weapon';
  abilityModifierRule: 'omit_unless_two_weapon_fighting';
  maximumPerAttackAction: 1;
}

interface UnarmedStrikeSystemDefinitionBase extends SystemActionDefinitionBase {
  kind: 'attack_entry';
  timing: 'attack_entry';
  entryKind: 'unarmed_strike';
  consumesAttacks: 1;
}

export interface UnarmedDamageSystemDefinition extends UnarmedStrikeSystemDefinitionBase {
  unarmedOption: 'damage';
  resolution: 'attack_roll';
  attackAbility: 'str';
  proficiencyRule: 'always';
  damageFormula: 'max(0,1+str)';
  damageType: 'bludgeoning';
  requiresFreeHand: false;
}

export interface UnarmedGrappleSystemDefinition extends UnarmedStrikeSystemDefinitionBase {
  unarmedOption: 'grapple';
  resolution: 'saving_throw';
  saveAbilityOptions: readonly ['str', 'dex'];
  saveDcFormula: '8+str+prof';
  targetMayVoluntarilyFailSave: true;
  maxTargetSizeDifference: 1;
  requiresFreeHand: true;
  grappleCapacityPerPart: 1;
  failedSaveEffect: 'grappled';
  escapeDcFormula: '8+str+prof';
  automaticEndTriggers: readonly ['grappler_incapacitated', 'distance_exceeds_range'];
}

export interface UnarmedShoveSystemDefinition extends UnarmedStrikeSystemDefinitionBase {
  unarmedOption: 'shove';
  resolution: 'saving_throw';
  saveAbilityOptions: readonly ['str', 'dex'];
  saveDcFormula: '8+str+prof';
  targetMayVoluntarilyFailSave: true;
  maxTargetSizeDifference: 1;
  requiresFreeHand: false;
  failedSaveChoices: readonly ['push_5ft', 'prone'];
}

export interface EscapeGrappleSystemDefinition extends SystemActionDefinitionBase {
  kind: 'grapple_lifecycle';
  timing: 'action';
  actionCost: 1;
  resolution: 'ability_check';
  skillOptions: readonly ['athletics', 'acrobatics'];
  dcSource: 'persisted_grapple_escape_dc';
}

export interface ReleaseGrappleSystemDefinition extends SystemActionDefinitionBase {
  kind: 'grapple_lifecycle';
  timing: 'free';
  actionCost: 0;
  resolution: 'automatic';
  controller: 'grappler';
  allowedAtAnyTime: true;
}

export type SystemActionDefinition =
  | AttackActionSystemDefinition
  | WeaponAttackSystemDefinition
  | LightPropertyExtraAttackSystemDefinition
  | UnarmedDamageSystemDefinition
  | UnarmedGrappleSystemDefinition
  | UnarmedShoveSystemDefinition
  | EscapeGrappleSystemDefinition
  | ReleaseGrappleSystemDefinition;

const immutable = <const T extends object>(value: T): Readonly<T> => Object.freeze(value);
const source = (slug: string): readonly [string] => immutable([
  `system:dnd5e-2024:${slug}`,
]);
const target = (
  shape: SystemActionTargeting['shape'],
  rangeFt: SystemActionTargeting['rangeFt'],
): Readonly<SystemActionTargeting> => immutable({ shape, rangeFt });

const ATTACK_ACTION = immutable<AttackActionSystemDefinition>({
  id: SYSTEM_ACTION_IDS.attack,
  name: 'Attack',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('attack-action'),
  targeting: target('self', 0),
  kind: 'attack_action',
  timing: 'action',
  actionCost: 1,
  attackBudgetSource: 'compiled_actor_profile',
  weaponEquipAllowance: 'one_before_or_after_each_attack',
  movementBetweenAttacks: true,
});

const WEAPON_ATTACK = immutable<WeaponAttackSystemDefinition>({
  id: SYSTEM_ACTION_IDS.weaponAttack,
  name: 'Weapon Attack',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('weapon-attack'),
  targeting: target('single_creature', 'equipped_weapon'),
  kind: 'attack_entry',
  timing: 'attack_entry',
  entryKind: 'weapon_attack',
  consumesAttacks: 1,
  resolution: 'attack_roll',
  weaponRequirement: 'owned_equipped_weapon',
  proficiencyRule: 'weapon_proficiency',
});

const LIGHT_PROPERTY_EXTRA_ATTACK = immutable<LightPropertyExtraAttackSystemDefinition>({
  id: SYSTEM_ACTION_IDS.lightExtraAttack,
  name: 'Light Property: Extra Attack',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('light-property-extra-attack'),
  targeting: target('single_creature', 'equipped_weapon'),
  kind: 'light_property_extra_attack',
  timing: 'bonus_action',
  bonusActionCost: 1,
  resolution: 'attack_roll',
  qualifyingSource: 'persisted_attack_action_light_weapon_entry',
  extraWeaponRequirement: 'different_owned_equipped_light_weapon',
  abilityModifierRule: 'omit_unless_two_weapon_fighting',
  maximumPerAttackAction: 1,
});

const UNARMED_DAMAGE = immutable<UnarmedDamageSystemDefinition>({
  id: SYSTEM_ACTION_IDS.unarmedDamage,
  name: 'Unarmed Strike: Damage',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('unarmed-strike:damage'),
  targeting: target('single_creature', 5),
  kind: 'attack_entry',
  timing: 'attack_entry',
  entryKind: 'unarmed_strike',
  consumesAttacks: 1,
  unarmedOption: 'damage',
  resolution: 'attack_roll',
  attackAbility: 'str',
  proficiencyRule: 'always',
  damageFormula: 'max(0,1+str)',
  damageType: 'bludgeoning',
  requiresFreeHand: false,
});

const STR_DEX_SAVE_OPTIONS = immutable(['str', 'dex'] as const);

const UNARMED_GRAPPLE = immutable<UnarmedGrappleSystemDefinition>({
  id: SYSTEM_ACTION_IDS.unarmedGrapple,
  name: 'Unarmed Strike: Grapple',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('unarmed-strike:grapple'),
  targeting: target('single_creature', 5),
  kind: 'attack_entry',
  timing: 'attack_entry',
  entryKind: 'unarmed_strike',
  consumesAttacks: 1,
  maxTargetSizeDifference: 1,
  unarmedOption: 'grapple',
  resolution: 'saving_throw',
  saveAbilityOptions: STR_DEX_SAVE_OPTIONS,
  saveDcFormula: '8+str+prof',
  targetMayVoluntarilyFailSave: true,
  requiresFreeHand: true,
  grappleCapacityPerPart: 1,
  failedSaveEffect: 'grappled',
  escapeDcFormula: '8+str+prof',
  automaticEndTriggers: immutable([
    'grappler_incapacitated',
    'distance_exceeds_range',
  ] as const),
});

const UNARMED_SHOVE = immutable<UnarmedShoveSystemDefinition>({
  id: SYSTEM_ACTION_IDS.unarmedShove,
  name: 'Unarmed Strike: Shove',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('unarmed-strike:shove'),
  targeting: target('single_creature', 5),
  kind: 'attack_entry',
  timing: 'attack_entry',
  entryKind: 'unarmed_strike',
  consumesAttacks: 1,
  maxTargetSizeDifference: 1,
  unarmedOption: 'shove',
  resolution: 'saving_throw',
  saveAbilityOptions: STR_DEX_SAVE_OPTIONS,
  saveDcFormula: '8+str+prof',
  targetMayVoluntarilyFailSave: true,
  requiresFreeHand: false,
  failedSaveChoices: immutable(['push_5ft', 'prone'] as const),
});

const ESCAPE_GRAPPLE = immutable<EscapeGrappleSystemDefinition>({
  id: SYSTEM_ACTION_IDS.escapeGrapple,
  name: 'Escape Grapple',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('escape-grapple'),
  targeting: target('self', 0),
  kind: 'grapple_lifecycle',
  timing: 'action',
  actionCost: 1,
  resolution: 'ability_check',
  skillOptions: immutable(['athletics', 'acrobatics'] as const),
  dcSource: 'persisted_grapple_escape_dc',
});

const RELEASE_GRAPPLE = immutable<ReleaseGrappleSystemDefinition>({
  id: SYSTEM_ACTION_IDS.releaseGrapple,
  name: 'Release Grapple',
  rulesetSystemId: 'dnd5e-2024',
  sourceEntityIds: source('release-grapple'),
  targeting: target('grapple_relation', 0),
  kind: 'grapple_lifecycle',
  timing: 'free',
  actionCost: 0,
  resolution: 'automatic',
  controller: 'grappler',
  allowedAtAnyTime: true,
});

/** Stable display order; callers receive the frozen canonical instances. */
export const SYSTEM_ACTION_DEFINITIONS: readonly SystemActionDefinition[] = immutable([
  ATTACK_ACTION,
  WEAPON_ATTACK,
  LIGHT_PROPERTY_EXTRA_ATTACK,
  UNARMED_DAMAGE,
  UNARMED_GRAPPLE,
  UNARMED_SHOVE,
  ESCAPE_GRAPPLE,
  RELEASE_GRAPPLE,
]);

const SYSTEM_ACTION_BY_ID = new Map<SystemActionId, SystemActionDefinition>(
  SYSTEM_ACTION_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function isSystemActionId(id: string): id is SystemActionId {
  return SYSTEM_ACTION_BY_ID.has(id as SystemActionId);
}

export function getSystemActionDefinition(id: string): SystemActionDefinition | undefined {
  return SYSTEM_ACTION_BY_ID.get(id as SystemActionId);
}

/**
 * Future command-boundary intent types.  They intentionally contain choices
 * and references only; attack budgets, DCs and mechanics come from the actor
 * projection and the ruleset-owned definitions above.
 */
export type SystemActionIntent =
  | { type: 'begin_attack_action' }
  | { type: 'weapon_attack_entry'; attackActionId: string; weaponCardId: string; targetActorId: string }
  | {
    type: 'light_property_extra_attack';
    attackActionId: string;
    weaponCardId: string;
    targetActorId: string;
  }
  | {
    type: 'unarmed_strike_entry';
    attackActionId: string;
    option: SystemUnarmedStrikeOption;
    targetActorId: string;
  }
  | { type: 'escape_grapple'; grappleId: string; skill: 'athletics' | 'acrobatics' }
  | { type: 'release_grapple'; grappleId: string };

export type SystemActionResolutionIntent =
  | {
    type: 'resolve_str_dex_save';
    selectedAbility: 'str' | 'dex';
    resolution: 'roll' | 'voluntary_failure';
  }
  | {
    type: 'choose_shove_outcome';
    attackActionId: string;
    entryOrdinal: number;
    outcome: ShoveOutcome;
  };
