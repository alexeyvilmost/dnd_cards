/**
 * S2 «предмет=эффект»: единый гейт применимости данными (equipped|carried|attuned) + сбор механик из
 * СУМКИ (carried), а не только слотов. Плюс roll-time предикаты item_equipped/item_carried/attuned
 * (оживляют when-гейты «пока предмет X надет/в сумке»). Обратная совместимость: нет `while` → equipped.
 */
import { describe, expect, it } from 'vitest';
import { itemGate, itemWhile, collectItemMechanics, type ItemGateContext } from './attunement';
import { evaluateCondition } from '../engine/circumstances';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

const baseMech = { effects: [{ resolution: 'auto', result: [{ kind: 'modifier', applies_to: { roll: 'ac' }, value: '+1' }] }] };

function card(id: string, opts: { while?: string; attune?: boolean; noMech?: boolean; topWhile?: boolean } = {}): Card {
  let mechanics: Record<string, unknown> | null = opts.noMech ? null : { ...baseMech };
  if (mechanics && opts.while) {
    mechanics = opts.topWhile
      ? { ...mechanics, while: opts.while }
      : { ...mechanics, activation: { mode: 'passive', while: opts.while } };
  }
  return { id, name: id, mechanics, requires_attunement: opts.attune ?? false } as unknown as Card;
}

const gc = (over: Partial<ItemGateContext> = {}): ItemGateContext => ({ equipment: {}, inventory: [], attuned: [], ...over });
const equippedCtx = (id: string) => gc({ equipment: { main_hand: id } });
const baggedCtx = (id: string) => gc({ inventory: [{ cardId: id, qty: 1 }] });

describe('S2 — itemGate (единый гейт данными)', () => {
  it('нет while → активна только пока НАДЕТ (прежнее поведение)', () => {
    expect(itemGate(card('a'), equippedCtx('a'))).toBe(true);
    expect(itemGate(card('a'), baggedCtx('a'))).toBe(false);
  });

  it('while:carried → активна и в слоте, и в сумке', () => {
    expect(itemGate(card('a', { while: 'carried' }), equippedCtx('a'))).toBe(true);
    expect(itemGate(card('a', { while: 'carried' }), baggedCtx('a'))).toBe(true);
    expect(itemGate(card('a', { while: 'carried' }), gc())).toBe(false); // ни надет, ни в сумке
  });

  it('while:carried читается и из top-level mechanics.while (пассивные предметы без activation)', () => {
    expect(itemWhile(card('a', { while: 'carried', topWhile: true }))).toBe('carried');
    expect(itemGate(card('a', { while: 'carried', topWhile: true }), baggedCtx('a'))).toBe(true);
  });

  it('while:attuned → активна только пока настроены', () => {
    expect(itemGate(card('a', { while: 'attuned' }), gc({ attuned: ['a'] }))).toBe(true);
    expect(itemGate(card('a', { while: 'attuned' }), gc({ attuned: [] }))).toBe(false);
  });

  it('настройка — жёсткое требование поверх любой локации', () => {
    // carried, лежит в сумке, но не настроен → молчит (PHB: без настройки магия не работает).
    expect(itemGate(card('a', { while: 'carried', attune: true }), baggedCtx('a'))).toBe(false);
    expect(itemGate(card('a', { while: 'carried', attune: true }), gc({ inventory: [{ cardId: 'a', qty: 1 }], attuned: ['a'] }))).toBe(true);
  });

  it('requires_attunement по умолчанию (equipped) — надет+настроен', () => {
    expect(itemGate(card('a', { attune: true }), gc({ equipment: { body: 'a' }, attuned: ['a'] }))).toBe(true);
    expect(itemGate(card('a', { attune: true }), gc({ equipment: { body: 'a' }, attuned: [] }))).toBe(false);
  });

  it('без механик → false', () => {
    expect(itemGate(card('a', { noMech: true }), equippedCtx('a'))).toBe(false);
  });

  it('пустая activation.while не затеняет top-level mechanics.while', () => {
    const c = { id: 'a', name: 'a', mechanics: { ...baseMech, while: 'carried', activation: { mode: 'passive', while: '' } }, requires_attunement: false } as unknown as Card;
    expect(itemWhile(c)).toBe('carried');
    expect(itemGate(c, baggedCtx('a'))).toBe(true);
  });
});

describe('S2 — collectItemMechanics сканирует сумку', () => {
  const map = new Map<string, Card>([
    ['carried', card('carried', { while: 'carried' })],
    ['plain', card('plain')],
    ['worn', card('worn')],
  ]);

  it('предмет while:carried из СУМКИ попадает в набор', () => {
    const out = collectItemMechanics({}, map, null, [{ cardId: 'carried', qty: 1 }]);
    expect(out.map((im) => im.card.id)).toEqual(['carried']);
  });

  it('обычный предмет в сумке (без while) НЕ попадает', () => {
    const out = collectItemMechanics({}, map, null, [{ cardId: 'plain', qty: 1 }]);
    expect(out).toEqual([]);
  });

  it('надетый предмет попадает; дедуп по id (нет дублей)', () => {
    const out = collectItemMechanics({ main_hand: 'worn' }, map, null, [{ cardId: 'worn', qty: 0 }]);
    expect(out.map((im) => im.card.id)).toEqual(['worn']);
  });

  it('обратная совместимость: без аргумента inventory — только надетые', () => {
    const out = collectItemMechanics({ body: 'worn' }, map, null);
    expect(out.map((im) => im.card.id)).toEqual(['worn']);
  });
});

describe('S2 — roll-time предикаты item_equipped/item_carried/attuned', () => {
  const state = { equipment: { main_hand: 'sword' }, inventory: [{ cardId: 'arrow', qty: 20 }] } as unknown as RuntimeState;

  it('item_equipped: true для надетого, false для лежащего в сумке', () => {
    expect(evaluateCondition({ kind: 'item_equipped', id: 'sword' }, { state })).toBe(true);
    expect(evaluateCondition({ kind: 'item_equipped', id: 'arrow' }, { state })).toBe(false);
  });

  it('item_carried: true и для надетого, и для лежащего в сумке', () => {
    expect(evaluateCondition({ kind: 'item_carried', id: 'sword' }, { state })).toBe(true);
    expect(evaluateCondition({ kind: 'item_carried', id: 'arrow' }, { state })).toBe(true);
    expect(evaluateCondition({ kind: 'item_carried', id: 'ghost' }, { state })).toBe(false);
  });

  it('attuned: читает character.attunedIds', () => {
    expect(evaluateCondition({ kind: 'attuned', id: 'ring' }, { character: { attunedIds: ['ring'] } as never })).toBe(true);
    expect(evaluateCondition({ kind: 'attuned', id: 'ring' }, { character: { attunedIds: [] } as never })).toBe(false);
  });

  it('нет id / нет state → false (closed-by-default)', () => {
    expect(evaluateCondition({ kind: 'item_equipped', id: 'sword' }, {})).toBe(false);
    expect(evaluateCondition({ kind: 'item_carried' }, { state })).toBe(false);
  });

  it('частичный state (без inventory/equipment) → false, НЕ исключение', () => {
    const partial = {} as unknown as RuntimeState;
    expect(() => evaluateCondition({ kind: 'item_carried', id: 'x' }, { state: partial })).not.toThrow();
    expect(evaluateCondition({ kind: 'item_carried', id: 'x' }, { state: partial })).toBe(false);
    expect(evaluateCondition({ kind: 'item_equipped', id: 'x' }, { state: partial })).toBe(false);
  });
});
