import type { RuleActionDefinition } from '../rules-core/domain';
import {availableResources} from '../engine/resourceRestrictions';
import {
  resolveSpellAccess,
  type ResolvedSpellAccess,
  type SpellGrantAccess,
} from '../rules-core/spellcastingAccess';
import type { SheetCanonicalRuntime } from './sheetCanonicalWorld';
import type { SheetSpellCastDeclaration } from './sheetCanonicalCommand';

export const SHEET_SPELL_CAST_CHOICE = 'sheet_canonical_spell_cast' as const;

export interface SheetSpellCastOption {
  id: string;
  label: string;
  declaration: SheetSpellCastDeclaration;
  grant: SpellGrantAccess;
  payment: ResolvedSpellAccess['payment'];
}

export class SheetSpellCastingUiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetSpellCastingUiError';
  }
}

function optionId(
  grant: SpellGrantAccess,
  mode: 'normal' | 'ritual',
  payment: ResolvedSpellAccess['payment'],
): string {
  return [grant.grantId, mode, payment.kind, payment.resource ?? 'none'].join('|');
}

function paymentLabel(payment: ResolvedSpellAccess['payment']): string {
  if (payment.kind === 'none') return 'без расхода';
  if (payment.kind === 'free_use') return 'бесплатное использование';
  return `ячейка ${payment.resource?.match(/_(\d+)$/)?.[1] ?? 1}-го круга`;
}

function resolvedOption(input: {
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
  accessActionId: string;
  castAtLevel: number;
  grant: SpellGrantAccess;
  mode: 'normal' | 'ritual';
  preferFreeUse?: boolean;
  sourceLabel: string;
  access: NonNullable<SheetCanonicalRuntime['world']['actors'][string]['spellcastingAccess']>;
  resources: Readonly<Record<string, number>>;
}): SheetSpellCastOption | null {
  const resolved = resolveSpellAccess({
    state: input.access,
    actionId: input.accessActionId,
    grantId: input.grant.grantId,
    mode: input.mode,
    resources: input.resources,
    castLevel: input.castAtLevel,
    ...(input.preferFreeUse === undefined ? {} : { preferFreeUse: input.preferFreeUse }),
  });
  if (resolved.status === 'rejected') return null;
  return {
    id: optionId(input.grant, input.mode, resolved.payment),
    label: `${input.sourceLabel} · ${input.mode === 'ritual' ? 'ритуал' : paymentLabel(resolved.payment)}`,
    declaration: {
      grantId: input.grant.grantId,
      mode: input.mode,
      ...(input.castAtLevel === input.action.spell.level ? {} : { castLevel: input.castAtLevel }),
      ...(input.preferFreeUse === undefined ? {} : { preferFreeUse: input.preferFreeUse }),
    },
    grant: { ...input.grant },
    payment: { ...resolved.payment },
  };
}

/** Enumerate exact source/payment options without choosing a card/name convention. */
export function collectSheetSpellCastOptions(input: {
  runtime: SheetCanonicalRuntime;
  action: RuleActionDefinition;
}): SheetSpellCastOption[] {
  if (input.action.kind !== 'spell') return [];
  const actor = input.runtime.world.actors[input.runtime.actorId];
  if (!actor) throw new SheetSpellCastingUiError('Canonical spell owner is unavailable');
  const access = actor.spellcastingAccess;
  if (!access) {
    throw new SheetSpellCastingUiError(
      `Canonical spell ${input.action.id} has no source-scoped spell access`,
    );
  }
  const variantParentId = input.action.mechanics.variant_of_spell_id;
  const accessActionId = typeof variantParentId === 'string'
    ? `${variantParentId}${input.action.id.slice(input.action.sourceEntityIds[0].length)}`
    : input.action.id;
  const grants = access.grants
    .filter((grant) => grant.actionId === accessActionId)
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
  const result: SheetSpellCastOption[] = [];
  for (const grant of grants) {
    const source = (actor.passives ?? []).find(entry => entry.id === grant.sourceId || entry.sourceEntityId === grant.sourceId);
    const sourceLabel = typeof source?.name === 'string' ? source.name : 'Сотворение заклинаний';
    const freeOrNone = resolvedOption({
      action: input.action,
      accessActionId,
      castAtLevel: input.action.spell.level,
      grant,
      sourceLabel,
      mode: 'normal',
      preferFreeUse: true,
      access,
      resources: availableResources(actor.runtime,actor.character,actor.passives),
    });
    if (freeOrNone) result.push(freeOrNone);
    for (let level = input.action.spell.level; level <= (input.action.spell.level === 0 ? 0 : 9); level++) {
      const slot = resolvedOption({
        action: input.action,
        accessActionId,
        castAtLevel: level,
        grant,
        sourceLabel,
        mode: 'normal',
        preferFreeUse: false,
        access,
        resources: availableResources(actor.runtime,actor.character,actor.passives),
      });
      if (slot && !result.some((candidate) => candidate.id === slot.id)) result.push(slot);
    }
    if (grant.ritual) {
      const ritual = resolvedOption({
        action: input.action,
        accessActionId,
        castAtLevel: input.action.spell.level,
        grant,
        sourceLabel,
        mode: 'ritual',
        access,
        resources: availableResources(actor.runtime,actor.character,actor.passives),
      });
      if (ritual) result.push(ritual);
    }
  }
  return result.sort((left, right) => (
    left.label.localeCompare(right.label) || left.id.localeCompare(right.id)
  ));
}

export function requireSheetSpellCastOption(
  options: readonly SheetSpellCastOption[],
  optionIdValue: string,
): SheetSpellCastOption {
  const matches = options.filter((candidate) => candidate.id === optionIdValue);
  if (matches.length !== 1) {
    throw new SheetSpellCastingUiError(
      `Spell casting choice ${optionIdValue || '<empty>'} is not an exact available grant/payment`,
    );
  }
  return matches[0];
}
