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
  /** Semantic role for presentation. It comes from the mechanics primitive (or
   *  an unambiguous formula such as `prof_bonus`), never an entity name/id. */
  kind?: 'base' | 'ability' | 'proficiency' | 'expertise' | 'effect';
}

export interface DieRoll {
  sides: number;
  result: number;
  /** true — кость отброшена (преимущество/помеха, переброс). */
  discarded?: boolean;
  /** Источник дополнительной кости (Наставление, Защита от оружия и т.п.). */
  source?: string;
  /** −1 означает, что дополнительная кость вычитается из результата. */
  sign?: 1 | -1;
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
  /** A conditional after-failure die was actually rolled and must be consumed. */
  usedFailureBonus?: true;
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
  | {
      type: 'condition_immune';
      condition: string;
      sourceEntityIds: string[];
      source?: string;
    }
  /** Geometry adapter consumes this authoritative forced-movement result. */
  | { type: 'movement'; mode: string; distanceFt: number; source?: string }
  | { type: 'stabilized'; source?: string }
  | {
      type: 'world_interaction';
      operation: string;
      parameters: Dict;
      source?: string;
    }
  | {
      type: 'communication';
      mode: 'message' | 'reply';
      sourceActorId?: string;
      targetActorId?: string;
      private: true;
    }
  | { type: 'turn_started' }
  | { type: 'turn_ended' }
  | { type: 'short_rest' }
  | { type: 'long_rest' }
  | {
    type: 'narrative';
    text: string;
    /** Structured audit for resistance/immunity/vulnerability; UI text is not authoritative. */
    damageAdjustment?: {
      damageType: string;
      adjustment: 'resistance' | 'immunity' | 'vulnerability';
      before: number;
      after: number;
      sourceEntityIds: string[];
    };
  };

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
  /** Stable library identity of the effect that produced this runtime entry.
   * Mechanics stay self-contained while the UI loads the real data-owned card. */
  entityRef?: {
    kind: 'effect';
    id: string;
    cardNumber?: string;
  };
  /** Id существа-владельца, в чьём RuntimeState сериализован эффект. */
  ownerId?: string;
  /** Id наложившего эффект существа (кастера). Для реляционных правил и source-turn lifecycle. */
  sourceId?: string;
  /**
   * PHB durations expressed relative to the source's next turn. End-boundary
   * effects are armed at that turn's start so they cannot expire on the turn
   * in which they were created.
   */
  sourceTurnExpiry?: {
    sourceActorId: string;
    ownerActorId: string;
    boundary: 'start' | 'end';
    armed?: true;
  };
}

/** Persisted creature lifecycle facts used by death saves and stabilization. */
export interface DeathSaveState {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
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
  /** Character-sheet lifecycle state. Monsters may omit it until they reach 0 HP. */
  deathSaves?: DeathSaveState;
  /** Id triggered-эффектов, сработавших за этот ход (для uses.per:"turn"); сброс в startTurn. */
  firedThisTurn?: string[];
  /** Id triggered-эффектов, сработавших с последнего долгого отдыха (uses.per: long_rest/short_rest/…),
   *  чтобы «раз за отдых»-триггеры (Неумолимая стойкость) не срабатывали бесконечно; сброс в longRest. */
  firedThisRest?: string[];
}

export interface ResourceRestRecovery {
  short_rest: { mode: 'fixed'; amount: number };
  long_rest: { mode: 'full' };
}

export interface CharacterContext {
  /** Canonical creature type used by source/target-filtered mechanics. A subtype
   * may follow a colon (for example `fiend:devil`); broad filters match either
   * the exact value or its prefix. Missing data always fails closed. */
  creatureType?: string;
  /** Итоговые значения характеристик после всех постоянных источников. */
  abilityScores?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  abilityMods: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;
  /** Источники итоговых характеристик, собранные резолвером листа. */
  abilitySources?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', RollModifier[]>>;
  /** Альтернативные методы расчёта характеристик (например, value_method). */
  abilityMethods?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', { value: number; name: string; reason: string }[]>>;
  profBonus: number;
  level: number;
  classLevels?: Record<string, number>;
  spellcastingMod?: number;
  /** Характеристика заклинаний нужна для понятного breakdown СЛ и атаки. */
  spellcastingAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  /** Итоговая скорость (все прибавки) — для формул (character_speed) и движка. */
  characterSpeed?: number;
  /** Базовая скорость (раса + grant_speed walk, без modifier-speed) — база breakdown('speed'),
   *  добавляющего modifier-speed из passives один раз. Фолбэк на characterSpeed, если не задана. */
  baseSpeed?: number;
  /** Базовый размер (числовая категория, раса). breakdown('size') добавляет временные size-модификаторы
   *  (Большая форма). Используется для грузоподъёмности (Мощное телосложение) и будущего боя. */
  baseSize?: number;
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
  /**
   * Явная recovery-политика ресурса. Отсутствующий ключ сохраняет legacy
   * semantics `resourceRecharge`; null означает невалидные mechanics и запрещает
   * восстановление fail-closed. Сейчас materializes mechanics.uses.recovery.
   */
  resourceRecovery?: Record<string, ResourceRestRecovery | null>;
  /** Владения спасбросками/навыками/оружием из rule_state (для breakdown и атак). */
  saveProficiencies?: string[];
  skillProficiencies?: string[];
  skillExpertise?: string[];
  /**
   * Категории или конкретные виды оружия из CharacterRuleState.  undefined
   * означает legacy-контекст без проекции; [] означает явно отсутствие владений.
   */
  weaponProficiencies?: string[];
  /** Categories currently worn without armor training. Empty means the
   * resolver verified the equipped armor; undefined is a legacy context. */
  untrainedArmorCategories?: string[];
  /** Id предметов, на которые персонаж настроен (turn_state.attuned_ids). Для гейтинга
   * бонусов из mechanics.weapon_profile.attunement: требующий настройки предмет без неё
   * даёт только базовые свойства. undefined — неизвестный факт и отключает бонусы fail-closed. */
  attunedIds?: string[];
  /** Искусность (Weapon Mastery, PHB 2024): ВЫБРАННЫЕ виды оружия (card.weapon_type: longsword…).
   * Свойство искусности оружия работает, только если его вид здесь. undefined/[] — искусности нет
   * (нет классовой особенности либо выбор не сделан) → мастерство не применяется. */
  weaponMasteries?: string[];
}

export interface TargetContext {
  /** Stable world actor id used by persisted cross-actor effect ownership. */
  id?: string;
  /** Tiny=0, Small=1, Medium=2, Large=3, Huge=4, Gargantuan=5. */
  size?: number;
  ac?: number;
  saveMods?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  checkMods?: Record<string, number>;
  /** Богатая цель (фаза E): контекст характеристик цели — динамические спасброски. */
  characterContext?: CharacterContext;
  /** Рантайм цели (фаза E): состояния (projected-модификаторы) и сопротивления. */
  runtimeState?: RuntimeState;
  /** Compiled target-owned passives used by damage adjustment and other target rules. */
  passives?: Dict[];
  /** Target-owned immunities used when an action routes a condition to it. */
  conditionImmunities?: ConditionImmunityContext[];
  /** Explicit rest trait used by effects whose save succeeds automatically
   * for creatures that do not sleep (Sleep is the PHB 2024 example). */
  sleepRequired?: boolean;
  /** Immutable entities that established the target's no-sleep trait. */
  sleepTraitSourceEntityIds?: string[];
  /** Board-owned relationship to the acting creature for relational save rules. */
  relationToSource?: 'self' | 'ally' | 'enemy' | 'neutral';
}

export interface ConditionImmunityContext {
  condition: string;
  requiredCauseTags?: string[];
  sourceCreatureTypes?: string[];
  sourceEntityIds: string[];
}

/** Canonical spell components copied from immutable content, never from UI facts. */
export interface SpellComponents {
  verbal: boolean;
  somatic: boolean;
  material: boolean;
}

/** Authoritative spell context retained by serializable rules continuations. */
export interface SpellCastContext {
  baseLevel: number;
  castLevel?: number;
  sourceClass?: string;
  components?: SpellComponents;
  /** Immutable actor-owned grant selected for this cast. */
  grantId?: string;
  /** Class, feat, lineage, or invocation that owns the selected grant. */
  sourceId?: string;
  /** Source-specific ability; it may differ from the actor's class default. */
  spellcastingAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  mode?: 'normal' | 'ritual';
  payment?: { kind: 'none' | 'free_use' | 'slot'; resource?: string };
}

export interface ExecuteContext {
  character: CharacterContext;
  /** Immutable catalog display name for effects and audit events. */
  actionName?: string;
  /** Compiled always-on and triggered rules owned by the acting creature. */
  passives?: Dict[];
  /** Actor-owned immunities used when a payload applies a condition to self. */
  conditionImmunities?: ConditionImmunityContext[];
  /** Runtime of the acting creature, used by caster-scoped derived values such as spell save DC. */
  selfRuntime?: RuntimeState;
  /** Id исполнителя действия (кастера). Проставляется в sourceId накладываемых состояний (E). */
  selfId?: string;
  /** Persisted Attack-action identity available to typed follow-up primitives. */
  attackActionId?: string;
  /** Stable command that opened the current attack resolution. */
  attackCommandId?: string;
  /** Триггерные способности-СЛУШАТЕЛИ (заклинания вроде Божественной кары): пул для emitEvent/реакций.
   *  В ОТЛИЧИЕ от passives их НЕ читает collectModifiers — чтобы модификатор-эффект реакции (напр. +5 КЗ
   *  Щита) не применялся пассивно до активации. */
  triggers?: Record<string, unknown>[];
  target?: TargetContext;
  /** Explicit board/GM facts for rules that need relationships but not full geometry. */
  attackFacts?: {
    nearbyEligibleAllyToTarget?: boolean;
  };
  /** Explicit board/GM observations keyed by the stable actor that imposed a
   * relational condition. Required by source-aware rules such as Frightened. */
  conditionSourceFacts?: Record<string, { lineOfSight: boolean }>;
  /** Explicit actor relationships consumed by generic condition predicates.
   * Distances are in feet; visibility is directed observer -> observed actor. */
  conditionRelationFacts?: {
    distancesFt?: Record<string, Record<string, number>>;
    visibility?: Record<string, Record<string, boolean>>;
  };
  rng: () => number;
  /**
   * Optional dedicated tape for damage dice. Area continuations replay this
   * tape from the beginning for every target, implementing one shared damage
   * roll without coupling it to saving throws or spell-cast listeners.
   */
  damageRng?: () => number;
  /**
   * Factory for identifiers that become part of persisted runtime state.
   * Canonical rules sessions always provide it so equal state/command/RNG
   * inputs produce byte-identical events. Legacy callers may omit it during
   * migration and retain the historical timestamp based identifiers.
   */
  nextId?: () => string;
  /** Canonical continuation support: stop after the attack roll is known. */
  pauseAfterAttackRoll?: boolean;
  /** Reuse an already committed attack roll when a reaction window resumes. */
  forcedAttackRoll?: RollLog;
  /** Выборы игрока внутри действия (напр. вариант Толчка). Ключ — сырой choice.id;
   *  значение — одна опция или массив (для count>1). Собирается предпроходом на клике. */
  choices?: Record<string, string | string[]>;
  /** Контекст каста заклинания (E5), включая канонические компоненты из каталога. */
  spell?: SpellCastContext;
  /**
   * Explicit authority hand-off from canonical rules-core after it has
   * validated and applied `mechanics.primitive`. Ordinary browser/legacy
   * callers must omit this marker, so they cannot pay for only the legacy
   * `effects` half of a world primitive.
   */
  externalPrimitiveHandled?: true;
  /**
   * Keep spell metadata for formulas while suppressing the once-per-cast
   * lifecycle event when a multi-target action resumes for another creature.
   */
  suppressSpellCastEvent?: boolean;
  /** Предзагруженные на листе эффекты, выдаваемые кастом через grant_effect: slug → {name, mechanics}.
   *  Движок синхронный, эффект по slug грузит лист; здесь — уже резолвнутая механика для установки
   *  «стоячего» активного эффекта (напр. Доспех мага → set_value ac_base). repeatable — повторяемый
   *  эффект накапливается (не перезаписывается) при повторной выдаче. */
  grantedEffects?: Record<string, {
    id?: string;
    card_number?: string;
    name?: string;
    mechanics?: unknown;
    repeatable?: boolean;
  } | undefined>;
  /** Предзагруженные эффекты-мастерства (Weapon Mastery 2024): id эффекта → {name, mechanics}.
   *  Ключ — card.mastery оружия. Движок синхронный, поэтому механику мастерства (как и grantedEffects)
   *  резолвит лист/бой заранее. Без этой карты мастерство молча не сработает. */
  masteryEffects?: Record<string, { name?: string; mechanics?: unknown } | undefined>;
  /** Модификатор характеристики атаки текущим оружием → формульный токен weapon_mod.
   *  Проставляется движком на прогоне механики искусности (СЛ Опрокидывающего, урон Задевающего). */
  weaponMod?: number;
  /** Планирующий прогон для плана кубов: спасброски берут ветку провала, чтобы кости
   * урона попали в план (иначе при СЛ-успехе on_fail-урон не запланируется). Не для боя. */
  planning?: boolean;
  /** Форс исхода спасброска (онлайн-бой): предрасчёт результата на стороне кастера, чтобы
   * ЦЕЛЬ кинула спасбросок сама на своём листе. При заданном значении d20 НЕ катится (rng не
   * тратится — иначе съел бы кости урона) и событие спасброска не эмитится. */
  forceSaveOutcome?: 'success' | 'fail';
  /**
   * Stop before a nested target saving throw and return a serializable offer.
   * The caller commits effects that happened before the save, then lets the
   * target resolve the offer in a separate authoritative command.
   */
  deferTargetSaves?: boolean;
  /** Canonical source metadata attached by a nested rules primitive. */
  deferredSaveSource?: {
    kind: 'weapon_mastery' | 'nested_effect';
    entityId: string;
    name: string;
    weaponMod?: number;
  };
}

export interface DeferredTargetSave {
  source: {
    kind: 'weapon_mastery' | 'nested_effect';
    entityId: string;
    name: string;
    weaponMod?: number;
  };
  /** Canonical save interaction; no client-provided mechanics are accepted. */
  effect: Dict;
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  dc: number;
  avoidsConditions: string[];
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
  /** Nested target saves paused before any target roll or consequence. */
  deferredTargetSaves?: DeferredTargetSave[];
  /** Состояние ЦЕЛИ после payload-ов who:'target' (фаза E/C2). undefined — цель без
   *  runtimeState или без изменений (лист персистит только при наличии). */
  targetState?: RuntimeState;
}

export interface WeaponContext {
  cardId: string;
  name: string;
  /** Кость основного урона, например «1d8» (зеркало damages[0].dice). */
  dice: string;
  ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  /** Тип основного урона (зеркало damages[0].type). */
  damageType: string;
  /** Все строки урона оружия: основной + стихийный (гранулярность №4). */
  damages: Array<{ dice: string; type: string }>;
  /** Магический бонус «+N» к броскам атаки и к основному урону. */
  enchant: number;
  /** Explicit mechanics.weapon_profile enchantment projections. */
  attackEnchant: number;
  damageEnchant: number;
  properties: string[];
  heavyRule?: {
    minimumAbilityScore: number;
    abilityByMode: { melee: 'str'; ranged: 'dex' };
    consequence: 'attack_disadvantage';
  };
  /** Вид оружия (longsword, scimitar…) — по нему гейтится искусность (выбор персонажа). */
  weaponType?: string | null;
  proficiencyCategory: 'simple' | 'martial';
  defaultAttackMode: 'melee' | 'ranged';
  attackModes: Array<
    | { kind: 'melee'; reachFt: number }
    | { kind: 'ranged'; normalFt: number; longFt: number }
  >;
  /** Свойство искусности (Weapon Mastery 2024): id эффекта-мастерства из card.mastery. */
  mastery?: string | null;
}

export interface ValueBreakdown {
  value: number;
  parts: RollModifier[];
  /** Выбранный способ расчёта, если значение допускает несколько методов. */
  selectedMethod?: { name: string; reason: string; value?: number };
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
export { shortRest, spendHitDie, startTurn, longRest } from '../engine/turn';

// Шаг D1 — engine/resources.ts
export { initResources } from '../engine/resources';

// Шаг E1–E5 — engine/execute.ts
export { executeAction } from '../engine/execute';

// Шаг F2 — engine/breakdown.ts
export { breakdownValue } from '../engine/breakdown';
