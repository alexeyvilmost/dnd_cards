import { describe, expect, it } from 'vitest';
import { purchaseItem, purchasePrice } from '../character/inventory';
import {
  CURRENT_CHARACTER_SCHEMA_VERSION,
  DEFAULT_CHARACTER_RULESET_VERSION,
  DEFAULT_CHARACTER_SYSTEM_ID,
  DEFAULT_CHARACTER_TYPE,
  type ForgeCharacter,
} from '../character/types';
import type { Card } from '../types';

const baseChar = (): ForgeCharacter => ({
  id: 'c1',
  user_id: 'u1',
  name: 'Test',
  system_id: DEFAULT_CHARACTER_SYSTEM_ID,
  ruleset_version: DEFAULT_CHARACTER_RULESET_VERSION,
  character_type: DEFAULT_CHARACTER_TYPE,
  character_schema_version: CURRENT_CHARACTER_SCHEMA_VERSION,
  level: 1,
  max_hp: 10,
  current_hp: 10,
  speed: 30,
  proficiency_bonus: 2,
  access_mode: 'owner',
  created_at: '',
  updated_at: '',
  currency: { gold: 100 },
});

const sword: Card = {
  id: 'w1',
  name: 'Меч',
  description: '',
  rarity: 'common',
  card_number: 'WPN-TEST',
  price: 15,
  price_currency: 'gold',
} as Card;

describe('purchaseItem', () => {
  it('buys chosen quantities of two different copper-priced items with change',()=>{
    for(const id of ['arrow','bolt']){
      const card:Card={...sword,id,price:5,price_currency:'copper'};
      const one=purchaseItem({...baseChar(),currency:{gold:5}},card);
      expect(one.currency).toMatchObject({gold:4,silver:9,copper:5});
      const pack=purchaseItem({...baseChar(),currency:{gold:5}},card,[],20);
      expect(pack.currency).toMatchObject({gold:4,silver:0,copper:0});
      expect(pack.runtime.inventory).toEqual([{cardId:id,qty:20}]);
    }
  });
  it('списывает золото и добавляет в инвентарь', () => {
    const { runtime, currency, error } = purchaseItem(baseChar(), sword);
    expect(error).toBeUndefined();
    expect(currency.gold).toBe(85);
    expect(runtime.inventory).toEqual([{ cardId: 'w1', qty: 1 }]);
  });

  it('отказывает при нехватке средств', () => {
    const poor = { ...baseChar(), currency: { gold: 5 } };
    const { error } = purchaseItem(poor, sword);
    expect(error).toBe('Недостаточно средств');
  });

  it('применяет скидку Самоделкина 20% к немагической покупке', () => {
    const crafter = [{
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'modifier',
          applies_to: { value: 'nonmagical_purchase_price' },
          op: 'multiply',
          value: 0.8,
        }],
      }],
    }];
    const character = { ...baseChar(), currency: { gold: 12 } };

    expect(purchasePrice(sword, crafter)).toMatchObject({
      listed: 15,
      payable: 12,
      discounted: true,
    });
    const result = purchaseItem(character, sword, crafter);
    expect(result.error).toBeUndefined();
    expect(result.pricePaid).toBe(12);
    expect(result.discountApplied).toBe(true);
    expect(result.currency.gold).toBe(0);
  });

  it('не применяет скидку Самоделкина к явно магическому предмету', () => {
    const magical = { ...sword, mechanics: {magical:true} };
    const crafter = [{
      effects: [{ result: [{
        kind: 'modifier', applies_to: { value: 'nonmagical_purchase_price' }, op: 'multiply', value: 0.8,
      }] }],
    }];

    expect(purchasePrice(magical, crafter)).toMatchObject({
      listed: 15,
      payable: 15,
      discounted: false,
    });
  });
});
