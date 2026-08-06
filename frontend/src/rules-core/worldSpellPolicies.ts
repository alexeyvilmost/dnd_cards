import { compileMechanicsTargeting, type MechanicsTargetDomain } from './actionTargeting';
import type { JsonObject, Relation } from './domain';
import { preflightMechanicsExecution } from './legacy/engineAdapter';
import type { CharacterContext, RuntimeState } from './legacy/engineAdapter';
import type { MagicBlockingLayer, WorldObjectSize } from './worldObjects';

export type ManagedWorldSpellPrimitiveType =
  | 'light_world_object'
  | 'burning_hands_objects'
  | 'detect_magic_world_sensing'
  | 'minor_illusion_world_object'
  | 'dancing_lights_world'
  | 'druidcraft_world'
  | 'mending_world'
  | 'detect_poison_disease_world'
  | 'purify_food_drink_world'
  | 'prestidigitation_world'
  | 'magic_missile';

export interface ParsedMechanicsTargeting {
  domain: MechanicsTargetDomain;
  actorTargets: boolean;
  shape: 'self' | 'single' | 'multi' | 'multiple' | 'area' | 'aura';
  rangeFt: number;
  requiresLineOfSight: boolean;
  requiresTouch: boolean;
  allowedRelations: Relation[];
  area?: {
    kind: 'sphere' | 'cube' | 'cone' | 'line' | 'cylinder' | 'emanation';
    sizeFt?: number;
    radiusFt?: number;
  };
}

export interface LightWorldPolicy {
  maxObjectSize: WorldObjectSize;
  excludeCarriedByOther: boolean;
  brightRadiusFt: number;
  dimAdditionalRadiusFt: number;
  durationRounds: number;
  maxActivePerSource: number;
}

export interface BurningHandsObjectsPolicy {
  requireInArea: boolean;
  requireFlammable: boolean;
  excludeCarried: boolean;
}

export interface MagicBlockerThreshold {
  thresholdInches: number;
  comparison: 'gte' | 'gt';
}

export type MagicBlockerPolicy = Record<MagicBlockingLayer['material'], MagicBlockerThreshold | null>;

export interface DetectMagicWorldPolicy {
  blockers: MagicBlockerPolicy;
  auraRequiresLineOfSight: boolean;
  revealSpellSchoolOnly: boolean;
}

export interface MinorIllusionWorldPolicy {
  imageMaxCubeSideFt: number;
  durationRounds: number;
  maxActivePerSource: number;
  studyAbility: 'int';
  studySkill: 'investigation';
}

export interface DancingLightsWorldPolicy {
  minIndividualLights: number;
  maxIndividualLights: number;
  combinedFormObjectCount: number;
  requiredSeparationFt: number;
  maxMoveFt: number;
  dimRadiusFt: number;
  durationRounds: number;
}

export interface DruidcraftWorldPolicy {
  sensoryCubeSideFt: number;
  weatherDurationRounds: number;
}

export interface MendingWorldPolicy {
  maxBreakDimensionFt: number;
}

export interface DetectPoisonDiseaseWorldPolicy {
  blockers: MagicBlockerPolicy;
}

export interface PurifyFoodDrinkWorldPolicy {
  requireInArea: boolean;
  excludeMagical: boolean;
}

export interface PrestidigitationWorldPolicy {
  maxVolumeCubicFt: number;
  maxActiveEffects: number;
  attachmentDurationRounds: number;
  creationSourceTurnEndings: number;
}

export interface MagicMissilePolicy {
  baseSlotLevel: number;
  maxSlotLevel: number;
  baseDartCount: number;
  dartsPerSlotAbove: number;
  allocationChoiceId: string;
  simultaneous: boolean;
  perDartEffect: JsonObject;
}

export type ManagedWorldSpellPolicy =
  | LightWorldPolicy
  | BurningHandsObjectsPolicy
  | DetectMagicWorldPolicy
  | MinorIllusionWorldPolicy
  | DancingLightsWorldPolicy
  | DruidcraftWorldPolicy
  | MendingWorldPolicy
  | DetectPoisonDiseaseWorldPolicy
  | PurifyFoodDrinkWorldPolicy
  | PrestidigitationWorldPolicy
  | MagicMissilePolicy;

export type WorldSpellPolicyParseResult =
  | { status: 'not_applicable' }
  | { status: 'invalid'; issue: string }
  | {
    status: 'valid';
    primitiveType: ManagedWorldSpellPrimitiveType;
    targeting: ParsedMechanicsTargeting;
    policy: ManagedWorldSpellPolicy;
  };

const MANAGED_TYPES = new Set<ManagedWorldSpellPrimitiveType>([
  'light_world_object',
  'burning_hands_objects',
  'detect_magic_world_sensing',
  'minor_illusion_world_object',
  'dancing_lights_world',
  'druidcraft_world',
  'mending_world',
  'detect_poison_disease_world',
  'purify_food_drink_world',
  'prestidigitation_world',
  'magic_missile',
]);

function record(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} must declare exactly: ${wanted.join(', ')}`);
  }
}

function number(value: unknown, label: string, options: { integer?: boolean; positive?: boolean } = {}): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || (options.positive && value <= 0)
    || (options.integer && !Number.isInteger(value))) {
    const qualifier = `${options.positive ? 'positive ' : 'non-negative '}${options.integer ? 'integer' : 'number'}`;
    throw new Error(`${label} must be a finite ${qualifier}`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) {
    throw new Error(`${label} must be a stable non-empty string`);
  }
  return value;
}

function parseBlockers(value: unknown, label: string): MagicBlockerPolicy {
  const blockers = record(value, label);
  const materials = ['stone', 'common_metal', 'lead', 'wood', 'dirt', 'other'] as const;
  exactKeys(blockers, materials, label);
  return Object.fromEntries(materials.map((material) => {
    const raw = blockers[material];
    if (raw === null) return [material, null];
    const threshold = record(raw, `${label}.${material}`);
    exactKeys(threshold, ['threshold_inches', 'comparison'], `${label}.${material}`);
    if (threshold.comparison !== 'gte' && threshold.comparison !== 'gt') {
      throw new Error(`${label}.${material}.comparison must be gte or gt`);
    }
    return [material, {
      thresholdInches: number(
        threshold.threshold_inches,
        `${label}.${material}.threshold_inches`,
      ),
      comparison: threshold.comparison,
    }];
  })) as MagicBlockerPolicy;
}

function parseTargeting(
  mechanics: JsonObject,
  primitiveType: ManagedWorldSpellPrimitiveType,
): ParsedMechanicsTargeting {
  const raw = record(mechanics.targeting, `${primitiveType}.targeting`);
  for (const key of [
    'domain', 'actor_targets', 'range_ft', 'allowed_relations', 'requires_line_of_sight', 'shape',
  ] as const) {
    if (raw[key] === undefined) throw new Error(`${primitiveType}.targeting.${key} is required`);
  }
  const compiled = compileMechanicsTargeting(mechanics);
  const domain = raw.domain as MechanicsTargetDomain;
  const allowedRelations = compiled.allowedRelations;
  const requiresTouch = raw.requires_touch === undefined
    ? false
    : boolean(raw.requires_touch, `${primitiveType}.targeting.requires_touch`);
  let area: ParsedMechanicsTargeting['area'];
  if (raw.area !== undefined) {
    const rawArea = record(raw.area, `${primitiveType}.targeting.area`);
    const kind = rawArea.kind as NonNullable<ParsedMechanicsTargeting['area']>['kind'];
    area = {
      kind,
      ...(rawArea.size_ft === undefined
        ? {}
        : { sizeFt: number(rawArea.size_ft, `${primitiveType}.targeting.area.size_ft`, { positive: true }) }),
      ...(rawArea.radius_ft === undefined
        ? {}
        : { radiusFt: number(rawArea.radius_ft, `${primitiveType}.targeting.area.radius_ft`, { positive: true }) }),
    };
  }
  return {
    domain,
    actorTargets: raw.actor_targets as boolean,
    shape: raw.shape as ParsedMechanicsTargeting['shape'],
    rangeFt: compiled.rangeFt,
    requiresLineOfSight: compiled.requiresLineOfSight,
    requiresTouch,
    allowedRelations,
    ...(area ? { area } : {}),
  };
}

function requireTargeting(input: {
  primitiveType: ManagedWorldSpellPrimitiveType;
  targeting: ParsedMechanicsTargeting;
  domain: MechanicsTargetDomain;
  shape: string;
  actorTargets: boolean;
  requiresTouch?: boolean;
  area?: { kind: NonNullable<ParsedMechanicsTargeting['area']>['kind']; metric: 'sizeFt' | 'radiusFt' };
}): void {
  if (input.targeting.domain !== input.domain || input.targeting.actorTargets !== input.actorTargets) {
    throw new Error(`${input.primitiveType} targeting domain is inconsistent`);
  }
  const selfTarget = input.targeting.shape === 'self';
  const relationPolicyIsValid = selfTarget
    ? input.targeting.allowedRelations.length === 1
      && input.targeting.allowedRelations[0] === 'self'
    : input.actorTargets === (input.targeting.allowedRelations.length > 0);
  if (!relationPolicyIsValid) {
    throw new Error(`${input.primitiveType} targeting relations contradict actor_targets`);
  }
  if (input.targeting.shape !== input.shape) {
    throw new Error(`${input.primitiveType} targeting shape is inconsistent`);
  }
  if (input.requiresTouch !== undefined && input.targeting.requiresTouch !== input.requiresTouch) {
    throw new Error(`${input.primitiveType} targeting touch policy is inconsistent`);
  }
  if (input.area) {
    if (input.targeting.area?.kind !== input.area.kind
      || input.targeting.area[input.area.metric] === undefined) {
      throw new Error(`${input.primitiveType} targeting area is inconsistent`);
    }
  }
}

const PREFLIGHT_CHARACTER: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

const PREFLIGHT_STATE: RuntimeState = {
  hp: { current: 1, max: 1, temp: 0 },
  resources: {},
  maxResources: {},
  equipment: {},
  inventory: [],
  activeEffects: [],
};

function parsePerDartEffect(value: unknown): JsonObject {
  const effect = record(value, 'magic_missile.policy.per_dart_effect');
  if (effect.resolution !== 'auto' || effect.who !== 'target' || !Array.isArray(effect.result)) {
    throw new Error('magic_missile per_dart_effect must be an auto target interaction');
  }
  if (!effect.result.some((payload) => (
    payload && typeof payload === 'object' && !Array.isArray(payload)
      && (payload as JsonObject).kind === 'damage'
      && typeof (payload as JsonObject).type === 'string'
      && Boolean(String((payload as JsonObject).type).trim())
  ))) {
    throw new Error('magic_missile per_dart_effect must declare damage type and formula');
  }
  try {
    preflightMechanicsExecution(PREFLIGHT_STATE, { effects: [effect] }, {
      character: PREFLIGHT_CHARACTER,
      rng: () => 0.5,
    });
  } catch (error) {
    throw new Error(`magic_missile per_dart_effect is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return JSON.parse(JSON.stringify(effect)) as JsonObject;
}

/** Parse and validate all data-owned policy before resources, RNG, ids, or state are touched. */
export function parseWorldSpellPolicy(mechanics: JsonObject): WorldSpellPolicyParseResult {
  const primitiveValue = mechanics.primitive;
  if (!primitiveValue || typeof primitiveValue !== 'object' || Array.isArray(primitiveValue)) {
    return { status: 'not_applicable' };
  }
  const primitive = primitiveValue as JsonObject;
  if (!MANAGED_TYPES.has(primitive.type as ManagedWorldSpellPrimitiveType)) {
    return { status: 'not_applicable' };
  }
  const primitiveType = primitive.type as ManagedWorldSpellPrimitiveType;
  try {
    exactKeys(primitive, ['type', 'policy'], `${primitiveType}.primitive`);
    const raw = record(primitive.policy, `${primitiveType}.policy`);
    const targeting = parseTargeting(mechanics, primitiveType);

    let policy: ManagedWorldSpellPolicy;
    switch (primitiveType) {
      case 'light_world_object': {
        exactKeys(raw, [
          'max_object_size', 'exclude_carried_by_other', 'bright_radius_ft',
          'dim_additional_radius_ft', 'duration_rounds', 'max_active_per_source',
        ], `${primitiveType}.policy`);
        const maxObjectSize = raw.max_object_size;
        if (!['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'].includes(String(maxObjectSize))) {
          throw new Error(`${primitiveType}.policy.max_object_size is invalid`);
        }
        policy = {
          maxObjectSize: maxObjectSize as WorldObjectSize,
          excludeCarriedByOther: boolean(raw.exclude_carried_by_other, `${primitiveType}.policy.exclude_carried_by_other`),
          brightRadiusFt: number(raw.bright_radius_ft, `${primitiveType}.policy.bright_radius_ft`, { positive: true }),
          dimAdditionalRadiusFt: number(raw.dim_additional_radius_ft, `${primitiveType}.policy.dim_additional_radius_ft`, { positive: true }),
          durationRounds: number(raw.duration_rounds, `${primitiveType}.policy.duration_rounds`, { positive: true, integer: true }),
          maxActivePerSource: number(raw.max_active_per_source, `${primitiveType}.policy.max_active_per_source`, { positive: true, integer: true }),
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'single', actorTargets: false, requiresTouch: true });
        break;
      }
      case 'burning_hands_objects': {
        exactKeys(raw, ['require_in_area', 'require_flammable', 'exclude_carried'], `${primitiveType}.policy`);
        policy = {
          requireInArea: boolean(raw.require_in_area, `${primitiveType}.policy.require_in_area`),
          requireFlammable: boolean(raw.require_flammable, `${primitiveType}.policy.require_flammable`),
          excludeCarried: boolean(raw.exclude_carried, `${primitiveType}.policy.exclude_carried`),
        };
        requireTargeting({ primitiveType, targeting, domain: 'mixed', shape: 'area', actorTargets: true, area: { kind: 'cone', metric: 'sizeFt' } });
        break;
      }
      case 'detect_magic_world_sensing': {
        exactKeys(raw, ['blockers', 'aura_requires_line_of_sight', 'reveal_spell_school_only'], `${primitiveType}.policy`);
        policy = {
          blockers: parseBlockers(raw.blockers, `${primitiveType}.policy.blockers`),
          auraRequiresLineOfSight: boolean(raw.aura_requires_line_of_sight, `${primitiveType}.policy.aura_requires_line_of_sight`),
          revealSpellSchoolOnly: boolean(raw.reveal_spell_school_only, `${primitiveType}.policy.reveal_spell_school_only`),
        };
        requireTargeting({ primitiveType, targeting, domain: 'actor', shape: 'self', actorTargets: false, area: { kind: 'emanation', metric: 'radiusFt' } });
        break;
      }
      case 'minor_illusion_world_object': {
        exactKeys(raw, ['image_max_cube_side_ft', 'duration_rounds', 'max_active_per_source', 'study_ability', 'study_skill'], `${primitiveType}.policy`);
        if (raw.study_ability !== 'int' || raw.study_skill !== 'investigation') {
          throw new Error(`${primitiveType} study policy is invalid`);
        }
        policy = {
          imageMaxCubeSideFt: number(raw.image_max_cube_side_ft, `${primitiveType}.policy.image_max_cube_side_ft`, { positive: true }),
          durationRounds: number(raw.duration_rounds, `${primitiveType}.policy.duration_rounds`, { positive: true, integer: true }),
          maxActivePerSource: number(raw.max_active_per_source, `${primitiveType}.policy.max_active_per_source`, { positive: true, integer: true }),
          studyAbility: 'int',
          studySkill: 'investigation',
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'single', actorTargets: false });
        break;
      }
      case 'dancing_lights_world': {
        exactKeys(raw, [
          'min_individual_lights', 'max_individual_lights', 'combined_form_object_count',
          'required_separation_ft', 'max_move_ft', 'dim_radius_ft',
          'duration_rounds',
        ], `${primitiveType}.policy`);
        const minIndividualLights = number(raw.min_individual_lights, `${primitiveType}.policy.min_individual_lights`, { positive: true, integer: true });
        const maxIndividualLights = number(raw.max_individual_lights, `${primitiveType}.policy.max_individual_lights`, { positive: true, integer: true });
        if (minIndividualLights > maxIndividualLights) throw new Error(`${primitiveType} light counts are inconsistent`);
        policy = {
          minIndividualLights,
          maxIndividualLights,
          combinedFormObjectCount: number(raw.combined_form_object_count, `${primitiveType}.policy.combined_form_object_count`, { positive: true, integer: true }),
          requiredSeparationFt: number(raw.required_separation_ft, `${primitiveType}.policy.required_separation_ft`, { positive: true }),
          maxMoveFt: number(raw.max_move_ft, `${primitiveType}.policy.max_move_ft`, { positive: true }),
          dimRadiusFt: number(raw.dim_radius_ft, `${primitiveType}.policy.dim_radius_ft`, { positive: true }),
          durationRounds: number(raw.duration_rounds, `${primitiveType}.policy.duration_rounds`, { positive: true, integer: true }),
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'multiple', actorTargets: false });
        break;
      }
      case 'druidcraft_world': {
        exactKeys(raw, ['sensory_cube_side_ft', 'weather_duration_rounds'], `${primitiveType}.policy`);
        policy = {
          sensoryCubeSideFt: number(raw.sensory_cube_side_ft, `${primitiveType}.policy.sensory_cube_side_ft`, { positive: true }),
          weatherDurationRounds: number(raw.weather_duration_rounds, `${primitiveType}.policy.weather_duration_rounds`, { positive: true, integer: true }),
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'single', actorTargets: false });
        break;
      }
      case 'mending_world': {
        exactKeys(raw, ['max_break_dimension_ft'], `${primitiveType}.policy`);
        policy = { maxBreakDimensionFt: number(raw.max_break_dimension_ft, `${primitiveType}.policy.max_break_dimension_ft`, { positive: true }) };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'single', actorTargets: false, requiresTouch: true });
        break;
      }
      case 'detect_poison_disease_world': {
        exactKeys(raw, ['blockers'], `${primitiveType}.policy`);
        policy = {
          blockers: parseBlockers(raw.blockers, `${primitiveType}.policy.blockers`),
        };
        requireTargeting({ primitiveType, targeting, domain: 'actor', shape: 'self', actorTargets: false, area: { kind: 'emanation', metric: 'radiusFt' } });
        break;
      }
      case 'purify_food_drink_world': {
        exactKeys(raw, ['require_in_area', 'exclude_magical'], `${primitiveType}.policy`);
        policy = {
          requireInArea: boolean(raw.require_in_area, `${primitiveType}.policy.require_in_area`),
          excludeMagical: boolean(raw.exclude_magical, `${primitiveType}.policy.exclude_magical`),
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'area', actorTargets: false, area: { kind: 'sphere', metric: 'radiusFt' } });
        break;
      }
      case 'prestidigitation_world': {
        exactKeys(raw, ['max_volume_cubic_ft', 'max_active_effects', 'attachment_duration_rounds', 'creation_source_turn_endings'], `${primitiveType}.policy`);
        policy = {
          maxVolumeCubicFt: number(raw.max_volume_cubic_ft, `${primitiveType}.policy.max_volume_cubic_ft`, { positive: true }),
          maxActiveEffects: number(raw.max_active_effects, `${primitiveType}.policy.max_active_effects`, { positive: true, integer: true }),
          attachmentDurationRounds: number(raw.attachment_duration_rounds, `${primitiveType}.policy.attachment_duration_rounds`, { positive: true, integer: true }),
          creationSourceTurnEndings: number(raw.creation_source_turn_endings, `${primitiveType}.policy.creation_source_turn_endings`, { positive: true, integer: true }),
        };
        requireTargeting({ primitiveType, targeting, domain: 'world', shape: 'single', actorTargets: false });
        break;
      }
      case 'magic_missile': {
        exactKeys(raw, [
          'base_slot_level', 'max_slot_level', 'base_dart_count', 'darts_per_slot_above',
          'allocation_choice_id', 'simultaneous', 'per_dart_effect',
        ], `${primitiveType}.policy`);
        const baseSlotLevel = number(raw.base_slot_level, `${primitiveType}.policy.base_slot_level`, { positive: true, integer: true });
        const maxSlotLevel = number(raw.max_slot_level, `${primitiveType}.policy.max_slot_level`, { positive: true, integer: true });
        if (baseSlotLevel > maxSlotLevel || maxSlotLevel > 9) throw new Error(`${primitiveType} slot-level policy is inconsistent`);
        policy = {
          baseSlotLevel,
          maxSlotLevel,
          baseDartCount: number(raw.base_dart_count, `${primitiveType}.policy.base_dart_count`, { positive: true, integer: true }),
          dartsPerSlotAbove: number(raw.darts_per_slot_above, `${primitiveType}.policy.darts_per_slot_above`, { positive: true, integer: true }),
          allocationChoiceId: nonEmptyString(raw.allocation_choice_id, `${primitiveType}.policy.allocation_choice_id`),
          simultaneous: boolean(raw.simultaneous, `${primitiveType}.policy.simultaneous`),
          perDartEffect: parsePerDartEffect(raw.per_dart_effect),
        };
        requireTargeting({ primitiveType, targeting, domain: 'actor', shape: 'multiple', actorTargets: true });
        const maximumDarts = policy.baseDartCount
          + (policy.maxSlotLevel - policy.baseSlotLevel) * policy.dartsPerSlotAbove;
        const maxTargets = Number((mechanics.targeting as JsonObject).max_targets);
        if (!Number.isInteger(maxTargets) || maxTargets !== maximumDarts) {
          throw new Error(`${primitiveType}.targeting.max_targets must equal maximum dart count ${maximumDarts}`);
        }
        break;
      }
    }
    return { status: 'valid', primitiveType, targeting, policy };
  } catch (error) {
    return {
      status: 'invalid',
      issue: error instanceof Error ? error.message : String(error),
    };
  }
}

export function magicMissileDartCount(policy: MagicMissilePolicy, castLevel: number): number | null {
  if (!Number.isInteger(castLevel)
    || castLevel < policy.baseSlotLevel
    || castLevel > policy.maxSlotLevel) return null;
  return policy.baseDartCount
    + (castLevel - policy.baseSlotLevel) * policy.dartsPerSlotAbove;
}
