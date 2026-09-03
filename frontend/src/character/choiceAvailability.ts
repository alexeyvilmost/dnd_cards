import type { PendingChoice } from '../mechanics/collectChoices';
import {
  normalizedChoiceOptionGrants,
  type NormalizedGrantPrimitive,
} from '../mechanics/grantSemantics';
import type { AppliedGrant, CharacterRuleState, ProficiencyKind } from './rules/types';

export type ChoiceAvailabilityState = Pick<
  CharacterRuleState,
  'appliedGrants' | 'expertise' | 'proficiencies' | 'spells'
>;

const PROFICIENCY_BUCKET: Record<
  ProficiencyKind,
  keyof ChoiceAvailabilityState['proficiencies']
> = {
  skill: 'skills',
  saving_throw: 'savingThrows',
  tool: 'tools',
  language: 'languages',
  weapon: 'weapons',
  armor: 'armor',
};

export interface ChoiceAvailabilityPolicy {
  /** Feats already owned outside the choice being evaluated. */
  activeFeatIds?: ReadonlySet<string>;
  /** Canonical feat IDs whose rules explicitly permit another acquisition. */
  repeatableFeatIds?: ReadonlySet<string>;
  /** Resolves UUID/card-number aliases to one canonical feat identity. */
  canonicalFeatId?: (reference: string) => string;
  /** Resolves UUID/card-number aliases to one canonical spell identity. */
  canonicalSpellId?: (reference: string) => string;
}

function existingGrant(
  state: ChoiceAvailabilityState,
  key: NormalizedGrantPrimitive,
): AppliedGrant | undefined {
  return state.appliedGrants.find((grant) => (
    grant.kind === key.kind && grant.value === key.value && grant.mode === key.mode
  ));
}

function stateConflictReason(
  state: ChoiceAvailabilityState,
  key: NormalizedGrantPrimitive,
  policy: ChoiceAvailabilityPolicy,
): string | undefined {
  if (key.kind === 'feat') {
    const canonical = policy.canonicalFeatId?.(key.value) ?? key.value;
    if (policy.repeatableFeatIds?.has(canonical)) return undefined;
    const existing = state.appliedGrants.find((grant) => (
      grant.kind === 'feat'
        && (policy.canonicalFeatId?.(grant.value) ?? grant.value) === canonical
    ));
    if (existing) return `Уже получено из «${existing.source.name}»`;
    return policy.activeFeatIds?.has(canonical)
      ? 'Уже получена — черта не повторяется'
      : undefined;
  }
  if (key.kind === 'spell') {
    const canonical = policy.canonicalSpellId?.(key.value) ?? key.value;
    const known = state.spells.known.some((reference) => (
      (policy.canonicalSpellId?.(reference) ?? reference) === canonical
    ));
    const existing = state.appliedGrants.find((grant) => (
      grant.kind === 'spell'
        && (policy.canonicalSpellId?.(grant.value) ?? grant.value) === canonical
    ));
    return known
      ? (existing ? `Уже получено из «${existing.source.name}»` : 'Заклинание уже получено')
      : undefined;
  }
  const bucket = PROFICIENCY_BUCKET[key.kind];
  if (!bucket) return `Неизвестный тип владения «${key.kind}»`;
  const proficient = state.proficiencies[bucket].includes(key.value);
  if (key.mode === 'expertise') {
    if (key.kind !== 'skill' && key.kind !== 'tool') {
      return `Экспертиза не поддерживает тип «${key.kind}»`;
    }
    if (!proficient) return 'Сначала требуется владение';
    const expertiseBucket = key.kind === 'skill' ? 'skills' : 'tools';
    if (!state.expertise[expertiseBucket].includes(key.value)) return undefined;
  } else if (!proficient) {
    return undefined;
  }
  const existing = existingGrant(state, key)
    ?? state.appliedGrants.find((grant) => grant.kind === key.kind && grant.value === key.value);
  return existing ? `Уже получено из «${existing.source.name}»` : 'Владение уже получено';
}

function sameGrant(
  left: NormalizedGrantPrimitive,
  right: NormalizedGrantPrimitive,
  policy: ChoiceAvailabilityPolicy,
): boolean {
  if (left.kind !== right.kind || left.mode !== right.mode) return false;
  if (left.kind === 'feat') {
    return (policy.canonicalFeatId?.(left.value) ?? left.value)
      === (policy.canonicalFeatId?.(right.value) ?? right.value);
  }
  if (left.kind === 'spell') {
    return (policy.canonicalSpellId?.(left.value) ?? left.value)
      === (policy.canonicalSpellId?.(right.value) ?? right.value);
  }
  return left.value === right.value;
}

function optionConflictReason(
  choice: PendingChoice,
  optionId: string,
  state: ChoiceAvailabilityState,
  reservedGrants: readonly NormalizedGrantPrimitive[],
  policy: ChoiceAvailabilityPolicy,
): string | undefined {
  if (choice.reservedOptionIds?.includes(optionId)) {
    return 'Уже выбрано другим экземпляром этой черты';
  }
  if (choice.grant?.kind === 'grant_proficiency_or_expertise') {
    const alreadyExpert = state.expertise.skills.includes(optionId);
    if (alreadyExpert) return 'Экспертность уже получена';
    if (reservedGrants.some((grant) => grant.kind === 'skill' && grant.value === optionId)) {
      return 'Такой результат уже выбран в этом выборе';
    }
    return undefined;
  }
  const grants = normalizedChoiceOptionGrants(choice, optionId);
  if (grants.some((grant) => reservedGrants.some((reserved) => sameGrant(grant, reserved, policy)))) {
    return 'Такой результат уже выбран в этом выборе';
  }
  return grants.map((grant) => stateConflictReason(state, grant, policy)).find(Boolean);
}

/**
 * Generic availability projection for any declared choice option. The option
 * domain (catalog/registry/filter) is supplied by the caller; legality comes
 * solely from the materialized grant primitives and the current rule state.
 */
export function unavailableChoiceOptions(
  choice: PendingChoice,
  state: ChoiceAvailabilityState,
  optionIds: readonly string[],
  selectedOptionIds: readonly string[] = [],
  policy: ChoiceAvailabilityPolicy = {},
): Record<string, string> {
  const selected = new Set(selectedOptionIds);
  const selectedGrants = selectedOptionIds.flatMap((id) => (
    normalizedChoiceOptionGrants(choice, id)
  ));
  return Object.fromEntries(optionIds.flatMap((optionId) => {
    // A current selection stays removable even though its grant is already in
    // ruleState. Atomic replacement validation uses validateChoiceSelection
    // against a state built without the old selection.
    if (selected.has(optionId)) return [];
    const reason = optionConflictReason(choice, optionId, state, selectedGrants, policy);
    return reason ? [[optionId, reason] as const] : [];
  }));
}

/** Backwards-compatible item-domain wrapper used by existing content tests. */
export function unavailableChoiceItemOptions(
  choice: PendingChoice,
  state: ChoiceAvailabilityState,
  selectedOptionIds: readonly string[] = [],
  policy: ChoiceAvailabilityPolicy = {},
): Record<string, string> {
  return unavailableChoiceOptions(
    choice,
    state,
    (choice.items ?? []).map((item) => item.id),
    selectedOptionIds,
    policy,
  );
}

export interface ChoiceSelectionIssue {
  optionId?: string;
  reason: string;
}

/**
 * Validates an atomic replacement against state-before-this-choice. Unlike UI
 * availability, selected options are not exempt from pre-existing conflicts.
 */
export function validateChoiceSelection(
  choice: PendingChoice,
  stateBeforeChoice: ChoiceAvailabilityState,
  selection: readonly string[],
  optionIds: readonly string[],
  policy: ChoiceAvailabilityPolicy = {},
): ChoiceSelectionIssue[] {
  const issues: ChoiceSelectionIssue[] = [];
  if (selection.length !== choice.count) {
    issues.push({ reason: `Требуется выбрать ровно ${choice.count}` });
  }
  if (new Set(selection).size !== selection.length) {
    issues.push({ reason: 'Варианты выбора должны быть различны' });
  }
  const declared = new Set(optionIds);
  const reserved: NormalizedGrantPrimitive[] = [];
  for (const optionId of selection) {
    if (declared.size && !declared.has(optionId)) {
      issues.push({ optionId, reason: 'Вариант отсутствует в объявленном домене выбора' });
      continue;
    }
    const reason = optionConflictReason(choice, optionId, stateBeforeChoice, reserved, policy);
    if (reason) issues.push({ optionId, reason });
    reserved.push(...normalizedChoiceOptionGrants(choice, optionId));
  }
  return issues;
}
