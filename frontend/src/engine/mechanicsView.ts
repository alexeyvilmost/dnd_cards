/**
 * Нормализация механик: payload | полная механика | top-level интеракции (R1).
 */
type Dict = Record<string, unknown>;

const PAYLOAD_KINDS = new Set([
  'automatic_action','item_owned_actor','magic_suppression','damage_echo','attack_redirection',
  'chance','damage_type_policy','effect_end_policy','effective_level', 'weapon_return', 'projectile_reflection','spell_projectiles','illumination',
  'cancel_execution',
  'modifier', 'damage', 'damage_rider', 'reduce_damage', 'healing', 'resource', 'condition', 'movement',
  'triggered_effect', 'fall_protection', 'movement_option', 'targeting_ward', 'turn_command',
  'stabilize', 'weapon_enchantment', 'weapon_attack_buff', 'remote_manipulator', 'communication_link',
  'spend_cost', 'world_interaction', 'illusion', 'temporary_consumable', 'world_entity',
  'recipient_binding', 'spell_effect_share', 'environment_adaptation', 'information_access', 'information_reveal', 'world_zone',
  'narrative', 'temp_hp', 'set_value', 'value_method', 'boon', 'transform', 'reroll',
  'grant_action', 'resistance', 'variable', 'add_item',
  'condition_immunity', 'grant_sense', 'grant_speed',
  'action_cost_policy', 'd20_interrupt', 'zero_hp_save', 'attunement_capacity', 'roll_influence',
  'life_policy', 'rest_policy', 'recovery_policy', 'resource_restriction', 'aura', 'area_healing', 'area_damage', 'save_reflection',
  'weapon_handling', 'ritual_casting', 'action_target_limit',
  'save_damage_policy', 'movement_policy',
  'concentration_policy','weapon_attack_policy','equipment_policy', 'purchase_price_policy','item_failure_policy',
]);

function isPayload(obj: Dict): boolean {
  const kind = String(obj.kind ?? '');
  return PAYLOAD_KINDS.has(kind);
}

function payloadsFromEffects(effects: Dict[]): Dict[] {
  const out: Dict[] = [];
  for (const eff of effects) {
    const results = (eff.result ?? eff.results) as Dict[] | undefined;
    if (Array.isArray(results)) out.push(...results);
  }
  return out;
}

/** Извлечь payload-ы из записи активного эффекта или пассивной механики. */
export function payloadsOf(mechOrPayload: Dict | null | undefined): Dict[] {
  if (!mechOrPayload || typeof mechOrPayload !== 'object') return [];
  if (isPayload(mechOrPayload)) return [mechOrPayload];

  const effects = mechOrPayload.effects as Dict[] | undefined;
  if (Array.isArray(effects)) return payloadsFromEffects(effects);

  const interactions = mechOrPayload.interactions as Dict[] | undefined;
  if (Array.isArray(interactions)) return payloadsFromEffects(interactions);

  return [];
}
