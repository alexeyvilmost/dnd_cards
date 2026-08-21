import type { Ability } from './domain';

export type SpellAccessKind =
  | 'cantrip'
  | 'known'
  | 'spellbook'
  | 'always_prepared'
  | 'innate'
  | 'ritual_only';

export type SpellCastMode = 'normal' | 'ritual';

export interface SpellGrantAccess {
  /** Stable identity of this grant, not merely the spell card. */
  grantId: string;
  actionId: string;
  sourceId: string;
  access: SpellAccessKind;
  level: number;
  spellcastingAbility: Ability;
  ritual?: boolean;
  /** Resource usable once without a slot (for example Magic Initiate). */
  freeUseResource?: string;
  /** Resource normally spent by a levelled cast from this grant. */
  slotResource?: string;
}

export interface PreparedSpellSource {
  sourceId: string;
  capacity: number;
  /** The larger source collection, such as a Wizard spellbook. */
  availableActionIds: string[];
  preparedActionIds: string[];
}

export interface SpellcastingAccessState {
  grants: SpellGrantAccess[];
  preparedSources: Record<string, PreparedSpellSource | undefined>;
}

export type SpellAccessFailureCode =
  | 'SpellNotGranted'
  | 'SpellSourceAmbiguous'
  | 'SpellSourceNotGranted'
  | 'SpellNotPrepared'
  | 'RitualNotAllowed'
  | 'SpellNormalCastNotAllowed'
  | 'SpellResourceUnavailable';

export type SpellPreparationFailureCode =
  | 'PreparationSourceNotFound'
  | 'PreparationCountMismatch'
  | 'DuplicatePreparedSpell'
  | 'SpellOutsidePreparationSource';

export interface ResolvedSpellAccess {
  status: 'allowed';
  grant: SpellGrantAccess;
  payment: { kind: 'none' | 'free_use' | 'slot'; resource?: string };
}

export interface RejectedSpellAccess {
  status: 'rejected';
  code: SpellAccessFailureCode;
  message: string;
}

export interface RejectedSpellPreparation {
  status: 'rejected';
  code: SpellPreparationFailureCode;
  message: string;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resourceAvailable(resources: Readonly<Record<string, number>>, resource: string | undefined): boolean {
  return resource !== undefined && (resources[resource] ?? 0) > 0;
}

function isPrepared(state: SpellcastingAccessState, grant: SpellGrantAccess): boolean {
  if (grant.access !== 'spellbook') return true;
  return state.preparedSources[grant.sourceId]?.preparedActionIds.includes(grant.actionId) === true;
}

/** Preparation is a property of a source-scoped grant, not of the visual spell card. */
export function isSpellActionPrepared(
  state: SpellcastingAccessState,
  actionId: string,
): boolean {
  return state.grants
    .filter((grant) => grant.actionId === actionId)
    .some((grant) => isPrepared(state, grant));
}

/**
 * Resolve one immutable spell grant. The caller must name a grant when the same
 * spell is available from several sources; silently picking the first source
 * would change its spellcasting ability, resources, and provenance.
 */
export function resolveSpellAccess(input: {
  state: SpellcastingAccessState;
  actionId: string;
  grantId?: string;
  mode?: SpellCastMode;
  resources: Readonly<Record<string, number>>;
  preferFreeUse?: boolean;
}): ResolvedSpellAccess | RejectedSpellAccess {
  const candidates = input.state.grants.filter((grant) => grant.actionId === input.actionId);
  if (!candidates.length) {
    return {
      status: 'rejected',
      code: 'SpellNotGranted',
      message: `Spell action ${input.actionId} has no actor-owned grant`,
    };
  }

  let grant: SpellGrantAccess | undefined;
  if (input.grantId !== undefined) {
    grant = candidates.find((candidate) => candidate.grantId === input.grantId);
    if (!grant) {
      return {
        status: 'rejected',
        code: 'SpellSourceNotGranted',
        message: `Grant ${input.grantId} does not own spell action ${input.actionId}`,
      };
    }
  } else if (candidates.length > 1) {
    return {
      status: 'rejected',
      code: 'SpellSourceAmbiguous',
      message: `Spell action ${input.actionId} has ${candidates.length} grants; grantId is required`,
    };
  } else {
    [grant] = candidates;
  }

  const mode = input.mode ?? 'normal';
  if (mode === 'ritual') {
    if (!grant.ritual) {
      return {
        status: 'rejected',
        code: 'RitualNotAllowed',
        message: `Grant ${grant.grantId} cannot cast ${grant.actionId} as a ritual`,
      };
    }
    return { status: 'allowed', grant, payment: { kind: 'none' } };
  }

  if (grant.access === 'ritual_only') {
    return {
      status: 'rejected',
      code: 'SpellNormalCastNotAllowed',
      message: `Grant ${grant.grantId} can cast ${grant.actionId} only as a ritual`,
    };
  }

  if (!isPrepared(input.state, grant)) {
    return {
      status: 'rejected',
      code: 'SpellNotPrepared',
      message: `Spell action ${grant.actionId} is in ${grant.sourceId} but is not prepared`,
    };
  }

  if (grant.level === 0) return { status: 'allowed', grant, payment: { kind: 'none' } };
  // Some immutable grants explicitly make a levelled spell at-will (for
  // example Armor of Shadows and Pact of the Chain). The compiler represents
  // that authority as an innate grant with no payment resource. An innate
  // grant that *does* name a free-use or slot resource remains limited by it.
  if (grant.access === 'innate' && !grant.freeUseResource && !grant.slotResource) {
    return { status: 'allowed', grant, payment: { kind: 'none' } };
  }
  if (input.preferFreeUse !== false && resourceAvailable(input.resources, grant.freeUseResource)) {
    return {
      status: 'allowed',
      grant,
      payment: { kind: 'free_use', resource: grant.freeUseResource },
    };
  }
  if (resourceAvailable(input.resources, grant.slotResource)) {
    return { status: 'allowed', grant, payment: { kind: 'slot', resource: grant.slotResource } };
  }
  return {
    status: 'rejected',
    code: 'SpellResourceUnavailable',
    message: `Spell grant ${grant.grantId} has no available free use or slot resource`,
  };
}

/**
 * Replace a prepared subset without mutating the spellbook or another source.
 * Exact cardinality is intentional: the independent class oracle owns the
 * capacity and the UI cannot smuggle an extra prepared spell into the state.
 */
export function replacePreparedSpells(
  state: SpellcastingAccessState,
  sourceId: string,
  actionIds: readonly string[],
): SpellcastingAccessState | RejectedSpellPreparation {
  const source = state.preparedSources[sourceId];
  if (!source) {
    return {
      status: 'rejected',
      code: 'PreparationSourceNotFound',
      message: `Unknown prepared-spell source ${sourceId}`,
    };
  }
  if (new Set(actionIds).size !== actionIds.length) {
    return {
      status: 'rejected',
      code: 'DuplicatePreparedSpell',
      message: `Prepared spells for ${sourceId} must be distinct`,
    };
  }
  if (actionIds.length !== source.capacity) {
    return {
      status: 'rejected',
      code: 'PreparationCountMismatch',
      message: `Prepared spells for ${sourceId} require exactly ${source.capacity} actions`,
    };
  }
  const available = new Set(source.availableActionIds);
  const outside = actionIds.filter((actionId) => !available.has(actionId));
  if (outside.length) {
    return {
      status: 'rejected',
      code: 'SpellOutsidePreparationSource',
      message: `${outside.join(', ')} is not available from ${sourceId}`,
    };
  }
  return {
    grants: state.grants.map((grant) => ({ ...grant })),
    preparedSources: {
      ...state.preparedSources,
      [sourceId]: {
        ...source,
        availableActionIds: sortedUnique(source.availableActionIds),
        preparedActionIds: sortedUnique(actionIds),
      },
    },
  };
}
