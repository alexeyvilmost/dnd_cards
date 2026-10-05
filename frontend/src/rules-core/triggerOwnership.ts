import type {RuleActionDefinition} from './domain';

const worldKeys = new Set(['event', 'events', 'timing', 'subject', 'circumstances',
  'observer_range_ft', 'observer_relations', 'exclude_self_target', 'target_event']);
// These declarations need the board's captured attack, movement, chosen target
// or turn ledger. The world event queue must not execute a partial predicate.
const boardKeys = new Set(['damage_reduced_to_zero', 'disarm_held_item', 'feat_charger',
  'feat_damage_type', 'feat_gwm_hew', 'feat_max_relative_size', 'feat_once_per_turn',
  'feat_polearm_master_butt', 'feat_requires_melee', 'feat_requires_shield',
  'feat_sentinel_opportunity', 'maneuvering_movement', 'melee_counterattack',
  'requires_melee_hit', 'requires_weapon_damage_own_turn', 'requires_weapon_or_unarmed_hit',
  'secondary_target', 'source_action_card_number', 'source_action_card_numbers',
  'source_weapon_qualifier', 'target_domain']);
const phaseKeys = new Set(['attack_roll_bonus_die']);

export function triggerOwner(action: RuleActionDefinition): 'world' | 'board' | 'phase' | 'unsupported' {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const trigger = activation?.trigger as Record<string, unknown> | undefined;
  if (!trigger || typeof trigger !== 'object' || Array.isArray(trigger)) return 'unsupported';
  const keys = Object.keys(trigger);
  if (keys.some(key => !worldKeys.has(key) && !boardKeys.has(key) && !phaseKeys.has(key))) return 'unsupported';
  if (keys.some(key => phaseKeys.has(key))) return 'phase';
  if (keys.some(key => boardKeys.has(key))) return 'board';
  const needsAttackContext = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(needsAttackContext);
    if (!value || typeof value !== 'object') return false;
    const row = value as Record<string, unknown>;
    return row.range_from_triggering_attack === true || row.type === 'triggering_attack'
      || Object.values(row).some(needsAttackContext);
  };
  if (needsAttackContext(action.mechanics)) return 'board';
  if (trigger.subject !== undefined && trigger.subject !== 'self') return 'unsupported';
  return 'world';
}

function reactionTriggers(action: RuleActionDefinition): string[] {
  const activation = action.mechanics.activation as Record<string, unknown> | undefined;
  const trigger = activation?.trigger as Record<string, unknown> | undefined;
  if (String(activation?.mode ?? 'active') !== 'reaction' && String(activation?.mode ?? 'active')!=='triggered') return [];
  const declared = [
    ...(typeof trigger?.event === 'string' ? [trigger.event] : []),
    ...(Array.isArray(trigger?.events) ? trigger.events.map(String) : []),
  ].filter(Boolean);
  return [...new Set(declared)];
}

export function hasReactionTrigger(action: RuleActionDefinition, trigger: string): boolean {
  return reactionTriggers(action).includes(trigger);
}
