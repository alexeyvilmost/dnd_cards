import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../mvp/contracts';
import type { Action, Card } from '../types';
import type { SheetAction } from './actionSheet';
import { sheetTriggeredActionOffersAfterAttack } from './sheetTriggeredActionOffers';

const runtime: RuntimeState = {
  hp: { current: 8, max: 8, temp: 0 },
  resources: { action: 0, bonus_action: 1 },
  maxResources: { action: 1, bonus_action: 1 },
  equipment: {}, inventory: [], activeEffects: [],
};

const unarmed = {
  id: 'unarmed', name: 'Безоружный удар', group: 'basic', mechanics: {},
  actionRef: { id: 'unarmed', card_number: 'action_basic_unarmed' } as Action,
} satisfies SheetAction;

function martialArts(event: 'hit' | 'miss') {
  return {
    id: `martial-${event}`,
    name: 'Боевые искусства: безоружный удар',
    activation: {
      mode: 'triggered', optional: true,
      trigger: {
        event,
        source_action_card_numbers: ['action_basic_unarmed', 'action_basic_weapon'],
        source_weapon_qualifier: 'monk_weapon',
      },
      cost: [{ resource: 'bonus_action', amount: 1 }],
    },
    effects: [],
  };
}

describe('sheet triggered action offers after canonical attacks', () => {
  it.each([['hit', 'hit'], ['crit', 'hit'], ['miss', 'miss']] as const)(
    'offers the matching Martial Arts action after a %s',
    (outcome, expected) => {
      const offers = sheetTriggeredActionOffersAfterAttack({
        action: unarmed,
        events: [{ type: 'roll', label: 'Атака', roll: { kind: 'd20', natural: 10, total: 12, outcome } }],
        triggerSources: [martialArts('hit'), martialArts('miss')],
        state: runtime,
        equipment: runtime.equipment,
        cards: new Map(),
      });
      expect(offers.map((offer) => offer.listenerId)).toEqual([`martial-${expected}`]);
    },
  );

  it('rejects a non-Monk martial weapon and accepts a simple melee weapon', () => {
    const weaponAction = {
      ...unarmed,
      actionRef: { id: 'weapon', card_number: 'action_basic_weapon' } as Action,
    };
    const weapon = (id: string, proficiency: 'simple' | 'martial'): Card => ({
      id,
      mechanics: {
        weapon_profile: {
          weapon_type: id,
          proficiency_category: proficiency,
          attack_ability: 'str',
          damage_lines: [{ dice: '1d6', type: 'slashing' }],
          default_attack_mode: 'melee',
          attack_modes: [{ kind: 'melee', reach_ft: 5 }],
          properties: [],
          mastery_effect_id: 'effect:mastery:test',
          ammo: null,
          enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
          attunement: { required: false },
        },
      },
    } as unknown as Card);
    const heavy = weapon('martial-not-light', 'martial');
    const simple = weapon('simple', 'simple');
    const base = {
      action: weaponAction,
      events: [{ type: 'roll', label: 'Атака', roll: { kind: 'd20', natural: 10, total: 12, outcome: 'hit' as const } }],
      triggerSources: [martialArts('hit')], state: runtime,
    };
    expect(sheetTriggeredActionOffersAfterAttack({
      ...base, equipment: { main_hand: heavy.id }, cards: new Map([[heavy.id, heavy]]),
    })).toHaveLength(0);
    expect(sheetTriggeredActionOffersAfterAttack({
      ...base, equipment: { main_hand: simple.id }, cards: new Map([[simple.id, simple]]),
    })).toHaveLength(1);
  });

  it('does not offer the follow-up when the bonus action is unavailable', () => {
    expect(sheetTriggeredActionOffersAfterAttack({
      action: unarmed,
      events: [{ type: 'roll', label: 'Атака', roll: { kind: 'd20', natural: 10, total: 12, outcome: 'hit' } }],
      triggerSources: [martialArts('hit')],
      state: { ...runtime, resources: { ...runtime.resources, bonus_action: 0 } },
      equipment: runtime.equipment,
      cards: new Map(),
    })).toHaveLength(0);
  });
});
