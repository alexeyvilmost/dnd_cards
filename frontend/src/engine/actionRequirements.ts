import type { RuntimeState } from '../mvp/contracts';

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
): string | null {
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
