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
import { healingEvent, rollEvent, turnEndedEvent } from './events';
import { resourcesRestoredOnShortRest } from './resources';
import { emitEvent } from './execute';
import { rollD20 } from './roll';
import { collectModifiers } from './modifiers';
import { evaluate, type FormulaContext } from './formula';

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

function expireStartOfTurnEffects(state: RuntimeState): { state: RuntimeState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  const kept: typeof state.activeEffects = [];
  for (const e of state.activeEffects) {
    if (e.expiry === 'start_of_next_turn') {
      events.push({ type: 'effect_expired', name: e.name });
      continue;
    }
    // Длительность в раундах (condition duration.rounds): тикаем на начале хода.
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

export function startTurn(state: RuntimeState, ctx?: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'turn_started' }];
  const pending: ReactionOffer[] = [];

  // Сброс гейта «раз за ход» для triggered-эффектов (Скрытая атака и т.п.).
  next = { ...next, firedThisTurn: [] };
  next = restoreTurnResources(next);
  const expired = expireStartOfTurnEffects(next);
  next = expired.state;
  events.push(...expired.events);

  // Шина: начало хода (тикающие эффекты, будущий Recharge X–Y). Только при переданном ctx
  // (обратная совместимость: startTurn(state) в тестах шину не гонит).
  if (ctx) next = emitEvent({ kind: 'turn_start', source: 'self' }, next, execCtxOf(ctx), events, pending);

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

/** Спасбросок «в конце хода» для состояния с save_ends (модель 2024: яд/Hold Person).
 *  Владелец катит свой спас; успех → true (состояние снимается). */
function rollSaveEnds(
  state: RuntimeState, ctx: CharacterContext, se: Dict, name: string, events: EngineEvent[], rng: () => number,
): boolean {
  const ability = String(se.ability ?? 'con') as AbilityKey;
  const dcRaw = String(se.dc ?? '10').replace(/\s+/g, '');
  const dcVal = evaluate(dcRaw, formulaCtxOf(ctx));
  const dc = typeof dcVal === 'number' ? dcVal : 10;
  const proficient = (ctx.saveProficiencies ?? []).includes(ability);
  const mod = (ctx.abilityMods[ability] ?? 0) + (proficient ? ctx.profBonus : 0);
  const collected = collectModifiers(state, passivesFromCtx(ctx), {
    roll: 'saving_throw', filter: { ability }, formulaCtx: formulaCtxOf(ctx),
  });
  const roll = rollD20({
    advantage: collected.advantage,
    modifiers: [{ value: mod, source: ABILITY_LABEL[ability] }, ...collected.modifiers],
    target: { type: 'dc', value: dc },
    rng,
  });
  events.push(rollEvent(`Спасбросок в конце хода — ${name} (СЛ ${dc})`, { ...roll, kind: 'save' }));
  return roll.outcome === 'success';
}

export function endTurn(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [turnEndedEvent()];
  const pending: ReactionOffer[] = [];
  const rng = (ctx as RestContext).rng ?? (() => Math.random());

  // (1) истечение эффектов expiry:'end_of_turn'; (2) save_ends: спасбросок владельца,
  //     успех снимает состояние (повторный спас в конце хода).
  const kept: typeof next.activeEffects = [];
  for (const e of next.activeEffects) {
    if (e.expiry === 'end_of_turn') {
      events.push({ type: 'effect_expired', name: e.name });
      continue;
    }
    const se = (e.mechanics as Dict)?.save_ends as Dict | undefined;
    if (se && String(se.timing ?? 'end_of_turn') === 'end_of_turn') {
      if (rollSaveEnds(next, ctx, se, e.name, events, rng)) {
        events.push({ type: 'effect_expired', name: e.name });
        continue;
      }
    }
    kept.push(e);
  }
  next = { ...next, activeEffects: kept };

  // Шина: конец хода (тикающие яды/горение, end-of-turn эффекты как данные).
  next = emitEvent({ kind: 'turn_end', source: 'self' }, next, execCtxOf(ctx), events, pending);

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}

/** Короткий отдых: +50% max HP и ресурсы с recharge short_rest. */
export function shortRest(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'short_rest' }];
  const pending: ReactionOffer[] = [];
  const recharge = (ctx as RestContext).resourceRecharge;

  const healAmount = Math.floor(next.hp.max / 2);
  if (healAmount > 0) {
    const before = next.hp.current;
    next.hp.current = Math.min(next.hp.max, next.hp.current + healAmount);
    const healed = next.hp.current - before;
    if (healed > 0) events.push(healingEvent(healed));
  }

  for (const key of resourcesRestoredOnShortRest(next.maxResources, recharge)) {
    const max = next.maxResources[key] ?? 0;
    const before = next.resources[key] ?? 0;
    if (before < max) {
      next.resources[key] = max;
      events.push({ type: 'resource_restored', resource: key, amount: max - before, current: max });
    }
  }

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
  next.activeEffects = [];

  // КРИТИЧНО (C3): эмитим long_rest ДО сплошного восстановления. applyResource op:'grant'
  // = current+amount; если эмитить ПОСЛЕ restore-к-max, гранты (heroic_inspiration от
  // Находчивого) удвоятся. Здесь restore ниже нормализует значение к максимуму.
  next = emitEvent({ kind: 'long_rest', source: 'self' }, next, execCtxOf(ctx), events, pending);

  for (const key of Object.keys(next.maxResources)) {
    const max = next.maxResources[key] ?? 0;
    next.resources[key] = max;
  }

  return { state: next, events, ...(pending.length ? { pendingReactions: pending } : {}) };
}
