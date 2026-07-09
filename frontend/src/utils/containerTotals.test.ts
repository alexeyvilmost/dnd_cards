/**
 * Контейнеры S6: контейнер = сумма веса/цены вложенного. Деривация над card.contents с нормализацией
 * валют (1 ЗМ=10 СМ=100 ММ), рекурсией по вложенным контейнерам и guard'ами (цикл, само-ссылка, нет карты).
 */
import { describe, expect, it } from 'vitest';
import { containerTotals, priceInGold } from './containerTotals';
import type { Card } from '../types';

const card = (over: Partial<Card> & { id: string }): Card => ({ name: 'x', type: 'none', ...over } as unknown as Card);

describe('S6 — priceInGold / containerTotals', () => {
  it('priceInGold нормализует валюты', () => {
    expect(priceInGold(5, 'gold')).toBe(5);
    expect(priceInGold(50, 'silver')).toBeCloseTo(5);
    expect(priceInGold(500, 'copper')).toBeCloseTo(5);
    expect(priceInGold(null)).toBe(0);
  });

  it('сумма веса и цены по содержимому (× quantity)', () => {
    const idx = new Map<string, Card>([
      ['sword', card({ id: 'sword', weight: 3, price: 10, price_currency: 'gold' })],
      ['torch', card({ id: 'torch', weight: 1, price: 1, price_currency: 'copper' })],
    ]);
    const pack = card({ id: 'pack', type: 'container', contents: [{ card_id: 'sword', quantity: 1 }, { card_id: 'torch', quantity: 5 }] });
    const t = containerTotals(pack, (id) => idx.get(id));
    expect(t.weight).toBe(8); // 3 + 5*1
    expect(t.gold).toBeCloseTo(10 + 5 * 0.01);
  });

  it('рекурсия по вложенному контейнеру', () => {
    const idx = new Map<string, Card>([
      ['pouch', card({ id: 'pouch', type: 'container', weight: 1, price: 5, price_currency: 'silver', contents: [{ card_id: 'gem', quantity: 10 }] })],
      ['gem', card({ id: 'gem', weight: 0, price: 10, price_currency: 'gold' })],
    ]);
    const chest = card({ id: 'chest', type: 'container', contents: [{ card_id: 'pouch', quantity: 1 }] });
    const t = containerTotals(chest, (id) => idx.get(id));
    expect(t.weight).toBe(1);
    expect(t.gold).toBeCloseTo(0.5 + 100); // pouch 5 СМ + (10 gem × 10 ЗМ)
  });

  it('cycle-guard A→B→A не зацикливается', () => {
    const idx = new Map<string, Card>([
      ['a', card({ id: 'a', type: 'container', contents: [{ card_id: 'b', quantity: 1 }] })],
      ['b', card({ id: 'b', type: 'container', contents: [{ card_id: 'a', quantity: 1 }] })],
    ]);
    expect(() => containerTotals(idx.get('a')!, (id) => idx.get(id))).not.toThrow();
  });

  it('само-ссылка и отсутствующая карта пропускаются', () => {
    const idx = new Map<string, Card>([['x', card({ id: 'x', weight: 2, price: 1 })]]);
    const bag = card({ id: 'bag', type: 'container', contents: [{ card_id: 'bag', quantity: 1 }, { card_id: 'x', quantity: 1 }, { card_id: 'missing', quantity: 1 }] });
    expect(containerTotals(bag, (id) => idx.get(id)).weight).toBe(2);
  });
});
