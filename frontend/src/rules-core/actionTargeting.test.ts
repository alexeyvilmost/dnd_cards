import { describe, expect, it } from 'vitest';
import {
  ActionTargetingDefinitionError,
  compileDeclaredMechanicsTargeting,
  compileMechanicsTargeting,
} from './actionTargeting';
import type { JsonObject } from './domain';

function explicitTargeting(overrides: JsonObject = {}): JsonObject {
  return {
    targeting: {
      domain: 'actor',
      actor_targets: true,
      range_ft: 30,
      allowed_relations: ['enemy'],
      requires_line_of_sight: true,
      shape: 'single',
      ...overrides,
    },
  };
}

describe('compileMechanicsTargeting', () => {
  it('compiles numeric mechanics geometry without consulting identity or display text', () => {
    const first = compileMechanicsTargeting({
      id: 'localized-a', name: 'Касание — не авторитетно',
      ...explicitTargeting(),
    });
    const second = compileMechanicsTargeting({
      id: 'unrelated-b', name: 'Self 999 feet — also not authoritative',
      ...explicitTargeting(),
    });
    expect(first).toEqual(second);
    expect(first).toEqual({
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    });
  });

  it('treats both legacy and explicit self shapes as requiring no command target ids', () => {
    expect(compileMechanicsTargeting({
      targeting: { shape: 'self', range: 'На себя' },
    })).toMatchObject({ minTargets: 0, rangeFt: 0, requiresLineOfSight: false });
    expect(compileMechanicsTargeting({
      targeting: {
        domain: 'actor', actor_targets: false, shape: 'self', range_ft: 0,
        allowed_relations: ['self'], requires_line_of_sight: false,
      },
    })).toEqual({
      minTargets: 0,
      maxTargets: 1,
      rangeFt: 0,
      requiresLineOfSight: false,
      allowedRelations: ['self'],
    });
  });

  it('compiles a data-owned world area and keeps actor relations empty', () => {
    expect(compileMechanicsTargeting({
      targeting: {
        domain: 'world', actor_targets: false, shape: 'area', range_ft: 10,
        min_targets: 0, max_targets: 1, allowed_relations: [],
        requires_line_of_sight: false,
        area: { kind: 'sphere', radius_ft: 5 },
      },
    })).toEqual({
      minTargets: 0,
      maxTargets: 1,
      rangeFt: 10,
      requiresLineOfSight: false,
      allowedRelations: [],
    });
  });

  it('supports an explicit world-only action with zero actor targets', () => {
    expect(compileDeclaredMechanicsTargeting({
      targeting: {
        domain: 'world', actor_targets: false, shape: 'single',
        min_targets: 0, max_targets: 0, range_ft: 0,
        requires_line_of_sight: false, allowed_relations: [],
      },
    })).toEqual({
      minTargets: 0, maxTargets: 0, rangeFt: 0,
      requiresLineOfSight: false, allowedRelations: [],
    });
  });

  it.each([
    [{ domain: 'world', actor_targets: true }, /contradicts/],
    [{ domain: 'actor', actor_targets: false, shape: 'single' }, /contradicts/],
    [{ domain: 'planar', actor_targets: true }, /domain/],
    [{ shape: 'hex' }, /shape/],
    [{ range_ft: Number.NaN }, /range_ft/],
    [{ allowed_relations: ['enemy', 'enemy'] }, /unique/],
    [{ domain: 'actor', actor_targets: false, shape: 'self', allowed_relations: [] }, /exactly self/],
    [{ domain: 'actor', actor_targets: false, shape: 'self', allowed_relations: ['ally'] }, /exactly self/],
    [{ area: { kind: 'sphere', radius_ft: 5, size_ft: 10 } }, /one numeric size/],
  ] as const)('rejects malformed or contradictory targeting %#', (overrides, pattern) => {
    expect(() => compileMechanicsTargeting(explicitTargeting(overrides as JsonObject)))
      .toThrow(pattern);
  });

  it('exposes a stable definition error type', () => {
    expect(() => compileMechanicsTargeting(explicitTargeting({ range_ft: -1 })))
      .toThrow(ActionTargetingDefinitionError);
  });
});

describe('compileDeclaredMechanicsTargeting', () => {
  const certified = (): JsonObject => ({
    targeting: {
      domain: 'actor',
      actor_targets: true,
      shape: 'single',
      min_targets: 1,
      max_targets: 1,
      range_ft: 30,
      requires_line_of_sight: true,
      allowed_relations: ['enemy'],
      range: 'локализованный текст не участвует',
    },
  });

  it('compiles a complete declaration without display-text inference', () => {
    expect(compileDeclaredMechanicsTargeting(certified())).toEqual({
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    });
  });

  it('projects the explicit Touch marker without consulting localized range text', () => {
    const mechanics = certified();
    (mechanics.targeting as JsonObject).range_ft = 5;
    (mechanics.targeting as JsonObject).requires_touch = true;
    (mechanics.targeting as JsonObject).range = 'arbitrary display copy';
    expect(compileDeclaredMechanicsTargeting(mechanics)).toMatchObject({
      rangeFt: 5,
      requiresTouch: true,
    });
  });

  it.each([
    'shape', 'domain', 'actor_targets', 'min_targets', 'max_targets',
    'range_ft', 'requires_line_of_sight', 'allowed_relations',
  ])('rejects omission of %s instead of using a default', (key) => {
    const mechanics = certified();
    delete (mechanics.targeting as JsonObject)[key];
    expect(() => compileDeclaredMechanicsTargeting(mechanics)).toThrow(/missing explicit/);
  });

  it('rejects legacy area.size and requires one numeric area authority', () => {
    const legacy = certified();
    (legacy.targeting as JsonObject).shape = 'area';
    (legacy.targeting as JsonObject).area = { kind: 'cone', size: 15 };
    expect(() => compileDeclaredMechanicsTargeting(legacy)).toThrow(/size_ft or radius_ft/);

    (legacy.targeting as JsonObject).area = { kind: 'cone', size_ft: 15 };
    expect(() => compileDeclaredMechanicsTargeting(legacy)).not.toThrow();
  });
});
