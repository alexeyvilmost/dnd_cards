import type {Feat, Spell} from '../types';
import type {PendingChoice} from '../mechanics/collectChoices';
import {isSpellSelectionChoice} from '../mechanics/collectChoices';
import {choiceOptionIdByReference, featForChoiceOption, optionsForChoice} from './components';
import {spellMatchesChoice} from './spellChoices';

export function levelUpReturnURL(characterId: string, runId?: string | null): string {
  return runId ? `/roguelike/${encodeURIComponent(runId)}` : `/characters-v3/${encodeURIComponent(characterId)}`;
}

/** Build the same canonical entity domain used by Forge into the shared
 * choice dialog. Child spell variants never become ordinary learned spells. */
export function levelUpDialogChoice(choice: PendingChoice, spells: Spell[], maxSlotLevel: number, selected: string[], feats: Feat[]): PendingChoice {
  const items = isSpellSelectionChoice(choice)
    ? spells.filter(spell => spellMatchesChoice(spell, choice, maxSlotLevel))
      .map(spell => ({id: choice.source === 'prepared_spell'
        ? choice.allowedOptionIds?.find(reference => reference === spell.id || reference === spell.card_number) ?? spell.id
        : spell.id, name: spell.name, previewSpell: spell}))
    : choice.items;
  const dialogChoice = {...choice, ...(items ? {items} : {})};
  const options = optionsForChoice(dialogChoice, feats);
  const recommended = selected.flatMap(reference => {
    const spell = isSpellSelectionChoice(choice) ? items?.find(item => item.previewSpell?.card_number === reference || item.previewSpell?.id === reference) : undefined;
    const canonical = spell?.id ?? choiceOptionIdByReference(options, reference);
    return canonical ? [canonical] : [];
  });
  return {...dialogChoice, recommended};
}

export function levelUpChoiceSelectionLabels(choice: PendingChoice, selected: string[], feats: Feat[], spells: Spell[]): string[] {
  const options = isSpellSelectionChoice(choice)
    ? spells.map(spell => ({id: spell.id, label: spell.name, aliases: [spell.card_number]}))
    : optionsForChoice(choice, feats);
  return selected.map(reference => {
    const canonical = choiceOptionIdByReference(options, reference);
    if (choice.source === 'feat' && canonical) {
      const feat = featForChoiceOption(choice, canonical, feats);
      if (feat) return feat.name;
    }
    return options.find(option => option.id === canonical)?.label ?? reference;
  });
}
