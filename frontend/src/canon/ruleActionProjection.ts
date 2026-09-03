import {
  actionUsesKey,
  bindActionUsesCost,
  declaresSelfUsesCost,
  usesFromMechanics,
} from '../engine/actionUses';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SlotRecoveryRestDecisionPolicy } from '../rules-core/restDecisions';
import type { Action, Spell } from '../types';

type JsonObject = Record<string, unknown>;

export interface RuleActionProjectionProvenance {
  sourceEntityIds?: readonly string[];
  sourceClass?: string;
  grantScopeId?: string;
}

export interface SpellCastingOverride {
  removeCostResources: readonly string[];
  targeting?: JsonObject;
  rangeBonusFt?: number;
  components?: Partial<Record<'verbal' | 'somatic' | 'material', boolean>>;
  freeUseResource?: string;
  ritual?: boolean;
}

export class RuleActionProjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleActionProjectionError';
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function materializeLegacyUnarmedStrike(
  mechanics: JsonObject,
  cardNumber: string,
): JsonObject {
  // This compatibility adapter belongs only to the historical basic Unarmed
  // Strike row. Higher-level Monk actions also contain unarmed attack rolls;
  // promoting those cards to the same certified primitive makes the L1
  // certificate reject otherwise valid level-2+ characters.
  if (cardNumber !== 'action_basic_unarmed' || mechanics.primitive) return mechanics;
  const effects = Array.isArray(mechanics.effects) ? mechanics.effects : [];
  const unarmed = effects.some((candidate) => {
    const effect = record(candidate);
    return effect?.resolution === 'attack_roll' && effect.attack_kind === 'unarmed';
  });
  if (!unarmed) return mechanics;
  const legacyTargeting = record(mechanics.targeting);
  const rangeMatch = String(legacyTargeting?.range ?? '').match(/\d+/);
  const rangeFt = rangeMatch ? Number(rangeMatch[0]) : 5;
  return {
    ...mechanics,
    primitive: { type: 'unarmed_strike' },
    targeting: {
      domain: 'actor', actor_targets: true, shape: 'single',
      min_targets: 1, max_targets: 1, range_ft: rangeFt,
      requires_line_of_sight: true, allowed_relations: ['enemy'],
    },
  };
}

function compileAttackReplacement(
  mechanics: JsonObject,
): RuleActionDefinition['attackReplacement'] | undefined {
  const raw = mechanics.attack_replacement;
  if (raw === undefined) return undefined;
  const value = record(raw);
  if (!value
    || typeof value.replacement_key !== 'string' || value.replacement_key.length === 0
    || value.replaces_attacks !== 1
    || !Number.isInteger(value.total_attacks) || Number(value.total_attacks) < 1
    || value.once_per_attack_action !== true) {
    throw new RuleActionProjectionError('attack_replacement is malformed');
  }
  return {
    replacementKey: value.replacement_key,
    replacesAttacks: 1,
    totalAttacks: Number(value.total_attacks),
    oncePerAttackAction: true,
  };
}

function compileRestDecision(
  mechanics: JsonObject,
): SlotRecoveryRestDecisionPolicy | undefined {
  const raw = mechanics.rest_decision;
  if (raw === undefined) return undefined;
  const value = record(raw);
  const levelSource = record(value?.level_source);
  const budget = record(value?.budget);
  const slotResource = record(value?.slot_resource);
  const activation = record(mechanics.activation);
  const costs = Array.isArray(activation?.cost) ? activation.cost as JsonObject[] : [];
  const charge = costs.length === 1 ? record(costs[0]) : null;
  const chargeAmount = charge?.amount === undefined ? 1 : Number(charge.amount);
  const integers = [
    levelSource?.minimum,
    levelSource?.maximum,
    budget?.divisor,
    slotResource?.minimum_level,
    slotResource?.maximum_level,
    slotResource?.restore_amount,
    value?.maximum_per_rest,
    chargeAmount,
  ];
  if (!value
    || value.kind !== 'slot_recovery'
    || typeof value.decision_type !== 'string' || value.decision_type.length === 0
    || value.rest !== 'short_rest'
    || typeof value.capability_id !== 'string' || value.capability_id.length === 0
    || levelSource?.kind !== 'class_level'
    || typeof levelSource.class_id !== 'string' || levelSource.class_id.length === 0
    || budget?.mode !== 'ceil_divide_level'
    || typeof slotResource?.prefix !== 'string' || slotResource.prefix.length === 0
    || !integers.every((entry) => Number.isInteger(entry) && Number(entry) >= 1)
    || Number(levelSource.maximum) < Number(levelSource.minimum)
    || Number(slotResource.maximum_level) < Number(slotResource.minimum_level)
    || activation?.mode !== 'rest_decision'
    || typeof charge?.resource !== 'string' || charge.resource.length === 0) {
    throw new RuleActionProjectionError('rest_decision is malformed');
  }
  return {
    kind: 'slot_recovery',
    decisionType: value.decision_type,
    rest: 'short_rest',
    capabilityId: value.capability_id,
    levelSource: {
      kind: 'class_level',
      classId: levelSource.class_id,
      minimum: Number(levelSource.minimum),
      maximum: Number(levelSource.maximum),
    },
    budget: {
      mode: 'ceil_divide_level',
      divisor: Number(budget.divisor),
    },
    slotResource: {
      prefix: slotResource.prefix,
      minimumLevel: Number(slotResource.minimum_level),
      maximumLevel: Number(slotResource.maximum_level),
      restoreAmount: Number(slotResource.restore_amount),
    },
    charge: {
      resource: charge.resource,
      amount: chargeAmount,
    },
    maximumPerRest: Number(value.maximum_per_rest),
  };
}

function immutableSpellClassListIds(mechanics: JsonObject, spell: Spell): string[] {
  const raw = mechanics.spell_class_list_ids;
  if (!Array.isArray(raw)
    || raw.length === 0
    || raw.some((id) => typeof id !== 'string' || !/^CLASS-[a-z0-9_-]+$/.test(id))
    || new Set(raw).size !== raw.length) {
    throw new RuleActionProjectionError(
      `${spell.card_number}: mechanics.spell_class_list_ids must be explicit stable class ids`,
    );
  }
  return [...raw].sort((left, right) => String(left).localeCompare(String(right))) as string[];
}

/**
 * Compile an Action or Spell card into the immutable rules-core catalog form.
 * All provenance and scoping is supplied by the grant projection; names and
 * localized spell lists never participate in identity.
 */
export function projectRuleAction(
  entity: Action | Spell,
  provenance: RuleActionProjectionProvenance = {},
): RuleActionDefinition {
  // Production migration 169 materializes this contract on the entity. Keep
  // the pinned pre-169 certification snapshot executable by upgrading only
  // the exact structural Unarmed Strike declaration.
  const usesRef = entity.card_number || entity.id;
  const baseMechanics = materializeLegacyUnarmedStrike(
    cloneJson(entity.mechanics ?? {}),
    usesRef,
  );
  const hasUses = usesFromMechanics(baseMechanics) !== null;
  const activation = record(baseMechanics.activation);
  const executable = activation?.mode === 'active' || activation?.mode === 'reaction';
  if (executable && !Array.isArray(activation.cost)) {
    throw new RuleActionProjectionError(
      `${usesRef}: active/reaction entity requires explicit mechanics.activation.cost`,
    );
  }
  if (executable && hasUses !== declaresSelfUsesCost(baseMechanics)) {
    throw new RuleActionProjectionError(
      `${usesRef}: active/reaction mechanics.uses and activation.cost self_uses must be declared together`,
    );
  }
  const mechanics = bindActionUsesCost(baseMechanics, actionUsesKey(usesRef));
  const mode = record(mechanics.activation)?.mode;
  if ((mode === 'active' || mode === 'reaction') && mechanics.targeting === undefined) {
    throw new RuleActionProjectionError(
      `${usesRef}: active/reaction entity requires explicit mechanics.targeting`,
    );
  }
  let targeting: RuleActionDefinition['targeting'];
  if (mechanics.targeting !== undefined) {
    try {
      targeting = compileDeclaredMechanicsTargeting(mechanics);
    } catch (error) {
      throw new RuleActionProjectionError(
        `${usesRef}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const attackReplacement = compileAttackReplacement(mechanics);
  const restDecision = compileRestDecision(mechanics);
  const sourceEntityIds = [...new Set([entity.id, ...(provenance.sourceEntityIds ?? [])])]
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (!sourceEntityIds.length) {
    throw new RuleActionProjectionError(`${usesRef}: immutable source entity is required`);
  }
  const grantScopeId = provenance.grantScopeId ?? provenance.sourceClass;
  const id = grantScopeId ? `${entity.id}@${grantScopeId}` : entity.id;
  const common = {
    id,
    name: entity.name,
    mechanics,
    sourceEntityIds: sourceEntityIds as [string, ...string[]],
    ...(targeting ? { targeting } : {}),
    ...(attackReplacement ? { attackReplacement } : {}),
    ...(restDecision ? { restDecision } : {}),
    ...('level' in entity && entity.concentration ? { concentration: true } : {}),
  };
  if (!('level' in entity)) return { ...common, kind: 'nonSpell' };
  return {
    ...common,
    kind: 'spell',
    spell: {
      level: entity.level,
      ...(provenance.sourceClass ? { sourceClass: provenance.sourceClass } : {}),
      ritual: entity.ritual === true,
      classListIds: immutableSpellClassListIds(mechanics, entity),
      components: {
        verbal: entity.component_verbal === true,
        somatic: entity.component_somatic === true,
        material: entity.component_material === true,
      },
    },
  };
}

function matchingGrantSpellPayloads(value: unknown, spell: Spell): JsonObject[] {
  const result: JsonObject[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    const payload = record(item);
    if (!payload) return;
    if (payload.kind === 'grant_spell') {
      const refs = [payload.value, ...(Array.isArray(payload.values) ? payload.values : [])]
        .filter((entry): entry is string => typeof entry === 'string');
      if (refs.includes(spell.id) || refs.includes(spell.card_number)) result.push(payload);
    }
    Object.values(payload).forEach(visit);
  };
  visit(value);
  return result;
}

/** Decode the optional data-owned casting override on one exact grant. */
export function declaredSpellCastingOverride(
  grantMechanics: unknown,
  spell: Spell,
): SpellCastingOverride | undefined {
  const declarations = matchingGrantSpellPayloads(grantMechanics, spell)
    .filter((payload) => payload.casting_override !== undefined);
  if (declarations.length > 1) {
    throw new RuleActionProjectionError(
      `${spell.card_number}: grant has ambiguous casting_override declarations`,
    );
  }
  if (!declarations.length) return undefined;
  const raw = record(declarations[0].casting_override);
  if (!raw) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override must be an object`);
  }
  const allowedKeys = new Set([
    'remove_cost_resources', 'targeting', 'range_bonus_ft', 'components', 'free_use_resource', 'ritual',
  ]);
  if (Object.keys(raw).some((key) => !allowedKeys.has(key))) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override has unsupported fields`);
  }
  const resources = raw.remove_cost_resources ?? [];
  if (!Array.isArray(resources)
    || resources.some((entry) => typeof entry !== 'string' || entry.length === 0)
    || new Set(resources).size !== resources.length) {
    throw new RuleActionProjectionError(
      `${spell.card_number}: casting_override.remove_cost_resources must contain unique resource ids`,
    );
  }
  const targeting = raw.targeting;
  if (targeting !== undefined && !record(targeting)) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override.targeting must be an object`);
  }
  const rangeBonusFt = raw.range_bonus_ft;
  if (rangeBonusFt !== undefined && (typeof rangeBonusFt !== 'number' || rangeBonusFt <= 0)) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override.range_bonus_ft must be positive`);
  }
  const components = record(raw.components);
  if (raw.components !== undefined && (!components
    || Object.keys(components).some((key) => !['verbal', 'somatic', 'material'].includes(key))
    || Object.values(components).some((value) => typeof value !== 'boolean'))) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override.components is malformed`);
  }
  const freeUseResource = raw.free_use_resource;
  if (freeUseResource !== undefined
    && (typeof freeUseResource !== 'string' || freeUseResource.trim().length === 0)) {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override.free_use_resource must be non-empty`);
  }
  if (raw.ritual !== undefined && typeof raw.ritual !== 'boolean') {
    throw new RuleActionProjectionError(`${spell.card_number}: casting_override.ritual must be boolean`);
  }
  return {
    removeCostResources: [...resources] as string[],
    ...(targeting !== undefined ? { targeting: cloneJson(targeting as JsonObject) } : {}),
    ...(rangeBonusFt !== undefined ? { rangeBonusFt } : {}),
    ...(components ? {
      components: cloneJson(components) as Partial<Record<'verbal' | 'somatic' | 'material', boolean>>,
    } : {}),
    ...(freeUseResource !== undefined ? { freeUseResource } : {}),
    ...(raw.ritual !== undefined ? { ritual: raw.ritual } : {}),
  };
}

/** Apply a grant-owned override without mutating the immutable spell card. */
export function applySpellCastingOverride(
  spell: Spell,
  override?: SpellCastingOverride,
): Spell {
  const next = cloneJson(spell);
  if (!override) return next;
  const mechanics = cloneJson(next.mechanics ?? {});
  const activation = cloneJson(record(mechanics.activation) ?? {});
  const cost = Array.isArray(activation.cost) ? activation.cost as JsonObject[] : [];
  const removed = new Set(override.removeCostResources);
  const declaredResources = new Set(cost.map((entry) => String(entry.resource ?? '')));
  const missing = [...removed].filter((resource) => !declaredResources.has(resource));
  if (missing.length) {
    throw new RuleActionProjectionError(
      `${spell.card_number}: casting_override cannot remove absent cost resources: ${missing.join(', ')}`,
    );
  }
  activation.cost = cost.filter((entry) => !removed.has(String(entry.resource ?? '')));
  mechanics.activation = activation;
  if (override.targeting !== undefined) mechanics.targeting = cloneJson(override.targeting);
  if (override.rangeBonusFt !== undefined) {
    const targeting = record(mechanics.targeting);
    if (!targeting || typeof targeting.range_ft !== 'number') {
      throw new RuleActionProjectionError(
        `${spell.card_number}: casting_override.range_bonus_ft requires numeric targeting.range_ft`,
      );
    }
    mechanics.targeting = { ...targeting, range_ft: targeting.range_ft + override.rangeBonusFt };
  }
  if (override.components) {
    if (override.components.verbal !== undefined) next.component_verbal = override.components.verbal;
    if (override.components.somatic !== undefined) next.component_somatic = override.components.somatic;
    if (override.components.material !== undefined) next.component_material = override.components.material;
  }
  next.mechanics = mechanics;
  return next;
}
