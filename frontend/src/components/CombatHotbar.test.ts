import { describe, expect, it } from 'vitest';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from '../solo-combat/types';
import { actionCost, combatActionAvailability } from './CombatHotbar';

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
});
