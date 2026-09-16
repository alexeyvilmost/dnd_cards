import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { activeConditionsOf, matchesWhen } from './circumstances';

type Dict = Record<string, unknown>;

function requiredEffectReferences(mechanics: Dict): string[] {
  const declared = mechanics.requires_active_effect;
  if (typeof declared === 'string') return declared.trim() ? [declared.trim()] : [];
  if (!Array.isArray(declared)) return [];
  return declared.flatMap((value) => (
    typeof value === 'string' && value.trim() ? [value.trim()] : []
  ));
}

/**
 * Some catalog actions are projections of a temporary library effect rather
 * than permanent character abilities (for example, a Beast attack while Wild
 * Shaped). Their availability is therefore keyed by exact effect provenance,
 * never by a translated display name.
 */
export function activeEffectRequirementIssue(
  mechanics: Dict,
  state: RuntimeState,
  character?: CharacterContext,
): string | null {
  const whenIssue = activationCircumstanceIssue(mechanics, state, character);
  if (whenIssue) return whenIssue;
  const heldIssue = heldItemRequirementIssue(mechanics, state);
  if (heldIssue) return heldIssue;
  const forbiddenStack = typeof mechanics.forbids_active_effect_stack === 'string'
    ? mechanics.forbids_active_effect_stack.trim()
    : '';
  if (forbiddenStack && state.activeEffects.some((effect) => (
    (effect.mechanics as Dict | undefined)?.stack_id === forbiddenStack
  ))) {
    return 'Для следующего заклинания уже выбран другой вариант Метамагии';
  }
  const required = requiredEffectReferences(mechanics);
  const requiredStack = typeof mechanics.requires_active_effect_stack === 'string'
    ? mechanics.requires_active_effect_stack.trim()
    : '';
  if (!required.length && !requiredStack) return null;
  if (requiredStack && state.activeEffects.some((effect) => (
    (effect.mechanics as Dict | undefined)?.stack_id === requiredStack
  ))) return null;
  const active = new Set(state.activeEffects.flatMap((effect) => {
    const reference = effect.entityRef;
    return [reference?.id, reference?.cardNumber].filter(
      (value): value is string => typeof value === 'string' && Boolean(value),
    );
  }));
  return required.some((reference) => active.has(reference))
    ? null
    : 'Действие доступно только в соответствующем активном облике';
}

/** The same content-owned prerequisites govern previews and authoritative payment. */
export function activationCircumstanceIssue(mechanics: Dict, state: RuntimeState, character?: CharacterContext): string | null {
  const activation = mechanics.activation as Dict | undefined;
  const when = activation?.when;
  if (when === undefined) return null;
  if (!Array.isArray(when) || !when.every(p => p && typeof p === 'object' && !Array.isArray(p))) return 'Некорректные условия действия';
  return matchesWhen(when, {state, character, activeConditions: activeConditionsOf(state)})
    ? null : 'Не выполнены условия использования действия';
}


/** Exact content identity binds a stat-block attack to its physical weapon.
 * An item merely carried in a backpack cannot satisfy a held-item requirement. */
export function heldItemRequirementIssue(mechanics: Dict, state: RuntimeState): string | null {
  const required = mechanics.requires_held_item;
  if (required === undefined) return null;
  if (typeof required !== 'string' || !required.trim()) return 'Некорректное требование удерживаемого предмета';
  if (state.equipment.main_hand !== required && state.equipment.off_hand !== required) {
    return 'Для этой атаки нужно держать соответствующее оружие';
  }
  // Equipment stores the held physical instance; inventory stores bag contents
  // only. Requiring a second copy in the bag makes armed monsters appear
  // disarmed and incorrectly blocks the same stat-block attacks for players.
  return null;
}
