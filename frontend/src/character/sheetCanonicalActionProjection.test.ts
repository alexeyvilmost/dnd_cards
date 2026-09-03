import { describe, expect, it } from 'vitest';
import type { Card, Spell } from '../types';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import type { SheetAction } from './actionSheet';
import { projectRunnableSheetCanonicalActions } from './sheetCanonicalActionProjection';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';

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
  it('projects the Unarmed Fighting damage profile for empty and occupied hands', () => {
    const unarmed: SheetAction = {
      id: 'unarmed', name: 'Unarmed Strike', group: 'basic',
      description: 'Атака кулаком. Урон: 1 + модификатор Силы (дробящий).',
      actionRef: {
        id: 'action:unarmed', name: 'Безоружный удар',
        description: 'Атака кулаком. Урон: 1 + модификатор Силы (дробящий).',
        mechanics: {
          activation: { mode: 'active', cost: [{ resource: 'action' }] },
          targeting: { shape: 'single', range: '5 feet', filter: 'enemy' },
          effects: [{
            resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'str', vs: 'ac',
            on_hit: [{ kind: 'damage', amount: '1 + str', type: 'bludgeoning' }],
          }],
        },
      } as unknown as NonNullable<SheetAction['actionRef']>,
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { shape: 'single', range: '5 feet', filter: 'enemy' },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'str', vs: 'ac',
          on_hit: [{ kind: 'damage', amount: '1 + str', type: 'bludgeoning' }],
        }],
      },
    };
    const style = {
      activation: { mode: 'passive' },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'unarmed_damage_profile', dice: '1d6', empty_hands_dice: '1d8',
          ability: 'str', damage_type: 'bludgeoning', source: 'Unarmed Fighting',
        }],
      }],
    };
    const damageAmount = (action: SheetAction) => (
      ((action.mechanics.effects as Record<string, unknown>[])[0]
        .on_hit as Record<string, unknown>[])[0].amount
    );

    const emptyHands = projectRunnableSheetCanonicalActions({
      actions: [unarmed], equipment: {}, cards: new Map(), passives: [style],
    });
    const armed = projectRunnableSheetCanonicalActions({
      actions: [unarmed], equipment: { main_hand: WEAPON.id },
      cards: new Map([[WEAPON.id, WEAPON]]), passives: [style],
    });
    const baseline = projectRunnableSheetCanonicalActions({
      actions: [unarmed], equipment: {}, cards: new Map(),
    });

    expect(damageAmount(emptyHands.actions[0])).toBe('1d8 + str');
    expect(damageAmount(armed.actions[0])).toBe('1d6 + str');
    expect(damageAmount(baseline.actions[0])).toBe('1 + str');
    expect(emptyHands.actions[0].description).toContain('Урон: 1d8 + модификатор Силы');
    expect(armed.actions[0].description).toContain('Урон: 1d6 + модификатор Силы');
    expect(baseline.actions[0].description).toContain('Урон: 1 + модификатор Силы');
    expect(emptyHands.actions[0].actionRef?.description).toContain('Урон: 1d8 + модификатор Силы');
    expect(armed.actions[0].actionRef?.description).toContain('Урон: 1d6 + модификатор Силы');
    expect(baseline.actions[0].actionRef?.description).toContain('Урон: 1 + модификатор Силы');
  });

  it('projects the Monk Martial Arts die and best Strength-or-Dexterity ability only while unarmored', () => {
    const unarmed: SheetAction = {
      id: 'unarmed', name: 'Unarmed Strike', group: 'basic',
      description: 'Атака кулаком. Урон: 1 + модификатор Силы (дробящий).',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action' }] },
        targeting: { shape: 'single', range: '5 feet', filter: 'enemy' },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'str', vs: 'ac',
          on_hit: [{ kind: 'damage', amount: '1 + str', type: 'bludgeoning' }],
        }],
      },
    };
    const martialArts = {
      activation: { mode: 'passive' },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'unarmed_damage_profile', dice: 'martial_arts_die',
          ability_options: ['str', 'dex'], damage_type: 'bludgeoning',
          requires_unarmored: true, source: 'Боевые искусства',
        }],
      }],
    };
    const projected = projectRunnableSheetCanonicalActions({
      actions: [unarmed], equipment: {}, cards: new Map(), passives: [martialArts],
      variables: { martial_arts_die: { count: 1, sides: 6 } },
      abilityMods: { str: 2, dex: 4 },
    });
    const armored = projectRunnableSheetCanonicalActions({
      actions: [unarmed], equipment: { body: 'armor' },
      cards: new Map([['armor', {
        id: 'armor', type: 'chest', defense_type: 'light',
      } as unknown as Card]]), passives: [martialArts],
      variables: { martial_arts_die: { count: 1, sides: 6 } },
      abilityMods: { str: 2, dex: 4 },
    });
    const attack = (projected.actions[0].mechanics.effects as Record<string, unknown>[])[0];
    const damage = (attack.on_hit as Record<string, unknown>[])[0];
    const armoredAttack = (armored.actions[0].mechanics.effects as Record<string, unknown>[])[0];
    const armoredDamage = (armoredAttack.on_hit as Record<string, unknown>[])[0];

    expect(attack.ability).toBe('dex');
    expect(damage.amount).toBe('1d6 + dex');
    expect(projected.actions[0].description).toContain('Урон: 1d6 + модификатор Ловкости');
    expect(armoredAttack.ability).toBe('str');
    expect(armoredDamage.amount).toBe('1 + str');
  });

  it('does not misclassify a triggered Monk unarmed rider as the certified basic strike', () => {
    const rider: SheetAction = {
      id: 'martial-arts-rider',
      name: 'Martial Arts rider',
      group: 'class',
      mechanics: {
        activation: {
          mode: 'triggered',
          optional: true,
          trigger: { event: 'hit' },
          cost: [{ resource: 'bonus_action', amount: 1 }],
        },
        targeting: {
          domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
          max_targets: 1, range_ft: 5, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
        effects: [{
          resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'dex', vs: 'ac',
          on_hit: [{ kind: 'damage', amount: '1d8 + dex', type: 'bludgeoning' }],
        }],
      },
    };

    const projected = projectRunnableSheetCanonicalActions({
      actions: [rider], equipment: {}, cards: new Map(),
    });

    expect(projected.issues.size).toBe(0);
    expect(projected.actions).toHaveLength(1);
    expect(projected.actions[0].mechanics).not.toHaveProperty('primitive');
  });

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

  it('carries an actor-bound off-hand range into the immutable action reference', () => {
    const shortsword = {
      ...WEAPON,
      id: 'card:test-shortsword',
      card_number: 'CARD-TEST-SHORTSWORD',
      name: 'Test shortsword',
      mechanics: {
        weapon_profile: {
          ...WEAPON.mechanics.weapon_profile,
          weapon_type: 'shortsword',
          default_attack_mode: 'melee',
          attack_modes: [{ kind: 'melee', reach_ft: 5 }],
          properties: ['light', 'finesse'],
          ammo: null,
        },
      },
    } satisfies Card;
    const off = weaponAction('off', true);
    off.mechanics = {
      ...off.mechanics,
      name: 'Off-hand attack',
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee', ability: 'auto', vs: 'ac',
        tags: ['off_hand', 'two_weapon'],
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'none' }],
      }],
    };
    off.actionRef = {
      id: off.id,
      card_number: 'ACTION-OFF',
      name: off.name,
      description: '',
      mechanics: structuredClone(off.mechanics),
    } as NonNullable<SheetAction['actionRef']>;

    const projection = projectRunnableSheetCanonicalActions({
      actions: [off],
      equipment: { off_hand: shortsword.id },
      cards: new Map([[shortsword.id, shortsword]]),
    });

    expect(projection.issues.size).toBe(0);
    expect(projection.actions[0].mechanics.targeting).toMatchObject({ range_ft: 5 });
    expect(projection.actions[0].actionRef?.mechanics?.targeting).toMatchObject({ range_ft: 5 });
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
    const spell = legacySpell('mage-armor');
    spell.mechanics = { ...spell.mechanics, name: 'Mage Armor' };
    const projection = projectRunnableSheetCanonicalActions({
      actions: [
        spell,
        { id: 'legacy', name: 'Legacy', group: 'basic', mechanics: {} },
      ],
      equipment: {},
      cards: new Map(),
    });

    expect(projection.actions.map((action) => action.id)).toEqual(['mage-armor']);
    expect(projection.issues.size).toBe(0);
    expect(projection.actions[0].mechanics).not.toHaveProperty('name');
    expect(projection.actions[0].spellRef?.mechanics).not.toHaveProperty('name');
    expect(projection.actions[0].spellRef?.mechanics?.targeting).toMatchObject({
      domain: 'world', actor_targets: false, min_targets: 0, max_targets: 0,
    });
  });

  it('preserves a name only when the immutable entity mechanics declared it', () => {
    const spell = legacySpell('declared-name');
    spell.spellRef!.mechanics = { ...spell.spellRef!.mechanics, name: 'Reviewed name' };
    spell.mechanics = { ...spell.mechanics, name: 'Reviewed name' };

    const projection = projectRunnableSheetCanonicalActions({
      actions: [spell], equipment: {}, cards: new Map(),
    });

    expect(projection.issues.size).toBe(0);
    expect(projection.actions[0].mechanics.name).toBe('Reviewed name');
    expect(projection.actions[0].spellRef?.mechanics?.name).toBe('Reviewed name');
  });

  it('materializes legacy targeting before strict canonical compilation', () => {
    const selfAction: SheetAction = {
      id: 'rage', name: 'Rage', group: 'class',
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
        targeting: { shape: 'self' },
        effects: [{ resolution: 'auto', result: [{ kind: 'narrative' }] }],
      },
    };
    const enemySpell = legacySpell('legacy-enemy');
    enemySpell.mechanics = {
      ...enemySpell.mechanics,
      targeting: { shape: 'single', range: '60 feet', filter: 'enemy' },
    };
    const projection = projectRunnableSheetCanonicalActions({
      actions: [selfAction, enemySpell], equipment: {}, cards: new Map(),
    });

    expect(projection.issues.size).toBe(0);
    for (const action of projection.actions) {
      expect(() => compileDeclaredMechanicsTargeting(action.mechanics)).not.toThrow();
    }
    expect(projection.actions[0].mechanics.targeting).toMatchObject({
      domain: 'actor', actor_targets: false, allowed_relations: ['self'],
    });
    expect(projection.actions[1].mechanics.targeting).toMatchObject({
      domain: 'actor', actor_targets: true, allowed_relations: ['enemy'], range_ft: 60,
    });
    expect(projection.actions[1].spellRef?.mechanics?.targeting).toEqual(
      projection.actions[1].mechanics.targeting,
    );
  });

  it('keeps every explicitly active data action and derives a zero-target contract', () => {
    const active = (id: string, group: SheetAction['group']): SheetAction => ({
      id,
      name: id,
      group,
      sourceEntityIds: [`source:${id}`],
      mechanics: {
        activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
        effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: id }] }],
      },
    });
    const projection = projectRunnableSheetCanonicalActions({
      actions: [
        active('item', 'item'),
        active('race', 'race'),
        active('class', 'class'),
        { id: 'legacy', name: 'Legacy', group: 'basic', mechanics: {} },
      ],
      equipment: {},
      cards: new Map(),
    });

    expect(projection.actions.map(({ id }) => id)).toEqual(['item', 'race', 'class']);
    for (const action of projection.actions) {
      expect(action.mechanics.targeting).toEqual({
        shape: 'single', domain: 'world', actor_targets: false,
        min_targets: 0, max_targets: 0, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: [],
      });
    }
  });

  it('fails closed when target-interacting active mechanics omit targeting', () => {
    const projection = projectRunnableSheetCanonicalActions({
      actions: [{
        id: 'bad-target', name: 'Bad target', group: 'item',
        mechanics: {
          activation: { mode: 'active', cost: [] },
          effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'heal', amount: 1 }] }],
        },
      }],
      equipment: {},
      cards: new Map(),
    });

    expect(projection.actions).toEqual([]);
    expect(projection.issues.get('bad-target')).toMatch(/declares no mechanics\.targeting/);
  });
});
