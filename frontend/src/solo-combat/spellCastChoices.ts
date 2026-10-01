import {resolveSpellAccess} from '../rules-core/spellcastingAccess';
import type {ActorState, RuleActionDefinition} from '../rules-core/domain';

/** The same source/capacity check is used before ordinary and triggered casts. */
export function availableCombatSpellLevels(actor: ActorState, action: RuleActionDefinition): number[] {
  if (action.kind !== 'spell' || !actor.spellcastingAccess || action.spell.level === 0) return [];
  return Array.from({length: 10 - action.spell.level}, (_, index) => action.spell.level + index)
    .filter(level => actor.spellcastingAccess!.grants.some(grant => grant.actionId === action.id
      && resolveSpellAccess({state: actor.spellcastingAccess!, actionId: action.id, grantId: grant.grantId,
        resources: actor.runtime.resources, castLevel: level}).status === 'allowed'));
}
