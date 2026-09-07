import { describe, expect, it } from 'vitest';
import {
  buildMaterializedRuntimeEffectRegistry,
  resolveMaterializedRuntimeEffects,
} from './materializedRuntimeEffects';

describe('materialized runtime effect semantic projection', () => {
  const effect = {
    id: '00000000-0000-4000-8000-000000000001',
    card_number: 'EFFECT-runtime-test',
    mechanics: { kind: 'modifier', op: 'add', value: 2 },
  };

  it('folds a migration-owned reference to the exact library payload', () => {
    const registry = buildMaterializedRuntimeEffectRegistry([effect]);
    expect(resolveMaterializedRuntimeEffects({
      effects: [{ result: [{ kind: 'grant_effect', value: effect.card_number }] }],
    }, registry)).toEqual({
      effects: [{ result: [{ kind: 'modifier', op: 'add', value: 2 }] }],
    });
  });

  it('fails closed for missing, decorated, ambiguous and cyclic references', () => {
    const registry = buildMaterializedRuntimeEffectRegistry([effect]);
    expect(() => resolveMaterializedRuntimeEffects(
      { kind: 'grant_effect', value: 'EFFECT-runtime-missing' },
      registry,
    )).toThrow(/unresolved/);
    expect(() => resolveMaterializedRuntimeEffects(
      { kind: 'grant_effect', value: effect.card_number, duration: { type: 'rounds', amount: 1 } },
      registry,
    )).toThrow(/unexpected fields/);
    expect(() => buildMaterializedRuntimeEffectRegistry([
      effect,
      { ...effect, id: '00000000-0000-4000-8000-000000000002' },
    ])).toThrow(/ambiguous/);
    const cyclic = {
      ...effect,
      mechanics: { kind: 'grant_effect', value: effect.card_number },
    };
    expect(() => resolveMaterializedRuntimeEffects(
      cyclic.mechanics,
      buildMaterializedRuntimeEffectRegistry([cyclic]),
    )).toThrow(/cycle/);
  });

  it('preserves ordinary grant_effect relationships', () => {
    const registry = buildMaterializedRuntimeEffectRegistry([effect]);
    const value = { kind: 'grant_effect', value: 'EFFECT-authored' };
    expect(resolveMaterializedRuntimeEffects(value, registry)).toEqual(value);
  });
});
