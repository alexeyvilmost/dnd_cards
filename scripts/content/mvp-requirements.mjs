/**
 * Целевые показатели MVP для отчёта покрытия (фазы G2–G9).
 */

export const MVP_LEVELS = [1, 2];

/** PHB 2024 — 12 классов (card_number-слаги). */
export const MVP_CLASSES = [
  { slug: 'CLASS-warrior', name: 'Воин', hitDie: 'd10', caster: false, needsResources: true },
  { slug: 'CLASS-wizard', name: 'Волшебник', hitDie: 'd6', caster: true, needsResources: false },
  { slug: 'CLASS-rogue', name: 'Плут', hitDie: 'd8', caster: false, needsResources: false },
  { slug: 'CLASS-cleric', name: 'Жрец', hitDie: 'd8', caster: true, needsResources: false },
  { slug: 'CLASS-barbarian', name: 'Варвар', hitDie: 'd12', caster: false, needsResources: true },
  { slug: 'CLASS-monk', name: 'Монах', hitDie: 'd8', caster: false, needsResources: true },
  { slug: 'CLASS-paladin', name: 'Паладин', hitDie: 'd10', caster: true, needsResources: false },
  { slug: 'CLASS-ranger', name: 'Следопыт', hitDie: 'd10', caster: true, needsResources: false },
  { slug: 'CLASS-bard', name: 'Бард', hitDie: 'd8', caster: true, needsResources: false },
  { slug: 'CLASS-druid', name: 'Друид', hitDie: 'd8', caster: true, needsResources: false },
  { slug: 'CLASS-sorcerer', name: 'Чародей', hitDie: 'd6', caster: true, needsResources: false },
  { slug: 'CLASS-warlock', name: 'Колдун', hitDie: 'd8', caster: true, needsResources: false },
];

export const MVP_RACE_COUNT = 12;
export const MVP_BACKGROUND_COUNT = 16;
export const MVP_ORIGIN_FEAT_COUNT = 10;
export const MVP_SPELL_LEVELS = [0, 1];

/** Черты происхождения PHB 2024 (имена для поиска в БД). */
export const MVP_ORIGIN_FEAT_NAMES = [
  'Бдительный',
  'Везунчик',
  'Дебошир',
  'Дикий атакующий',
  'Крепкий',
  'Лекарь',
  'Музыкант',
  'Одарённый',
  'Самоделкин',
  'Посвящённый в магию',
];

export function classSpecBySlug(slug) {
  return MVP_CLASSES.find((c) => c.slug === slug) || null;
}
