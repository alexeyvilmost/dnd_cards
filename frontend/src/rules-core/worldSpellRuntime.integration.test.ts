import { describe, expect, it } from 'vitest';
import { createLogicalClock, createStrictRngTape } from './determinism';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type UncommittedRuleEvent,
  type WorldState,
} from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';
import {
  managedWorldSpellMechanics,
} from './testing/worldSpellPolicyFixtures';
import type { ManagedWorldSpellPrimitiveType } from './worldSpellPolicies';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'world-spells-runtime@1',
  contentHash: 'sha256:world-spells-runtime',
  errataVersion: 'phb-2024-v1',
};

function worldSpell(
  id: string,
  level: 0 | 1,
  primitive: ManagedWorldSpellPrimitiveType,
  concentration = false,
): RuleActionDefinition {
  return {
    id,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`source:${id}`],
    spell: { level, sourceClass: 'wizard' },
    ...(concentration ? { concentration: true } : {}),
    targeting: {
      minTargets: 0,
      maxTargets: 0,
      rangeFt: 120,
      requiresLineOfSight: false,
      allowedRelations: ['self', 'ally', 'enemy', 'neutral'],
    },
    mechanics: {
      activation: {
        mode: 'active',
        cost: [
          { resource: 'action' },
          ...(level === 1 ? [{ resource: 'spell_slot', level: 1, amount: 1 }] : []),
        ],
      },
      ...managedWorldSpellMechanics(primitive),
      effects: [],
    },
  };
}

const ACTIONS = [
  worldSpell('spell.dancing-lights', 0, 'dancing_lights_world', true),
  worldSpell('spell.druidcraft', 0, 'druidcraft_world'),
  worldSpell('spell.mending', 0, 'mending_world'),
  worldSpell('spell.prestidigitation', 0, 'prestidigitation_world'),
  worldSpell('spell.detect-poison-disease', 1, 'detect_poison_disease_world', true),
  worldSpell('spell.purify-food-drink', 1, 'purify_food_drink_world'),
] satisfies RuleActionDefinition[];

const catalog: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    capabilities: { actionIds: ACTIONS.map((action) => action.id) },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
      spellcastingMod: 3,
      skillProficiencies: [],
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 4 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 4 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    spellcastingAccess: {
      grants: ACTIONS.map((action) => {
        if (action.kind !== 'spell') throw new Error(`${action.id} must be a spell`);
        return {
          grantId: `grant:${id}:${action.id}`,
          actionId: action.id,
          sourceId: `spell-source:${id}`,
          access: action.spell.level === 0 ? 'cantrip' as const : 'known' as const,
          level: action.spell.level,
          spellcastingAbility: 'int' as const,
          ...(action.spell.level === 0 ? {} : { slotResource: 'spell_slot_1' }),
        };
      }),
      preparedSources: {},
    },
  };
}

function initialWorld(id: string): WorldState {
  return migrateWorldState(createWorld({
    id,
    ruleset: RULESET,
    actors: [actor('wizard'), actor('ranger')],
    objects: [
      {
        id: 'rope', name: 'Torn rope', kind: 'item', size: 'tiny',
        breakOrTear: { maxDimensionFt: 0.5, repaired: false },
      },
      {
        id: 'flower', name: 'Closed flower', kind: 'environment', size: 'tiny',
        plant: { kind: 'flower', bloomed: false },
      },
      {
        id: 'torch', name: 'Torch', kind: 'item', size: 'tiny',
        flame: { kind: 'torch', lit: false },
      },
      { id: 'cloak', name: 'Cloak', kind: 'item', size: 'small', soiled: true },
      {
        id: 'stew', name: 'Spoiled stew', kind: 'item', size: 'small',
        foodOrDrink: { kind: 'food', magical: false, poisoned: true, rotten: true },
      },
      {
        id: 'magic-wine', name: 'Magic wine', kind: 'item', size: 'tiny',
        foodOrDrink: { kind: 'drink', magical: true, poisoned: true, rotten: false },
      },
      {
        id: 'venom', name: 'Wyvern venom', kind: 'item', size: 'tiny',
        hazardousSubstance: { kind: 'poison', specificKind: 'wyvern venom' },
      },
      { id: 'water', name: 'Water', kind: 'item', size: 'tiny' },
    ],
  }));
}

function makeSession(id: string) {
  const tape = createStrictRngTape([]);
  const starting = initialWorld(id);
  return {
    starting,
    tape,
    session: new InMemoryRulesSession(starting, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: () => 'ignored-by-command-id-derived-environment',
    }),
  };
}

function base(session: InMemoryRulesSession, commandId: string, actorId = 'wizard') {
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

function mutations(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'WorldObjectMutationRecorded' ? [entry.payload.event] : []
  ));
}

function start(session: InMemoryRulesSession) {
  accepted(session.dispatch({
    ...base(session, 'encounter'), type: 'StartEncounter', initiative: ['wizard', 'ranger'],
  }));
  accepted(session.dispatch({ ...base(session, 'wizard-start-1'), type: 'StartTurn' }));
}

function nextWizardTurn(session: InMemoryRulesSession, suffix = '1') {
  accepted(session.dispatch({ ...base(session, `wizard-end-${suffix}`), type: 'EndTurn' }));
  accepted(session.dispatch({ ...base(session, `ranger-start-${suffix}`, 'ranger'), type: 'StartTurn' }));
  accepted(session.dispatch({ ...base(session, `ranger-end-${suffix}`, 'ranger'), type: 'EndTurn' }));
  accepted(session.dispatch({ ...base(session, `wizard-start-${Number(suffix) + 1}`), type: 'StartTurn' }));
}

function assertReplay(starting: WorldState, session: InMemoryRulesSession) {
  const persisted = JSON.parse(JSON.stringify(session.getState())) as WorldState;
  expect(migrateWorldState(persisted)).toEqual(persisted);
  expect(foldEvents(
    JSON.parse(JSON.stringify(starting)) as WorldState,
    JSON.parse(JSON.stringify(session.getEvents())) as UncommittedRuleEvent[],
  )).toEqual(session.getState());
}

describe('canonical runtime vertical for micro-MVP world spell primitives', () => {
  it('rejects a non-atomic data-owned cast time in an encounter before cost/RNG/id use and audits it in exploration', () => {
    const baseMending = ACTIONS.find((action) => action.id === 'spell.mending');
    if (!baseMending) throw new Error('Mending fixture is missing');
    const longMending = JSON.parse(JSON.stringify(baseMending)) as RuleActionDefinition;
    (longMending.mechanics.activation as Record<string, unknown>).cast_time = {
      unit: 'minute', amount: 1,
    };
    const longCatalog: RulesCatalog = {
      getAction: (id) => (id === longMending.id ? longMending : catalog.getAction(id)),
    };

    let rngCalls = 0;
    let idCalls = 0;
    const combat = new InMemoryRulesSession(initialWorld('long-mending-combat'), longCatalog, {
      rng: () => { rngCalls += 1; return 0.5; },
      clock: createLogicalClock(),
      nextId: () => { idCalls += 1; return `long-mending:${idCalls}`; },
    });
    start(combat);
    const idsBefore = idCalls;
    const resourcesBefore = JSON.parse(JSON.stringify(
      combat.getState().actors.wizard.runtime.resources,
    ));
    const revisionBefore = combat.getState().revision;
    expect(combat.dispatch({
      ...base(combat, 'long-mending:combat'),
      type: 'UseAction', actionId: longMending.id, targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'mending', objectId: 'rope',
        facts: {
          factsSource: 'board', boardRevision: 1, distanceFt: 0,
          lineOfSight: true, touched: true,
        },
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(combat.getState().revision).toBe(revisionBefore);
    expect(combat.getState().actors.wizard.runtime.resources).toEqual(resourcesBefore);
    expect(rngCalls).toBe(0);
    expect(idCalls).toBe(idsBefore);

    const exploration = new InMemoryRulesSession(
      initialWorld('long-mending-exploration'), longCatalog,
      {
        rng: () => { rngCalls += 1; return 0.5; },
        clock: createLogicalClock(),
        nextId: () => { idCalls += 1; return `long-mending:${idCalls}`; },
      },
    );
    const result = accepted(exploration.dispatch({
      ...base(exploration, 'long-mending:exploration'),
      type: 'UseAction', actionId: longMending.id, targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'mending', objectId: 'rope',
        facts: {
          factsSource: 'board', boardRevision: 2, distanceFt: 0,
          lineOfSight: true, touched: true,
        },
      },
    }));
    expect(result.events.find((event) => event.payload.type === 'ActionDeclared')?.payload)
      .toMatchObject({
        type: 'ActionDeclared',
        spell: { baseLevel: 0, castLevel: 0, baseCastingTimeSeconds: 60 },
      });
    expect(exploration.getState().objects.rope.breakOrTear?.repaired).toBe(true);
    expect(exploration.getState().actors.wizard.runtime.resources.action).toBe(0);
    expect(rngCalls).toBe(0);
  });

  it('casts and moves source-owned Dancing Lights, then removes them with exact concentration', () => {
    const run = makeSession('dancing-runtime');
    start(run.session);
    const cast = accepted(run.session.dispatch({
      ...base(run.session, 'cast-dancing'),
      type: 'UseAction', actionId: 'spell.dancing-lights', targetIds: [],
      spell: { baseLevel: 0, grantId: 'grant:wizard:spell.dancing-lights' },
      worldInput: {
        type: 'dancing_lights', form: 'individual',
        facts: { factsSource: 'board', boardRevision: 1, distanceFt: 45, lineOfSight: true },
        placements: [
          { distanceFromCasterFt: 30, withinRequiredSeparation: true },
          { distanceFromCasterFt: 45, withinRequiredSeparation: true },
        ],
      },
    }));
    const concentrationId = 'cast-dancing:concentration';
    const groupId = 'cast-dancing:id:1';
    const lightIds = ['cast-dancing:id:2', 'cast-dancing:id:3'];
    expect(run.session.getState().concentrations.wizard).toMatchObject({
      id: concentrationId, actionId: 'spell.dancing-lights',
    });
    expect(Object.keys(run.session.getState().objects).filter((id) => lightIds.includes(id))).toHaveLength(2);
    expect(mutations(cast.events)).toHaveLength(2);

    accepted(run.session.dispatch({
      ...base(run.session, 'move-dancing'),
      type: 'MoveDancingLights', concentrationId, groupId,
      factsSource: 'board', boardRevision: 8,
      resultingFacts: [
        { lightId: lightIds[0], movementFt: 30, distanceFromCasterFt: 60, withinRequiredSeparation: true },
        { lightId: lightIds[1], movementFt: 60, distanceFromCasterFt: 130, withinRequiredSeparation: true },
      ],
    }));
    expect(run.session.getState().objects[lightIds[0]].distanceFromSourceFt).toBe(60);
    expect(run.session.getState().objects[lightIds[1]]).toBeUndefined();
    expect(run.session.getState().actors.wizard.runtime.resources.bonus_action).toBe(0);

    const revision = run.session.getState().revision;
    expect(run.session.dispatch({
      ...base(run.session, 'forged-move'),
      type: 'MoveDancingLights', concentrationId, groupId: 'someone-else',
      factsSource: 'board', boardRevision: 9, resultingFacts: [],
    })).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(run.session.getState().revision).toBe(revision);

    nextWizardTurn(run.session);
    accepted(run.session.dispatch({
      ...base(run.session, 'recast-dancing'),
      type: 'UseAction', actionId: 'spell.dancing-lights', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'dancing_lights', form: 'medium_humanoid',
        facts: { factsSource: 'board', boardRevision: 10, distanceFt: 15, lineOfSight: true },
        placements: [{ distanceFromCasterFt: 15 }],
      },
    }));
    expect(run.session.getState().objects[lightIds[0]]).toBeUndefined();
    expect(run.session.getState().objects['recast-dancing:id:2']).toBeDefined();

    nextWizardTurn(run.session, '2');
    accepted(run.session.dispatch({
      ...base(run.session, 'cast-detect'),
      type: 'UseAction', actionId: 'spell.detect-poison-disease', targetIds: [],
      spell: { baseLevel: 1, grantId: 'grant:wizard:spell.detect-poison-disease' },
    }));
    expect(run.session.getState().objects['recast-dancing:id:2']).toBeUndefined();
    expect(run.session.getState().concentrations.wizard.id).toBe('cast-detect:concentration');
    assertReplay(run.starting, run.session);
    run.tape.assertExhausted();
  });

  it('executes Druidcraft options and Mending only from explicit valid facts', () => {
    const druid = makeSession('druidcraft-runtime');
    start(druid.session);
    const bloom = accepted(druid.session.dispatch({
      ...base(druid.session, 'cast-bloom'),
      type: 'UseAction', actionId: 'spell.druidcraft', targetIds: [],
      spell: { baseLevel: 0 },
      worldInput: {
        type: 'druidcraft',
        option: {
          kind: 'bloom', objectId: 'flower',
          facts: { factsSource: 'board', boardRevision: 2, distanceFt: 25, lineOfSight: true },
        },
      },
    }));
    expect(druid.session.getState().objects.flower.plant?.bloomed).toBe(true);
    expect(mutations(bloom.events)[0]).toMatchObject({ type: 'WorldObjectPatched', reason: 'druidcraft_bloom' });
    assertReplay(druid.starting, druid.session);

    const mending = makeSession('mending-runtime');
    start(mending.session);
    expect(mending.session.dispatch({
      ...base(mending.session, 'forged-source'),
      type: 'UseAction', actionId: 'spell.mending', targetIds: [],
      spell: { baseLevel: 0, grantId: 'grant:ranger:spell.mending' },
      worldInput: {
        type: 'mending', objectId: 'rope',
        facts: { factsSource: 'board', boardRevision: 3, distanceFt: 0, lineOfSight: true, touched: true },
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidSpellDeclaration' });
    accepted(mending.session.dispatch({
      ...base(mending.session, 'cast-mending'),
      type: 'UseAction', actionId: 'spell.mending', targetIds: [],
      spell: { baseLevel: 0, grantId: 'grant:wizard:spell.mending' },
      worldInput: {
        type: 'mending', objectId: 'rope',
        facts: { factsSource: 'gm_ruling', boardRevision: 3, distanceFt: 0, lineOfSight: true, touched: true },
      },
    }));
    expect(mending.session.getState().objects.rope.breakOrTear?.repaired).toBe(true);
    assertReplay(mending.starting, mending.session);
  });

  it('routes every Druidcraft and Prestidigitation option through canonical mutations', () => {
    const weather = makeSession('druidcraft-weather');
    start(weather.session);
    const weatherEvents = accepted(weather.session.dispatch({
      ...base(weather.session, 'weather-sensor'),
      type: 'UseAction', actionId: 'spell.druidcraft', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'druidcraft', option: {
          kind: 'weather_sensor', prediction: 'rain within 24 hours',
          facts: { factsSource: 'scenario', boardRevision: 4, distanceFt: 10, lineOfSight: true },
        },
      },
    }));
    expect(mutations(weatherEvents.events)).toEqual([
      expect.objectContaining({ type: 'WorldObjectCreated' }),
    ]);

    const fire = makeSession('druidcraft-fire');
    start(fire.session);
    accepted(fire.session.dispatch({
      ...base(fire.session, 'light-torch'),
      type: 'UseAction', actionId: 'spell.druidcraft', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'druidcraft', option: {
          kind: 'fire_play', objectId: 'torch', operation: 'light',
          facts: { factsSource: 'board', boardRevision: 4, distanceFt: 30, lineOfSight: true },
        },
      },
    }));
    expect(fire.session.getState().objects.torch.flame?.lit).toBe(true);

    const sensory = makeSession('druidcraft-sensory');
    start(sensory.session);
    const sensoryEvents = accepted(sensory.session.dispatch({
      ...base(sensory.session, 'sensory-effect'),
      type: 'UseAction', actionId: 'spell.druidcraft', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'druidcraft', option: {
          kind: 'sensory_effect', description: 'falling leaves', cubeSideFt: 5,
          facts: { factsSource: 'gm_ruling', boardRevision: 4, distanceFt: 30, lineOfSight: false },
        },
      },
    }));
    expect(mutations(sensoryEvents.events).map((event) => event.type)).toEqual([
      'WorldObjectCreated', 'WorldObjectRemoved',
    ]);

    const cleaning = makeSession('prestidigitation-clean');
    start(cleaning.session);
    accepted(cleaning.session.dispatch({
      ...base(cleaning.session, 'clean-cloak'),
      type: 'UseAction', actionId: 'spell.prestidigitation', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'prestidigitation', option: {
          kind: 'clean_or_soil', objectId: 'cloak', operation: 'clean',
          facts: {
            factsSource: 'board', boardRevision: 5, distanceFt: 10,
            lineOfSight: true, volumeCubicFt: 1,
          },
        },
      },
    }));
    expect(cleaning.session.getState().objects.cloak.soiled).toBe(false);

    const mark = makeSession('prestidigitation-mark');
    start(mark.session);
    accepted(mark.session.dispatch({
      ...base(mark.session, 'mark-cloak'),
      type: 'UseAction', actionId: 'spell.prestidigitation', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'prestidigitation', option: {
          kind: 'magic_mark', objectId: 'cloak', description: 'blue rune',
          facts: { factsSource: 'board', boardRevision: 5, distanceFt: 10, lineOfSight: true },
        },
      },
    }));
    expect(mark.session.getState().objects.cloak.prestidigitation).toEqual([
      expect.objectContaining({
        id: 'mark-cloak:id:1', kind: 'magic_mark', sourceActorId: 'wizard', roundsLeft: 600,
      }),
    ]);
    assertReplay(mark.starting, mark.session);
  });

  it('persists Prestidigitation effects and replays source-turn and round lifecycles', () => {
    const run = makeSession('prestidigitation-runtime');
    start(run.session);
    accepted(run.session.dispatch({
      ...base(run.session, 'create-trinket'),
      type: 'UseAction', actionId: 'spell.prestidigitation', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'prestidigitation',
        option: {
          kind: 'minor_creation', description: 'Tiny brass key', size: 'tiny', fitsInHand: true,
          facts: { factsSource: 'scenario', boardRevision: 1, distanceFt: 5, lineOfSight: true },
        },
      },
    }));
    const trinketId = 'create-trinket:id:1';
    expect(run.session.getState().objects[trinketId].sourceTurnEndingsLeft).toBe(2);
    nextWizardTurn(run.session);
    expect(run.session.getState().objects[trinketId].sourceTurnEndingsLeft).toBe(1);
    accepted(run.session.dispatch({ ...base(run.session, 'wizard-end-2'), type: 'EndTurn' }));
    expect(run.session.getState().objects[trinketId]).toBeUndefined();
    const lifecycle = mutations(run.session.getEvents()).filter((event) => (
      event.type === 'WorldObjectPatched' || event.type === 'WorldObjectRemoved'
    ));
    expect(lifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'WorldObjectPatched', reason: 'source_turn_end_advanced' }),
      expect.objectContaining({ type: 'WorldObjectRemoved', reason: 'source_turn_end_expired' }),
    ]));
    assertReplay(run.starting, run.session);
  });

  it('observes poison only under exact active concentration and records structured facts', () => {
    const run = makeSession('detect-poison-runtime');
    start(run.session);
    accepted(run.session.dispatch({
      ...base(run.session, 'cast-detect-poison'),
      type: 'UseAction', actionId: 'spell.detect-poison-disease', targetIds: [],
      spell: { baseLevel: 1 },
    }));
    const observed = accepted(run.session.dispatch({
      ...base(run.session, 'sense-poison'),
      type: 'ObservePoisonDisease', concentrationId: 'cast-detect-poison:concentration',
      observations: {
        venom: {
          facts: { factsSource: 'board', boardRevision: 11, distanceFt: 30, lineOfSight: false },
          blockingLayers: [],
        },
        water: {
          facts: { factsSource: 'board', boardRevision: 11, distanceFt: 5, lineOfSight: true },
          blockingLayers: [],
        },
      },
    }));
    expect(mutations(observed.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'WorldObjectObserved', objectId: 'venom', observation: 'detect_poison_and_disease',
        details: expect.objectContaining({
          sensed: true, locationKnown: true, kind: 'wyvern venom',
          concentrationId: 'cast-detect-poison:concentration',
        }),
      }),
      expect.objectContaining({
        type: 'WorldObjectObserved', objectId: 'water',
        details: expect.objectContaining({ sensed: false, locationKnown: false }),
      }),
    ]));
    expect(run.session.dispatch({
      ...base(run.session, 'wrong-concentration'),
      type: 'ObservePoisonDisease', concentrationId: 'forged', observations: {},
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    assertReplay(run.starting, run.session);
  });

  it('purifies only explicit nonmagical food and drink in the declared sphere', () => {
    const run = makeSession('purify-runtime');
    start(run.session);
    const result = accepted(run.session.dispatch({
      ...base(run.session, 'cast-purify'),
      type: 'UseAction', actionId: 'spell.purify-food-drink', targetIds: [],
      spell: { baseLevel: 1, grantId: 'grant:wizard:spell.purify-food-drink' },
      worldInput: {
        type: 'purify_food_drink', sphereCenterDistanceFt: 10,
        factsByObject: {
          stew: {
            factsSource: 'board', boardRevision: 12, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
          'magic-wine': {
            factsSource: 'board', boardRevision: 12, distanceFt: 10,
            lineOfSight: true, inArea: true,
          },
        },
      },
    }));
    expect(run.session.getState().objects.stew.foodOrDrink).toMatchObject({
      poisoned: false, rotten: false,
    });
    expect(run.session.getState().objects['magic-wine'].foodOrDrink?.poisoned).toBe(true);
    expect(run.session.getState().actors.wizard.runtime.resources).toMatchObject({
      action: 0, spell_slot_1: 3,
    });
    expect(mutations(result.events)).toHaveLength(1);
    assertReplay(run.starting, run.session);
  });

  it('rejects forged persisted world-spell ownership without hardcoding data-owned duration', () => {
    const dancing = makeSession('migration-dancing');
    start(dancing.session);
    accepted(dancing.session.dispatch({
      ...base(dancing.session, 'migration-cast-dancing'),
      type: 'UseAction', actionId: 'spell.dancing-lights', targetIds: [], spell: { baseLevel: 0 },
      worldInput: {
        type: 'dancing_lights', form: 'medium_humanoid',
        facts: { factsSource: 'board', boardRevision: 13, distanceFt: 20, lineOfSight: true },
        placements: [{ distanceFromCasterFt: 20 }],
      },
    }));
    const persisted = JSON.parse(JSON.stringify(dancing.session.getState())) as WorldState;
    const light = persisted.objects['migration-cast-dancing:id:2'];
    light.sourceActionId = 'forged-action';
    expect(() => migrateWorldState(persisted)).toThrow(/actor-owned source action/);

    const noConcentration = JSON.parse(JSON.stringify(dancing.session.getState())) as WorldState;
    noConcentration.concentrations = {};
    expect(() => migrateWorldState(noConcentration)).toThrow(/exact active concentration/);

    const duration = JSON.parse(JSON.stringify(dancing.session.getState())) as WorldState;
    duration.objects['migration-cast-dancing:id:2'].roundsLeft = 11;
    expect(migrateWorldState(duration).objects['migration-cast-dancing:id:2'].roundsLeft).toBe(11);
  });
});
