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
  { id: 'charmed', label: 'Очарован' },
  { id: 'frightened', label: 'Испуган' },
  { id: 'poisoned', label: 'Отравлен' },
  { id: 'paralyzed', label: 'Парализован' },
  { id: 'stunned', label: 'Ошеломлён' },
  { id: 'prone', label: 'Распластан' },
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
];

export const USES_PER: RegistryItem[] = [
  { id: 'long_rest', label: 'Длинный отдых' },
  { id: 'short_rest', label: 'Короткий отдых' },
];

export const ROLL_TARGETS: RegistryItem[] = [
  { id: 'attack_roll', label: 'Бросок атаки' },
  { id: 'ability_check', label: 'Проверка характеристики' },
  { id: 'saving_throw', label: 'Спасбросок' },
  { id: 'max_hp', label: 'Макс. хиты' },
  { id: 'ac', label: 'КД' },
  { id: 'speed', label: 'Скорость' },
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
