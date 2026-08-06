import { parseFreeuse, type FreeuseSpec } from '../engine/freeuse';
import { ABILITY_KEYS, type AbilityKey } from '../character/types';

type Dict = Record<string, unknown>;

export type NormalizedGrantKind =
  | 'skill'
  | 'saving_throw'
  | 'tool'
  | 'language'
  | 'weapon'
  | 'armor'
  | 'feat'
  | 'spell';

export type NormalizedGrantMode = 'proficiency' | 'expertise';

export interface NormalizedGrantPrimitive {
  kind: NormalizedGrantKind;
  mode: NormalizedGrantMode;
  value: string;
  label?: string;
  freeuse?: Omit<FreeuseSpec, 'spell'>;
  spellcastingAbility?: AbilityKey;
}

const PROFICIENCY_KINDS = new Set<NormalizedGrantKind>([
  'skill',
  'saving_throw',
  'tool',
  'language',
  'weapon',
  'armor',
]);

function nonBlankValue(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function proficiencyKind(value: unknown, fallback: NormalizedGrantKind): NormalizedGrantKind | null {
  const normalized = nonBlankValue(value) ?? fallback;
  return PROFICIENCY_KINDS.has(normalized as NormalizedGrantKind)
    ? normalized as NormalizedGrantKind
    : null;
}

/**
 * Normalizes every build-time grant primitive that becomes an AppliedGrant.
 * The resolver and every choice-availability consumer deliberately share this
 * function so aliases such as expertise:true cannot diverge between preview,
 * automatic selection, validation, and final character projection.
 */
export function normalizeAppliedGrantPrimitive(
  payload: Dict | null | undefined,
): NormalizedGrantPrimitive | null {
  if (!payload) return null;
  const primitive = String(payload.kind ?? '');
  const value = nonBlankValue(payload.value);
  if (!value) return null;

  if (primitive === 'grant_language') {
    return { kind: 'language', mode: 'proficiency', value };
  }
  if (primitive === 'grant_feat') {
    return { kind: 'feat', mode: 'proficiency', value };
  }
  if (primitive === 'grant_spell') {
    const freeuse = parseFreeuse(payload.freeuse);
    const spellcastingAbility = typeof payload.ability === 'string'
      && (ABILITY_KEYS as readonly string[]).includes(payload.ability)
      ? payload.ability as AbilityKey
      : undefined;
    return {
      kind: 'spell',
      mode: 'proficiency',
      value,
      ...(typeof payload.label === 'string' ? { label: payload.label } : {}),
      ...(freeuse ? { freeuse } : {}),
      ...(spellcastingAbility ? { spellcastingAbility } : {}),
    };
  }
  if (primitive === 'grant_expertise') {
    const kind = proficiencyKind(payload.prof ?? payload.expertise, 'skill');
    return kind ? { kind, mode: 'expertise', value } : null;
  }
  if (primitive !== 'grant_proficiency') return null;
  const kind = proficiencyKind(payload.prof, 'skill');
  if (!kind) return null;
  const mode = payload.mode === 'expertise'
    || payload.expertise === true
    || payload.expert === true
    ? 'expertise'
    : 'proficiency';
  return { kind, mode, value };
}

/** Materializes a choice-level grant/apply template for one selected option. */
export function materializeChoiceGrant(
  template: Dict | null | undefined,
  selectedValue: string,
): Dict | null {
  if (!template?.kind) return null;
  const { value_into: valueInto, ...payload } = template;
  const field = typeof valueInto === 'string' && valueInto.trim()
    ? valueInto
    : 'value';
  return { ...payload, [field]: selectedValue };
}

export interface ChoiceGrantProjection {
  source?: string;
  grant?: Dict;
  items?: ReadonlyArray<{
    id: string;
    grants?: ReadonlyArray<Dict>;
  }>;
}

/**
 * Returns the exact payloads that selecting an option will execute. Explicit
 * item.grants take precedence, including an intentionally empty array, just as
 * selectedChoicePayloads does in the resolver path.
 */
export function choiceOptionGrantPayloads(
  choice: ChoiceGrantProjection,
  optionId: string,
): Dict[] {
  const item = choice.items?.find((candidate) => candidate.id === optionId);
  if (item && Array.isArray(item.grants)) {
    return item.grants.map((grant) => ({ ...grant }));
  }
  const projected = materializeChoiceGrant(choice.grant, optionId);
  if (projected) return [projected];
  // Compatibility with the executable choice fallback in expandChoices.
  if (choice.source === 'feat') return [{ kind: 'grant_feat', value: optionId }];
  return [];
}

export function normalizedChoiceOptionGrants(
  choice: ChoiceGrantProjection,
  optionId: string,
): NormalizedGrantPrimitive[] {
  return choiceOptionGrantPayloads(choice, optionId).flatMap((payload) => {
    const grant = normalizeAppliedGrantPrimitive(payload);
    return grant ? [grant] : [];
  });
}
