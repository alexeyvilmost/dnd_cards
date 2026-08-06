import type { RuleActionDefinition } from '../rules-core/domain';
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
  if (payment.kind === 'free_use') return `бесплатное использование (${payment.resource})`;
  return `ячейка (${payment.resource})`;
}

function castLevel(action: Extract<RuleActionDefinition, { kind: 'spell' }>, resource?: string): number {
  const suffix = resource?.match(/_(\d+)$/)?.[1];
  const parsed = suffix === undefined ? action.spell.level : Number(suffix);
  return Number.isInteger(parsed) && parsed >= action.spell.level
    ? parsed
    : action.spell.level;
}

function resolvedOption(input: {
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
  grant: SpellGrantAccess;
  mode: 'normal' | 'ritual';
  preferFreeUse?: boolean;
  access: NonNullable<SheetCanonicalRuntime['world']['actors'][string]['spellcastingAccess']>;
  resources: Readonly<Record<string, number>>;
}): SheetSpellCastOption | null {
  const resolved = resolveSpellAccess({
    state: input.access,
    actionId: input.action.id,
    grantId: input.grant.grantId,
    mode: input.mode,
    resources: input.resources,
    ...(input.preferFreeUse === undefined ? {} : { preferFreeUse: input.preferFreeUse }),
  });
  if (resolved.status === 'rejected') return null;
  const level = castLevel(input.action, resolved.payment.resource);
  return {
    id: optionId(input.grant, input.mode, resolved.payment),
    label: `${input.grant.sourceId} · ${input.mode === 'ritual' ? 'ритуал' : paymentLabel(resolved.payment)}`,
    declaration: {
      grantId: input.grant.grantId,
      mode: input.mode,
      ...(level === input.action.spell.level ? {} : { castLevel: level }),
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
  const grants = access.grants
    .filter((grant) => grant.actionId === input.action.id)
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
  const result: SheetSpellCastOption[] = [];
  for (const grant of grants) {
    const freeOrNone = resolvedOption({
      action: input.action,
      grant,
      mode: 'normal',
      preferFreeUse: true,
      access,
      resources: actor.runtime.resources,
    });
    if (freeOrNone) result.push(freeOrNone);
    const slot = resolvedOption({
      action: input.action,
      grant,
      mode: 'normal',
      preferFreeUse: false,
      access,
      resources: actor.runtime.resources,
    });
    if (slot && !result.some((candidate) => candidate.id === slot.id)) result.push(slot);
    if (grant.ritual) {
      const ritual = resolvedOption({
        action: input.action,
        grant,
        mode: 'ritual',
        access,
        resources: actor.runtime.resources,
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
