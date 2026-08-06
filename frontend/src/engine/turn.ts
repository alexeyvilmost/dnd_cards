/**
 * Ход и отдыхи (фаза D3 + C3 слайс 2: через шину событий).
 *
 * startTurn/endTurn/shortRest/longRest эмитят события шины (turn_start/turn_end/short_rest/
 * long_rest) — data-driven триггеры (тикающие яды/горение, Recharge, отклики на отдых)
 * исполняются штатным runMechanicEffects, а не хардкодом. endTurn дополнительно катит
 * спасброски «в конце хода» (save_ends, модель 2024) и истекает эффекты expiry:'end_of_turn'.
 */
import type {
  CharacterContext, EngineEvent, ExecuteContext, ExecuteResult, ReactionOffer, RuntimeState,
} from '../mvp/contracts';
import { rollEvent, turnEndedEvent } from './events';
import {
  hitDiceResourceKey,
  hitDieSides,
  resourceAmountRestoredOnLongRest,
  resourceAmountRestoredOnShortRest,
  resourcesRestoredOnShortRest,
} from './resources';
import { emitEvent, MechanicsExecutionError } from './execute';
import { rollD20 } from './roll';
import { collectModifiers } from './modifiers';
import { evaluate, FormulaError, type FormulaContext } from './formula';
import { activeConditionsOf } from './circumstances';
import { conditionLongRestEntries } from './conditions';

type Dict = Record<string, unknown>;
type AbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

type RestContext = CharacterContext & {
  passives?: Dict[];
  resourceRecharge?: Record<string, string>;
  /** RNG для костей save_ends/тикающих эффектов (rest-контекст без диалога кубов). */
  rng?: () => number;
};

const TURN_KEYS = ['action', 'bonus_action', 'reaction'] as const;
const ABILITY_LABEL: Record<AbilityKey, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};
const ABILITY_KEYS = new Set<AbilityKey>(['str', 'dex', 'con', 'int', 'wis', 'cha']);

function cloneState(state: RuntimeState): RuntimeState {
  return {
    ...state,
    hp: { ...state.hp },
    resources: { ...state.resources },
    maxResources: { ...state.maxResources },
    equipment: { ...state.equipment },
    inventory: state.inventory.map((r) => ({ ...r })),
    activeEffects: state.activeEffects.map((e) => ({ ...e })),
  };
}

function passivesFromCtx(ctx: CharacterContext): Dict[] {
  return (ctx as RestContext).passives ?? [];
}

/** ExecuteContext для emitEvent из rest/turn-контекста. passives читается helper'ом
 *  execute.ts через (ctx as {passives}); rng по умолчанию Math.random (без диалога кубов). */
function execCtxOf(ctx: CharacterContext): ExecuteContext {
  return {
    character: ctx,
    rng: (ctx as RestContext).rng ?? (() => Math.random()),
    passives: passivesFromCtx(ctx),
  } as ExecuteContext;
}

function formulaCtxOf(ctx: CharacterContext): FormulaContext {
  return {
    abilityMods: ctx.abilityMods,
    profBonus: ctx.profBonus,
    selfLevel: ctx.level,
    classLevels: ctx.classLevels,
    variables: ctx.variables,
  };
}

function restoreTurnResources(state: RuntimeState): RuntimeState {
  const resources = { ...state.resources };
  for (const key of TURN_KEYS) {
    if (state.maxResources[key] != null) resources[key] = state.maxResources[key];
  }
  return { ...state, resources };
}

/**
 * Один явный переход хода уменьшает раундовые длительности на 1. В одиночном листе
 * игрок может пользоваться либо «Новый ход», либо «Конец хода», поэтому оба действия
 * вызывают этот резолвер.
 */
function advanceRoundEffects(
  state: RuntimeState,
  expireStartBoundary = false,
): { state: RuntimeState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const kept: typeof state.activeEffects = [];
  for (const e of state.activeEffects) {
    if (expireStartBoundary && e.expiry === 'start_of_next_turn') {
      events.push({ type: 'effect_expired', name: e.name });
      continue;
    }
    // Длительность в раундах: каждый явный переход хода списывает один оставшийся ход.
    if (e.roundsLeft != null) {
      const left = e.roundsLeft - 1;
      if (left <= 0) {
        events.push({ type: 'effect_expired', name: e.name });
        continue;
      }
      kept.push({ ...e, roundsLeft: left });
      continue;
    }
    kept.push(e);
  }
  return { state: { ...state, activeEffects: kept }, events };
}

export interface TurnTransitionOptions {
  /** Rules-core uses StartTurn as the single round-duration boundary. */
  advanceRoundDurations?: boolean;
}

export function startTurn(
  state: RuntimeState,
  ctx?: CharacterContext,
  options: TurnTransitionOptions = {},
): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'turn_started' }];
  const pending: ReactionOffer[] = [];

  // Сброс гейта «раз за ход» для triggered-эффектов (Скрытая атака и т.п.).
  next = { ...next, firedThisTurn: [] };
  next = restoreTurnResources(next);
  if (options.advanceRoundDurations !== false) {
    const expired = advanceRoundEffects(next, true);
    next = expired.state;
    events.push(...expired.events);
  }

  // Шина: начало хода (тикающие эффекты, будущий Recharge X–Y). Только при переданном ctx
  // (обратная совместимость: startTurn(state) в тестах шину не гонит).
  if (ctx) next = emitEvent({ kind: 'turn_start', source: 'self' }, next, execCtxOf(ctx), events, pending);

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

interface ResolvedSaveEnds {
  ability: AbilityKey;
  dc: number;
  modifier: number;
}

function saveEndsError(
  code: 'INVALID_PAYLOAD' | 'INVALID_FORMULA' | 'INVALID_MECHANICS',
  path: string,
  message: string,
  cause?: unknown,
): MechanicsExecutionError {
  return new MechanicsExecutionError(
    code,
    path,
    message,
    cause === undefined ? undefined : { cause },
  );
}

/** Resolve every declaration before expiry, RNG, event dispatch or state change. */
function preflightSaveEnds(
  state: RuntimeState,
  ctx: CharacterContext,
): Array<ResolvedSaveEnds | null> {
  return state.activeEffects.map((effect, index) => {
    const mechanics = effect.mechanics;
    if (!mechanics || typeof mechanics !== 'object' || Array.isArray(mechanics)
      || !Object.prototype.hasOwnProperty.call(mechanics, 'save_ends')) {
      return null;
    }
    const path = `runtime.activeEffects[${index}].mechanics.save_ends`;
    const declaration = (mechanics as Dict).save_ends;
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw saveEndsError('INVALID_PAYLOAD', path, 'save_ends must be an object');
    }
    const se = declaration as Dict;
    if (typeof se.ability !== 'string' || !ABILITY_KEYS.has(se.ability as AbilityKey)) {
      throw saveEndsError(
        'INVALID_PAYLOAD',
        `${path}.ability`,
        'save_ends requires an explicit supported ability',
      );
    }
    if (se.dc === undefined) {
      throw saveEndsError(
        'INVALID_PAYLOAD',
        `${path}.dc`,
        'save_ends requires an explicit DC formula',
      );
    }
    let dc: number;
    try {
      const value = evaluate(se.dc as string | number, {
        ...formulaCtxOf(ctx),
        rng: () => { throw new FormulaError('save_ends DC cannot contain a random die'); },
      });
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new FormulaError('save_ends DC must resolve to a positive finite number');
      }
      dc = value;
    } catch (error) {
      throw saveEndsError(
        'INVALID_FORMULA',
        `${path}.dc`,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    const ability = se.ability as AbilityKey;
    const abilityModifier = ctx.abilityMods[ability];
    if (typeof abilityModifier !== 'number' || !Number.isFinite(abilityModifier)) {
      throw saveEndsError(
        'INVALID_MECHANICS',
        `context.character.abilityMods.${ability}`,
        'save_ends requires an explicit finite owner ability modifier',
      );
    }
    const proficient = (ctx.saveProficiencies ?? []).includes(ability);
    if (proficient && (typeof ctx.profBonus !== 'number' || !Number.isFinite(ctx.profBonus))) {
      throw saveEndsError(
        'INVALID_MECHANICS',
        'context.character.profBonus',
        'save_ends proficiency requires an explicit finite proficiency bonus',
      );
    }
    return {
      ability,
      dc,
      modifier: abilityModifier + (proficient ? ctx.profBonus : 0),
    };
  });
}

/** Спасбросок «в конце хода» для состояния с save_ends (модель 2024: яд/Hold Person).
 *  Владелец катит свой спас; успех → true (состояние снимается). */
function rollSaveEnds(
  state: RuntimeState,
  ctx: CharacterContext,
  declaration: ResolvedSaveEnds,
  name: string,
  events: EngineEvent[],
  rng: () => number,
  avoidedCondition?: string,
): boolean {
  const { ability, dc, modifier } = declaration;
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'saving_throw',
    filter: { ability },
    formulaCtx: formulaCtxOf(ctx),
    evalCtx: {
      state,
      activeConditions: activeConditionsOf(state),
      savedConditions: new Set(avoidedCondition ? [avoidedCondition] : []),
    },
  });
  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [{ value: modifier, source: ABILITY_LABEL[ability] }, ...collected.modifiers],
    target: { type: 'dc', value: dc },
    rng,
  });
  events.push(rollEvent(`Спасбросок в конце хода — ${name} (СЛ ${dc})`, { ...roll, kind: 'save' }));
  return roll.outcome === 'success';
}

export function endTurn(
  state: RuntimeState,
  ctx: CharacterContext,
  options: TurnTransitionOptions = {},
): ExecuteResult {
  const saveEndsDeclarations = preflightSaveEnds(state, ctx);
  let next = cloneState(state);
  const events: EngineEvent[] = [turnEndedEvent()];
  const pending: ReactionOffer[] = [];
  const rng = (ctx as RestContext).rng ?? (() => Math.random());

  // (1) истечение эффектов expiry:'end_of_turn'; (2) save_ends: спасбросок владельца,
  //     успех снимает состояние (повторный спас в конце хода).
  const kept: typeof next.activeEffects = [];
  for (const [index, e] of next.activeEffects.entries()) {
    if (e.expiry === 'end_of_turn') {
      events.push({ type: 'effect_expired', name: e.name });
      continue;
    }
    const mechanics = e.mechanics as Dict | undefined;
    const se = mechanics?.save_ends as Dict | undefined;
    const declaration = saveEndsDeclarations[index];
    if (se && declaration && String(se.timing ?? 'end_of_turn') === 'end_of_turn') {
      if (rollSaveEnds(
        next,
        ctx,
        declaration,
        e.name,
        events,
        rng,
        String((e.mechanics as Dict).value ?? ''),
      )) {
        events.push({ type: 'effect_expired', name: e.name });
        continue;
      }
    }
    kept.push(e);
  }
  next = { ...next, activeEffects: kept };

  // Списываем ход только у эффектов, существовавших до turn_end-триггеров. Эффект,
  // который сам возник «в конце хода», не должен немедленно потерять первый ход.
  if (options.advanceRoundDurations !== false) {
    const advanced = advanceRoundEffects(next);
    next = advanced.state;
    events.push(...advanced.events);
  }

  // Шина: конец хода (тикающие яды/горение, end-of-turn эффекты как данные).
  next = emitEvent({ kind: 'turn_end', source: 'self' }, next, execCtxOf(ctx), events, pending);

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

/**
 * Потратить одну кость хитов во время короткого отдыха (PHB 2024):
 * лечение = результат кости + ТЕЛ, минимум 1. UI вызывает функцию по одной
 * кости, чтобы игрок решал после каждого броска, тратить ли следующую.
 */
export function spendHitDie(state: RuntimeState, ctx: CharacterContext, rolled: number): ExecuteResult {
  const key = hitDiceResourceKey(ctx.hitDie);
  const sides = hitDieSides(ctx.hitDie);
  if (!key || !sides || !Number.isFinite(rolled) || state.hp.current >= state.hp.max || (state.resources[key] ?? 0) < 1) {
    return { state: cloneState(state), events: [] };
  }

  const die = Math.max(1, Math.min(sides, Math.floor(rolled)));
  const con = ctx.abilityMods.con ?? 0;
  const rawHealing = Math.max(1, die + con);
  const next = cloneState(state);
  next.resources[key] -= 1;
  const before = next.hp.current;
  next.hp.current = Math.min(next.hp.max, next.hp.current + rawHealing);
  const healed = next.hp.current - before;
  const remaining = next.resources[key];
  const modifiers = con === 0 ? [] : [{ value: con, source: 'ТЕЛ', reason: 'модификатор Телосложения' }];
  const events: EngineEvent[] = [
    { type: 'resource_spent', resource: key, amount: 1, remaining },
    {
      type: 'healing',
      amount: healed,
      roll: {
        kind: 'healing',
        dice: [{ sides, result: die }],
        advantage: 'none',
        modifiers,
        total: rawHealing,
        text: `к${sides}: ${die}${con >= 0 ? ' +' : ' '}${con} [ТЕЛ] = ${rawHealing} ХП`,
      },
    },
  ];
  return { state: next, events };
}

/** Короткий отдых: без автолечения; HP восстанавливаются только через spendHitDie. */
export function shortRest(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'short_rest' }];
  const pending: ReactionOffer[] = [];
  const recharge = (ctx as RestContext).resourceRecharge;

  const recovery = (ctx as RestContext).resourceRecovery;
  for (const key of resourcesRestoredOnShortRest(next.maxResources, recharge, recovery)) {
    const max = next.maxResources[key] ?? 0;
    const before = next.resources[key] ?? 0;
    const amount = resourceAmountRestoredOnShortRest(key, before, max, recovery);
    if (amount > 0) {
      const current = before + amount;
      next.resources[key] = current;
      events.push({ type: 'resource_restored', resource: key, amount, current });
    }
  }

  // Короткий отдых = 1 час = 600 раундов: истекают раунд-таймерные эффекты (Большая форма и т.п.).
  // Эффекты «до короткого отдыха» моделируются длительностью в 600 раундов и снимаются здесь же.
  const kept = next.activeEffects.filter((e) => e.roundsLeft == null || e.roundsLeft > 600);
  for (const e of next.activeEffects) {
    if (e.roundsLeft != null && e.roundsLeft <= 600) events.push({ type: 'effect_expired', name: e.name });
  }
  next.activeEffects = kept.map((e) => (e.roundsLeft != null ? { ...e, roundsLeft: e.roundsLeft - 600 } : e));

  // Шина: короткий отдых (отклики на отдых как данные, с circumstances/uses-гейтами).
  next = emitEvent({ kind: 'short_rest', source: 'self' }, next, execCtxOf(ctx), events, pending);

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

export function longRest(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'long_rest' }];
  const pending: ReactionOffer[] = [];

  next.hp.current = next.hp.max;
  next.hp.temp = 0; // C6: временные хиты спадают после длинного отдыха (RAW 2024)
  // Eight hours advance 4,800 six-second rounds. Only an explicit rest expiry,
  // elapsed duration, or condition-owned rest transition may remove an effect;
  // a manual/permanent condition is never silently cured by resting.
  const afterElapsedTime: typeof next.activeEffects = [];
  for (const effect of next.activeEffects) {
    if (effect.expiry === 'long_rest' || effect.expiry === 'until_rest') {
      events.push({ type: 'effect_expired', name: effect.name });
      continue;
    }
    if (effect.roundsLeft != null) {
      if (effect.roundsLeft <= 4_800) {
        events.push({ type: 'effect_expired', name: effect.name });
        continue;
      }
      afterElapsedTime.push({ ...effect, roundsLeft: effect.roundsLeft - 4_800 });
      continue;
    }
    afterElapsedTime.push(effect);
  }
  const conditionRest = conditionLongRestEntries(afterElapsedTime);
  for (const removed of conditionRest.removed) {
    events.push({ type: 'effect_expired', name: removed.name });
  }
  next.activeEffects = conditionRest.retained;
  next.firedThisRest = []; // 2.4: сброс гейта «раз за отдых»-триггеров (Неумолимая стойкость и т.п.)

  // КРИТИЧНО (C3): эмитим long_rest ДО сплошного восстановления. applyResource op:'grant'
  // = current+amount; если эмитить ПОСЛЕ restore-к-max, гранты (heroic_inspiration от
  // Находчивого) удвоятся. Здесь restore ниже нормализует значение к максимуму.
  next = emitEvent({ kind: 'long_rest', source: 'self' }, next, execCtxOf(ctx), events, pending);

  for (const key of Object.keys(next.maxResources)) {
    // Inventory-like numeric resources (for example consumed spell
    // materials) keep an audit maximum but never regenerate on a rest.
    if ((ctx as RestContext).resourceRecharge?.[key] === 'never') continue;
    const max = next.maxResources[key] ?? 0;
    const before = next.resources[key] ?? 0;
    const declared = resourceAmountRestoredOnLongRest(
      key,
      before,
      max,
      (ctx as RestContext).resourceRecovery,
    );
    if (declared === 0) continue;
    next.resources[key] = declared == null ? max : before + declared;
  }

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}
