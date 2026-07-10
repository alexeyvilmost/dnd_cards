import { describe, it, expect } from 'vitest';
import { targetingToJson, jsonToTargeting, durationToJson, jsonToDuration, deserializeMechanics } from './blocks';

// PD: наведение (targeting) и длительность (duration) верхнего уровня — round-trip.

describe('targeting', () => {
  it('собирает shape/range/area/filter', () => {
    expect(targetingToJson({ shape: 'area', range: '30 фт', max_targets: '', area_kind: 'sphere', area_size: '20', filter: 'enemy' }))
      .toEqual({ shape: 'area', range: '30 фт', area: { kind: 'sphere', size: 20 }, filter: 'enemy' });
  });
  it('max_targets число → число', () => {
    expect(targetingToJson({ shape: 'multi', max_targets: '3' })).toEqual({ shape: 'multi', max_targets: 3 });
  });
  it('пустое → null', () => {
    expect(targetingToJson({})).toBeNull();
    expect(targetingToJson({ shape: '', range: '' })).toBeNull();
  });
  it('round-trip json↔form', () => {
    const json = { shape: 'area', range: '15 фт', area: { kind: 'cone', size: 15 } };
    expect(targetingToJson(jsonToTargeting(json))).toEqual(json);
  });
});

describe('duration', () => {
  it('rounds + amount', () => {
    expect(durationToJson({ type: 'rounds', amount: '3' })).toEqual({ type: 'rounds', amount: 3 });
  });
  it('concentration + ends_when', () => {
    expect(durationToJson({ type: 'minutes', amount: '10', concentration: true, ends_when: [{ kind: 'you_have_condition', value: 'unconscious' }] }))
      .toEqual({ type: 'minutes', amount: 10, concentration: true, ends_when: [{ kind: 'you_have_condition', value: 'unconscious' }] });
  });
  it('без типа → null', () => {
    expect(durationToJson({})).toBeNull();
    expect(durationToJson({ amount: '5' })).toBeNull();
  });
  it('round-trip json↔form', () => {
    const json = { type: 'rounds', amount: 2, concentration: true };
    expect(durationToJson(jsonToDuration(json))).toEqual(json);
  });
});

describe('deserializeMechanics читает targeting/duration', () => {
  it('верхний уровень', () => {
    const d = deserializeMechanics({
      activation: { mode: 'passive' },
      targeting: { shape: 'single', range: '60 фт' },
      duration: { type: 'rounds', amount: 3 },
      effects: [],
    });
    expect(d?.targeting).toMatchObject({ shape: 'single', range: '60 фт' });
    expect(d?.duration).toMatchObject({ type: 'rounds', amount: '3' });
  });
  it('без них → пустые формы', () => {
    const d = deserializeMechanics({ activation: { mode: 'passive' }, effects: [] });
    expect(targetingToJson(d!.targeting)).toBeNull();
    expect(durationToJson(d!.duration)).toBeNull();
  });
});
