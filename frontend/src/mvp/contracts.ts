/**
 * КОНТРАКТ ДВИЖКА ДЛЯ MVP — единственный источник сигнатур для приёмочных тестов.
 *
 * Правила для исполнителя (легковесной модели):
 * 1. Реализуй модуль в frontend/src/engine/<имя>.ts и замени здесь заглушку
 *    на реэкспорт: `export { rollD20 } from '../engine/roll';`
 * 2. ТИПЫ в этом файле менять можно только вместе с обновлением
 *    docs/mvp-transition-plan.md (это протокол, на него смотрят UI и тесты).
 * 3. Тесты в src/mvp/*.mvp.test.ts НЕ редактировать под реализацию —
 *    реализация подгоняется под тесты. Исключение: явная ошибка теста,
 *    фиксируется отдельным коммитом с пояснением.
 * 4. Прогон: npm run test:mvp (цель — 0 упавших). Обычный npm test
 *    MVP-набор не включает.
 */

import type { Card } from '../types';

type Dict = Record<string, unknown>;

// ─── Фаза B: броски и протокол событий ──────────────────────────────────────

export interface RollModifier {
  value: number;
  /** Источник: «ЛВК», «владение», «Уклонение (эффект)», «Ярость»… */
  source: string;
  /** Пояснение для лога: «модификатор характеристики», «бонус мастерства»… */
  reason?: string;
}

export interface DieRoll {
  sides: number;
  result: number;
  /** true — кость отброшена (преимущество/помеха, переброс). */
  discarded?: boolean;
}

export type AdvantageState = 'none' | 'advantage' | 'disadvantage';

export interface RollLog {
  kind: 'd20' | 'damage' | 'healing' | 'check' | 'save' | 'other';
  dice: DieRoll[];
  advantage: AdvantageState;
  modifiers: RollModifier[];
  total: number;
  target?: { type: 'ac' | 'dc'; value: number };
  outcome?: 'hit' | 'miss' | 'crit' | 'crit_miss' | 'success' | 'fail';
  /** Человекочитаемая разбивка: «к20: 13 +3 [ЛВК] +2 [БМ] = 18 против КЗ 15». */
  text: string;
  /** Payload-ы, сработавшие по значению кости (on_roll-правила) — вызывающий их применяет. */
  triggered?: Record<string, unknown>[];
}

// `source` — необязательная атрибуция «кто это сделал» (напр. имя атакующего в бою). Используется
// в журнале ЦЕЛИ, чтобы показать «Тест: Урон 6 (яд)». Не влияет на механику, только на текст.
export type EngineEvent =
  | { type: 'roll'; label: string; roll: RollLog }
  | { type: 'damage'; amount: number; damageType: string; roll?: RollLog; source?: string }
  | { type: 'healing'; amount: number; roll?: RollLog; source?: string }
  | { type: 'damage_reduction'; amount: number; roll?: RollLog; source?: string }
  | { type: 'temp_hp'; amount: number; source?: string }
  | { type: 'resource_spent'; resource: string; amount: number; remaining: number }
  | { type: 'resource_restored'; resource: string; amount: number; current: number }
  | { type: 'item_consumed'; cardId: string; amount: number; remaining: number; name?: string }
  | { type: 'item_added'; cardId: string; qty: number; total: number; name?: string }
  | { type: 'effect_applied'; name: string; sourceAction?: string; source?: string }
  | { type: 'effect_expired'; name: string }
  | { type: 'condition_applied'; condition: string; source?: string }
  | { type: 'turn_started' }
  | { type: 'turn_ended' }
  | { type: 'short_rest' }
  | { type: 'long_rest' }
  | { type: 'narrative'; text: string };

export interface RollD20Options {
  advantage?: AdvantageState;
  modifiers?: RollModifier[];
  /** 20 → криты на «чистой» 20; 19 → 19–20 и т.д. */
  critRange?: number;
  /** Правила бросков (data-driven): reroll/set_die/crit_range/outcome/on_roll (см. engine/rollRules.ts).
   *  Собираются пассивами/эффектами; roll.ts применяет их к d20-броску. */
  rules?: Record<string, unknown>[];
  target?: { type: 'ac' | 'dc'; value: number };
  rng: () => number;
}

/** Детализированный результат формулы урона/лечения: каждая кость видна. */
export interface FormulaRollResult {
  total: number;
  dice: DieRoll[];
  modifiers: RollModifier[];
  text: string;
}

// ─── Фазы C/D: runtime-состояние персонажа ──────────────────────────────────

export interface ActiveEffectEntry {
  id: string;
  name: string;
  /** Унифицированная механика эффекта (payload-ы modifier/resistance/…). */
  mechanics: Dict;
  /** Осталось ходов; undefined — до снятия/отдыха. */
  roundsLeft?: number;
  /** 'start_of_next_turn' | 'end_of_turn' | 'until_rest' | 'manual' */
  expiry?: string;
  source: string;
  /** Id наложившего эффект существа (кастера). Для реляционных правил (E): Очарованный не может
   *  выбрать очаровавшего целью. undefined — источник неизвестен (ручное наложение и т.п.). */
  sourceId?: string;
}

export interface RuntimeState {
  hp: { current: number; max: number; temp: number };
  /** Текущие значения ресурсов (включая action/bonus_action/reaction как 0|1). */
  resources: Record<string, number>;
  maxResources: Record<string, number>;
  /** slot → card id (null = пусто). Слоты из EquipmentSlot. */
  equipment: Record<string, string | null>;
  /** S4 контейнеры: containerId = cardId контейнера, в котором лежит предмет (undefined = верхний уровень).
   *  Стопка различается по cardId+containerId. Идентичные контейнеры пока пулятся (без instance-id). */
  inventory: Array<{ cardId: string; qty: number; containerId?: string }>;
  activeEffects: ActiveEffectEntry[];
  /** Id triggered-эффектов, сработавших за этот ход (для uses.per:"turn"); сброс в startTurn. */
  firedThisTurn?: string[];
  /** Id triggered-эффектов, сработавших с последнего долгого отдыха (uses.per: long_rest/short_rest/…),
   *  чтобы «раз за отдых»-триггеры (Неумолимая стойкость) не срабатывали бесконечно; сброс в longRest. */
  firedThisRest?: string[];
}

export interface CharacterContext {
  abilityMods: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;
  profBonus: number;
  level: number;
  classLevels?: Record<string, number>;
  spellcastingMod?: number;
  /** Итоговая скорость (все прибавки) — для формул (character_speed) и движка. */
  characterSpeed?: number;
  /** Базовая скорость (раса + grant_speed walk, без modifier-speed) — база breakdown('speed'),
   *  добавляющего modifier-speed из passives один раз. Фолбэк на characterSpeed, если не задана. */
  baseSpeed?: number;
  /** Переменные персонажа (martial_arts_die и т.п.) для формул; см. docs/variables.md. */
  variables?: Record<string, number | { sides: number; count: number }>;
  /** Карточки экипированных предметов (для weapon/AC-конвейеров). */
  equippedCards?: Card[];
  /** Карты для резолва equipment/inventory по id (инвентарь + экипировка). */
  knownCards?: Card[];
  /** Кость хитов класса (d6, d8, …) для расчёта max HP. */
  hitDie?: string | null;
  /** recharge per ресурс: short_rest | long_rest (R4). */
  resourceRecharge?: Record<string, string>;
  /** Владения спасбросками/навыками из rule_state (для breakdown, вместо хардкодов). */
  saveProficiencies?: string[];
  skillProficiencies?: string[];
  skillExpertise?: string[];
  /** Id предметов, на которые персонаж настроен (turn_state.attuned_ids). Для гейтинга
   * магических бонусов: предмет с requires_attunement без настройки даёт только чистые статы.
   * undefined — контекст без данных о настройке (тесты) → бонусы не гейтятся. */
  attunedIds?: string[];
}

export interface TargetContext {
  ac?: number;
  saveMods?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  checkMods?: Record<string, number>;
  /** Богатая цель (фаза E): контекст характеристик цели — динамические спасброски. */
  characterContext?: CharacterContext;
  /** Рантайм цели (фаза E): состояния (projected-модификаторы) и сопротивления. */
  runtimeState?: RuntimeState;
}

export interface ExecuteContext {
  character: CharacterContext;
  /** Id исполнителя действия (кастера). Проставляется в sourceId накладываемых состояний (E). */
  selfId?: string;
  /** Триггерные способности-СЛУШАТЕЛИ (заклинания вроде Божественной кары): пул для emitEvent/реакций.
   *  В ОТЛИЧИЕ от passives их НЕ читает collectModifiers — чтобы модификатор-эффект реакции (напр. +5 КЗ
   *  Щита) не применялся пассивно до активации. */
  triggers?: Record<string, unknown>[];
  target?: TargetContext;
  rng: () => number;
  /** Выборы игрока внутри действия (напр. вариант Толчка). Ключ — сырой choice.id;
   *  значение — одна опция или массив (для count>1). Собирается предпроходом на клике. */
  choices?: Record<string, string | string[]>;
  /** Контекст каста заклинания (E5): базовый уровень и уровень слота для апкаста. */
  spell?: { baseLevel: number; castLevel?: number };
  /** Предзагруженные на листе эффекты, выдаваемые кастом через grant_effect: slug → {name, mechanics}.
   *  Движок синхронный, эффект по slug грузит лист; здесь — уже резолвнутая механика для установки
   *  «стоячего» активного эффекта (напр. Доспех мага → set_value ac_base). repeatable — повторяемый
   *  эффект накапливается (не перезаписывается) при повторной выдаче. */
  grantedEffects?: Record<string, { name?: string; mechanics?: unknown; repeatable?: boolean } | undefined>;
  /** Планирующий прогон для плана кубов: спасброски берут ветку провала, чтобы кости
   * урона попали в план (иначе при СЛ-успехе on_fail-урон не запланируется). Не для боя. */
  planning?: boolean;
  /** Форс исхода спасброска (онлайн-бой): предрасчёт результата на стороне кастера, чтобы
   * ЦЕЛЬ кинула спасбросок сама на своём листе. При заданном значении d20 НЕ катится (rng не
   * тратится — иначе съел бы кости урона) и событие спасброска не эмитится. */
  forceSaveOutcome?: 'success' | 'fail';
}

/**
 * Предложение реакции/триггера с ценой (фаза A): собирается диспетчером событий и
 * отдаётся UI, который спрашивает игрока (Automatic/Ask/Disabled) и исполняет выбранное.
 */
export interface ReactionOffer {
  listenerId: string;
  name: string;
  mechanics: Dict;
  cost: Dict[];
  event: { kind: string; timing?: string };
}

export interface ExecuteResult {
  state: RuntimeState;
  events: EngineEvent[];
  /** Реакции/триггеры со стоимостью, требующие решения игрока (фаза A). */
  pendingReactions?: ReactionOffer[];
  /** Состояние ЦЕЛИ после payload-ов who:'target' (фаза E/C2). undefined — цель без
   *  runtimeState или без изменений (лист персистит только при наличии). */
  targetState?: RuntimeState;
}

export interface WeaponContext {
  cardId: string;
  name: string;
  /** Кость основного урона, например «1d8» (зеркало damages[0].dice). */
  dice: string;
  ability: 'str' | 'dex';
  /** Тип основного урона (зеркало damages[0].type). */
  damageType: string;
  /** Все строки урона оружия: основной + стихийный (гранулярность №4). */
  damages: Array<{ dice: string; type: string }>;
  /** Магический бонус «+N» к броскам атаки и к основному урону. */
  enchant: number;
  properties: string[];
}

export interface ValueBreakdown {
  value: number;
  parts: RollModifier[];
  /** Отвергнутые методы-кандидаты (парадигма №3): показываются в превью «прочие способы». */
  rejected?: { name: string; value: number }[];
}

// ─── Реэкспорты движка (контрактные точки входа) ────────────────────────────

// Шаг B2 — engine/roll.ts
export { rollD20 } from '../engine/roll';
export { rollFormula } from '../engine/formula';

// Шаг D4/B2 — engine/modifiers.ts
export { collectRollModifiers } from '../engine/modifiers';

// Шаг C4 — engine/ac.ts
export { computeAC } from '../engine/ac';

// Шаг C5 — engine/weapon.ts
export { weaponContext } from '../engine/weapon';

// Шаг C3 — engine/equipment.ts
export { equipItem, unequipSlot, totalWeight } from '../engine/equipment';

// Шаг D2 — engine/cost.ts
export { canPay, pay } from '../engine/cost';

// Шаг D3 — engine/turn.ts
export { shortRest, startTurn, longRest } from '../engine/turn';

// Шаг D1 — engine/resources.ts
export { initResources } from '../engine/resources';

// Шаг E1–E5 — engine/execute.ts
export { executeAction } from '../engine/execute';

// Шаг F2 — engine/breakdown.ts
export { breakdownValue } from '../engine/breakdown';
