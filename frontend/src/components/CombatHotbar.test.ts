import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from '../solo-combat/types';
import { actionCost, combatActionAvailability, combatActionTimingAvailability } from './CombatHotbar';

const SPELL_ID = 'spell@feat';
const GRANT_ID = `spell-grant:feat:${SPELL_ID}`;

const spell = {
  id: SPELL_ID,
  name: 'Волна грома',
  kind: 'spell',
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }, { resource: 'spell_slot', amount: 1, level: 1 }] },
    targeting: { domain: 'actor', actor_targets: true, shape: 'area', min_targets: 0, max_targets: 8, range_ft: 15 },
    effects: [],
  },
  targeting: { minTargets: 0, maxTargets: 8, rangeFt: 15, requiresLineOfSight: false, allowedRelations: ['enemy'] },
  spell: { level: 1, ritual: false, classListIds: [], components: { verbal: true, somatic: true, material: false } },
  sourceEntityIds: ['spell', 'feat'],
} as RuleActionDefinition;

function state(
  freeUses: number,
  actions = 1,
  extra?: { resources?: Record<string, number>; inventory?: Array<{ cardId: string; qty: number }> },
): SoloCombatState {
  return {
    characterId: 'hero',
    world: {
      actors: {
        hero: {
          id: 'hero', name: 'Герой', kind: 'playerCharacter', controllerId: 'test', ac: 12,
          character: { level: 1, profBonus: 2, abilityScores: {}, abilityMods: {}, skillProficiencies: [], skillExpertise: [], saveProficiencies: [], baseSpeed: 30, characterSpeed: 30 },
          runtime: { hp: { current: 10, max: 10, temp: 0 }, resources: { action: actions, 'freeuse-spell': freeUses, ...(extra?.resources ?? {}) }, maxResources: { action: 1, 'freeuse-spell': 1, ...(extra?.resources ?? {}) }, activeEffects: [], equipment: {}, inventory: extra?.inventory ?? [], firedThisTurn: [] },
          capabilities: { actionIds: [SPELL_ID] }, passives: [], lifecycle: { status: 'alive' },
          spellcastingAccess: { grants: [{ grantId: GRANT_ID, actionId: SPELL_ID, sourceId: 'feat', access: 'always_prepared', level: 1, spellcastingAbility: 'wis', freeUseResource: 'freeuse-spell', slotResource: 'spell_slot_1' }], preparedSources: {} },
        },
      },
    },
  } as unknown as SoloCombatState;
}

describe('combat hotbar action availability', () => {
  it('keeps minute- and hour-long spells visible but explains that they are used outside turn combat', () => {
    const ritual = {
      ...spell,
      mechanics: {
        ...spell.mechanics,
        activation: {
          ...(spell.mechanics.activation as Record<string, unknown>),
          cast_time: { amount: 10, unit: 'minute' },
        },
      },
    } as RuleActionDefinition;
    expect(combatActionTimingAvailability(ritual)).toEqual({
      enabled: false,
      reason: 'Время сотворения 10 мин.: используйте вне пошагового боя',
    });
  });

  it('rejects malformed declared casting time with a user-facing reason', () => {
    const malformed = {
      ...spell,
      mechanics: {
        ...spell.mechanics,
        activation: {
          ...(spell.mechanics.activation as Record<string, unknown>),
          cast_time: { amount: 0, unit: 'minute' },
        },
      },
    } as RuleActionDefinition;
    expect(combatActionTimingAvailability(malformed)).toEqual({
      enabled: false,
      reason: 'Некорректно указано время сотворения',
    });
  });

  it('enables a Magic Initiate spell while its free use remains', () => {
    expect(combatActionAvailability(state(1), spell)).toEqual({ enabled: true });
  });

  it('disables a levelled spell when both its free use and spell slots are exhausted', () => {
    expect(combatActionAvailability(state(0), spell)).toEqual({
      enabled: false,
      reason: 'Нет бесплатного применения или подходящей ячейки',
    });
  });

  it('does not let a free spell bypass a spent Action', () => {
    expect(combatActionAvailability(state(1, 0), spell)).toEqual({
      enabled: false,
      reason: 'Не хватает ресурса «Действие»',
    });
  });

  it('shows human-readable data-driven costs', () => {
    expect(actionCost(spell)).toBe('Действие + Ячейка');
  });

  it('uses shared cost semantics for items and arbitrary declared resources', () => {
    const itemAction = {
      id: 'open-kit', name: 'Open kit', kind: 'nonSpell', sourceEntityIds: ['kit'],
      mechanics: { activation: { mode: 'active', cost: [
        { resource: 'item', card_id: 'kit', amount: 1 },
        { resource: 'charges', amount: 2 },
      ] } },
    } as RuleActionDefinition;
    expect(combatActionAvailability(state(0, 1, {
      resources: { charges: 2 }, inventory: [{ cardId: 'kit', qty: 1 }],
    }), itemAction)).toEqual({ enabled: true });
    expect(combatActionAvailability(state(0, 1, {
      resources: { charges: 1 }, inventory: [{ cardId: 'kit', qty: 1 }],
    }), itemAction)).toEqual({
      enabled: false,
      reason: 'Не хватает ресурса «charges»',
    });
    expect(combatActionAvailability(state(0, 1, {
      resources: { charges: 2 }, inventory: [],
    }), itemAction)).toEqual({
      enabled: false,
      reason: 'Не хватает ресурса «предмет kit»',
    });
  });

  it('binds equipped ranged-weapon ammo to the concrete inventory card before checking costs', () => {
    const ranged = {
      id: 'ranged-attack', name: 'Ranged attack', kind: 'nonSpell', sourceEntityIds: ['action:ranged'],
      mechanics: {
        primitive: { type: 'weapon_attack' },
        activation: { mode: 'active', cost: [
          { resource: 'action', amount: 1 },
          { resource: 'equipped_weapon_ammo', amount: 1 },
        ] },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 600, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'weapon_ranged', ability: 'auto', vs: 'ac',
          on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
        }],
      },
    } as unknown as RuleActionDefinition;
    const bow = {
      id: 'longbow', card_number: 'CARD-LONGBOW', name: 'Longbow', type: 'weapon',
      properties: [], description: '', rarity: 'common', is_template: 'false',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      mechanics: {
        weapon_profile: {
          weapon_type: 'longbow', proficiency_category: 'martial', attack_ability: 'dex',
          damage_lines: [{ dice: '1d8', type: 'piercing' }], default_attack_mode: 'ranged',
          attack_modes: [{ kind: 'ranged', normal_ft: 150, long_ft: 600 }],
          properties: ['ammunition', 'two_handed'],
          ammo: { card_id: 'arrow', name: 'Arrow' },
          mastery_effect_id: 'effect:slow',
          enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
          attunement: { required: false },
        },
      },
    };
    const rangedState = state(0, 1, { inventory: [{ cardId: 'arrow', qty: 20 }] });
    const actor = rangedState.world.actors.hero;
    actor.runtime.equipment.main_hand = bow.id;
    actor.character.knownCards = [bow] as never;
    actor.character.equippedCards = [bow] as never;

    expect(combatActionAvailability(rangedState, ranged)).toEqual({ enabled: true });
    actor.runtime.inventory = [];
    expect(combatActionAvailability(rangedState, ranged)).toEqual({
      enabled: false,
      reason: 'Не хватает ресурса «предмет arrow»',
    });
  });
});
