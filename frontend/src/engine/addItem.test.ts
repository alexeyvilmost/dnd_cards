/**
 * Контейнеры S1: примитив add_item — рантайм-выдача предмета в инвентарь ИСПОЛНИТЕЛЯ. Краеугольный
 * для всех трёх поведений контейнеров (распаковка/выбор/выдача). Имя вне grant_-неймспейса намеренно
 * (in-play choice вырезает grant_*). Персист инвентаря включается событием item_added (см. панель).
 */
import { describe, expect, it } from 'vitest';
import { executeAction } from './execute';
import type { CharacterContext, ExecuteContext, RuntimeState } from '../mvp/contracts';

const character: CharacterContext = { abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 5 };
const ctx = { character, rng: () => 0.5 } as unknown as ExecuteContext;
const fresh = (inv: { cardId: string; qty: number }[] = []): RuntimeState =>
  ({ hp: { current: 10, max: 10, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: inv, activeEffects: [] } as unknown as RuntimeState);
const addAct = (card_id: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ name: 'Дать', activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'auto', result: [{ kind: 'add_item', card_id, ...extra }] }] });

describe('S1 — add_item (рантайм-выдача предмета)', () => {
  it('добавляет предмет в инвентарь + событие item_added с итогом', () => {
    const r = executeAction(fresh(), addAct('arrow'), ctx);
    expect(r.state.inventory.find((i) => i.cardId === 'arrow')?.qty).toBe(1);
    expect(r.events.some((e) => e.type === 'item_added' && e.cardId === 'arrow' && e.total === 1)).toBe(true);
  });

  it('qty>1 стопкуется с существующим', () => {
    const r = executeAction(fresh([{ cardId: 'arrow', qty: 3 }]), addAct('arrow', { qty: 5 }), ctx);
    expect(r.state.inventory.find((i) => i.cardId === 'arrow')?.qty).toBe(8);
  });

  it('несколько add_item в одном действии (распаковка набора)', () => {
    const unpack = { name: 'Распаковать', activation: { mode: 'active', cost: [] }, effects: [{ resolution: 'auto', result: [
      { kind: 'add_item', card_id: 'lute' }, { kind: 'add_item', card_id: 'costume', qty: 2 },
    ] }] };
    const r = executeAction(fresh(), unpack, ctx);
    expect(r.state.inventory.find((i) => i.cardId === 'lute')?.qty).toBe(1);
    expect(r.state.inventory.find((i) => i.cardId === 'costume')?.qty).toBe(2);
  });

  it('пустой card_id — предмет не выдан + диагностика (опечатка имени поля)', () => {
    const r = executeAction(fresh(), addAct(''), ctx);
    expect(r.state.inventory).toEqual([]);
    expect(r.events.some((e) => e.type === 'narrative' && /card_id/.test(e.text))).toBe(true);
  });

  it('qty клампится к ≥1 целому (мусорный qty → 1)', () => {
    expect(executeAction(fresh(), addAct('x', { qty: -3 }), ctx).state.inventory.find((i) => i.cardId === 'x')?.qty).toBe(1);
    expect(executeAction(fresh(), addAct('y', { qty: 0 }), ctx).state.inventory.find((i) => i.cardId === 'y')?.qty).toBe(1);
  });
});
