import { describe, expect, it } from 'vitest';
import { purchaseItem } from '../character/inventory';
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
});
