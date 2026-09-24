import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { createPaperSheet, exportPaperSheet, importPaperSheet } from './model';
import { equipPaperItem, paperInventoryQuantity, paperInventoryRows, unequipPaperItem } from './paperEquipment';
import { paperEntityToken, parsePaperEntityToken } from './references';

const card = (id: string, slot: Card['slot'], type: Card['type'] = 'weapon'): Card => ({ id, name: `Предмет ${id}`, slot, type, properties: [], description: '', rarity: 'common', card_number: id, is_template: 'false', created_at: '', updated_at: '' });
const sword = card('sword', 'one_hand');
const axe = card('axe', 'two_hands');
const armor = card('armor', 'body', 'chest');
const helmet = card('helmet', 'head', 'helmet');
const catalogue = new Map([sword, axe, armor, helmet].map(item => [item.id, item]));
const token = (item: Card) => paperEntityToken({ type: 'card', id: item.id, name: item.name });
const quantity = (fields: Record<string, string>, id: string) => Array.from({ length: paperInventoryRows(fields.inventoryRows) }, (_, row) => row).filter(row => parsePaperEntityToken(fields[`inventory.${row}.item`] ?? '')?.id === id).reduce((sum, row) => sum + Number(fields[`inventory.${row}.quantity`] ?? 1), 0);

describe('paper inventory transfers through canonical equipment plans', () => {
  it('moves one item out of inventory, returns the displaced item, and survives export/import', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, inventoryRows: '2', 'inventory.0.item': token(helmet), 'inventory.0.quantity': '3', 'equipment.head': token(card('old-helmet', 'head', 'helmet')) };
    sheet.sections.goals = { text: 'Старые записи', fontSize: 12 };
    const result = equipPaperItem(sheet, helmet, 'head', catalogue, 0);
    expect(result.error).toBeUndefined();
    expect(quantity(result.document.fields, helmet.id)).toBe(2);
    expect(quantity(result.document.fields, 'old-helmet')).toBe(1);
    expect(parsePaperEntityToken(result.document.fields['equipment.head'])?.id).toBe(helmet.id);
    expect(sheet.fields['inventory.0.quantity']).toBe('3');
    expect(importPaperSheet(exportPaperSheet(result.document))).toEqual(result.document);
    expect(result.document.sections.goals.text).toBe('Старые записи');
  });

  it('preserves two separate copies of the same one-handed item across hand slots', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, inventoryRows: '1', 'inventory.0.item': token(sword), 'inventory.0.quantity': '2' };
    const main = equipPaperItem(sheet, sword, 'main_hand', catalogue, 0).document;
    const both = equipPaperItem(main, sword, 'off_hand', catalogue, 0).document;
    expect(quantity(both.fields, sword.id)).toBe(0);
    const removed = unequipPaperItem(both, 'main_hand', catalogue).document;
    expect(removed.fields['equipment.main_hand']).toBe('');
    expect(parsePaperEntityToken(removed.fields['equipment.off_hand'])?.id).toBe(sword.id);
    expect(quantity(removed.fields, sword.id)).toBe(1);
  });

  it('occupies both hands for one two-handed item and returns each displaced one-handed copy', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, inventoryRows: '2', 'inventory.0.item': token(axe), 'inventory.0.quantity': '1', 'equipment.main_hand': token(sword), 'equipment.off_hand': token(sword) };
    const equipped = equipPaperItem(sheet, axe, 'off_hand', catalogue, 0);
    expect(equipped.error).toBeUndefined();
    expect(equipped.document.fields['equipment.main_hand']).toBe(token(axe));
    expect(equipped.document.fields['equipment.off_hand']).toBe(token(axe));
    expect(quantity(equipped.document.fields, sword.id)).toBe(2);
    const removed = unequipPaperItem(equipped.document, 'off_hand', catalogue).document;
    expect(removed.fields['equipment.main_hand']).toBe('');
    expect(removed.fields['equipment.off_hand']).toBe('');
    expect(quantity(removed.fields, axe.id)).toBe(1);
    expect(quantity(removed.fields, sword.id)).toBe(2);
  });

  it('uses canonical slot eligibility for a different entity and rejects invalid targets atomically', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, inventoryRows: '1', 'inventory.0.item': token(armor), 'inventory.0.quantity': '1' };
    const invalid = equipPaperItem(sheet, armor, 'head', catalogue, 0);
    expect(invalid.error).toContain('не подходит');
    expect(invalid.document).toBe(sheet);
    const valid = equipPaperItem(sheet, armor, 'body', catalogue, 0);
    expect(valid.error).toBeUndefined();
    expect(quantity(valid.document.fields, armor.id)).toBe(0);
    expect(valid.document.fields['equipment.body']).toBe(token(armor));
  });

  it('rejects stale or empty inventory sources without moving equipment', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, 'inventory.0.item': token(armor), 'inventory.0.quantity': '0' };
    expect(equipPaperItem(sheet, armor, 'body', catalogue, 0).document).toBe(sheet);
    expect(equipPaperItem(sheet, helmet, 'head', catalogue, 0).document).toBe(sheet);
  });

  it('uses an existing inventory copy for direct slot selection and makes same-item reselection a no-op', () => {
    const sheet = createPaperSheet();
    sheet.fields = { ...sheet.fields, 'inventory.0.item': token(helmet), 'inventory.0.quantity': '2' };
    const first = equipPaperItem(sheet, helmet, 'head', catalogue).document;
    expect(quantity(first.fields, helmet.id)).toBe(1);
    expect(equipPaperItem(first, helmet, 'head', catalogue).document).toBe(first);
    expect(quantity(unequipPaperItem(first, 'head', catalogue).document.fields, helmet.id)).toBe(2);
  });

  it('does not lose an equipped item when all inventory rows are occupied', () => {
    const sheet = createPaperSheet();
    sheet.fields.inventoryRows = '100';
    for (let row = 0; row < 100; row++) {
      sheet.fields[`inventory.${row}.item`] = token(card(`item-${row}`, 'one_hand'));
      sheet.fields[`inventory.${row}.quantity`] = '1';
    }
    sheet.fields['equipment.head'] = token(helmet);
    const result = unequipPaperItem(sheet, 'head', catalogue);
    expect(result.error).toContain('нет свободной строки');
    expect(result.document).toBe(sheet);
  });

  it('normalizes displayed row counts and edited quantities to finite nonnegative integers', () => {
    expect(paperInventoryRows()).toBe(28);
    expect(paperInventoryRows('-5')).toBe(0);
    expect(paperInventoryRows('10000')).toBe(100);
    expect(paperInventoryRows('bad')).toBe(28);
    expect(paperInventoryQuantity('-3')).toBe(0);
    expect(paperInventoryQuantity('2.9')).toBe(2);
    expect(paperInventoryQuantity('Infinity')).toBe(0);
  });
});
