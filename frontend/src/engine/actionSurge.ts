import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

export const ACTION_SURGE_ACTION_RESOURCE = 'action_surge_action';
export const QUICKENED_SPELL_ACTION_RESOURCE = 'quickened_spell_action';

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

/** Quickened Spell pays the Bonus Action and Sorcery Points when it is armed,
 * then exposes exactly one spell-only action token. This prevents weapons and
 * other non-Magic actions from consuming the token. */
export function projectQuickenedSpellCost(
  mechanics: Dict,
  state: RuntimeState,
  kind: 'spell' | 'nonspell',
): Dict {
  if (kind !== 'spell' || (state.resources[QUICKENED_SPELL_ACTION_RESOURCE] ?? 0) < 1) {
    return mechanics;
  }
  const activation = mechanics.activation as Dict | undefined;
  if (!Array.isArray(activation?.cost)) return mechanics;
  let replaced = false;
  const cost = (activation.cost as Dict[]).map((entry) => {
    if (!replaced && entry.resource === 'action') {
      replaced = true;
      return { ...entry, resource: QUICKENED_SPELL_ACTION_RESOURCE };
    }
    return entry;
  });
  return replaced ? { ...mechanics, activation: { ...activation, cost } } : mechanics;
}
