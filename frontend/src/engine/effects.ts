/**
 * Управление активными эффектами (фаза D4).
 */
import type { EngineEvent, RuntimeState } from '../mvp/contracts';

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

export function removeActiveEffect(
  state: RuntimeState,
  effectId: string,
): { state: RuntimeState; events: EngineEvent[] } {
  const next = cloneState(state);
  const removed = next.activeEffects.find((e) => e.id === effectId);
  if (!removed) return { state: next, events: [] };
  next.activeEffects = next.activeEffects.filter((e) => e.id !== effectId);
  return {
    state: next,
    events: [{ type: 'effect_expired', name: removed.name }],
  };
}

export function expiryLabel(expiry?: string): string {
  switch (expiry) {
    case 'start_of_next_turn': return 'до начала след. хода';
    case 'end_of_turn': return 'до конца хода';
    case 'until_rest': return 'до отдыха';
    case 'manual': return 'вручную';
    default: return expiry ? expiry : 'без срока';
  }
}
