import definitions from '../engine/data/decisionPolicies.json';
import {payloadsOf} from '../engine/mechanicsView';
import type {RollLog} from '../mvp/contracts';
import type {RuleActionDefinition} from '../rules-core/domain';

export interface DecisionPolicyToggle {
  id: string;
  presentationKey?: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
  predicate: string;
  imageUrl?: string;
  enabledDescription?: string;
  disabledDescription?: string;
}
export function decisionPolicyToggles(scope: string, action?: RuleActionDefinition): DecisionPolicyToggle[] {
  const declared = action?.mechanics.decision_policies;
  return definitions.filter(rule => rule.scope === scope && (!rule.selector
    || (Array.isArray(declared) && declared.includes(rule.id))
    || (rule.selector === 'ac_defense' && action && (Boolean(action.mechanics.attack_defense)
      || payloadsOf(action.mechanics).some(payload => payload.kind === 'modifier'
        && (payload.applies_to as Record<string, unknown> | undefined)?.roll === 'ac')))))
    .map(rule => ({...rule, presentationKey:rule.id, id: action ? `${rule.id}:${action.id}` : rule.id}));
}
export function decisionPolicyEnabled(toggle: DecisionPolicyToggle, preferences: Readonly<Record<string, boolean>>) {
  return preferences[toggle.id] ?? toggle.defaultEnabled;
}
/** Unknown context always leaves the choice with the player. These are offer
 * policies, never permission to spend a resource or alter a saved die. */
export function decisionOfferVisible(toggles: DecisionPolicyToggle[], preferences: Readonly<Record<string, boolean>>,
  context: {roll?: RollLog; changesOutcome?: boolean}) {
  return toggles.every(toggle => !decisionPolicyEnabled(toggle, preferences)
    || (toggle.predicate === 'attack_not_successful'
      ? !(context.roll?.target?.type === 'ac' && ['hit', 'crit'].includes(context.roll.outcome ?? ''))
      : toggle.predicate === 'changes_attack_outcome' ? context.changesOutcome !== false : true));
}
