import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';
import {
  BUILTIN_CONDITION_RULES,
  conditionLevel,
  replaceConditionsFromDatabase,
  resetConditionsToOfflineFixture,
} from './conditions';
import {
  applyEffectCommandFromEntity,
  collectConditionImmunitiesFromPassives,
  conditionIdFromEffectEntity,
  executeManualEffectCommand,
  type ManualConditionEffectEntity,
  type ManualEffectApplicationFacts,
} from './manualEffectCommands';

function fresh(activeEffects: ActiveEffectEntry[] = []): RuntimeState {
  return {
    hp: { current: 20, max: 20, temp: 0 },
    resources: {},
    maxResources: {},
    equipment: {},
    inventory: [],
    activeEffects,
  };
}

function entity(conditionId: string, name = `localized:${conditionId}`): ManualConditionEffectEntity {
  return {
    id: `db-effect:${conditionId}`,
    name,
    effect_type: 'condition',
    mechanics: { condition: { id: conditionId }, effects: [] },
  };
}

function facts(overrides: Partial<ManualEffectApplicationFacts> = {}): ManualEffectApplicationFacts {
  return {
    ownerActorId: 'actor:target',
    conditionImmunities: [],
    causeTags: [],
    ...overrides,
  };
}

function ids() {
  let index = 0;
  return { nextId: (prefix: string) => `${prefix}:test:${index += 1}` };
}

let generatedId = 0;

function apply(
  state: RuntimeState,
  conditionId: string,
  applicationFacts: ManualEffectApplicationFacts = facts(),
  provenance = 'manual:test_surface',
) {
  return executeManualEffectCommand(
    state,
    applyEffectCommandFromEntity(entity(conditionId), provenance, applicationFacts),
    { nextId: (prefix) => `${prefix}:shared-test:${generatedId += 1}` },
  );
}

beforeEach(() => {
  generatedId = 0;
  replaceConditionsFromDatabase(
    Object.values(BUILTIN_CONDITION_RULES),
    `sha256:${'1'.repeat(64)}`,
  );
});

afterEach(() => {
  resetConditionsToOfflineFixture('manual_effect_test_cleanup');
});

describe('manual ApplyEffect/RemoveEffect interpreter', () => {
  it('gives desktop and mobile commands identical mechanical outcomes without using localized names', () => {
    const desktop = executeManualEffectCommand(
      fresh(),
      applyEffectCommandFromEntity(
        entity('poisoned', 'Отравлен — desktop label'),
        'manual:sheet_conditions',
        facts(),
      ),
      { nextId: () => 'desktop-id' },
    );
    const mobile = executeManualEffectCommand(
      fresh(),
      applyEffectCommandFromEntity(
        entity('poisoned', 'Completely different mobile label'),
        'manual:mobile_entity_catalog',
        facts(),
      ),
      { nextId: () => 'mobile-id' },
    );

    expect(desktop.events).toEqual([{ type: 'condition_applied', condition: 'poisoned' }]);
    expect(mobile.events).toEqual(desktop.events);
    expect(desktop.state.activeEffects[0].mechanics).toMatchObject({
      kind: 'condition', value: 'poisoned', source_entity_id: 'db-effect:poisoned',
    });
    expect(mobile.state.activeEffects[0].mechanics).toMatchObject({
      kind: 'condition', value: 'poisoned', source_entity_id: 'db-effect:poisoned',
    });
    expect(desktop.state.activeEffects[0].name).toBe(BUILTIN_CONDITION_RULES.poisoned.label);
    expect(mobile.state.activeEffects[0].name).toBe(BUILTIN_CONDITION_RULES.poisoned.label);
  });

  it('fails closed without database authority and never derives identity from a name', () => {
    resetConditionsToOfflineFixture('database_unavailable');
    expect(() => conditionIdFromEffectEntity(entity('poisoned', 'poisoned')))
      .toThrow(/database condition authority is unavailable/);
    replaceConditionsFromDatabase(
      Object.values(BUILTIN_CONDITION_RULES),
      `sha256:${'2'.repeat(64)}`,
    );
    expect(() => conditionIdFromEffectEntity({
      ...entity('poisoned'),
      mechanics: { effects: [] },
    })).toThrow(/mechanics\.condition/);
  });

  it('extracts source-provenanced conditional immunity primitives from passives', () => {
    const immunities = collectConditionImmunitiesFromPassives([{
      id: 'effect:fey_ancestry',
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'condition_immunity',
          condition: 'unconscious',
          required_cause_tags: ['magical', 'sleep'],
        }],
      }],
    }]);
    const blocked = apply(fresh(), 'unconscious', facts({
      conditionImmunities: immunities,
      causeTags: ['sleep', 'magical'],
    }));
    expect(blocked.state.activeEffects).toEqual([]);
    expect(blocked.events).toEqual([{
      type: 'condition_immune',
      condition: 'unconscious',
      sourceEntityIds: ['effect:fey_ancestry'],
    }]);

    const ordinaryKnockout = apply(fresh(), 'unconscious', facts({
      conditionImmunities: immunities,
      causeTags: ['damage'],
    }));
    expect(conditionLevel(ordinaryKnockout.state, 'unconscious')).toBe(1);
  });

  it('reads condition-owned immunity and blocks Poisoned while Petrified is active', () => {
    const petrified = apply(fresh(), 'petrified').state;
    const poisoned = apply(petrified, 'poisoned');
    expect(conditionLevel(poisoned.state, 'poisoned')).toBe(0);
    expect(poisoned.events).toEqual([{
      type: 'condition_immune',
      condition: 'poisoned',
      sourceEntityIds: [petrified.activeEffects[0].id],
    }]);
  });

  it('applies levelled stacking, caps Exhaustion at six, and emits the declared threshold', () => {
    let state = fresh();
    let lastEvents = [] as ReturnType<typeof apply>['events'];
    for (let level = 1; level <= 6; level += 1) {
      const result = apply(state, 'exhaustion');
      state = result.state;
      lastEvents = result.events;
      expect(conditionLevel(state, 'exhaustion')).toBe(level);
    }
    expect(lastEvents).toContainEqual(expect.objectContaining({
      type: 'narrative',
      text: expect.stringContaining('death'),
    }));
    const capped = apply(state, 'exhaustion');
    expect(conditionLevel(capped.state, 'exhaustion')).toBe(6);
    expect(capped.events).toEqual([expect.objectContaining({
      type: 'narrative',
      text: expect.stringContaining('максимальный уровень 6'),
    })]);
  });

  it('drops the concentration chip and every linked effect through composed Incapacitated', () => {
    const state = fresh([
      {
        id: 'spell-effect',
        name: 'Spell payload',
        mechanics: { kind: 'modifier', duration: { concentration: true } },
        source: 'Spell',
      },
      {
        id: 'concentration',
        name: 'Concentration: Spell',
        mechanics: { kind: 'concentration', effectIds: ['spell-effect'] },
        source: 'Spell',
      },
    ]);
    const result = apply(state, 'stunned');
    expect(result.state.activeEffects.map((effect) => effect.id))
      .toEqual([expect.stringContaining('condition:stunned')]);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'narrative', text: expect.stringContaining('Концентрация потеряна'),
    }));
  });

  it('removes an exact condition instance and materializes declared leaves', () => {
    const unconscious = apply(fresh(), 'unconscious').state;
    const result = executeManualEffectCommand(unconscious, {
      type: 'RemoveEffect',
      effectId: unconscious.activeEffects[0].id,
      ownerActorId: 'actor:target',
      provenance: 'manual:sheet_conditions',
    }, ids());
    expect(conditionLevel(result.state, 'unconscious')).toBe(0);
    expect(conditionLevel(result.state, 'prone')).toBe(1);
    expect(result.events).toContainEqual({ type: 'condition_applied', condition: 'prone' });
  });

  it('requires the explicit source actor fact for relational condition mechanics', () => {
    expect(() => apply(fresh(), 'frightened')).toThrow(/explicit source actor id/);
    expect(apply(fresh(), 'frightened', facts({ sourceActorId: 'actor:dragon' })).state.activeEffects[0])
      .toMatchObject({ sourceId: 'actor:dragon' });
  });

  it('dismisses an ordinary well-formed non-condition effect with no top-level kind', () => {
    const state = fresh([{
      id: 'ordinary-spell-effect',
      name: 'Ordinary effect',
      mechanics: {
        activation: { mode: 'passive' },
        effects: [{ resolution: 'auto', result: [{ kind: 'modifier', op: 'add', value: '1' }] }],
      },
      source: 'spell:ordinary',
    }]);
    const result = executeManualEffectCommand(state, {
      type: 'RemoveEffect',
      effectId: 'ordinary-spell-effect',
      ownerActorId: 'actor:target',
      provenance: 'manual:sheet_runtime',
    }, ids());
    expect(result.state.activeEffects).toEqual([]);
    expect(result.events).toEqual([{ type: 'effect_expired', name: 'Ordinary effect' }]);
  });

  it('rejects the old mobile shape instead of persisting an inert condition card', () => {
    const state = fresh([{
      id: 'legacy-mobile',
      name: 'Poisoned',
      mechanics: { condition: { id: 'poisoned' }, effects: [] },
      source: 'legacy-mobile',
    }]);
    expect(() => apply(state, 'prone')).toThrow(/unmaterialized condition entity/);
  });
});
