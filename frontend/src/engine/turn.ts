/**
 * Ход и отдыхи (фаза D3).
 */
import type { CharacterContext, EngineEvent, ExecuteResult, RuntimeState } from '../mvp/contracts';
import { healingEvent } from './events';
import { resourcesRestoredOnShortRest } from './resources';

type Dict = Record<string, unknown>;

type RestContext = CharacterContext & {
  passives?: Dict[];
  resourceRecharge?: Record<string, string>;
};

const TURN_KEYS = ['action', 'bonus_action', 'reaction'] as const;

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

export function startTurn(state: RuntimeState): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'turn_started' }];

  next = restoreTurnResources(next);
  const expired = expireStartOfTurnEffects(next);
  next = expired.state;
  events.push(...expired.events);

  return { state: next, events };
}

/** Короткий отдых: +50% max HP и ресурсы с recharge short_rest. */
export function shortRest(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  const next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'short_rest' }];
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

  return { state: next, events };
}

function passivesFromCtx(ctx: CharacterContext): Dict[] {
  return (ctx as RestContext).passives ?? [];
}

function applyLongRestPassives(state: RuntimeState, ctx: CharacterContext): RuntimeState {
  let next = state;
  for (const mech of passivesFromCtx(ctx)) {
    const activation = mech.activation as Dict | undefined;
    if (activation?.mode !== 'triggered') continue;
    const trigger = activation.trigger as Dict | undefined;
    if (trigger?.event !== 'long_rest') continue;
    const effects = mech.effects as Dict[] | undefined;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects) {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (r.kind === 'resource' && r.op === 'grant') {
          const id = String(r.id ?? '');
          const amount = typeof r.amount === 'number' ? r.amount : Number(r.amount) || 1;
          if (!id) continue;
          const max = next.maxResources[id] ?? amount;
          next = {
            ...next,
            maxResources: { ...next.maxResources, [id]: Math.max(max, amount) },
            resources: { ...next.resources, [id]: Math.max(next.resources[id] ?? 0, amount) },
          };
        }
      }
    }
  }
  return next;
}

export function longRest(state: RuntimeState, ctx: CharacterContext): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [{ type: 'long_rest' }];

  next.hp.current = next.hp.max;
  next.activeEffects = [];

  for (const key of Object.keys(next.maxResources)) {
    const max = next.maxResources[key] ?? 0;
    next.resources[key] = max;
  }

  next = applyLongRestPassives(next, ctx);

  return { state: next, events };
}
