/**
 * Сбор модификаторов броска из активных эффектов (фаза D4).
 */
import type { AdvantageState, RollModifier, RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

function combineAdvantage(current: AdvantageState, op: string): AdvantageState {
  if (op !== 'advantage' && op !== 'disadvantage') return current;
  if (current === 'none') return op;
  if (current === op) return current;
  return 'none';
}

function matchFilter(effectFilter: Dict | undefined, queryFilter: Dict | undefined): boolean {
  if (!effectFilter) return true;
  if (!queryFilter) return true;
  for (const [k, v] of Object.entries(effectFilter)) {
    if (queryFilter[k] !== v) return false;
  }
  return true;
}

function collectFromPayload(
  payload: Dict,
  appliesTo: { roll: string; filter?: Dict },
  out: { modifiers: RollModifier[]; advantage: AdvantageState },
): void {
  if (payload.kind !== 'modifier') return;
  const applies = payload.applies_to as Dict | undefined;
  if (!applies || applies.roll !== appliesTo.roll) return;
  if (!matchFilter(applies.filter as Dict | undefined, appliesTo.filter)) return;

  if (payload.op === 'advantage' || payload.op === 'disadvantage') {
    out.advantage = combineAdvantage(out.advantage, String(payload.op));
    return;
  }
  if (payload.op === 'add' && payload.value != null) {
    const raw = String(payload.value).replace(/^\+/, '');
    const value = Number(raw);
    if (!Number.isNaN(value)) {
      out.modifiers.push({ value, source: String(payload.source ?? 'эффект') });
    }
  }
}

export function collectRollModifiers(
  state: RuntimeState,
  passives: Dict[],
  appliesTo: { roll: string; filter?: Dict },
): { modifiers: RollModifier[]; advantage: AdvantageState } {
  const out: { modifiers: RollModifier[]; advantage: AdvantageState } = {
    modifiers: [],
    advantage: 'none',
  };

  for (const effect of state.activeEffects) {
    collectFromPayload(effect.mechanics, appliesTo, out);
  }

  for (const mech of passives) {
    const effects = mech.effects as Dict[] | undefined;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects) {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (!Array.isArray(results)) continue;
      for (const r of results) collectFromPayload(r, appliesTo, out);
    }
  }

  return out;
}
