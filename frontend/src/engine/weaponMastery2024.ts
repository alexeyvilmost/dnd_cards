/**
 * Data contract and pure compiler for the eight PHB 2024 Weapon Mastery
 * properties. Content identifies a rule by `mechanics.weapon_mastery.type`;
 * no Effect/Card id or localized name is interpreted here.
 */
import type { ExecuteContext, WeaponContext } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export type WeaponMasteryPrimitive =
  | {
    type: 'topple';
    saveAbility: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
    dc: string;
    condition: string;
    choiceId: string;
  }
  | {
    type: 'sap';
    consume: 'next';
    expires: 'start_of_source_next_turn';
  }
  | {
    type: 'slow';
    penaltyFt: number;
    requiresDamage: boolean;
    expires: 'start_of_source_next_turn';
    choiceId: string;
  }
  | {
    type: 'vex';
    consume: 'next';
    targetLocked: boolean;
    requiresDamage: boolean;
    expires: 'end_of_source_next_turn';
  }
  | {
    type: 'push';
    maxDistanceFt: number;
    maxTargetSize: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
    choiceId: string;
  }
  | {
    type: 'graze';
    damage: string;
    choiceId: string;
  }
  | {
    type: 'nick';
    timing: 'attack_action';
    maximumPerTurn: 1;
  }
  | {
    type: 'cleave';
    maximumPerTurn: 1;
    secondaryWithinPrimaryFt: number;
    sameWeapon: true;
    positiveAbilityModifier: false;
    expires: 'end_of_turn';
  };

export interface WeaponMasteryExecutionFacts {
  weapon: WeaponContext;
  weaponMod: number;
  targetActorId?: string;
  /** Tiny=0, Small=1, Medium=2, Large=3, Huge=4, Gargantuan=5. */
  targetSize?: number;
  attackRange?: 'melee' | 'ranged';
  dealtDamage?: boolean;
  choices?: ExecuteContext['choices'];
  firedThisTurn?: readonly string[];
  attackActionId?: string;
  attackCommandId?: string;
  sourceEntityId?: string;
}

export const WEAPON_MASTERY_CLEAVE_USE_PREFIX =
  'system:dnd5e-2024:weapon-mastery:cleave:' as const;
export const WEAPON_MASTERY_NICK_USE_PREFIX =
  'system:dnd5e-2024:weapon-mastery:nick:' as const;

export function weaponMasteryCleaveUseKey(turnKey: string): string {
  return `${WEAPON_MASTERY_CLEAVE_USE_PREFIX}${turnKey}`;
}

export function weaponMasteryNickUseKey(turnKey: string): string {
  return `${WEAPON_MASTERY_NICK_USE_PREFIX}${turnKey}`;
}

export function hasUsedCleaveThisTurn(firedThisTurn: readonly string[] | undefined): boolean {
  return (firedThisTurn ?? []).some((key) => key.startsWith(WEAPON_MASTERY_CLEAVE_USE_PREFIX));
}

const ABILITIES = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const CREATURE_SIZE_INDEX = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
  huge: 4,
  gargantuan: 5,
} as const;

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function positiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasExactKeys(primitive: Dict, expected: readonly string[]): boolean {
  const actual = Object.keys(primitive).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function validPrimitiveFields(primitive: Dict): boolean {
  switch (primitive.type) {
    case 'topple':
      return hasExactKeys(primitive, ['type', 'saveAbility', 'dc', 'condition', 'choiceId'])
        && ABILITIES.has(String(primitive.saveAbility))
        && nonBlankString(primitive.dc)
        && nonBlankString(primitive.condition)
        && nonBlankString(primitive.choiceId);
    case 'sap':
      return hasExactKeys(primitive, ['type', 'consume', 'expires'])
        && primitive.consume === 'next'
        && primitive.expires === 'start_of_source_next_turn';
    case 'slow':
      return hasExactKeys(primitive, [
        'type', 'penaltyFt', 'requiresDamage', 'expires', 'choiceId',
      ])
        && positiveFiniteNumber(primitive.penaltyFt)
        && typeof primitive.requiresDamage === 'boolean'
        && primitive.expires === 'start_of_source_next_turn'
        && nonBlankString(primitive.choiceId);
    case 'vex':
      return hasExactKeys(primitive, [
        'type', 'consume', 'targetLocked', 'requiresDamage', 'expires',
      ])
        && primitive.consume === 'next'
        && typeof primitive.targetLocked === 'boolean'
        && typeof primitive.requiresDamage === 'boolean'
        && primitive.expires === 'end_of_source_next_turn';
    case 'push':
      return hasExactKeys(primitive, ['type', 'maxDistanceFt', 'maxTargetSize', 'choiceId'])
        && positiveFiniteNumber(primitive.maxDistanceFt)
        && typeof primitive.maxTargetSize === 'string'
        && Object.prototype.hasOwnProperty.call(CREATURE_SIZE_INDEX, primitive.maxTargetSize)
        && nonBlankString(primitive.choiceId);
    case 'graze':
      return hasExactKeys(primitive, ['type', 'damage', 'choiceId'])
        && nonBlankString(primitive.damage)
        && nonBlankString(primitive.choiceId);
    case 'nick':
      return hasExactKeys(primitive, ['type', 'timing', 'maximumPerTurn'])
        && primitive.timing === 'attack_action'
        && primitive.maximumPerTurn === 1;
    case 'cleave':
      return hasExactKeys(primitive, [
        'type', 'maximumPerTurn', 'secondaryWithinPrimaryFt', 'sameWeapon',
        'positiveAbilityModifier', 'expires',
      ])
        && primitive.maximumPerTurn === 1
        && positiveFiniteNumber(primitive.secondaryWithinPrimaryFt)
        && primitive.sameWeapon === true
        && primitive.positiveAbilityModifier === false
        && primitive.expires === 'end_of_turn';
    default:
      return false;
  }
}

/** Fail closed at the content boundary; malformed declarations never become rules. */
export function weaponMasteryPrimitive(
  mechanics: Dict | null | undefined,
): WeaponMasteryPrimitive | null {
  const value = mechanics?.weapon_mastery;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const primitive = value as Dict;
  return validPrimitiveFields(primitive)
    ? primitive as unknown as WeaponMasteryPrimitive
    : null;
}

function isUseChoiceSelected(
  choices: ExecuteContext['choices'],
  choiceId: string,
): boolean {
  const raw = choices?.[choiceId];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return ['use', 'yes', 'true', 'apply'].includes(String(value ?? '').toLowerCase());
}

export function weaponMasteryEvent(
  primitive: WeaponMasteryPrimitive,
): 'hit' | 'miss' | 'passive' {
  if (primitive.type === 'graze') return 'miss';
  if (primitive.type === 'nick') return 'passive';
  return 'hit';
}

function declaredDuration(
  expiry: 'start_of_source_next_turn' | 'end_of_source_next_turn' | 'end_of_turn',
): Dict {
  switch (expiry) {
    case 'start_of_source_next_turn':
      return { type: 'until_start_of_source_next_turn' };
    case 'end_of_source_next_turn':
      return { type: 'until_end_of_source_next_turn' };
    case 'end_of_turn':
      return { type: 'until_end_of_turn' };
  }
}

/**
 * Turns mastery data into ordinary reusable engine interactions. Nick is an
 * action-economy gate used by the Light attack command; Cleave emits a typed,
 * expiring follow-up window consumed by its command.
 */
export function compileWeaponMasteryEffects(
  primitive: WeaponMasteryPrimitive,
  facts: WeaponMasteryExecutionFacts,
): Dict[] {
  switch (primitive.type) {
    case 'topple':
      if (!isUseChoiceSelected(facts.choices, primitive.choiceId)) {
        return [];
      }
      return [{
        resolution: 'save',
        who: 'target',
        ability: primitive.saveAbility,
        dc: primitive.dc,
        on_fail: [{ kind: 'condition', value: primitive.condition }],
        on_success: [],
      }];
    case 'sap':
      return [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'attack' },
          op: 'disadvantage',
          consume: primitive.consume,
          duration: declaredDuration(primitive.expires),
          stack_id: 'weapon-mastery:sap',
          stack_type: 'overwrite',
        }],
      }];
    case 'slow':
      if (primitive.requiresDamage && !facts.dealtDamage) return [];
      if (!isUseChoiceSelected(facts.choices, primitive.choiceId)) {
        return [];
      }
      return [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'modifier',
          applies_to: { roll: 'speed' },
          op: 'add',
          value: String(-Math.abs(primitive.penaltyFt)),
          duration: declaredDuration(primitive.expires),
          stack_id: 'weapon-mastery:slow',
          stack_type: 'overwrite',
        }],
      }];
    case 'vex': {
      if (primitive.requiresDamage && !facts.dealtDamage) return [];
      if (!facts.targetActorId) return [];
      return [{
        resolution: 'auto',
        result: [{
          kind: 'modifier',
          applies_to: {
            roll: 'attack',
            ...(primitive.targetLocked
              ? { filter: { targetActorId: facts.targetActorId } }
              : {}),
          },
          op: 'advantage',
          consume: primitive.consume,
          duration: declaredDuration(primitive.expires),
          stack_id: primitive.targetLocked
            ? `weapon-mastery:vex:${facts.targetActorId}`
            : 'weapon-mastery:vex',
          stack_type: 'overwrite',
        }],
      }];
    }
    case 'push': {
      const maxDistanceFt = primitive.maxDistanceFt;
      const raw = facts.choices?.[primitive.choiceId];
      const selected = Array.isArray(raw) ? raw[0] : raw;
      const distanceFt = selected == null ? 0 : Number(selected);
      const targetEligible = Number.isInteger(facts.targetSize)
        && facts.targetSize! <= CREATURE_SIZE_INDEX[primitive.maxTargetSize];
      if (!targetEligible || !Number.isFinite(distanceFt) || distanceFt <= 0
        || distanceFt > maxDistanceFt) return [];
      return [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'movement', value: 'push', distance: distanceFt }],
      }];
    }
    case 'graze':
      if (!isUseChoiceSelected(facts.choices, primitive.choiceId)) {
        return [];
      }
      return [{
        resolution: 'auto',
        who: 'target',
        result: [{
          kind: 'damage',
          amount: primitive.damage,
          // Graze deals the same type as the weapon's primary damage. `weapon`
          // is not a damage type and would bypass typed resistance/immunity.
          type: facts.weapon.damageType,
          suppress_damage_modifiers: true,
        }],
      }];
    case 'nick':
      return [];
    case 'cleave':
      if (facts.attackRange !== 'melee'
        || !facts.targetActorId
        || hasUsedCleaveThisTurn(facts.firedThisTurn)) return [];
      return [{
        resolution: 'auto',
        result: [{
          kind: 'attack_follow_up',
          follow_up: 'cleave',
          weaponCardId: facts.weapon.cardId,
          primaryTargetActorId: facts.targetActorId,
          ...(facts.attackActionId ? { attackActionId: facts.attackActionId } : {}),
          ...(facts.attackCommandId ? { openedByCommandId: facts.attackCommandId } : {}),
          ...(facts.sourceEntityId ? { sourceEntityId: facts.sourceEntityId } : {}),
          secondaryWithinPrimaryFt: primitive.secondaryWithinPrimaryFt,
          duration: declaredDuration(primitive.expires),
          stack_id: 'weapon-mastery:cleave-window',
          stack_type: 'overwrite',
        }],
      }];
  }
}

export function actorWeaponHasMasteryPrimitive(input: {
  weapon: WeaponContext | null;
  selectedWeaponTypes: readonly string[] | undefined;
  masteryEffects: ExecuteContext['masteryEffects'];
  type: WeaponMasteryPrimitive['type'];
}): boolean {
  const { weapon } = input;
  if (!weapon?.mastery || !weapon.weaponType
    || !(input.selectedWeaponTypes ?? []).includes(weapon.weaponType)) return false;
  const mechanics = input.masteryEffects?.[weapon.mastery]?.mechanics;
  const primitive = weaponMasteryPrimitive(
    mechanics && typeof mechanics === 'object' && !Array.isArray(mechanics)
      ? mechanics as Dict
      : undefined,
  );
  return primitive?.type === input.type;
}
