import { describe, expect, it } from 'vitest';
import type {
  ActionTargeting,
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { managedWorldSpellMechanics } from './testing/worldSpellPolicyFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'world-object-actions@1',
  contentHash: 'sha256:world-object-actions',
  errataVersion: 'phb-2024-v1',
};

const targeting = (maxTargets = 0): ActionTargeting => ({
  minTargets: 0,
  maxTargets,
  rangeFt: 30,
  requiresLineOfSight: false,
  allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
});

const ACTIONS: RuleActionDefinition[] = [
  {
    id: 'spell.light', name: 'Light', kind: 'spell', sourceEntityIds: ['SPELL-LIGHT'],
    spell: { level: 0, sourceClass: 'wizard' }, targeting: targeting(),
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...managedWorldSpellMechanics('light_world_object'), effects: [],
    },
  },
  {
    id: 'spell.minor-illusion', name: 'Minor Illusion', kind: 'spell',
    sourceEntityIds: ['SPELL-MINOR-ILLUSION'], spell: { level: 0, sourceClass: 'wizard' },
    targeting: targeting(),
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...managedWorldSpellMechanics('minor_illusion_world_object'), effects: [],
    },
  },
  {
    id: 'spell.burning-hands', name: 'Burning Hands', kind: 'spell',
    sourceEntityIds: ['SPELL-BURNING-HANDS'], spell: { level: 1, sourceClass: 'wizard' },
    targeting: targeting(8),
    mechanics: {
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
      },
      ...managedWorldSpellMechanics('burning_hands_objects'), effects: [],
    },
  },
  {
    id: 'spell.thunderwave', name: 'Thunderwave', kind: 'spell',
    sourceEntityIds: ['SPELL-THUNDERWAVE'], spell: { level: 1, sourceClass: 'wizard' },
    targeting: targeting(8),
    mechanics: {
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
      },
      primitive: {
        type: 'area_object_push',
        object_push_distance_ft: 10,
        object_max_distance_ft: 15,
        object_area_requirement: 'entirely_in_area',
        exclude_secured_objects: true,
        exclude_carried_objects: true,
      },
      effects: [],
    },
  },
  {
    id: 'action.repulsor-array', name: 'Repulsor Array', kind: 'nonSpell',
    sourceEntityIds: ['CARD-custom-repulsor'], targeting: targeting(8),
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      primitive: {
        type: 'area_object_push',
        object_push_distance_ft: 7,
        object_max_distance_ft: 20,
        object_area_requirement: 'entirely_in_area',
        exclude_secured_objects: true,
        exclude_carried_objects: true,
      },
      effects: [],
    },
  },
  {
    id: 'spell.detect-magic', name: 'Detect Magic', kind: 'spell',
    sourceEntityIds: ['SPELL-DETECT-MAGIC'], spell: { level: 1, sourceClass: 'wizard' },
    concentration: true, targeting: targeting(),
    mechanics: {
      activation: {
        mode: 'active',
        cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
      },
      ...managedWorldSpellMechanics('detect_magic_world_sensing'), effects: [],
    },
  },
  {
    id: 'action.mundane', name: 'Mundane', kind: 'nonSpell', sourceEntityIds: ['ACTION-MUNDANE'],
    targeting: targeting(),
    mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [] },
  },
];

const catalog: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    capabilities: { actionIds: ACTIONS.map((action) => action.id) },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: id === 'wizard' ? 3 : 1, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      spellcastingMod: id === 'wizard' ? 3 : undefined,
      skillProficiencies: id === 'fighter' ? ['investigation'] : [],
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 12, max: 12, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 3 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 3 },
      equipment: {}, inventory: [], activeEffects: [],
    },
  };
}

function base(session: InMemoryRulesSession, commandId: string, actorId: string) {
  return {
    schemaVersion: 1 as const,
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId,
  };
}

function accepted(result: ReturnType<InMemoryRulesSession['dispatch']>) {
  expect(result.status).toBe('accepted');
  if (result.status !== 'accepted') throw new Error(result.message);
  return result;
}

function objectEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((event) => (
    event.payload.type === 'WorldObjectMutationRecorded' ? [event.payload.event] : []
  ));
}

function session(
  id: string,
  dice: Array<{ label: string; sides: number; value: number }> = [],
) {
  const tape = createStrictRngTape(dice);
  const instance = new InMemoryRulesSession(createWorld({
    id,
    ruleset: RULESET,
    actors: [actor('wizard'), actor('fighter')],
    objects: [
      { id: 'torch', name: 'Torch', kind: 'item', size: 'tiny', flammable: true },
      { id: 'stone', name: 'Stone', kind: 'environment', size: 'small' },
      {
        id: 'rune', name: 'Abjuration rune', kind: 'spell_effect', size: 'small',
        magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
      },
      {
        id: 'carried-tinder', name: 'Carried tinder', kind: 'item', size: 'tiny',
        flammable: true, carriedByActorId: 'fighter',
      },
    ],
  }), catalog, {
    rng: tape.rng,
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory(id),
  });
  return { instance, tape };
}

function startEncounter(instance: InMemoryRulesSession) {
  accepted(instance.dispatch({
    ...base(instance, 'encounter', 'wizard'),
    type: 'StartEncounter',
    initiative: ['wizard', 'fighter'],
  }));
  accepted(instance.dispatch({ ...base(instance, 'wizard-turn-1', 'wizard'), type: 'StartTurn' }));
}

function endWizardStartFighter(instance: InMemoryRulesSession) {
  accepted(instance.dispatch({ ...base(instance, 'wizard-end-1', 'wizard'), type: 'EndTurn' }));
  accepted(instance.dispatch({ ...base(instance, 'fighter-turn-1', 'fighter'), type: 'StartTurn' }));
}

function nextWizardTurn(instance: InMemoryRulesSession) {
  accepted(instance.dispatch({ ...base(instance, 'fighter-end-1', 'fighter'), type: 'EndTurn' }));
  accepted(instance.dispatch({ ...base(instance, 'wizard-turn-2', 'wizard'), type: 'StartTurn' }));
}

describe('canonical commands for persistent spell/world interactions', () => {
  it('rejects missing managed policy before spending resources, RNG, ids, or changing revision', () => {
    const canonicalLight = ACTIONS.find((action) => action.id === 'spell.light');
    if (!canonicalLight) throw new Error('Light fixture is missing');
    const malformed = JSON.parse(JSON.stringify(canonicalLight)) as RuleActionDefinition;
    malformed.mechanics.primitive = { type: 'light_world_object' };
    const malformedCatalog: RulesCatalog = {
      getAction: (id) => (id === malformed.id ? malformed : catalog.getAction(id)),
    };
    let rngCalls = 0;
    let idCalls = 0;
    const instance = new InMemoryRulesSession(createWorld({
      id: 'fail-closed-policy', ruleset: RULESET,
      actors: [actor('wizard'), actor('fighter')],
      objects: [{ id: 'torch', name: 'Torch', kind: 'item', size: 'tiny' }],
    }), malformedCatalog, {
      rng: () => { rngCalls += 1; return 0.5; },
      clock: createLogicalClock(),
      nextId: () => { idCalls += 1; return `forbidden-id:${idCalls}`; },
    });
    startEncounter(instance);
    const revisionBefore = instance.getState().revision;
    const idsBefore = idCalls;
    const resourcesBefore = JSON.parse(JSON.stringify(
      instance.getState().actors.wizard.runtime.resources,
    ));
    expect(instance.dispatch({
      ...base(instance, 'malformed-light', 'wizard'),
      type: 'UseAction', actionId: malformed.id, targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'torch',
        facts: {
          factsSource: 'board', boardRevision: 1, distanceFt: 0,
          lineOfSight: true, touched: true,
        },
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionDefinition' });
    expect(instance.getState().revision).toBe(revisionBefore);
    expect(instance.getState().actors.wizard.runtime.resources).toEqual(resourcesBefore);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(idsBefore);
  });

  it('casts Light on an object, advances duration by full rounds, and replaces the caster previous Light', () => {
    const { instance, tape } = session('light');
    startEncounter(instance);
    const first = accepted(instance.dispatch({
      ...base(instance, 'cast-light-1', 'wizard'),
      type: 'UseAction', actionId: 'spell.light', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'torch',
        facts: { factsSource: 'board', boardRevision: 1, distanceFt: 0, lineOfSight: true, touched: true },
      },
    }));
    expect(instance.getState().objects.torch.illumination).toMatchObject({
      brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 600,
      sourceActorId: 'wizard', sourceActionId: 'spell.light',
    });
    expect(objectEvents(first.events)).toHaveLength(1);

    endWizardStartFighter(instance);
    nextWizardTurn(instance);
    expect(instance.getState().objects.torch.illumination?.roundsLeft).toBe(599);
    const second = accepted(instance.dispatch({
      ...base(instance, 'cast-light-2', 'wizard'),
      type: 'UseAction', actionId: 'spell.light', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'stone',
        facts: { factsSource: 'board', boardRevision: 2, distanceFt: 0, lineOfSight: true, touched: true },
      },
    }));
    expect(instance.getState().objects.torch.illumination).toBeUndefined();
    expect(instance.getState().objects.stone.illumination?.roundsLeft).toBe(600);
    expect(objectEvents(second.events).map((event) => event.type)).toEqual([
      'WorldObjectPatched', 'WorldObjectPatched',
    ]);
    tape.assertExhausted();
    const checkpoint = JSON.parse(JSON.stringify(createWorld({
      id: 'light', ruleset: RULESET, actors: [actor('wizard'), actor('fighter')],
      objects: [
        { id: 'torch', name: 'Torch', kind: 'item', size: 'tiny', flammable: true },
        { id: 'stone', name: 'Stone', kind: 'environment', size: 'small' },
        {
          id: 'rune', name: 'Abjuration rune', kind: 'spell_effect', size: 'small',
          magicalAura: { school: 'abjuration', createdBySpell: true, visible: true },
        },
        {
          id: 'carried-tinder', name: 'Carried tinder', kind: 'item', size: 'tiny',
          flammable: true, carriedByActorId: 'fighter',
        },
      ],
    })));
    expect(foldEvents(checkpoint, JSON.parse(JSON.stringify(instance.getEvents()))))
      .toEqual(instance.getState());
  });

  it('creates a bounded image illusion and lets the other PC discern and physically reveal it', () => {
    const { instance, tape } = session('illusion', [
      { label: 'fighter Study', sides: 20, value: 10 },
    ]);
    startEncounter(instance);
    accepted(instance.dispatch({
      ...base(instance, 'cast-illusion', 'wizard'),
      type: 'UseAction', actionId: 'spell.minor-illusion', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'minor_illusion', form: 'image', description: 'Closed iron door', imageCubeSideFt: 5,
        facts: {
          factsSource: 'scenario', boardRevision: 0, distanceFt: 20, lineOfSight: true,
        },
      },
    }));
    const illusionId = 'cast-illusion:id:1';
    expect(instance.getState().objects[illusionId]).toMatchObject({
      roundsLeft: 10,
      illusion: { form: 'image', spellSaveDc: 13, discernedByActorIds: [] },
    });

    endWizardStartFighter(instance);
    accepted(instance.dispatch({
      ...base(instance, 'study-illusion', 'fighter'),
      type: 'StudyWorldObject', objectId: illusionId,
      facts: { factsSource: 'board', boardRevision: 2, distanceFt: 5, lineOfSight: true },
    }));
    expect(instance.getState().objects[illusionId].illusion?.discernedByActorIds).toEqual(['fighter']);
    accepted(instance.dispatch({
      ...base(instance, 'touch-illusion', 'fighter'),
      type: 'PhysicallyInteractWorldObject', objectId: illusionId,
      facts: { factsSource: 'board', boardRevision: 2, distanceFt: 0, lineOfSight: true, touched: true },
    }));
    expect(instance.getState().objects[illusionId].illusion?.physicallyRevealedToActorIds)
      .toEqual(['fighter']);
    nextWizardTurn(instance);
    expect(instance.getState().objects[illusionId].roundsLeft).toBe(9);
    tape.assertExhausted();
  });

  it('derives Burning Hands ignition and Thunderwave displacement from explicit area snapshots', () => {
    const burning = session('burning');
    startEncounter(burning.instance);
    const burned = accepted(burning.instance.dispatch({
      ...base(burning.instance, 'cast-burning', 'wizard'),
      type: 'UseAction', actionId: 'spell.burning-hands', targetIds: [], spell: { baseLevel: 1 },
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          torch: {
            factsSource: 'board', boardRevision: 1, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
          'carried-tinder': {
            factsSource: 'board', boardRevision: 1, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
        },
      },
    }));
    expect(burning.instance.getState().objects.torch.ignited).toBe(true);
    expect(burning.instance.getState().objects['carried-tinder'].ignited).toBeUndefined();
    expect(burning.instance.getState().actors.wizard.runtime.resources).toMatchObject({
      action: 0, spell_slot_1: 2,
    });
    expect(objectEvents(burned.events)).toHaveLength(1);
    burning.tape.assertExhausted();

    const thunder = session('thunder');
    startEncounter(thunder.instance);
    accepted(thunder.instance.dispatch({
      ...base(thunder.instance, 'cast-thunder', 'wizard'),
      type: 'UseAction', actionId: 'spell.thunderwave', targetIds: [], spell: { baseLevel: 1 },
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          stone: {
            factsSource: 'gm_ruling', boardRevision: 4, distanceFt: 15,
            lineOfSight: true, entirelyInArea: true,
          },
        },
      },
    }));
    expect(thunder.instance.getState().objects.stone.displacementFt).toBe(10);
    thunder.tape.assertExhausted();

    const repulsor = session('generic-repulsor');
    startEncounter(repulsor.instance);
    accepted(repulsor.instance.dispatch({
      ...base(repulsor.instance, 'activate-repulsor', 'wizard'),
      type: 'UseAction', actionId: 'action.repulsor-array', targetIds: [],
      worldInput: {
        type: 'area_objects',
        factsByObject: {
          stone: {
            factsSource: 'gm_ruling', boardRevision: 4, distanceFt: 20,
            lineOfSight: true, entirelyInArea: true,
          },
        },
      },
    }));
    expect(repulsor.instance.getState().objects.stone.displacementFt).toBe(7);
    repulsor.tape.assertExhausted();
  });

  it('requires active Detect Magic concentration and spends a later Magic action to reveal aura facts', () => {
    const { instance, tape } = session('detect');
    startEncounter(instance);
    accepted(instance.dispatch({
      ...base(instance, 'cast-detect', 'wizard'),
      type: 'UseAction', actionId: 'spell.detect-magic', targetIds: [], spell: { baseLevel: 1 },
    }));
    expect(instance.getState().concentrations.wizard).toMatchObject({
      id: 'cast-detect:concentration', actionId: 'spell.detect-magic', effectLinks: [],
    });
    const tooEarly = instance.dispatch({
      ...base(instance, 'reveal-too-early', 'wizard'),
      type: 'RevealMagicAura', concentrationId: 'cast-detect:concentration',
      observations: {},
    });
    expect(tooEarly).toMatchObject({ status: 'rejected', code: 'InsufficientResources' });

    endWizardStartFighter(instance);
    nextWizardTurn(instance);
    const revealed = accepted(instance.dispatch({
      ...base(instance, 'reveal-aura', 'wizard'),
      type: 'RevealMagicAura', concentrationId: 'cast-detect:concentration',
      observations: {
        rune: {
          facts: { factsSource: 'board', boardRevision: 5, distanceFt: 30, lineOfSight: true },
          blockingLayers: [],
        },
        torch: {
          facts: { factsSource: 'board', boardRevision: 5, distanceFt: 10, lineOfSight: true },
          blockingLayers: [{ material: 'lead', thicknessInches: 0.01 }],
        },
      },
    }));
    expect(instance.getState().actors.wizard.runtime.resources.action).toBe(0);
    const observations = objectEvents(revealed.events).filter((event) => (
      event.type === 'WorldObjectObserved'
    ));
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'WorldObjectObserved', objectId: 'rune', actorId: 'wizard',
        observation: 'detect_magic_aura',
        details: expect.objectContaining({ sensed: true, auraVisible: true, school: 'abjuration' }),
      }),
      expect.objectContaining({
        type: 'WorldObjectObserved', objectId: 'torch',
        details: expect.objectContaining({ sensed: false, auraVisible: false }),
      }),
    ]));
    tape.assertExhausted();
  });

  it('fails closed on stale object IDs, malformed facts, mismatched primitives, and invalid concentration', () => {
    const { instance } = session('invalid');
    startEncounter(instance);
    const revision = instance.getState().revision;
    expect(instance.dispatch({
      ...base(instance, 'missing-light-object', 'wizard'),
      type: 'UseAction', actionId: 'spell.light', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'missing',
        facts: { factsSource: 'board', boardRevision: 1, distanceFt: 0, lineOfSight: true, touched: true },
      },
    })).toMatchObject({ status: 'rejected', code: 'WorldObjectNotFound' });
    expect(instance.getState().revision).toBe(revision);

    expect(instance.dispatch({
      ...base(instance, 'bad-light-facts', 'wizard'),
      type: 'UseAction', actionId: 'spell.light', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'target_object', objectId: 'torch',
        facts: { factsSource: 'board', boardRevision: -1, distanceFt: 0, lineOfSight: true, touched: true },
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });

    expect(instance.dispatch({
      ...base(instance, 'mundane-world-input', 'wizard'),
      type: 'UseAction', actionId: 'action.mundane', targetIds: [],
      worldInput: {
        type: 'area_objects',
        factsByObject: {},
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });

    expect(instance.dispatch({
      ...base(instance, 'invalid-detect', 'wizard'),
      type: 'RevealMagicAura', concentrationId: 'missing', observations: {},
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(instance.getState().revision).toBe(revision);
  });
});
