import type {ActiveEffectEntry, RuntimeState} from '../mvp/contracts';
import {collectGrantActionSlugs} from '../mechanics/actionGrants';
type Dict = Record<string, unknown>;

/** Catalog gates only; the UI cannot invent a live grant by naming an action. */
export function matchingRuntimeActionGrants(state: RuntimeState, mechanics: Dict, level?: number): ActiveEffectEntry[] {
  const references = mechanics.requires_runtime_action_grant;
  if (!Array.isArray(references) || !references.length || references.some(ref => typeof ref !== 'string' || !ref.trim())) return [];
  return state.activeEffects.filter(effect => (effect.roundsLeft === undefined || effect.roundsLeft > 0)
    && collectGrantActionSlugs(effect.mechanics, level).some(ref => references.includes(ref)));
}

