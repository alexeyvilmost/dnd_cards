import { describe, expect, it } from 'vitest';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import {
  BUILTIN_CONDITION_RULES,
  activeConditionWorldFactEnabled,
  conditionLevel,
  conditionLongRestEntries,
  conditionRuntimePayloads,
  conditionThresholdOutcomes,
  conditionWorldFacts,
  expandConditionSet,
} from './conditions';
import {
  collectModifiers,
  conditionCapabilityDenied,
  foldModifiers,
} from './modifiers';
import { projectedAgainst } from './execute';
import { longRest } from './turn';

const CHARACTER: CharacterContext = {
  abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  profBonus: 2,
  level: 1,
};

function state(...conditions: Array<string | { value: string; sourceId?: string }>): RuntimeState {
  return {
    hp: { current: 20, max: 20, temp: 0 },
    resources: {}, maxResources: {}, equipment: {}, inventory: [],
    activeEffects: conditions.map((input, index) => {
      const condition = typeof input === 'string' ? { value: input } : input;
      return {
        id: `condition:${index}`,
        name: condition.value,
        mechanics: { kind: 'condition', value: condition.value, op: 'apply' },
        source: 'test',
        ...(condition.sourceId ? { sourceId: condition.sourceId } : {}),
      };
    }),
  };
}

describe('PHB 2024 condition completeness — generic data primitives', () => {
  it('register contains the exact 15-condition denominator', () => {
    expect(Object.keys(BUILTIN_CONDITION_RULES).sort()).toEqual([
      'blinded', 'charmed', 'deafened', 'exhaustion', 'frightened',
      'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified',
      'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
    ]);
  });

  it('Exhaustion is cumulative data: -2 to every D20 Test and -5 speed per level', () => {
    const exhausted = state('exhaustion', 'exhaustion', 'exhaustion');
    const d20 = collectModifiers(exhausted, [], { roll: 'ability_check' });
    const speed = collectModifiers(exhausted, [], { roll: 'speed' });
    expect(conditionLevel(exhausted, 'exhaustion')).toBe(3);
    expect(d20.modifiers.map((entry) => entry.value)).toEqual([-2, -2, -2]);
    expect(foldModifiers(30, speed).value).toBe(15);
  });

  it('one Long Rest removes exactly one Exhaustion level and preserves the rest', () => {
    const exhausted = state('exhaustion', 'exhaustion', 'exhaustion');
    const planned = conditionLongRestEntries(exhausted.activeEffects);
    expect(planned.removed).toHaveLength(1);
    expect(planned.retained).toHaveLength(2);
    const rested = longRest(exhausted, CHARACTER).state;
    expect(conditionLevel(rested, 'exhaustion')).toBe(2);
  });

  it('a Long Rest does not cure an ordinary condition without a declared rest transition', () => {
    const poisoned = state('poisoned');
    expect(longRest(poisoned, CHARACTER).state.activeEffects).toHaveLength(1);
  });

  it('level 6 exposes a generic terminal death fact without a condition-name branch', () => {
    const exhausted = state(...Array.from({ length: 6 }, () => 'exhaustion'));
    expect(conditionThresholdOutcomes(exhausted)).toContainEqual({
      condition: 'exhaustion', level: 6, outcome: 'death',
    });
  });

  it('Petrified contributes all-damage resistance and Poisoned immunity payloads', () => {
    expect(conditionRuntimePayloads('petrified')).toEqual(expect.arrayContaining([
      { kind: 'resistance', damage_type: 'all', value: 'resistance' },
      { kind: 'condition_immunity', condition: 'poisoned' },
    ]));
    expect(expandConditionSet(['petrified']).has('incapacitated')).toBe(true);
    expect(conditionWorldFacts('petrified')).toMatchObject({
      transformed_to_inanimate_substance: true,
      weight_multiplier: 10,
      aging_paused: true,
    });
    expect(conditionWorldFacts('paralyzed')).not.toHaveProperty('weight_multiplier');
  });

  it('Unconscious has exact composition and never masquerades as Paralyzed', () => {
    const expanded = expandConditionSet(['unconscious']);
    expect(expanded.has('incapacitated')).toBe(true);
    expect(expanded.has('prone')).toBe(true);
    expect(expanded.has('paralyzed')).toBe(false);
    expect(activeConditionWorldFactEnabled(state('unconscious'), 'unaware_of_surroundings')).toBe(true);
    expect(activeConditionWorldFactEnabled(state('unconscious'), 'drops_held_items')).toBe(true);
    expect(activeConditionWorldFactEnabled(state('prone'), 'drops_held_items')).toBe(false);
  });

  it('world-fact primitives are inherited through condition composition without id branches', () => {
    expect(activeConditionWorldFactEnabled(state('blinded'), 'cannot_see')).toBe(true);
    expect(activeConditionWorldFactEnabled(state('unconscious'), 'cannot_see')).toBe(false);
    expect(conditionWorldFacts('prone')).toMatchObject({
      movement_options: ['crawl', 'stand', 'magic'],
      stand_cost: 'half_speed',
    });
  });
});

describe('source-aware condition rules use explicit facts', () => {
  it('Frightened applies Disadvantage only while its exact source is in line of sight', () => {
    const frightened = state({ value: 'frightened', sourceId: 'source' });
    const collect = (lineOfSight: boolean) => collectModifiers(frightened, [], {
      roll: 'attack',
      evalCtx: {
        rollerActorId: 'subject', rollTargetActorId: 'source',
        conditionSourceFacts: { source: { lineOfSight } },
      },
    }).advantage;
    expect(collect(true)).toBe('disadvantage');
    expect(collect(false)).toBe('none');
    expect(collectModifiers(frightened, [], { roll: 'attack' }).advantage).toBe('none');
  });

  it('Frightened approach restriction uses the same generic deny primitive', () => {
    const frightened = state({ value: 'frightened', sourceId: 'source' });
    expect(conditionCapabilityDenied(frightened, 'movement_toward_condition_source', {
      rollerActorId: 'subject', rollTargetActorId: 'source',
      // The approach clause does not depend on sight (only the D20 penalty does).
      conditionSourceFacts: { source: { lineOfSight: false } },
    })).toBe(true);
  });

  it('Grappled attack penalty excludes the exact grappler and no one else', () => {
    const grappled = state({ value: 'grappled', sourceId: 'grappler' });
    const advantageAgainst = (rollTargetActorId: string) => collectModifiers(grappled, [], {
      roll: 'attack', evalCtx: { rollerActorId: 'subject', rollTargetActorId },
    }).advantage;
    expect(advantageAgainst('grappler')).toBe('none');
    expect(advantageAgainst('other')).toBe('disadvantage');
  });

  it('Charmed denies harm to its exact source and projects social Advantage only to it', () => {
    const charmed = state({ value: 'charmed', sourceId: 'charmer' });
    expect(conditionCapabilityDenied(charmed, 'harm', {
      rollerActorId: 'subject', rollTargetActorId: 'charmer',
    })).toBe(true);
    expect(conditionCapabilityDenied(charmed, 'harm', {
      rollerActorId: 'subject', rollTargetActorId: 'other',
    })).toBe(false);

    const target = { id: 'subject', runtimeState: charmed };
    expect(projectedAgainst(target, 'ability_check', undefined, {
      rollerActorId: 'charmer', rollTargetActorId: 'subject',
    }, { interaction: 'social' }).advantage).toBe('advantage');
    expect(projectedAgainst(target, 'ability_check', undefined, {
      rollerActorId: 'other', rollTargetActorId: 'subject',
    }, { interaction: 'social' }).advantage).toBe('none');
  });

  it('Invisible attack benefits are suppressed for the exact observer that can see the owner', () => {
    const invisible = state('invisible');
    const ownAttack = (canSee: boolean) => collectModifiers(invisible, [], {
      roll: 'attack',
      evalCtx: {
        rollerActorId: 'subject', rollTargetActorId: 'observer',
        visibility: { observer: { subject: canSee } },
      },
    }).advantage;
    expect(ownAttack(false)).toBe('advantage');
    expect(ownAttack(true)).toBe('none');
    expect(collectModifiers(invisible, [], { roll: 'attack' }).advantage).toBe('none');

    const target = { id: 'subject', runtimeState: invisible };
    const incoming = (canSee: boolean) => projectedAgainst(target, 'attack', undefined, {
      rollerActorId: 'observer', rollTargetActorId: 'subject',
      visibility: { observer: { subject: canSee } },
    }).advantage;
    expect(incoming(false)).toBe('disadvantage');
    expect(incoming(true)).toBe('none');
  });

  it('Incapacitated denies speech through the same declared capability primitive', () => {
    expect(conditionCapabilityDenied(state('incapacitated'), 'speech', {
      rollerActorId: 'subject',
    })).toBe(true);
  });

  it('Blinded/Deafened auto-fail only explicitly sight/hearing dependent checks', () => {
    expect(collectModifiers(state('blinded'), [], {
      roll: 'ability_check', filter: { sense: 'sight' },
    }).autoFail).toBe(true);
    expect(collectModifiers(state('blinded'), [], {
      roll: 'ability_check', filter: { sense: 'hearing' },
    }).autoFail).toBe(false);
    expect(collectModifiers(state('deafened'), [], {
      roll: 'ability_check', filter: { sense: 'hearing' },
    }).autoFail).toBe(true);
  });
});
