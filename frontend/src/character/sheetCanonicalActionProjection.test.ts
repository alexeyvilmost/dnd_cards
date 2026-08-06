import { describe, expect, it } from 'vitest';
import type { Card, Spell } from '../types';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import type { SheetAction } from './actionSheet';
import { projectRunnableSheetCanonicalActions } from './sheetCanonicalActionProjection';

const WEAPON = {
  id: 'card:test-bow',
  card_number: 'CARD-TEST-BOW',
  name: 'Test bow',
  type: 'weapon',
  properties: [],
  description: '',
  rarity: 'common',
  is_template: 'false',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  mechanics: {
    weapon_profile: {
      weapon_type: 'shortbow',
      proficiency_category: 'simple',
      attack_ability: 'dex',
      damage_lines: [{ dice: '1d6', type: 'piercing' }],
      default_attack_mode: 'ranged',
      attack_modes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
      properties: ['ammunition'],
      mastery_effect_id: 'effect:mastery:vex',
      ammo: { card_id: 'card:test-arrow' },
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
} satisfies Card;

function weaponAction(id: string, off = false): SheetAction {
  return {
    id,
    name: id,
    group: 'basic',
    mechanics: {
      primitive: {
        type: off ? LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE : WEAPON_ATTACK_PRIMITIVE,
      },
      activation: {
        mode: 'active',
        cost: [
          { resource: off ? 'bonus_action' : 'action' },
          { resource: 'equipped_weapon_ammo', amount: 1 },
        ],
      },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
        max_targets: 1, range_ft: 1, requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_ranged', ability: 'auto', vs: 'ac',
        ...(off ? { tags: ['off_hand', 'two_weapon'] } : {}),
        on_hit: [{
          kind: 'damage', dice: 'weapon', type: 'weapon', ability: off ? 'none' : 'auto',
        }],
      }],
    },
  };
}

function legacySpell(id: string): SheetAction {
  const spell = {
    id,
    card_number: `SPELL-${id}`,
    name: id,
    description: '',
    rarity: 'common',
    level: 1,
    component_verbal: true,
    component_somatic: true,
    component_material: false,
    concentration: false,
    ritual: false,
    is_healing: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: id }] }],
    },
  } satisfies Spell;
  return {
    id,
    name: id,
    group: 'spell',
    spellRef: spell,
    mechanics: spell.mechanics!,
  };
}

describe('runnable canonical sheet-action projection', () => {
  it('binds the equipped main action and excludes an unavailable off-hand capability', () => {
    const projection = projectRunnableSheetCanonicalActions({
      actions: [
        weaponAction('main'),
        weaponAction('off', true),
        { id: 'legacy', name: 'Legacy', group: 'basic', mechanics: {} },
      ],
      equipment: { main_hand: WEAPON.id },
      cards: new Map([[WEAPON.id, WEAPON]]),
    });

    expect(projection.actions.map((action) => action.id)).toEqual(['main']);
    expect(projection.actions[0].mechanics.targeting).toMatchObject({ range_ft: 320 });
    expect(projection.issues.get('off')).toMatch(/off hand/);
    expect(projection.issues.has('legacy')).toBe(false);
  });

  it('fails closed by omitting an action whose equipped Card has no valid profile', () => {
    const malformed = { ...WEAPON, mechanics: {} } as Card;
    const projection = projectRunnableSheetCanonicalActions({
      actions: [weaponAction('main')],
      equipment: { main_hand: malformed.id },
      cards: new Map([[malformed.id, malformed]]),
    });

    expect(projection.actions).toEqual([]);
    expect(projection.issues.get('main')).toMatch(/weapon_profile is required/);
  });

  it('retains non-primitive spell rows required by complete prepared-spell provenance', () => {
    const projection = projectRunnableSheetCanonicalActions({
      actions: [
        legacySpell('mage-armor'),
        { id: 'legacy', name: 'Legacy', group: 'basic', mechanics: {} },
      ],
      equipment: {},
      cards: new Map(),
    });

    expect(projection.actions.map((action) => action.id)).toEqual(['mage-armor']);
    expect(projection.issues.size).toBe(0);
  });
});
