import type { Ability, RuleActionDefinition } from '../rules-core/domain';
import type {
  PreparedSpellSource,
  SpellAccessKind,
  SpellcastingAccessState,
} from '../rules-core/spellcastingAccess';

export interface SpellGrantProjection {
  action: RuleActionDefinition;
  sourceId: string;
  access: SpellAccessKind;
  spellcastingAbility: Ability;
  ritual?: boolean;
  freeUseResource?: string;
  slotResource?: string;
}

export interface PreparedSourceProjection {
  sourceId: string;
  capacity: number;
  availableActionIds: readonly string[];
  /** Exact persisted player selection; compilation never invents a subset. */
  preparedActionIds: readonly string[];
}

export class SpellcastingAccessProjectionError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Spellcasting access projection is invalid:\n${problems.join('\n')}`);
    this.name = 'SpellcastingAccessProjectionError';
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Materialize immutable, source-scoped grants from already compiled spell
 * actions. It deliberately does not infer a source from a spell card: the
 * compiler must name the class, feat, lineage, or invocation that owns it.
 */
export function projectSpellcastingAccess(input: {
  grants: readonly SpellGrantProjection[];
  preparedSources?: readonly PreparedSourceProjection[];
}): SpellcastingAccessState {
  const problems: string[] = [];
  const grants = [...input.grants]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId)
      || left.action.id.localeCompare(right.action.id))
    .map((projection) => {
      if (projection.action.kind !== 'spell') {
        problems.push(`${projection.action.id}: a spell grant must reference a spell action`);
      }
      if (!projection.sourceId) problems.push(`${projection.action.id}: sourceId is required`);
      const level = projection.action.kind === 'spell' ? projection.action.spell.level : -1;
      if (level > 0 && projection.access !== 'innate' && projection.access !== 'ritual_only'
        && !projection.slotResource && !projection.freeUseResource) {
        problems.push(`${projection.sourceId}:${projection.action.id}: a levelled grant needs a payment resource`);
      }
      return {
        grantId: `spell-grant:${projection.sourceId}:${projection.action.id}`,
        actionId: projection.action.id,
        sourceId: projection.sourceId,
        access: projection.access,
        level,
        spellcastingAbility: projection.spellcastingAbility,
        ...(projection.ritual ? { ritual: true } : {}),
        ...(projection.freeUseResource ? { freeUseResource: projection.freeUseResource } : {}),
        ...(projection.slotResource ? { slotResource: projection.slotResource } : {}),
      };
    });

  const duplicateGrantIds = grants
    .map((grant) => grant.grantId)
    .filter((grantId, index, all) => all.indexOf(grantId) !== index);
  if (duplicateGrantIds.length) {
    problems.push(`duplicate grants: ${sortedUnique(duplicateGrantIds).join(', ')}`);
  }

  const preparedSources: Record<string, PreparedSpellSource | undefined> = {};
  for (const projection of [...(input.preparedSources ?? [])]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))) {
    if (preparedSources[projection.sourceId]) {
      problems.push(`${projection.sourceId}: duplicate prepared source`);
      continue;
    }
    const availableActionIds = sortedUnique(projection.availableActionIds);
    if (!Number.isInteger(projection.capacity)
      || projection.capacity < 0
      || projection.capacity > availableActionIds.length) {
      problems.push(
        `${projection.sourceId}: capacity ${projection.capacity} exceeds ${availableActionIds.length} available spells`,
      );
    }
    if (!Array.isArray(projection.preparedActionIds)) {
      problems.push(`${projection.sourceId}: explicit preparedActionIds are required`);
    }
    const preparedActionIds = Array.isArray(projection.preparedActionIds)
      ? sortedUnique(projection.preparedActionIds)
      : [];
    if (preparedActionIds.length !== projection.capacity) {
      problems.push(`${projection.sourceId}: expected exactly ${projection.capacity} prepared spells`);
    }
    if (preparedActionIds.some((actionId) => !availableActionIds.includes(actionId))) {
      problems.push(`${projection.sourceId}: prepared spell lies outside the available source`);
    }
    const sourceSpellbookActions = grants.filter((grant) => (
      grant.sourceId === projection.sourceId && grant.access === 'spellbook'
    )).map((grant) => grant.actionId);
    if (sourceSpellbookActions.length !== availableActionIds.length
      || sourceSpellbookActions.some((actionId) => !availableActionIds.includes(actionId))) {
      problems.push(`${projection.sourceId}: available actions do not equal its spellbook grants`);
    }
    preparedSources[projection.sourceId] = {
      sourceId: projection.sourceId,
      capacity: projection.capacity,
      availableActionIds,
      preparedActionIds,
    };
  }

  for (const grant of grants) {
    if (grant.access === 'spellbook' && !preparedSources[grant.sourceId]) {
      problems.push(`${grant.grantId}: spellbook grant has no prepared source`);
    }
  }
  if (problems.length) throw new SpellcastingAccessProjectionError(sortedUnique(problems));
  return { grants, preparedSources };
}
