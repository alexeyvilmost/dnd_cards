/**
 * Фикстуры MVP-тестов: РЕАЛЬНЫЕ механики из прод-БД (базовые действия,
 * способности видов) + эталонный персонаж и предметы. Не менять под
 * реализацию — это входные данные контракта.
 */

import type { Card } from '../types';
import type { CharacterContext, RuntimeState } from './contracts';

type Dict = Record<string, unknown>;

/** Детерминированный rng (mulberry32) для golden-тестов. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Механики базовых действий (as-is из прод-БД, card_number указан) ───────

/** action_unarmed_strike */
export const MECH_UNARMED_STRIKE: Dict = {
  activation: { cost: [{ resource: 'action' }], mode: 'active' },
  effects: [{
    ability: 'str', attack_kind: 'unarmed', resolution: 'attack_roll', vs: 'ac',
    on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
  }],
  requirements: [{ type: 'equipment', value: 'free_hand' }],
  targeting: { filter: 'enemy', range: '5 feet', shape: 'single' },
};

/** action_melee_attack */
export const MECH_WEAPON_ATTACK: Dict = {
  activation: { cost: [{ resource: 'action' }], mode: 'active' },
  effects: [{
    ability: 'auto', attack_kind: 'weapon_melee', resolution: 'attack_roll', vs: 'ac',
    on_hit: [{ ability: 'auto', dice: 'weapon', kind: 'damage', type: 'weapon' }],
  }],
  requirements: [{ type: 'equipment', value: 'weapon_in_main_hand' }],
  targeting: { filter: 'enemy', range: 'weapon', shape: 'single' },
};

/** action_offhand_attack */
export const MECH_OFFHAND_ATTACK: Dict = {
  activation: { cost: [{ resource: 'bonus_action' }], mode: 'active' },
  effects: [{
    ability: 'auto', attack_kind: 'weapon_melee', resolution: 'attack_roll', vs: 'ac',
    tags: ['off_hand', 'two_weapon'],
    on_hit: [{ ability: 'none', dice: 'weapon', kind: 'damage', type: 'weapon' }],
  }],
  requirements: [{ type: 'equipment', value: 'weapon_in_off_hand' }],
  targeting: { filter: 'enemy', range: 'weapon', shape: 'single' },
};

/** action_dodge. Помеха атаки по вам моделируется scope:'target' (проекция на атакующего через
 *  projectedAgainst), а не мёртвой filter:{against:'self'} — её движок не читал (KB-025). */
export const MECH_DODGE: Dict = {
  activation: { cost: [{ resource: 'action' }], mode: 'active' },
  effects: [{
    resolution: 'auto',
    result: [
      { kind: 'modifier', applies_to: { roll: 'attack' }, scope: 'target', op: 'disadvantage', duration: { type: 'until_start_of_next_turn' } },
      { kind: 'modifier', applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } }, op: 'advantage', duration: { type: 'until_start_of_next_turn' } },
    ],
  }],
  targeting: { shape: 'self' },
};

/** action_shove (состязание) */
export const MECH_SHOVE: Dict = {
  activation: { cost: [{ resource: 'bonus_action' }], mode: 'active' },
  effects: [{
    ability: 'str', skill: 'athletics', mode: 'contest', contest_vs: ['athletics', 'acrobatics'],
    resolution: 'ability_check',
    on_success: [
      { kind: 'movement', value: 'push', distance: 5 },
      { kind: 'narrative', description: 'Либо вместо толчка сбить цель с ног (состояние Распластан).' },
    ],
  }],
  targeting: { filter: 'enemy', range: '5 feet', shape: 'single' },
};

/** Второе дыхание (Воин): лечение + мультиресурсная стоимость. */
export const MECH_SECOND_WIND: Dict = {
  activation: { cost: [{ resource: 'bonus_action' }, { resource: 'second_wind', amount: 1 }], mode: 'active' },
  effects: [{ resolution: 'auto', result: [{ amount: '1d10 + self_level', kind: 'healing' }] }],
  uses: { count: 2, per: 'short_rest' },
};

/** Оружие дыхания (Драконорождённый): спасбросок → урон, half on success. */
export const MECH_BREATH_WEAPON: Dict = {
  activation: { cost: [{ resource: 'action' }], mode: 'active' },
  effects: [{
    ability: 'dex', dc: '8+prof+con', resolution: 'save', who: 'target',
    on_fail: [{ dice: '1d10', kind: 'damage', type: 'fire' }],
    on_success: [{ dice: '1d10', kind: 'damage', on_success: 'half', type: 'fire' }],
  }],
};

/** Эффект-бафф: «преимущество на броски атаки» (ключ унификации атак). */
export const MECH_NEXT_ATTACK_ADVANTAGE: Dict = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage' }],
  }],
};

/** Эффект-бафф: плоский бонус к атаке (+2). */
export const MECH_ATTACK_BONUS_2: Dict = {
  activation: { mode: 'passive' },
  effects: [{
    resolution: 'auto',
    result: [{ kind: 'modifier', applies_to: { roll: 'attack' }, op: 'add', value: '+2' }],
  }],
};

/** Находчивый (Человек): ресурс после длинного отдыха. */
export const MECH_RESOURCEFUL: Dict = {
  activation: { mode: 'triggered', trigger: { event: 'long_rest', timing: 'after' } },
  effects: [{ resolution: 'auto', result: [{ amount: 1, id: 'heroic_inspiration', kind: 'resource', op: 'grant' }] }],
};

// ─── Предметы ────────────────────────────────────────────────────────────────

const baseCard = {
  id: '', name: '', properties: null, description: '', rarity: 'common' as const,
  card_number: '', is_template: 'false' as unknown as Card['is_template'],
};

export const CARD_LONGSWORD: Card = {
  ...baseCard,
  id: 'card-longsword', name: 'Длинный меч', card_number: 'ITEM-longsword',
  type: 'weapon', slot: 'one_hand', weight: 1.5,
  bonus_type: 'damage' as Card['bonus_type'], bonus_value: '1d8', damage_type: 'slashing',
  properties: ['versatile'] as unknown as Card['properties'],
} as Card;

export const CARD_DAGGER: Card = {
  ...baseCard,
  id: 'card-dagger', name: 'Кинжал', card_number: 'ITEM-dagger',
  type: 'weapon', slot: 'one_hand', weight: 0.5,
  bonus_type: 'damage' as Card['bonus_type'], bonus_value: '1d4', damage_type: 'piercing',
  properties: ['finesse', 'light', 'thrown'] as unknown as Card['properties'],
} as Card;

export const CARD_GREATAXE: Card = {
  ...baseCard,
  id: 'card-greataxe', name: 'Секира', card_number: 'ITEM-greataxe',
  type: 'weapon', slot: 'two_hands', weight: 3.5,
  bonus_type: 'damage' as Card['bonus_type'], bonus_value: '1d12', damage_type: 'slashing',
  properties: ['heavy', 'two_handed'] as unknown as Card['properties'],
} as Card;

// Молот мороза +1: двуручный, 2d6 дробящего + 1d6 холода, зачарование +1.
export const CARD_FROST_HAMMER: Card = {
  ...baseCard,
  id: 'card-frost-hammer', name: 'Молот мороза +1', card_number: 'ITEM-frost-hammer',
  type: 'weapon', slot: 'two_hands', weight: 10,
  bonus_type: 'damage' as Card['bonus_type'], bonus_value: '2d6', damage_type: 'bludgeoning',
  elemental_damage_value: '1d6', elemental_damage_type: 'cold', enchant_bonus: 1,
  requires_attunement: true,
  properties: ['two_handed', 'heavy'] as unknown as Card['properties'],
} as Card;

export const CARD_SHIELD: Card = {
  ...baseCard,
  id: 'card-shield', name: 'Щит', card_number: 'ITEM-shield',
  type: 'shield', slot: 'one_hand', weight: 3,
  bonus_type: 'defense' as Card['bonus_type'], bonus_value: '+2', defense_type: 'shield',
} as Card;

export const CARD_LEATHER_ARMOR: Card = {
  ...baseCard,
  id: 'card-leather', name: 'Кожаный доспех', card_number: 'ITEM-leather-armor',
  type: 'chest', slot: 'body', weight: 5,
  bonus_type: 'defense' as Card['bonus_type'], bonus_value: '11+dex', defense_type: 'light',
} as Card;

export const CARD_CHAIN_MAIL: Card = {
  ...baseCard,
  id: 'card-chainmail', name: 'Кольчуга', card_number: 'ITEM-chain-mail',
  type: 'chest', slot: 'body', weight: 27.5,
  bonus_type: 'defense' as Card['bonus_type'], bonus_value: '16', defense_type: 'heavy',
} as Card;

export const ALL_CARDS = new Map<string, Card>(
  [CARD_LONGSWORD, CARD_DAGGER, CARD_GREATAXE, CARD_FROST_HAMMER, CARD_SHIELD, CARD_LEATHER_ARMOR, CARD_CHAIN_MAIL]
    .map((c) => [c.id, c]),
);

// ─── Эталонный персонаж: Воин-Человек L1 (стандартный набор) ────────────────

export const FIGHTER_CTX: CharacterContext = {
  abilityMods: { str: 2, dex: 2, con: 1, int: 1, wis: 0, cha: -1 }, // 15/14/13/12/10/8
  profBonus: 2,
  level: 1,
  classLevels: { fighter: 1 },
  characterSpeed: 30,
};

export function freshFighterState(): RuntimeState {
  return {
    hp: { current: 11, max: 11, temp: 0 },
    resources: { action: 1, bonus_action: 1, reaction: 1, second_wind: 2, heroic_inspiration: 1 },
    maxResources: { action: 1, bonus_action: 1, reaction: 1, second_wind: 2, heroic_inspiration: 1 },
    equipment: {},
    inventory: [
      { cardId: CARD_LONGSWORD.id, qty: 1 },
      { cardId: CARD_DAGGER.id, qty: 1 },
      { cardId: CARD_SHIELD.id, qty: 1 },
      { cardId: CARD_LEATHER_ARMOR.id, qty: 1 },
    ],
    activeEffects: [],
  };
}

/** Состояние с экипированными мечом (осн. рука), кинжалом (втор.) и кожаным доспехом. */
export function equippedFighterState(): RuntimeState {
  const s = freshFighterState();
  s.equipment = { body: CARD_LEATHER_ARMOR.id, main_hand: CARD_LONGSWORD.id, off_hand: CARD_DAGGER.id };
  return s;
}

export const FIGHTER_CTX_EQUIPPED: CharacterContext = {
  ...FIGHTER_CTX,
  equippedCards: [CARD_LEATHER_ARMOR, CARD_LONGSWORD, CARD_DAGGER],
};
