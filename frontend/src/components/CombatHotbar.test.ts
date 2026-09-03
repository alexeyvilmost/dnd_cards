import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from '../solo-combat/types';
import {
  actionCost,
  combatActionAvailability,
  combatActionTimingAvailability,
  projectCombatHotbarAction,
} from './CombatHotbar';
import { UNTRAINED_ARMOR_SPELL_REASON } from '../character/untrainedArmor';
import { weaponMasteryNickUseKey } from '../engine/weaponMastery2024';

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
  const weaponAttack = {
    id: 'weapon-attack', name: 'Weapon attack', kind: 'nonSpell', sourceEntityIds: ['action:weapon'],
    mechanics: {
      primitive: { type: 'weapon_attack' },
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    },
  } as RuleActionDefinition;

  it('keeps an Attack entry enabled while its paid ledger has a strike remaining', () => {
    const afterFirst = state(0, 0);
    afterFirst.world.attackActions = {
      'attack:1': {
        id: 'attack:1', actorId: 'hero', startedAtRevision: 1,
        turnKey: 'encounter:1:0:hero', status: 'open',
        sequence: {
          id: 'attack:1', actorId: 'hero', totalAttacks: 2, attacksRemaining: 1,
          entries: [{
            ordinal: 1, kind: 'weapon_attack', actionId: weaponAttack.id,
            weaponCardId: 'weapon', sourceEntityIds: ['action:weapon'],
          }],
          usedReplacementKeys: [],
        },
      },
    };
    expect(combatActionAvailability(afterFirst, weaponAttack)).toEqual({ enabled: true });

    afterFirst.world.attackActions['attack:1'].status = 'completed';
    afterFirst.world.attackActions['attack:1'].sequence.attacksRemaining = 0;
    afterFirst.world.attackActions['attack:1'].sequence.entries.push({
      ordinal: 2, kind: 'weapon_attack', actionId: weaponAttack.id,
      weaponCardId: 'weapon', sourceEntityIds: ['action:weapon'],
    });
    expect(combatActionAvailability(afterFirst, weaponAttack)).toEqual({
      enabled: false,
      reason: 'Не хватает ресурса «Действие»',
    });
  });

  it('enables a fresh non-spell Attack from the Action Surge token', () => {
    expect(combatActionAvailability(state(0, 0, {
      resources: { action_surge_action: 1 },
    }), weaponAttack)).toEqual({ enabled: true });
  });

  it('shows Nick as an Attack entry, preserves Bonus Action, and disables it after its once-per-turn use', () => {
    const lightExtra = {
      id: 'light-extra', name: 'Light extra attack', kind: 'nonSpell', sourceEntityIds: ['action:light'],
      mechanics: {
        primitive: { type: 'light_weapon_extra_attack' },
        activation: { mode: 'active', cost: [{ resource: 'bonus_action', amount: 1 }] },
      },
    } as RuleActionDefinition;
    const weapon = (id: string, weaponType: string, mastery: string) => ({
      id, card_number: id, name: weaponType, type: 'weapon', mechanics: {
        weapon_profile: {
          weapon_type: weaponType, proficiency_category: 'martial', attack_ability: 'finesse',
          damage_lines: [{ dice: '1d6', type: 'slashing' }], default_attack_mode: 'melee',
          attack_modes: [{ kind: 'melee', reach_ft: 5 }], properties: ['light', 'finesse'],
          mastery_effect_id: mastery, ammo: null,
          enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
          attunement: { required: false },
        },
      },
    });
    const shortsword = weapon('card:shortsword', 'shortsword', 'effect:vex');
    const scimitar = weapon('card:scimitar', 'scimitar', 'effect:nick');
    const nickState = state(0, 0, { resources: { bonus_action: 1 } });
    const actor = nickState.world.actors.hero;
    actor.runtime.equipment = { main_hand: shortsword.id, off_hand: scimitar.id };
    actor.character.knownCards = [shortsword, scimitar] as never;
    actor.character.equippedCards = [shortsword, scimitar] as never;
    actor.character.weaponMasteries = ['shortsword', 'scimitar'];
    actor.masteryEffects = {
      'effect:nick': { mechanics: { weapon_mastery: {
        type: 'nick', timing: 'attack_action', maximumPerTurn: 1,
      } } },
      'effect:vex': { mechanics: { weapon_mastery: {
        type: 'vex', consume: 'next', targetLocked: true, requiresDamage: true,
        expires: 'end_of_source_next_turn',
      } } },
    };
    nickState.world.scene = {
      mode: 'encounter', initiative: ['hero'], activeIndex: 0, round: 1, turnStarted: true,
    };
    const turnKey = 'encounter:1:0:hero';
    nickState.world.attackActions = {
      'attack:1': {
        id: 'attack:1', actorId: 'hero', startedAtRevision: 1, turnKey, status: 'completed',
        sequence: {
          id: 'attack:1', actorId: 'hero', totalAttacks: 2, attacksRemaining: 0,
          entries: [{
            ordinal: 1, kind: 'weapon_attack', actionId: 'weapon-attack',
            weaponCardId: shortsword.id, sourceEntityIds: ['action:weapon'],
          }],
          usedReplacementKeys: [],
        },
      },
    };

    expect(combatActionAvailability(nickState, lightExtra)).toEqual({ enabled: true });
    const projected = projectCombatHotbarAction(nickState, lightExtra);
    expect(projected.mechanics.activation).toEqual({ mode: 'attack_entry', cost: [] });
    expect(actionCost(projected)).toBe('');
    expect(actor.runtime.resources.bonus_action).toBe(1);

    actor.runtime.firedThisTurn = [weaponMasteryNickUseKey(turnKey)];
    expect(combatActionAvailability(nickState, lightExtra)).toEqual({
      enabled: false,
      reason: 'Дополнительная атака «Быстрое» уже использована в этом ходу',
    });
  });

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

  it('blocks spellcasting while the actor wears armor without training', () => {
    const armored = state(1);
    armored.world.actors.hero.character.untrainedArmorCategories = ['heavy'];
    expect(combatActionAvailability(armored, spell)).toEqual({
      enabled: false,
      reason: UNTRAINED_ARMOR_SPELL_REASON,
    });
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
