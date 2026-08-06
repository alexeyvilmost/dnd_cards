import { describe, expect, it } from 'vitest';
import {
  conditionApplicationDecision,
  longRestEligibility,
  type ActorRuleTraits,
} from './actorTraits';

const elfTraits: ActorRuleTraits = {
  conditionImmunities: [{
    condition: 'unconscious',
    requiredCauseTags: ['magical', 'sleep'],
    sourceEntityIds: ['RACE-0004', 'feature:fey-ancestry'],
  }],
  restProfile: {
    longRestHours: 4,
    sleepRequired: false,
    sourceEntityIds: ['RACE-0004', 'feature:trance'],
  },
};

describe('actor-owned condition and rest traits', () => {
  it('blocks magical sleep for an Elf without granting blanket Unconscious immunity', () => {
    expect(conditionApplicationDecision(elfTraits, {
      condition: 'Unconscious',
      causeTags: ['spell', 'sleep', 'magical'],
    })).toMatchObject({
      allowed: false,
      immunity: { sourceEntityIds: ['RACE-0004', 'feature:fey-ancestry'] },
    });
    expect(conditionApplicationDecision(elfTraits, {
      condition: 'unconscious',
      causeTags: ['zero_hp'],
    })).toEqual({ allowed: true });
    expect(conditionApplicationDecision(elfTraits, {
      condition: 'prone',
      causeTags: ['magical', 'sleep'],
    })).toEqual({ allowed: true });
    expect(conditionApplicationDecision({
      conditionImmunities: [{
        condition: 'poisoned',
        sourceEntityIds: ['test:blanket-poison-immunity'],
      }],
    }, {
      condition: 'poisoned',
      causeTags: [],
    })).toMatchObject({ allowed: false });
  });

  it('accepts an explicit four-hour Elf Trance but keeps the ordinary rest at eight hours', () => {
    expect(longRestEligibility(elfTraits, 4)).toEqual({
      eligible: true,
      requiredHours: 4,
      sleepRequired: false,
    });
    expect(longRestEligibility(undefined, 4)).toEqual({
      eligible: false,
      requiredHours: 8,
      providedHours: 4,
      sleepRequired: true,
    });
    expect(longRestEligibility(undefined, 8)).toEqual({
      eligible: true,
      requiredHours: 8,
      sleepRequired: true,
    });
  });

  it('fails closed for invalid or insufficient explicit elapsed-time facts', () => {
    expect(longRestEligibility(elfTraits, 3.99)).toMatchObject({ eligible: false, requiredHours: 4 });
    expect(longRestEligibility(elfTraits, Number.NaN)).toMatchObject({ eligible: false, requiredHours: 4 });
  });
});
