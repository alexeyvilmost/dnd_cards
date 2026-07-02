/** Стандартные боевые действия PHB (не привязаны к сущности в библиотеке). */

export const STANDARD_UNARMED_STRIKE = {
  id: 'standard-unarmed',
  name: 'Безоружный удар',
  mechanics: {
    name: 'Безоружный удар',
    activation: { cost: [{ resource: 'action' }], mode: 'active' },
    effects: [{
      ability: 'str', attack_kind: 'unarmed', resolution: 'attack_roll', vs: 'ac',
      on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
    }],
    targeting: { filter: 'enemy', range: '5 feet', shape: 'single' },
  },
} as const;

export const STANDARD_WEAPON_ATTACK = {
  id: 'standard-weapon',
  name: 'Атака оружием',
  mechanics: {
    name: 'Атака оружием',
    activation: { cost: [{ resource: 'action' }], mode: 'active' },
    effects: [{
      ability: 'auto', attack_kind: 'weapon_melee', resolution: 'attack_roll', vs: 'ac',
      on_hit: [{ ability: 'auto', dice: 'weapon', kind: 'damage', type: 'weapon' }],
    }],
    targeting: { filter: 'enemy', range: 'weapon', shape: 'single' },
  },
} as const;

export const STANDARD_OFFHAND_ATTACK = {
  id: 'standard-offhand',
  name: 'Атака второй рукой',
  mechanics: {
    name: 'Атака второй рукой',
    activation: { cost: [{ resource: 'bonus_action' }], mode: 'active' },
    effects: [{
      ability: 'auto', attack_kind: 'weapon_melee', resolution: 'attack_roll', vs: 'ac',
      tags: ['off_hand', 'two_weapon'],
      on_hit: [{ ability: 'none', dice: 'weapon', kind: 'damage', type: 'weapon' }],
    }],
    targeting: { filter: 'enemy', range: 'weapon', shape: 'single' },
  },
} as const;

export const STANDARD_DODGE = {
  id: 'standard-dodge',
  name: 'Уклонение',
  mechanics: {
    name: 'Уклонение',
    activation: { cost: [{ resource: 'action' }], mode: 'active' },
    effects: [{
      resolution: 'auto',
      result: [
        {
          kind: 'modifier',
          applies_to: { roll: 'attack', filter: { against: 'self' } },
          op: 'disadvantage',
          duration: { type: 'until_start_of_next_turn' },
        },
        {
          kind: 'modifier',
          applies_to: { roll: 'saving_throw', filter: { ability: 'dex' } },
          op: 'advantage',
          duration: { type: 'until_start_of_next_turn' },
        },
      ],
    }],
    targeting: { shape: 'self' },
  },
} as const;

export const STANDARD_ACTIONS = [
  STANDARD_UNARMED_STRIKE,
  STANDARD_WEAPON_ATTACK,
  STANDARD_OFFHAND_ATTACK,
  STANDARD_DODGE,
] as const;
