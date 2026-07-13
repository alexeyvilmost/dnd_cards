import { DAMAGE_TYPES } from '../utils/damageTypes';

export type RegistryItem = { id: string; label: string };

export const ABILITIES: RegistryItem[] = [
  { id: 'str', label: 'Сила' },
  { id: 'dex', label: 'Ловкость' },
  { id: 'con', label: 'Телосложение' },
  { id: 'int', label: 'Интеллект' },
  { id: 'wis', label: 'Мудрость' },
  { id: 'cha', label: 'Харизма' },
];

export const SKILLS: RegistryItem[] = [
  { id: 'acrobatics', label: 'Акробатика' },
  { id: 'animal_handling', label: 'Уход за животными' },
  { id: 'arcana', label: 'Магия' },
  { id: 'athletics', label: 'Атлетика' },
  { id: 'deception', label: 'Обман' },
  { id: 'history', label: 'История' },
  { id: 'insight', label: 'Проницательность' },
  { id: 'intimidation', label: 'Запугивание' },
  { id: 'investigation', label: 'Расследование' },
  { id: 'medicine', label: 'Медицина' },
  { id: 'nature', label: 'Природа' },
  { id: 'perception', label: 'Восприятие' },
  { id: 'performance', label: 'Выступление' },
  { id: 'persuasion', label: 'Убеждение' },
  { id: 'religion', label: 'Религия' },
  { id: 'sleight_of_hand', label: 'Ловкость рук' },
  { id: 'stealth', label: 'Скрытность' },
  { id: 'survival', label: 'Выживание' },
];

export const SAVING_THROWS = ABILITIES;

// Характеристика броска атаки (interaction.ability для resolution:'attack_roll').
export const ATTACK_ABILITIES: RegistryItem[] = [
  { id: 'auto', label: 'Авто (по оружию)' },
  { id: 'spellcasting', label: 'Заклинательная' },
  { id: 'dex_or_str', label: 'Ловкость или Сила' },
  ...ABILITIES,
];

// Ремесленные инструменты (PHB 2024) — домен выбора для «Ремесленника» и т.п.
export const ARTISAN_TOOLS: RegistryItem[] = [
  { id: 'alchemist', label: 'Инструменты алхимика' },
  { id: 'brewer', label: 'Пивоварные принадлежности' },
  { id: 'calligrapher', label: 'Инструменты каллиграфа' },
  { id: 'carpenter', label: 'Инструменты плотника' },
  { id: 'cartographer', label: 'Инструменты картографа' },
  { id: 'cobbler', label: 'Инструменты сапожника' },
  { id: 'cook', label: 'Кухонная утварь' },
  { id: 'glassblower', label: 'Инструменты стеклодува' },
  { id: 'jeweler', label: 'Инструменты ювелира' },
  { id: 'leatherworker', label: 'Инструменты кожевника' },
  { id: 'mason', label: 'Инструменты каменщика' },
  { id: 'painter', label: 'Инструменты художника' },
  { id: 'potter', label: 'Инструменты гончара' },
  { id: 'smith', label: 'Инструменты кузнеца' },
  { id: 'tinker', label: 'Инструменты жестянщика' },
  { id: 'weaver', label: 'Инструменты ткача' },
  { id: 'woodcarver', label: 'Инструменты резчика' },
];

// Музыкальные инструменты (PHB 2024) — домен выбора для черты «Музыкант» и т.п.
export const MUSICAL_INSTRUMENTS: RegistryItem[] = [
  { id: 'bagpipes', label: 'Волынка' },
  { id: 'drum', label: 'Барабан' },
  { id: 'dulcimer', label: 'Цимбалы' },
  { id: 'flute', label: 'Флейта' },
  { id: 'lute', label: 'Лютня' },
  { id: 'lyre', label: 'Лира' },
  { id: 'horn', label: 'Рожок' },
  { id: 'pan_flute', label: 'Пан-флейта' },
  { id: 'shawm', label: 'Шалмей' },
  { id: 'viol', label: 'Виола' },
];

export const CONDITIONS: RegistryItem[] = [
  { id: 'blinded', label: 'Ослеплён' },
  { id: 'charmed', label: 'Очарован' },
  { id: 'deafened', label: 'Оглушён' },
  { id: 'exhaustion', label: 'Истощение' },
  { id: 'frightened', label: 'Испуган' },
  { id: 'grappled', label: 'Схвачен' },
  { id: 'incapacitated', label: 'Недееспособен' },
  { id: 'invisible', label: 'Невидим' },
  { id: 'paralyzed', label: 'Парализован' },
  { id: 'petrified', label: 'Окаменел' },
  { id: 'poisoned', label: 'Отравлен' },
  { id: 'prone', label: 'Распластан' },
  { id: 'restrained', label: 'Опутан' },
  { id: 'stunned', label: 'Ошеломлён' },
  { id: 'unconscious', label: 'Без сознания' },
];

// Виды принудительного перемещения (payload.movement.value) — рантайм пока нарративный.
export const MOVEMENT_KINDS: RegistryItem[] = [
  { id: 'push', label: 'Толчок' },
  { id: 'pull', label: 'Притягивание' },
  { id: 'teleport', label: 'Телепортация' },
  { id: 'extra_speed', label: 'Доп. скорость' },
  { id: 'double', label: 'Удвоить скорость' },
  { id: 'knock_prone', label: 'Сбить с ног' },
];

export const LANGUAGES: RegistryItem[] = [
  { id: 'common', label: 'Общий' },
  { id: 'elvish', label: 'Эльфийский' },
  { id: 'dwarvish', label: 'Дварфийский' },
  { id: 'giant', label: 'Великан' },
  { id: 'gnomish', label: 'Гномий' },
  { id: 'goblin', label: 'Гоблинский' },
  { id: 'halfling', label: 'Халфлингский' },
  { id: 'orc', label: 'Орочий' },
  { id: 'abyssal', label: 'Бездны' },
  { id: 'celestial', label: 'Небесный' },
  { id: 'draconic', label: 'Драконий' },
  { id: 'infernal', label: 'Инфернальный' },
];

export const SENSES: RegistryItem[] = [
  { id: 'darkvision', label: 'Тёмное зрение' },
  { id: 'tremorsense', label: 'Чувство вибрации' },
  { id: 'blindsight', label: 'Слепозрение' },
  { id: 'truesight', label: 'Истинное зрение' },
];

export const SPEED_MODES: RegistryItem[] = [
  { id: 'walk', label: 'Ходьба' },
  { id: 'fly', label: 'Полёт' },
  { id: 'swim', label: 'Плавание' },
  { id: 'climb', label: 'Лазание' },
];

export const RESOURCES: RegistryItem[] = [
  { id: 'heroic_inspiration', label: 'Героическое вдохновение' },
  { id: 'rage_charge', label: 'Заряд ярости' },
  { id: 'giant_legacy', label: 'Наследие великанов' },
  { id: 'temp_hp', label: 'Временные хиты' },
];

export const ORIGIN_FEATS: RegistryItem[] = [
  { id: 'skilled', label: 'Одарённый' },
  { id: 'tough', label: 'Стойкий' },
  { id: 'alert', label: 'Бдительный' },
  { id: 'magic_initiate', label: 'Магически одарённый' },
  { id: 'musician', label: 'Музыкант' },
];

export const DAMAGE_TYPE_OPTIONS: RegistryItem[] = DAMAGE_TYPES.map((d) => ({
  id: d.value,
  label: d.label,
}));

export const ACTIVE_RESOURCES: RegistryItem[] = [
  { id: 'action', label: 'Действие' },
  { id: 'bonus_action', label: 'Бонусное действие' },
  { id: 'reaction', label: 'Ответное действие' },
  { id: 'rage_charge', label: 'Заряд ярости' },
  { id: 'giant_legacy', label: 'Наследие великанов' },
];

export const USES_PER: RegistryItem[] = [
  { id: 'long_rest', label: 'Длинный отдых' },
  { id: 'short_rest', label: 'Короткий отдых' },
];

// События триггера ($defs/trigger.event). Помечаем ⏳ те, что движок пока НЕ эмитит
// (в JSON допустимы, но слушатель никогда не сработает) — см. execute.EMITTED_EVENTS.
const EMITTED_EVENTS = new Set([
  'hit', 'crit', 'miss', 'damage_taken', 'spell_cast', 'reduced_to_0_hp',
  'turn_start', 'turn_end', 'short_rest', 'long_rest',
]);
const RAW_TRIGGER_EVENTS: RegistryItem[] = [
  { id: 'hit', label: 'Попадание (вы попали)' },
  { id: 'crit', label: 'Критическое попадание' },
  { id: 'miss', label: 'Промах' },
  { id: 'damage_taken', label: 'Получен урон' },
  { id: 'damage_dealt', label: 'Нанесён урон' },
  { id: 'attack_roll_made', label: 'Сделан бросок атаки' },
  { id: 'saving_throw_made', label: 'Сделан спасбросок' },
  { id: 'forced_save', label: 'Вынужденный спасбросок' },
  { id: 'ability_check_made', label: 'Сделана проверка' },
  { id: 'reduced_to_0_hp', label: 'Падение до 0 хитов' },
  { id: 'creature_enters_reach', label: 'Существо входит в досягаемость' },
  { id: 'creature_leaves_reach', label: 'Существо выходит из досягаемости' },
  { id: 'creature_moves', label: 'Существо перемещается' },
  { id: 'turn_start', label: 'Начало хода' },
  { id: 'turn_end', label: 'Конец хода' },
  { id: 'spell_cast', label: 'Заклинание сотворено' },
  { id: 'condition_applied', label: 'Наложено состояние' },
  { id: 'initiative_roll', label: 'Бросок инициативы' },
  { id: 'short_rest', label: 'Короткий отдых' },
  { id: 'long_rest', label: 'Длинный отдых' },
  { id: 'on_acquire', label: 'При получении' },
  { id: 'level_gained', label: 'Получен уровень' },
];
export const TRIGGER_EVENTS: RegistryItem[] = RAW_TRIGGER_EVENTS.map((e) =>
  EMITTED_EVENTS.has(e.id) ? e : { ...e, label: `${e.label} ⏳` },
);

export const TRIGGER_TIMINGS: RegistryItem[] = [
  { id: 'before', label: 'До' },
  { id: 'during', label: 'Во время' },
  { id: 'after', label: 'После' },
  { id: 'replaces', label: 'Вместо (замена)' },
];

// Субъект триггера. Движок пока НЕ фильтрует по subject (dispatch.ts) — помечаем ⏳.
export const TRIGGER_SUBJECTS: RegistryItem[] = [
  { id: '', label: 'Любой' },
  { id: 'self', label: 'Вы ⏳' },
  { id: 'ally', label: 'Союзник ⏳' },
  { id: 'enemy', label: 'Враг ⏳' },
  { id: 'attacker', label: 'Атакующий ⏳' },
  { id: 'target', label: 'Цель ⏳' },
  { id: 'any_creature', label: 'Любое существо ⏳' },
];

export const TRIGGER_MODES: RegistryItem[] = [
  { id: 'triggered', label: 'Срабатывает автоматически' },
  { id: 'reaction', label: 'Реакция (ответное действие)' },
];

export const ROLL_TARGETS: RegistryItem[] = [
  { id: 'attack_roll', label: 'Бросок атаки' },
  { id: 'ability_check', label: 'Проверка характеристики' },
  { id: 'saving_throw', label: 'Спасбросок' },
  { id: 'max_hp', label: 'Макс. хиты' },
  { id: 'ac', label: 'КД' },
  { id: 'speed', label: 'Скорость' },
];

// Типы требований ($defs/requirement.type) кроме level (тот задаётся полем «Мин. уровень»).
// Движок пока НЕ проверяет requirements[] в рантайме — это словарь для будущей реализации.
export const REQUIREMENT_TYPES: RegistryItem[] = [
  { id: 'class', label: 'Класс' },
  { id: 'subclass', label: 'Подкласс' },
  { id: 'species', label: 'Вид' },
  { id: 'feat', label: 'Черта' },
  { id: 'ability_score', label: 'Значение характеристики' },
  { id: 'proficiency', label: 'Владение' },
  { id: 'equipment', label: 'Снаряжение' },
  { id: 'resource', label: 'Ресурс' },
  { id: 'state', label: 'Состояние' },
];

// Операции модификатора (payload.modifier.op) — алгебра C5 (foldModifiers).
export const MODIFIER_OPS: RegistryItem[] = [
  { id: 'add', label: 'Прибавить (+)' },
  { id: 'set', label: 'Установить (=)' },
  { id: 'multiply', label: 'Умножить (×)' },
  { id: 'upgrade', label: 'Повысить (не ниже)' },
  { id: 'downgrade', label: 'Понизить (не выше)' },
];

// Область модификатора (payload.modifier.scope): себе или проекция против атакующего цель.
export const MODIFIER_SCOPES: RegistryItem[] = [
  { id: 'self', label: 'Себе' },
  { id: 'target', label: 'Против цели (проецируется)' },
];

export const CHOICE_SOURCES: RegistryItem[] = [
  { id: 'skill', label: 'Навык' },
  { id: 'tool', label: 'Инструмент' },
  { id: 'saving_throw', label: 'Спасбросок' },
  { id: 'language', label: 'Язык' },
  { id: 'feat', label: 'Черта' },
  { id: 'spell', label: 'Заклинание' },
  { id: 'damage_type', label: 'Тип урона' },
  { id: 'subfeature', label: 'Подвариант' },
  { id: 'explicit', label: 'Явный список' },
  { id: 'effect', label: 'Эффект (бусины)' },
];

// Наведение (mechanics.targeting) — движок пока НЕ интерпретирует (описательно, ⏳).
export const TARGETING_SHAPES: RegistryItem[] = [
  { id: '', label: '—' },
  { id: 'self', label: 'На себя' },
  { id: 'single', label: 'Одна цель' },
  { id: 'multi', label: 'Несколько целей' },
  { id: 'area', label: 'Область' },
  { id: 'aura', label: 'Аура' },
];
export const AREA_KINDS: RegistryItem[] = [
  { id: '', label: '—' },
  { id: 'sphere', label: 'Сфера' },
  { id: 'cube', label: 'Куб' },
  { id: 'cone', label: 'Конус' },
  { id: 'line', label: 'Линия' },
  { id: 'cylinder', label: 'Цилиндр' },
  { id: 'emanation', label: 'Эманация' },
];

// Длительность (mechanics.duration) — rounds/until_*_of_turn движок применяет; прочее описательно (⏳).
export const DURATION_TYPES: RegistryItem[] = [
  { id: '', label: '—' },
  { id: 'instantaneous', label: 'Мгновенная' },
  { id: 'rounds', label: 'Раунды' },
  { id: 'minutes', label: 'Минуты ⏳' },
  { id: 'hours', label: 'Часы ⏳' },
  { id: 'while_active', label: 'Пока активно ⏳' },
  { id: 'until_long_rest', label: 'До длинного отдыха ⏳' },
  { id: 'until_dispelled', label: 'Пока не рассеяно ⏳' },
  { id: 'permanent', label: 'Постоянная ⏳' },
  { id: 'until_start_of_next_turn', label: 'До начала след. хода' },
  { id: 'until_end_of_turn', label: 'До конца хода' },
];

export const labelOf = (items: RegistryItem[], id?: string) =>
  items.find((i) => i.id === id)?.label || id || '';

// Соответствие навык → характеристика (для расчёта бонусов навыков)
export const SKILL_ABILITY: Record<string, string> = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
};

export const abilityOfSkill = (skill: string): string => SKILL_ABILITY[skill] || 'str';

export function optionsForChoiceSource(source: string): RegistryItem[] {
  switch (source) {
    case 'ability':
      return ABILITIES;
    case 'instrument':
      return MUSICAL_INSTRUMENTS;
    case 'artisan_tool':
      return ARTISAN_TOOLS;
    case 'skill':
      return SKILLS;
    case 'tool':
      return [
        { id: 'thieves_tools', label: 'Воровские инструменты' },
        { id: 'disguise_kit', label: 'Набор для маскировки' },
        { id: 'musical_instrument', label: 'Музыкальный инструмент' },
        { id: 'artisan_tool', label: 'Ремесленный инструмент' },
      ];
    case 'saving_throw':
      return SAVING_THROWS;
    case 'language':
      return LANGUAGES;
    case 'feat':
      return ORIGIN_FEATS;
    case 'damage_type':
      return DAMAGE_TYPE_OPTIONS;
    default:
      return [];
  }
}
