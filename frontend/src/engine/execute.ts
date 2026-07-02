/**
 * Минимальный исполнитель (фаза E1, подмножество для D4).
 */
import type { ActiveEffectEntry, CharacterContext, EngineEvent, ExecuteContext, ExecuteResult, RuntimeState } from '../mvp/contracts';
import { canPay, pay } from './cost';

type Dict = Record<string, unknown>;

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

function expiryFromDuration(duration: Dict | undefined): string | undefined {
  const t = duration?.type;
  if (t === 'until_start_of_next_turn') return 'start_of_next_turn';
  return undefined;
}

function applyAutoResult(
  state: RuntimeState,
  results: Dict[],
  source: string,
  events: EngineEvent[],
): RuntimeState {
  let next = state;
  for (const r of results) {
    if (r.kind === 'modifier') {
      const entry: ActiveEffectEntry = {
        id: `fx-${next.activeEffects.length}-${Date.now()}`,
        name: source,
        mechanics: r,
        expiry: expiryFromDuration(r.duration as Dict | undefined),
        source,
      };
      next = { ...next, activeEffects: [...next.activeEffects, entry] };
      events.push({ type: 'effect_applied', name: source });
      continue;
    }
    if (r.kind === 'narrative') {
      events.push({ type: 'narrative', text: String(r.description ?? r.text ?? '') });
    }
  }
  return next;
}

export function executeAction(
  state: RuntimeState,
  mechanics: Dict,
  ctx: ExecuteContext,
): ExecuteResult {
  let next = cloneState(state);
  const events: EngineEvent[] = [];

  const activation = mechanics.activation as Dict | undefined;
  const cost = (activation?.cost as Dict[]) ?? [];
  if (cost.length) {
    const check = canPay(next, cost);
    if (!check.ok) return { state: next, events };
    const paid = pay(next, cost);
    next = paid.state;
    events.push(...paid.events);
  }

  const effects = mechanics.effects as Dict[] | undefined;
  if (!Array.isArray(effects)) return { state: next, events };

  const sourceName = String(mechanics.name ?? 'действие');

  for (const eff of effects) {
    const resolution = String(eff.resolution ?? '');
    if (resolution === 'auto') {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (Array.isArray(results)) {
        next = applyAutoResult(next, results, sourceName, events);
      }
      continue;
    }
    // attack_roll, save, ability_check — фаза E
    events.push({ type: 'narrative', text: `NOT_IMPLEMENTED resolution: ${resolution}` });
  }

  void ctx;
  return { state: next, events };
}
