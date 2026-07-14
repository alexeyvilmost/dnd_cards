import type { ChoiceOptions, Payload } from './types';
import type { RegistryItem } from './registries';
import { normalizeWhen, type Cond } from './predicates';
import {
  ABILITIES,
  ACTIVE_RESOURCES,
  ATTACK_ABILITIES,
  CHOICE_SOURCES,
  WEAPON_TYPES,
  CONDITIONS,
  DAMAGE_TYPE_OPTIONS,
  LANGUAGES,
  MODIFIER_OPS,
  MODIFIER_SCOPES,
  MOVEMENT_KINDS,
  ORIGIN_FEATS,
  RESOURCES,
  ROLL_TARGETS,
  SENSES,
  SKILLS,
  SPEED_MODES,
  TRIGGER_EVENTS,
  TRIGGER_MODES,
  TRIGGER_SUBJECTS,
  TRIGGER_TIMINGS,
  USES_PER,
  labelOf,
} from './registries';

export type Field =
  | { key: string; label: string; type: 'select'; options: { id: string; label: string }[]; default?: string; optionSource?: 'resources' }
  | { key: string; label: string; type: 'multiselect'; options: { id: string; label: string }[]; optionSource?: 'resources' }
  | { key: string; label: string; type: 'number'; default?: number }
  | { key: string; label: string; type: 'text'; default?: string }
  | { key: string; label: string; type: 'formula'; default?: string }
  | { key: string; label: string; type: 'choice-source' }
  | { key: string; label: string; type: 'when'; hint?: string }
  | { key: string; label: string; type: 'kvfilter' }
  | { key: string; label: string; type: 'damage-type'; default?: string };

/** Собрать массив условий из значения блока (undefined → []). */
const whenOf = (v: unknown): Cond[] => (Array.isArray(v) ? (v as Cond[]) : []);

// ─── Фильтр модификатора (applies_to.filter) — пары ключ:значение ───
export type FilterRow = { key: string; value: string };
const filterRowsToObj = (rows: unknown): Record<string, string> =>
  Object.fromEntries((Array.isArray(rows) ? (rows as FilterRow[]) : [])
    .filter((r) => r.key && r.key.trim())
    .map((r) => [r.key.trim(), r.value]));
const filterObjToRows = (obj: unknown): FilterRow[] =>
  obj && typeof obj === 'object'
    ? Object.entries(obj as Record<string, unknown>).map(([k, v]) => ({ key: k, value: String(v) }))
    : [];

// ─── Наведение (mechanics.targeting) и длительность (mechanics.duration) — верхний уровень ───
export type TargetingForm = { shape?: string; range?: string; max_targets?: string; area_kind?: string; area_size?: string; filter?: string };
export type DurationForm = { type?: string; amount?: string; concentration?: boolean; ends_when?: Cond[]; requires_each_turn?: Cond[] };

const str = (v: unknown): string => (v != null ? String(v) : '');

export function targetingToJson(t: TargetingForm | undefined): Record<string, unknown> | null {
  if (!t) return null;
  const out: Record<string, unknown> = {};
  if (t.shape) out.shape = t.shape;
  if (t.range?.trim()) out.range = t.range.trim();
  const mt = str(t.max_targets).trim();
  if (mt) out.max_targets = /^\d+$/.test(mt) ? Number(mt) : mt;
  if (t.area_kind) out.area = { kind: t.area_kind, ...(str(t.area_size).trim() ? { size: Number(t.area_size) } : {}) };
  if (t.filter?.trim()) out.filter = t.filter.trim();
  return Object.keys(out).length ? out : null;
}
export function jsonToTargeting(t: unknown): TargetingForm {
  const o = (t && typeof t === 'object') ? t as Record<string, unknown> : {};
  const area = (o.area && typeof o.area === 'object') ? o.area as Record<string, unknown> : {};
  return { shape: str(o.shape), range: str(o.range), max_targets: str(o.max_targets), area_kind: str(area.kind), area_size: str(area.size), filter: str(o.filter) };
}
export function durationToJson(d: DurationForm | undefined): Record<string, unknown> | null {
  if (!d || !d.type) return null;
  const out: Record<string, unknown> = { type: d.type };
  if (str(d.amount).trim()) out.amount = Number(d.amount);
  if (d.concentration) out.concentration = true;
  const ew = normalizeWhen(d.ends_when);
  if (ew.length) out.ends_when = ew;
  const rt = normalizeWhen(d.requires_each_turn);
  if (rt.length) out.requires_each_turn = rt;
  return out;
}
export function jsonToDuration(d: unknown): DurationForm {
  const o = (d && typeof d === 'object') ? d as Record<string, unknown> : {};
  return { type: str(o.type), amount: str(o.amount), concentration: o.concentration === true, ends_when: normalizeWhen(o.ends_when), requires_each_turn: normalizeWhen(o.requires_each_turn) };
}

// ─── Стоимость (activation.cost[]) — полная запись {resource, amount?, level?, card_id?} ───
export type CostRow = { resource: string; amount?: string; level?: string; card_id?: string };

const ACTIVE_RESOURCE_IDS = new Set(ACTIVE_RESOURCES.map((r) => r.id));

/** Простая экономическая стоимость (action/bonus/…), которую задаёт мультиселект trg_active. */
const isPlainActiveCost = (c: Record<string, unknown>): boolean =>
  typeof c.resource === 'string' && ACTIVE_RESOURCE_IDS.has(c.resource) &&
  c.amount == null && c.level == null && c.card_id == null;

const costToRows = (cost: Record<string, unknown>[]): CostRow[] => cost.map((c) => ({
  resource: String(c.resource ?? ''),
  ...(c.amount != null ? { amount: String(c.amount) } : {}),
  ...(c.level != null ? { level: String(c.level) } : {}),
  ...(c.card_id != null ? { card_id: String(c.card_id) } : {}),
}));

export const costRowsToCost = (rows: CostRow[]): Record<string, unknown>[] => rows
  .filter((r) => r.resource && r.resource.trim())
  .map((r) => {
    const amount = (r.amount ?? '').trim();
    return {
      resource: r.resource.trim(),
      ...(amount ? { amount: /^\d+$/.test(amount) ? Number(amount) : amount } : {}),
      ...(String(r.level ?? '').trim() ? { level: Number(r.level) } : {}),
      ...((r.card_id ?? '').trim() ? { card_id: (r.card_id ?? '').trim() } : {}),
    };
  });

// ─── Требования (activation.requirements[]) кроме level (тот — поле «Мин. уровень») ───
export type ReqRow = { type: string; value?: string; ability?: string; min?: string };

const requirementsToRows = (reqs: Record<string, unknown>[]): ReqRow[] => reqs
  .filter((r) => r.type !== 'level')
  .map((r) => ({
    type: String(r.type ?? 'class'),
    ...(r.value != null ? { value: String(r.value) } : {}),
    ...(r.ability != null ? { ability: String(r.ability) } : {}),
    ...(r.min != null ? { min: String(r.min) } : {}),
  }));

export const reqRowsToRequirements = (rows: ReqRow[]): Record<string, unknown>[] => rows
  .filter((r) => r.type)
  .map((r) => {
    const out: Record<string, unknown> = { type: r.type };
    if (r.type === 'ability_score') {
      out.ability = r.ability || 'str'; // редактор показывает «Сила» по умолчанию — пишем то же
      if (String(r.min ?? '').trim()) out.min = Number(r.min);
    } else if ((r.value ?? '').trim()) {
      out.value = (r.value ?? '').trim();
    }
    return out;
  });

export type Block = {
  id: string;
  label: string;
  group: 'trigger' | 'effect';
  fields: Field[];
  build: (v: Record<string, unknown>) => unknown;
  summary: (v: Record<string, unknown>) => string;
  defaults?: Record<string, unknown>;
};

const d20OneTrigger = (event: string) => ({
  mode: 'triggered',
  trigger: {
    event,
    timing: 'replaces',
    circumstances: [{ kind: 'd20_equals', value: 1 }],
  },
});

export const TRIGGER_BLOCKS: Block[] = [
  {
    id: 'trg_passive',
    label: 'Пассивный (всегда активен)',
    group: 'trigger',
    fields: [],
    build: () => ({ mode: 'passive' }),
    summary: () => 'Пассивный',
  },
  {
    id: 'trg_on_acquire',
    label: 'При получении (выбор)',
    group: 'trigger',
    fields: [],
    build: () => ({ mode: 'triggered', trigger: { event: 'on_acquire', timing: 'before' } }),
    summary: () => 'При получении',
  },
  {
    id: 'trg_long_rest',
    label: 'После длинного отдыха',
    group: 'trigger',
    fields: [],
    build: () => ({ mode: 'triggered', trigger: { event: 'long_rest', timing: 'after' } }),
    summary: () => 'После длинного отдыха',
  },
  {
    id: 'trg_short_rest',
    label: 'После короткого отдыха',
    group: 'trigger',
    fields: [],
    build: () => ({ mode: 'triggered', trigger: { event: 'short_rest', timing: 'after' } }),
    summary: () => 'После короткого отдыха',
  },
  {
    id: 'trg_zero_hp',
    label: 'При падении до 0 хитов',
    group: 'trigger',
    fields: [
      { key: 'uses_count', label: 'Использований', type: 'number', default: 1 },
      { key: 'uses_per', label: 'За период', type: 'select', options: USES_PER, default: 'long_rest' },
    ],
    defaults: { uses_count: 1, uses_per: 'long_rest' },
    build: (v) => ({
      mode: 'triggered',
      trigger: { event: 'reduced_to_0_hp', timing: 'replaces' },
      uses: { count: v.uses_count ?? 1, per: v.uses_per || 'long_rest' },
    }),
    summary: (v) => `0 HP (${v.uses_count ?? 1}/${labelOf(USES_PER, String(v.uses_per))})`,
  },
  {
    id: 'trg_d20_one',
    label: 'Когда на d20 выпала 1',
    group: 'trigger',
    fields: [
      { key: 'event', label: 'Тип броска', type: 'select', options: [
        { id: 'attack_roll_made', label: 'Атака' },
        { id: 'ability_check_made', label: 'Проверка' },
        { id: 'saving_throw_made', label: 'Спасбросок' },
      ], default: 'attack_roll_made' },
    ],
    defaults: { event: 'attack_roll_made' },
    build: (v) => d20OneTrigger(String(v.event || 'attack_roll_made')),
    summary: (v) => `d20=1 (${labelOf([{ id: 'attack_roll_made', label: 'Атака' }, { id: 'ability_check_made', label: 'Проверка' }, { id: 'saving_throw_made', label: 'Спасбросок' }], String(v.event))})`,
  },
  {
    id: 'trg_active',
    label: 'Активная способность',
    group: 'trigger',
    fields: [
      { key: 'resources', label: 'Ресурсы', type: 'multiselect', options: ACTIVE_RESOURCES, optionSource: 'resources' },
      { key: 'uses_count', label: 'Использований', type: 'text', default: 'prof_bonus' },
      { key: 'uses_per', label: 'За период', type: 'select', options: USES_PER, default: 'long_rest' },
    ],
    defaults: { resources: ['action'], uses_count: 'prof_bonus', uses_per: 'long_rest' },
    build: (v) => ({
      mode: 'active',
      // Экономическая стоимость — из мультиселекта; доп. ресурсы (слот/хиты/предмет) задаёт
      // отдельный редактор «Доп. стоимость» и дописываются в MechanicsBuilder.
      cost: ((Array.isArray(v.resources) ? v.resources : []) as unknown[]).map((resource) => ({ resource })),
      uses: { count: v.uses_count || 'prof_bonus', per: v.uses_per || 'long_rest' },
    }),
    summary: (v) => {
      const resources = (Array.isArray(v.resources) ? v.resources : [v.resource || 'action']).map(String);
      return `Актив: ${resources.map((r) => labelOf(ACTIVE_RESOURCES, r)).join(' + ')}, ${v.uses_count}/${labelOf(USES_PER, String(v.uses_per))}`;
    },
  },
  {
    id: 'trg_level',
    label: 'Доступно с уровня N',
    group: 'trigger',
    fields: [{ key: 'min_level', label: 'Мин. уровень', type: 'number', default: 3 }],
    defaults: { min_level: 3 },
    build: (v) => ({ requirements: [{ type: 'level', min_level: Number(v.min_level) || 1 }] }),
    summary: (v) => `С уровня ${v.min_level ?? 1}`,
  },
  {
    id: 'trg_custom',
    label: 'Триггер по событию (продвинутый)',
    group: 'trigger',
    fields: [
      { key: 'mode', label: 'Режим', type: 'select', options: TRIGGER_MODES, default: 'triggered' },
      { key: 'event', label: 'Событие (⏳ — движок пока не эмитит)', type: 'select', options: TRIGGER_EVENTS, default: 'hit' },
      { key: 'timing', label: 'Момент', type: 'select', options: TRIGGER_TIMINGS, default: 'after' },
      { key: 'subject', label: 'Субъект (⏳ — не фильтруется)', type: 'select', options: TRIGGER_SUBJECTS, default: '' },
      { key: 'uses_count', label: 'Использований (пусто — без лимита)', type: 'text', default: '' },
      { key: 'uses_per', label: 'За период', type: 'select', options: USES_PER, default: 'long_rest' },
      { key: 'circumstances', label: 'Условия срабатывания', type: 'when' },
    ],
    defaults: { mode: 'triggered', event: 'hit', timing: 'after', subject: '', uses_count: '', uses_per: 'long_rest' },
    build: (v) => {
      const circ = whenOf(v.circumstances);
      const trigger: Record<string, unknown> = { event: v.event || 'hit', timing: v.timing || 'after' };
      if (v.subject) trigger.subject = v.subject;
      if (circ.length) trigger.circumstances = circ;
      const out: Record<string, unknown> = { mode: v.mode === 'reaction' ? 'reaction' : 'triggered', trigger };
      const uc = String(v.uses_count ?? '').trim();
      if (uc) out.uses = { count: /^\d+$/.test(uc) ? Number(uc) : uc, per: v.uses_per || 'long_rest' };
      return out;
    },
    summary: (v) => `${v.mode === 'reaction' ? 'Реакция' : 'Триггер'}: ${labelOf(TRIGGER_EVENTS, String(v.event))}${whenOf(v.circumstances).length ? ' (при условии)' : ''}`,
  },
];

export const EFFECT_BLOCKS: Block[] = [
  {
    id: 'eff_grant_resource',
    label: 'Выдать ресурс',
    group: 'effect',
    fields: [
      { key: 'id', label: 'Ресурс', type: 'select', options: RESOURCES, optionSource: 'resources' },
      { key: 'amount', label: 'Количество', type: 'number', default: 1 },
    ],
    defaults: { id: 'heroic_inspiration', amount: 1 },
    build: (v) => ({ kind: 'resource', op: 'grant', id: v.id, amount: Number(v.amount) || 1 }),
    summary: (v) => `+${v.amount} ${labelOf(RESOURCES, String(v.id))}`,
  },
  {
    id: 'eff_restore_resource',
    label: 'Восстановить ресурс',
    group: 'effect',
    fields: [
      { key: 'id', label: 'Ресурс', type: 'select', options: RESOURCES, optionSource: 'resources' },
      { key: 'amount', label: 'Количество', type: 'number', default: 1 },
    ],
    defaults: { id: 'heroic_inspiration', amount: 1 },
    // op:'restore' — пополнить текущее до максимума (не выше). Полный ресурс не меняется.
    build: (v) => ({ kind: 'resource', op: 'restore', id: v.id, amount: Number(v.amount) || 1 }),
    summary: (v) => `Восстановить ${v.amount} ${labelOf(RESOURCES, String(v.id))} (до максимума)`,
  },
  {
    id: 'eff_grant_prof',
    label: 'Выдать владение',
    group: 'effect',
    fields: [
      { key: 'prof', label: 'Категория', type: 'select', options: [
        { id: 'skill', label: 'Навык' },
        { id: 'tool', label: 'Инструмент' },
        { id: 'weapon', label: 'Оружие' },
        { id: 'armor', label: 'Броня' },
      ], default: 'skill' },
      { key: 'value', label: 'Значение (id)', type: 'text' },
    ],
    defaults: { prof: 'skill' },
    build: (v) => ({ kind: 'grant_proficiency', prof: v.prof, value: v.value }),
    summary: (v) => `Владение ${v.prof}: ${v.value}`,
  },
  {
    id: 'eff_grant_feat',
    label: 'Выдать черту',
    group: 'effect',
    fields: [{ key: 'value', label: 'Черта', type: 'select', options: ORIGIN_FEATS }],
    build: (v) => ({ kind: 'grant_feat', value: v.value }),
    summary: (v) => `Черта: ${labelOf(ORIGIN_FEATS, String(v.value))}`,
  },
  {
    id: 'eff_grant_spell',
    label: 'Выдать заклинание/заговор',
    group: 'effect',
    fields: [
      { key: 'value', label: 'ID заклинания', type: 'text' },
      { key: 'ability', label: 'Характеристика', type: 'select', options: ABILITIES, default: 'int' },
      { key: 'level_gate', label: 'С уровня', type: 'number', default: 1 },
      { key: 'freeuse_count', label: 'Бесплатных использований (0 = нет)', type: 'number', default: 0 },
      { key: 'freeuse_recharge', label: 'Перезарядка freeuse', type: 'select', options: [
        { id: 'long_rest', label: 'Долгий отдых' }, { id: 'short_rest', label: 'Короткий отдых' }, { id: 'day', label: 'В день' },
      ], default: 'long_rest' },
      { key: 'freeuse_level', label: 'Круг бесплатного каста (0 = базовый)', type: 'number', default: 0 },
    ],
    defaults: { ability: 'int', level_gate: 1, freeuse_count: 0, freeuse_recharge: 'long_rest', freeuse_level: 0 },
    build: (v) => {
      const out: Record<string, unknown> = { kind: 'grant_spell', value: v.value, ability: v.ability, level_gate: Number(v.level_gate) || 1 };
      const count = Number(v.freeuse_count) || 0;
      if (count > 0) {
        const fu: Record<string, unknown> = { count, recharge: v.freeuse_recharge || 'long_rest' };
        const lvl = Number(v.freeuse_level) || 0;
        if (lvl > 0) fu.level = lvl;
        out.freeuse = fu;
      }
      return out;
    },
    summary: (v) => `Заклинание ${v.value} (ур.${v.level_gate}, ${labelOf(ABILITIES, String(v.ability))})${Number(v.freeuse_count) > 0 ? ` · freeuse ${v.freeuse_count}` : ''}`,
  },
  {
    id: 'eff_grant_sense',
    label: 'Дать чувство',
    group: 'effect',
    fields: [
      { key: 'sense', label: 'Чувство', type: 'select', options: SENSES },
      { key: 'range', label: 'Дальность (фт)', type: 'number', default: 60 },
    ],
    defaults: { range: 60 },
    build: (v) => ({ kind: 'grant_sense', sense: v.sense, range: Number(v.range) || 60 }),
    summary: (v) => `${labelOf(SENSES, String(v.sense))} ${v.range} фт`,
  },
  {
    id: 'eff_weapon_mastery',
    label: 'Искусность оружия',
    group: 'effect',
    fields: [
      { key: 'value', label: 'Вид оружия', type: 'select', options: WEAPON_TYPES },
    ],
    // Искусность 2024: персонаж может пользоваться свойством искусности этого ВИДА оружия.
    // Обычно выдаётся через choice(source:'weapon', apply:{kind:'weapon_mastery'}) — «выбери N видов».
    build: (v) => ({ kind: 'weapon_mastery', value: v.value }),
    summary: (v) => `Искусность: ${labelOf(WEAPON_TYPES, String(v.value))}`,
  },
  {
    id: 'eff_grant_speed',
    label: 'Дать скорость',
    group: 'effect',
    fields: [
      { key: 'mode', label: 'Режим', type: 'select', options: SPEED_MODES, default: 'walk' },
      { key: 'value', label: 'Значение', type: 'text', default: '35' },
    ],
    defaults: { mode: 'walk', value: '35' },
    build: (v) => ({ kind: 'grant_speed', mode: v.mode, value: v.value }),
    summary: (v) => `Скорость ${labelOf(SPEED_MODES, String(v.mode))}: ${v.value}`,
  },
  {
    id: 'eff_grant_ability',
    label: '+характеристика',
    group: 'effect',
    fields: [
      { key: 'ability', label: 'Характеристика', type: 'select', options: ABILITIES },
      { key: 'amount', label: 'Бонус', type: 'number', default: 1 },
    ],
    defaults: { amount: 1 },
    build: (v) => ({ kind: 'grant_ability_score', ability: v.ability, amount: Number(v.amount) || 1 }),
    summary: (v) => `+${v.amount} ${labelOf(ABILITIES, String(v.ability))}`,
  },
  {
    id: 'eff_grant_effect',
    label: 'Дать эффект(ы) — бусины',
    group: 'effect',
    fields: [
      { key: 'slugs', label: 'Эффекты (slug через запятую)', type: 'text', default: '' },
    ],
    defaults: { slugs: '' },
    build: (v) => ({
      kind: 'grant_effect',
      values: String(v.slugs || '').split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
    }),
    summary: (v) => {
      const list = String(v.slugs || '').split(/[,\s]+/).filter(Boolean);
      return `Дать эффекты: ${list.length ? list.join(', ') : '—'}`;
    },
  },
  {
    id: 'eff_adv',
    label: 'Преимущество/помеха',
    group: 'effect',
    fields: [
      { key: 'roll', label: 'Бросок', type: 'select', options: ROLL_TARGETS, default: 'saving_throw' },
      { key: 'op', label: 'Эффект', type: 'select', options: [
        { id: 'advantage', label: 'Преимущество' },
        { id: 'disadvantage', label: 'Помеха' },
      ], default: 'advantage' },
      { key: 'scope', label: 'Область', type: 'select', options: MODIFIER_SCOPES, default: 'self' },
      { key: 'filter', label: 'Фильтр (когда применять)', type: 'kvfilter' },
      { key: 'when', label: 'Условия (когда действует)', type: 'when' },
    ],
    defaults: { roll: 'saving_throw', op: 'advantage', scope: 'self' },
    build: (v) => {
      const when = whenOf(v.when);
      const filter = filterRowsToObj(v.filter);
      const applies_to: Record<string, unknown> = { roll: v.roll };
      if (Object.keys(filter).length) applies_to.filter = filter;
      return {
        kind: 'modifier', applies_to, op: v.op, when,
        ...(v.scope === 'target' ? { scope: 'target' } : {}),
      };
    },
    summary: (v) => `${v.op === 'advantage' ? 'Преим.' : 'Помеха'} на ${labelOf(ROLL_TARGETS, String(v.roll))}${whenOf(v.when).length ? ' (при условии)' : ''}`,
  },
  {
    id: 'eff_bonus',
    label: 'Модификатор (число)',
    group: 'effect',
    fields: [
      { key: 'roll', label: 'Цель', type: 'select', options: ROLL_TARGETS, default: 'max_hp' },
      { key: 'op', label: 'Операция', type: 'select', options: MODIFIER_OPS, default: 'add' },
      { key: 'value', label: 'Формула/значение', type: 'formula', default: 'self_level' },
      { key: 'scope', label: 'Область', type: 'select', options: MODIFIER_SCOPES, default: 'self' },
      { key: 'filter', label: 'Фильтр (когда применять)', type: 'kvfilter' },
      { key: 'when', label: 'Условия (когда действует)', type: 'when' },
    ],
    defaults: { roll: 'max_hp', op: 'add', value: 'self_level', scope: 'self' },
    build: (v) => {
      const when = whenOf(v.when);
      const filter = filterRowsToObj(v.filter);
      const applies_to: Record<string, unknown> = { roll: v.roll };
      if (Object.keys(filter).length) applies_to.filter = filter;
      return {
        kind: 'modifier', applies_to, op: v.op || 'add', value: v.value,
        ...(v.scope === 'target' ? { scope: 'target' } : {}),
        ...(when.length ? { when } : {}),
      };
    },
    summary: (v) => `${labelOf(MODIFIER_OPS, String(v.op || 'add'))} ${v.value} к ${labelOf(ROLL_TARGETS, String(v.roll))}${whenOf(v.when).length ? ' (при условии)' : ''}`,
  },
  {
    id: 'eff_resistance',
    label: 'Сопротивление/иммунитет',
    group: 'effect',
    fields: [
      { key: 'damage_type', label: 'Тип урона', type: 'damage-type' },
      { key: 'value', label: 'Степень', type: 'select', options: [
        { id: 'resistance', label: 'Сопротивление' },
        { id: 'immunity', label: 'Иммунитет' },
        { id: 'vulnerability', label: 'Уязвимость' },
      ], default: 'resistance' },
    ],
    defaults: { value: 'resistance' },
    build: (v) => ({ kind: 'resistance', damage_type: v.damage_type, value: v.value }),
    summary: (v) => `${labelOf([{ id: 'resistance', label: 'Сопр.' }, { id: 'immunity', label: 'Имм.' }, { id: 'vulnerability', label: 'Уязв.' }], String(v.value))} ${labelOf(DAMAGE_TYPE_OPTIONS, String(v.damage_type))}`,
  },
  {
    id: 'eff_temp_hp',
    label: 'Временные хиты',
    group: 'effect',
    fields: [{ key: 'amount', label: 'Формула', type: 'formula', default: 'prof_bonus' }],
    defaults: { amount: 'prof_bonus' },
    build: (v) => ({ kind: 'temp_hp', amount: v.amount }),
    summary: (v) => `Temp HP: ${v.amount}`,
  },
  {
    id: 'eff_heal',
    label: 'Лечение',
    group: 'effect',
    fields: [{ key: 'amount', label: 'Формула', type: 'formula', default: 'self_level d4' }],
    build: (v) => ({ kind: 'healing', amount: v.amount }),
    summary: (v) => `Лечение: ${v.amount}`,
  },
  {
    id: 'eff_dash',
    label: 'Рывок/перемещение',
    group: 'effect',
    fields: [],
    build: () => ({ kind: 'grant_action', value: 'dash' }),
    summary: () => 'Рывок (бонусное действие)',
  },
  {
    id: 'eff_grant_action',
    label: 'Дать действие (по id)',
    group: 'effect',
    fields: [
      { key: 'value', label: 'ID действия (слаг)', type: 'text' },
      { key: 'level_gate', label: 'Доступно с уровня (0 — без гейта)', type: 'number', default: 0 },
    ],
    defaults: { level_gate: 0 },
    build: (v) => {
      const lg = Number(v.level_gate) || 0;
      return { kind: 'grant_action', value: v.value, ...(lg > 0 ? { level_gate: lg } : {}) };
    },
    summary: (v) => `Действие: ${v.value || '—'}${Number(v.level_gate) > 0 ? ` (с ур.${v.level_gate})` : ''}`,
  },
  {
    id: 'eff_save_damage',
    label: 'Спасбросок → урон',
    group: 'effect',
    fields: [
      { key: 'ability', label: 'Спасбросок', type: 'select', options: ABILITIES, default: 'dex' },
      { key: 'dc', label: 'Сл', type: 'formula', default: '8+prof+con' },
      { key: 'dice', label: 'Кубы', type: 'text', default: '1d10' },
      { key: 'damage_type', label: 'Тип урона', type: 'damage-type', default: 'fire' },
    ],
    defaults: { ability: 'dex', dc: '8+prof+con', dice: '1d10', damage_type: 'fire' },
    build: (v) => ({
      resolution: 'save',
      who: 'target',
      ability: v.ability,
      dc: v.dc,
      on_fail: [{ kind: 'damage', dice: v.dice, type: v.damage_type }],
      on_success: [{ kind: 'damage', dice: v.dice, type: v.damage_type, on_success: 'half' }],
    }),
    summary: (v) => `Save ${labelOf(ABILITIES, String(v.ability))} DC ${v.dc}: ${v.dice} ${v.damage_type}`,
  },
  {
    id: 'eff_attack_damage',
    label: 'Атака → урон',
    group: 'effect',
    fields: [
      { key: 'ability', label: 'Характеристика атаки', type: 'select', options: ATTACK_ABILITIES, default: 'auto' },
      { key: 'dice', label: 'Кубы урона', type: 'text', default: '1d8' },
      { key: 'damage_type', label: 'Тип урона', type: 'damage-type', default: 'slashing' },
    ],
    defaults: { ability: 'auto', dice: '1d8', damage_type: 'slashing' },
    build: (v) => ({
      resolution: 'attack_roll',
      ability: v.ability,
      on_hit: [{ kind: 'damage', dice: v.dice, type: v.damage_type }],
    }),
    summary: (v) => `Атака (${labelOf(ATTACK_ABILITIES, String(v.ability))}) → ${v.dice} ${labelOf(DAMAGE_TYPE_OPTIONS, String(v.damage_type))}`,
  },
  {
    id: 'eff_reroll',
    label: 'Переброс кубика',
    group: 'effect',
    fields: [
      { key: 'which', label: 'Куб', type: 'select', options: [{ id: 'd20', label: 'd20' }], default: 'd20' },
      { key: 'keep', label: 'Оставить', type: 'select', options: [
        { id: 'either', label: 'Любой' },
        { id: 'higher', label: 'Больший' },
        { id: 'lower', label: 'Меньший' },
      ], default: 'either' },
    ],
    defaults: { which: 'd20', keep: 'either' },
    build: (v) => ({ kind: 'reroll', which: v.which, keep: v.keep }),
    summary: (v) => `Переброс ${v.which}`,
  },
  {
    id: 'eff_set_value',
    label: 'Установить значение',
    group: 'effect',
    fields: [
      { key: 'target', label: 'Цель', type: 'select', options: [
        { id: 'hp', label: 'Текущие хиты' },
        { id: 'temp_hp', label: 'Временные хиты' },
        { id: 'max_hp', label: 'Макс. хиты' },
        { id: 'ac_base', label: 'Базовый КЗ (метод, без доспеха) — напр. Доспех мага 13+dex' },
      ], default: 'hp' },
      { key: 'formula', label: 'Значение', type: 'formula', default: '1' },
    ],
    defaults: { target: 'hp', formula: '1' },
    build: (v) => ({ kind: 'set_value', target: v.target, formula: v.formula }),
    summary: (v) => `${v.target} = ${v.formula}`,
  },
  {
    id: 'eff_damage',
    label: 'Урон (авто, себе)',
    group: 'effect',
    fields: [
      { key: 'dice', label: 'Кубы/формула', type: 'text', default: '1d6' },
      { key: 'damage_type', label: 'Тип урона', type: 'damage-type', default: 'fire' },
    ],
    defaults: { dice: '1d6', damage_type: 'fire' },
    build: (v) => ({ kind: 'damage', dice: v.dice, type: v.damage_type }),
    summary: (v) => `Урон: ${v.dice} ${labelOf(DAMAGE_TYPE_OPTIONS, String(v.damage_type))}`,
  },
  {
    id: 'eff_condition',
    label: 'Состояние (наложить/снять)',
    group: 'effect',
    fields: [
      { key: 'value', label: 'Состояние', type: 'select', options: CONDITIONS, default: 'poisoned' },
      { key: 'op', label: 'Действие', type: 'select', options: [{ id: 'apply', label: 'Наложить' }, { id: 'remove', label: 'Снять' }], default: 'apply' },
    ],
    defaults: { value: 'poisoned', op: 'apply' },
    build: (v) => ({ kind: 'condition', value: v.value, op: v.op }),
    summary: (v) => `${v.op === 'remove' ? 'Снять' : 'Наложить'}: ${labelOf(CONDITIONS, String(v.value))}`,
  },
  {
    id: 'eff_movement',
    label: 'Перемещение',
    group: 'effect',
    fields: [
      { key: 'value', label: 'Тип', type: 'select', options: MOVEMENT_KINDS, default: 'push' },
      { key: 'distance', label: 'Дистанция (фт)', type: 'text', default: '10' },
    ],
    defaults: { value: 'push', distance: '10' },
    build: (v) => ({ kind: 'movement', value: v.value, distance: v.distance }),
    summary: (v) => `${labelOf(MOVEMENT_KINDS, String(v.value))} ${v.distance} фт`,
  },
  {
    id: 'eff_add_item',
    label: 'Выдать предмет',
    group: 'effect',
    fields: [
      { key: 'card_id', label: 'ID предмета', type: 'text' },
      { key: 'qty', label: 'Количество', type: 'number', default: 1 },
      { key: 'name', label: 'Имя (необяз.)', type: 'text', default: '' },
    ],
    defaults: { qty: 1 },
    build: (v) => ({ kind: 'add_item', card_id: v.card_id, qty: Number(v.qty) || 1, ...(String(v.name || '').trim() ? { name: v.name } : {}) }),
    summary: (v) => `Предмет: ${v.card_id || '—'}${Number(v.qty) > 1 ? ` ×${v.qty}` : ''}`,
  },
  {
    id: 'eff_boon',
    label: 'Талон (вдохновение/кость)',
    group: 'effect',
    fields: [
      { key: 'id', label: 'ID талона', type: 'text', default: 'bardic_inspiration' },
      { key: 'die', label: 'Кость', type: 'text', default: '1d6' },
      { key: 'applies_to', label: 'На что (через запятую)', type: 'text', default: 'ability_check, attack_roll, saving_throw' },
      { key: 'expires', label: 'Истекает (необяз.)', type: 'text', default: '' },
    ],
    defaults: { id: 'bardic_inspiration', die: '1d6', applies_to: 'ability_check, attack_roll, saving_throw' },
    build: (v) => ({
      kind: 'boon', id: v.id, die: v.die,
      applies_to: String(v.applies_to || '').split(/[,\s]+/).filter(Boolean),
      ...(String(v.expires || '').trim() ? { expires: v.expires } : {}),
    }),
    summary: (v) => `Талон ${v.id}: ${v.die}`,
  },
  {
    id: 'eff_grant_expertise',
    label: 'Дать компетентность',
    group: 'effect',
    fields: [
      { key: 'prof', label: 'Категория', type: 'select', options: [{ id: 'skill', label: 'Навык' }, { id: 'tool', label: 'Инструмент' }], default: 'skill' },
      { key: 'value', label: 'Значение (id)', type: 'text' },
    ],
    defaults: { prof: 'skill' },
    build: (v) => ({ kind: 'grant_expertise', prof: v.prof, value: v.value }),
    summary: (v) => `Компетентность ${v.prof}: ${v.value}`,
  },
  {
    id: 'eff_grant_language',
    label: 'Дать язык',
    group: 'effect',
    fields: [{ key: 'value', label: 'Язык', type: 'select', options: LANGUAGES, default: 'common' }],
    defaults: { value: 'common' },
    build: (v) => ({ kind: 'grant_language', value: v.value }),
    summary: (v) => `Язык: ${labelOf(LANGUAGES, String(v.value))}`,
  },
  {
    id: 'eff_value_method',
    label: 'Метод значения характеристики',
    group: 'effect',
    fields: [
      { key: 'target', label: 'Характеристика', type: 'select', options: ABILITIES, default: 'str' },
      { key: 'formula', label: 'Формула/значение', type: 'formula', default: '' },
    ],
    defaults: { target: 'str' },
    build: (v) => ({ kind: 'value_method', target: v.target, formula: v.formula }),
    summary: (v) => `Метод ${labelOf(ABILITIES, String(v.target))} = ${v.formula}`,
  },
  {
    id: 'eff_variable',
    label: 'Переменная ⏳',
    group: 'effect',
    fields: [
      { key: 'id', label: 'ID переменной', type: 'text' },
      { key: 'value', label: 'Значение', type: 'text', default: '' },
    ],
    build: (v) => ({ kind: 'variable', id: v.id, ...(String(v.value || '').trim() ? { value: v.value } : {}) }),
    summary: (v) => `Переменная ${v.id} ⏳`,
  },
  {
    id: 'eff_transform',
    label: 'Преображение (transform)',
    group: 'effect',
    fields: [
      { key: 'into', label: 'Форма (id/имя)', type: 'text' },
      { key: 'max_cr', label: 'Макс. ПО (CR, необяз.)', type: 'text', default: '' },
    ],
    // Движок (applyTransform) читает `form`, не `into`, — эмитим form, чтобы имя формы применялось.
    build: (v) => ({ kind: 'transform', form: v.into, ...(String(v.max_cr || '').trim() ? { max_cr: v.max_cr } : {}) }),
    summary: (v) => `Преображение: ${v.into || '…'}`,
  },
  {
    id: 'eff_choice',
    label: 'Выбор из списка',
    group: 'effect',
    fields: [{ key: 'choice', label: 'Настройки выбора', type: 'choice-source' }],
    build: (v) => {
      const c = (v.choice || {}) as Record<string, unknown>;
      const options = (c.options || {}) as ChoiceOptions;
      const grantBySource: Record<string, Payload> = {
        skill: { kind: 'grant_proficiency', prof: 'skill' },
        tool: { kind: 'grant_proficiency', prof: 'tool' },
        saving_throw: { kind: 'grant_proficiency', prof: 'saving_throw' },
        language: { kind: 'grant_language' },
        feat: { kind: 'grant_feat' },
        spell: { kind: 'grant_spell' },
        damage_type: { kind: 'resistance' },
      };
      return {
        kind: 'choice',
        id: c.id || 'choice_' + (c.source || 'custom'),
        prompt: c.prompt,
        count: c.count ?? 1,
        options,
        recommended: c.recommended,
        grant: c.grant || grantBySource[String(c.source)] || { kind: 'grant_proficiency' },
        resolution: c.resolution || 'on_acquire',
      };
    },
    summary: (v) => {
      const c = (v.choice || {}) as Record<string, unknown>;
      return `Выбор: ${c.prompt || labelOf(CHOICE_SOURCES, String((c as { source?: string }).source))}`;
    },
  },
  {
    id: 'eff_narrative',
    label: 'Текстовый эффект',
    group: 'effect',
    fields: [{ key: 'description', label: 'Описание', type: 'text' }],
    build: (v) => ({ kind: 'narrative', description: v.description }),
    summary: (v) => String(v.description || 'Текст'),
  },
  {
    id: 'eff_raw_json',
    label: 'Сырой JSON',
    group: 'effect',
    fields: [{ key: 'json', label: 'JSON', type: 'text', default: '{}' }],
    defaults: { json: '{}' },
    build: (v) => {
      try {
        return JSON.parse(String(v.json || '{}'));
      } catch {
        return { kind: 'narrative', description: 'Invalid JSON' };
      }
    },
    summary: () => 'Сырой JSON',
  },
];

export const ALL_BLOCKS: Block[] = [...TRIGGER_BLOCKS, ...EFFECT_BLOCKS];

export const BLOCK_MAP: Record<string, Block> = Object.fromEntries(ALL_BLOCKS.map((b) => [b.id, b]));

export function buildMechanics(
  triggerId: string,
  triggerValues: Record<string, unknown>,
  effectEntries: Array<{ blockId: string; values: Record<string, unknown> }>,
) {
  const triggerBlock = BLOCK_MAP[triggerId];
  if (!triggerBlock) return null;

  const activationPart = triggerBlock.build(triggerValues) as Record<string, unknown>;
  const levelReq = activationPart.requirements as unknown[] | undefined;
  delete activationPart.requirements;

  const activation: Record<string, unknown> = {
    mode: activationPart.mode || 'passive',
    ...(activationPart.trigger ? { trigger: activationPart.trigger } : {}),
    ...(activationPart.cost ? { cost: activationPart.cost } : {}),
  };

  const uses = activationPart.uses;
  const fragments = effectEntries
    .map((e) => BLOCK_MAP[e.blockId]?.build(e.values))
    .filter(Boolean);

  const interactions: Record<string, unknown>[] = [];
  const autoResult: unknown[] = [];

  for (const f of fragments) {
    const obj = f as Record<string, unknown>;
    if (obj.resolution) interactions.push(obj);
    else autoResult.push(obj);
  }
  if (autoResult.length) interactions.unshift({ resolution: 'auto', result: autoResult });

  const mechanics: Record<string, unknown> = {
    activation,
    effects: interactions,
  };
  if (uses) mechanics.uses = uses;
  if (levelReq?.length) {
    mechanics.activation = {
      ...activation,
      requirements: levelReq,
    };
  }
  return mechanics;
}

export function summarizeMechanics(
  triggerId: string,
  triggerValues: Record<string, unknown>,
  effectEntries: Array<{ blockId: string; values: Record<string, unknown> }>,
) {
  const parts: string[] = [];
  const tb = BLOCK_MAP[triggerId];
  if (tb) parts.push(tb.summary(triggerValues));
  for (const e of effectEntries) {
    const b = BLOCK_MAP[e.blockId];
    if (b) parts.push(b.summary(e.values));
  }
  return parts.filter(Boolean).join(' → ');
}

export function defaultValuesForBlock(blockId: string): Record<string, unknown> {
  const b = BLOCK_MAP[blockId];
  if (!b) return {};
  const vals: Record<string, unknown> = { ...(b.defaults || {}) };
  for (const f of b.fields) {
    if (vals[f.key] === undefined && 'default' in f && f.default !== undefined) {
      vals[f.key] = f.default;
    }
  }
  return vals;
}

// ─── Десериализация: mechanics-JSON -> состояние блоков (для редактирования) ───

type Dict = Record<string, unknown>;

// Восстановить форму выбора из payload.choice (обратно к ChoiceEditor)
export function optionsToChoiceForm(choice: Dict): Dict {
  const opts = (choice.options || {}) as Dict;
  const items = (opts.items as Array<Dict>) || [];
  // Объектный фильтр ({classes,levels,only_available_slots}) сохраняем ДОСЛОВНО в form.filter (строковый
  // select его не редактирует, но lossless round-trip обязателен — иначе правка другого поля выборки
  // затёрла бы ограничение). Флаг only_available_slots дублируем в чекбокс.
  const rawFilter = opts.filter;
  const onlyAvailableSlots = !!(rawFilter && typeof rawFilter === 'object' && !Array.isArray(rawFilter)
    && (rawFilter as Dict).only_available_slots);
  return {
    id: choice.id,
    prompt: choice.prompt,
    count: choice.count ?? 1,
    source: opts.source || 'skill',
    filter: rawFilter ?? 'all',
    onlyAvailableSlots,
    recommended: choice.recommended,
    resolution: choice.resolution || 'on_acquire',
    items: items.map((it) => ({ id: it.id, name: it.name, grantsJson: JSON.stringify(it.grants ?? []) })),
    options: opts, // сохраняем исходные options для точной пересборки
    grant: choice.grant, // сохраняем grant
  };
}

// Один payload -> блок-эффект. Если блок не может точно представить payload — eff_raw_json.
function payloadToEntry(p: Dict): { blockId: string; values: Dict } {
  const raw = (): { blockId: string; values: Dict } => ({ blockId: 'eff_raw_json', values: { json: JSON.stringify(p) } });
  switch (p?.kind) {
    case 'resource': return {
      blockId: p.op === 'restore' ? 'eff_restore_resource' : 'eff_grant_resource',
      values: { id: p.id, amount: p.amount ?? 1 },
    };
    case 'grant_proficiency': return { blockId: 'eff_grant_prof', values: { prof: p.prof, value: p.value } };
    case 'grant_feat': return { blockId: 'eff_grant_feat', values: { value: p.value } };
    case 'grant_spell': {
      const fu = p.freeuse as Dict | number | boolean | undefined;
      const fuObj = fu && typeof fu === 'object' ? fu : null;
      const freeuse_count = fuObj ? Number(fuObj.count ?? 1) : fu === true ? 1 : typeof fu === 'number' ? fu : 0;
      return { blockId: 'eff_grant_spell', values: {
        value: p.value, ability: p.ability, level_gate: p.level_gate ?? 1,
        freeuse_count,
        freeuse_recharge: (fuObj && typeof fuObj.recharge === 'string' ? fuObj.recharge : 'long_rest'),
        freeuse_level: fuObj && typeof fuObj.level === 'number' ? fuObj.level : 0,
      } };
    }
    case 'grant_sense': return { blockId: 'eff_grant_sense', values: { sense: p.sense, range: p.range ?? 60 } };
    case 'weapon_mastery': return { blockId: 'eff_weapon_mastery', values: { value: p.value } };
    case 'grant_speed': return { blockId: 'eff_grant_speed', values: { mode: p.mode, value: p.value } };
    case 'grant_ability_score': return { blockId: 'eff_grant_ability', values: { ability: p.ability, amount: p.amount ?? 1 } };
    case 'grant_effect': {
      const vals = Array.isArray(p.values) ? p.values : (p.value != null ? [p.value] : []);
      return { blockId: 'eff_grant_effect', values: { slugs: (vals as unknown[]).filter(Boolean).join(', ') } };
    }
    case 'resistance': return { blockId: 'eff_resistance', values: { damage_type: p.damage_type, value: p.value ?? 'resistance' } };
    case 'temp_hp': return { blockId: 'eff_temp_hp', values: { amount: p.amount } };
    case 'healing': return { blockId: 'eff_heal', values: { amount: p.amount } };
    case 'reroll': return { blockId: 'eff_reroll', values: { which: p.which ?? 'd20', keep: p.keep ?? 'either' } };
    // duration на самом payload блок не несёт (есть только редактор длительности верхнего уровня) → сырой JSON.
    case 'set_value': return p.duration != null
      ? raw()
      : { blockId: 'eff_set_value', values: { target: p.target, formula: p.formula } };
    case 'narrative': return { blockId: 'eff_narrative', values: { description: p.description } };
    case 'damage': {
      // Простой урон (кубы+тип); scaling/on_success/bonus/per_dart/formula/ability → сырой JSON
      // (ability на плоском уроне работает как фильтр Rage, блок его не представляет).
      const simple = p.scaling == null && p.on_success == null && p.bonus == null && p.per_dart == null && p.formula == null && p.ability == null;
      return simple
        ? { blockId: 'eff_damage', values: { dice: p.dice ?? p.amount, damage_type: p.type ?? p.damage_type ?? 'fire' } }
        : raw();
    }
    case 'condition': {
      // Простое наложение/снятие; duration/save_ends/стек-поля (вкл. stack_priority) → сырой JSON.
      const simple = p.duration == null && p.save_ends == null && p.stack_id == null && p.stack_type == null && p.stack_priority == null;
      return simple ? { blockId: 'eff_condition', values: { value: p.value, op: p.op ?? 'apply' } } : raw();
    }
    case 'movement': return { blockId: 'eff_movement', values: { value: p.value, distance: p.distance ?? '' } };
    case 'add_item': return { blockId: 'eff_add_item', values: { card_id: p.card_id ?? p.value, qty: p.qty ?? p.amount ?? 1, name: p.name ?? '' } };
    case 'boon': return { blockId: 'eff_boon', values: { id: p.id, die: p.die, applies_to: Array.isArray(p.applies_to) ? (p.applies_to as unknown[]).join(', ') : '', expires: p.expires ?? '' } };
    case 'grant_expertise': return { blockId: 'eff_grant_expertise', values: { prof: p.prof ?? p.expertise ?? 'skill', value: p.value } };
    case 'grant_language': return { blockId: 'eff_grant_language', values: { value: p.value } };
    case 'value_method': return { blockId: 'eff_value_method', values: { target: p.target, formula: p.formula ?? p.value ?? '' } };
    case 'variable': return { blockId: 'eff_variable', values: { id: p.id ?? p.target, value: p.value ?? '' } };
    case 'transform': return { blockId: 'eff_transform', values: { into: p.into ?? p.form ?? p.value, max_cr: p.max_cr ?? p.cr_max ?? '' } };
    case 'grant_action': {
      // value | values — канон; options — легаси (до слайса 6), принимаем для обратной десериализации.
      const vals = Array.isArray(p.values) ? (p.values as unknown[])
        : p.value != null ? [p.value]
          : Array.isArray(p.options) ? (p.options as unknown[]) : [];
      if (vals.length === 1 && vals[0] === 'dash') return { blockId: 'eff_dash', values: {} };
      if (vals.length === 1 && typeof vals[0] === 'string') {
        return { blockId: 'eff_grant_action', values: { value: vals[0], level_gate: p.level_gate ?? p.min_level ?? 0 } };
      }
      return raw();
    }
    case 'modifier': {
      const at = (p.applies_to || {}) as Dict;
      const when = normalizeWhen(p.when);
      const filter = filterObjToRows(at.filter);
      const scope = p.scope === 'target' ? 'target' : 'self';
      // Незнакомые поля (priority/source/duration/…) или лишние ключи applies_to → сырой JSON (без потерь).
      const KNOWN = new Set(['kind', 'applies_to', 'op', 'value', 'when', 'scope']);
      const atExtra = Object.keys(at).some((k) => k !== 'roll' && k !== 'filter');
      if (Object.keys(p).some((k) => !KNOWN.has(k)) || atExtra) return raw();
      if (p.op === 'advantage' || p.op === 'disadvantage') {
        return { blockId: 'eff_adv', values: { roll: at.roll, op: p.op, scope, filter, when } };
      }
      if (['add', 'set', 'multiply', 'upgrade', 'downgrade', undefined].includes(p.op as string | undefined)) {
        return { blockId: 'eff_bonus', values: { roll: at.roll, op: p.op ?? 'add', value: p.value, scope, filter, when } };
      }
      return raw();
    }
    case 'choice': return { blockId: 'eff_choice', values: { choice: optionsToChoiceForm(p) } };
    default: return raw();
  }
}

export type DeserializedMechanics = {
  triggerId: string;
  triggerValues: Dict;
  minLevel: number | '';
  itemWhile: '' | 'equipped' | 'carried' | 'attuned';
  consumesSelf: boolean;
  ammo: string;
  recharge: string;
  extraCost: CostRow[];
  requirements: ReqRow[];
  targeting: TargetingForm;
  duration: DurationForm;
  effectEntries: Array<{ id: string; blockId: string; values: Dict }>;
};

// mechanics-объект -> состояние конструктора. Неузнанное падает в eff_raw_json (сырой JSON).
export function deserializeMechanics(m: Dict | null | undefined): DeserializedMechanics | null {
  if (!m || typeof m !== 'object') return null;
  const act = (m.activation || {}) as Dict;
  const uses = (m.uses || {}) as Dict;
  let triggerId = 'trg_passive';
  const tv: Dict = {};
  // Разбор в trg_custom (продвинутый): любое событие/реакция с субъектом/условиями,
  // которое простые блоки не могут представить без потерь.
  const toCustom = (tr: Dict) => {
    triggerId = 'trg_custom';
    tv.mode = act.mode === 'reaction' ? 'reaction' : 'triggered';
    tv.event = tr.event ?? 'hit';
    tv.timing = tr.timing ?? 'after';
    tv.subject = tr.subject ?? '';
    tv.circumstances = normalizeWhen(tr.circumstances);
    tv.uses_count = uses.count != null ? String(uses.count) : '';
    tv.uses_per = uses.per ?? 'long_rest';
  };
  if (act.mode === 'active') {
    triggerId = 'trg_active';
    const cost = Array.isArray(act.cost) ? (act.cost as Dict[]) : [];
    // В мультиселект — только простая экономика; доп. ресурсы уходят в extraCost (ниже).
    tv.resources = cost.filter(isPlainActiveCost).map((c) => c.resource);
    tv.uses_count = uses.count ?? 'prof_bonus';
    tv.uses_per = uses.per ?? 'long_rest';
  } else if (act.mode === 'reaction') {
    toCustom((act.trigger || {}) as Dict);
  } else if (act.mode === 'triggered') {
    const tr = (act.trigger || {}) as Dict;
    const ev = tr.event;
    const circ = Array.isArray(tr.circumstances) ? (tr.circumstances as Dict[]) : [];
    const hasSubject = !!tr.subject;
    // Точный паттерн trg_d20_one: timing:replaces + circumstances=[d20_equals:1] на 3 видах броска.
    const isD20One = tr.timing === 'replaces' && circ.length === 1
      && circ[0]?.kind === 'd20_equals' && Number(circ[0]?.value) === 1
      && ['attack_roll_made', 'ability_check_made', 'saving_throw_made'].includes(String(ev));
    // Простые блоки НЕ несут uses/subject/circumstances/произвольный timing — берём их только
    // когда триггер точно им соответствует, иначе теряли бы данные (→ trg_custom).
    const noUses = uses.count == null;
    const simple = !hasSubject && circ.length === 0 && noUses;
    if (isD20One && !hasSubject && noUses) {
      triggerId = 'trg_d20_one';
      tv.event = ev;
    } else if (ev === 'on_acquire' && simple) triggerId = 'trg_on_acquire';
    else if (ev === 'long_rest' && simple) triggerId = 'trg_long_rest';
    else if (ev === 'short_rest' && simple) triggerId = 'trg_short_rest';
    else if (ev === 'reduced_to_0_hp' && !hasSubject && circ.length === 0 && tr.timing === 'replaces' && uses.count != null) {
      triggerId = 'trg_zero_hp';
      tv.uses_count = uses.count;
      tv.uses_per = uses.per ?? 'long_rest';
    } else {
      toCustom(tr);
    }
  }

  let minLevel: number | '' = '';
  const reqs = (act.requirements as Dict[]) || [];
  const lr = reqs.find((r) => r.type === 'level');
  if (lr?.min_level) minLevel = lr.min_level as number;
  // Прочие требования (не level) round-trip'ятся через RequirementsEditor (раньше терялись).
  const requirements = requirementsToRows(reqs);

  // Гейты-разрешения (S3): while / consumes_self / ammo / uses.recharge / доп. стоимость.
  const whileVal = String(act.while ?? m.while ?? '');
  const itemWhile = (['equipped', 'carried', 'attuned'].includes(whileVal) ? whileVal : '') as DeserializedMechanics['itemWhile'];
  const consumesSelf = act.consumes_self === true || m.consumes_self === true;
  const ammoRaw = m.ammo;
  const ammo = typeof ammoRaw === 'string' ? ammoRaw
    : (ammoRaw && typeof ammoRaw === 'object' ? String((ammoRaw as Dict).card_id ?? '') : '');
  const recharge = uses.recharge != null ? String(uses.recharge) : '';
  const allCost = Array.isArray(act.cost) ? (act.cost as Dict[]) : [];
  const extraCost = costToRows(act.mode === 'active' ? allCost.filter((c) => !isPlainActiveCost(c)) : allCost);

  const entries: DeserializedMechanics['effectEntries'] = [];
  let c = 0;
  for (const it of ((m.effects as Dict[]) || [])) {
    if (it?.resolution === 'save') {
      // eff_save_damage жёстко задаёт who:'target', один урон на провал и «половину» на успех.
      // Точно представимо только это; иначе (save-без-урона, доп. эффекты, custom on_success) → сырой JSON.
      const onFail = Array.isArray(it.on_fail) ? (it.on_fail as Dict[]) : [];
      const onSucc = Array.isArray(it.on_success) ? (it.on_success as Dict[]) : [];
      const dmg = onFail[0];
      const faithful = it.who === 'target'
        && onFail.length === 1 && dmg?.kind === 'damage'
        && onSucc.length === 1 && onSucc[0]?.kind === 'damage'
        && onSucc[0]?.dice === dmg?.dice && onSucc[0]?.type === dmg?.type && onSucc[0]?.on_success === 'half';
      if (faithful) {
        entries.push({ id: `d_${++c}`, blockId: 'eff_save_damage', values: { ability: it.ability, dc: it.dc, dice: dmg!.dice, damage_type: dmg!.type } });
      } else {
        entries.push({ id: `d_${++c}`, blockId: 'eff_raw_json', values: { json: JSON.stringify(it) } });
      }
    } else if (it?.resolution === 'attack_roll') {
      // eff_attack_damage: один ПРОСТОЙ урон на попадание (только dice+type); scaling/ability/
      // on_crit/on_miss/доп. payload'ы → сырой JSON (иначе теряли бы масштабирование каст-атак).
      const onHit = Array.isArray(it.on_hit) ? (it.on_hit as Dict[]) : [];
      const dmg = onHit[0];
      const dmgSimple = !!dmg && dmg.kind === 'damage'
        && Object.keys(dmg).every((k) => k === 'kind' || k === 'dice' || k === 'type');
      const faithful = onHit.length === 1 && dmgSimple
        && it.on_crit == null && it.on_miss == null && it.on_success == null && it.on_fail == null;
      if (faithful) {
        entries.push({ id: `d_${++c}`, blockId: 'eff_attack_damage', values: { ability: it.ability ?? 'auto', dice: dmg!.dice, damage_type: dmg!.type ?? dmg!.damage_type ?? 'slashing' } });
      } else {
        entries.push({ id: `d_${++c}`, blockId: 'eff_raw_json', values: { json: JSON.stringify(it) } });
      }
    } else if (it?.resolution === 'auto') {
      for (const p of ((it.result as Dict[]) || [])) {
        const e = payloadToEntry(p);
        entries.push({ id: `d_${++c}`, ...e });
      }
    } else if (it?.kind) {
      // Payload как самостоятельная интеракция (напр. choice с resolution on_acquire)
      entries.push({ id: `d_${++c}`, ...payloadToEntry(it) });
    } else {
      entries.push({ id: `d_${++c}`, blockId: 'eff_raw_json', values: { json: JSON.stringify(it) } });
    }
  }
  return {
    triggerId, triggerValues: tv, minLevel, itemWhile, consumesSelf, ammo, recharge, extraCost, requirements,
    targeting: jsonToTargeting(m.targeting), duration: jsonToDuration(m.duration),
    effectEntries: entries,
  };
}

// Опции для multiselect по source выбора
export function optionsForChoiceSource(source: string): RegistryItem[] {
  switch (source) {
    case 'skill': return SKILLS;
    case 'saving_throw': return ABILITIES;
    case 'language': return LANGUAGES;
    case 'feat': return ORIGIN_FEATS;
    case 'damage_type': return DAMAGE_TYPE_OPTIONS;
    case 'weapon': return WEAPON_TYPES;
    default: return [];
  }
}
