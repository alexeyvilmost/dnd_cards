import type { PendingChoice } from '../mechanics/collectChoices';
import type { Spell } from '../types';

/**
 * Единый фильтр каталога заклинаний для кузницы и автоматического matrix-gate.
 * Любое изменение правил выбора обязано одинаково влиять на UI и autoBuild.
 */
export function spellMatchesChoice(
  spell: Spell,
  choice: PendingChoice,
  maxSlotLevel = 0,
): boolean {
  const options = (choice.options || {}) as Record<string, unknown>;
  const filter = (options.filter || choice.filter || {}) as
    Record<string, unknown> | string | string[];
  if (Array.isArray(filter)) return filter.includes(spell.id);
  if (typeof filter === 'string') {
    if (filter === 'all') return true;
    if (filter === 'cantrip') return spell.level === 0;
    return spell.id === filter;
  }
  if (filter.only_available_slots) {
    if (spell.level < 1 || spell.level > maxSlotLevel) return false;
  } else {
    const levels = Array.isArray(filter.levels)
      ? filter.levels.map(Number)
      : typeof filter.level === 'number'
        ? [filter.level]
        : [];
    if (levels.length && !levels.includes(spell.level)) return false;
  }
  const classes = Array.isArray(filter.classes)
    ? filter.classes.map(String)
    : typeof filter.class === 'string'
      ? [filter.class]
      : [];
  if (classes.length) {
    const spellClasses = spell.classes || [];
    if (!classes.some((klass) => spellClasses.includes(klass))) return false;
  }
  return true;
}
