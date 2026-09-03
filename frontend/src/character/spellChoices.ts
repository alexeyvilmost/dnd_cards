import type { PendingChoice } from '../mechanics/collectChoices';
import type { Spell } from '../types';

function spellHasAttackRoll(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(spellHasAttackRoll);
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.resolution === 'attack_roll'
    || Object.values(record).some(spellHasAttackRoll);
}

/**
 * Единый фильтр каталога заклинаний для кузницы и автоматического matrix-gate.
 * Любое изменение правил выбора обязано одинаково влиять на UI и autoBuild.
 */
export function spellMatchesChoice(
  spell: Spell,
  choice: PendingChoice,
  maxSlotLevel = 0,
): boolean {
  if (choice.source === 'prepared_spell') {
    const allowed = new Set(choice.allowedOptionIds ?? []);
    return allowed.has(spell.id) || allowed.has(spell.card_number);
  }
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
    const effectiveMaxSlotLevel = choice.origin.spellSlotLevelCap ?? maxSlotLevel;
    if (spell.level < 1 || spell.level > effectiveMaxSlotLevel) return false;
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
  const schools = Array.isArray(filter.schools)
    ? filter.schools.map((value) => String(value).trim().toLowerCase())
    : typeof filter.school === 'string'
      ? [filter.school.trim().toLowerCase()]
      : [];
  if (schools.length && !schools.includes(String(spell.school ?? '').trim().toLowerCase())) {
    return false;
  }
  if (typeof filter.ritual === 'boolean' && spell.ritual !== filter.ritual) return false;
  if (filter.requires_attack_roll === true && !spellHasAttackRoll(spell.mechanics)) return false;
  return true;
}

/**
 * Preparing a Wizard spell is intentionally a second selection of a spell
 * that was already acquired into the spellbook. Later-level spellbook
 * additions have distinct, instance-scoped choice ids, so ownership cannot be
 * compared only with the first-level source choice id. The prepared choice's
 * assembled option domain is the authoritative union of every spellbook
 * addition in that family.
 */
export function preparedSpellChoiceAllowsOwnedOption(
  choice: PendingChoice,
  spellReference: string,
  canonicalSpellId: (reference: string) => string = (reference) => reference,
): boolean {
  if (choice.source !== 'prepared_spell') return false;
  const canonical = canonicalSpellId(spellReference);
  return (choice.allowedOptionIds ?? [])
    .some((reference) => canonicalSpellId(reference) === canonical);
}
