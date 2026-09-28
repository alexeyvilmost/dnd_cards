import type { Feat } from '../types';
import type { AbilityKey } from './types';
import type { CharacterRuleState } from './rules/types';

const ABILITIES: Array<[RegExp, AbilityKey]> = [
  [/Сил/iu, 'str'], [/Ловк/iu, 'dex'], [/Телослож/iu, 'con'],
  [/Интеллект/iu, 'int'], [/Мудрост/iu, 'wis'], [/Харизм/iu, 'cha'],
];

export function generalFeatPrerequisiteIssue(feat: Feat, state: CharacterRuleState): string | undefined {
  const text = feat.prerequisite ?? '';
  const totalLevel = Object.values(state.classLevels ?? {}).reduce((sum, level) => sum + level, 0);
  const minimumLevel = /уровень\s*(\d+)\+/iu.exec(text);
  if (minimumLevel && totalLevel < Number(minimumLevel[1])) return `Требуется уровень ${minimumLevel[1]}+`;
  const scoreRequirement = text.match(/(.+?)\s*13\+/u);
  if (scoreRequirement) {
    const allowed = ABILITIES.filter(([pattern]) => pattern.test(scoreRequirement[1])).map(([, key]) => key);
    if (allowed.length && !allowed.some((key) => (state.abilities[key] ?? 0) >= 13)) return `Требуется ${allowed.join(' или ').toUpperCase()} 13+`;
  }
  if (/Сотворение заклинаний|Магия договора/iu.test(text)
    && state.spells.known.length + state.spells.cantrips.length + state.spells.leveled.length === 0) return 'Требуется Сотворение заклинаний или Магия договора';
  const armor = /навык обращения с[о]? (Л[её]гкими|Средними|Тяж[её]лыми) доспехами/iu.exec(text);
  if (armor) {
    const token = armor[1].toLocaleLowerCase('ru-RU');
    const required = token.startsWith('л') ? 'light' : token.startsWith('с') ? 'medium' : 'heavy';
    if (!state.proficiencies.armor.some((entry) => entry.toLocaleLowerCase().includes(required))) return `Требуется владение доспехами: ${armor[1]}`;
  }
  if (/навык обращения с Щитами/iu.test(text) && !state.proficiencies.armor.some((entry) => /shield|щит/iu.test(entry))) return 'Требуется владение щитами';
  return undefined;
}
