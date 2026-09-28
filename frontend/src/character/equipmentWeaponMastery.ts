import type { Card, EquipmentOption } from '../types';

/** Distinct weapon_type values from a starting-equipment package, in package order. */
export function weaponTypesFromEquipmentOption(
  option: Pick<EquipmentOption, 'items'> | null | undefined,
  cardsById: ReadonlyMap<string, Pick<Card, 'weapon_type'>>,
): string[] {
  const types: string[] = [];
  const seen = new Set<string>();
  for (const item of option?.items ?? []) {
    const weaponType = cardsById.get(item.card_id)?.weapon_type?.trim();
    if (!weaponType || seen.has(weaponType)) continue;
    seen.add(weaponType);
    types.push(weaponType);
  }
  return types;
}

/**
 * Auto-fill weapon mastery only when the selected package is designated for
 * automatic mastery seeding. Other packages leave the choice to the player,
 * even when they happen to include enough weapons.
 */
export function equipmentWeaponMasterySeed(input: {
  choiceId: string;
  count: number;
  optionKey: string;
  weaponTypes: readonly string[];
  autoFillEnabled: boolean;
  resolved: Readonly<Record<string, readonly string[]>>;
  previousAutoKey: string | null;
}): { next: Record<string, string[]> | null; autoKey: string | null; clearChoiceId?: string } {
  const { choiceId, count, optionKey, weaponTypes, autoFillEnabled, resolved, previousAutoKey } = input;
  if (count < 1) return { next: null, autoKey: previousAutoKey };
  const seed = weaponTypes.slice(0, count);
  const autoKey = seed.length >= count ? `${optionKey}:${seed.join(',')}` : null;
  const current = resolved[choiceId];
  const currentMatchesPreviousAuto = previousAutoKey != null
    && current?.join(',') === previousAutoKey.slice(previousAutoKey.indexOf(':') + 1);

  if (!autoFillEnabled) {
    if (previousAutoKey && currentMatchesPreviousAuto) {
      return { next: null, autoKey: null, clearChoiceId: choiceId };
    }
    return { next: null, autoKey: null };
  }

  if (autoKey) {
    if (Object.prototype.hasOwnProperty.call(resolved, choiceId) && !currentMatchesPreviousAuto
      && previousAutoKey !== autoKey && current?.length) {
      // Player already chose; do not overwrite.
      return { next: null, autoKey: previousAutoKey };
    }
    if (current?.join(',') === seed.join(',')) return { next: null, autoKey };
    return { next: { [choiceId]: seed }, autoKey };
  }

  // Gold-only / no weapons: drop an auto-filled selection so the player chooses.
  if (previousAutoKey && currentMatchesPreviousAuto) {
    return { next: null, autoKey: null, clearChoiceId: choiceId };
  }
  return { next: null, autoKey: null };
}
