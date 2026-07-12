// Предикаты движка (условия `when` модификаторов и `circumstances` триггеров).
// Единый словарь видов условия ($defs/condition), интерпретируемых в engine/circumstances.ts
// evaluateCondition. Редактор — components/mechanics/WhenEditor.tsx (рекурсивный).
//
// Правило движка: закрыто-по-умолчанию — неизвестный kind ⇒ условие ложно (модификатор НЕ применится),
// кроме `narrative` ⇒ истина. Поэтому «инертные» виды (в схеме есть, в движке пока нет) помечаем.

export type Cond = { kind: string } & Record<string, unknown>;

export type PredField =
  | { key: string; label: string; type: 'card' }       // id/slug предмета (item_equipped/carried/attuned)
  | { key: string; label: string; type: 'condition' }  // состояние (you/target_has_condition)
  | { key: string; label: string; type: 'number' }     // d20_equals
  | { key: string; label: string; type: 'text' }       // narrative / произвольное значение
  | { key: string; label: string; type: 'number-opt' };// необязательное число (range)

export type PredKind = {
  id: string;
  label: string;
  fields: PredField[];
  /** Группирующий вид: 'many' → of: Cond[] (any_of/all_of); 'one' → of: Cond (not). */
  group?: 'many' | 'one';
  /** Схема допускает, но движок пока НЕ интерпретирует (закрыто-по-умолчанию ⇒ ложно). */
  inert?: boolean;
  hint?: string;
};

// Виды, реально интерпретируемые в circumstances.ts evaluateCondition.
export const PREDICATE_KINDS: PredKind[] = [
  { id: 'item_equipped', label: 'Предмет надет', fields: [{ key: 'value', label: 'ID/слаг предмета', type: 'card' }] },
  { id: 'item_carried', label: 'Предмет при себе (надет или в сумке)', fields: [{ key: 'value', label: 'ID/слаг предмета', type: 'card' }] },
  { id: 'attuned', label: 'Настроен на предмет', fields: [{ key: 'value', label: 'ID/слаг предмета', type: 'card' }] },
  { id: 'you_have_condition', label: 'У вас есть состояние', fields: [{ key: 'value', label: 'Состояние', type: 'condition' }] },
  { id: 'target_has_condition', label: 'У цели есть состояние', fields: [{ key: 'value', label: 'Состояние', type: 'condition' }] },
  { id: 'save_avoids_condition', label: 'Спасбросок против состояния', fields: [{ key: 'value', label: 'Состояние', type: 'condition' }], hint: 'Истинно, когда спасбросок налагает это состояние при провале (напр. преимущество на спас против Очарования).' },
  { id: 'has_advantage', label: 'Уже есть преимущество', fields: [] },
  { id: 'd20_equals', label: 'На d20 выпало значение', fields: [{ key: 'value', label: 'Значение d20', type: 'number' }] },
  { id: 'narrative', label: 'Текстовое условие (на усмотрение мастера)', fields: [{ key: 'description', label: 'Описание', type: 'text' }], hint: 'Всегда истинно — движок доверяет мастеру.' },
  { id: 'any_of', label: 'Любое из (ИЛИ)', fields: [], group: 'many' },
  { id: 'all_of', label: 'Все из (И)', fields: [], group: 'many' },
  { id: 'not', label: 'НЕ (отрицание)', fields: [], group: 'one' },
];

// Виды из JSON-схемы (examples), которые движок пока НЕ реализует — доступны, но помечены.
export const INERT_PREDICATE_KINDS: PredKind[] = [
  { id: 'attack_is', label: 'Тип атаки', fields: [{ key: 'value', label: 'Значение', type: 'text' }], inert: true },
  { id: 'ally_within', label: 'Союзник в пределах', fields: [{ key: 'range', label: 'Дистанция (фт)', type: 'number-opt' }], inert: true },
  { id: 'creature_within', label: 'Существо в пределах', fields: [{ key: 'range', label: 'Дистанция (фт)', type: 'number-opt' }], inert: true },
  { id: 'target_type', label: 'Тип цели', fields: [{ key: 'value', label: 'Тип существа', type: 'text' }], inert: true },
  { id: 'target_wears', label: 'На цели надето', fields: [{ key: 'value', label: 'Значение', type: 'text' }], inert: true },
  { id: 'wielding', label: 'В руках оружие/предмет', fields: [{ key: 'value', label: 'Значение', type: 'text' }], inert: true },
  { id: 'unseen_by_target', label: 'Цель вас не видит', fields: [], inert: true },
  { id: 'proficiency_skill_in', label: 'Владение навыком', fields: [{ key: 'value', label: 'Навык', type: 'text' }], inert: true },
];

export const ALL_PREDICATE_KINDS: PredKind[] = [...PREDICATE_KINDS, ...INERT_PREDICATE_KINDS];

export const PREDICATE_KIND_MAP: Record<string, PredKind> = Object.fromEntries(
  ALL_PREDICATE_KINDS.map((k) => [k.id, k]),
);

const ITEM_PREDICATES = new Set(['item_equipped', 'item_carried', 'attuned']);

/** Нормализуем предикаты (рекурсивно по вложенным `of`):
 *  - легаси-блок eff_adv `{kind:'condition', id}` (движок НЕ распознаёт ⇒ молча ложь) → you_have_condition;
 *  - предметные виды с ключом `id` → переносим в `value` (движок читает `id ?? value`, id имеет приоритет —
 *    иначе правка `value` в редакторе молча перекрывалась бы старым `id`). */
export function normalizeCond(cond: Cond): Cond {
  if (!cond || typeof cond !== 'object') return cond;
  let c: Cond = cond;
  if (c.kind === 'condition' && (c.id != null || c.value != null)) {
    c = { kind: 'you_have_condition', value: c.id ?? c.value };
  } else if (ITEM_PREDICATES.has(c.kind) && c.id != null) {
    const { id, ...rest } = c;
    c = { ...rest, value: rest.value ?? id };
  }
  if (Array.isArray(c.of)) c = { ...c, of: (c.of as Cond[]).map(normalizeCond) };
  else if (c.of && typeof c.of === 'object') c = { ...c, of: normalizeCond(c.of as Cond) };
  return c;
}

export const normalizeWhen = (when: unknown): Cond[] =>
  Array.isArray(when) ? (when as Cond[]).map(normalizeCond) : [];

/** Новая пустая запись предиката выбранного вида. */
export function emptyCond(kind: string): Cond {
  const spec = PREDICATE_KIND_MAP[kind];
  const c: Cond = { kind };
  if (spec?.group === 'many') c.of = [];
  else if (spec?.group === 'one') c.of = { kind: 'narrative' };
  if (kind === 'd20_equals') c.value = 1;
  return c;
}

/** Короткое человекочитаемое описание предиката (для сводки). */
export function describeCond(cond: Cond): string {
  const spec = PREDICATE_KIND_MAP[cond?.kind];
  if (!spec) return cond?.kind ? `raw:${cond.kind}` : '—';
  if (spec.group === 'many') {
    const of = Array.isArray(cond.of) ? (cond.of as Cond[]) : [];
    return `${spec.label} [${of.map(describeCond).join(', ')}]`;
  }
  if (spec.group === 'one') {
    return `${spec.label} (${cond.of ? describeCond(cond.of as Cond) : '—'})`;
  }
  const val = cond.value ?? cond.description ?? cond.range;
  return val != null && val !== '' ? `${spec.label}: ${val}` : spec.label;
}
