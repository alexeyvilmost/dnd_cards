import type { Card, CharacterClass } from '../types';

export class ClassEquipmentReferenceIntegrityError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Class starting-equipment references are invalid:\n${problems.join('\n')}`);
    this.name = 'ClassEquipmentReferenceIntegrityError';
  }
}

/**
 * Checks every starting-equipment branch, including branches not selected by a
 * particular Forge root, against the one active card catalog.
 */
export function assertClassEquipmentReferenceClosure(
  classes: readonly CharacterClass[],
  cards: readonly Card[],
): void {
  const cardIdCounts = new Map<string, number>();
  for (const card of cards) {
    cardIdCounts.set(card.id, (cardIdCounts.get(card.id) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const klass of classes.filter((candidate) => !candidate.is_subclass)) {
    for (const [optionKey, option] of Object.entries(klass.equipment_options ?? {})) {
      if (!option) continue;
      for (const [itemIndex, item] of (option.items ?? []).entries()) {
        const subject = `${klass.card_number}.${optionKey}.items[${itemIndex}]`;
        if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
          problems.push(`${subject}: quantity must be a positive integer`);
        }
        const count = cardIdCounts.get(item.card_id) ?? 0;
        if (count !== 1) {
          problems.push(`${subject}: card_id ${item.card_id || '<blank>'} resolves ${count} times`);
        }
      }
    }
  }
  if (problems.length > 0) throw new ClassEquipmentReferenceIntegrityError(problems);
}
