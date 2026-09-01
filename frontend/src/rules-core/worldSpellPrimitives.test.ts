import { describe, expect, it } from 'vitest';
import {
  createDancingLights as createDancingLightsPrimitive,
  endSourceActorTurnWorldObjects,
  mendWorldObject as mendWorldObjectPrimitive,
  moveDancingLights as moveDancingLightsPrimitive,
  observeDetectPoisonAndDisease as observeDetectPoisonAndDiseasePrimitive,
  purifyFoodAndDrink as purifyFoodAndDrinkPrimitive,
  resolveDruidcraft as resolveDruidcraftPrimitive,
  resolvePrestidigitation as resolvePrestidigitationPrimitive,
} from './worldSpellPrimitives';
import {
  advanceWorldObjectRounds,
  foldWorldObjectEvents,
  type MagicBlockingLayer,
  type WorldObjectFacts,
  type WorldObjectMutationResult,
  type WorldObjectState,
} from './worldObjects';
import type {
  DancingLightsWorldPolicy,
  DetectPoisonDiseaseWorldPolicy,
  DruidcraftWorldPolicy,
  MendingWorldPolicy,
  ParsedMechanicsTargeting,
  PrestidigitationWorldPolicy,
  PurifyFoodDrinkWorldPolicy,
} from './worldSpellPolicies';

const DANCING_POLICY: DancingLightsWorldPolicy = {
  minIndividualLights: 1, maxIndividualLights: 4, combinedFormObjectCount: 1,
  requiredSeparationFt: 20, maxMoveFt: 60,
  dimRadiusFt: 10, durationRounds: 10,
};
const DANCING_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'multiple', rangeFt: 120,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
};
const DRUIDCRAFT_POLICY: DruidcraftWorldPolicy = {
  sensoryCubeSideFt: 5, weatherDurationRounds: 1,
};
const DRUIDCRAFT_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'single', rangeFt: 30,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
};
const MENDING_POLICY: MendingWorldPolicy = { maxBreakDimensionFt: 1 };
const MENDING_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'single', rangeFt: 0,
  requiresLineOfSight: false, requiresTouch: true, allowedRelations: [],
};
const BLOCKERS: DetectPoisonDiseaseWorldPolicy['blockers'] = {
  stone: { thresholdInches: 12, comparison: 'gte' },
  common_metal: { thresholdInches: 1, comparison: 'gte' },
  lead: { thresholdInches: 0, comparison: 'gt' },
  wood: { thresholdInches: 12, comparison: 'gte' },
  dirt: { thresholdInches: 12, comparison: 'gte' },
  other: null,
};
const DETECT_POISON_POLICY: DetectPoisonDiseaseWorldPolicy = { blockers: BLOCKERS };
const DETECT_POISON_TARGETING: ParsedMechanicsTargeting = {
  domain: 'actor', actorTargets: false, shape: 'self', rangeFt: 0,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
  area: { kind: 'emanation', radiusFt: 30 },
};
const PURIFY_POLICY: PurifyFoodDrinkWorldPolicy = { requireInArea: true, excludeMagical: true };
const PURIFY_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'area', rangeFt: 10,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
  area: { kind: 'sphere', radiusFt: 5 },
};
const PRESTIDIGITATION_POLICY: PrestidigitationWorldPolicy = {
  maxVolumeCubicFt: 1, maxActiveEffects: 3,
  attachmentDurationRounds: 600, creationSourceTurnEndings: 2,
};
const PRESTIDIGITATION_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'single', rangeFt: 10,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
};

const createDancingLights = (
  input: Omit<Parameters<typeof createDancingLightsPrimitive>[0], 'policy' | 'targeting'>,
) => createDancingLightsPrimitive({ ...input, policy: DANCING_POLICY, targeting: DANCING_TARGETING });
const moveDancingLights = (
  input: Omit<Parameters<typeof moveDancingLightsPrimitive>[0], 'policy' | 'targeting'>,
) => moveDancingLightsPrimitive({
  ...input, policy: DANCING_POLICY, targeting: DANCING_TARGETING,
});
const resolveDruidcraft = (
  input: Omit<Parameters<typeof resolveDruidcraftPrimitive>[0], 'policy' | 'targeting'>,
) => resolveDruidcraftPrimitive({ ...input, policy: DRUIDCRAFT_POLICY, targeting: DRUIDCRAFT_TARGETING });
const mendWorldObject = (
  input: Omit<Parameters<typeof mendWorldObjectPrimitive>[0], 'policy' | 'targeting'>,
) => mendWorldObjectPrimitive({ ...input, policy: MENDING_POLICY, targeting: MENDING_TARGETING });
const observeDetectPoisonAndDisease = (
  input: Omit<Parameters<typeof observeDetectPoisonAndDiseasePrimitive>[0], 'policy' | 'targeting'>,
) => observeDetectPoisonAndDiseasePrimitive({
  ...input, policy: DETECT_POISON_POLICY, targeting: DETECT_POISON_TARGETING,
});
const purifyFoodAndDrink = (
  input: Omit<Parameters<typeof purifyFoodAndDrinkPrimitive>[0], 'policy' | 'targeting'>,
) => purifyFoodAndDrinkPrimitive({ ...input, policy: PURIFY_POLICY, targeting: PURIFY_TARGETING });
const resolvePrestidigitation = (
  input: Omit<Parameters<typeof resolvePrestidigitationPrimitive>[0], 'policy' | 'targeting'>,
) => resolvePrestidigitationPrimitive({
  ...input, policy: PRESTIDIGITATION_POLICY, targeting: PRESTIDIGITATION_TARGETING,
});

const facts = (overrides: Partial<WorldObjectFacts> = {}): WorldObjectFacts => ({
  factsSource: 'scenario',
  boardRevision: 11,
  distanceFt: 0,
  lineOfSight: true,
  ...overrides,
});

function object(id: string, overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return { id, name: id, kind: 'environment', size: 'medium', ...overrides };
}

function replay(
  initial: Readonly<Record<string, WorldObjectState>>,
  result: WorldObjectMutationResult,
): Record<string, WorldObjectState> {
  const persisted = JSON.parse(JSON.stringify(result.events));
  return foldWorldObjectEvents(initial, persisted);
}

describe('data-owned extended world-spell policy mutations', () => {
  it('changes every bounded primitive from policy/targeting values without spell identity dispatch', () => {
    const dancingPolicy: DancingLightsWorldPolicy = {
      ...DANCING_POLICY,
      maxIndividualLights: 2,
      combinedFormObjectCount: 1,
      requiredSeparationFt: 8,
      maxMoveFt: 7,
      dimRadiusFt: 3,
      durationRounds: 4,
    };
    const dancingTargeting: ParsedMechanicsTargeting = {
      ...DANCING_TARGETING, rangeFt: 9,
    };
    const lights = createDancingLightsPrimitive({
      objects: {}, groupId: 'mutated-group', sourceActorId: 'wizard',
      sourceActionId: 'arbitrary-source-id', form: 'individual',
      placements: [
        { id: 'mutated-a', distanceFromCasterFt: 1, withinRequiredSeparation: true },
        { id: 'mutated-b', distanceFromCasterFt: 9, withinRequiredSeparation: true },
      ],
      policy: dancingPolicy, targeting: dancingTargeting,
    });
    expect(lights.objects['mutated-a']).toMatchObject({
      roundsLeft: 4,
      dancingLight: { dimRadiusFt: 3 },
      tags: ['dancing_lights', 'dim_light_3_ft'],
    });
    expect(() => moveDancingLightsPrimitive({
      objects: lights.objects, sourceActorId: 'wizard', groupId: 'mutated-group',
      resultingFacts: [
        { lightId: 'mutated-a', movementFt: 7.1, distanceFromCasterFt: 1, withinRequiredSeparation: true },
        { lightId: 'mutated-b', movementFt: 0, distanceFromCasterFt: 9, withinRequiredSeparation: true },
      ],
      policy: dancingPolicy, targeting: dancingTargeting,
    })).toThrow(/between 0 and 7/);

    const druidPolicy: DruidcraftWorldPolicy = {
      sensoryCubeSideFt: 2, weatherDurationRounds: 3,
    };
    const weather = resolveDruidcraftPrimitive({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'not-a-spell-name',
      option: {
        kind: 'weather_sensor', id: 'mutated-weather', prediction: 'rain', facts: facts(),
      },
      policy: druidPolicy, targeting: DRUIDCRAFT_TARGETING,
    });
    expect(weather.objects['mutated-weather'].roundsLeft).toBe(3);
    expect(() => resolveDruidcraftPrimitive({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'not-a-spell-name',
      option: {
        kind: 'sensory_effect', id: 'too-large', description: 'wind',
        cubeSideFt: 2.1, facts: facts(),
      },
      policy: druidPolicy, targeting: DRUIDCRAFT_TARGETING,
    })).toThrow(/between 0 and 2/);

    expect(() => mendWorldObjectPrimitive({
      objects: { rope: object('rope', { breakOrTear: { maxDimensionFt: 0.5, repaired: false } }) },
      objectId: 'rope', facts: facts({ touched: true }),
      policy: { maxBreakDimensionFt: 0.25 }, targeting: MENDING_TARGETING,
    })).toThrow(/larger than 0.25/);

    const poison = observeDetectPoisonAndDiseasePrimitive({
      object: object('venom', {
        hazardousSubstance: { kind: 'poison', specificKind: 'wyvern venom' },
      }),
      facts: facts({ distanceFt: 4 }), blockingLayers: [],
      policy: DETECT_POISON_POLICY,
      targeting: {
        ...DETECT_POISON_TARGETING,
        area: { kind: 'emanation', radiusFt: 3 },
      },
    });
    expect(poison).toEqual({ sensed: false, locationKnown: false });

    const purified = purifyFoodAndDrinkPrimitive({
      objects: {
        wine: object('wine', {
          foodOrDrink: {
            kind: 'drink', magical: true, poisoned: true, rotten: true,
          },
        }),
      },
      sphereCenterDistanceFt: 10,
      factsByObject: { wine: facts({ inArea: false }) },
      policy: { requireInArea: false, excludeMagical: false },
      targeting: PURIFY_TARGETING,
    });
    expect(purified.objects.wine.foodOrDrink).toMatchObject({
      magical: true, poisoned: false, rotten: false,
    });

    const prestPolicy: PrestidigitationWorldPolicy = {
      maxVolumeCubicFt: 0.25,
      maxActiveEffects: 1,
      attachmentDurationRounds: 2,
      creationSourceTurnEndings: 1,
    };
    const marked = resolvePrestidigitationPrimitive({
      objects: { coin: object('coin') }, sourceActorId: 'wizard', sourceActionId: 'anything',
      option: {
        kind: 'magic_mark', objectId: 'coin', id: 'mark', description: 'sigil', facts: facts(),
      },
      policy: prestPolicy, targeting: PRESTIDIGITATION_TARGETING,
    });
    expect(marked.objects.coin.prestidigitation?.[0].roundsLeft).toBe(2);
    expect(() => resolvePrestidigitationPrimitive({
      objects: marked.objects, sourceActorId: 'wizard', sourceActionId: 'anything',
      option: {
        kind: 'minor_creation', id: 'creation', description: 'token', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
      policy: prestPolicy, targeting: PRESTIDIGITATION_TARGETING,
    })).toThrow(/at most 1/);
    expect(() => resolvePrestidigitationPrimitive({
      objects: { cloth: object('cloth') }, sourceActorId: 'wizard', sourceActionId: 'anything',
      option: {
        kind: 'clean_or_soil', objectId: 'cloth', operation: 'clean',
        facts: facts({ volumeCubicFt: 0.3 }),
      },
      policy: prestPolicy, targeting: PRESTIDIGITATION_TARGETING,
    })).toThrow(/at most 0.25/);
  });
});

describe('Dancing Lights world primitive', () => {
  it('creates every legal individual-light count with linked dim lights and replayable duration', () => {
    for (const count of [1, 2, 3, 4]) {
      const placements = Array.from({ length: count }, (_, index) => ({
        id: `light-${count}-${index}`,
        distanceFromCasterFt: index === count - 1 ? 120 : index * 20,
        ...(count > 1 ? { withinRequiredSeparation: true } : {}),
      }));
      const created = createDancingLights({
        objects: {},
        groupId: `group-${count}`,
        sourceActorId: 'wizard',
        sourceActionId: 'spell.dancing-lights',
        form: 'individual',
        placements,
      });

      expect(Object.keys(created.objects)).toHaveLength(count);
      expect(created.events).toHaveLength(count);
      for (const [index, placement] of placements.entries()) {
        expect(created.objects[placement.id]).toEqual({
          id: placement.id,
          name: `Dancing Light ${index + 1}`,
          kind: 'spell_effect',
          size: 'tiny',
          sourceActorId: 'wizard',
          sourceActionId: 'spell.dancing-lights',
          distanceFromSourceFt: placement.distanceFromCasterFt,
          roundsLeft: 10,
          magicalAura: { school: 'illusion', createdBySpell: true, visible: true },
          dancingLight: { groupId: `group-${count}`, form: 'individual', dimRadiusFt: 10 },
          tags: ['dancing_lights', 'dim_light_10_ft'],
        });
      }
      expect(replay({}, created)).toEqual(created.objects);

      const afterNine = advanceWorldObjectRounds({ objects: created.objects, rounds: 9 });
      expect(Object.values(afterNine.objects).every((light) => light.roundsLeft === 1)).toBe(true);
      expect(replay(created.objects, afterNine)).toEqual(afterNine.objects);
      const expired = advanceWorldObjectRounds({ objects: afterNine.objects, rounds: 1 });
      expect(expired.objects).toEqual({});
      expect(expired.events).toHaveLength(count);
      expect(replay(afterNine.objects, expired)).toEqual({});
    }
  });

  it('creates the single combined Medium humanoid form and rejects illegal casts', () => {
    const combined = createDancingLights({
      objects: {},
      groupId: 'humanoid-group',
      sourceActorId: 'wizard',
      sourceActionId: 'spell.dancing-lights',
      form: 'medium_humanoid',
      placements: [{ id: 'humanoid-light', distanceFromCasterFt: 120 }],
    });
    expect(combined.objects['humanoid-light']).toMatchObject({
      name: 'Dancing Lights form',
      size: 'medium',
      dancingLight: { groupId: 'humanoid-group', form: 'medium_humanoid', dimRadiusFt: 10 },
    });

    for (const placements of [
      [],
      Array.from({ length: 5 }, (_, index) => ({
        id: `excess-${index}`, distanceFromCasterFt: 0, withinRequiredSeparation: true,
      })),
    ]) {
      expect(() => createDancingLights({
        objects: {}, groupId: 'g', sourceActorId: 'wizard',
        sourceActionId: 'spell.dancing-lights', form: 'individual', placements,
      })).toThrow(/individual lights/);
    }
    expect(() => createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard',
      sourceActionId: 'spell.dancing-lights', form: 'medium_humanoid',
      placements: [
        { id: 'one', distanceFromCasterFt: 0 },
        { id: 'two', distanceFromCasterFt: 0 },
      ],
    })).toThrow(/exactly one/);

    for (const [label, input] of [
      ['group', { groupId: '   ', sourceActorId: 'wizard', sourceActionId: 'spell' }],
      ['actor', { groupId: 'g', sourceActorId: '', sourceActionId: 'spell' }],
      ['action', { groupId: 'g', sourceActorId: 'wizard', sourceActionId: '\t' }],
    ] as const) {
      expect(() => createDancingLights({
        objects: {}, ...input, form: 'individual',
        placements: [{ id: 'light', distanceFromCasterFt: 0 }],
      }), label).toThrow(/stable non-empty id/);
    }
    expect(() => createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'individual', placements: [{ id: ' ', distanceFromCasterFt: 0 }],
    })).toThrow(/stable non-empty id/);
    expect(() => createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'individual', placements: [
        { id: 'same', distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { id: 'same', distanceFromCasterFt: 0, withinRequiredSeparation: true },
      ],
    })).toThrow(/distinct/);
    for (const distanceFromCasterFt of [-0.01, 120.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => createDancingLights({
        objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
        form: 'individual', placements: [{ id: 'light', distanceFromCasterFt }],
      })).toThrow(/between 0 and 120/);
    }
    expect(() => createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'individual', placements: [
        { id: 'one', distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { id: 'two', distanceFromCasterFt: 20 },
      ],
    })).toThrow(/within 20 feet/);
    expect(() => createDancingLights({
      objects: { occupied: object('occupied') }, groupId: 'g', sourceActorId: 'wizard',
      sourceActionId: 'spell', form: 'individual',
      placements: [{ id: 'occupied', distanceFromCasterFt: 0 }],
    })).toThrow(/already exists/);
  });

  it('replaces only the same caster/action lights in deterministic order', () => {
    const oldOwnB = object('old-b', {
      kind: 'spell_effect', sourceActorId: 'wizard', sourceActionId: 'spell.dancing-lights',
      dancingLight: { groupId: 'old-group', form: 'individual', dimRadiusFt: 10 },
    });
    const oldOwnA = { ...oldOwnB, id: 'old-a', name: 'old-a' };
    const otherCaster = {
      ...oldOwnB, id: 'other-caster', name: 'other-caster', sourceActorId: 'bard',
    };
    const otherAction = {
      ...oldOwnB, id: 'other-action', name: 'other-action', sourceActionId: 'other-spell',
    };
    const mundane = object('mundane');
    const initial = { 'old-b': oldOwnB, mundane, 'old-a': oldOwnA, otherCaster, otherAction };
    const replaced = createDancingLights({
      objects: initial,
      groupId: 'new-group',
      sourceActorId: 'wizard',
      sourceActionId: 'spell.dancing-lights',
      form: 'individual',
      placements: [{ id: 'old-a', distanceFromCasterFt: 5 }],
    });
    expect(replaced.events.map((event) => (
      event.type === 'WorldObjectCreated' ? `create:${event.object.id}` : `${event.type}:${event.objectId}`
    ))).toEqual([
      'WorldObjectRemoved:old-a',
      'WorldObjectRemoved:old-b',
      'create:old-a',
    ]);
    expect(replaced.objects).toHaveProperty('old-a');
    expect(replaced.objects).not.toHaveProperty('old-b');
    expect(replaced.objects).toHaveProperty('otherCaster');
    expect(replaced.objects).toHaveProperty('otherAction');
    expect(replaced.objects).toHaveProperty('mundane');
    expect(replay(initial, replaced)).toEqual(replaced.objects);
  });

  it('moves every light once, caps movement, removes out-of-range lights, and preserves linking', () => {
    const created = createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'individual',
      placements: [
        { id: 'a', distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { id: 'b', distanceFromCasterFt: 20, withinRequiredSeparation: true },
        { id: 'c', distanceFromCasterFt: 40, withinRequiredSeparation: true },
      ],
    });
    const moved = moveDancingLights({
      objects: created.objects,
      sourceActorId: 'wizard',
      groupId: 'g',
      resultingFacts: [
        { lightId: 'c', movementFt: 60, distanceFromCasterFt: 121 },
        { lightId: 'a', movementFt: 0, distanceFromCasterFt: 120, withinRequiredSeparation: true },
        { lightId: 'b', movementFt: 60, distanceFromCasterFt: 100, withinRequiredSeparation: true },
      ],
    });
    expect(moved.objects.a.distanceFromSourceFt).toBe(120);
    expect(moved.objects.b.distanceFromSourceFt).toBe(100);
    expect(moved.objects).not.toHaveProperty('c');
    expect(moved.events).toEqual([
      { type: 'WorldObjectPatched', objectId: 'a', patch: { distanceFromSourceFt: 120 }, reason: 'dancing_lights_bonus_action_move' },
      { type: 'WorldObjectPatched', objectId: 'b', patch: { distanceFromSourceFt: 100 }, reason: 'dancing_lights_bonus_action_move' },
      { type: 'WorldObjectRemoved', objectId: 'c', reason: 'dancing_light_left_spell_range' },
    ]);
    expect(replay(created.objects, moved)).toEqual(moved.objects);

    const soleSurvivor = moveDancingLights({
      objects: created.objects, sourceActorId: 'wizard', groupId: 'g',
      resultingFacts: [
        { lightId: 'a', movementFt: 1, distanceFromCasterFt: 1 },
        { lightId: 'b', movementFt: 1, distanceFromCasterFt: 121 },
        { lightId: 'c', movementFt: 1, distanceFromCasterFt: 121 },
      ],
    });
    expect(Object.keys(soleSurvivor.objects)).toEqual(['a']);

    const combined = createDancingLights({
      objects: {}, groupId: 'combined', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'medium_humanoid', placements: [{ id: 'combined-light', distanceFromCasterFt: 0 }],
    });
    expect(moveDancingLights({
      objects: combined.objects, sourceActorId: 'wizard', groupId: 'combined',
      resultingFacts: [{ lightId: 'combined-light', movementFt: 60, distanceFromCasterFt: 120 }],
    }).objects['combined-light'].distanceFromSourceFt).toBe(120);
  });

  it('fails closed on incomplete, duplicate, unlinked, or numerically invalid movement facts', () => {
    const created = createDancingLights({
      objects: {}, groupId: 'g', sourceActorId: 'wizard', sourceActionId: 'spell',
      form: 'individual', placements: [
        { id: 'a', distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { id: 'b', distanceFromCasterFt: 20, withinRequiredSeparation: true },
      ],
    });
    expect(() => moveDancingLights({
      objects: {}, sourceActorId: 'wizard', groupId: 'missing', resultingFacts: [],
    })).toThrow(/Unknown Dancing Lights group/);
    for (const resultingFacts of [
      [{ lightId: 'a', movementFt: 0, distanceFromCasterFt: 0, withinRequiredSeparation: true }],
      [
        { lightId: 'a', movementFt: 0, distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { lightId: 'a', movementFt: 0, distanceFromCasterFt: 0, withinRequiredSeparation: true },
      ],
      [
        { lightId: 'a', movementFt: 0, distanceFromCasterFt: 0, withinRequiredSeparation: true },
        { lightId: 'unknown', movementFt: 0, distanceFromCasterFt: 0, withinRequiredSeparation: true },
      ],
    ]) {
      expect(() => moveDancingLights({
        objects: created.objects, sourceActorId: 'wizard', groupId: 'g', resultingFacts,
      })).toThrow(/one distinct post-move fact per light/);
    }
    for (const movementFt of [-1, 60.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => moveDancingLights({
        objects: created.objects, sourceActorId: 'wizard', groupId: 'g',
        resultingFacts: [
          { lightId: 'a', movementFt, distanceFromCasterFt: 0, withinRequiredSeparation: true },
          { lightId: 'b', movementFt: 0, distanceFromCasterFt: 20, withinRequiredSeparation: true },
        ],
      })).toThrow(/between 0 and 60/);
    }
    for (const distanceFromCasterFt of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => moveDancingLights({
        objects: created.objects, sourceActorId: 'wizard', groupId: 'g',
        resultingFacts: [
          { lightId: 'a', movementFt: 0, distanceFromCasterFt, withinRequiredSeparation: true },
          { lightId: 'b', movementFt: 0, distanceFromCasterFt: 20, withinRequiredSeparation: true },
        ],
      })).toThrow(/caster distance must be non-negative/);
    }
    expect(() => moveDancingLights({
      objects: created.objects, sourceActorId: 'wizard', groupId: 'g',
      resultingFacts: [
        { lightId: 'a', movementFt: 0, distanceFromCasterFt: 0 },
        { lightId: 'b', movementFt: 0, distanceFromCasterFt: 20, withinRequiredSeparation: true },
      ],
    })).toThrow(/must remain within 20 feet/);
  });
});

describe('Druidcraft world primitive', () => {
  it('resolves and replays Weather Sensor for exactly one round at the range boundary', () => {
    const result = resolveDruidcraft({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
      option: {
        kind: 'weather_sensor', id: 'weather', prediction: '  rain  ',
        facts: facts({ distanceFt: 30 }),
      },
    });
    expect(result.objects.weather).toEqual({
      id: 'weather',
      name: 'Прогноз погоды: rain',
      kind: 'spell_effect',
      size: 'tiny',
      sourceActorId: 'druid',
      sourceActionId: 'spell.druidcraft',
      roundsLeft: 1,
      magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
      tags: ['druidcraft', 'weather_sensor', 'prediction:rain'],
    });
    expect(replay({}, result)).toEqual(result.objects);
    const expired = advanceWorldObjectRounds({ objects: result.objects, rounds: 1 });
    expect(expired.objects).toEqual({});
    expect(replay(result.objects, expired)).toEqual({});
    expect(() => resolveDruidcraft({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
      option: { kind: 'weather_sensor', id: 'weather', prediction: ' ', facts: facts() },
    })).toThrow(/requires a prediction/);
    expect(() => resolveDruidcraft({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
      option: { kind: 'weather_sensor', id: '', prediction: 'clear', facts: facts() },
    })).toThrow(/stable non-empty id/);
    expect(() => resolveDruidcraft({
      objects: { weather: object('weather') }, sourceActorId: 'druid', sourceActionId: 'spell',
      option: { kind: 'weather_sensor', id: 'weather', prediction: 'clear', facts: facts() },
    })).toThrow(/already exists/);
  });

  it.each(['flower', 'seed_pod', 'leaf_bud'] as const)('blooms a %s and preserves its other state', (kind) => {
    const initial = {
      plant: object('plant', {
        plant: { kind, bloomed: false },
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: false },
      }),
    };
    const result = resolveDruidcraft({
      objects: initial, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
      option: { kind: 'bloom', objectId: 'plant', facts: facts({ distanceFt: 30 }) },
    });
    expect(result.objects.plant.plant).toEqual({ kind, bloomed: true });
    expect(result.objects.plant.magicalAura).toEqual(initial.plant.magicalAura);
    expect(result.events).toEqual([{
      type: 'WorldObjectPatched', objectId: 'plant',
      patch: { plant: { kind, bloomed: true } }, reason: 'druidcraft_bloom',
    }]);
    expect(replay(initial, result)).toEqual(result.objects);
  });

  it('creates an instantaneous bounded sensory effect and leaves no persistent object', () => {
    for (const cubeSideFt of [0, 5]) {
      const result = resolveDruidcraft({
        objects: {}, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
        option: {
          kind: 'sensory_effect', id: `leaves-${cubeSideFt}`, description: '  falling leaves  ',
          cubeSideFt, facts: facts({ distanceFt: 30 }),
        },
      });
      expect(result.objects).toEqual({});
      expect(result.events).toEqual([
        expect.objectContaining({
          type: 'WorldObjectCreated',
          object: expect.objectContaining({
            id: `leaves-${cubeSideFt}`, name: 'falling leaves',
            kind: 'spell_effect', size: 'medium', sourceActorId: 'druid',
            tags: ['druidcraft', 'instantaneous_sensory_effect'],
          }),
        }),
        { type: 'WorldObjectRemoved', objectId: `leaves-${cubeSideFt}`, reason: 'instantaneous_effect_completed' },
      ]);
      expect(replay({}, result)).toEqual({});
    }
    for (const cubeSideFt of [-0.01, 5.01, Number.NaN]) {
      expect(() => resolveDruidcraft({
        objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
        option: {
          kind: 'sensory_effect', id: 'effect', description: 'leaves', cubeSideFt, facts: facts(),
        },
      })).toThrow(/between 0 and 5/);
    }
    expect(() => resolveDruidcraft({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
      option: {
        kind: 'sensory_effect', id: 'effect', description: ' ', cubeSideFt: 5, facts: facts(),
      },
    })).toThrow(/requires a description/);
  });

  it.each(['candle', 'torch', 'campfire'] as const)('lights and snuffs a %s', (kind) => {
    const initial = { flame: object('flame', { flame: { kind, lit: false } }) };
    const lit = resolveDruidcraft({
      objects: initial, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
      option: { kind: 'fire_play', objectId: 'flame', operation: 'light', facts: facts() },
    });
    expect(lit.objects.flame.flame).toEqual({ kind, lit: true });
    expect(replay(initial, lit)).toEqual(lit.objects);
    const snuffed = resolveDruidcraft({
      objects: lit.objects, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
      option: { kind: 'fire_play', objectId: 'flame', operation: 'snuff', facts: facts() },
    });
    expect(snuffed.objects.flame.flame).toEqual({ kind, lit: false });
    expect(replay(lit.objects, snuffed)).toEqual(snuffed.objects);
  });

  it('executes every legal Bloom and Fire Play target variant', () => {
    for (const kind of ['flower', 'seed_pod', 'leaf_bud'] as const) {
      const initial = { plant: object('plant', { plant: { kind, bloomed: false } }) };
      const result = resolveDruidcraft({
        objects: initial, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
        option: { kind: 'bloom', objectId: 'plant', facts: facts({ distanceFt: 30 }) },
      });
      expect(result.objects.plant.plant).toEqual({ kind, bloomed: true });
    }
    for (const kind of ['candle', 'torch', 'campfire'] as const) {
      const initial = { flame: object('flame', { flame: { kind, lit: false } }) };
      const lit = resolveDruidcraft({
        objects: initial, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
        option: { kind: 'fire_play', objectId: 'flame', operation: 'light', facts: facts() },
      });
      const snuffed = resolveDruidcraft({
        objects: lit.objects, sourceActorId: 'druid', sourceActionId: 'spell.druidcraft',
        option: { kind: 'fire_play', objectId: 'flame', operation: 'snuff', facts: facts() },
      });
      expect(lit.objects.flame.flame).toEqual({ kind, lit: true });
      expect(snuffed.objects.flame.flame).toEqual({ kind, lit: false });
    }
  });

  it('requires explicit valid facts in range and option-specific targets', () => {
    const invalidFacts = [
      facts({ distanceFt: 30.01 }),
      facts({ distanceFt: -1 }),
      facts({ distanceFt: Number.NaN }),
      facts({ boardRevision: -1 }),
      facts({ boardRevision: 1.5 }),
      { ...facts(), factsSource: 'guess' } as unknown as WorldObjectFacts,
      { ...facts(), lineOfSight: 'yes' } as unknown as WorldObjectFacts,
    ];
    for (const invalid of invalidFacts) {
      expect(() => resolveDruidcraft({
        objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
        option: { kind: 'weather_sensor', id: 'weather', prediction: 'rain', facts: invalid },
      })).toThrow(/explicit world facts|outside 30 feet/);
    }
    expect(() => resolveDruidcraft({
      objects: { stone: object('stone') }, sourceActorId: 'druid', sourceActionId: 'spell',
      option: { kind: 'bloom', objectId: 'stone', facts: facts() },
    })).toThrow(/requires a flower/);
    expect(() => resolveDruidcraft({
      objects: {}, sourceActorId: 'druid', sourceActionId: 'spell',
      option: { kind: 'fire_play', objectId: 'missing', operation: 'light', facts: facts() },
    })).toThrow(/requires a candle/);
  });
});

describe('Mending world primitive', () => {
  it('derives touch enforcement from declarative targeting', () => {
    const result = mendWorldObjectPrimitive({
      objects: {
        rope: object('rope', { breakOrTear: { maxDimensionFt: 1, repaired: false } }),
      },
      objectId: 'rope',
      facts: facts({ distanceFt: 5, touched: false }),
      policy: MENDING_POLICY,
      targeting: { ...MENDING_TARGETING, rangeFt: 5, requiresTouch: false },
    });
    expect(result.objects.rope.breakOrTear?.repaired).toBe(true);
  });

  it.each([0, 0.5, 1])('repairs a touched %.1f-foot break and preserves magical properties', (maxDimensionFt) => {
    const initial = {
      sword: object('sword', {
        kind: 'item',
        breakOrTear: { maxDimensionFt, repaired: false },
        magicalAura: { school: 'evocation', createdBySpell: false, visible: true },
        tags: ['magic_weapon', 'plus_one'],
      }),
    };
    const result = mendWorldObject({
      objects: initial, objectId: 'sword', facts: facts({ distanceFt: 0, touched: true }),
    });
    expect(result.objects.sword.breakOrTear).toEqual({ maxDimensionFt, repaired: true });
    expect(result.objects.sword.magicalAura).toEqual(initial.sword.magicalAura);
    expect(result.objects.sword.tags).toEqual(['magic_weapon', 'plus_one']);
    expect(result.events).toEqual([{
      type: 'WorldObjectPatched', objectId: 'sword',
      patch: { breakOrTear: { maxDimensionFt, repaired: true } },
      reason: 'mending_repaired_break_or_tear',
    }]);
    expect(replay(initial, result)).toEqual(result.objects);
    expect(initial.sword.breakOrTear?.repaired).toBe(false);
  });

  it('repairs every legal break-size boundary without restoring or stripping magic', () => {
    for (const maxDimensionFt of [0, 0.5, 1]) {
      const initial = {
        sword: object('sword', {
          kind: 'item',
          breakOrTear: { maxDimensionFt, repaired: false },
          magicalAura: { school: 'evocation', createdBySpell: false, visible: true },
          tags: ['magic_weapon', 'plus_one'],
        }),
      };
      const result = mendWorldObject({
        objects: initial, objectId: 'sword', facts: facts({ distanceFt: 0, touched: true }),
      });
      expect(result.objects.sword.breakOrTear).toEqual({ maxDimensionFt, repaired: true });
      expect(result.objects.sword.magicalAura).toEqual(initial.sword.magicalAura);
      expect(result.objects.sword.tags).toEqual(initial.sword.tags);
    }

    const magicLost = {
      wand: object('wand', {
        kind: 'item',
        breakOrTear: { maxDimensionFt: 1, repaired: false },
        tags: ['formerly_magic', 'magic_lost_when_broken'],
      }),
    };
    const repairedWand = mendWorldObject({
      objects: magicLost, objectId: 'wand', facts: facts({ distanceFt: 0, touched: true }),
    });
    expect(repairedWand.objects.wand.breakOrTear?.repaired).toBe(true);
    expect(repairedWand.objects.wand.magicalAura).toBeUndefined();
    expect(repairedWand.objects.wand.tags).toEqual(magicLost.wand.tags);
  });

  it('rejects absent, oversized, corrupt, or not-explicitly-touched breaks', () => {
    expect(() => mendWorldObject({
      objects: {}, objectId: 'missing', facts: facts({ touched: true }),
    })).toThrow(/requires one explicit break or tear/);
    expect(() => mendWorldObject({
      objects: { stone: object('stone') }, objectId: 'stone', facts: facts({ touched: true }),
    })).toThrow(/requires one explicit break or tear/);
    expect(() => mendWorldObject({
      objects: {
        repaired: object('repaired', {
          breakOrTear: { maxDimensionFt: 1, repaired: true },
        }),
      },
      objectId: 'repaired', facts: facts({ touched: true }),
    })).toThrow(/requires an unrepaired break or tear/);
    for (const maxDimensionFt of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => mendWorldObject({
        objects: { broken: object('broken', { breakOrTear: { maxDimensionFt, repaired: false } }) },
        objectId: 'broken', facts: facts({ touched: true }),
      })).toThrow(/larger than/);
    }
    for (const invalid of [
      facts({ touched: false }),
      facts({ touched: true, distanceFt: 0.01 }),
      facts({ touched: true, distanceFt: -1 }),
      facts({ touched: true, boardRevision: -1 }),
    ]) {
      expect(() => mendWorldObject({
        objects: { broken: object('broken', { breakOrTear: { maxDimensionFt: 1, repaired: false } }) },
        objectId: 'broken', facts: invalid,
      })).toThrow(/requires valid explicit world facts|requires a touched object|outside 0 feet/);
    }
  });
});

describe('Detect Poison and Disease world primitive', () => {
  it('requires the sensing radius to be declared by mechanics targeting', () => {
    expect(() => observeDetectPoisonAndDiseasePrimitive({
      object: object('hazard', {
        hazardousSubstance: { kind: 'poison', specificKind: 'arsenic' },
      }),
      facts: facts(),
      blockingLayers: [],
      policy: DETECT_POISON_POLICY,
      targeting: { ...DETECT_POISON_TARGETING, area: undefined },
    })).toThrow(/numeric sensing radius/);
  });

  it('reveals location and exact kind for every supported source at 30 feet', () => {
    for (const [kind, specificKind] of [
      ['poison', 'midnight tears'],
      ['poisonous_creature', 'giant poisonous snake'],
      ['venomous_creature', 'giant spider'],
      ['magical_contagion', 'cackle fever'],
    ] as const) {
      const observation = observeDetectPoisonAndDisease({
        object: object('hazard', { hazardousSubstance: { kind, specificKind } }),
        facts: facts({ distanceFt: 30, lineOfSight: false }),
        blockingLayers: [],
      });
      expect(observation).toEqual({ sensed: true, locationKnown: true, kind: specificKind });
    }
  });

  it('rejects out-of-range, blocked, malformed, and non-hazard observations', () => {
    const hazard = object('hazard', {
      hazardousSubstance: { kind: 'poison', specificKind: 'purple worm poison' },
    });
    for (const observedFacts of [
      facts({ distanceFt: 30.001 }),
      facts({ distanceFt: -1 }),
      facts({ distanceFt: Number.NaN }),
      facts({ boardRevision: -1 }),
      facts({ boardRevision: 1.5 }),
      { ...facts(), factsSource: 'inference' } as unknown as WorldObjectFacts,
      { ...facts(), lineOfSight: 1 } as unknown as WorldObjectFacts,
    ]) {
      expect(observeDetectPoisonAndDisease({
        object: hazard, facts: observedFacts, blockingLayers: [],
      })).toEqual({ sensed: false, locationKnown: false });
    }
    expect(observeDetectPoisonAndDisease({
      object: object('bread'), facts: facts(), blockingLayers: [],
    })).toEqual({ sensed: false, locationKnown: false });
  });

  it('is blocked by every exact material threshold', () => {
    for (const [material, thicknessInches] of [
      ['stone', 12],
      ['common_metal', 1],
      ['lead', Number.MIN_VALUE],
      ['wood', 12],
      ['dirt', 12],
    ] as const) {
      const layer: MagicBlockingLayer = { material, thicknessInches };
      expect(observeDetectPoisonAndDisease({
        object: object('hazard', {
          hazardousSubstance: { kind: 'poison', specificKind: 'arsenic' },
        }),
        facts: facts({ distanceFt: 0 }),
        blockingLayers: [layer],
      })).toEqual({ sensed: false, locationKnown: false });
    }
  });

  it('is not blocked below thresholds or by other material, but fails closed on corrupt thickness', () => {
    const hazard = object('hazard', {
      hazardousSubstance: { kind: 'poison', specificKind: 'arsenic' },
    });
    for (const layer of [
      { material: 'stone', thicknessInches: 11.999 },
      { material: 'common_metal', thicknessInches: 0.999 },
      { material: 'lead', thicknessInches: 0 },
      { material: 'wood', thicknessInches: 11.999 },
      { material: 'dirt', thicknessInches: 11.999 },
      { material: 'other', thicknessInches: 1_000 },
    ] satisfies MagicBlockingLayer[]) {
      expect(observeDetectPoisonAndDisease({
        object: hazard, facts: facts(), blockingLayers: [layer],
      })).toEqual({ sensed: true, locationKnown: true, kind: 'arsenic' });
    }
    for (const thicknessInches of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(observeDetectPoisonAndDisease({
        object: hazard, facts: facts(),
        blockingLayers: [{ material: 'other', thicknessInches }],
      })).toEqual({ sensed: false, locationKnown: false });
    }
  });
});

describe('Purify Food and Drink world primitive', () => {
  it('purifies only poisoned or rotten nonmagical food and drink explicitly in the sphere', () => {
    const initial = {
      apple: object('apple', {
        foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
      }),
      water: object('water', {
        foodOrDrink: { kind: 'drink', magical: false, poisoned: true, rotten: false },
      }),
      oldBread: object('oldBread', {
        foodOrDrink: { kind: 'food', magical: false, poisoned: false, rotten: true },
      }),
      cleanWine: object('cleanWine', {
        foodOrDrink: { kind: 'drink', magical: false, poisoned: false, rotten: false },
      }),
      potion: object('potion', {
        foodOrDrink: { kind: 'drink', magical: true, poisoned: true, rotten: true },
      }),
      outsideMeat: object('outsideMeat', {
        foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
      }),
      plate: object('plate'),
    };
    const result = purifyFoodAndDrink({
      objects: initial,
      sphereCenterDistanceFt: 10,
      factsByObject: {
        water: facts({ inArea: true }),
        potion: facts({ inArea: true }),
        plate: facts({ inArea: true }),
        outsideMeat: facts({ inArea: false }),
        oldBread: facts({ inArea: true }),
        cleanWine: facts({ inArea: true }),
        apple: facts({ inArea: true }),
      },
    });
    expect(result.objects.apple.foodOrDrink).toEqual({
      kind: 'food', magical: false, poisoned: false, rotten: false,
    });
    expect(result.objects.water.foodOrDrink).toEqual({
      kind: 'drink', magical: false, poisoned: false, rotten: false,
    });
    expect(result.objects.oldBread.foodOrDrink).toEqual({
      kind: 'food', magical: false, poisoned: false, rotten: false,
    });
    expect(result.objects.cleanWine).toEqual(initial.cleanWine);
    expect(result.objects.potion).toEqual(initial.potion);
    expect(result.objects.outsideMeat).toEqual(initial.outsideMeat);
    expect(result.objects.plate).toEqual(initial.plate);
    expect(result.events.map((event) => event.type === 'WorldObjectPatched' && event.objectId))
      .toEqual(['apple', 'oldBread', 'water']);
    expect(replay(initial, result)).toEqual(result.objects);
  });

  it('accepts both center-distance boundaries and rejects inferred area membership or corrupt input', () => {
    const initial = {
      meal: object('meal', {
        foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: false },
      }),
    };
    for (const sphereCenterDistanceFt of [0, 10]) {
      expect(purifyFoodAndDrink({
        objects: initial, sphereCenterDistanceFt,
        factsByObject: { meal: facts({ inArea: true }) },
      }).objects.meal.foodOrDrink?.poisoned).toBe(false);
    }
    for (const sphereCenterDistanceFt of [-0.01, 10.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => purifyFoodAndDrink({
        objects: initial, sphereCenterDistanceFt,
        factsByObject: { meal: facts({ inArea: true }) },
      })).toThrow(/between 0 and 10/);
    }
    expect(purifyFoodAndDrink({
      objects: initial, sphereCenterDistanceFt: 0,
      factsByObject: { meal: facts() },
    }).objects).toEqual(initial);
    expect(() => purifyFoodAndDrink({
      objects: initial, sphereCenterDistanceFt: 0,
      factsByObject: { missing: facts({ inArea: true }) },
    })).toThrow(/Unknown world object/);
    expect(() => purifyFoodAndDrink({
      objects: initial, sphereCenterDistanceFt: 0,
      factsByObject: { meal: facts({ distanceFt: Number.NaN, inArea: true }) },
    })).toThrow(/valid explicit world facts/);
  });
});

describe('Prestidigitation world primitive', () => {
  it('resolves the instantaneous Sensory Effect and Fire Play options with JSON replay', () => {
    const sensory = resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'sensory_effect', id: 'sparks', description: '  shower of sparks  ',
        facts: facts({ distanceFt: 10 }),
      },
    });
    expect(sensory.objects).toEqual({});
    expect(sensory.events).toEqual([
      expect.objectContaining({
        type: 'WorldObjectCreated',
        object: expect.objectContaining({
          id: 'sparks', name: 'shower of sparks', size: 'tiny',
          sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
          tags: ['prestidigitation', 'instantaneous_sensory_effect'],
        }),
      }),
      { type: 'WorldObjectRemoved', objectId: 'sparks', reason: 'instantaneous_effect_completed' },
    ]);
    expect(replay({}, sensory)).toEqual({});

    for (const flameKind of ['candle', 'torch', 'campfire'] as const) {
      const initial = { flame: object('flame', { flame: { kind: flameKind, lit: false } }) };
      const lit = resolvePrestidigitation({
        objects: initial, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        option: { kind: 'fire_play', objectId: 'flame', operation: 'light', facts: facts() },
      });
      expect(lit.objects.flame.flame).toEqual({ kind: flameKind, lit: true });
      expect(replay(initial, lit)).toEqual(lit.objects);
      const snuffed = resolvePrestidigitation({
        objects: lit.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        option: { kind: 'fire_play', objectId: 'flame', operation: 'snuff', facts: facts() },
      });
      expect(snuffed.objects.flame.flame).toEqual({ kind: flameKind, lit: false });
    }
  });

  it('cleans and soils an object at both one-cubic-foot boundaries', () => {
    for (const volumeCubicFt of [0, 1]) {
      const initial = { cloth: object('cloth', { soiled: false }) };
      const soiled = resolvePrestidigitation({
        objects: initial, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        option: {
          kind: 'clean_or_soil', objectId: 'cloth', operation: 'soil',
          facts: facts({ distanceFt: 10, volumeCubicFt }),
        },
      });
      expect(soiled.objects.cloth.soiled).toBe(true);
      expect(replay(initial, soiled)).toEqual(soiled.objects);
      const clean = resolvePrestidigitation({
        objects: soiled.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        option: {
          kind: 'clean_or_soil', objectId: 'cloth', operation: 'clean',
          facts: facts({ volumeCubicFt }),
        },
      });
      expect(clean.objects.cloth.soiled).toBe(false);
    }
  });

  it('attaches one-hour Minor Sensation and Magic Mark effects without overwriting foreign effects', () => {
    const foreign = {
      id: 'foreign', sourceActorId: 'bard', sourceActionId: 'spell.prestidigitation',
      kind: 'magic_mark' as const, description: 'B', roundsLeft: 42,
    };
    const initial = { stone: object('stone', { prestidigitation: [foreign] }) };
    const sensation = resolvePrestidigitation({
      objects: initial, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'minor_sensation', objectId: 'stone', id: 'warm', description: '  warm  ',
        facts: facts({ distanceFt: 10, volumeCubicFt: 1 }),
      },
    });
    expect(sensation.objects.stone.prestidigitation).toEqual([
      foreign,
      {
        id: 'warm', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        kind: 'minor_sensation', description: 'warm', roundsLeft: 600,
      },
    ]);
    expect(replay(initial, sensation)).toEqual(sensation.objects);
    const marked = resolvePrestidigitation({
      objects: sensation.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'stone', id: 'sigil', description: '  blue rune  ',
        facts: facts({ distanceFt: 10 }),
      },
    });
    expect(marked.objects.stone.prestidigitation?.at(-1)).toEqual({
      id: 'sigil', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      kind: 'magic_mark', description: 'blue rune', roundsLeft: 600,
    });
    expect(replay(sensation.objects, marked)).toEqual(marked.objects);
  });

  it('creates a bounded non-damaging, worthless Minor Creation until the source actor next ends a turn', () => {
    for (const size of ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const) {
      const result = resolvePrestidigitation({
        objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
        option: {
          kind: 'minor_creation', id: `creation-${size}`, description: '  illusory card  ',
          size, fitsInHand: true, facts: facts({ distanceFt: 10 }),
        },
      });
      expect(result.objects[`creation-${size}`]).toEqual({
        id: `creation-${size}`,
        name: 'illusory card',
        kind: 'spell_effect',
        size,
        sourceActorId: 'wizard',
        sourceActionId: 'spell.prestidigitation',
        sourceTurnEndingsLeft: 2,
        magicalAura: { school: 'transmutation', createdBySpell: true, visible: true },
        tags: [
          'prestidigitation', 'prestidigitation:minor_creation',
          'nonmagical_trinket_or_illusory_image', 'no_damage', 'no_monetary_worth',
        ],
      });
      expect(replay({}, result)).toEqual(result.objects);

      const otherTurn = endSourceActorTurnWorldObjects({
        objects: result.objects, sourceActorId: 'fighter',
      });
      expect(otherTurn.events).toEqual([]);
      expect(otherTurn.objects).toEqual(result.objects);
      const currentTurnEnd = endSourceActorTurnWorldObjects({
        objects: otherTurn.objects, sourceActorId: 'wizard',
      });
      expect(currentTurnEnd.objects[`creation-${size}`].sourceTurnEndingsLeft).toBe(1);
      expect(currentTurnEnd.events).toEqual([{
        type: 'WorldObjectPatched', objectId: `creation-${size}`,
        patch: { sourceTurnEndingsLeft: 1 }, reason: 'source_turn_end_advanced',
      }]);
      expect(replay(otherTurn.objects, currentTurnEnd)).toEqual(currentTurnEnd.objects);

      const nextTurnEnd = endSourceActorTurnWorldObjects({
        objects: currentTurnEnd.objects, sourceActorId: 'wizard',
      });
      expect(nextTurnEnd.objects).toEqual({});
      expect(nextTurnEnd.events).toEqual([{
        type: 'WorldObjectRemoved', objectId: `creation-${size}`, reason: 'source_turn_end_expired',
      }]);
      expect(replay(currentTurnEnd.objects, nextTurnEnd)).toEqual({});
    }
  });

  it('enforces three active source-owned effects and supports explicit attachment/creation replacement', () => {
    const base = { stone: object('stone'), shield: object('shield') };
    const first = resolvePrestidigitation({
      objects: base, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'minor_sensation', objectId: 'stone', id: 'first', description: 'warm',
        facts: facts({ volumeCubicFt: 1 }),
      },
    });
    const second = resolvePrestidigitation({
      objects: first.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'second', description: 'sigil', facts: facts(),
      },
    });
    const third = resolvePrestidigitation({
      objects: second.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'minor_creation', id: 'third', description: 'coin image', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
    });
    expect(() => resolvePrestidigitation({
      objects: third.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'fourth', description: 'another sigil',
        facts: facts(),
      },
    })).toThrow(/active non-instantaneous effects/);
    expect(() => resolvePrestidigitation({
      objects: third.objects,
      sourceActorId: 'wizard',
      sourceActionId: 'magic-initiate.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'cross-grant-fourth',
        description: 'same spell through another grant', facts: facts(),
      },
    })).toThrow(/at most (?:three|3)/);

    const replaceAttachment = resolvePrestidigitation({
      objects: third.objects, sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'fourth', description: 'new sigil',
        facts: facts(), replaceEffectId: 'first',
      },
    });
    expect(replaceAttachment.objects.stone.prestidigitation).toBeUndefined();
    expect(replaceAttachment.objects.shield.prestidigitation?.map((effect) => effect.id))
      .toEqual(['second', 'fourth']);
    expect(replaceAttachment.objects).toHaveProperty('third');
    expect(replaceAttachment.events[0]).toMatchObject({
      type: 'WorldObjectPatched', objectId: 'stone', unset: ['prestidigitation'],
      reason: 'prestidigitation_replaced',
    });
    expect(replay(third.objects, replaceAttachment)).toEqual(replaceAttachment.objects);

    const replaceAcrossGrant = resolvePrestidigitation({
      objects: third.objects,
      sourceActorId: 'wizard',
      sourceActionId: 'magic-initiate.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'cross-grant-replacement',
        description: 'cross grant replacement', facts: facts(), replaceEffectId: 'first',
      },
    });
    expect(replaceAcrossGrant.objects.stone.prestidigitation).toBeUndefined();
    expect(replaceAcrossGrant.objects.shield.prestidigitation?.at(-1)).toMatchObject({
      id: 'cross-grant-replacement',
      sourceActorId: 'wizard',
      sourceActionId: 'magic-initiate.prestidigitation',
    });

    const replaceCreation = resolvePrestidigitation({
      objects: replaceAttachment.objects,
      sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'minor_creation', id: 'fifth', description: 'paper bird', size: 'tiny',
        fitsInHand: true, facts: facts(), replaceEffectId: 'third',
      },
    });
    expect(replaceCreation.objects).not.toHaveProperty('third');
    expect(replaceCreation.objects).toHaveProperty('fifth');
    expect(replaceCreation.events[0]).toEqual({
      type: 'WorldObjectRemoved', objectId: 'third', reason: 'prestidigitation_replaced',
    });
    expect(replay(replaceAttachment.objects, replaceCreation)).toEqual(replaceCreation.objects);

    const sameObjectReplacement = resolvePrestidigitation({
      objects: replaceCreation.objects,
      sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      option: {
        kind: 'magic_mark', objectId: 'shield', id: 'sixth', description: 'final sigil',
        facts: facts(), replaceEffectId: 'second',
      },
    });
    expect(sameObjectReplacement.objects.shield.prestidigitation?.map((effect) => effect.id))
      .toEqual(['fourth', 'sixth']);
    expect(replay(replaceCreation.objects, sameObjectReplacement)).toEqual(sameObjectReplacement.objects);
  });

  it('advances one-hour attachments, removes expired ones, and replays mixed duration events', () => {
    const initial = {
      stone: object('stone', {
        prestidigitation: [
          {
            id: 'short', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
            kind: 'magic_mark', description: 'short', roundsLeft: 1,
          },
          {
            id: 'long', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
            kind: 'minor_sensation', description: 'long', roundsLeft: 600,
          },
        ],
      }),
      shield: object('shield', {
        prestidigitation: [{
          id: 'hour', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
          kind: 'magic_mark', description: 'hour', roundsLeft: 600,
        }],
      }),
    };
    const afterOne = advanceWorldObjectRounds({ objects: initial, rounds: 1 });
    expect(afterOne.objects.stone.prestidigitation).toEqual([{
      id: 'long', sourceActorId: 'wizard', sourceActionId: 'spell.prestidigitation',
      kind: 'minor_sensation', description: 'long', roundsLeft: 599,
    }]);
    expect(afterOne.objects.shield.prestidigitation?.[0].roundsLeft).toBe(599);
    expect(afterOne.events.map((event) => event.type === 'WorldObjectPatched' && event.reason))
      .toEqual(['prestidigitation_duration_advanced', 'prestidigitation_duration_expired']);
    expect(replay(initial, afterOne)).toEqual(afterOne.objects);

    const expired = advanceWorldObjectRounds({ objects: afterOne.objects, rounds: 599 });
    expect(expired.objects.stone.prestidigitation).toBeUndefined();
    expect(expired.objects.shield.prestidigitation).toBeUndefined();
    expect(expired.events.every((event) => (
      event.type === 'WorldObjectPatched'
      && event.reason === 'prestidigitation_duration_expired'
      && event.unset?.includes('prestidigitation')
    ))).toBe(true);
    expect(replay(afterOne.objects, expired)).toEqual(expired.objects);
  });

  it('advances multi-turn source expiry and rejects invalid source-turn counters', () => {
    const initial = {
      later: object('later', {
        sourceActorId: 'wizard', sourceTurnEndingsLeft: 2,
        tags: ['prestidigitation:minor_creation'],
      }),
      invalid: object('invalid', { sourceActorId: 'bard', sourceTurnEndingsLeft: 0 }),
      ordinary: object('ordinary', { sourceActorId: 'wizard' }),
    };
    const advanced = endSourceActorTurnWorldObjects({ objects: initial, sourceActorId: 'wizard' });
    expect(advanced.objects.later.sourceTurnEndingsLeft).toBe(1);
    expect(advanced.objects.ordinary).toEqual(initial.ordinary);
    expect(advanced.objects.invalid).toEqual(initial.invalid);
    expect(advanced.events).toEqual([{
      type: 'WorldObjectPatched', objectId: 'later', patch: { sourceTurnEndingsLeft: 1 },
      reason: 'source_turn_end_advanced',
    }]);
    expect(replay(initial, advanced)).toEqual(advanced.objects);
    expect(() => endSourceActorTurnWorldObjects({
      objects: advanced.objects, sourceActorId: 'bard',
    })).toThrow(/Invalid source-turn expiry/);
  });

  it('fails closed on invalid options, facts, duplicate IDs, and foreign replacements', () => {
    const target = object('target', { flame: { kind: 'torch', lit: false } });
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: ' ', sourceActionId: 'spell',
      option: { kind: 'sensory_effect', id: 'spark', description: 'spark', facts: facts() },
    })).toThrow(/source actor requires a stable non-empty id/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: '',
      option: { kind: 'sensory_effect', id: 'spark', description: 'spark', facts: facts() },
    })).toThrow(/source action requires a stable non-empty id/);
    expect(() => resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: { kind: 'sensory_effect', id: '', description: 'spark', facts: facts() },
    })).toThrow(/stable non-empty id/);
    expect(() => resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: { kind: 'sensory_effect', id: 'spark', description: ' ', facts: facts() },
    })).toThrow(/requires a description/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: { kind: 'fire_play', objectId: 'missing', operation: 'light', facts: facts() },
    })).toThrow(/requires a candle/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'clean_or_soil', objectId: 'missing', operation: 'clean',
        facts: facts({ volumeCubicFt: 1 }),
      },
    })).toThrow(/Unknown world object/);
    for (const volumeCubicFt of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => resolvePrestidigitation({
        objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
        option: {
          kind: 'clean_or_soil', objectId: 'target', operation: 'clean',
          facts: facts({ volumeCubicFt }),
        },
      })).toThrow(/volume at most 1 cubic foot/);
    }
    expect(() => resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_sensation', objectId: 'target', id: 'effect', description: 'warm',
        facts: facts(),
      },
    })).toThrow(/volume at most 1 cubic foot/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'missing', id: 'mark', description: 'rune', facts: facts(),
      },
    })).toThrow(/Unknown world object/);
    expect(() => resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: '', description: 'rune', facts: facts(),
      },
    })).toThrow(/stable non-empty id/);
    expect(() => resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: 'mark', description: ' ', facts: facts(),
      },
    })).toThrow(/requires a description/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_creation', id: 'creation', description: 'coin', size: 'tiny',
        fitsInHand: false, facts: facts(),
      },
    })).toThrow(/fit in the caster/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_creation', id: '', description: 'coin', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
    })).toThrow(/stable non-empty id/);
    expect(() => resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_creation', id: 'creation', description: ' ', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
    })).toThrow(/requires a description/);
    expect(() => resolvePrestidigitation({
      objects: { creation: object('creation') }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_creation', id: 'creation', description: 'coin', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
    })).toThrow(/already exists/);

    const one = resolvePrestidigitation({
      objects: { target }, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: 'one', description: 'one', facts: facts(),
      },
    });
    expect(() => resolvePrestidigitation({
      objects: one.objects, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: 'one', description: 'duplicate', facts: facts(),
      },
    })).toThrow(/already exists/);
    expect(() => resolvePrestidigitation({
      objects: one.objects, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: 'two', description: 'two', facts: facts(),
        replaceEffectId: 'missing',
      },
    })).toThrow(/Unknown source-owned/);
    expect(() => resolvePrestidigitation({
      objects: one.objects, sourceActorId: 'bard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'target', id: 'two', description: 'two', facts: facts(),
        replaceEffectId: 'one',
      },
    })).toThrow(/Unknown source-owned/);

    const selfReplacingCreation = resolvePrestidigitation({
      objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'minor_creation', id: 'self-target', description: 'image', size: 'tiny',
        fitsInHand: true, facts: facts(),
      },
    });
    expect(() => resolvePrestidigitation({
      objects: selfReplacingCreation.objects, sourceActorId: 'wizard', sourceActionId: 'spell',
      option: {
        kind: 'magic_mark', objectId: 'self-target', id: 'replacement-mark',
        description: 'mark', facts: facts(), replaceEffectId: 'self-target',
      },
    })).toThrow(/replacement removed the selected target object/);

    for (const invalid of [
      facts({ distanceFt: 10.01 }),
      facts({ distanceFt: -1 }),
      facts({ boardRevision: -1 }),
      { ...facts(), factsSource: 'guess' } as unknown as WorldObjectFacts,
    ]) {
      expect(() => resolvePrestidigitation({
        objects: {}, sourceActorId: 'wizard', sourceActionId: 'spell',
        option: { kind: 'sensory_effect', id: 'effect', description: 'spark', facts: invalid },
      })).toThrow(/valid explicit world facts|outside 10 feet/);
    }
  });
});
