import { describe, expect, it } from 'vitest';
import {
  bindEquippedWeaponAmmoCost,
  EQUIPPED_WEAPON_AMMO_RESOURCE,
} from './weapon';
import { canPay, pay } from './cost';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';

type Dict = Record<string, unknown>;

const attackMech = (options: {
  marker?: Dict;
  offHand?: boolean;
} = {}): Dict => ({
  activation: {
    mode: 'active',
    cost: [
      { resource: options.offHand ? 'bonus_action' : 'action' },
      ...(options.marker === undefined ? [] : [options.marker]),
    ],
  },
  effects: [{
    resolution: 'attack_roll',
    attack_kind: 'weapon_melee',
    on_hit: [{ dice: 'weapon', kind: 'damage', type: 'weapon' }],
    ...(options.offHand ? { tags: ['off_hand', 'two_weapon'] } : {}),
  }],
});

const marker = (amount: unknown = 1): Dict => ({
  resource: EQUIPPED_WEAPON_AMMO_RESOURCE,
  amount,
});
const weapon = (id: string, ammo: unknown, options: { ranged?: boolean } = {}): Card => ({
  id,
  name: id,
  type: 'weapon',
  mechanics: {
    weapon_profile: {
      weapon_type: id,
      proficiency_category: 'simple',
      attack_ability: options.ranged ? 'dex' : 'str',
      damage_lines: [{ dice: '1d6', type: 'piercing' }],
      default_attack_mode: options.ranged ? 'ranged' : 'melee',
      attack_modes: options.ranged
        ? [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }]
        : [{ kind: 'melee', reach_ft: 5 }],
      properties: options.ranged ? ['ammunition'] : [],
      mastery_effect_id: `mastery:${id}`,
      ...(ammo !== undefined ? { ammo } : {}),
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
} as unknown as Card);
const cards = (...values: Card[]) => new Map(values.map((card) => [card.id, card]));
const state = (inventory: RuntimeState['inventory']): RuntimeState => ({
  hp: { current: 10, max: 10, temp: 0 },
  resources: { action: 1, bonus_action: 1 },
  maxResources: { action: 1, bonus_action: 1 },
  equipment: { main_hand: 'bow', off_hand: 'crossbow' },
  inventory,
  activeEffects: [],
});

function costs(mechanics: Dict): Dict[] {
  return ((mechanics.activation as Dict).cost as Dict[]);
}

describe('equipped_weapon_ammo contextual activation cost', () => {
  it('binds the declared amount through the selected weapon and ordinary item cost', () => {
    const bound = bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker(2) }),
      { main_hand: 'bow' },
      cards(weapon('bow', { card_id: 'arrow', name: 'Стрелы' }, { ranged: true })),
    );
    expect(costs(bound)).toEqual([
      { resource: 'action' },
      { resource: 'item', card_id: 'arrow', amount: 2, name: 'Стрелы' },
    ]);
    const before = state([{ cardId: 'arrow', qty: 3 }]);
    expect(canPay(before, costs(bound))).toEqual({ ok: true, missing: [] });
    const paid = pay(before, costs(bound));
    expect(paid.state.resources.action).toBe(0);
    expect(paid.state.inventory).toEqual([{ cardId: 'arrow', qty: 1 }]);
    expect(paid.events).toContainEqual(expect.objectContaining({
      type: 'item_consumed', cardId: 'arrow', amount: 2, remaining: 1,
    }));
  });

  it('uses the off-hand weapon selected by the attack markers', () => {
    const bound = bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker(), offHand: true }),
      { main_hand: 'sword', off_hand: 'crossbow' },
      cards(weapon('sword', null), weapon('crossbow', { card_id: 'bolt' }, { ranged: true })),
    );
    expect(costs(bound)).toEqual([
      { resource: 'bonus_action' },
      { resource: 'item', card_id: 'bolt', amount: 1 },
    ]);
  });

  it('removes the contextual entry for a selected weapon without ammunition', () => {
    const bound = bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker() }),
      { main_hand: 'sword' },
      cards(weapon('sword', null)),
    );
    expect(costs(bound)).toEqual([{ resource: 'action' }]);
  });

  it('never inspects or spends weapon ammunition without the explicit marker', () => {
    const malformedWeapon = weapon('bow', { card_id: '' }, { ranged: true });
    const mechanics = attackMech();
    expect(bindEquippedWeaponAmmoCost(
      mechanics,
      { main_hand: 'bow' },
      cards(malformedWeapon),
    )).toBe(mechanics);
    expect(costs(mechanics)).toEqual([{ resource: 'action' }]);
  });

  it.each([
    ['missing amount', { resource: EQUIPPED_WEAPON_AMMO_RESOURCE }],
    ['zero amount', marker(0)],
    ['fractional amount', marker(1.5)],
    ['unsupported marker field', { ...marker(), card_id: 'forged' }],
  ])('fails closed for a malformed marker: %s', (_label, declaration) => {
    expect(() => bindEquippedWeaponAmmoCost(
      attackMech({ marker: declaration }),
      { main_hand: 'bow' },
      cards(weapon('bow', { card_id: 'arrow' }, { ranged: true })),
    )).toThrow(/equipped_weapon_ammo/);
  });

  it.each([
    ['', /null or a stable card reference/],
    [{ card_id: '' }, /null or a stable card reference/],
    [{ card_id: 'arrow', extra: true }, /null or a stable card reference/],
    [7, /null or a stable card reference/],
  ])('fails closed for malformed weapon_profile.ammo %#', (ammo, issue) => {
    expect(() => bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker() }),
      { main_hand: 'bow' },
      cards(weapon('bow', ammo, { ranged: true })),
    )).toThrow(issue);
  });

  it('distinguishes an explicit ammo:null declaration from a missing declaration', () => {
    expect(costs(bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker() }),
      { main_hand: 'sword' },
      cards(weapon('sword', null)),
    ))).toEqual([{ resource: 'action' }]);
    expect(() => bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker() }),
      { main_hand: 'sword' },
      cards(weapon('sword', undefined)),
    )).toThrow(/weapon_profile\.ammo/);
  });

  it('fails closed when the contextual marker cannot resolve a weapon hand', () => {
    expect(() => bindEquippedWeaponAmmoCost(
      attackMech({ marker: marker() }),
      {},
      new Map(),
    )).toThrow(/requires a weapon/);
    expect(() => bindEquippedWeaponAmmoCost(
      {
        activation: { mode: 'active', cost: [marker()] },
        effects: [{ resolution: 'auto', result: [] }],
      },
      { main_hand: 'bow' },
      cards(weapon('bow', { card_id: 'arrow' }, { ranged: true })),
    )).toThrow(/requires a main\/off weapon attack/);
  });
});
