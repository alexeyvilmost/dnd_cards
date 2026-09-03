import type { AssembledCharacter } from './assemble';
import type { ForgeCharacter } from './types';
import {
  preparedSpellSelectionIssues,
  type PendingChoice,
} from '../mechanics/collectChoices';
import {
  preparedSpellSelection,
  readSheetSpellPreparation,
  writeSheetSpellPreparation,
} from './sheetSpellPreparation';

type Dict = Record<string, unknown>;

export interface PreparedSpellSwapDeclaration {
  kind: 'prepared_spell_swap';
  decisionType: string;
  rest: 'short_rest';
  source: 'spellbook';
  maximumPerRest: 1;
  minimumSpellLevel: number;
  maximumSpellLevel: 'max_available_spell_slot';
  optional: true;
}

export interface PreparedSpellSwapOption {
  reference: string;
  name: string;
  level: number;
}

export interface SheetPreparedSpellSwapPolicy {
  sourceEffectId: string;
  sourceName: string;
  declaration: PreparedSpellSwapDeclaration;
  preparedChoice: PendingChoice;
  current: PreparedSpellSwapOption[];
  replacements: PreparedSpellSwapOption[];
}

function record(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Dict
    : null;
}

/**
 * Fail-closed decoder for the catalog-owned short-rest preparation rule.
 * Display names and class ids never participate in the decision.
 */
export function preparedSpellSwapDeclaration(
  mechanics: Record<string, unknown> | null | undefined,
): PreparedSpellSwapDeclaration | null {
  const value = record(mechanics?.spell_preparation_rest);
  if (!value) return null;
  if (value.kind !== 'prepared_spell_swap'
    || typeof value.decision_type !== 'string' || !value.decision_type.trim()
    || value.rest !== 'short_rest'
    || value.source !== 'spellbook'
    || value.maximum_per_rest !== 1
    || value.minimum_spell_level !== 1
    || value.maximum_spell_level !== 'max_available_spell_slot'
    || value.optional !== true) {
    throw new Error('spell_preparation_rest is malformed');
  }
  return {
    kind: 'prepared_spell_swap',
    decisionType: value.decision_type,
    rest: 'short_rest',
    source: 'spellbook',
    maximumPerRest: 1,
    minimumSpellLevel: 1,
    maximumSpellLevel: 'max_available_spell_slot',
    optional: true,
  };
}

function optionForReference(
  assembled: AssembledCharacter,
  reference: string,
): PreparedSpellSwapOption | null {
  const spell = assembled.spells.find((candidate) => (
    candidate.id === reference || candidate.card_number === reference
  ));
  const level = Number(spell?.level);
  return spell && Number.isInteger(level) && level >= 1
    ? { reference, name: spell.name, level }
    : null;
}

/**
 * Compile an owned short-rest preparation declaration against the character's
 * exact Wizard spellbook and current runtime preparation overlay.
 */
export function collectSheetPreparedSpellSwapPolicies(input: {
  assembled: AssembledCharacter;
  character: Pick<ForgeCharacter, 'turn_state' | 'resolved_choices'>;
}): SheetPreparedSpellSwapPolicy[] {
  const declarations = input.assembled.effects.flatMap(({ effect }) => {
    const declaration = preparedSpellSwapDeclaration(
      effect.mechanics as Record<string, unknown> | null | undefined,
    );
    return declaration ? [{ effect, declaration }] : [];
  });
  if (!declarations.length) return [];

  const preparedChoices = input.assembled.pendingChoices.filter((choice) => (
    choice.source === 'prepared_spell'
  ));
  if (preparedChoices.length !== 1) {
    throw new Error('Prepared-spell swap requires one unambiguous spellbook preparation choice');
  }
  const preparedChoice = preparedChoices[0];
  const runtimeSelection = readSheetSpellPreparation(input.character.turn_state)
    ?.choices[preparedChoice.id];
  const forgeSelection = input.character.resolved_choices?.[preparedChoice.id] ?? [];
  // Match the canonical sheet compiler: stale runtime preparation (for
  // example after a level-up increased capacity) falls back to Forge instead
  // of making the rest controls brick the whole sheet.
  const selection = runtimeSelection
    && preparedSpellSelectionIssues(preparedChoice, runtimeSelection).length === 0
    ? runtimeSelection
    : forgeSelection.length
      ? [...forgeSelection]
      : preparedSpellSelection(input.character, preparedChoice);
  const issues = preparedSpellSelectionIssues(preparedChoice, selection);
  if (issues.length) {
    throw new Error(`Current prepared spells are invalid: ${issues.join('; ')}`);
  }
  const current = selection.map((reference) => optionForReference(input.assembled, reference));
  if (current.some((option) => option === null)) {
    throw new Error('A prepared spell is missing from the assembled spellbook');
  }
  const currentReferences = new Set(selection);
  const replacements = (preparedChoice.allowedOptionIds ?? [])
    .filter((reference) => !currentReferences.has(reference))
    .map((reference) => optionForReference(input.assembled, reference))
    .filter((option): option is PreparedSpellSwapOption => option !== null)
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
  const decisionTypes = declarations.map(({ declaration }) => declaration.decisionType);
  if (new Set(decisionTypes).size !== decisionTypes.length) {
    throw new Error('Owned prepared-spell rest decisions must have unique decision types');
  }
  return declarations.map(({ effect, declaration }) => ({
    sourceEffectId: effect.id,
    sourceName: effect.name,
    declaration,
    preparedChoice,
    current: current as PreparedSpellSwapOption[],
    replacements,
  }));
}

export interface PreparedSpellSwapSelection {
  forgetReference?: string;
  memorizeReference?: string;
}

export interface PreparedSpellSwapResult {
  turnState: Record<string, unknown>;
  changed: boolean;
  forgotten?: PreparedSpellSwapOption;
  memorized?: PreparedSpellSwapOption;
}

/** Apply zero or one replacement. Partial, duplicate, and foreign choices fail closed. */
export function applySheetPreparedSpellSwap(input: {
  turnState: Record<string, unknown> | null | undefined;
  policy: SheetPreparedSpellSwapPolicy;
  selection: PreparedSpellSwapSelection;
}): PreparedSpellSwapResult {
  const forgetReference = input.selection.forgetReference?.trim() ?? '';
  const memorizeReference = input.selection.memorizeReference?.trim() ?? '';
  if (!forgetReference && !memorizeReference) {
    return { turnState: { ...(input.turnState ?? {}) }, changed: false };
  }
  if (!forgetReference || !memorizeReference) {
    throw new Error('Для замены выберите и подготовленное, и новое заклинание');
  }
  const forgotten = input.policy.current.find(({ reference }) => reference === forgetReference);
  const memorized = input.policy.replacements.find(({ reference }) => reference === memorizeReference);
  if (!forgotten) throw new Error('Заменяемое заклинание больше не подготовлено');
  if (!memorized) throw new Error('Новое заклинание недоступно в книге заклинаний');
  if (forgetReference === memorizeReference) throw new Error('Выберите другое заклинание');

  const current = input.policy.current.map(({ reference }) => reference);
  const next = current.map((reference) => (
    reference === forgetReference ? memorizeReference : reference
  ));
  const issues = preparedSpellSelectionIssues(input.policy.preparedChoice, next);
  if (issues.length) throw new Error(`Замена заклинания некорректна: ${issues.join('; ')}`);
  return {
    turnState: writeSheetSpellPreparation(input.turnState, {
      [input.policy.preparedChoice.id]: next,
    }),
    changed: true,
    forgotten,
    memorized,
  };
}
