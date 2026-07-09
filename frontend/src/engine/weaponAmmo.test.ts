/**
 * S5 «предмет=эффект»: боеприпас оружия. Дальнобойное оружие декларирует mechanics.ammo (id карты
 * или {card_id,name}); weaponAmmoCost → cost {resource:'item',card_id}, который тратит/гейтит штатный
 * canPay/pay (слайс 4). Нет стрелы → действие недоступно. «Дальнобойная атака (стрелы)».
 */
import { describe, expect, it } from 'vitest';
import { weaponAmmoCost } from './weapon';
import { appendActivationCost, canPay } from './cost';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

// 'main'-атака: effect resolution:'attack_roll' с on_hit dice:'weapon' (matchedAttackEffect).
const attackMech = { effects: [{ resolution: 'attack_roll', on_hit: [{ dice: 'weapon', kind: 'damage' }] }] };
const bow = (ammo: unknown): Card => ({ id: 'longbow', name: 'Длинный лук', type: 'weapon', mechanics: ammo === undefined ? {} : { ammo } } as unknown as Card);
const cardMap = (c: Card) => new Map([[c.id, c]]);
const state = (inv: { cardId: string; qty: number }[]): RuntimeState =>
  ({ hp: { current: 10, max: 10, temp: 0 }, resources: { action: 1 }, maxResources: {}, equipment: { main_hand: 'longbow' }, inventory: inv, activeEffects: [] } as unknown as RuntimeState);

describe('S5 — weaponAmmoCost', () => {
  it('оружие с mechanics.ammo (строка) → cost item', () => {
    expect(weaponAmmoCost(attackMech, { main_hand: 'longbow' }, cardMap(bow('arrow')))).toEqual({ resource: 'item', card_id: 'arrow', amount: 1 });
  });

  it('ammo как {card_id, name} → имя пробрасывается (для тоста/причины)', () => {
    expect(weaponAmmoCost(attackMech, { main_hand: 'longbow' }, cardMap(bow({ card_id: 'arrow', name: 'Стрелы' }))))
      .toEqual({ resource: 'item', card_id: 'arrow', amount: 1, name: 'Стрелы' });
  });

  it('оружие без ammo → null (обычное оружие не гейтится боеприпасом)', () => {
    expect(weaponAmmoCost(attackMech, { main_hand: 'longbow' }, cardMap(bow(undefined)))).toBeNull();
  });

  it('не оружейное действие → null', () => {
    expect(weaponAmmoCost({ effects: [] }, { main_hand: 'longbow' }, cardMap(bow('arrow')))).toBeNull();
  });

  it('нет оружия в руке → null', () => {
    expect(weaponAmmoCost(attackMech, {}, cardMap(bow('arrow')))).toBeNull();
  });
});

describe('S5 — интеграция: гейт по боеприпасу (видение №5)', () => {
  it('со стрелами атака доступна, без стрел — нет', () => {
    const ammo = weaponAmmoCost(attackMech, { main_hand: 'longbow' }, cardMap(bow('arrow')))!;
    const mech = appendActivationCost({ ...attackMech, activation: { mode: 'active', cost: [{ resource: 'action' }] } }, ammo);
    const cost = (mech.activation as { cost: Record<string, unknown>[] }).cost;
    expect(canPay(state([{ cardId: 'arrow', qty: 3 }]), cost).ok).toBe(true);
    const empty = canPay(state([]), cost);
    expect(empty.ok).toBe(false);
    expect(empty.missing).toContain('item:arrow');
  });
});
