import type { Action, PassiveEffect } from '../types';
import type { ActiveEffectEntry } from '../mvp/contracts';
import { collectGrantActionSlugs, collectGrantEffectSlugs, type GrantedAction } from './actionSheet';

type Dict = Record<string, unknown>;
export interface EffectGrantedActionClosure {
  grantedActions: GrantedAction[];
  effects: Map<string, PassiveEffect>;
}

/** Resolve the reachable content before a fight is frozen, including actions
 * that a future cast may grant. The immutable action catalog stays stable when
 * a timed effect starts/expires; execution still checks its live grant. */
export async function loadEffectGrantedActionClosure(input: {
  roots: readonly (Dict | null | undefined)[];
  grantedActions: readonly GrantedAction[];
  activeEffects?: readonly ActiveEffectEntry[];
  characterLevel: number;
  resolveAction: (reference: string) => Promise<Action>;
  resolveEffect: (reference: string) => Promise<PassiveEffect>;
}): Promise<EffectGrantedActionClosure> {
  const actions = new Map(input.grantedActions.map(row => [row.action.id, row]));
  const actionReferences = new Set(input.grantedActions.flatMap(row => [row.action.id, row.action.card_number].filter(Boolean)));
  const effects = new Map<string, PassiveEffect>();
  const effectReferences = new Set<string>();
  const resolutionErrors: unknown[] = [];
  const pending: Array<{ mechanics: Dict; name: string; grantsActions: boolean }> = [];
  for (const mechanics of [...input.roots, ...input.grantedActions.map(row => row.action.mechanics)]) {
    if (mechanics) pending.push({ mechanics, name: '', grantsActions: false });
  }
  for (const effect of input.activeEffects ?? []) {
    if (effect.roundsLeft !== undefined && effect.roundsLeft <= 0) continue;
    pending.push({ mechanics: effect.mechanics, name: effect.name, grantsActions: true });
  }
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 4096) throw new Error('Слишком большая цепочка временных действий и эффектов');
    const entry = pending[index];
    for (const reference of collectGrantEffectSlugs(entry.mechanics)) {
      if (effectReferences.has(reference)) continue;
      effectReferences.add(reference);
      let effect: PassiveEffect;
      try {
        effect = await input.resolveEffect(reference);
      } catch (error) {
        // The frozen catalog records each missing reference while resolving.
        // Finish the known branches so siblings are requested in one batch,
        // then fail the build rather than accepting an incomplete closure.
        resolutionErrors.push(error);
        continue;
      }
      effects.set(reference, effect);
      if (effect.mechanics) pending.push({ mechanics: effect.mechanics, name: effect.name, grantsActions: true });
    }
    if (!entry.grantsActions) continue;
    for (const reference of collectGrantActionSlugs(entry.mechanics, input.characterLevel)) {
      if (actionReferences.has(reference)) continue;
      actionReferences.add(reference);
      let action: Action;
      try {
        action = await input.resolveAction(reference);
      } catch (error) {
        resolutionErrors.push(error);
        continue;
      }
      if (actions.has(action.id)) continue;
      const references = [...new Set([reference, action.id, action.card_number].filter((value): value is string => Boolean(value)))];
      const projected: Action = { ...action, mechanics: {
        ...action.mechanics, requires_runtime_action_grant: references,
      } };
      actions.set(action.id, { action: projected, group: 'class', sourceLabel: entry.name });
      references.forEach(value => actionReferences.add(value));
      pending.push({ mechanics: projected.mechanics!, name: action.name, grantsActions: false });
    }
  }
  if (resolutionErrors.length) throw resolutionErrors[0];
  return { grantedActions: [...actions.values()], effects };
}
