import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { bindEquippedWeaponAmmoCost } from '../engine/weapon';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import type { RuleActionDefinition } from './domain';
import {
  parseDeclaredWeaponActionPolicy,
  WEAPON_ATTACK_PRIMITIVE,
} from './weaponActionPolicies';

function action(input: { rangeFt?: number; ammoAmount?: number; marker?: boolean } = {}): RuleActionDefinition {
  return {
    id: 'action:generic-weapon-entry',
    name: 'Localized display text is irrelevant',
    kind: 'nonSpell',
    sourceEntityIds: ['content:generic-weapon-entry'],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: input.rangeFt ?? 120,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      primitive: { type: WEAPON_ATTACK_PRIMITIVE },
      activation: {
        mode: 'active',
        cost: [
          { resource: 'action' },
          ...(input.marker === false ? [] : [{
            resource: 'equipped_weapon_ammo',
            amount: input.ammoAmount ?? 2,
          }]),
        ],
      },
      effects: [{
        resolution: 'attack_roll',
        attack_kind: 'weapon_melee',
        ability: 'auto',
        vs: 'ac',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon', ability: 'auto' }],
      }],
    },
  };
}

const BOW = withDeclaredTestWeaponProfile({
  id: 'card:bow',
  name: 'Bow',
  type: 'weapon',
} as unknown as Card, {
  weaponType: 'shortbow', proficiencyCategory: 'simple', attackAbility: 'dex',
  damageLines: [{ dice: '1d6', type: 'piercing' }],
  defaultAttackMode: 'ranged',
  attackModes: [{ kind: 'ranged', normal_ft: 80, long_ft: 120 }],
  properties: ['ammunition', 'two_handed'], masteryEffectId: 'effect:test:vex',
  ammo: { card_id: 'card:arrow', name: 'Arrow' },
});

describe('generic declared weapon-action policy', () => {
  it('takes a positive range and ammunition amount from data instead of engine constants', () => {
    const template = action({ rangeFt: 120, ammoAmount: 2 });
    expect(parseDeclaredWeaponActionPolicy(template, 'template')).toMatchObject({
      status: 'valid',
      policy: { activationCost: [
        { resource: 'action' },
        { resource: 'equipped_weapon_ammo', amount: 2 },
      ] },
    });
    const bound: RuleActionDefinition = {
      ...template,
      mechanics: bindEquippedWeaponAmmoCost(
        template.mechanics,
        { main_hand: BOW.id },
        new Map([[BOW.id, BOW]]),
      ),
    };
    expect(parseDeclaredWeaponActionPolicy(bound, 'bound')).toMatchObject({
      status: 'valid',
      policy: { activationCost: [
        { resource: 'action' },
        { resource: 'item', card_id: 'card:arrow', amount: 2, name: 'Arrow' },
      ] },
    });
  });

  it('requires the contextual marker and rejects an invalid marker amount', () => {
    expect(parseDeclaredWeaponActionPolicy(action({ marker: false }), 'template'))
      .toMatchObject({ status: 'invalid', issue: expect.stringContaining('requires exactly one') });
    expect(parseDeclaredWeaponActionPolicy(action({ ammoAmount: 0 }), 'template'))
      .toMatchObject({ status: 'invalid', issue: expect.stringContaining('marker') });
  });
});
