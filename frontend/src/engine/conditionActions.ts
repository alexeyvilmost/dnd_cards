import type {RuntimeState} from '../mvp/contracts';
import {conditionWorldFacts, expandConditionSet} from './conditions';
import definitions from './data/conditionActions.json';

export interface ConditionGrantedAction {
  id: string; name: string; description: string; movementFraction: number;
  effects: Record<string, unknown>[];
}

/** Legacy movement_options is an explicit data grant, not a condition-id test.
 * New content may declare granted_actions directly using the same schema. */
export function conditionGrantedActions(state: RuntimeState): ConditionGrantedAction[] {
  const result = new Map<string, ConditionGrantedAction>();
  const active = state.activeEffects.flatMap(entry => {
    const mechanics = entry.mechanics as Record<string, unknown>;
    return mechanics.kind === 'condition' && typeof mechanics.value === 'string' ? [mechanics.value] : [];
  });
  for (const condition of expandConditionSet(active)) {
    const facts = conditionWorldFacts(condition);
    const explicit = Array.isArray(facts.granted_actions) ? facts.granted_actions : [];
    const legacy = (Array.isArray(facts.movement_options) ? facts.movement_options : [])
      .flatMap(key => typeof key === 'string' && key in definitions ? [definitions[key as keyof typeof definitions]] : []);
    for (const raw of [...legacy, ...explicit]) {
      if (!raw || typeof raw !== 'object') continue;
      const action = raw as ConditionGrantedAction;
      if (!action.id || !action.name || !Array.isArray(action.effects)
        || !Number.isFinite(action.movementFraction) || action.movementFraction <= 0 || action.movementFraction > 1) continue;
      const resolved = JSON.parse(JSON.stringify(action).replaceAll('"$granting_condition"', JSON.stringify(condition))) as ConditionGrantedAction;
      const id = `${resolved.id}:${condition}`;
      result.set(id, {...resolved, id});
    }
  }
  return [...result.values()];
}
