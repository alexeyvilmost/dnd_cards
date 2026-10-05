import {describe, expect, it, vi} from 'vitest';
import {createSheetCombatRuntime, type SheetCombatDataSource} from './sheetCombatRuntimeFactory';
import type {Card} from '../types';

const card = (id: string, contents: string[] = []) => ({id, name: id, card_number: id,
  ...(contents.length ? {container_mode: 'choice', contents: contents.map(card_id => ({card_id, quantity: 1}))} : {})}) as Card;
function runtime(rows: Card[]) {
  const getCardsByIds = vi.fn(async (ids: readonly string[]) => rows.filter(row => ids.includes(row.id)));
  const getCard = vi.fn(async (id: string) => rows.find(row => row.id === id)!);
  return {...createSheetCombatRuntime({cardsApi: {getCard, getCardsByIds}} as unknown as SheetCombatDataSource), getCardsByIds, getCard};
}
describe('owned combat card hydration', () => {
  it('batches only owned and transitive container references, deduplicating cycles', async () => {
    const rows = [card('kit', ['tool', 'bag']), card('tool'), card('bag', ['kit', 'gem']), card('gem'), card('unrelated')];
    const r = runtime(rows);
    const input = {name: 'Owner', equipment: {main_hand: 'tool'}, inventory_items: [{card_id: 'kit', qty: 1}]};
    const before = structuredClone(input);
    const result = await r.hydrateSheetCombatCards({character: input, cards: new Map()});
    expect([...result.keys()].sort()).toEqual(['bag', 'gem', 'kit', 'tool']);
    expect(r.getCardsByIds.mock.calls.map(([ids]) => [...ids])).toEqual([['kit', 'tool'], ['bag'], ['gem']]);
    expect(r.getCard).not.toHaveBeenCalled();
    expect(input).toEqual(before);
  });
  it.each(['missing', 'wrong-result'])('fails closed on %s without returning a partial catalog', async mode => {
    const r = runtime([card('kit', ['missing'])]);
    if (mode === 'wrong-result') r.getCardsByIds.mockResolvedValue([card('foreign')]);
    await expect(r.hydrateSheetCombatCards({character: {name: 'Owner', equipment: {}, inventory_items: [{card_id: 'kit', qty: 1}]}, cards: new Map()})).rejects.toThrow();
  });
  it('uses the existing canonical per-ID resolver for pinned/legacy adapters', async () => {
    const r = runtime([]), rows = [card('box', ['item']), card('item')];
    const loadCard = vi.fn(async (id: string) => rows.find(row => row.id === id)!);
    const result = await r.hydrateSheetCombatCards({character: {name: 'Owner', equipment: {main_hand: 'box'}, inventory_items: []}, cards: new Map(), loadCard});
    expect([...result.keys()]).toEqual(['box', 'item']);
    expect(loadCard.mock.calls.map(([id]) => id)).toEqual(['box', 'item']);
    expect(r.getCardsByIds).not.toHaveBeenCalled();
  });
});
