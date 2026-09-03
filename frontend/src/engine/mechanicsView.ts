/**
 * Нормализация механик: payload | полная механика | top-level интеракции (R1).
 */
type Dict = Record<string, unknown>;

const PAYLOAD_KINDS = new Set([
  'modifier', 'damage', 'damage_rider', 'healing', 'resource', 'condition', 'movement',
  'triggered_effect', 'fall_protection', 'movement_option', 'targeting_ward', 'turn_command',
  'stabilize', 'weapon_enchantment', 'remote_manipulator', 'communication_link',
  'world_interaction', 'illusion', 'temporary_consumable', 'world_entity',
  'information_access', 'information_reveal', 'world_zone',
  'narrative', 'temp_hp', 'set_value', 'boon', 'transform', 'reroll',
  'grant_action', 'resistance', 'variable', 'add_item',
  'condition_immunity', 'grant_sense', 'grant_speed',
  'd20_interrupt',
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
