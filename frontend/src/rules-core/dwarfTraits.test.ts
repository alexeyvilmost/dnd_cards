import { describe, expect, it } from 'vitest';
import {
  DWARF_SPECIES_CARD,
  effectiveSenseRoundsLeft,
  effectiveSenses,
  fixedDurationRounds,
  STONECUNNING_CARD,
  runtimeSenseEffectIssue,
  stoneworkContactIssue,
  type SenseRuntimeState,
} from './dwarfTraits';

const STONECUNNING_DURATION_ROUNDS = 100;
const STONECUNNING_SENSE_SCOPE = {
  kind: 'stonework',
  stoneForms: ['natural', 'worked'],
  ownerContact: ['on_surface', 'touching_surface'],
  sameSurfaceOnly: true,
  detectsAirborne: false,
  grantsSight: false,
} as const;

/** PHB oracle fixture only; production mechanics are loaded from content. */
function stonecunningMechanics(sourceEntityIds: readonly string[]) {
  const stableSources = [...new Set(sourceEntityIds.filter((id) => id.trim()))].sort();
  if (!stableSources.length) throw new Error('Stonecunning mechanics require source provenance');
  return {
    activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        duration: { type: 'rounds', amount: STONECUNNING_DURATION_ROUNDS },
        senseScope: STONECUNNING_SENSE_SCOPE,
        sourceEntityIds: stableSources,
        stack_id: 'dnd5e-2024:stonecunning:tremorsense',
      }],
    }],
    targeting: { shape: 'self', range: 'На себя', requires_stonework_contact: true },
    uses: { count: 'prof_bonus', per: 'long_rest' },
  };
}

function runtime(
  activeEffects: Array<SenseRuntimeState['activeEffects'][number] & {
    name?: string;
    source?: string;
    ownerId?: string;
    sourceId?: string;
  }> = [],
): SenseRuntimeState {
  return { activeEffects };
}

describe('Dwarf 2024 pure traits', () => {
  it('normalizes the exact ten-minute Stonecunning duration to 100 combat rounds', () => {
    expect(fixedDurationRounds({ type: 'minutes', amount: 10 })).toBe(STONECUNNING_DURATION_ROUNDS);
    expect(fixedDurationRounds({ type: 'rounds', amount: 100 })).toBe(STONECUNNING_DURATION_ROUNDS);
    expect(fixedDurationRounds({ type: 'hours', amount: 1 })).toBe(600);
    for (const malformed of [undefined, {}, { type: 'minutes', amount: 0 },
      { type: 'minutes', amount: -1 }, { type: 'rounds', amount: 1.5 },
      { type: 'minutes', amount: 0.15 }, { type: 'hours', amount: 0.001 },
      { type: 'days', amount: 1 }]) {
      expect(fixedDurationRounds(malformed)).toBeNull();
    }
  });

  it('accepts on/touching natural/worked stone and rejects every missing conjunct', () => {
    for (const stoneForm of ['natural', 'worked'] as const) {
      for (const contact of ['on_surface', 'touching_surface'] as const) {
        expect(stoneworkContactIssue({ material: 'stone', stoneForm, contact })).toBeNull();
      }
    }
    for (const invalid of [
      undefined,
      { material: 'other', stoneForm: 'natural', contact: 'on_surface' },
      { material: 'stone', contact: 'on_surface' },
      { material: 'stone', stoneForm: 'metal', contact: 'on_surface' },
      { material: 'stone', stoneForm: 'worked', contact: 'none' },
    ]) {
      expect(stoneworkContactIssue(invalid)).toMatch(/Stonecunning/);
    }
  });

  it('builds one source-owned Bonus Action with PB/Long Rest uses and exact sense scope', () => {
    const mechanics = stonecunningMechanics(['species-id', 'effect-id', 'effect-id']);
    expect(mechanics).toEqual({
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'grant_sense',
          sense: 'tremorsense',
          range: 60,
          duration: { type: 'rounds', amount: 100 },
          senseScope: STONECUNNING_SENSE_SCOPE,
          sourceEntityIds: ['effect-id', 'species-id'],
          stack_id: 'dnd5e-2024:stonecunning:tremorsense',
        }],
      }],
      targeting: { shape: 'self', range: 'На себя', requires_stonework_contact: true },
      uses: { count: 'prof_bonus', per: 'long_rest' },
    });
    expect(() => stonecunningMechanics([])).toThrow(/source provenance/);
  });

  it('projects a temporary Tremorsense beside build Darkvision with duration and provenance', () => {
    const mechanics = (stonecunningMechanics(['species-id', 'effect-id']).effects as Array<{
      result: Record<string, unknown>[];
    }>)[0].result[0];
    const projected = effectiveSenses({
      build: [{ sense: 'darkvision', range: 120, sourceEntityIds: ['species-id'] }],
      runtime: runtime([{
        id: 'stone-sense-1',
        name: 'Stonecunning',
        mechanics,
        roundsLeft: 100,
        source: 'Stonecunning',
        ownerId: 'dwarf',
        sourceId: 'dwarf',
      }]),
    });
    expect(projected).toEqual([
      {
        sense: 'darkvision', range: 120,
        sources: [{ kind: 'build', sourceEntityIds: ['species-id'] }],
      },
      {
        sense: 'tremorsense', range: 60,
        sources: [{
          kind: 'runtime', sourceEntityIds: ['effect-id', 'species-id'],
          runtimeEffectId: 'stone-sense-1', roundsLeft: 100,
        }],
      },
    ]);
    expect(effectiveSenseRoundsLeft(projected[0])).toBeNull();
    expect(effectiveSenseRoundsLeft(projected[1])).toBe(100);
    expect(effectiveSenseRoundsLeft({
      sense: 'blindsight', range: 30,
      sources: [
        { kind: 'runtime', sourceEntityIds: [], roundsLeft: 3 },
        { kind: 'runtime', sourceEntityIds: [], roundsLeft: 7 },
      ],
    })).toBe(7);
    expect(effectiveSenseRoundsLeft({
      sense: 'truesight', range: 30,
      sources: [{ kind: 'runtime', sourceEntityIds: [] }],
    })).toBeNull();

    const guarded = effectiveSenses({
      build: [
        { sense: '', range: 60 },
        { sense: 'invalid-range', range: Number.NaN },
        { sense: 'darkvision', range: 60 },
      ],
      runtime: runtime([
        { id: 'expired', mechanics: { kind: 'grant_sense', sense: 'blindsight', range: 30 }, roundsLeft: 0 },
        { id: 'other', mechanics: { kind: 'modifier', value: 1 } },
        { id: 'blank', mechanics: { kind: 'grant_sense', range: 30 } },
        { id: 'permanent-runtime', mechanics: {
          kind: 'grant_sense', sense: 'darkvision', range: 90,
        } },
      ]),
    });
    expect(guarded).toEqual([{
      sense: 'darkvision', range: 90,
      sources: [
        { kind: 'build', sourceEntityIds: [] },
        {
          kind: 'runtime', sourceEntityIds: [], runtimeEffectId: 'permanent-runtime',
        },
      ],
    }]);

    const enveloped = effectiveSenses({
      build: [],
      runtime: runtime([{
        id: 'spell-darkvision', roundsLeft: 4800,
        mechanics: {
          activation: { mode: 'passive' },
          effects: [{ resolution: 'auto', result: [{
            kind: 'grant_sense', sense: 'darkvision', range: 150,
          }] }],
        },
      }]),
    });
    expect(enveloped).toEqual([{
      sense: 'darkvision', range: 150,
      sources: [{
        kind: 'runtime', sourceEntityIds: [], runtimeEffectId: 'spell-darkvision', roundsLeft: 4800,
      }],
    }]);
  });

  it('validates every persisted sense generically without recognizing Stonecunning by shape', () => {
    const mechanics = (stonecunningMechanics([
      'species-id', 'effect-id', DWARF_SPECIES_CARD, STONECUNNING_CARD,
    ]).effects as Array<{
      result: Record<string, unknown>[];
    }>)[0].result[0];
    const valid = {
      id: 'sense', name: 'Stonecunning', mechanics, roundsLeft: 100,
      source: 'Stonecunning', ownerId: 'dwarf', sourceId: 'dwarf',
    };
    expect(runtimeSenseEffectIssue(valid, 'dwarf')).toBeNull();
    for (const malformedLabels of [
      { id: '' }, { id: 7 },
      { name: '' }, { name: 7 },
      { source: '' }, { source: 7 },
    ]) {
      expect(runtimeSenseEffectIssue({ ...valid, ...malformedLabels }, 'dwarf'))
        .toMatch(/stable effect and source labels/);
    }
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: { ...mechanics, sourceEntityIds: ['custom-stonecunning-source'] },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({ ...valid, ownerId: 'forged' }, 'dwarf'))
      .toMatch(/owner and source/);
    expect(runtimeSenseEffectIssue({ ...valid, sourceId: '' }, 'dwarf'))
      .toMatch(/owner and source/);
    for (const malformedSense of [
      { sense: '' }, { sense: 7 },
      { range: 0 }, { range: Number.NaN },
    ]) {
      expect(runtimeSenseEffectIssue({
        ...valid, mechanics: { ...mechanics, ...malformedSense },
      }, 'dwarf')).toMatch(/non-empty sense and positive finite range/);
    }
    expect(runtimeSenseEffectIssue({ ...valid, roundsLeft: 101 }, 'dwarf'))
      .toMatch(/declared fixed duration/);
    expect(runtimeSenseEffectIssue({
      ...valid,
      roundsLeft: 1,
      mechanics: { ...mechanics, duration: undefined },
    }, 'dwarf')).toMatch(/without a fixed duration/);
    const { roundsLeft: _roundsLeft, ...withoutRoundsLeft } = valid;
    expect(runtimeSenseEffectIssue({
      ...withoutRoundsLeft,
      mechanics: { ...mechanics, duration: undefined },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({
      ...valid, mechanics: { ...mechanics, range: 30 },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({
      ...valid,
      roundsLeft: 99,
      mechanics: { ...mechanics, duration: { type: 'rounds', amount: 99 } },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: {
        ...mechanics,
        senseScope: { ...STONECUNNING_SENSE_SCOPE, grantsSight: true },
      },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: { ...mechanics, sourceEntityIds: [] },
    }, 'dwarf')).toMatch(/non-empty, unique sourceEntityIds/);
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: { ...mechanics, sourceEntityIds: ['duplicate', 'duplicate'] },
    }, 'dwarf')).toMatch(/non-empty, unique sourceEntityIds/);
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: { ...mechanics, sourceEntityIds: [' padded-source '] },
    }, 'dwarf')).toMatch(/non-empty, unique sourceEntityIds/);
    expect(runtimeSenseEffectIssue({
      ...valid,
      mechanics: { ...mechanics, senseScope: {} },
    }, 'dwarf')).toMatch(/scope.*kind/);
    expect(runtimeSenseEffectIssue({
      ...valid,
      name: 'Alien tremor source',
      source: 'effect:alien-tremor',
      sourceId: 'other-caster',
      roundsLeft: 7,
      mechanics: {
        kind: 'grant_sense', sense: 'tremorsense', range: 17,
        duration: { type: 'rounds', amount: 7 },
        sourceEntityIds: ['effect:alien-tremor'],
      },
    }, 'dwarf')).toBeNull();
    expect(runtimeSenseEffectIssue({
      ...valid, mechanics: { kind: 'modifier', value: 1 },
    }, 'dwarf')).toBeNull();
  });
});
