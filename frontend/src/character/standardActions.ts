/** Стандартные боевые действия PHB (не привязаны к сущности в библиотеке). */
export const STANDARD_DODGE = {
  name: 'Уклонение',
  mechanics: {
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
