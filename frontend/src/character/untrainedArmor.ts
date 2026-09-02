import type { CharacterRuleState } from './rules/types';

type Dict = Record<string, unknown>;

export const UNTRAINED_ARMOR_SPELL_REASON =
  'Доспех без владения: нельзя сотворять заклинания';

export function untrainedArmorCategories(ruleState: CharacterRuleState): string[] {
  return [...new Set(ruleState.conflicts
    .filter((conflict) => conflict.code === 'untrained_armor')
    .map((conflict) => conflict.value)
    .filter((value): value is string => Boolean(value)))];
}

/** D&D 2024: armor worn without training imposes Disadvantage on every d20
 * test involving Strength or Dexterity. Spellcasting is gated separately. */
export function untrainedArmorPenaltyMechanics(ruleState: CharacterRuleState): Dict[] {
  if (!untrainedArmorCategories(ruleState).length) return [];
  const result = (['attack', 'saving_throw', 'ability_check'] as const).flatMap((roll) => (
    (['str', 'dex'] as const).map((ability) => ({
      kind: 'modifier',
      applies_to: { roll, filter: { ability } },
      op: 'disadvantage',
      source: 'Доспех без владения',
    }))
  ));
  return [{
    name: 'Доспех без владения',
    activation: { mode: 'passive' },
    effects: [{ resolution: 'auto', result }],
  }];
}
