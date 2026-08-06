import type { PatchCharacterRuntimeRequest } from './api';

export interface StartingEquipmentOption {
  items?: readonly {
    card_id: string;
    quantity?: number;
  }[] | null;
  gold?: number | null;
}

/**
 * Projects the selected creation-time equipment branches onto a runtime patch.
 *
 * Starting quantities replace rows for the same cards instead of being added to
 * them. That makes retries idempotent while preserving unrelated patch fields,
 * inventory rows, and non-gold currency denominations.
 */
export function projectStartingEquipmentPatch(
  patch: PatchCharacterRuntimeRequest,
  ...options: readonly (StartingEquipmentOption | null | undefined)[]
): PatchCharacterRuntimeRequest {
  const quantities = new Map<string, number>();
  for (const option of options) {
    for (const item of option?.items ?? []) {
      quantities.set(
        item.card_id,
        (quantities.get(item.card_id) ?? 0) + (item.quantity ?? 1),
      );
    }
  }

  const projected: PatchCharacterRuntimeRequest = { ...patch };
  if (quantities.size > 0) {
    const startingCardIds = new Set(quantities.keys());
    projected.inventory_items = [
      ...(patch.inventory_items ?? []).filter((item) => !startingCardIds.has(item.card_id)),
      ...[...quantities].map(([card_id, qty]) => ({ card_id, qty })),
    ];
  }

  const gold = options.reduce((sum, option) => sum + (option?.gold ?? 0), 0);
  if (gold !== 0) {
    projected.currency = { ...(patch.currency ?? {}), gold };
  }

  return projected;
}
