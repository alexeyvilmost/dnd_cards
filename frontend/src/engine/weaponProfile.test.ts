import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import type { RuntimeState } from '../mvp/contracts';
import { executeAction } from './execute';
import {
  bindEquippedWeaponActionContext,
  EQUIPPED_WEAPON_AMMO_RESOURCE,
  weaponCategory,
  weaponContext,
} from './weapon';
import { validateMechanics } from './validateMechanics';
import {
  evaluateWeaponHeavyRule,
  parseWeaponProfile,
  weaponAttackModeAtDistance,
} from './weaponProfile';

type Dict = Record<string, unknown>;

function profile(overrides: Dict = {}): Dict {
  return {
    weapon_type: 'dagger',
    proficiency_category: 'simple',
    attack_ability: 'finesse',
    damage_lines: [{ dice: '1d4', type: 'piercing' }],
    default_attack_mode: 'melee',
    attack_modes: [
      { kind: 'melee', reach_ft: 5 },
      { kind: 'ranged', normal_ft: 20, long_ft: 60 },
    ],
    properties: ['finesse', 'light', 'thrown'],
    mastery_effect_id: 'effect:mastery:nick',
    ammo: null,
    enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
    attunement: { required: false },
    ...overrides,
  };
}

function weapon(profileValue: Dict = profile(), overrides: Partial<Card> = {}): Card {
  return {
    id: 'card:dagger',
    card_number: 'CARD-test-dagger',
    name: 'Legacy Longbow +9',
    type: 'weapon',
    weapon_type: 'legacy_longbow',
    damage_type: 'fire',
    bonus_value: '9d100',
    range: '999/9999',
    properties: ['ammunition', 'heavy'],
    tags: ['martial', 'ranged', 'magic_weapon'],
    enchant_bonus: 9,
    requires_attunement: true,
    mechanics: { weapon_profile: profileValue },
    ...overrides,
  } as unknown as Card;
}

const REQUIRED = [
  'weapon_type',
  'proficiency_category',
  'attack_ability',
  'damage_lines',
  'default_attack_mode',
  'attack_modes',
  'properties',
  'mastery_effect_id',
  'ammo',
  'enchantment',
  'attunement',
] as const;

describe('strict mechanics.weapon_profile authority', () => {
  it('parses a complete profile and ignores every contradictory display field', () => {
    const card = weapon();
    const parsed = parseWeaponProfile(card);
    expect(parsed).toMatchObject({
      valid: true,
      profile: {
        weaponType: 'dagger',
        proficiencyCategory: 'simple',
        attackAbility: 'finesse',
        damageLines: [{ dice: '1d4', type: 'piercing' }],
        defaultAttackMode: 'melee',
        properties: ['finesse', 'light', 'thrown'],
        masteryEffectId: 'effect:mastery:nick',
        ammo: null,
      },
    });
    expect(weaponCategory(card)).toBe('melee');
    const context = weaponContext({
      level: 1, profBonus: 2,
      abilityMods: { str: 1, dex: 4, con: 0, int: 0, wis: 0, cha: 0 },
      equippedCards: [card],
      attunedIds: [],
    }, 'main', { main_hand: card.id });
    expect(context).toMatchObject({
      weaponType: 'dagger', ability: 'dex', dice: '1d4', damageType: 'piercing',
      enchant: 0, proficiencyCategory: 'simple', mastery: 'effect:mastery:nick',
    });
  });

  it.each(REQUIRED)('fails closed when required field %s is absent in parser and schema', (field) => {
    const raw = profile();
    delete raw[field];
    expect(parseWeaponProfile(weapon(raw))).toMatchObject({ valid: false });
    expect(validateMechanics(
      { activation: { mode: 'passive' }, effects: [], weapon_profile: raw },
      { id: `weapon-${field}`, name: field, kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('keeps runtime parser and JSON schema aligned for normalized damage types', () => {
    const raw = profile({ damage_lines: [{ dice: '1d4', type: 'fire damage' }] });
    expect(parseWeaponProfile(weapon(raw))).toMatchObject({ valid: false });
    expect(validateMechanics(
      { activation: { mode: 'passive' }, effects: [], weapon_profile: raw },
      { id: 'weapon-damage-type', name: 'Damage type', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('rejects unknown profile fields instead of silently ignoring them', () => {
    expect(parseWeaponProfile(weapon(profile({ inferred_range: 600 })))).toMatchObject({
      valid: false,
      issue: expect.stringMatching(/unsupported fields/),
    });
  });

  it('owns the Heavy threshold, mode abilities, consequence, and missing-fact failure in data', () => {
    const raw = profile({
      attack_modes: [
        { kind: 'melee', reach_ft: 5 },
        { kind: 'ranged', normal_ft: 20, long_ft: 60 },
      ],
      // This mixed-mode fixture deliberately remains thrown so both data-owned
      // STR (melee) and DEX (ranged) Heavy thresholds are exercised.
      properties: ['heavy', 'thrown', 'two_handed'],
      heavy: {
        minimum_ability_score: 13,
        ability_by_mode: { melee: 'str', ranged: 'dex' },
        consequence: 'attack_disadvantage',
      },
    });
    const parsed = parseWeaponProfile(weapon(raw));
    if (!parsed.valid) throw new Error(parsed.issue);
    expect(evaluateWeaponHeavyRule(parsed.profile, 'melee', { str: 12, dex: 20 }))
      .toEqual({ valid: true, disadvantage: true, ability: 'str', threshold: 13 });
    expect(evaluateWeaponHeavyRule(parsed.profile, 'melee', { str: 13, dex: 1 }))
      .toEqual({ valid: true, disadvantage: false, ability: 'str', threshold: 13 });
    expect(evaluateWeaponHeavyRule(parsed.profile, 'ranged', { str: 20, dex: 12 }))
      .toEqual({ valid: true, disadvantage: true, ability: 'dex', threshold: 13 });
    expect(evaluateWeaponHeavyRule(parsed.profile, 'ranged', { str: 20 }))
      .toMatchObject({ valid: false });
    const missingDeclaration = profile({ properties: ['heavy', 'finesse', 'light', 'thrown'] });
    expect(parseWeaponProfile(weapon(missingDeclaration)))
      .toMatchObject({ valid: false, issue: expect.stringMatching(/heavy property/) });
    expect(validateMechanics(
      { activation: { mode: 'passive' }, effects: [], weapon_profile: missingDeclaration },
      { id: 'weapon-heavy-missing', name: 'Heavy missing', kind: 'passive_effect' },
    ).valid).toBe(false);

    const strayDeclaration = profile({
      heavy: {
        minimum_ability_score: 13,
        ability_by_mode: { melee: 'str', ranged: 'dex' },
        consequence: 'attack_disadvantage',
      },
    });
    expect(parseWeaponProfile(weapon(strayDeclaration)))
      .toMatchObject({ valid: false, issue: expect.stringMatching(/heavy property/) });
    expect(validateMechanics(
      { activation: { mode: 'passive' }, effects: [], weapon_profile: strayDeclaration },
      { id: 'weapon-heavy-stray', name: 'Heavy stray', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('applies the same Heavy declaration in the legacy executor', () => {
    const raw = profile({
      weapon_type: 'greatsword',
      attack_ability: 'str',
      damage_lines: [{ dice: '2d6', type: 'slashing' }],
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: ['heavy', 'two_handed'],
      heavy: {
        minimum_ability_score: 13,
        ability_by_mode: { melee: 'str', ranged: 'dex' },
        consequence: 'attack_disadvantage',
      },
    });
    const card = weapon(raw, { id: 'card:greatsword' });
    const state: RuntimeState = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: { main_hand: card.id, off_hand: card.id },
      inventory: [{ cardId: card.id, qty: 1 }],
      activeEffects: [],
    };
    const mechanics = {
      activation: { mode: 'active', cost: [] },
      effects: [{
        resolution: 'attack_roll', ability: 'auto', attack_kind: 'weapon_melee',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
      }],
    };
    const run = (score: number | undefined) => {
      const tape = [0.95, 0, 0.5, 0.5];
      return executeAction(structuredClone(state), mechanics, {
        character: {
          abilityScores: score === undefined ? { dex: 20 } : { str: score, dex: 20 },
          abilityMods: { str: 1, dex: 5, con: 0, int: 0, wis: 0, cha: 0 },
          profBonus: 2,
          level: 1,
          knownCards: [card],
          equippedCards: [card],
        },
        target: { id: 'target', ac: 10 },
        rng: () => tape.shift() ?? 0.5,
      });
    };
    expect(run(12).events.find((event) => event.type === 'roll'))
      .toMatchObject({ type: 'roll', roll: { advantage: 'disadvantage' } });
    expect(run(13).events.find((event) => event.type === 'roll'))
      .toMatchObject({ type: 'roll', roll: { advantage: 'none' } });
    expect(() => run(undefined)).toThrow(/authoritative str ability score/);
  });

  it('binds exact actor weapon targeting and removes the contextual ammo marker for ammo:null', () => {
    const card = weapon();
    const mechanics = {
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }],
      },
      targeting: { shape: 'single', filter: 'enemy', range_ft: 600 },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_melee',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
      }],
    };
    const bound = bindEquippedWeaponActionContext(
      mechanics,
      { main_hand: card.id },
      new Map([[card.id, card]]),
    );
    expect(bound.targeting).toEqual({ shape: 'single', filter: 'enemy', range_ft: 5 });
    expect((bound.activation as Dict).cost).toEqual([{ resource: 'action' }]);
    expect((bound.effects as Dict[])[0]).toMatchObject({ attack_kind: 'weapon_melee' });
  });

  it('materializes a reusable equipped-weapon action as ranged for a ranged-only weapon', () => {
    const card = weapon(profile({
      weapon_type: 'shortbow',
      attack_ability: 'dex',
      default_attack_mode: 'ranged',
      attack_modes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
      properties: ['ammunition', 'two_handed'],
      ammo: { card_id: 'card:arrow', name: 'Стрела' },
    }), { id: 'card:shortbow', name: 'Короткий лук' });
    const mechanics = {
      activation: {
        mode: 'active',
        cost: [
          { resource: 'action' },
          { resource: EQUIPPED_WEAPON_AMMO_RESOURCE, amount: 1 },
        ],
      },
      targeting: { shape: 'single', filter: 'enemy', range_ft: 600 },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'weapon_ranged',
        on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
      }],
    };

    const bound = bindEquippedWeaponActionContext(
      mechanics,
      { main_hand: card.id },
      new Map([[card.id, card]]),
    );

    expect(bound.targeting).toEqual({ shape: 'single', filter: 'enemy', range_ft: 320 });
    expect((bound.effects as Dict[])[0]).toMatchObject({ attack_kind: 'weapon_ranged' });
    expect((bound.activation as Dict).cost).toEqual([
      { resource: 'action' },
      { resource: 'item', card_id: 'card:arrow', amount: 1, name: 'Стрела' },
    ]);
  });

  it('documents the current deterministic close-range thrown-mode limitation', () => {
    const parsed = parseWeaponProfile(weapon());
    if (!parsed.valid) throw new Error(parsed.issue);
    // Until the sheet exposes an explicit mode selector, <= reach is resolved as melee.
    expect(weaponAttackModeAtDistance(parsed.profile, 5)).toEqual({ kind: 'melee', reachFt: 5 });
    expect(weaponAttackModeAtDistance(parsed.profile, 10)).toEqual({
      kind: 'ranged', normalFt: 20, longFt: 60,
    });
  });
});
