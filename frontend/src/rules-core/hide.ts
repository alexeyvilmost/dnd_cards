import type {HideEligibilityFacts, RuleActionDefinition} from './domain';

export function hideEligibilityIssue(facts: HideEligibilityFacts | undefined): string | null {
  if (!facts || typeof facts !== 'object') return 'Hide requires explicit eligibility facts';
  if (!['scenario', 'board', 'gm_ruling'].includes(facts.factsSource)) {
    return 'Hide facts require a recognized source';
  }
  if (!Number.isInteger(facts.boardRevision) || facts.boardRevision < 0) {
    return 'Hide facts require a non-negative board revision';
  }
  if (typeof facts.heavilyObscured !== 'boolean' || typeof facts.visibleToAnyEnemy !== 'boolean'
    || !['none', 'half', 'three_quarters', 'total'].includes(facts.cover)) {
    return 'Hide facts are malformed';
  }
  const hasRequiredObscurement = facts.heavilyObscured
    || facts.cover === 'three_quarters'
    || facts.cover === 'total';
  if (!hasRequiredObscurement) {
    return 'Hide requires Heavy Obscurement, Three-Quarters Cover, or Total Cover';
  }
  if (facts.visibleToAnyEnemy) {
    return 'Hide is unavailable while any enemy can see the actor';
  }
  return null;
}

/** A cost-only declaration delegates the check and its lifecycle to the canonical Hide action. */
export function hideActionDeclarationIssue(action: RuleActionDefinition): string | null {
  if (action.kind !== 'nonSpell' || action.attackReplacement || action.concentration || action.restDecision) return 'Hide must be a standalone non-Magic action';
  const targeting = action.targeting;
  if (targeting && (targeting.minTargets !== 0 || targeting.maxTargets > 1
    || targeting.requiresSight || targeting.requiresTargetPerception || targeting.requiresWilling
    || targeting.requiresUnarmored || targeting.requiresTouch || targeting.requiresStoneworkContact)) return 'Hide cannot discard additional targeting requirements';
  const mechanics = action.mechanics;
  const rawTargeting = mechanics.targeting as Record<string, unknown> | undefined;
  if (rawTargeting && (rawTargeting.shape !== 'self'
    || Object.keys(rawTargeting).some(key => !['shape', 'domain', 'actor_targets', 'min_targets', 'max_targets', 'range_ft', 'requires_line_of_sight', 'allowed_relations'].includes(key))
    || rawTargeting.actor_targets !== false || rawTargeting.min_targets !== 0 || rawTargeting.max_targets !== 1
    || rawTargeting.range_ft !== 0 || rawTargeting.requires_line_of_sight !== false
    || JSON.stringify(rawTargeting.allowed_relations) !== '["self"]')) return 'Hide requires unrestricted self targeting';
  if (Object.keys(mechanics).some(key => !['name', 'activation', 'effects', 'targeting'].includes(key))) return 'Hide declaration contains unsupported mechanics';
  const activation = mechanics.activation as Record<string, unknown> | undefined;
  if (!activation || activation.mode !== 'active' || activation.counts_as !== 'hide'
    || Object.keys(activation).some(key => !['mode', 'cost', 'counts_as'].includes(key))) return 'Hide requires an active cost-only declaration';
  if (!Array.isArray(mechanics.effects) || mechanics.effects.length !== 0) return 'Hide consequences belong to the canonical action';
  const costs = activation.cost;
  if (!Array.isArray(costs) || costs.length !== 1) return 'Hide requires exactly one action cost';
  const cost = costs[0];
  if (!cost || typeof cost !== 'object' || !['action', 'bonus_action'].includes(cost.resource)
    || (cost.amount !== undefined && cost.amount !== 1)
    || Object.keys(cost).some(key => !['resource', 'amount'].includes(key))) return 'Hide requires one Action or Bonus Action';
  return null;
}
