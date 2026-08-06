import { describe, expect, it } from 'vitest';
import {
  advanceWorldObjectRounds,
  attachLight as attachLightPrimitive,
  createMinorIllusion as createMinorIllusionPrimitive,
  evolveWorldObjectEvent,
  foldWorldObjectEvents,
  igniteBurningHandsObjects as igniteBurningHandsObjectsPrimitive,
  illuminationFromObject,
  magicBlockedBy as magicBlockedByPrimitive,
  observeDetectMagic as observeDetectMagicPrimitive,
  physicallyRevealMinorIllusion,
  pushWorldObjects,
  studyMinorIllusion,
  worldObjectLedgerIssue,
  type WorldObjectFacts,
  type WorldObjectState,
} from './worldObjects';
import type {
  BurningHandsObjectsPolicy,
  DetectMagicWorldPolicy,
  LightWorldPolicy,
  MinorIllusionWorldPolicy,
  ParsedMechanicsTargeting,
} from './worldSpellPolicies';

const LIGHT_POLICY: LightWorldPolicy = {
  maxObjectSize: 'large', excludeCarriedByOther: true,
  brightRadiusFt: 20, dimAdditionalRadiusFt: 20,
  durationRounds: 600, maxActivePerSource: 1,
};
const LIGHT_TARGETING: ParsedMechanicsTargeting = {
  domain: 'world', actorTargets: false, shape: 'single', rangeFt: 0,
  requiresLineOfSight: false, requiresTouch: true, allowedRelations: [],
};
const BURNING_POLICY: BurningHandsObjectsPolicy = {
  requireInArea: true, requireFlammable: true, excludeCarried: true,
};
const BURNING_TARGETING: ParsedMechanicsTargeting = {
  domain: 'mixed', actorTargets: true, shape: 'area', rangeFt: 15,
  requiresLineOfSight: false, requiresTouch: false,
  allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
  area: { kind: 'cone', sizeFt: 15 },
};
const BLOCKERS: DetectMagicWorldPolicy['blockers'] = {
  stone: { thresholdInches: 12, comparison: 'gte' },
  common_metal: { thresholdInches: 1, comparison: 'gte' },
  lead: { thresholdInches: 0, comparison: 'gt' },
  wood: { thresholdInches: 12, comparison: 'gte' },
  dirt: { thresholdInches: 12, comparison: 'gte' },
  other: null,
};
const DETECT_POLICY: DetectMagicWorldPolicy = {
  blockers: BLOCKERS, auraRequiresLineOfSight: true, revealSpellSchoolOnly: true,
};
const DETECT_TARGETING: ParsedMechanicsTargeting = {
  domain: 'actor', actorTargets: false, shape: 'self', rangeFt: 0,
  requiresLineOfSight: false, requiresTouch: false, allowedRelations: [],
  area: { kind: 'emanation', radiusFt: 30 },
};
const ILLUSION_POLICY: MinorIllusionWorldPolicy = {
  imageMaxCubeSideFt: 5, durationRounds: 10, maxActivePerSource: 1,
  studyAbility: 'int', studySkill: 'investigation',
};

const attachLight = (input: Omit<Parameters<typeof attachLightPrimitive>[0], 'policy' | 'targeting'>) => (
  attachLightPrimitive({ ...input, policy: LIGHT_POLICY, targeting: LIGHT_TARGETING })
);
const igniteBurningHandsObjects = (
  input: Omit<Parameters<typeof igniteBurningHandsObjectsPrimitive>[0], 'policy' | 'targeting'>,
) => igniteBurningHandsObjectsPrimitive({
  ...input, policy: BURNING_POLICY, targeting: BURNING_TARGETING,
});
const magicBlockedBy = (layers: Parameters<typeof magicBlockedByPrimitive>[0]) => (
  magicBlockedByPrimitive(layers, BLOCKERS)
);
const observeDetectMagic = (
  input: Omit<Parameters<typeof observeDetectMagicPrimitive>[0], 'policy' | 'targeting'>,
) => observeDetectMagicPrimitive({ ...input, policy: DETECT_POLICY, targeting: DETECT_TARGETING });
const createMinorIllusion = (
  input: Omit<Parameters<typeof createMinorIllusionPrimitive>[0], 'policy'>,
) => createMinorIllusionPrimitive({ ...input, policy: ILLUSION_POLICY });

const facts = (overrides: Partial<WorldObjectFacts> = {}): WorldObjectFacts => ({
  factsSource: 'scenario',
  boardRevision: 7,
  distanceFt: 10,
  lineOfSight: true,
  ...overrides,
});

function object(id: string, overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return { id, name: id, kind: 'environment', size: 'medium', ...overrides };
}

describe('data-owned world-object policy mutations', () => {
  it('changes Light, Burning Hands, Detect Magic, and Minor Illusion behavior from policy only', () => {
    const lightPolicy: LightWorldPolicy = {
      ...LIGHT_POLICY,
      maxObjectSize: 'tiny',
      excludeCarriedByOther: false,
      brightRadiusFt: 7,
      dimAdditionalRadiusFt: 3,
      durationRounds: 2,
      maxActivePerSource: 2,
    };
    const lightTargeting: ParsedMechanicsTargeting = {
      ...LIGHT_TARGETING, rangeFt: 2, requiresTouch: false,
    };
    const light = attachLightPrimitive({
      objects: { charm: object('charm', { size: 'tiny', carriedByActorId: 'other' }) },
      targetObjectId: 'charm', facts: facts({ distanceFt: 2, touched: false }),
      sourceActorId: 'wizard', sourceActionId: 'spell.light', attachmentId: 'mutated-light',
      policy: lightPolicy, targeting: lightTargeting,
    });
    expect(light.objects.charm.illumination).toMatchObject({
      brightRadiusFt: 7, dimAdditionalRadiusFt: 3, roundsLeft: 2,
    });
    expect(() => attachLightPrimitive({
      objects: { coin: object('coin', { size: 'small' }) }, targetObjectId: 'coin',
      facts: facts({ distanceFt: 2 }), sourceActorId: 'wizard',
      sourceActionId: 'spell.light', attachmentId: 'too-large',
      policy: lightPolicy, targeting: lightTargeting,
    })).toThrow(/larger than tiny/);

    const burned = igniteBurningHandsObjectsPrimitive({
      objects: { carriedStone: object('carriedStone', { carriedByActorId: 'other' }) },
      factsByObject: { carriedStone: facts({ distanceFt: 10, inArea: false }) },
      policy: { requireInArea: false, requireFlammable: false, excludeCarried: false },
      targeting: BURNING_TARGETING,
    });
    expect(burned.objects.carriedStone.ignited).toBe(true);

    expect(magicBlockedByPrimitive(
      [{ material: 'stone', thicknessInches: 12 }],
      { ...BLOCKERS, stone: { thresholdInches: 13, comparison: 'gte' } },
    )).toBe(false);
    expect(magicBlockedByPrimitive(
      [{ material: 'stone', thicknessInches: 12 }],
      { ...BLOCKERS, stone: { thresholdInches: 11, comparison: 'gte' } },
    )).toBe(true);

    const illusionPolicy: MinorIllusionWorldPolicy = {
      ...ILLUSION_POLICY,
      imageMaxCubeSideFt: 2,
      durationRounds: 4,
      maxActivePerSource: 2,
    };
    const illusion = createMinorIllusionPrimitive({
      objects: {}, id: 'mutated-illusion', sourceActorId: 'wizard',
      sourceActionId: 'spell.minor-illusion', form: 'image', description: 'panel',
      spellSaveDc: 13, imageCubeSideFt: 2, policy: illusionPolicy,
    });
    expect(illusion.objects['mutated-illusion']).toMatchObject({
      roundsLeft: 4,
      illusion: { imageCubeSideFt: 2, studyAbility: 'int', studySkill: 'investigation' },
    });
    expect(() => createMinorIllusionPrimitive({
      objects: {}, id: 'too-wide', sourceActorId: 'wizard',
      sourceActionId: 'spell.minor-illusion', form: 'image', description: 'wall',
      spellSaveDc: 13, imageCubeSideFt: 2.1, policy: illusionPolicy,
    })).toThrow(/up to 2 feet/);
  });
});

describe('deterministic world-object primitives', () => {
  it('replaces multiple same-source attachments in stable object-id order', () => {
    const lightPolicy = { ...LIGHT_POLICY, maxActivePerSource: 2 };
    const firstLight = attachLightPrimitive({
      objects: { z: object('z'), a: object('a'), target: object('target') },
      targetObjectId: 'z', facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard', sourceActionId: 'light', attachmentId: 'light-z',
      policy: lightPolicy, targeting: LIGHT_TARGETING,
    });
    const secondLight = attachLightPrimitive({
      objects: firstLight.objects,
      targetObjectId: 'a', facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard', sourceActionId: 'light', attachmentId: 'light-a',
      policy: lightPolicy, targeting: LIGHT_TARGETING,
    });
    const replacementLight = attachLight({
      objects: secondLight.objects,
      targetObjectId: 'target', facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard', sourceActionId: 'light', attachmentId: 'light-target',
    });
    expect(replacementLight.events.map((event) => (
      'objectId' in event ? event.objectId : event.object.id
    ))).toEqual(['a', 'z', 'target']);

    const illusionPolicy = { ...ILLUSION_POLICY, maxActivePerSource: 2 };
    const firstIllusion = createMinorIllusionPrimitive({
      objects: {}, id: 'z-illusion', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'z', spellSaveDc: 13,
      policy: illusionPolicy,
    });
    const secondIllusion = createMinorIllusionPrimitive({
      objects: firstIllusion.objects, id: 'a-illusion', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'a', spellSaveDc: 13,
      policy: illusionPolicy,
    });
    const replacementIllusion = createMinorIllusion({
      objects: secondIllusion.objects, id: 'current-illusion', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'current', spellSaveDc: 13,
    });
    expect(replacementIllusion.events.slice(0, 2).map((event) => (
      'objectId' in event ? event.objectId : event.object.id
    )))
      .toEqual(['a-illusion', 'z-illusion']);
    expect(replacementIllusion.events[2]).toMatchObject({
      type: 'WorldObjectCreated', object: { id: 'current-illusion' },
    });
  });

  it('implements Light attachment, replacement, opaque cover, size and touch limits, and the full one-hour duration', () => {
    const first = attachLight({
      objects: {
        torch: object('torch'),
        shield: object('shield', {
          illumination: {
            id: 'other-light', sourceActorId: 'other', sourceActionId: 'light',
            brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 600,
          },
        }),
      },
      targetObjectId: 'torch',
      facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard',
      sourceActionId: 'light',
      attachmentId: 'light-1',
    });
    expect(illuminationFromObject(first.objects.torch)).toMatchObject({
      brightRadiusFt: 20, dimAdditionalRadiusFt: 20, sourceActorId: 'wizard',
    });
    const second = attachLight({
      objects: { ...first.objects, stone: object('stone', { coveredByOpaqueObject: true }) },
      targetObjectId: 'stone',
      facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard',
      sourceActionId: 'light',
      attachmentId: 'light-2',
    });
    expect(second.objects.torch.illumination).toBeUndefined();
    expect(second.objects.shield.illumination?.id).toBe('other-light');
    expect(second.objects.stone.illumination?.id).toBe('light-2');
    expect(illuminationFromObject(second.objects.stone)).toBeNull();
    expect(second.events.map((event) => event.type)).toEqual([
      'WorldObjectPatched', 'WorldObjectPatched',
    ]);
    expect(illuminationFromObject(object('dark'))).toBeNull();
    expect(() => attachLight({
      objects: {}, targetObjectId: 'missing', facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard', sourceActionId: 'light', attachmentId: 'bad',
    })).toThrow(/Unknown world object/);
    expect(() => attachLight({
      objects: { huge: object('huge', { size: 'huge' }) }, targetObjectId: 'huge',
      facts: facts({ distanceFt: 0, touched: true }), sourceActorId: 'wizard',
      sourceActionId: 'light', attachmentId: 'bad-size',
    })).toThrow(/larger than/i);
    expect(() => attachLight({
      objects: { torch: object('torch') }, targetObjectId: 'torch',
      facts: facts({ distanceFt: 1, touched: true }), sourceActorId: 'wizard',
      sourceActionId: 'light', attachmentId: 'bad-facts',
    })).toThrow(/explicit object facts|touched object facts/);
    expect(() => attachLight({
      objects: { sword: object('sword', { carriedByActorId: 'fighter' }) }, targetObjectId: 'sword',
      facts: facts({ distanceFt: 0, touched: true }), sourceActorId: 'wizard',
      sourceActionId: 'light', attachmentId: 'bad-carrier',
    })).toThrow(/someone else/);
    const ownObject = attachLight({
      objects: { staff: object('staff', { carriedByActorId: 'wizard' }) }, targetObjectId: 'staff',
      facts: facts({ distanceFt: 0, touched: true }), sourceActorId: 'wizard',
      sourceActionId: 'light', attachmentId: 'own-light',
    });
    expect(ownObject.objects.staff.illumination?.roundsLeft).toBe(600);
    const expired = advanceWorldObjectRounds({ objects: ownObject.objects, rounds: 600 });
    expect(expired.objects.staff.illumination).toBeUndefined();
    expect(expired.events).toContainEqual(expect.objectContaining({
      type: 'WorldObjectPatched', objectId: 'staff', reason: 'light_duration_expired',
    }));
  });

  it('ignites only uncarried flammable Burning Hands objects explicitly inside the area', () => {
    const result = igniteBurningHandsObjects({
      objects: {
        curtain: object('curtain', { flammable: true, unattended: true }),
        carriedTorch: object('carriedTorch', { flammable: true, unattended: true, carriedByActorId: 'fighter' }),
        statue: object('statue', { flammable: false, unattended: true }),
        farHay: object('farHay', { flammable: true, unattended: true }),
        placedHay: object('placedHay', { flammable: true, unattended: false }),
      },
      factsByObject: {
        curtain: facts({ inArea: true, distanceFt: 12 }),
        carriedTorch: facts({ inArea: true }),
        statue: facts({ inArea: true }),
        farHay: facts({ inArea: true, distanceFt: 16 }),
        placedHay: facts({ inArea: true, distanceFt: 5 }),
      },
    });
    expect(result.objects.curtain.ignited).toBe(true);
    expect(result.objects.carriedTorch.ignited).toBeUndefined();
    expect(result.objects.statue.ignited).toBeUndefined();
    expect(result.objects.farHay.ignited).toBeUndefined();
    expect(result.objects.placedHay.ignited).toBe(true);
    expect(result.events).toHaveLength(2);
  });

  it('pushes only unsecured Thunderwave objects entirely inside the explicit cube', () => {
    const result = pushWorldObjects({
      objects: {
        crate: object('crate', { displacementFt: 5 }),
        barrel: object('barrel'),
        boltedChest: object('boltedChest', { secured: true }),
        sword: object('sword', { carriedByActorId: 'fighter' }),
        edge: object('edge'),
      },
      factsByObject: {
        crate: facts({ entirelyInArea: true }),
        barrel: facts({ entirelyInArea: true }),
        boltedChest: facts({ entirelyInArea: true }),
        sword: facts({ entirelyInArea: true }),
        edge: facts({ entirelyInArea: false }),
      },
      policy: {
        distanceFt: 7,
        maxObjectDistanceFt: 15,
        areaRequirement: 'entirely_in_area',
        excludeSecured: true,
        excludeCarried: true,
      },
    });
    expect(result.objects.crate.displacementFt).toBe(12);
    expect(result.objects.barrel.displacementFt).toBe(7);
    expect(result.objects.boltedChest.displacementFt).toBeUndefined();
    expect(result.objects.sword.displacementFt).toBeUndefined();
    expect(result.objects.edge.displacementFt).toBeUndefined();
    expect(result.events).toHaveLength(2);
    expect(() => pushWorldObjects({
      objects: {},
      factsByObject: {},
      policy: {
        distanceFt: 0,
        maxObjectDistanceFt: 15,
        areaRequirement: 'entirely_in_area',
        excludeSecured: true,
        excludeCarried: true,
      },
    })).toThrow(/Forced object push policy is malformed/);
  });

  it('implements Detect Magic distance, material blocking, visible aura, and school disclosure', () => {
    const rune = object('rune', {
      magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
    });
    expect(() => observeDetectMagicPrimitive({
      object: rune,
      facts: facts(),
      blockingLayers: [],
      revealAura: true,
      policy: DETECT_POLICY,
      targeting: { ...DETECT_TARGETING, area: undefined },
    })).toThrow(/numeric sensing radius/);
    expect(observeDetectMagic({
      object: rune,
      facts: facts({ distanceFt: 30 }),
      blockingLayers: [],
      revealAura: false,
    })).toEqual({ sensed: true, auraVisible: false });
    expect(observeDetectMagic({
      object: rune,
      facts: facts({ distanceFt: 30 }),
      blockingLayers: [],
      revealAura: true,
    })).toEqual({ sensed: true, auraVisible: true, school: 'abjuration' });
    expect(observeDetectMagic({
      object: rune,
      facts: facts({ distanceFt: 30 }),
      blockingLayers: [{ material: 'stone', thicknessInches: 12 }],
      revealAura: true,
    })).toEqual({ sensed: false, auraVisible: false });
    expect(observeDetectMagic({
      object: rune,
      facts: facts({ distanceFt: 31 }),
      blockingLayers: [],
      revealAura: true,
    })).toEqual({ sensed: false, auraVisible: false });
    expect(magicBlockedBy([
      { material: 'common_metal', thicknessInches: 0.99 },
      { material: 'lead', thicknessInches: 0.001 },
    ])).toBe(true);
    expect(magicBlockedBy([{ material: 'stone', thicknessInches: 11.99 }])).toBe(false);
    expect(magicBlockedBy([{ material: 'common_metal', thicknessInches: 1 }])).toBe(true);
    expect(magicBlockedBy([{ material: 'wood', thicknessInches: 36 }])).toBe(true);
    expect(magicBlockedBy([{ material: 'dirt', thicknessInches: 11.99 }])).toBe(false);
    expect(magicBlockedBy([{ material: 'other', thicknessInches: 100 }])).toBe(false);
    expect(magicBlockedBy([{ material: 'stone', thicknessInches: Number.NaN }])).toBe(true);
    expect(observeDetectMagic({
      object: object('mundane'), facts: facts(), blockingLayers: [], revealAura: true,
    })).toEqual({ sensed: false, auraVisible: false });
    expect(observeDetectMagic({
      object: object('hidden-aura', {
        magicalAura: { school: 'illusion', createdBySpell: true, visible: false },
      }),
      facts: facts(), blockingLayers: [], revealAura: true,
    })).toEqual({ sensed: true, auraVisible: false });
    expect(observeDetectMagic({
      object: rune, facts: facts({ lineOfSight: false }), blockingLayers: [], revealAura: true,
    })).toEqual({ sensed: true, auraVisible: false });
    expect(observeDetectMagic({
      object: object('magic-item', {
        magicalAura: { school: 'transmutation', createdBySpell: false, visible: true },
      }),
      facts: facts(), blockingLayers: [], revealAura: true,
    })).toEqual({ sensed: true, auraVisible: true });
  });

  it('implements bounded sound and image Minor Illusion, replacement, per-observer Study and physical disclosure, and duration', () => {
    const created = createMinorIllusion({
      objects: {},
      id: 'illusion-1',
      sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion',
      form: 'image',
      description: 'A closed iron door',
      spellSaveDc: 13,
      imageCubeSideFt: 5,
    });
    const failed = studyMinorIllusion({
      objects: created.objects,
      objectId: 'illusion-1',
      actorId: 'fighter',
      checkTotal: 12,
    });
    expect(failed.events).toHaveLength(0);
    const passed = studyMinorIllusion({
      objects: failed.objects,
      objectId: 'illusion-1',
      actorId: 'fighter',
      checkTotal: 13,
    });
    expect(passed.objects['illusion-1'].illusion?.discernedByActorIds).toEqual(['fighter']);
    const touched = physicallyRevealMinorIllusion({
      objects: passed.objects,
      objectId: 'illusion-1',
      actorId: 'rogue',
    });
    expect(touched.objects['illusion-1'].illusion?.physicallyRevealedToActorIds).toEqual(['rogue']);
    expect(touched.objects['illusion-1'].illusion?.discernedByActorIds).toEqual(['fighter']);
    expect(touched.objects['illusion-1']).toMatchObject({
      roundsLeft: 10,
      illusion: { studyAbility: 'int', studySkill: 'investigation', imageCubeSideFt: 5 },
    });
    const duplicateObserver = studyMinorIllusion({
      objects: passed.objects, objectId: 'illusion-1', actorId: 'fighter', checkTotal: 20,
    });
    expect(duplicateObserver.objects['illusion-1'].illusion?.discernedByActorIds).toEqual(['fighter']);
    const secondObserver = studyMinorIllusion({
      objects: passed.objects, objectId: 'illusion-1', actorId: 'artificer', checkTotal: 20,
    });
    expect(secondObserver.objects['illusion-1'].illusion?.discernedByActorIds)
      .toEqual(['artificer', 'fighter']);
    expect(() => createMinorIllusion({
      objects: created.objects, id: 'illusion-1', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'bell', spellSaveDc: 13,
    })).toThrow(/already exists/);
    expect(() => createMinorIllusion({
      objects: {}, id: 'blank', sourceActorId: 'wizard', sourceActionId: 'minor-illusion',
      form: 'image', description: '   ', spellSaveDc: 13, imageCubeSideFt: 5,
    })).toThrow(/description/);
    expect(() => createMinorIllusion({
      objects: {}, id: 'bad-dc', sourceActorId: 'wizard', sourceActionId: 'minor-illusion',
      form: 'image', description: 'door', spellSaveDc: 0, imageCubeSideFt: 5,
    })).toThrow(/positive integer/);
    expect(() => createMinorIllusion({
      objects: {}, id: 'too-large', sourceActorId: 'wizard', sourceActionId: 'minor-illusion',
      form: 'image', description: 'tower', spellSaveDc: 13, imageCubeSideFt: 5.01,
    })).toThrow(/cube side/i);
    const sound = createMinorIllusion({
      objects: {
        ...created.objects,
        mundane: object('mundane'),
        'other-caster': {
          ...created.objects['illusion-1'], id: 'other-caster', sourceActorId: 'bard',
        },
        'other-action': {
          ...created.objects['illusion-1'], id: 'other-action', sourceActionId: 'major-illusion',
        },
      },
      id: 'illusion-sound', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'bell', spellSaveDc: 13,
    });
    expect(sound.objects).not.toHaveProperty('illusion-1');
    expect(sound.objects).toHaveProperty('mundane');
    expect(sound.objects).toHaveProperty('other-caster');
    expect(sound.objects).toHaveProperty('other-action');
    expect(sound.events[0]).toMatchObject({
      type: 'WorldObjectRemoved', objectId: 'illusion-1', reason: 'minor_illusion_replaced',
    });
    expect(() => physicallyRevealMinorIllusion({
      objects: sound.objects, objectId: 'illusion-sound', actorId: 'fighter',
    })).toThrow(/sound illusion/);
    const expiredSound = advanceWorldObjectRounds({ objects: sound.objects, rounds: 10 });
    expect(expiredSound.objects).not.toHaveProperty('illusion-sound');
    expect(expiredSound.events).toContainEqual(expect.objectContaining({
      type: 'WorldObjectRemoved', objectId: 'illusion-sound', reason: 'duration_expired',
    }));
    expect(() => studyMinorIllusion({
      objects: {}, objectId: 'missing', actorId: 'fighter', checkTotal: 20,
    })).toThrow(/not an illusion/);
    expect(() => physicallyRevealMinorIllusion({
      objects: {}, objectId: 'missing', actorId: 'fighter',
    })).toThrow(/not an illusion/);
  });

  it('advances Light and Minor Illusion durations through explicit replayable rounds', () => {
    const lit = attachLight({
      objects: { torch: object('torch') }, targetObjectId: 'torch',
      facts: facts({ distanceFt: 0, touched: true }), sourceActorId: 'wizard',
      sourceActionId: 'light', attachmentId: 'light-timer',
    });
    const illusion = createMinorIllusion({
      objects: lit.objects, id: 'illusion-timer', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'image', description: 'crate',
      spellSaveDc: 13, imageCubeSideFt: 5,
    });
    const unchanged = advanceWorldObjectRounds({ objects: illusion.objects, rounds: 0 });
    expect(unchanged.events).toEqual([]);
    expect(unchanged.objects).toEqual(illusion.objects);

    const afterNine = advanceWorldObjectRounds({ objects: unchanged.objects, rounds: 9 });
    expect(afterNine.objects['illusion-timer'].roundsLeft).toBe(1);
    expect(afterNine.objects.torch.illumination?.roundsLeft).toBe(591);
    const afterTen = advanceWorldObjectRounds({ objects: afterNine.objects, rounds: 1 });
    expect(afterTen.objects).not.toHaveProperty('illusion-timer');
    expect(afterTen.objects.torch.illumination?.roundsLeft).toBe(590);
    const afterHour = advanceWorldObjectRounds({ objects: afterTen.objects, rounds: 590 });
    expect(afterHour.objects.torch.illumination).toBeUndefined();
    expect(afterHour.objects).toHaveProperty('torch');
    expect(afterHour.events).toContainEqual(expect.objectContaining({
      type: 'WorldObjectPatched', objectId: 'torch', reason: 'light_duration_expired',
    }));
    expect(() => advanceWorldObjectRounds({ objects: {}, rounds: -1 })).toThrow(/non-negative integer/);
    expect(() => advanceWorldObjectRounds({ objects: {}, rounds: 1.5 })).toThrow(/non-negative integer/);
  });

  it('round-trips JSON-safe object events and fails closed on corrupt replay', () => {
    const initial = { torch: object('torch') };
    const lit = attachLight({
      objects: initial, targetObjectId: 'torch', facts: facts({ distanceFt: 0, touched: true }),
      sourceActorId: 'wizard', sourceActionId: 'light', attachmentId: 'light-replay',
    });
    const expired = advanceWorldObjectRounds({ objects: lit.objects, rounds: 600 });
    const persisted = JSON.parse(JSON.stringify([...lit.events, ...expired.events]));
    expect(foldWorldObjectEvents(initial, persisted)).toEqual(expired.objects);
    expect(persisted.at(-1)).toMatchObject({ unset: ['illumination'] });

    const created = createMinorIllusion({
      objects: {}, id: 'illusion-replay', sourceActorId: 'wizard',
      sourceActionId: 'minor-illusion', form: 'sound', description: 'bell', spellSaveDc: 13,
    });
    const observed = studyMinorIllusion({
      objects: created.objects, objectId: 'illusion-replay', actorId: 'fighter', checkTotal: 13,
    });
    expect(foldWorldObjectEvents({}, [...created.events, ...observed.events]))
      .toEqual(observed.objects);
    const removed = advanceWorldObjectRounds({ objects: observed.objects, rounds: 10 });
    expect(foldWorldObjectEvents(observed.objects, removed.events)).toEqual({});

    expect(() => evolveWorldObjectEvent(initial, {
      type: 'WorldObjectCreated', object: object('torch'),
    })).toThrow(/already exists/);
    expect(() => evolveWorldObjectEvent({}, {
      type: 'WorldObjectRemoved', objectId: 'missing', reason: 'corrupt',
    })).toThrow(/Unknown world object/);
    expect(() => evolveWorldObjectEvent(initial, {
      type: 'WorldObjectPatched', objectId: 'torch', patch: { id: 'other' }, reason: 'corrupt',
    })).toThrow(/cannot change object identity/);
    expect(() => evolveWorldObjectEvent(initial, {
      type: 'WorldObjectPatched', objectId: 'torch', patch: {}, unset: ['name'], reason: 'corrupt',
    })).toThrow(/cannot unset required field/);
  });

  it('keeps immutable Card↔item identity and canonical held-hand state replay-safe', () => {
    const weapon: WorldObjectState = {
      id: 'weapon-1', name: 'Dagger', kind: 'item', size: 'small',
      itemCardId: 'card:dagger', carriedByActorId: 'warlock',
      heldByActorId: 'warlock', heldInHand: 'main_hand',
    };
    const created = evolveWorldObjectEvent({}, { type: 'WorldObjectCreated', object: weapon });
    expect(created['weapon-1']).toEqual(weapon);
    expect(evolveWorldObjectEvent(created, {
      type: 'WorldObjectPatched', objectId: 'weapon-1',
      patch: { itemCardId: 'card:dagger', heldInHand: 'off_hand' }, reason: 'switch_hand',
    })['weapon-1']).toMatchObject({ itemCardId: 'card:dagger', heldInHand: 'off_hand' });
    expect(() => evolveWorldObjectEvent(created, {
      type: 'WorldObjectPatched', objectId: 'weapon-1',
      patch: { itemCardId: 'card:longsword' }, reason: 'corrupt',
    })).toThrow(/immutable itemCardId/);
    expect(() => evolveWorldObjectEvent(created, {
      type: 'WorldObjectPatched', objectId: 'weapon-1',
      patch: {}, unset: ['itemCardId'], reason: 'corrupt',
    })).toThrow(/immutable itemCardId/);
    expect(() => evolveWorldObjectEvent({}, {
      type: 'WorldObjectCreated',
      object: object('not-item', { itemCardId: 'card:dagger' }),
    })).toThrow(/itemCardId/);
    expect(() => evolveWorldObjectEvent({}, {
      type: 'WorldObjectCreated',
      object: { ...weapon, id: 'blank-card', itemCardId: ' ' },
    })).toThrow(/itemCardId/);
    expect(() => evolveWorldObjectEvent({}, {
      type: 'WorldObjectCreated',
      object: { ...weapon, id: 'bad-attunement', attunedToActorId: ' ' },
    })).toThrow(/attunement/);
    expect(() => evolveWorldObjectEvent({}, {
      type: 'WorldObjectCreated',
      object: { ...weapon, id: 'half-held', heldInHand: undefined },
    })).toThrow(/held identity/);
    expect(() => evolveWorldObjectEvent(created, {
      type: 'WorldObjectPatched', objectId: 'weapon-1',
      patch: { carriedByActorId: 'rival' }, reason: 'corrupt',
    })).toThrow(/held identity/);
    expect(() => evolveWorldObjectEvent(created, {
      type: 'WorldObjectCreated',
      object: {
        ...weapon,
        id: 'weapon-2',
        name: 'Second Dagger',
      },
    })).toThrow(/canonical held-item hand is already occupied/);
  });

  it('validates item owners against the actor ledger and rejects a duplicate hand introduced by a patch', () => {
    expect(worldObjectLedgerIssue({
      bad: object('bad', { kind: 'item', itemCardId: ' ' }),
    })).toMatch(/itemCardId/);

    const attuned = object('attuned', {
      kind: 'item', itemCardId: 'card:wand', attunedToActorId: 'wizard',
    });
    expect(worldObjectLedgerIssue({ attuned })).toBeNull();
    expect(worldObjectLedgerIssue({ attuned }, new Set(['wizard']))).toBeNull();
    expect(worldObjectLedgerIssue({ attuned }, new Set(['fighter'])))
      .toMatch(/attunement owner/);

    const held = object('held', {
      kind: 'item', itemCardId: 'card:dagger', carriedByActorId: 'wizard',
      heldByActorId: 'wizard', heldInHand: 'main_hand',
    });
    expect(worldObjectLedgerIssue({ held })).toBeNull();
    expect(worldObjectLedgerIssue({ held }, new Set(['wizard']))).toBeNull();
    expect(worldObjectLedgerIssue({ held }, new Set(['fighter']))).toMatch(/holder/);

    const twoHands = {
      main: held,
      off: object('off', {
        kind: 'item', itemCardId: 'card:focus', carriedByActorId: 'wizard',
        heldByActorId: 'wizard', heldInHand: 'off_hand',
      }),
    };
    expect(() => evolveWorldObjectEvent(twoHands, {
      type: 'WorldObjectPatched',
      objectId: 'off',
      patch: { heldInHand: 'main_hand' },
      reason: 'corrupt_duplicate_hand',
    })).toThrow(/already occupied/);
  });
});
