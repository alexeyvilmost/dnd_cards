import type { ActionTargeting, JsonObject, Relation } from './domain';

export type MechanicsTargetDomain = 'world' | 'actor' | 'mixed';

export class ActionTargetingDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionTargetingDefinitionError';
  }
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionTargetingDefinitionError(`${label} must be an object`);
  }
  return value as JsonObject;
}

function finiteNonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ActionTargetingDefinitionError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || Number(resolved) < 1) {
    throw new ActionTargetingDefinitionError(`${label} must be a positive integer`);
  }
  return Number(resolved);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new ActionTargetingDefinitionError(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function legacyRangeFt(targeting: JsonObject): number {
  const raw = String(targeting.range ?? '');
  if (/касание|touch/i.test(raw)) return 5;
  if (/на себя|self/i.test(raw)) return 0;
  const match = raw.match(/\d+(?:[.,]\d+)?/);
  if (match) return Number(match[0].replace(',', '.'));
  const area = targeting.area;
  if (area && typeof area === 'object' && !Array.isArray(area)) {
    const size = Number((area as JsonObject).size);
    if (Number.isFinite(size) && size > 0) return size;
  }
  return 5;
}

function validateArea(value: unknown): void {
  if (value === undefined) return;
  const area = object(value, 'targeting.area');
  if (!['sphere', 'cube', 'cone', 'line', 'cylinder', 'emanation'].includes(String(area.kind ?? ''))) {
    throw new ActionTargetingDefinitionError('targeting.area.kind is invalid');
  }
  const numericKeys = ['size_ft', 'radius_ft'] as const;
  const declared = numericKeys.filter((key) => area[key] !== undefined);
  if (declared.length > 1) {
    throw new ActionTargetingDefinitionError('targeting.area must declare only one numeric size authority');
  }
  if (declared.length === 1) {
    const size = finiteNonNegative(area[declared[0]], `targeting.area.${declared[0]}`);
    if (size <= 0) throw new ActionTargetingDefinitionError(`targeting.area.${declared[0]} must be positive`);
  }
  if (area.size !== undefined) {
    const size = Number(area.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw new ActionTargetingDefinitionError('legacy targeting.area.size must be positive');
    }
  }
}

/**
 * Pure mechanics-to-domain compiler. Numeric geometry is authoritative when
 * present. The localized `range` fallback exists only for catalog entities
 * that have not yet migrated; it never dispatches on card/name/primitive id.
 */
export function compileMechanicsTargeting(mechanics: JsonObject): ActionTargeting {
  const targeting = object(mechanics.targeting ?? {}, 'mechanics.targeting');
  const shape = String(targeting.shape ?? 'single');
  if (!['self', 'single', 'multi', 'multiple', 'area', 'aura'].includes(shape)) {
    throw new ActionTargetingDefinitionError(`targeting.shape ${shape} is invalid`);
  }
  validateArea(targeting.area);

  const hasDomain = targeting.domain !== undefined || targeting.actor_targets !== undefined;
  let actorTargets: boolean;
  if (hasDomain) {
    if (!['world', 'actor', 'mixed'].includes(String(targeting.domain ?? ''))) {
      throw new ActionTargetingDefinitionError('targeting.domain must be world, actor, or mixed');
    }
    if (typeof targeting.actor_targets !== 'boolean') {
      throw new ActionTargetingDefinitionError('targeting.actor_targets must be boolean');
    }
    const domain = targeting.domain as MechanicsTargetDomain;
    actorTargets = targeting.actor_targets;
    const expectsExplicitActorTargets = domain === 'mixed'
      || (domain === 'actor' && shape !== 'self');
    if (actorTargets !== expectsExplicitActorTargets) {
      throw new ActionTargetingDefinitionError('targeting.domain contradicts targeting.actor_targets');
    }
  } else {
    actorTargets = shape !== 'self';
  }

  const area = shape === 'area';
  const multiple = shape === 'multi' || shape === 'multiple';
  const self = shape === 'self';
  const fallbackMaximum = area ? 8 : multiple ? 3 : 1;
  // A world-only action can explicitly declare that it consumes no actor
  // targets. This is the canonical contract used by inventory/container and
  // other target-independent actions; callers then dispatch targetIds: [].
  // Actor/self targeting remains strictly positive.
  const worldOnly = targeting.domain === 'world' && actorTargets === false;
  const maxTargets = worldOnly
    ? nonNegativeInteger(targeting.max_targets ?? 0, 'targeting.max_targets')
    : positiveInteger(targeting.max_targets, fallbackMaximum, 'targeting.max_targets');
  const minTargets = targeting.min_targets === undefined
    ? (area || !actorTargets ? 0 : 1)
    : nonNegativeInteger(targeting.min_targets, 'targeting.min_targets');
  if (minTargets > maxTargets) {
    throw new ActionTargetingDefinitionError('targeting.min_targets cannot exceed targeting.max_targets');
  }

  const rangeFt = targeting.range_ft === undefined
    ? legacyRangeFt(targeting)
    : finiteNonNegative(targeting.range_ft, 'targeting.range_ft');
  const requiresLineOfSight = targeting.requires_line_of_sight === undefined
    ? !self
    : targeting.requires_line_of_sight;
  if (typeof requiresLineOfSight !== 'boolean') {
    throw new ActionTargetingDefinitionError('targeting.requires_line_of_sight must be boolean');
  }
  for (const key of ['requires_sight', 'requires_willing', 'requires_unarmored'] as const) {
    if (targeting[key] !== undefined && typeof targeting[key] !== 'boolean') {
      throw new ActionTargetingDefinitionError(`targeting.${key} must be boolean`);
    }
  }
  if (targeting.requires_stonework_contact !== undefined
    && targeting.requires_stonework_contact !== true) {
    throw new ActionTargetingDefinitionError('targeting.requires_stonework_contact must be true when present');
  }
  if (targeting.requires_touch !== undefined && typeof targeting.requires_touch !== 'boolean') {
    throw new ActionTargetingDefinitionError('targeting.requires_touch must be boolean');
  }

  const defaultRelations: Relation[] = self ? ['self'] : ['self', 'ally', 'enemy', 'neutral'];
  let allowedRelations = defaultRelations;
  if (targeting.allowed_relations !== undefined) {
    if (!Array.isArray(targeting.allowed_relations)
      || targeting.allowed_relations.some((relation) => (
        !['self', 'ally', 'enemy', 'neutral'].includes(String(relation))
      ))
      || new Set(targeting.allowed_relations).size !== targeting.allowed_relations.length) {
      throw new ActionTargetingDefinitionError('targeting.allowed_relations must contain unique actor relations');
    }
    allowedRelations = [...targeting.allowed_relations] as Relation[];
    if (self && (allowedRelations.length !== 1 || allowedRelations[0] !== 'self')) {
      throw new ActionTargetingDefinitionError(
        'self targeting requires allowed_relations to contain exactly self',
      );
    }
    if (!self && actorTargets && allowedRelations.length === 0) {
      throw new ActionTargetingDefinitionError('actor targeting requires at least one allowed relation');
    }
    if (!self && !actorTargets && allowedRelations.length !== 0) {
      throw new ActionTargetingDefinitionError('world targeting cannot allow actor relations');
    }
  }
  return {
    minTargets,
    maxTargets,
    rangeFt,
    requiresLineOfSight,
    ...(targeting.requires_sight === true ? { requiresSight: true } : {}),
    allowedRelations,
    ...(targeting.requires_willing === true ? { requiresWilling: true } : {}),
    ...(targeting.requires_unarmored === true ? { requiresUnarmored: true } : {}),
    ...(targeting.requires_touch === true ? { requiresTouch: true as const } : {}),
    ...(targeting.requires_stonework_contact === true
      ? { requiresStoneworkContact: true as const }
      : {}),
  };
}

const DECLARED_TARGETING_KEYS = [
  'shape',
  'domain',
  'actor_targets',
  'min_targets',
  'max_targets',
  'range_ft',
  'requires_line_of_sight',
  'allowed_relations',
] as const;

/**
 * Certified-content compiler. Unlike compileMechanicsTargeting, it has no
 * compatibility defaults and never parses display text such as `range`.
 * Every value that changes target legality must exist in mechanics.targeting.
 */
export function compileDeclaredMechanicsTargeting(mechanics: JsonObject): ActionTargeting {
  const targeting = object(mechanics.targeting, 'mechanics.targeting');
  const missing = DECLARED_TARGETING_KEYS.filter((key) => (
    !Object.prototype.hasOwnProperty.call(targeting, key)
  ));
  if (missing.length) {
    throw new ActionTargetingDefinitionError(
      `mechanics.targeting is missing explicit ${missing.join(', ')}`,
    );
  }

  if (targeting.shape === 'area' || targeting.area !== undefined) {
    const area = object(targeting.area, 'targeting.area');
    if (!Object.prototype.hasOwnProperty.call(area, 'kind')) {
      throw new ActionTargetingDefinitionError('targeting.area.kind must be explicit');
    }
    const numericAuthority = ['size_ft', 'radius_ft'].filter((key) => (
      Object.prototype.hasOwnProperty.call(area, key)
    ));
    if (numericAuthority.length !== 1) {
      throw new ActionTargetingDefinitionError(
        'targeting.area requires exactly one explicit size_ft or radius_ft',
      );
    }
    if (Object.prototype.hasOwnProperty.call(area, 'size')) {
      throw new ActionTargetingDefinitionError(
        'legacy targeting.area.size is not allowed in certified content',
      );
    }
  }

  return compileMechanicsTargeting(mechanics);
}
