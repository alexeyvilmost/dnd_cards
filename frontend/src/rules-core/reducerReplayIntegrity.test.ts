import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';
import {
  createWorld,
  type ActorState,
  type AttackActionState,
  type GrappleState,
  type RuleActionDefinition,
  type RuleEventPayload,
  type RulesCatalog,
  type WorldState,
} from './domain';
import { castFindFamiliar, type FamiliarState } from './findFamiliar';
import {
  materializeCanonicalFamiliarActor,
  pactChainProjection,
} from './familiarRuntime';
import {
  planPactBladeAttackProjection,
  planPactBladeBondTransition,
  planPactBladeMaterialFocus,
  type PactBladeItemWorldObject,
} from './pactBladeWorldAdapter';
import {
  planPactTomeOwnerDeathTransition,
  planPactTomeRestTransition,
} from './pactTomeWorldAdapter';
import { evolve } from './reducer';
import {
  createPactBladeInvocationState,
  createPactChainInvocationState,
} from './warlockPacts';
import {
  PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
} from './testing/pactBladePolicyFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'reducer-replay-integrity@1',
  contentHash: 'sha256:reducer-replay-integrity',
  errataVersion: 'phb-2024-v1',
};

const OWNER = 'actor:owner';
const SUPPORT = 'actor:support';
const SUPPORT_TWO = 'actor:support-two';
const FAMILIAR = 'actor:owner:familiar';
const SUMMON_ACTION = 'action:find-familiar';
const BASE_SOURCE = 'spell:find-familiar';
const CHAIN_SOURCE = 'effect:pact-chain';

const BLADE_ACTOR = 'actor:blade-warlock';
const BLADE_SOURCE = 'effect:pact-blade';
const BOND_ACTION = 'action:pact-blade';
const BLADE_CARD = 'card:pact-dagger';
const BLADE_OBJECT = 'object:pact-dagger';
const MATERIAL_SPELL = 'spell:material-test';

const TOME_ACTOR = 'actor:tome-warlock';
const TOME_SOURCE = 'effect:pact-tome';
const TOME_CANTRIPS = ['guidance', 'light', 'minor-illusion'] as const;
const TOME_RITUALS = ['detect-magic', 'identify'] as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actor(id: string, actionIds: string[] = []): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    lifecycle: { status: 'alive' },
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['fixture:attack-profile'],
    },
  };
}

function baseWorld(actors: ActorState[] = [actor(OWNER, [SUMMON_ACTION]), actor(SUPPORT)]): WorldState {
  return createWorld({ id: 'world:reducer-replay', ruleset: RULESET, actors });
}

function familiarBundle(input: {
  actorId?: string;
  chain?: boolean;
  owner?: ActorState;
} = {}): { owner: ActorState; familiar: ActorState } {
  const owner = input.owner ?? actor(OWNER, [SUMMON_ACTION]);
  const actorId = input.actorId ?? FAMILIAR;
  const chain = input.chain ?? false;
  const familiarState = castFindFamiliar({
    familiarActorId: actorId,
    ownerActorId: owner.id,
    policy: chain
      ? { kind: 'pact_chain', sourceEntityId: CHAIN_SOURCE }
      : { kind: 'base', sourceEntityId: BASE_SOURCE },
    method: chain ? 'pact_chain_magic_action' : 'ritual',
    formId: chain ? 'imp' : 'owl',
    spiritType: 'fey',
    resources: { level1SpellSlots: 1, incenseGp: 10 },
    incenseOfferingGp: 10,
    materialCostGp: 10,
    baseCastingTimeSeconds: 3_600,
    mechanicsPolicy: { connectionRangeFt: 100, reappearRangeFt: 30, ritualCastingAddedSeconds: 600 },
    existingFamiliar: null,
  }).familiar;
  const familiar = materializeCanonicalFamiliarActor({
    familiar: familiarState,
    owner,
    summoningActionId: SUMMON_ACTION,
  });
  if (chain) {
    const invocation = createPactChainInvocationState({
      sourceEntityId: CHAIN_SOURCE,
      ownerActorId: owner.id,
      findFamiliarActionId: SUMMON_ACTION,
    });
    invocation.activeFamiliar = pactChainProjection(familiarState);
    owner.warlockPacts = { ...owner.warlockPacts, chain: invocation };
  }
  return { owner, familiar };
}

function upsertEvent(
  owner: ActorState,
  familiar: ActorState,
  created = true,
): Extract<RuleEventPayload, { type: 'FamiliarActorUpserted' }> {
  const state = familiar.familiarState;
  if (!state || !familiar.familiarMetadata) throw new Error('Fixture requires a familiar actor');
  return {
    type: 'FamiliarActorUpserted',
    ownerActorId: owner.id,
    actor: copy(familiar),
    casting: {
      actionId: familiar.familiarMetadata.summoningActionId,
      method: state.extension === 'pact_chain' ? 'pact_chain_magic_action' : 'ritual',
      consumedIncenseGp: 10,
      created,
      changedForm: !created,
    },
  };
}

function changedEvent(
  familiar: ActorState,
  next: FamiliarState,
  droppedItemIds?: string[],
): Extract<RuleEventPayload, { type: 'FamiliarStateChanged' }> {
  return {
    type: 'FamiliarStateChanged',
    ownerActorId: next.ownerActorId,
    familiarActorId: familiar.id,
    familiar: copy(next),
    ...(droppedItemIds === undefined ? {} : { droppedItemIds }),
    reason: next.presence === 'present' ? 'reappeared' : 'temporary_dismissal',
  };
}

function removedEvent(
  familiar: ActorState,
  droppedItemIds: string[] = [],
): Extract<RuleEventPayload, { type: 'FamiliarActorRemoved' }> {
  return {
    type: 'FamiliarActorRemoved',
    ownerActorId: familiar.familiarState!.ownerActorId,
    familiarActorId: familiar.id,
    reason: 'forever_dismissal',
    droppedItemIds,
  };
}

function withEncounter(
  world: WorldState,
  initiative: string[],
  activeIndex = 0,
): WorldState {
  return {
    ...world,
    scene: { mode: 'encounter', initiative, activeIndex, round: 1, turnStarted: true },
  };
}

function familiarWorld(input: {
  chain?: boolean;
  initiative?: string[];
  activeIndex?: number;
  includeFamiliar?: boolean;
} = {}): { world: WorldState; owner: ActorState; familiar: ActorState } {
  const bundle = familiarBundle({ chain: input.chain });
  const actors = [bundle.owner, actor(SUPPORT), actor(SUPPORT_TWO)];
  if (input.includeFamiliar !== false) actors.push(bundle.familiar);
  let world = baseWorld(actors);
  if (input.initiative) world = withEncounter(world, input.initiative, input.activeIndex);
  return { world, ...bundle };
}

function pocketState(familiar: ActorState): FamiliarState {
  return {
    ...copy(familiar.familiarState!),
    presence: 'pocket_dimension',
    sharedSenses: null,
    carriedItemIds: [],
    wornItemIds: [],
  };
}

function deathEvent(world: WorldState): Extract<RuleEventPayload, { type: 'ActorDeathAdjudicated' }> {
  return {
    type: 'ActorDeathAdjudicated',
    provenance: 'canonical_actor_lifecycle',
    factId: 'fact:death',
    actorId: OWNER,
    adjudicatedBy: 'gm:reducer-test',
    observedAtWorldRevision: world.revision,
    rulesetContentHash: world.ruleset.contentHash,
  };
}

function attackAction(actorId: string, status: AttackActionState['status']): AttackActionState {
  return {
    id: `attack:${actorId}:${status}`,
    actorId,
    startedAtRevision: 0,
    turnKey: 'turn:1',
    status,
    sequence: {
      id: `attack:${actorId}:${status}`,
      actorId,
      totalAttacks: 1,
      attacksRemaining: 1,
      entries: [],
      usedReplacementKeys: [],
    },
  };
}

function grapple(grapplerActorId: string, targetActorId: string): GrappleState {
  return {
    id: `grapple:${grapplerActorId}:${targetActorId}`,
    grapplerActorId,
    targetActorId,
    sourcePart: 'main_hand',
    escapeDc: 10,
    reachFt: 5,
    sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
    startedAtRevision: 0,
  };
}

function pactCard(): Card {
  return withDeclaredTestWeaponProfile({
    id: BLADE_CARD,
    card_number: 'CARD-pact-dagger',
    name: 'Pact Dagger',
    type: 'weapon',
    weapon_type: 'dagger',
    damage_type: 'piercing',
    bonus_type: 'damage',
    bonus_value: '1d4',
    properties: ['finesse', 'light'],
    tags: ['simple', 'melee'],
    description: '',
    rarity: 'common',
    is_template: 'false',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  }, {
    weaponType: 'dagger', proficiencyCategory: 'simple', attackAbility: 'finesse',
    damageLines: [{ dice: '1d4', type: 'piercing' }],
    defaultAttackMode: 'melee', attackModes: [
      { kind: 'melee', reach_ft: 5 },
      { kind: 'ranged', normal_ft: 20, long_ft: 60 },
    ],
    properties: ['finesse', 'light', 'thrown'], masteryEffectId: 'effect:test:nick',
  });
}

function bladeActor(): ActorState {
  const invocation = createPactBladeInvocationState({
    sourceEntityId: BLADE_SOURCE,
    ownerActorId: BLADE_ACTOR,
    bondActionId: BOND_ACTION,
    lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  });
  const value = actor(BLADE_ACTOR, [BOND_ACTION, MATERIAL_SPELL]);
  value.capabilities.featureSources = {
    'warlock.pact.blade': [BLADE_SOURCE, 'EFF-pact-blade', 'CLASS-warlock'],
  };
  value.runtime.resources = { action: 1, bonus_action: 1, reaction: 1 };
  value.runtime.maxResources = { action: 1, bonus_action: 1, reaction: 1 };
  value.warlockPacts = { blade: invocation };
  return value;
}

function bladeCatalog(): RulesCatalog & { getCard(id: string): Card | undefined } {
  const bond: RuleActionDefinition = {
    id: BOND_ACTION,
    name: 'Pact of the Blade',
    kind: 'nonSpell',
    sourceEntityIds: [BLADE_SOURCE, 'EFF-pact-blade'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      primitive: {
        type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade',
        policy: PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
      },
    },
  };
  const material: RuleActionDefinition = {
    id: MATERIAL_SPELL,
    name: 'Material Test Spell',
    kind: 'spell',
    sourceEntityIds: ['fixture:material-spell'],
    spell: {
      level: 1,
      sourceClass: 'CLASS-warlock',
      components: { verbal: true, somatic: true, material: true },
    },
    mechanics: {},
  };
  const actions = [bond, material];
  const card = pactCard();
  return {
    getAction: (id) => actions.find((entry) => entry.id === id),
    getCard: (id) => id === card.id ? card : undefined,
  };
}

function bondedBladeFixture(): {
  world: WorldState;
  attack: Extract<RuleEventPayload, { type: 'PactBladeAttackProjected' }>;
  focus: Extract<RuleEventPayload, { type: 'PactBladeMaterialFocusProjected' }>;
} {
  const catalog = bladeCatalog();
  const before = createWorld({
    id: 'world:pact-blade-reducer',
    ruleset: RULESET,
    actors: [bladeActor(), actor(SUPPORT)],
  });
  const bond = planPactBladeBondTransition({
    world: before,
    catalog,
    actorId: BLADE_ACTOR,
    commandId: 'command:bond',
    selection: {
      mode: 'conjure',
      weaponCardId: BLADE_CARD,
      weaponObjectId: BLADE_OBJECT,
      conjureHand: 'main_hand',
    },
  });
  if (bond.status === 'rejected') throw new Error(`${bond.code}: ${bond.message}`);
  const world = evolve(before, bond.event);
  const attack = planPactBladeAttackProjection({
    world,
    catalog,
    actorId: BLADE_ACTOR,
    commandId: 'command:attack-projection',
    selection: {
      weaponObjectId: BLADE_OBJECT,
      hand: 'main_hand',
      abilityChoice: 'cha',
      damageType: 'radiant',
    },
  });
  if (attack.status === 'rejected') throw new Error(`${attack.code}: ${attack.message}`);
  const focus = planPactBladeMaterialFocus({
    world,
    catalog,
    actorId: BLADE_ACTOR,
    commandId: 'command:focus-projection',
    actionId: MATERIAL_SPELL,
    weaponObjectId: BLADE_OBJECT,
    hand: 'main_hand',
  });
  if (focus.status === 'rejected') throw new Error(`${focus.code}: ${focus.message}`);
  return { world, attack: attack.event, focus: focus.event };
}

function tomeAction(id: string, level: number, ritual: boolean): RuleActionDefinition {
  return {
    id: `${id}@${TOME_SOURCE}`,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`spell:${id}`, TOME_SOURCE],
    spell: {
      level,
      sourceClass: 'CLASS-warlock',
      ritual,
      classListIds: level === 0 ? ['CLASS-cleric'] : ['CLASS-wizard'],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{ resolution: 'auto', result: [] }],
    },
  } as RuleActionDefinition;
}

function activeTomeFixture(): {
  world: WorldState;
  death: Extract<RuleEventPayload, { type: 'PactTomeOwnerDied' }>;
} {
  const owner = actor(TOME_ACTOR);
  owner.capabilities.actionIds = ['core.action.hide'];
  owner.capabilities.featureSources = {
    'warlock.pact.tome': [TOME_SOURCE, 'EFF-pact-tome', 'CLASS-warlock'],
  };
  owner.runtime.resources = { spell_slot_1: 1 };
  owner.runtime.maxResources = { spell_slot_1: 1 };
  owner.spellcastingAccess = {
    grants: [{
      grantId: 'grant:warlock:fixture',
      actionId: 'spell:warlock-fixture',
      sourceId: 'CLASS-warlock',
      access: 'known',
      level: 1,
      spellcastingAbility: 'cha',
      slotResource: 'spell_slot_1',
    }],
    preparedSources: {},
  };
  const actions = [
    ...TOME_CANTRIPS.map((id) => tomeAction(id, 0, false)),
    ...TOME_RITUALS.map((id) => tomeAction(id, 1, true)),
  ];
  const catalog: RulesCatalog = {
    getAction: (id) => actions.find((entry) => entry.id === id),
  };
  const initial = createWorld({
    id: 'world:pact-tome-reducer',
    ruleset: RULESET,
    actors: [owner, actor(SUPPORT)],
  });
  const rest = planPactTomeRestTransition({
    world: initial,
    catalog,
    actorId: TOME_ACTOR,
    commandId: 'command:tome-rest',
    rest: 'short',
    selection: {
      bookObjectId: 'object:book-of-shadows',
      cantripActionIds: TOME_CANTRIPS.map((id) => `${id}@${TOME_SOURCE}`),
      ritualActionIds: TOME_RITUALS.map((id) => `${id}@${TOME_SOURCE}`),
    },
  });
  if (rest.status === 'rejected') throw new Error(`${rest.code}: ${rest.message}`);
  const world = { ...evolve(initial, rest.event), revision: rest.event.revision };
  const death = planPactTomeOwnerDeathTransition({
    world,
    catalog,
    actorId: TOME_ACTOR,
    commandId: 'command:tome-owner-death',
    deathFact: {
      type: 'ActorDeathAdjudicated',
      provenance: 'canonical_actor_lifecycle',
      factId: 'fact:tome-owner-death',
      actorId: TOME_ACTOR,
      adjudicatedBy: 'gm:reducer-test',
      observedAtWorldRevision: world.revision,
      rulesetContentHash: world.ruleset.contentHash,
    },
  });
  if (death.status === 'rejected') throw new Error(`${death.code}: ${death.message}`);
  return { world, death: death.event };
}

describe('reducer fail-closed replay authority', () => {
  it('rejects a replayed world object whose attunement owner is not a world actor', () => {
    expect(() => evolve(baseWorld(), {
      type: 'WorldObjectMutationRecorded',
      event: {
        type: 'WorldObjectCreated',
        object: {
          id: 'object:foreign-attunement',
          name: 'Foreign Attuned Item',
          kind: 'item',
          size: 'small',
          itemCardId: 'card:test-item',
          attunedToActorId: 'actor:not-in-world',
        },
      },
    })).toThrow(/attunement owner is not a world actor/);
  });

  it('accepts one exact death fact and rejects every malformed identity or authority field', () => {
    const world = baseWorld();
    const valid = deathEvent(world);
    const dead = evolve(world, valid);
    expect(dead.actors[OWNER].lifecycle).toEqual({
      status: 'dead',
      adjudication: valid,
    });
    expect(dead.actors[OWNER].lifecycle).not.toBe(valid);

    const missing = copy(world);
    delete missing.actors[OWNER];
    expect(() => evolve(missing, valid)).toThrow(/non-living actor/);
    expect(() => evolve(dead, valid)).toThrow(/non-living actor/);
    const withoutLifecycle = copy(world);
    delete withoutLifecycle.actors[OWNER].lifecycle;
    expect(() => evolve(withoutLifecycle, valid)).toThrow(/non-living actor/);

    const invalid = [
      { ...valid, provenance: 'forged' },
      { ...valid, factId: '' },
      { ...valid, factId: ' fact:death ' },
      { ...valid, adjudicatedBy: '' },
      { ...valid, adjudicatedBy: ' gm ' },
      { ...valid, observedAtWorldRevision: world.revision + 1 },
      { ...valid, rulesetContentHash: 'sha256:forged' },
    ];
    for (const payload of invalid) {
      expect(() => evolve(world, payload as RuleEventPayload)).toThrow(/invalid lifecycle authority/);
    }
  });

  it('enforces familiar upsert identity, ownership, casting, catalog, and Chain projection', () => {
    const base = familiarBundle();
    const absent = baseWorld([base.owner, actor(SUPPORT), actor(SUPPORT_TWO)]);
    const event = upsertEvent(base.owner, base.familiar);
    const created = evolve(absent, event);
    expect(created.actors[FAMILIAR].lifecycle).toEqual({ status: 'alive' });

    const withLifecycle = copy(event);
    withLifecycle.actor.lifecycle = { status: 'alive' };
    expect(evolve(absent, withLifecycle).actors[FAMILIAR].lifecycle).toEqual({ status: 'alive' });

    const invalidCases: Array<[
      string,
      (world: WorldState, payload: typeof event) => void,
    ]> = [
      ['missing owner', (world) => { delete world.actors[OWNER]; }],
      ['missing state', (_world, payload) => { delete payload.actor.familiarState; }],
      ['foreign state owner', (_world, payload) => { payload.actor.familiarState!.ownerActorId = SUPPORT; }],
      ['foreign state actor', (_world, payload) => { payload.actor.familiarState!.actorId = SUPPORT; }],
      ['foreign action', (_world, payload) => { payload.casting.actionId = 'action:forged'; }],
      ['invalid incense', (_world, payload) => {
        (payload.casting as { consumedIncenseGp: number }).consumedIncenseGp = 0;
      }],
      ['wrong created flag', (_world, payload) => { payload.casting.created = false; }],
      ['wrong method', (_world, payload) => { payload.casting.method = 'pact_chain_magic_action'; }],
    ];
    for (const [label, mutate] of invalidCases) {
      const world = copy(absent);
      const payload = copy(event);
      mutate(world, payload);
      expect(() => evolve(world, payload), label).toThrow(/Invalid familiar upsert/);
    }

    const malformedActor = copy(event);
    malformedActor.actor.kind = 'playerCharacter';
    expect(() => evolve(absent, malformedActor)).toThrow(/summonedActor/);

    const other = familiarBundle({ actorId: 'actor:owner:other-familiar', owner: copy(base.owner) });
    const duplicateWorld = baseWorld([base.owner, actor(SUPPORT), other.familiar]);
    expect(() => evolve(duplicateWorld, event)).toThrow(/already owns familiar/);

    const recastWorld = baseWorld([base.owner, actor(SUPPORT), base.familiar]);
    expect(evolve(recastWorld, upsertEvent(base.owner, base.familiar, false)).actors[FAMILIAR])
      .toMatchObject(base.familiar);

    const chain = familiarBundle({ chain: true });
    const noInvocationOwner = actor(OWNER, [SUMMON_ACTION]);
    const noInvocationWorld = baseWorld([noInvocationOwner, actor(SUPPORT)]);
    expect(() => evolve(noInvocationWorld, upsertEvent(noInvocationOwner, chain.familiar)))
      .toThrow(/has no Pact Chain state/);
    const wrongChainMethod = upsertEvent(chain.owner, chain.familiar);
    wrongChainMethod.casting.method = 'ritual';
    expect(() => evolve(baseWorld([chain.owner, actor(SUPPORT)]), wrongChainMethod))
      .toThrow(/Invalid familiar upsert/);
    expect(evolve(
      baseWorld([chain.owner, actor(SUPPORT)]),
      upsertEvent(chain.owner, chain.familiar),
    ).actors[OWNER].warlockPacts?.chain?.activeFamiliar?.actorId).toBe(FAMILIAR);

    const ownerWithUnrelatedChain = copy(base.owner);
    const unrelatedChain = createPactChainInvocationState({
      sourceEntityId: CHAIN_SOURCE,
      ownerActorId: OWNER,
      findFamiliarActionId: SUMMON_ACTION,
    });
    unrelatedChain.activeFamiliar = {
      ...pactChainProjection(base.familiar.familiarState!),
      actorId: 'actor:unrelated-familiar',
    };
    ownerWithUnrelatedChain.warlockPacts = { chain: unrelatedChain };
    expect(evolve(
      baseWorld([ownerWithUnrelatedChain, actor(SUPPORT)]),
      upsertEvent(ownerWithUnrelatedChain, base.familiar),
    ).actors[OWNER].warlockPacts?.chain?.activeFamiliar?.actorId).toBe('actor:unrelated-familiar');

    const ownerWithStaleChain = copy(ownerWithUnrelatedChain);
    ownerWithStaleChain.warlockPacts!.chain!.activeFamiliar = pactChainProjection(
      base.familiar.familiarState!,
    );
    expect(evolve(
      baseWorld([ownerWithStaleChain, actor(SUPPORT)]),
      upsertEvent(ownerWithStaleChain, base.familiar),
    ).actors[OWNER].warlockPacts?.chain?.activeFamiliar).toBeNull();
  });

  it('requires explicit familiar Initiative and inserts a present familiar deterministically', () => {
    const base = familiarBundle();
    const event = upsertEvent(base.owner, base.familiar);

    const ownerPresent = withEncounter(
      baseWorld([base.owner, actor(SUPPORT), actor(SUPPORT_TWO)]),
      [OWNER, SUPPORT],
    );
    expect(() => evolve(ownerPresent, event)).toThrow(/requires its own Initiative/);

    const rolled = copy(base.familiar);
    rolled.familiarState!.initiative = { mode: 'own', d20Roll: 12, modifier: 1, total: 13 };
    const rolledEvent = upsertEvent(base.owner, rolled);
    expect((evolve(ownerPresent, rolledEvent).scene as { initiative: string[] }).initiative)
      .toEqual([OWNER, FAMILIAR, SUPPORT]);

    const ownerOutside = withEncounter(
      baseWorld([base.owner, actor(SUPPORT), actor(SUPPORT_TWO)]),
      [SUPPORT, SUPPORT_TWO],
    );
    expect((evolve(ownerOutside, rolledEvent).scene as { initiative: string[] }).initiative)
      .toEqual([SUPPORT, SUPPORT_TWO, FAMILIAR]);

    const alreadyPresent = withEncounter(
      baseWorld([base.owner, actor(SUPPORT), rolled]),
      [OWNER, FAMILIAR, SUPPORT],
    );
    expect(evolve(alreadyPresent, upsertEvent(base.owner, rolled, false)).scene)
      .toBe(alreadyPresent.scene);

    const pocket = copy(rolled);
    pocket.familiarState = pocketState(pocket);
    expect(evolve(ownerPresent, upsertEvent(base.owner, pocket)).scene).toBe(ownerPresent.scene);
    expect(evolve(baseWorld([base.owner, actor(SUPPORT)]), event).scene)
      .toEqual({ mode: 'exploration' });
  });

  it('rejects forged familiar state transitions and validates the exact sorted drop projection', () => {
    const fixture = familiarWorld();
    const present = copy(fixture.familiar.familiarState!);
    const valid = changedEvent(fixture.familiar, present);
    expect(evolve(fixture.world, valid).actors[FAMILIAR].runtime.resources.reaction).toBe(1);

    const unavailable = copy(present);
    unavailable.reactionAvailable = false;
    expect(evolve(fixture.world, changedEvent(fixture.familiar, unavailable))
      .actors[FAMILIAR].runtime.resources.reaction).toBe(0);

    const invalidCases: Array<[
      string,
      (world: WorldState, payload: typeof valid) => void,
    ]> = [
      ['missing actor', (world) => { delete world.actors[FAMILIAR]; }],
      ['missing state', (world) => { delete world.actors[FAMILIAR].familiarState; }],
      ['missing metadata', (world) => { delete world.actors[FAMILIAR].familiarMetadata; }],
      ['missing owner', (world) => { delete world.actors[OWNER]; }],
      ['foreign current owner', (world) => {
        world.actors[FAMILIAR].familiarState!.ownerActorId = SUPPORT;
      }],
      ['foreign payload actor', (_world, payload) => { payload.familiar.actorId = SUPPORT; }],
      ['foreign payload owner', (_world, payload) => { payload.familiar.ownerActorId = SUPPORT; }],
    ];
    for (const [label, mutate] of invalidCases) {
      const world = copy(fixture.world);
      const payload = copy(valid);
      mutate(world, payload);
      expect(() => evolve(world, payload), label).toThrow(/Invalid familiar state transition/);
    }

    const forgedActor = copy(fixture.world);
    forgedActor.actors[FAMILIAR].kind = 'playerCharacter';
    expect(() => evolve(forgedActor, valid)).toThrow(/summonedActor/);

    const carrying = copy(fixture);
    carrying.familiar.familiarState!.carriedItemIds = ['item:z', 'item:a'];
    carrying.familiar.familiarState!.wornItemIds = ['item:m'];
    carrying.world.actors[FAMILIAR] = carrying.familiar;
    const pocket = pocketState(carrying.familiar);
    expect(() => evolve(carrying.world, changedEvent(
      carrying.familiar,
      pocket,
      ['item:z', 'item:a', 'item:m'],
    ))).toThrow(/invalid lifecycle dropped-item projection/);
    const dropped = evolve(carrying.world, changedEvent(
      carrying.familiar,
      pocket,
      ['item:a', 'item:m', 'item:z'],
    ));
    expect(dropped.actors[FAMILIAR].familiarState?.presence).toBe('pocket_dimension');
  });

  it('removes familiars from every Initiative position without corrupting the active turn', () => {
    const cases = [
      { initiative: [FAMILIAR, OWNER, SUPPORT], activeIndex: 2, expectedIndex: 1 },
      { initiative: [OWNER, FAMILIAR, SUPPORT], activeIndex: 1, expectedIndex: 1 },
      { initiative: [OWNER, FAMILIAR, SUPPORT], activeIndex: 0, expectedIndex: 0 },
    ];
    for (const row of cases) {
      const fixture = familiarWorld({ initiative: row.initiative, activeIndex: row.activeIndex });
      const next = evolve(
        fixture.world,
        changedEvent(fixture.familiar, pocketState(fixture.familiar)),
      );
      expect(next.scene).toMatchObject({
        initiative: row.initiative.filter((id) => id !== FAMILIAR),
        activeIndex: row.expectedIndex,
      });
    }

    const absent = familiarWorld({ initiative: [OWNER, SUPPORT], activeIndex: 0 });
    expect(evolve(
      absent.world,
      changedEvent(absent.familiar, pocketState(absent.familiar)),
    ).scene).toBe(absent.world.scene);

    const exploration = familiarWorld();
    expect(evolve(
      exploration.world,
      changedEvent(exploration.familiar, pocketState(exploration.familiar)),
    ).scene).toEqual({ mode: 'exploration' });

    const invalid = familiarWorld({ initiative: [OWNER, FAMILIAR], activeIndex: 1 });
    expect(() => evolve(
      invalid.world,
      changedEvent(invalid.familiar, pocketState(invalid.familiar)),
    )).toThrow(/cannot invalidate Initiative/);
  });

  it('rejects unsafe permanent dismissals and clears base or Chain ownership atomically', () => {
    const fixture = familiarWorld();
    const event = removedEvent(fixture.familiar);
    const invalidCases: Array<[
      string,
      (world: WorldState, payload: typeof event) => void,
    ]> = [
      ['missing actor', (world) => { delete world.actors[FAMILIAR]; }],
      ['missing state', (world) => { delete world.actors[FAMILIAR].familiarState; }],
      ['missing owner', (world) => { delete world.actors[OWNER]; }],
      ['foreign owner', (world) => { world.actors[FAMILIAR].familiarState!.ownerActorId = SUPPORT; }],
      ['wrong reason', (_world, payload) => {
        (payload as { reason: string }).reason = 'temporary_dismissal';
      }],
      ['open attack', (world) => {
        const attack = attackAction(FAMILIAR, 'open');
        world.attackActions[attack.id] = attack;
      }],
      ['grappler', (world) => {
        const active = grapple(FAMILIAR, SUPPORT);
        world.grapples[active.id] = active;
      }],
      ['target', (world) => {
        const active = grapple(SUPPORT, FAMILIAR);
        world.grapples[active.id] = active;
      }],
    ];
    for (const [label, mutate] of invalidCases) {
      const world = copy(fixture.world);
      const payload = copy(event);
      mutate(world, payload);
      expect(() => evolve(world, payload), label).toThrow(/Invalid permanent familiar dismissal/);
    }

    const activeButForeign = copy(fixture.world);
    const supportAttack = attackAction(SUPPORT, 'open');
    const closedFamiliarAttack = attackAction(FAMILIAR, 'completed');
    activeButForeign.attackActions[supportAttack.id] = supportAttack;
    activeButForeign.attackActions[closedFamiliarAttack.id] = closedFamiliarAttack;
    const unrelated = grapple(SUPPORT, SUPPORT_TWO);
    activeButForeign.grapples[unrelated.id] = unrelated;
    expect(evolve(activeButForeign, event).actors[FAMILIAR]).toBeUndefined();

    const carrying = copy(fixture);
    carrying.familiar.familiarState!.carriedItemIds = ['item:z', 'item:a'];
    carrying.familiar.familiarState!.wornItemIds = ['item:m'];
    carrying.world.actors[FAMILIAR] = carrying.familiar;
    expect(() => evolve(carrying.world, removedEvent(carrying.familiar, ['item:z'])))
      .toThrow(/invalid dropped-item projection/);
    expect(evolve(
      carrying.world,
      removedEvent(carrying.familiar, ['item:a', 'item:m', 'item:z']),
    ).actors[FAMILIAR]).toBeUndefined();

    const chain = familiarWorld({ chain: true });
    expect(evolve(chain.world, removedEvent(chain.familiar))
      .actors[OWNER].warlockPacts?.chain?.activeFamiliar).toBeNull();

    const baseWithStaleChain = familiarWorld();
    const invocation = createPactChainInvocationState({
      sourceEntityId: CHAIN_SOURCE,
      ownerActorId: OWNER,
      findFamiliarActionId: SUMMON_ACTION,
    });
    invocation.activeFamiliar = pactChainProjection(baseWithStaleChain.familiar.familiarState!);
    baseWithStaleChain.world.actors[OWNER].warlockPacts = { chain: invocation };
    expect(evolve(baseWithStaleChain.world, removedEvent(baseWithStaleChain.familiar))
      .actors[OWNER].warlockPacts?.chain?.activeFamiliar).toBeNull();
  });

  it('validates every Pact Blade attack projection field against the active Card/Object bond', () => {
    const fixture = bondedBladeFixture();
    expect(evolve(fixture.world, fixture.attack)).toBe(fixture.world);
    const cases: Array<[
      string,
      (world: WorldState, payload: typeof fixture.attack) => void,
    ]> = [
      ['missing actor', (world) => { delete world.actors[BLADE_ACTOR]; }],
      ['missing invocation', (world) => { delete world.actors[BLADE_ACTOR].warlockPacts; }],
      ['missing bond', (world) => {
        world.actors[BLADE_ACTOR].warlockPacts!.blade!.activeBond = null;
      }],
      ['revision', (_world, payload) => { payload.revision += 1; }],
      ['world revision', (_world, payload) => { payload.worldRevision += 1; }],
      ['ruleset hash', (_world, payload) => { payload.rulesetContentHash = 'sha256:forged'; }],
      ['source', (_world, payload) => { payload.sourceEntityId = 'effect:forged'; }],
      ['capability', (world) => { delete world.actors[BLADE_ACTOR].capabilities.featureSources; }],
      ['object id', (_world, payload) => { payload.weaponObjectId = 'object:forged'; }],
      ['card id', (_world, payload) => { payload.weaponCardId = 'card:forged'; }],
      ['missing object', (world) => { delete world.objects[BLADE_OBJECT]; }],
      ['object card', (world) => {
        (world.objects[BLADE_OBJECT] as PactBladeItemWorldObject).itemCardId = 'card:forged';
      }],
      ['ability', (_world, payload) => {
        (payload.projection as { attackAbility: string }).attackAbility = 'wis';
      }],
      ['damage ability', (_world, payload) => {
        (payload.projection as { damageAbility: string }).damageAbility = 'str';
      }],
      ['damage type', (_world, payload) => { payload.projection.damageType = ''; }],
      ['proficiency', (_world, payload) => { payload.projection.proficient = false as true; }],
      ['focus', (_world, payload) => { payload.projection.spellcastingFocus = false as true; }],
    ];
    for (const [label, mutate] of cases) {
      const world = copy(fixture.world);
      const payload = copy(fixture.attack);
      mutate(world, payload);
      expect(() => evolve(world, payload), label).toThrow(/attack projection diverges/);
    }
  });

  it('validates every Pact Blade material-focus projection field against the held bond', () => {
    const fixture = bondedBladeFixture();
    expect(evolve(fixture.world, fixture.focus)).toBe(fixture.world);
    const cases: Array<[
      string,
      (world: WorldState, payload: typeof fixture.focus) => void,
    ]> = [
      ['missing actor', (world) => { delete world.actors[BLADE_ACTOR]; }],
      ['missing invocation', (world) => { delete world.actors[BLADE_ACTOR].warlockPacts; }],
      ['missing bond', (world) => {
        world.actors[BLADE_ACTOR].warlockPacts!.blade!.activeBond = null;
      }],
      ['revision', (_world, payload) => { payload.revision += 1; }],
      ['world revision', (_world, payload) => { payload.worldRevision += 1; }],
      ['ruleset hash', (_world, payload) => { payload.rulesetContentHash = 'sha256:forged'; }],
      ['source', (_world, payload) => { payload.sourceEntityId = 'effect:forged'; }],
      ['object id', (_world, payload) => { payload.weaponObjectId = 'object:forged'; }],
      ['card id', (_world, payload) => { payload.weaponCardId = 'card:forged'; }],
      ['missing object', (world) => { delete world.objects[BLADE_OBJECT]; }],
      ['object card', (world) => {
        (world.objects[BLADE_OBJECT] as PactBladeItemWorldObject).itemCardId = 'card:forged';
      }],
      ['holder', (world) => { world.objects[BLADE_OBJECT].heldByActorId = SUPPORT; }],
      ['hand', (world) => { world.objects[BLADE_OBJECT].heldInHand = 'off_hand'; }],
      ['material', (_world, payload) => { payload.components.material = false as true; }],
      ['replace material', (_world, payload) => {
        payload.replacesMaterialComponent = false as true;
      }],
      ['preserve special materials', (_world, payload) => {
        payload.preservesCostlyAndConsumedMaterials = false as true;
      }],
      ['replace verbal', (_world, payload) => { payload.replacesVerbalComponent = true as false; }],
      ['replace somatic', (_world, payload) => { payload.replacesSomaticComponent = true as false; }],
    ];
    for (const [label, mutate] of cases) {
      const world = copy(fixture.world);
      const payload = copy(fixture.focus);
      mutate(world, payload);
      expect(() => evolve(world, payload), label).toThrow(/material-focus projection diverges/);
    }
  });

  it('routes an authorized Pact Tome owner-death event through the shared reducer', () => {
    const fixture = activeTomeFixture();
    const after = evolve(fixture.world, fixture.death);
    expect(after.actors[TOME_ACTOR].warlockPacts?.tome).toBeUndefined();
    expect(after.objects['object:book-of-shadows']).toBeUndefined();
  });
});
