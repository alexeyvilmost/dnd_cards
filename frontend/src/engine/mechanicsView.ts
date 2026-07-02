/**
 * Нормализация механик: payload | полная механика | top-level интеракции (R1).
 */
type Dict = Record<string, unknown>;

const PAYLOAD_KINDS = new Set([
  'modifier', 'damage', 'healing', 'resource', 'condition', 'movement',
  'narrative', 'temp_hp', 'set_value',
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
