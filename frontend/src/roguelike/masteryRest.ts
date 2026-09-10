import type { PendingChoice } from '../mechanics/collectChoices';
import { WEAPON_TYPE_PROFICIENCY_CATEGORY } from '../mechanics/registries';

export const fighterRestMasteryChoices = (choices: readonly PendingChoice[]) => choices.filter(
  (choice) => choice.origin.kind === 'class' && choice.grantKind === 'weapon_mastery',
);

/** Fighter weapon drills replace one known weapon type at a Long Rest.
 * Count across progression choices, so the level-four extra choice cannot
 * supply a second replacement allowance. */
export function validateMasteryRestSelection(
  choices: readonly PendingChoice[], original: Readonly<Record<string, readonly string[]>>,
  selection: unknown,
): Record<string, string[]> {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new Error('Некорректный выбор искусности');
  const owned = fighterRestMasteryChoices(choices);
  const supplied = selection as Record<string, unknown>;
  if (Object.keys(supplied).some((id) => !owned.some((choice) => choice.id === id))) throw new Error('Нельзя изменить этот выбор на отдыхе');
  const result: Record<string, string[]> = {};
  const before: string[] = [];
  const after: string[] = [];
  for (const choice of owned) {
    const previous = original[choice.id] ?? [];
    const values = supplied[choice.id] ?? previous;
    if (!Array.isArray(values) || values.length !== choice.count || previous.length !== choice.count
      || values.some((id) => typeof id !== 'string' || !Object.hasOwn(WEAPON_TYPE_PROFICIENCY_CATEGORY, id)
        || (Array.isArray(choice.filter) && !choice.filter.includes(id)))) throw new Error('Выберите допустимые виды оружия');
    result[choice.id] = [...values];
    before.push(...previous); after.push(...values);
  }
  if (new Set(after).size !== after.length) throw new Error('Один вид оружия нельзя выбрать дважды');
  if (new Set(before.filter((id) => !after.includes(id))).size > 1) throw new Error('На долгом отдыхе можно заменить один вид оружия');
  return result;
}
