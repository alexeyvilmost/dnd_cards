import type {Feat} from '../types';
import type {PendingChoice} from '../mechanics/collectChoices';
import {ABILITIES, WEAPON_TYPE_PROFICIENCY_CATEGORY} from '../mechanics/registries';
import type {AbilityKey} from './types';
import type {CharacterRuleState} from './rules/types';
import {featForChoiceOption, optionsForChoice} from './components';
import {unavailableChoiceOptions} from './choiceAvailability';
import {generalFeatPrerequisiteIssue} from './featPrerequisites';

/** The same availability policy serves inline Forge choices and their
 * level-up dialogs; entity IDs and display names never define the rules. */
export function forgeChoiceUnavailableOptions(choice: PendingChoice, ruleState: CharacterRuleState, value: string[], feats: Feat[] = [], activeFeats: Feat[] = []): Record<string, string> {
  const optionIds = optionsForChoice(choice, feats).map(option => option.id);
  const featByReference = new Map(feats.flatMap(feat => [[feat.id, feat.id], [feat.card_number, feat.id]] as const));
  const unavailable = unavailableChoiceOptions(choice, ruleState, optionIds, value, {
    activeFeatIds: new Set(activeFeats.map(feat => feat.id)),
    repeatableFeatIds: new Set(feats.filter(feat => feat.repeatable).map(feat => feat.id)),
    canonicalFeatId: reference => featForChoiceOption(choice, reference, feats)?.id ?? featByReference.get(reference) ?? reference,
  });
  if (choice.source === 'feat') {
    for (const optionId of optionIds) {
      const feat = featForChoiceOption(choice, optionId, feats);
      const issue = feat && generalFeatPrerequisiteIssue(feat, ruleState);
      if (issue) unavailable[optionId] = issue;
    }
  }
  if (choice.source === 'ability') {
    for (const ability of ABILITIES) {
      if ((ruleState.abilities?.[ability.id as AbilityKey] ?? 0) >= 20 && !value.includes(ability.id)) unavailable[ability.id] = 'Максимум 20';
    }
  }
  if (choice.source === 'weapon') {
    for (const weaponType of optionIds) {
      if (choice.grantKind === 'weapon_mastery' && !value.includes(weaponType) && ruleState.weaponMasteries.includes(weaponType)) {
        unavailable[weaponType] = 'Искусность этого вида оружия уже получена';
      }
      if (choice.filter !== 'proficient') continue;
      const category = WEAPON_TYPE_PROFICIENCY_CATEGORY[weaponType];
      if (!ruleState.proficiencies.weapons.includes(weaponType) && (category == null || !ruleState.proficiencies.weapons.includes(category))) {
        unavailable[weaponType] = 'Нет владения этим видом оружия';
      }
    }
  }
  return unavailable;
}
