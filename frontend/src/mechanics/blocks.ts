import type { ChoiceOptions, Payload } from './types';
import type { RegistryItem } from './registries';
import { normalizeWhen, type Cond } from './predicates';
import {
  ABILITIES,
  ACTIVE_RESOURCES,
  CHOICE_SOURCES,
  DAMAGE_TYPE_OPTIONS,
  LANGUAGES,
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
  | { key: string; label: string; type: 'damage-type'; default?: string };

/** Собрать массив условий из значения блока (undefined → []). */
const whenOf = (v: unknown): Cond[] => (Array.isArray(v) ? (v as Cond[]) : []);

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
      if (r.ability) out.ability = r.ability;
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
    ],
    defaults: { ability: 'int', level_gate: 1 },
    build: (v) => ({ kind: 'grant_spell', value: v.value, ability: v.ability, level_gate: Number(v.level_gate) || 1 }),
    summary: (v) => `Заклинание ${v.value} (ур.${v.level_gate}, ${labelOf(ABILITIES, String(v.ability))})`,
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
      { key: 'when', label: 'Условия (когда действует)', type: 'when' },
    ],
    defaults: { roll: 'saving_throw', op: 'advantage' },
    build: (v) => ({
      kind: 'modifier',
      applies_to: { roll: v.roll },
      op: v.op,
      when: whenOf(v.when),
    }),
    summary: (v) => `${v.op === 'advantage' ? 'Преим.' : 'Помеха'} на ${labelOf(ROLL_TARGETS, String(v.roll))}${whenOf(v.when).length ? ' (при условии)' : ''}`,
  },
  {
    id: 'eff_bonus',
    label: 'Числовой бонус',
    group: 'effect',
    fields: [
      { key: 'roll', label: 'Цель', type: 'select', options: ROLL_TARGETS, default: 'max_hp' },
      { key: 'value', label: 'Формула/значение', type: 'formula', default: 'self_level' },
      { key: 'when', label: 'Условия (когда действует)', type: 'when' },
    ],
    defaults: { roll: 'max_hp', value: 'self_level' },
    build: (v) => {
      const when = whenOf(v.when);
      return { kind: 'modifier', applies_to: { roll: v.roll }, op: 'add', value: v.value, ...(when.length ? { when } : {}) };
    },
    summary: (v) => `+${v.value} к ${labelOf(ROLL_TARGETS, String(v.roll))}${whenOf(v.when).length ? ' (при условии)' : ''}`,
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
      { key: 'target', label: 'Цель', type: 'select', options: [{ id: 'hp', label: 'Хиты' }], default: 'hp' },
      { key: 'formula', label: 'Значение', type: 'formula', default: '1' },
    ],
    defaults: { target: 'hp', formula: '1' },
    build: (v) => ({ kind: 'set_value', target: v.target, formula: v.formula }),
    summary: (v) => `${v.target} = ${v.formula}`,
  },
  {
    id: 'eff_transform',
    label: 'Преображение',
    group: 'effect',
    fields: [{ key: 'description', label: 'Описание', type: 'text' }],
    build: (v) => ({ kind: 'narrative', description: v.description || 'Преображение' }),
    summary: (v) => `Преображение: ${v.description || '…'}`,
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
  return {
    id: choice.id,
    prompt: choice.prompt,
    count: choice.count ?? 1,
    source: opts.source || 'skill',
    filter: opts.filter ?? 'all',
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
    case 'grant_spell': return { blockId: 'eff_grant_spell', values: { value: p.value, ability: p.ability, level_gate: p.level_gate ?? 1 } };
    case 'grant_sense': return { blockId: 'eff_grant_sense', values: { sense: p.sense, range: p.range ?? 60 } };
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
    case 'set_value': return { blockId: 'eff_set_value', values: { target: p.target, formula: p.formula } };
    case 'narrative': return { blockId: 'eff_narrative', values: { description: p.description } };
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
      const hasFilter = !!at.filter && Object.keys(at.filter as Dict).length > 0;
      // Любой набор условий `when` теперь round-trip'ится через WhenEditor (легаси
      // {kind:'condition'} нормализуется в you_have_condition). Фильтр applies_to пока → сырой JSON.
      const when = normalizeWhen(p.when);
      if (p.op === 'advantage' || p.op === 'disadvantage') {
        return hasFilter ? raw() : { blockId: 'eff_adv', values: { roll: at.roll, op: p.op, when } };
      }
      if (p.op === 'add') {
        return hasFilter ? raw() : { blockId: 'eff_bonus', values: { roll: at.roll, value: p.value, when } };
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
    const simple = !hasSubject && circ.length === 0;
    if (isD20One && !hasSubject) {
      triggerId = 'trg_d20_one';
      tv.event = ev;
    } else if (ev === 'on_acquire' && simple) triggerId = 'trg_on_acquire';
    else if (ev === 'long_rest' && simple) triggerId = 'trg_long_rest';
    else if (ev === 'short_rest' && simple) triggerId = 'trg_short_rest';
    else if (ev === 'reduced_to_0_hp' && !hasSubject && circ.length === 0) {
      triggerId = 'trg_zero_hp';
      tv.uses_count = uses.count ?? 1;
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
      const dmg = ((it.on_fail as Dict[]) || []).find((p) => p.kind === 'damage') || {};
      entries.push({ id: `d_${++c}`, blockId: 'eff_save_damage', values: { ability: it.ability, dc: it.dc, dice: dmg.dice ?? '1d10', damage_type: dmg.type ?? 'fire' } });
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
  return { triggerId, triggerValues: tv, minLevel, itemWhile, consumesSelf, ammo, recharge, extraCost, requirements, effectEntries: entries };
}

// Опции для multiselect по source выбора
export function optionsForChoiceSource(source: string): RegistryItem[] {
  switch (source) {
    case 'skill': return SKILLS;
    case 'saving_throw': return ABILITIES;
    case 'language': return LANGUAGES;
    case 'feat': return ORIGIN_FEATS;
    case 'damage_type': return DAMAGE_TYPE_OPTIONS;
    default: return [];
  }
}
