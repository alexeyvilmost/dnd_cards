import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  WorldState,
} from '../domain';
import { createLogicalClock, createSequentialIdFactory } from '../determinism';
import type { FamiliarState } from '../findFamiliar';
import {
  FAMILIAR_ACTOR_CATALOG,
  getFamiliarActorTemplate,
  materializeFamiliarActor,
} from '../familiarActorCatalog';
import type { WorldObjectState } from '../worldObjects';
import { runScenario, type ScenarioSpec } from './scenario';
import { PACT_BLADE_PHB_2024_LIFECYCLE_POLICY } from './pactBladePolicyFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'micro-scenario@1',
  contentHash: 'sha256:micro-scenario',
  errataVersion: 'test',
};

function fixture(name: string): ActorState {
  return {
    id: name,
    name,
    kind: 'playerCharacter',
    controllerId: `${name}-controller`,
    ac: 12,
    capabilities: { actionIds: actions.map((action) => action.id) },
    character: {
      abilityMods: { str: 3, dex: 2, con: 1, int: 2, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
      skillProficiencies: ['athletics'],
      saveProficiencies: ['con'],
    },
    runtime: {
      hp: { current: 12, max: 12, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      equipment: {}, inventory: [], activeEffects: [],
    },
  };
}

const actions: RuleActionDefinition[] = [
  {
    id: 'action.scenario-strike',
    name: 'Удар',
    kind: 'nonSpell',
    sourceEntityIds: ['action.scenario-strike'],
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'],
    },
    mechanics: {
      name: 'Удар', activation: { cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'attack_roll', ability: 'str', on_hit: [
        { kind: 'damage', dice: '1d6', type: 'bludgeoning', ability: 'none' },
      ] }],
    },
  },
  {
    id: 'spell.scenario-poison',
    name: 'Ядовитая волна',
    kind: 'spell',
    sourceEntityIds: ['spell.scenario-poison'],
    spell: { level: 1, sourceClass: 'test-caster' },
    targeting: {
      minTargets: 1, maxTargets: 1, rangeFt: 30, requiresLineOfSight: true, allowedRelations: ['enemy'],
    },
    mechanics: {
      name: 'Ядовитая волна', activation: { cost: [{ resource: 'spell_slot_1' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'con', dc: '14',
        on_fail: [
          { kind: 'damage', dice: '1d6', type: 'poison' },
          { kind: 'condition', value: 'poisoned', duration: { type: 'rounds', amount: 1 } },
        ],
        on_success: [],
      }],
    },
  },
];

const catalog: RulesCatalog = { getAction: (id) => actions.find((action) => action.id === id) };
const near = {
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
};
const ranged = { ...near, distanceFt: 30 };

const OWNER_FIXTURE_ID = 'fixture:scenario-owner';
const FAMILIAR_FIXTURE_ID = 'fixture:scenario-familiar';

function ownershipAliasFixtures(): { owner: ActorState; familiar: ActorState } {
  const owner = fixture(OWNER_FIXTURE_ID);
  owner.capabilities.actionIds.push('spell:find-familiar');
  owner.runtime.activeEffects = [{
    id: 'effect:cross-actor',
    name: 'Cross-actor lifecycle',
    mechanics: {},
    source: 'scenario fixture',
    ownerId: OWNER_FIXTURE_ID,
    sourceId: FAMILIAR_FIXTURE_ID,
    sourceTurnExpiry: {
      sourceActorId: FAMILIAR_FIXTURE_ID,
      ownerActorId: OWNER_FIXTURE_ID,
      boundary: 'end',
    },
  }];
  owner.warlockPacts = {
    blade: {
      kind: 'blade',
      sourceEntityId: 'effect:pact-blade',
      ownerActorId: OWNER_FIXTURE_ID,
      bondActionId: 'action:pact-blade',
      lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      activeBond: {
        sourceEntityId: 'effect:pact-blade',
        warlockActorId: OWNER_FIXTURE_ID,
        weaponObjectId: 'object:source-owned',
        weaponCardId: 'card:pact-weapon',
        weaponType: 'longsword',
        normalDamageType: 'slashing',
        conjured: true,
        bondedAtRevision: 0,
        continuousSeparationSeconds: 0,
        lastDistanceBoardRevision: null,
      },
    },
    chain: {
      kind: 'chain',
      sourceEntityId: 'effect:pact-chain',
      ownerActorId: OWNER_FIXTURE_ID,
      template: {
        findFamiliarActionId: 'spell:find-familiar',
        normalFormSource: 'find_familiar_spell',
        specialFormIds: ['imp'],
      },
      activeFamiliar: {
        actorId: FAMILIAR_FIXTURE_ID,
        ownerActorId: OWNER_FIXTURE_ID,
        formId: 'owl',
        sourceEntityId: 'effect:pact-chain',
        reactionAvailable: true,
      },
    },
    tome: {
      kind: 'tome',
      sourceEntityId: 'effect:pact-tome',
      ownerActorId: OWNER_FIXTURE_ID,
      tome: {
        sourceEntityId: 'effect:pact-tome',
        ownerActorId: OWNER_FIXTURE_ID,
        bookObjectId: 'object:source-owned',
        cantripActionIds: ['tome:cantrip:1', 'tome:cantrip:2', 'tome:cantrip:3'],
        ritualActionIds: ['tome:ritual:1', 'tome:ritual:2'],
        spellGrantIds: ['grant:1', 'grant:2', 'grant:3', 'grant:4', 'grant:5'],
        createdAfterRest: 'long',
      },
    },
  };

  const template = getFamiliarActorTemplate('owl');
  const familiarState: FamiliarState = {
    schemaVersion: 1,
    actorId: FAMILIAR_FIXTURE_ID,
    ownerActorId: OWNER_FIXTURE_ID,
    sourceEntityId: 'effect:pact-chain',
    extension: 'pact_chain',
    form: {
      id: template.formId,
      name: template.name,
      statBlockId: template.selectionStatBlockId,
      eligibility: 'base_standard',
      baseCreatureType: 'beast',
      challengeRating: 0,
    },
    spiritType: 'fey',
    presence: 'present',
    initiative: { mode: 'own', d20Roll: null, modifier: null, total: null },
    reactionAvailable: true,
    sharedSenses: null,
    carriedItemIds: [],
    wornItemIds: [],
    allyToOwnerAndAllies: true,
    actsIndependently: true,
    obeysOwnerCommands: true,
    canAttackNormally: false,
  };
  const familiarProjection = materializeFamiliarActor({
    familiar: familiarState,
    template,
    ownerControllerId: owner.controllerId,
  });
  const familiar: ActorState = {
    ...familiarProjection,
    familiarState,
    familiarMetadata: {
      ...familiarProjection.familiarMetadata,
      summoningActionId: 'spell:find-familiar',
      catalogId: FAMILIAR_ACTOR_CATALOG.catalogId,
      catalogContentHash: FAMILIAR_ACTOR_CATALOG.contentHash,
    },
  };
  return { owner, familiar };
}

function sourceOwnedObject(): WorldObjectState {
  return {
    id: 'object:source-owned',
    name: 'Aliased source-owned focus',
    kind: 'item',
    size: 'small',
    itemCardId: 'card:pact-weapon',
    attunedToActorId: OWNER_FIXTURE_ID,
    heldByActorId: OWNER_FIXTURE_ID,
    heldInHand: 'main_hand',
    ownerActorId: OWNER_FIXTURE_ID,
    carriedByActorId: OWNER_FIXTURE_ID,
    sourceActorId: OWNER_FIXTURE_ID,
    sourceActionId: 'effect:pact-tome',
    illumination: {
      id: 'illumination:source-owned',
      sourceActorId: OWNER_FIXTURE_ID,
      sourceActionId: 'spell:light',
      brightRadiusFt: 20,
      dimAdditionalRadiusFt: 20,
      roundsLeft: 600,
    },
    illusion: {
      form: 'image',
      description: 'Alias projection',
      spellSaveDc: 12,
      studyAbility: 'int',
      studySkill: 'investigation',
      imageCubeSideFt: 5,
      discernedByActorIds: [OWNER_FIXTURE_ID, FAMILIAR_FIXTURE_ID],
      physicallyRevealedToActorIds: [FAMILIAR_FIXTURE_ID],
    },
    prestidigitation: [{
      id: 'attachment:source-owned',
      sourceActorId: FAMILIAR_FIXTURE_ID,
      sourceActionId: 'spell:prestidigitation',
      kind: 'magic_mark',
      description: 'Alias mark',
      roundsLeft: 10,
    }],
    tags: ['book_of_shadows', 'pact_weapon', 'spellcasting_focus'],
  };
}

function ownershipAliasSpec(object: WorldObjectState): ScenarioSpec {
  return {
    schemaVersion: 1,
    id: 'micro.synthetic.actor-alias-ownership',
    ruleset: RULESET,
    actors: {
      owner: { fixtureId: 'provider-key:owner' },
      familiar: { fixtureId: 'provider-key:familiar' },
    },
    objects: [object],
    initiative: ['owner', 'familiar'],
    rollTape: [{ label: 'familiar initiative', sides: 20, value: 10 }],
    steps: [
      {
        do: 'startTurn',
        actor: 'owner',
        assertions: [
          { id: 'ALIAS-BLADE', type: 'equals', path: 'actors.owner.warlockPacts.blade.activeBond.warlockActorId', value: 'owner' },
          { id: 'ALIAS-CHAIN-OWNER', type: 'equals', path: 'actors.owner.warlockPacts.chain.ownerActorId', value: 'owner' },
          { id: 'ALIAS-CHAIN-FAMILIAR', type: 'equals', path: 'actors.owner.warlockPacts.chain.activeFamiliar.actorId', value: 'familiar' },
          { id: 'ALIAS-TOME', type: 'equals', path: 'actors.owner.warlockPacts.tome.tome.ownerActorId', value: 'owner' },
          { id: 'ALIAS-FAMILIAR-OWNER', type: 'equals', path: 'actors.familiar.familiarState.ownerActorId', value: 'owner' },
          { id: 'ALIAS-OBJECT-SOURCE', type: 'equals', path: 'objects.object:source-owned.sourceActorId', value: 'owner' },
        ],
      },
      {
        do: 'endTurn', actor: 'owner', assertions: [
          { id: 'ALIAS-OWNER-END', type: 'event', eventType: 'turn_ended', exactly: 1 },
        ],
      },
      {
        do: 'checkpointReload', assertions: [
          { id: 'ALIAS-CHECKPOINT-TOME', type: 'equals', path: 'actors.owner.warlockPacts.tome.ownerActorId', value: 'owner' },
          { id: 'ALIAS-CHECKPOINT-OBJECT', type: 'equals', path: 'objects.object:source-owned.heldByActorId', value: 'owner' },
        ],
      },
      {
        do: 'startTurn', actor: 'familiar', assertions: [
          { id: 'ALIAS-FAMILIAR-SELF', type: 'equals', path: 'actors.familiar.familiarState.actorId', value: 'familiar' },
          { id: 'ALIAS-FAMILIAR-METADATA', type: 'equals', path: 'actors.familiar.familiarMetadata.ownerActorId', value: 'owner' },
        ],
      },
      {
        do: 'endTurn', actor: 'familiar', assertions: [
          { id: 'ALIAS-FAMILIAR-END', type: 'event', eventType: 'turn_ended', exactly: 1 },
        ],
      },
    ],
    requiredTrace: [],
  };
}

const spec: ScenarioSpec = {
  schemaVersion: 1,
  id: 'micro.synthetic.fighter-wizard',
  ruleset: RULESET,
  actors: { fighter: { fixtureId: 'fighter-l1' }, wizard: { fixtureId: 'wizard-l1' } },
  initiative: ['fighter', 'wizard'],
  rollTape: [
    { label: 'athletics', sides: 20, value: 10 },
    { label: 'strike attack', sides: 20, value: 15 },
    { label: 'strike damage', sides: 6, value: 3 },
    { label: 'poison damage', sides: 6, value: 5 },
  ],
  steps: [
    { do: 'startTurn', actor: 'fighter', assertions: [
      {
        id: 'SC-TURN-FIGHTER-START',
        type: 'event',
        match: {
          payloadType: 'EngineEventRecorded',
          engineEventType: 'turn_started',
          sourceActorId: 'fighter',
          actorId: 'fighter',
          targetIds: [],
          obligationIds: ['system:turn-start'],
          payloadSubset: { event: { type: 'turn_started' } },
        },
        exactly: 1,
      },
      {
        id: 'SC-TURN-FIGHTER-ORDER',
        type: 'eventOrder',
        contiguous: true,
        matchers: [
          { payloadType: 'SceneSet', sourceActorId: 'fighter' },
          { payloadType: 'CommandCommitted', sourceActorId: 'fighter' },
        ],
      },
    ] },
    {
      do: 'abilityCheck', actor: 'fighter', ability: 'str', skill: 'athletics', dc: 12,
      assertions: [{
        id: 'SC-CHECK-ATHLETICS',
        type: 'event',
        match: {
          engineEventType: 'roll',
          sourceActorId: 'fighter',
          actorId: 'fighter',
          targetIds: [],
          includesObligationIds: ['system:ability-check', 'system:next-roll-effect'],
          roll: { kind: 'check', outcome: 'success' },
          payloadSubset: { event: { type: 'roll', label: 'Проверка (athletics)' } },
        },
        exactly: 1,
      }],
    },
    {
      do: 'use', actor: 'fighter', actionId: 'action.scenario-strike', actionKind: 'nonSpell',
      targets: ['wizard'], factsByTarget: { wizard: near }, assertions: [
        { id: 'SC-ACTION-DAMAGE', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 9 },
        {
          id: 'SC-ACTION-DECLARATION-PROVENANCE',
          type: 'event',
          match: {
            payloadType: 'ActionDeclared',
            sourceActorId: 'fighter',
            actorId: 'fighter',
            targetIds: ['wizard'],
            obligationIds: ['entity:action.scenario-strike', 'system:action-declaration'],
            payloadSubset: {
              actionId: 'action.scenario-strike',
              actionKind: 'nonSpell',
              sourceEntityIds: ['action.scenario-strike'],
            },
          },
          exactly: 1,
        },
        {
          id: 'SC-ACTION-ROLL-SEMANTICS',
          type: 'event',
          match: {
            engineEventType: 'roll',
            sourceActorId: 'fighter',
            actorId: 'fighter',
            targetIds: ['wizard'],
            includesObligationIds: [
              'entity:action.scenario-strike',
              'system:attack-resolution',
            ],
            roll: { kind: 'd20', outcome: 'hit' },
          },
          exactly: 1,
        },
        {
          id: 'SC-ACTION-EVENT-ORDER',
          type: 'eventOrder',
          startIndex: 0,
          matchers: [
            { payloadType: 'ActionDeclared', actorId: 'fighter', targetIds: ['wizard'] },
            { engineEventType: 'roll', actorId: 'fighter', targetIds: ['wizard'], roll: { outcome: 'hit' } },
            { engineEventType: 'damage', actorId: 'fighter', targetIds: ['wizard'] },
            { payloadType: 'CommandCommitted', sourceActorId: 'fighter' },
          ],
        },
      ],
    },
    { do: 'endTurn', actor: 'fighter', assertions: [
      { id: 'SC-TURN-FIGHTER-END', type: 'event', eventType: 'turn_ended' },
    ] },
    { do: 'startTurn', actor: 'wizard', assertions: [
      { id: 'SC-TURN-WIZARD-START', type: 'event', eventType: 'turn_started' },
    ] },
    {
      do: 'use', actor: 'wizard', actionId: 'spell.scenario-poison', actionKind: 'spell',
      targets: ['fighter'], factsByTarget: { fighter: ranged }, spell: { baseLevel: 1 },
      assertions: [
        { id: 'SC-SPELL-DECLARE', type: 'pending', pendingType: 'target_save' },
        { id: 'SC-SPELL-COST', type: 'equals', path: 'actors.wizard.runtime.resources.spell_slot_1', value: 0 },
      ],
    },
    { do: 'checkpointReload', assertions: [
      { id: 'SC-PENDING-RELOAD', type: 'pending', pendingType: 'target_save' },
    ] },
    {
      do: 'resolveDecision', actor: 'fighter', roll: { mode: 'manual', dice: [{ sides: 20, value: 5 }] },
      assertions: [
        {
          id: 'SC-SAVE-FAIL',
          type: 'event',
          match: {
            engineEventType: 'roll',
            sourceActorId: 'fighter',
            actorId: 'fighter',
            targetIds: [],
            includesObligationIds: ['entity:spell.scenario-poison', 'system:target-save'],
            roll: { kind: 'save', outcome: 'fail' },
            payloadSubset: { event: { type: 'roll', label: 'Спасбросок ТЕЛ' } },
          },
          exactly: 1,
        },
        { id: 'SC-CONDITION-APPLIED', type: 'condition', actor: 'fighter', condition: 'poisoned', present: true },
      ],
    },
    { do: 'endTurn', actor: 'wizard', assertions: [
      { id: 'SC-TURN-WIZARD-END', type: 'event', eventType: 'turn_ended' },
    ] },
  ],
  requiredTrace: ['nonSpellAction', 'castSpell', 'applyCondition', 'savingThrow', 'abilityCheck'],
};

describe('JSON-compatible two-actor scenario runner', () => {
  it('rebinds typed actor-owned Pact, familiar, runtime, and object identities through checkpoint/replay', () => {
    const fixtures = ownershipAliasFixtures();
    const object = sourceOwnedObject();
    const specWithOwnership = ownershipAliasSpec(object);
    const run = runScenario(specWithOwnership, {
      getActor: (id) => id === 'provider-key:owner'
        ? fixtures.owner
        : id === 'provider-key:familiar' ? fixtures.familiar : undefined,
      catalog,
    }, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('scenario-alias-ownership'),
    });

    const owner = run.initialState.actors.owner;
    const familiar = run.initialState.actors.familiar;
    const reboundObject = run.initialState.objects[object.id];
    expect(owner.warlockPacts?.blade?.ownerActorId).toBe('owner');
    expect(owner.warlockPacts?.blade?.activeBond?.warlockActorId).toBe('owner');
    expect(owner.warlockPacts?.chain?.ownerActorId).toBe('owner');
    expect(owner.warlockPacts?.chain?.activeFamiliar).toMatchObject({
      actorId: 'familiar', ownerActorId: 'owner',
    });
    expect(owner.warlockPacts?.tome).toMatchObject({
      ownerActorId: 'owner', tome: { ownerActorId: 'owner' },
    });
    expect(owner.runtime.activeEffects[0]).toMatchObject({
      ownerId: 'owner',
      sourceId: 'familiar',
      sourceTurnExpiry: { sourceActorId: 'familiar', ownerActorId: 'owner' },
    });
    expect(familiar.familiarState).toMatchObject({ actorId: 'familiar', ownerActorId: 'owner' });
    expect(familiar.familiarMetadata?.ownerActorId).toBe('owner');
    expect(reboundObject).toMatchObject({
      attunedToActorId: 'owner',
      heldByActorId: 'owner',
      ownerActorId: 'owner',
      carriedByActorId: 'owner',
      sourceActorId: 'owner',
      illumination: { sourceActorId: 'owner' },
      illusion: {
        discernedByActorIds: ['owner', 'familiar'],
        physicallyRevealedToActorIds: ['familiar'],
      },
      prestidigitation: [{ sourceActorId: 'familiar' }],
    });
    const checkpoint = JSON.parse(run.checkpoints[0]) as WorldState;
    expect(checkpoint.actors.owner.warlockPacts?.chain?.activeFamiliar?.ownerActorId).toBe('owner');
    expect(checkpoint.actors.familiar.familiarState?.ownerActorId).toBe('owner');
    expect(checkpoint.objects[object.id].sourceActorId).toBe('owner');
    expect(run.finalState).toEqual(run.replayState);
    expect(run.finalState.actors.owner.warlockPacts).toEqual(run.replayState.actors.owner.warlockPacts);
    expect(run.finalState.objects[object.id]).toEqual(run.replayState.objects[object.id]);

    expect(fixtures.owner.id).toBe(OWNER_FIXTURE_ID);
    expect(fixtures.owner.warlockPacts?.tome?.ownerActorId).toBe(OWNER_FIXTURE_ID);
    expect(fixtures.familiar.familiarState?.ownerActorId).toBe(OWNER_FIXTURE_ID);
    expect(object.sourceActorId).toBe(OWNER_FIXTURE_ID);
  });

  it('fails closed before world creation when a self-owned nested Pact identity belongs to another fixture', () => {
    const fixtures = ownershipAliasFixtures();
    fixtures.owner.warlockPacts!.tome!.ownerActorId = FAMILIAR_FIXTURE_ID;
    expect(() => runScenario(ownershipAliasSpec(sourceOwnedObject()), {
      getActor: (id) => id === 'provider-key:owner'
        ? fixtures.owner
        : id === 'provider-key:familiar' ? fixtures.familiar : undefined,
      catalog,
    }, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('scenario-alias-foreign-owner'),
    })).toThrow(/warlockPacts\.tome\.ownerActorId must be owned by fixture actor owner/);
  });

  it('runs a full round, reloads a pending save and proves event replay equality', () => {
    const run = runScenario(spec, {
      getActor: (id) => id === 'fighter-l1' ? fixture('fighter') : id === 'wizard-l1' ? fixture('wizard') : undefined,
      catalog,
    }, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('scenario-decision'),
    });

    expect(run.checkpoints).toHaveLength(1);
    expect(run.rngConsumed).toBe(spec.rollTape?.length);
    expect(run.rejections).toEqual([]);
    expect(run.observedTrace).toEqual([
      'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
    ]);
    expect(run.assertionIds).toContain('SC-PENDING-RELOAD');
    expect(run.finalState).toEqual(run.replayState);
    expect(run.finalState.actors.wizard.runtime.hp.current).toBe(9);
    expect(run.finalState.actors.fighter.runtime.hp.current).toBe(7);
    expect(run.finalState.actors.fighter.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'poisoned' }) }),
    ]);
    expect(run.finalState.actors.wizard.runtime.resources.spell_slot_1).toBe(0);
  });

  it('executes an expected rejection as a declarative negative lane without mutating state', () => {
    const negativeSpec: ScenarioSpec = {
      ...spec,
      id: 'micro.synthetic.expected-rejection',
      steps: [
        spec.steps[0],
        {
          do: 'use',
          actor: 'fighter',
          actionId: 'action.scenario-strike',
          actionKind: 'nonSpell',
          targets: ['wizard'],
          factsByTarget: { wizard: { ...near, distanceFt: 10 } },
          expectedResult: { status: 'rejected', code: 'OutOfRange', messageIncludes: 'outside 5 ft' },
          assertions: [
            { id: 'SC-REJECT-HP-UNCHANGED', type: 'equals', path: 'actors.wizard.runtime.hp.current', value: 12 },
            {
              id: 'SC-REJECT-NO-DECLARATION',
              type: 'event',
              match: { payloadType: 'ActionDeclared' },
              exactly: 0,
            },
          ],
        },
        ...spec.steps.slice(1),
      ],
    };
    const run = runScenario(negativeSpec, {
      getActor: (id) => id === 'fighter-l1' ? fixture('fighter') : id === 'wizard-l1' ? fixture('wizard') : undefined,
      catalog,
    }, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('scenario-negative'),
    });

    expect(run.rejections).toEqual([
      expect.objectContaining({ step: 2, action: 'use', code: 'OutOfRange' }),
    ]);
    expect(run.rngConsumed).toBe(4);
  });

  it('fails before consuming a tape entry when the engine requests a different die size', () => {
    const [first, ...rest] = spec.rollTape ?? [];
    const wrongSides: ScenarioSpec = {
      ...spec,
      id: 'micro.synthetic.wrong-die',
      rollTape: [{ ...first, sides: 6, value: 4 }, ...rest],
    };
    expect(() => runScenario(wrongSides, {
      getActor: (id) => id === 'fighter-l1' ? fixture('fighter') : id === 'wizard-l1' ? fixture('wizard') : undefined,
      catalog,
    }, {
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('scenario-wrong-die'),
    })).toThrow(/engine requested d20, tape declares d6/);
  });

  it('rejects an acceptance spec that does not contain exactly two actors', () => {
    expect(() => runScenario({
      ...spec,
      id: 'invalid-one-actor',
      actors: { fighter: { fixtureId: 'fighter-l1' } },
      initiative: ['fighter'],
    }, { getActor: () => fixture('fighter'), catalog }, {
      rng: () => 0.5,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(),
    })).toThrow(/exactly two actors/);
  });
});
