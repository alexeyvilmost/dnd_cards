import { describe, expect, it } from 'vitest';
import { containerTransferIssue } from './containerCapacity';
import { moveToContainer } from './inventory';
import type { Card } from '../types';
import { equippedFighterState } from '../mvp/fixtures';

describe('source-owned container capacities', () => {
  it.each([['quiver', 20, 1], ['scroll-case', 10, 2]] as const)('validates %s content and quantity after reload', (id, max, unit) => {
    const container = { id, type: 'container', name: id, mechanics: { storage_profile: { max_units: max, item_units: { paper: unit } } } } as unknown as Card;
    const cards = new Map([[id, container], ['paper', { id: 'paper', name: 'Paper' } as Card], ['stone', { id: 'stone', name: 'Stone' } as Card]]);
    const state = { ...equippedFighterState(), inventory: [{ cardId: id, qty: 1 }, { cardId: 'paper', qty: max }, { cardId: 'stone', qty: 1 }] };
    const full = moveToContainer(state, 'paper', id, max / unit, cards);
    expect(full).not.toBe(state);
    const restored = JSON.parse(JSON.stringify(full));
    expect(containerTransferIssue(restored, cards, id, 'paper', 1)).toContain('число');
    expect(moveToContainer(restored, 'paper', id, 1, cards)).toBe(restored);
    expect(containerTransferIssue(state, cards, id, 'stone', 1)).toContain('не предназначен');
  });
  it.each([[6, 0.2], [30, 1]])('checks %slb/%sft³ without replacing unknown measurements with zero', (weight, volume) => {
    const container = { id: 'bag', type: 'container', name: 'Bag', mechanics: { storage_profile: { max_weight_lb: weight, max_volume_cubic_ft: volume } } } as unknown as Card;
    const item = { id: 'item', name: 'Item', weight, mechanics: { physical_profile: { volume_cubic_ft: volume } } } as unknown as Card;
    const cards = new Map([['bag', container], ['item', item]]);
    const state = { ...equippedFighterState(), inventory: [{ cardId: 'bag', qty: 1 }, { cardId: 'item', qty: 2 }] };
    expect(containerTransferIssue(state, cards, 'bag', 'item', 1)).toBeNull();
    expect(containerTransferIssue(state, cards, 'bag', 'item', 2)).toContain('вес');
    const unknown = new Map(cards); unknown.set('item', { ...item, mechanics: null });
    expect(containerTransferIssue(state, unknown, 'bag', 'item', 1)).toContain('не задан внешний объём');
    const original = JSON.stringify(state); moveToContainer(state, 'item', 'bag', 2, cards); expect(JSON.stringify(state)).toBe(original);
  });
});
