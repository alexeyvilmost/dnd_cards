import { describe, expect, it } from 'vitest';
import type { JsonObject } from './domain';
import {
  magicMissileDartCount,
  parseWorldSpellPolicy,
  type MagicMissilePolicy,
  type ManagedWorldSpellPrimitiveType,
} from './worldSpellPolicies';
import { managedWorldSpellMechanics } from './testing/worldSpellPolicyFixtures';

const TYPES: ManagedWorldSpellPrimitiveType[] = [
  'light_world_object',
  'burning_hands_objects',
  'detect_magic_world_sensing',
  'minor_illusion_world_object',
  'dancing_lights_world',
  'druidcraft_world',
  'mending_world',
  'detect_poison_disease_world',
  'purify_food_drink_world',
  'prestidigitation_world',
  'magic_missile',
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function primitivePolicy(mechanics: JsonObject): JsonObject {
  return ((mechanics.primitive as JsonObject).policy as JsonObject);
}

describe('parseWorldSpellPolicy', () => {
  it.each(TYPES)('parses the complete explicit %s contract', (type) => {
    expect(parseWorldSpellPolicy(managedWorldSpellMechanics(type))).toMatchObject({
      status: 'valid', primitiveType: type,
    });
  });

  it('is not applicable to generic mechanics and does not inspect identity or name', () => {
    expect(parseWorldSpellPolicy({ id: 'light', name: 'Magic Missile' }))
      .toEqual({ status: 'not_applicable' });
    expect(parseWorldSpellPolicy({ primitive: { type: 'custom_effect' } }))
      .toEqual({ status: 'not_applicable' });
  });

  it.each(TYPES)('rejects missing policy for managed primitive %s', (type) => {
    const mechanics = managedWorldSpellMechanics(type);
    mechanics.primitive = { type };
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({ status: 'invalid' });
  });

  it.each([
    ['light_world_object', 'duration_rounds'],
    ['dancing_lights_world', 'max_move_ft'],
    ['druidcraft_world', 'sensory_cube_side_ft'],
    ['mending_world', 'max_break_dimension_ft'],
    ['prestidigitation_world', 'max_active_effects'],
  ] as const)('rejects NaN, negative, and zero invalid values in %s.%s', (type, key) => {
    for (const value of [Number.NaN, -1, 0]) {
      const mechanics = managedWorldSpellMechanics(type);
      primitivePolicy(mechanics)[key] = value;
      expect(parseWorldSpellPolicy(mechanics)).toMatchObject({ status: 'invalid' });
    }
  });

  it.each([
    ['light_world_object', 'duration_rounds'],
    ['dancing_lights_world', 'duration_rounds'],
    ['druidcraft_world', 'weather_duration_rounds'],
    ['prestidigitation_world', 'max_active_effects'],
    ['magic_missile', 'base_dart_count'],
  ] as const)('rejects fractional count or duration in %s.%s', (type, key) => {
    const mechanics = managedWorldSpellMechanics(type);
    primitivePolicy(mechanics)[key] = 1.5;
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({ status: 'invalid' });
  });

  it('rejects an unexpected policy field and a primitive-level legacy constant', () => {
    const unexpected = managedWorldSpellMechanics('light_world_object');
    primitivePolicy(unexpected).radius_ft = 20;
    expect(parseWorldSpellPolicy(unexpected)).toMatchObject({ status: 'invalid' });

    const legacy = managedWorldSpellMechanics('magic_missile');
    (legacy.primitive as JsonObject).dart_count = 3;
    expect(parseWorldSpellPolicy(legacy)).toMatchObject({ status: 'invalid' });
  });

  it.each([
    ['light_world_object', 'area'],
    ['burning_hands_objects', 'single'],
    ['detect_magic_world_sensing', 'aura'],
    ['minor_illusion_world_object', 'multiple'],
    ['dancing_lights_world', 'single'],
    ['purify_food_drink_world', 'single'],
    ['magic_missile', 'single'],
  ] as const)('rejects a valid generic but wrong primitive shape for %s', (type, shape) => {
    const mechanics = managedWorldSpellMechanics(type);
    (mechanics.targeting as JsonObject).shape = shape;
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({
      status: 'invalid', issue: expect.stringMatching(/shape|domain/),
    });
  });

  it('rejects contradictory target domain and actor target declarations', () => {
    const mechanics = managedWorldSpellMechanics('minor_illusion_world_object');
    (mechanics.targeting as JsonObject).actor_targets = true;
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({
      status: 'invalid', issue: expect.stringMatching(/contradicts|domain/),
    });
  });

  it('rejects malformed blocker thresholds', () => {
    const mechanics = managedWorldSpellMechanics('detect_magic_world_sensing');
    const blockers = primitivePolicy(mechanics).blockers as JsonObject;
    (blockers.stone as JsonObject).threshold_inches = -1;
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({ status: 'invalid' });
  });

  it.each([
    { resolution: 'auto', who: 'target', result: [{ kind: 'damage', type: 'force' }] },
    { resolution: 'auto', who: 'target', result: [{ kind: 'damage', dice: 'bad(', type: 'force' }] },
    { resolution: 'auto', who: 'target', result: [{ kind: 'unknown', dice: '1d4 + 1', type: 'force' }] },
    { resolution: 'save', who: 'target', result: [{ kind: 'damage', dice: '1d4 + 1', type: 'force' }] },
  ])('rejects a non-executable Magic Missile per-dart effect %#', (effect) => {
    const mechanics = managedWorldSpellMechanics('magic_missile');
    primitivePolicy(mechanics).per_dart_effect = effect;
    expect(parseWorldSpellPolicy(mechanics)).toMatchObject({ status: 'invalid' });
  });

  it('derives upcast dart count entirely from parsed policy', () => {
    const mechanics = managedWorldSpellMechanics('magic_missile');
    const policy = primitivePolicy(mechanics);
    policy.base_dart_count = 2;
    policy.darts_per_slot_above = 2;
    (mechanics.targeting as JsonObject).max_targets = 18;
    const parsed = parseWorldSpellPolicy(mechanics);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid' || parsed.primitiveType !== 'magic_missile') return;
    const missilePolicy = parsed.policy as MagicMissilePolicy;
    expect(magicMissileDartCount(missilePolicy, 1)).toBe(2);
    expect(magicMissileDartCount(missilePolicy, 3)).toBe(6);
    expect(magicMissileDartCount(missilePolicy, 0)).toBeNull();
    expect(magicMissileDartCount(missilePolicy, 10)).toBeNull();
  });

  it('returns detached policy data rather than retaining a caller-owned effect object', () => {
    const mechanics = managedWorldSpellMechanics('magic_missile');
    const before = clone(mechanics);
    const parsed = parseWorldSpellPolicy(mechanics);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid' || parsed.primitiveType !== 'magic_missile') return;
    (primitivePolicy(mechanics).per_dart_effect as JsonObject).resolution = 'save';
    expect((parsed.policy as MagicMissilePolicy).perDartEffect)
      .toEqual(primitivePolicy(before).per_dart_effect);
  });
});
