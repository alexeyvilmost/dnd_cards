import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export const ACTION_SURGE_ACTION_RESOURCE = 'action_surge_action';

/**
 * Action Surge grants a second, explicitly non-Magic action in the 2024 rules.
 * Keeping it in a separate turn resource prevents a spell from consuming the
 * grant while still allowing the player to use Action Surge before or after
 * their ordinary action.
 */
export function projectActionSurgeCost(
  mechanics: Dict,
  state: RuntimeState,
  kind: 'spell' | 'nonspell',
): Dict {
  if (kind === 'spell' || (state.resources[ACTION_SURGE_ACTION_RESOURCE] ?? 0) < 1) {
    return mechanics;
  }
  const activation = mechanics.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mechanics;
  let replaced = false;
  const cost = (activation.cost as Dict[]).map((entry) => {
    if (!replaced && entry.resource === 'action') {
      replaced = true;
      return { ...entry, resource: ACTION_SURGE_ACTION_RESOURCE };
    }
    return entry;
  });
  return replaced ? { ...mechanics, activation: { ...activation, cost } } : mechanics;
}
