import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { EQUIPMENT_SLOTS, planEquip, type EquipmentSlotKey } from '../engine/equipment';
import type { PaperSheetDocument } from './model';
import { paperEntityToken, parsePaperEntityToken } from './references';

export const DEFAULT_PAPER_INVENTORY_ROWS = 28;
export const MAX_PAPER_INVENTORY_ROWS = 100;

export function paperInventoryRows(raw?: string): number {
  if (raw === undefined || !raw.trim()) return DEFAULT_PAPER_INVENTORY_ROWS;
  const count = Number(raw);
  return Number.isFinite(count) ? Math.max(0, Math.min(MAX_PAPER_INVENTORY_ROWS, Math.floor(count))) : DEFAULT_PAPER_INVENTORY_ROWS;
}

export function paperInventoryQuantity(raw: string): number {
  const count = Number(raw);
  return Number.isFinite(count) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(count))) : 0;
}

function rowQuantity(fields: Record<string, string>, row: number): number {
  return paperInventoryQuantity(fields[`inventory.${row}.quantity`]?.trim() || (fields[`inventory.${row}.item`] ? '1' : '0'));
}

/** Slot eligibility and two-handed occupancy come from the interactive sheet's planner. */
function targetSlots(card: Card, target: EquipmentSlotKey) {
  const equipment = Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, slot === target ? null : 'occupied-slot']));
  const plan = planEquip({ equipment } as RuntimeState, card);
  if (plan.error) throw new Error(plan.error);
  if (!plan.slots.includes(target)) throw new Error('Этот предмет не подходит для выбранного слота.');
  return plan.slots;
}

function occupiedSlots(fields: Record<string, string>, slot: EquipmentSlotKey, cards: ReadonlyMap<string, Card>): EquipmentSlotKey[] {
  const entity = parsePaperEntityToken(fields[`equipment.${slot}`] ?? '');
  const card = entity?.type === 'card' ? cards.get(entity.id) : undefined;
  if (!card) return [slot];
  const plan = planEquip({ equipment: {} } as RuntimeState, card);
  if (plan.slots.includes('main_hand') && plan.slots.includes('off_hand') && (slot === 'main_hand' || slot === 'off_hand')) {
    return (['main_hand', 'off_hand'] as const).filter(hand => parsePaperEntityToken(fields[`equipment.${hand}`] ?? '')?.id === card.id);
  }
  return [slot];
}

function returnToInventory(fields: Record<string, string>, token: string) {
  const entity = parsePaperEntityToken(token);
  const rows = paperInventoryRows(fields.inventoryRows);
  let row = Array.from({ length: rows }, (_, index) => index).find(index => {
    const existing = fields[`inventory.${index}.item`] ?? '';
    const reference = parsePaperEntityToken(existing);
    return entity ? reference?.type === entity.type && reference.id === entity.id : existing === token;
  });
  if (row !== undefined) {
    const count = rowQuantity(fields, row);
    if (count >= Number.MAX_SAFE_INTEGER) throw new Error('Количество предметов слишком велико.');
    fields[`inventory.${row}.quantity`] = String(count + 1);
    return;
  }
  row = Array.from({ length: rows }, (_, index) => index).find(index => !fields[`inventory.${index}.item`] || rowQuantity(fields, index) === 0);
  if (row === undefined) {
    if (rows >= MAX_PAPER_INVENTORY_ROWS) throw new Error('В инвентаре нет свободной строки. Освободите строку перед снятием предмета.');
    row = rows;
    fields.inventoryRows = String(rows + 1);
  }
  fields[`inventory.${row}.item`] = token;
  fields[`inventory.${row}.quantity`] = '1';
}

function removeEquipment(fields: Record<string, string>, slot: EquipmentSlotKey, cards: ReadonlyMap<string, Card>) {
  const token = fields[`equipment.${slot}`];
  if (!token) return;
  const slots = occupiedSlots(fields, slot, cards);
  for (const occupied of slots) fields[`equipment.${occupied}`] = '';
  returnToInventory(fields, token);
}

export function equipPaperItem(document: PaperSheetDocument, card: Card, target: EquipmentSlotKey, cards: ReadonlyMap<string, Card>, sourceRow?: number): { document: PaperSheetDocument; error?: string } {
  try {
    const slots = targetSlots(card, target);
    const fields = { ...document.fields };
    // Re-selecting the same equipped entry does not create an additional copy.
    if (sourceRow === undefined && slots.every(slot => parsePaperEntityToken(fields[`equipment.${slot}`] ?? '')?.id === card.id)) return { document };
    let source = sourceRow;
    if (source === undefined) source = Array.from({ length: paperInventoryRows(fields.inventoryRows) }, (_, row) => row).find(row => parsePaperEntityToken(fields[`inventory.${row}.item`] ?? '')?.id === card.id && rowQuantity(fields, row) > 0);
    if (source !== undefined) {
      const entity = parsePaperEntityToken(fields[`inventory.${source}.item`] ?? '');
      const quantity = rowQuantity(fields, source);
      if (entity?.type !== 'card' || entity.id !== card.id || quantity < 1) throw new Error('Предмета больше нет в выбранной строке инвентаря.');
      fields[`inventory.${source}.quantity`] = String(quantity - 1);
    }
    for (const slot of slots) removeEquipment(fields, slot, cards);
    const token = paperEntityToken({ type: 'card', id: card.id, name: card.name });
    for (const slot of slots) fields[`equipment.${slot}`] = token;
    return { document: { ...document, fields } };
  } catch (cause) { return { document, error: cause instanceof Error ? cause.message : 'Не удалось надеть предмет.' }; }
}

export function unequipPaperItem(document: PaperSheetDocument, slot: EquipmentSlotKey, cards: ReadonlyMap<string, Card>): { document: PaperSheetDocument; error?: string } {
  try {
    const fields = { ...document.fields };
    removeEquipment(fields, slot, cards);
    return { document: { ...document, fields } };
  } catch (cause) { return { document, error: cause instanceof Error ? cause.message : 'Не удалось снять предмет.' }; }
}
