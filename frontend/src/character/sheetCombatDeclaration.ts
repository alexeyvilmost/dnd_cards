import type { Relation, RuleActionDefinition, SpatialFacts } from '../rules-core/domain';
import {
  magicMissileDartCount,
  parseWorldSpellPolicy,
  type MagicMissilePolicy,
} from '../rules-core/worldSpellPolicies';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  parseDeclaredWeaponActionPolicy,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import type { SheetCanonicalCommandInput } from './sheetCanonicalCommand';

export const UNARMED_STRIKE_PRIMITIVE = 'unarmed_strike' as const;
export const UNARMED_STRIKE_CHOICE_ID = 'unarmed_strike_option' as const;

export interface SheetCombatTargetFactDraft {
  targetId: string;
  factsSource: SpatialFacts['factsSource'];
  boardRevision: number;
  relation: Relation;
  distanceFt: number;
  lineOfSight: boolean;
  cover: NonNullable<SpatialFacts['cover']>;
  willing?: boolean;
}

export interface SheetCombatDeclarationPolicy {
  primitiveType:
    | 'burning_hands_objects'
    | 'area_object_push'
    | 'magic_missile'
    | typeof UNARMED_STRIKE_PRIMITIVE
    | typeof WEAPON_ATTACK_PRIMITIVE
    | typeof LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE
    | 'generic_action';
  minTargets: number;
  maxTargets: number;
  rangeFt: number;
  allowedRelations: Relation[];
  requiresLineOfSight: boolean;
  requiresWilling: boolean;
  dartCount?: number;
  allocationChoiceId?: string;
  /** Human-readable shape compiled from mechanics.targeting (for example `area`). */
  targetingShape?: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function primitive(action: RuleActionDefinition): SheetCombatDeclarationPolicy['primitiveType'] {
  const type = object(action.mechanics.primitive)?.type;
  if (type === UNARMED_STRIKE_PRIMITIVE) return type;
  if (type === WEAPON_ATTACK_PRIMITIVE || type === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE) {
    const parsed = parseDeclaredWeaponActionPolicy(action, 'bound');
    if (parsed.status !== 'valid') throw new Error(parsed.issue);
    return parsed.policy.primitive;
  }
  if (type === 'burning_hands_objects'
    || type === 'area_object_push'
    || type === 'magic_missile') return type;
  return 'generic_action';
}

export function sheetCombatDeclarationPolicy(
  action: RuleActionDefinition,
  castLevel?: number,
): SheetCombatDeclarationPolicy {
  const primitiveType = primitive(action);
  const targeting = action.targeting;
  if (!targeting || targeting.maxTargets < targeting.minTargets
    || !targeting.allowedRelations.length) {
    throw new Error(`${action.id} has no usable actor-targeting contract`);
  }
  const common = {
    primitiveType,
    minTargets: targeting.minTargets,
    maxTargets: targeting.maxTargets,
    rangeFt: targeting.rangeFt,
    allowedRelations: [...targeting.allowedRelations],
    requiresLineOfSight: targeting.requiresLineOfSight,
    requiresWilling: targeting.requiresWilling === true,
    targetingShape: typeof object(action.mechanics.targeting)?.shape === 'string'
      ? String(object(action.mechanics.targeting)?.shape)
      : undefined,
  };
  if (primitiveType !== 'magic_missile') return common;
  const parsed = parseWorldSpellPolicy(action.mechanics);
  if (parsed.status !== 'valid' || parsed.primitiveType !== 'magic_missile') {
    throw new Error(parsed.status === 'invalid'
      ? parsed.issue
      : `${action.id} has no Magic Missile policy`);
  }
  const policy = parsed.policy as MagicMissilePolicy;
  const level = castLevel ?? (action.kind === 'spell' ? action.spell.level : undefined);
  const dartCount = level == null ? null : magicMissileDartCount(policy, level);
  if (dartCount == null) throw new Error(`${action.id} has an invalid cast level`);
  return {
    ...common,
    maxTargets: Math.min(common.maxTargets, dartCount),
    dartCount,
    allocationChoiceId: policy.allocationChoiceId,
  };
}

function factsFor(
  draft: SheetCombatTargetFactDraft,
  policy: SheetCombatDeclarationPolicy,
): SpatialFacts {
  if (!draft.targetId.trim()) throw new Error('Цель должна иметь стабильный id');
  if (!['scenario', 'board', 'gm_ruling'].includes(draft.factsSource)) {
    throw new Error(`Для ${draft.targetId} нужен источник фактов`);
  }
  if (!Number.isSafeInteger(draft.boardRevision) || draft.boardRevision < 0) {
    throw new Error(`Для ${draft.targetId} нужна неотрицательная ревизия сцены`);
  }
  if (!Number.isFinite(draft.distanceFt) || draft.distanceFt < 0
    || draft.distanceFt > policy.rangeFt) {
    throw new Error(`Цель ${draft.targetId} должна быть в пределах ${policy.rangeFt} фт.`);
  }
  if (!policy.allowedRelations.includes(draft.relation)) {
    throw new Error(`Отношение к цели ${draft.targetId} не разрешено механикой`);
  }
  if (typeof draft.lineOfSight !== 'boolean') {
    throw new Error(`Для ${draft.targetId} нужно явно указать линию обзора`);
  }
  if (policy.requiresLineOfSight && !draft.lineOfSight) {
    throw new Error(`Механика требует видеть цель ${draft.targetId}`);
  }
  if (!['none', 'half', 'three_quarters', 'total'].includes(draft.cover)) {
    throw new Error(`Для ${draft.targetId} нужно явно указать укрытие`);
  }
  if (policy.requiresWilling && typeof draft.willing !== 'boolean') {
    throw new Error(`Для ${draft.targetId} нужно явно указать согласие`);
  }
  return {
    factsSource: draft.factsSource,
    boardRevision: draft.boardRevision,
    relation: draft.relation,
    distanceFt: draft.distanceFt,
    lineOfSight: draft.lineOfSight,
    cover: draft.cover,
    ...(policy.requiresWilling ? { willing: draft.willing } : {}),
  };
}

/**
 * Adds only user-observed facts and allocation choices. Target limits, range,
 * area shape and dart count are compiled from mechanics and cannot be supplied
 * by the component.
 */
export function buildSheetCombatDeclaration(input: {
  action: RuleActionDefinition;
  base: SheetCanonicalCommandInput;
  targets: readonly SheetCombatTargetFactDraft[];
  /** Magic Missile only: target id -> number of darts. */
  dartAllocation?: Readonly<Record<string, number>>;
}): SheetCanonicalCommandInput {
  const castLevel = input.base.spell?.castLevel
    ?? (input.action.kind === 'spell' ? input.action.spell.level : undefined);
  const policy = sheetCombatDeclarationPolicy(input.action, castLevel);
  const weaponDeclaration = policy.primitiveType === WEAPON_ATTACK_PRIMITIVE
    || policy.primitiveType === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE;
  if (weaponDeclaration && (
    input.base.spell
    || input.base.pactBlade
    || input.base.worldInput
    || input.base.scenarioObjects?.length
    || input.dartAllocation !== undefined
  )) {
    throw new Error('Оружейное действие принимает только цель и явно наблюдаемые факты');
  }
  const targetIds = input.targets.map((target) => target.targetId);
  if (new Set(targetIds).size !== targetIds.length) throw new Error('Цели не должны повторяться');
  if (targetIds.length < policy.minTargets || targetIds.length > policy.maxTargets) {
    throw new Error(`Механика допускает ${policy.minTargets}–${policy.maxTargets} целей`);
  }
  const factsByTarget = Object.fromEntries(input.targets.map((target) => [
    target.targetId,
    factsFor(target, policy),
  ]));
  const choices = { ...(input.base.choices ?? {}) };
  if (policy.primitiveType === 'magic_missile') {
    const allocation = input.dartAllocation ?? {};
    if (Object.keys(allocation).some((id) => !targetIds.includes(id))) {
      throw new Error('Дротики нельзя назначить невыбранной цели');
    }
    const dartTargetIds = targetIds.flatMap((targetId) => {
      const count = allocation[targetId];
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error(`Для выбранной цели ${targetId} нужен хотя бы один дротик`);
      }
      return Array<string>(count).fill(targetId);
    });
    if (dartTargetIds.length !== policy.dartCount) {
      throw new Error(`Нужно распределить ровно ${policy.dartCount} дротика(ов)`);
    }
    choices[policy.allocationChoiceId!] = dartTargetIds;
  }
  return {
    ...input.base,
    targetIds,
    factsByTarget,
    ...(Object.keys(choices).length ? { choices } : {}),
    ...(policy.primitiveType === 'burning_hands_objects'
      || policy.primitiveType === 'area_object_push'
      ? { worldInput: { type: 'area_objects', factsByObject: {} } as const }
      : {}),
  };
}
