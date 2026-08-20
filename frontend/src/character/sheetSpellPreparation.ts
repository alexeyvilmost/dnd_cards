import type { AssembledCharacter } from './assemble';
import type { ForgeCharacter } from './types';
import type { PendingChoice } from '../mechanics/collectChoices';

export const SHEET_SPELL_PREPARATION_KEY = 'sheet_spell_preparation_v1' as const;
export const SHEET_SPELL_PREPARATION_VERSION = 1 as const;

export interface SheetSpellPreparationState {
  schemaVersion: typeof SHEET_SPELL_PREPARATION_VERSION;
  choices: Record<string, string[]>;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)
    || value.some((item) => typeof item !== 'string' || !item.trim())
    || new Set(value).size !== value.length) return null;
  return [...value];
}

/** Invalid/stale optional state is ignored so a content update cannot brick a sheet. */
export function readSheetSpellPreparation(
  turnState: Record<string, unknown> | null | undefined,
): SheetSpellPreparationState | null {
  const raw = turnState?.[SHEET_SPELL_PREPARATION_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== SHEET_SPELL_PREPARATION_VERSION
    || !record.choices || typeof record.choices !== 'object' || Array.isArray(record.choices)) {
    return null;
  }
  const choices: Record<string, string[]> = {};
  for (const [choiceId, value] of Object.entries(record.choices as Record<string, unknown>)) {
    const selected = stringArray(value);
    if (!choiceId.trim() || !selected) return null;
    choices[choiceId] = selected;
  }
  return { schemaVersion: SHEET_SPELL_PREPARATION_VERSION, choices };
}

export function writeSheetSpellPreparation(
  turnState: Record<string, unknown> | null | undefined,
  updates: Readonly<Record<string, readonly string[]>>,
): Record<string, unknown> {
  const current = readSheetSpellPreparation(turnState)?.choices ?? {};
  const choices = {
    ...current,
    ...Object.fromEntries(Object.entries(updates).map(([choiceId, values]) => [
      choiceId,
      [...new Set(values)],
    ])),
  };
  return {
    ...(turnState ?? {}),
    [SHEET_SPELL_PREPARATION_KEY]: {
      schemaVersion: SHEET_SPELL_PREPARATION_VERSION,
      choices,
    } satisfies SheetSpellPreparationState,
  };
}

/** Runtime choice wins; Forge's acquisition-time selection remains the seed. */
export function preparedSpellSelection(
  character: Pick<ForgeCharacter, 'turn_state' | 'resolved_choices'>,
  choice: Pick<PendingChoice, 'id'>,
): string[] {
  return readSheetSpellPreparation(character.turn_state)?.choices[choice.id]
    ?? [...(character.resolved_choices?.[choice.id] ?? [])];
}

/** ChoiceDialog-ready data, with exact spellbook options and current selection preselected. */
export function collectLongRestPreparationChoices(input: {
  assembled: AssembledCharacter;
  character: Pick<ForgeCharacter, 'turn_state' | 'resolved_choices'>;
}): PendingChoice[] {
  return input.assembled.pendingChoices
    .filter((choice) => choice.source === 'prepared_spell')
    .map((choice) => {
      const items = (choice.allowedOptionIds ?? []).flatMap((reference) => {
        const spell = input.assembled.spells.find((candidate) => (
          candidate.id === reference || candidate.card_number === reference
        ));
        return spell ? [{ id: reference, name: spell.name }] : [];
      });
      return {
        ...choice,
        context: 'in_play',
        recommended: preparedSpellSelection(input.character, choice),
        items,
      };
    });
}
