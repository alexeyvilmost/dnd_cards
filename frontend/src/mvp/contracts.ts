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
  outcome?: 'hit' | 'miss' | 'crit' | 'success' | 'fail';
  /** Человекочитаемая разбивка: «к20: 13 +3 [ЛВК] +2 [БМ] = 18 против КЗ 15». */
  text: string;
}

export type EngineEvent =
  | { type: 'roll'; label: string; roll: RollLog }
  | { type: 'damage'; amount: number; damageType: string; roll?: RollLog }
  | { type: 'healing'; amount: number; roll?: RollLog }
  | { type: 'temp_hp'; amount: number }
  | { type: 'resource_spent'; resource: string; amount: number; remaining: number }
  | { type: 'resource_restored'; resource: string; amount: number; current: number }
  | { type: 'effect_applied'; name: string; sourceAction?: string }
  | { type: 'effect_expired'; name: string }
  | { type: 'condition_applied'; condition: string }
  | { type: 'turn_started' }
  | { type: 'short_rest' }
  | { type: 'long_rest' }
  | { type: 'narrative'; text: string };

export interface RollD20Options {
  advantage?: AdvantageState;
  modifiers?: RollModifier[];
  /** 20 → криты на «чистой» 20; 19 → 19–20 и т.д. */
  critRange?: number;
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
}

export interface RuntimeState {
  hp: { current: number; max: number; temp: number };
  /** Текущие значения ресурсов (включая action/bonus_action/reaction как 0|1). */
  resources: Record<string, number>;
  maxResources: Record<string, number>;
  /** slot → card id (null = пусто). Слоты из EquipmentSlot. */
  equipment: Record<string, string | null>;
  inventory: Array<{ cardId: string; qty: number }>;
  activeEffects: ActiveEffectEntry[];
}

export interface CharacterContext {
  abilityMods: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>;
  profBonus: number;
  level: number;
  classLevels?: Record<string, number>;
  spellcastingMod?: number;
  characterSpeed?: number;
  /** Карточки экипированных предметов (для weapon/AC-конвейеров). */
  equippedCards?: Card[];
}

export interface TargetContext {
  ac?: number;
  saveMods?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  checkMods?: Record<string, number>;
}

export interface ExecuteContext {
  character: CharacterContext;
  target?: TargetContext;
  rng: () => number;
  /** Выборы игрока внутри действия (напр. вариант Толчка). */
  choices?: Record<string, string>;
}

export interface ExecuteResult {
  state: RuntimeState;
  events: EngineEvent[];
}

export interface WeaponContext {
  cardId: string;
  name: string;
  /** Кость урона, например «1d8». */
  dice: string;
  ability: 'str' | 'dex';
  damageType: string;
  properties: string[];
}

export interface ValueBreakdown {
  value: number;
  parts: RollModifier[];
}

// ─── Заглушки (заменять реэкспортами по мере реализации) ────────────────────

const NOT_IMPLEMENTED = (step: string, name: string): never => {
  throw new Error(`NOT_IMPLEMENTED [${step}] ${name} — см. docs/mvp-transition-plan.md`);
};

// Шаг B2 — engine/roll.ts
export function rollD20(_opts: RollD20Options): RollLog {
  return NOT_IMPLEMENTED('B2', 'rollD20');
}
export function rollFormula(
  _formula: string,
  _ctx: Dict,
  _opts?: { modifiers?: RollModifier[]; rng?: () => number },
): FormulaRollResult {
  return NOT_IMPLEMENTED('B2', 'rollFormula');
}

// Шаг D4/B2 — engine/modifiers.ts: собрать модификаторы и адвантаж
// из активных эффектов и пассивок для броска applies_to.roll.
export function collectRollModifiers(
  _state: RuntimeState,
  _passives: Dict[],
  _appliesTo: { roll: string; filter?: Dict },
): { modifiers: RollModifier[]; advantage: AdvantageState } {
  return NOT_IMPLEMENTED('D4', 'collectRollModifiers');
}

// Шаг C4 — engine/ac.ts
export function computeAC(_character: CharacterContext, _state: RuntimeState, _passives: Dict[]): ValueBreakdown {
  return NOT_IMPLEMENTED('C4', 'computeAC');
}

// Шаг C5 — engine/weapon.ts
export function weaponContext(
  _character: CharacterContext,
  _hand: 'main' | 'off',
): WeaponContext | null {
  return NOT_IMPLEMENTED('C5', 'weaponContext');
}

// Шаг C3 — engine/equipment.ts
export function equipItem(_state: RuntimeState, _card: Card): { state: RuntimeState; error?: string } {
  return NOT_IMPLEMENTED('C3', 'equipItem');
}
export function unequipSlot(_state: RuntimeState, _slot: string): RuntimeState {
  return NOT_IMPLEMENTED('C3', 'unequipSlot');
}
export function totalWeight(_state: RuntimeState, _cards: Map<string, Card>): number {
  return NOT_IMPLEMENTED('C2', 'totalWeight');
}

// Шаг D2 — engine/cost.ts
export function canPay(_state: RuntimeState, _cost: Dict[]): { ok: boolean; missing: string[] } {
  return NOT_IMPLEMENTED('D2', 'canPay');
}
export function pay(_state: RuntimeState, _cost: Dict[]): { state: RuntimeState; events: EngineEvent[] } {
  return NOT_IMPLEMENTED('D2', 'pay');
}

// Шаг D3 — engine/turn.ts
export function startTurn(_state: RuntimeState): ExecuteResult {
  return NOT_IMPLEMENTED('D3', 'startTurn');
}
export function shortRest(_state: RuntimeState, _ctx: CharacterContext): ExecuteResult {
  return NOT_IMPLEMENTED('D3', 'shortRest');
}
export function longRest(_state: RuntimeState, _ctx: CharacterContext): ExecuteResult {
  return NOT_IMPLEMENTED('D3', 'longRest');
}

// Шаг D1 — engine/resources.ts: max-пулы из класса/эффектов
export function initResources(_ctx: CharacterContext, _classResources: Dict | null, _grantPayloads: Dict[]): {
  resources: Record<string, number>;
  maxResources: Record<string, number>;
} {
  return NOT_IMPLEMENTED('D1', 'initResources');
}

// Шаг E1–E5 — engine/execute.ts: единый исполнитель действий/заклинаний
export function executeAction(_state: RuntimeState, _mechanics: Dict, _ctx: ExecuteContext): ExecuteResult {
  return NOT_IMPLEMENTED('E1', 'executeAction');
}

// Шаг F2 — engine/breakdown.ts: разбивка любых значений листа
export function breakdownValue(
  _what: 'ac' | 'max_hp' | 'initiative' | 'speed' | `save:${string}` | `skill:${string}`,
  _character: CharacterContext,
  _state: RuntimeState,
  _passives: Dict[],
): ValueBreakdown {
  return NOT_IMPLEMENTED('F2', 'breakdownValue');
}
