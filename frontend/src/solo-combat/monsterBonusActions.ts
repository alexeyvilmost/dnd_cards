import {canPay} from '../engine/cost';
import {deniedCapabilities} from '../engine/modifiers';
import {hideActionDeclarationIssue} from '../rules-core/hide';
import type {RuleActionDefinition} from '../rules-core/domain';
import type {SoloCombatState} from './types';

/** The controller recognizes declared action categories, never monster names. */
export function monsterBonusActions(state: SoloCombatState, actorId: string, category: 'hide' | 'disengage'): RuleActionDefinition[] {
  const actor = state.world.actors[actorId];
  if (!actor || actor.runtime.hp.current <= 0 || deniedCapabilities(actor.runtime, actor.passives ?? []).has('action')) return [];
  return state.catalogActions.filter(action => {
    const activation = action.mechanics.activation as Record<string, unknown> | undefined;
    const cost = activation?.cost as Record<string, unknown>[] | undefined;
    if (!actor.capabilities.actionIds.includes(action.id) || action.kind !== 'nonSpell'
      || activation?.mode !== 'active' || activation.counts_as !== category
      || !Array.isArray(cost) || cost.length !== 1 || cost[0].resource !== 'bonus_action'
      || (cost[0].amount !== undefined && cost[0].amount !== 1) || !canPay(actor.runtime, cost).ok) return false;
    if (category === 'hide') return hideActionDeclarationIssue(action) === null;
    // Only the deterministic Disengage declaration is eligible for route comparison.
    // Other abilities that also disengage can require choices, dice or extra effects.
    const effects = action.mechanics.effects as Record<string, unknown>[] | undefined;
    const result = effects?.[0]?.result as Record<string, unknown>[] | undefined;
    const modifier = result?.[0];
    const appliesTo = modifier?.applies_to as Record<string, unknown> | undefined;
    return effects?.length === 1 && effects[0].resolution === 'auto' && result?.length === 1
      && modifier?.kind === 'modifier' && modifier.op === 'deny'
      && appliesTo?.interaction === 'opportunity_attack' && appliesTo.trigger === 'self_movement'
      && (modifier.duration as Record<string, unknown> | undefined)?.type === 'until_end_of_turn';
  }).sort((a, b) => a.id.localeCompare(b.id));
}
