/**
 * Контейнеры S4: вложенность инвентаря. Строка инвентаря получила containerId (= cardId контейнера,
 * undefined = верхний уровень). Стопка различается по cardId+containerId; количество/трата/добавление
 * стали location-aware (сумма по локациям; add на верхний уровень; списание — всего, предпочитая верх).
 * Хелперы containerContents/containerWeight (рекурсия+cycle-guard)/moveToContainer/moveOutOfContainer.
 */
import { describe, expect, it } from 'vitest';
import { inventoryQty, containerContents, containerWeight, moveToContainer, moveOutOfContainer } from './inventory';
import { addToInventory, removeFromInventory, forgeToRuntimeState, runtimeInventoryPayload } from './runtime';
import { canPay, pay } from '../engine/cost';
import type { RuntimeState } from '../mvp/contracts';

type Row = { cardId: string; qty: number; containerId?: string };
const st = (inv: Row[]): RuntimeState =>
  ({ hp: { current: 1, max: 1, temp: 0 }, resources: {}, maxResources: {}, equipment: {}, inventory: inv, activeEffects: [] } as unknown as RuntimeState);

describe('S4 — вложенность инвентаря (containerId)', () => {
  it('splits and merges arbitrary stacks without loss across serialization',()=>{
    for(const id of ['arrow','potion']){const initial=st([{cardId:id,qty:20},{cardId:'bag',qty:1}]);
      const inside=moveToContainer(initial,id,'bag',13);expect(inventoryQty(inside,id)).toBe(20);
      const restored=forgeToRuntimeState({inventory_items:runtimeInventoryPayload(inside)} as never);
      const outside=moveOutOfContainer(restored,id,'bag',8);expect(outside.inventory.find(r=>r.cardId===id&&!r.containerId)?.qty).toBe(15);expect(containerContents(outside,'bag')[0].qty).toBe(5);
      expect(initial.inventory[0].qty).toBe(20);
    }
  });
  it('rejects bad quantities and cycles',()=>{const initial=st([{cardId:'bag',qty:1},{cardId:'pouch',qty:1,containerId:'bag'}]);
    expect(moveToContainer(initial,'bag','pouch')).toBe(initial);
    for(const n of [0,-1,1.5,NaN,Infinity]){expect(moveToContainer(initial,'bag','box',n)).toBe(initial);expect(moveOutOfContainer(initial,'pouch','bag',n)).toBe(initial)}
  });
  it('inventoryQty суммирует по ВСЕМ локациям', () => {
    expect(inventoryQty(st([{ cardId: 'arrow', qty: 5 }, { cardId: 'arrow', qty: 3, containerId: 'quiver' }]), 'arrow')).toBe(8);
  });

  it('addToInventory кладёт на верхний уровень (не в стопку контейнера)', () => {
    const n = addToInventory(st([{ cardId: 'arrow', qty: 3, containerId: 'quiver' }]), 'arrow', 2);
    expect(n.inventory.find((r) => r.cardId === 'arrow' && r.containerId == null)?.qty).toBe(2);
    expect(n.inventory.find((r) => r.containerId === 'quiver')?.qty).toBe(3);
  });

  it('removeFromInventory списывает всего qty, предпочитая верхний уровень', () => {
    const n = removeFromInventory(st([{ cardId: 'arrow', qty: 2 }, { cardId: 'arrow', qty: 5, containerId: 'quiver' }]), 'arrow', 3);
    expect(n.inventory.find((r) => r.cardId === 'arrow' && r.containerId == null)).toBeUndefined(); // верх опустошён
    expect(n.inventory.find((r) => r.containerId === 'quiver')?.qty).toBe(4);
  });

  it('moveToContainer переносит с верхнего уровня внутрь контейнера', () => {
    const n = moveToContainer(st([{ cardId: 'sword', qty: 2 }]), 'sword', 'chest', 1);
    expect(n.inventory.find((r) => r.containerId == null)?.qty).toBe(1);
    expect(n.inventory.find((r) => r.containerId === 'chest')?.qty).toBe(1);
  });

  it('moveToContainer: контейнер в себя / нехватка — no-op', () => {
    expect(moveToContainer(st([{ cardId: 'chest', qty: 1 }]), 'chest', 'chest', 1).inventory).toHaveLength(1);
    expect(moveToContainer(st([{ cardId: 'x', qty: 1 }]), 'x', 'chest', 5).inventory).toEqual([{ cardId: 'x', qty: 1 }]);
  });

  it('moveOutOfContainer возвращает на верхний уровень', () => {
    const n = moveOutOfContainer(st([{ cardId: 'gem', qty: 3, containerId: 'chest' }]), 'gem', 'chest', 2);
    expect(n.inventory.find((r) => r.containerId == null)?.qty).toBe(2);
    expect(n.inventory.find((r) => r.containerId === 'chest')?.qty).toBe(1);
  });

  it('containerContents + containerWeight (рекурсия по вложенным)', () => {
    const weightOf = (id: string) => (({ sword: 3, gem: 0.1, pouch: 1 } as Record<string, number>)[id] ?? 0);
    const s = st([
      { cardId: 'chest', qty: 1 },
      { cardId: 'sword', qty: 2, containerId: 'chest' },
      { cardId: 'pouch', qty: 1, containerId: 'chest' },
      { cardId: 'gem', qty: 10, containerId: 'pouch' },
    ]);
    expect(containerContents(s, 'chest').map((r) => r.cardId)).toEqual(['sword', 'pouch']);
    expect(containerWeight(s, 'chest', weightOf)).toBeCloseTo(8); // 2*3 + 1*1 + (10*0.1)
  });

  it('containerWeight: цикл вложенности A→B→A не зацикливается', () => {
    const s = st([{ cardId: 'a', qty: 1, containerId: 'b' }, { cardId: 'b', qty: 1, containerId: 'a' }]);
    expect(() => containerWeight(s, 'a', () => 1)).not.toThrow();
  });

  it('item-cost location-aware: canPay суммирует, pay тратит с верхнего уровня', () => {
    const s = st([{ cardId: 'arrow', qty: 1 }, { cardId: 'arrow', qty: 2, containerId: 'quiver' }]);
    expect(canPay(s, [{ resource: 'item', card_id: 'arrow', amount: 2 }]).ok).toBe(true); // сумма 3 ≥ 2
    expect(inventoryQty(pay(s, [{ resource: 'item', card_id: 'arrow', amount: 2 }]).state, 'arrow')).toBe(1);
  });

  it('персист round-trip: container_id сериализуется и парсится обратно', () => {
    const s = st([{ cardId: 'gem', qty: 1, containerId: 'chest' }, { cardId: 'rope', qty: 1 }]);
    const payload = runtimeInventoryPayload(s);
    expect(payload).toEqual([{ card_id: 'gem', qty: 1, container_id: 'chest' }, { card_id: 'rope', qty: 1 }]);
    expect(forgeToRuntimeState({ inventory_items: payload } as never).inventory)
      .toEqual([{ cardId: 'gem', qty: 1, containerId: 'chest' }, { cardId: 'rope', qty: 1 }]);
  });
});
