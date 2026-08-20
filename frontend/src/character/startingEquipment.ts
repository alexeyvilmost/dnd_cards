import type { PatchCharacterRuntimeRequest } from './api';
import type { AssembledCharacter } from './assemble';
import type { CharacterDraft } from './types';

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

/**
 * Selects both creation-time equipment branches from the already assembled
 * Forge bundle. The bundle is the creation gate's authority; catalog lists may
 * still be loading and must never be a hidden prerequisite for inventory.
 */
export function projectCharacterStartingEquipmentPatch(
  patch: PatchCharacterRuntimeRequest,
  draft: Pick<CharacterDraft, 'equipmentOption' | 'classEquipmentOption'>,
  assembled: Pick<AssembledCharacter, 'background' | 'klass'>,
): PatchCharacterRuntimeRequest {
  const backgroundOptions = assembled.background?.equipment_options;
  const backgroundOption = backgroundOptions?.[
    draft.equipmentOption === 'b' ? 'option_b' : 'option_a'
  ];
  const classOptions = assembled.klass?.equipment_options;
  const classKey = draft.classEquipmentOption === 'b'
    ? 'option_b'
    : draft.classEquipmentOption === 'c' ? 'option_c' : 'option_a';
  const classOption = classOptions?.[classKey] ?? classOptions?.option_a;
  return projectStartingEquipmentPatch(patch, backgroundOption, classOption);
}
