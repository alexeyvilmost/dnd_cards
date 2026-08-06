import {
  MAX_CHOICE_DEPTH,
  choiceInstanceId,
  payloadsFromMechanics,
  selectedChoicePayloads,
} from '../mechanics/expandChoices';
import { ABILITY_KEYS, type AbilityKey } from './types';

type Dict = Record<string, unknown>;

export interface SpellcastingAbilityMechanicsSource {
  mechanics?: Dict | null;
  /** Stable mechanics-source id used by resolved choice keys. */
  sourceId?: string;
}

const isAbilityKey = (value: unknown): value is AbilityKey => (
  typeof value === 'string'
    && (ABILITY_KEYS as readonly string[]).includes(value)
);

function declaredAbilitiesForSource(
  source: SpellcastingAbilityMechanicsSource,
  resolvedChoices: Readonly<Record<string, string[]>>,
  primaryOnly: boolean,
): { abilities: Set<AbilityKey>; invalid: boolean } {
  const abilities = new Set<AbilityKey>();
  let invalid = false;
  const visit = (payload: Dict, depth = 0): void => {
    if (payload.kind === 'choice') {
      if (!source.sourceId || depth >= MAX_CHOICE_DEPTH) return;
      const rawChoiceId = String(payload.id || 'choice');
      const selected = resolvedChoices[choiceInstanceId(source.sourceId, rawChoiceId)]
        ?? resolvedChoices[rawChoiceId]
        ?? [];
      for (const selectedPayload of selectedChoicePayloads(payload, selected)) {
        visit(selectedPayload, depth + 1);
      }
      return;
    }
    if (payload.kind !== 'spellcasting_ability'
      || (primaryOnly && payload.role !== 'primary')) return;
    const ability = payload.ability ?? payload.value;
    if (!isAbilityKey(ability)) {
      invalid = true;
      return;
    }
    abilities.add(ability);
  };
  for (const payload of payloadsFromMechanics(source.mechanics)) visit(payload);
  return { abilities, invalid };
}

/** Exact ability declared by one mechanics source, including a resolved
 * source-scoped ability choice. No character/class/name fallback is used. */
export function resolveSourceSpellcastingAbility(
  source: SpellcastingAbilityMechanicsSource,
  resolvedChoices: Readonly<Record<string, string[]>> = {},
): AbilityKey | null {
  const result = declaredAbilitiesForSource(source, resolvedChoices, false);
  return !result.invalid && result.abilities.size === 1
    ? [...result.abilities][0]
    : null;
}

/**
 * Resolves the character's primary spellcasting ability from declarative
 * mechanics. Source-scoped abilities (for example Magic Initiate or an Elf
 * lineage) intentionally do not alter the character-wide spellcasting value.
 *
 * The projection is fail-closed: a missing/invalid declaration or more than
 * one distinct primary ability returns null instead of choosing by source/name
 * order. Choice expansion is supported so future data can declare a primary
 * ability without adding another resolver branch.
 */
export function resolvePrimarySpellcastingAbility(
  sources: readonly SpellcastingAbilityMechanicsSource[],
  resolvedChoices: Readonly<Record<string, string[]>> = {},
): AbilityKey | null {
  const abilities = new Set<AbilityKey>();
  let invalidPrimaryDeclaration = false;
  for (const source of sources) {
    const result = declaredAbilitiesForSource(source, resolvedChoices, true);
    if (result.invalid) invalidPrimaryDeclaration = true;
    result.abilities.forEach((ability) => abilities.add(ability));
  }

  return !invalidPrimaryDeclaration && abilities.size === 1
    ? [...abilities][0]
    : null;
}
