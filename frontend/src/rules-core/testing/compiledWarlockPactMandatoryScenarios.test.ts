import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  type DieTapeEntry,
} from '../determinism';
import {
  ACTOR_LIFECYCLE_PROVENANCE,
  createWorld,
  type ActorState,
  type CommandResult,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type UncommittedRuleEvent,
  type WorldState,
} from '../domain';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_MATERIAL_RESOURCE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
  familiarActorsOwnedBy,
} from '../familiarRuntime';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import { migrateWorldState } from '../worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';

declare module '@vitest/runner' {
  interface TaskMeta {
    semanticProtocol?: string;
    scenarioId?: string;
  }
}

const PACT_BLADE_SCENARIO_ID = 'SC-PB-01';
const PACT_CHAIN_SCENARIO_ID = 'SC-PC-01';
const PACT_TOME_SCENARIO_ID = 'SC-PT-01';
const DAGGER_CARD_ID = '7ac95f8a-0b8a-4653-b683-19f09ccfb447';
const MACE_CARD_ID = '30f86119-0415-47bc-9f5d-7db915ad0ee5';
const ARMOR_OF_AGATHYS_CARD = 'SPELL-0189';
const CHILL_TOUCH_CARD = 'chill_touch';
const FIND_FAMILIAR_CARD = 'SPELL-0241';

type CompiledSpell = Extract<RuleActionDefinition, { kind: 'spell' }>;
type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

interface CompiledSpellAccess {
  action: CompiledSpell;
  grantId: string;
}

interface SegmentedSession {
  initial: WorldState;
  catalog: RulesCatalog;
  environment: {
    rng: () => number;
    clock: () => number;
    nextId: () => string;
  };
  committed: UncommittedRuleEvent[];
  checkpointCount: number;
  session: InMemoryRulesSession;
}

let corpus: CompiledMicroMvpAcceptanceCorpus;
let bladeRoot: CompiledMicroMvpL1Root;
let chainRoot: CompiledMicroMvpL1Root;
let tomeRoot: CompiledMicroMvpL1Root;
let fighterRoot: CompiledMicroMvpL1Root;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing compiled Pact acceptance fixture: ${label}`);
  return value;
}

function actorCopy(root: CompiledMicroMvpL1Root): ActorState {
  return copy(root.actor) as ActorState;
}

function catalogFor(...roots: CompiledMicroMvpL1Root[]): RulesCatalog {
  const actions = new Map(roots.flatMap((root) => root.rulesActions)
    .map((action) => [action.id, action] as const));
  return {
    getAction: (id) => actions.get(id) ?? corpus.compiled.catalog.getAction(id),
    getCard: (id) => corpus.compiled.catalog.getCard?.(id),
  };
}

function spellByCard(root: CompiledMicroMvpL1Root, cardNumber: string): CompiledSpellAccess {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === cardNumber),
    `${root.stableKey}:${cardNumber}:entity`,
  );
  const action = required(root.rulesActions.find((candidate): candidate is CompiledSpell => (
    candidate.kind === 'spell' && candidate.sourceEntityIds.includes(entity.id)
  )), `${root.stableKey}:${cardNumber}:action`);
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id
  )), `${root.stableKey}:${cardNumber}:grant`);
  return { action, grantId: grant.grantId };
}

function spatial(relation: SpatialFacts['relation'], distanceFt = 5): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation,
    ...(relation === 'self' ? { willing: true } : {}),
  };
}

function makeSegmentedSession(input: {
  id: string;
  root: CompiledMicroMvpL1Root;
  support: CompiledMicroMvpL1Root;
  catalog: RulesCatalog;
  dice?: readonly DieTapeEntry[];
  prepareOwner?: (actor: ActorState) => void;
}): SegmentedSession & { tape: ReturnType<typeof createStrictRngTape> } {
  const owner = actorCopy(input.root);
  input.prepareOwner?.(owner);
  const support = actorCopy(input.support);
  const initial = createWorld({
    id: input.id,
    ruleset: corpus.compiled.ruleset,
    actors: [owner, support],
    objects: [
      ...copy(input.root.initialWorldObjects),
      ...copy(input.support.initialWorldObjects),
    ],
  });
  const tape = createStrictRngTape(input.dice ?? []);
  const environment = {
    rng: tape.rng,
    clock: createLogicalClock(300_000),
    nextId: createSequentialIdFactory(`pact-acceptance:${input.id}`),
  };
  return {
    initial: copy(initial),
    catalog: input.catalog,
    environment,
    committed: [],
    checkpointCount: 0,
    session: new InMemoryRulesSession(initial, input.catalog, environment),
    tape,
  };
}

function accept(
  session: InMemoryRulesSession,
  actorId: string,
  input: CommandInput,
): Extract<CommandResult, { status: 'accepted' }> {
  const result = session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: corpus.compiled.ruleset.contentHash,
    actorId,
    ...input,
  } as GameCommand);
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function reload(run: SegmentedSession): WorldState {
  run.committed.push(...copy(run.session.getEvents()));
  run.checkpointCount += 1;
  const checkpoint = migrateWorldState(copy(run.session.getState()));
  expect(checkpoint).toEqual(run.session.getState());
  expect(migrateWorldState(copy(checkpoint))).toEqual(checkpoint);
  run.session = new InMemoryRulesSession(checkpoint, run.catalog, run.environment);
  return checkpoint;
}

function assertReplay(run: SegmentedSession): void {
  const events = allEvents(run);
  const replayed = foldEvents(copy(run.initial), events);
  expect(canonicalStringify(replayed)).toBe(canonicalStringify(run.session.getState()));
  expect(migrateWorldState(copy(run.session.getState()))).toEqual(run.session.getState());
}

function allEvents(run: SegmentedSession): UncommittedRuleEvent[] {
  return [...run.committed, ...copy(run.session.getEvents())];
}

function assertMandatoryTrace(
  run: SegmentedSession,
  ownerId: string,
  supportId: string,
): void {
  const initialActors = Object.values(run.initial.actors);
  expect(initialActors.map((actor) => actor.id).sort()).toEqual([ownerId, supportId].sort());
  expect(initialActors.every((actor) => actor.kind === 'playerCharacter')).toBe(true);
  expect(run.checkpointCount).toBeGreaterThanOrEqual(2);
  const events = allEvents(run);
  const declarations = events.flatMap((event) => (
    event.payload.type === 'ActionDeclared' ? [event.payload] : []
  ));
  const rolls = events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' && event.payload.event.type === 'roll'
      ? [event.payload.event.roll]
      : []
  ));
  expect(declarations.some((event) => event.actionKind === 'nonSpell')).toBe(true);
  expect(declarations.some((event) => (
    event.actionKind === 'spell'
      && event.actorId === ownerId
      && event.targetIds.includes(supportId)
  ))).toBe(true);
  expect(rolls.some((roll) => roll.kind === 'check')).toBe(true);
  expect(rolls.some((roll) => roll.kind === 'save')).toBe(true);
  expect(events).toContainEqual(expect.objectContaining({
    payload: expect.objectContaining({
      type: 'EngineEventRecorded',
      event: { type: 'condition_applied', condition: 'invisible' },
    }),
  }));
  const turns = events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded'
      && (event.payload.event.type === 'turn_started' || event.payload.event.type === 'turn_ended')
      ? [`${event.payload.event.type}:${event.payload.actorId}`]
      : []
  ));
  expect(turns.slice(0, 5)).toEqual([
    `turn_started:${ownerId}`,
    `turn_ended:${ownerId}`,
    `turn_started:${supportId}`,
    `turn_ended:${supportId}`,
    `turn_started:${ownerId}`,
  ]);
  assertReplay(run);
}

function eventTypes(result: Extract<CommandResult, { status: 'accepted' }>): string[] {
  return result.events.map((event) => event.payload.type);
}

function activeAttackActionId(world: WorldState, actorId: string): string {
  return required(Object.values(world.attackActions).find((attack) => (
    attack.actorId === actorId && attack.status === 'open'
  ))?.id, `${actorId}:open Attack action`);
}

function activeTome(world: WorldState, actorId: string) {
  return required(world.actors[actorId].warlockPacts?.tome?.tome, `${actorId}:active Tome`);
}

beforeAll(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('network is forbidden for compiled Pact mandatory scenarios');
  };
  try {
    corpus = await compileMicroMvpAcceptanceCorpus();
    const base = required(corpus.compiled.roots.find((root) => (
      root.matrixCase.klass.card_number === 'CLASS-warlock'
        && root.matrixCase.species.card_number === 'RACE-0003'
    )), 'Dwarf Warlock base');
    [bladeRoot, chainRoot, tomeRoot] = await compileMicroMvpL1ChoiceVariants([
      {
        stableKey: base.stableKey,
        overrides: {
          warlock_invocation_l1: ['EFF-pact-blade'],
          warlock_spells_known: ['detect_magic', ARMOR_OF_AGATHYS_CARD],
          warlock_cantrips: [CHILL_TOUCH_CARD, 'poison_spray'],
        },
      },
      {
        stableKey: base.stableKey,
        overrides: {
          warlock_invocation_l1: ['EFF-pact-chain'],
          warlock_cantrips: [CHILL_TOUCH_CARD, 'poison_spray'],
        },
      },
      {
        stableKey: base.stableKey,
        overrides: {
          warlock_invocation_l1: ['EFF-pact-tome'],
          pact_tome_cantrips: ['fire_bolt', 'light', 'SPELL-0230'],
          pact_tome_rituals: ['SPELL-0236', 'SPELL-0252'],
        },
      },
    ]);
    fighterRoot = required(corpus.compiled.roots.find((root) => (
      root.matrixCase.klass.card_number === 'CLASS-warrior'
    )), 'Fighter support');
  } finally {
    globalThis.fetch = originalFetch;
  }
}, 60_000);

describe('compiled Warlock Pact mandatory two-PC acceptance', () => {
  it('runs Pact Blade bond, replacement, focus, attack, pending-safe checkpoints, and explicit terminal lifecycle', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: PACT_BLADE_SCENARIO_ID },
  }, () => {
    const ownerId = bladeRoot.actor.id;
    const targetId = fighterRoot.actor.id;
    const armor = spellByCard(bladeRoot, ARMOR_OF_AGATHYS_CARD);
    const protocolSpell = spellByCard(bladeRoot, CHILL_TOUCH_CARD);
    const catalog = catalogFor(bladeRoot, fighterRoot);
    expect(catalog.getCard?.(DAGGER_CARD_ID)?.card_number).toBe('CARD-0297');
    expect(catalog.getCard?.(MACE_CARD_ID)?.card_number).toBe('CARD-0298');
    const run = makeSegmentedSession({
      id: 'compiled-pact-blade-mandatory',
      root: bladeRoot,
      support: fighterRoot,
      catalog,
      dice: [
        { label: 'Pact Blade cross-PC Chill Touch attack', sides: 20, value: 18 },
        { label: 'Pact Blade cross-PC Chill Touch damage', sides: 10, value: 3 },
        { label: 'Pact Blade owner check', sides: 20, value: 12 },
        { label: 'Pact Blade owner Hide', sides: 20, value: 20 },
        { label: 'Pact Blade target save', sides: 20, value: 13 },
        { label: 'Pact Blade attack advantage high', sides: 20, value: 19 },
        { label: 'Pact Blade attack advantage low', sides: 20, value: 18 },
        { label: 'Pact Blade psychic damage', sides: 6, value: 5 },
      ],
    });

    const firstBond = accept(run.session, ownerId, {
      type: 'BondPactBlade', commandId: 'blade:bond:dagger',
      mode: 'conjure', weaponCardId: DAGGER_CARD_ID, hand: 'main_hand',
    });
    expect(eventTypes(firstBond)).toContain('PactBladeBonded');
    const firstObjectId = required(
      run.session.getState().actors[ownerId].warlockPacts?.blade?.activeBond?.weaponObjectId,
      'first Pact Blade object',
    );
    expect(run.session.getState().objects[firstObjectId]).toMatchObject({
      itemCardId: DAGGER_CARD_ID,
      heldByActorId: ownerId,
      heldInHand: 'main_hand',
    });
    reload(run);

    accept(run.session, ownerId, {
      type: 'TakeLongRest', commandId: 'blade:rest', durationHours: 8,
    });
    const focusedCast = accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'blade:focus:armor',
      actionId: armor.action.id,
      targetIds: [],
      factsByTarget: {},
      choices: { temporary_hp: 'take_spell' },
      spell: {
        baseLevel: 1, grantId: armor.grantId, mode: 'normal',
        focusObjectId: firstObjectId, focusHand: 'main_hand',
      },
    });
    expect(eventTypes(focusedCast)).toContain('PactBladeMaterialFocusProjected');
    expect(focusedCast.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        spell: expect.objectContaining({
          focusObjectId: firstObjectId,
          focusHand: 'main_hand',
        }),
      }),
    }));
    accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'blade:protocol:cross-pc-spell',
      actionId: protocolSpell.action.id,
      targetIds: [targetId],
      factsByTarget: { [targetId]: spatial('enemy') },
      spell: { baseLevel: 0, grantId: protocolSpell.grantId, mode: 'normal' },
    });
    reload(run);

    accept(run.session, ownerId, {
      type: 'StartEncounter', commandId: 'blade:encounter', initiative: [ownerId, targetId],
    });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'blade:r1:owner:start' });
    accept(run.session, ownerId, {
      type: 'AbilityCheck', commandId: 'blade:r1:owner:check', ability: 'cha', dc: 10,
    });
    accept(run.session, ownerId, {
      type: 'AttemptHide', commandId: 'blade:r1:owner:hide',
      eligibility: {
        factsSource: 'scenario', boardRevision: 2, heavilyObscured: true,
        cover: 'three_quarters', visibleToAnyEnemy: false,
      },
    });
    expect(run.session.getState().actors[ownerId].runtime.activeEffects).toContainEqual(
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'invisible' }) }),
    );
    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'blade:r1:owner:end' });
    accept(run.session, targetId, { type: 'StartTurn', commandId: 'blade:r1:target:start' });
    accept(run.session, targetId, {
      type: 'SavingThrow', commandId: 'blade:r1:target:save', ability: 'dex', dc: 10,
    });
    accept(run.session, targetId, { type: 'EndTurn', commandId: 'blade:r1:target:end' });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'blade:r2:owner:start' });
    const replacement = accept(run.session, ownerId, {
      type: 'BondPactBlade', commandId: 'blade:bond:mace',
      mode: 'conjure', weaponCardId: MACE_CARD_ID, hand: 'main_hand',
    });
    expect(eventTypes(replacement)).toContain('PactBladeBonded');
    const activeBond = run.session.getState().actors[ownerId]
      ?.warlockPacts?.blade?.activeBond;
    if (!activeBond) throw new Error('Missing compiled Pact acceptance fixture: replacement Pact Blade bond');
    expect(activeBond.weaponCardId).toBe(MACE_CARD_ID);
    expect(activeBond.weaponObjectId).not.toBe(firstObjectId);
    expect(run.session.getState().objects[firstObjectId]).toBeUndefined();

    accept(run.session, ownerId, { type: 'BeginAttackAction', commandId: 'blade:r2:attack' });
    const hpBefore = run.session.getState().actors[targetId].runtime.hp.current;
    const attack = accept(run.session, ownerId, {
      type: 'PerformWeaponAttack', commandId: 'blade:r2:psychic-hit',
      attackActionId: activeAttackActionId(run.session.getState(), ownerId),
      weaponCardId: MACE_CARD_ID,
      weaponObjectId: activeBond.weaponObjectId,
      pactBlade: { abilityChoice: 'cha', damageType: 'psychic' },
      targetActorId: targetId,
      facts: { ...spatial('enemy'), targetCanSeeSource: false },
    });
    expect(eventTypes(attack)).toContain('PactBladeAttackProjected');
    expect(run.session.getState().actors[targetId].runtime.hp.current)
      .toBe(hpBefore - 5 - bladeRoot.actor.character.abilityMods.cha);
    expect(attack.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        facts: expect.objectContaining({
          pactBlade: expect.objectContaining({
            attackAbility: 'cha',
            damageAbility: 'cha',
            resolvedDamageType: 'psychic',
          }),
        }),
      }),
    }));
    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'blade:r2:owner:end' });
    reload(run);

    const beforeDeath = run.session.getState();
    expect(beforeDeath.actors[ownerId].runtime.hp.current).toBeGreaterThan(0);
    const death = accept(run.session, ownerId, {
      type: 'AdjudicateActorDeath', commandId: 'blade:owner-death',
      adjudication: {
        type: 'ActorDeathAdjudicated',
        provenance: ACTOR_LIFECYCLE_PROVENANCE,
        factId: 'fact:compiled-blade-owner-death',
        actorId: ownerId,
        adjudicatedBy: targetId,
        observedAtWorldRevision: beforeDeath.revision,
        rulesetContentHash: corpus.compiled.ruleset.contentHash,
      },
    });
    expect(eventTypes(death)).toEqual(expect.arrayContaining([
      'ActorDeathAdjudicated', 'PactBladeEndedOnOwnerDeath',
    ]));
    const deadOwner = required(run.session.getState().actors[ownerId], 'dead Pact Blade owner');
    expect(deadOwner.lifecycle?.status).toBe('dead');
    expect(deadOwner.warlockPacts?.blade?.activeBond).toBeNull();
    expect(run.session.getState().objects[activeBond.weaponObjectId]).toBeUndefined();
    assertMandatoryTrace(run, ownerId, targetId);
    run.tape.assertExhausted();
  });

  it('runs Pact Chain casting, actor turns, attack substitution, and Touch delivery through its one familiar', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: PACT_CHAIN_SCENARIO_ID },
  }, () => {
    const ownerId = chainRoot.actor.id;
    const targetId = fighterRoot.actor.id;
    const findFamiliar = spellByCard(chainRoot, FIND_FAMILIAR_CARD);
    const chillTouch = spellByCard(chainRoot, CHILL_TOUCH_CARD);
    const chain = required(chainRoot.actor.warlockPacts?.chain, 'compiled Pact Chain state');
    expect(chain.template.specialFormIds).toHaveLength(8);
    expect(chain.template.normalFormSource).toBe('find_familiar_spell');
    const run = makeSegmentedSession({
      id: 'compiled-pact-chain-mandatory',
      root: chainRoot,
      support: fighterRoot,
      catalog: catalogFor(chainRoot, fighterRoot),
      prepareOwner: (actor) => {
        actor.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE] = 20;
        actor.runtime.maxResources[FIND_FAMILIAR_MATERIAL_RESOURCE] = 20;
        actor.character.resourceRecharge = {
          ...(actor.character.resourceRecharge ?? {}),
          [FIND_FAMILIAR_MATERIAL_RESOURCE]: 'never',
        };
      },
      dice: [
        { label: 'Pact Chain owner check', sides: 20, value: 12 },
        { label: 'Pact Chain owner Hide', sides: 20, value: 20 },
        { label: 'Pact Chain target save', sides: 20, value: 13 },
        { label: 'Pact Chain owl initiative', sides: 20, value: 11 },
        { label: 'Pact Chain owl talons', sides: 20, value: 16 },
        { label: 'Pact Chain delivered Chill Touch advantage high', sides: 20, value: 18 },
        { label: 'Pact Chain delivered Chill Touch advantage low', sides: 20, value: 17 },
        { label: 'Pact Chain delivered Chill Touch damage', sides: 10, value: 6 },
      ],
    });

    accept(run.session, ownerId, {
      type: 'StartEncounter', commandId: 'chain:encounter', initiative: [ownerId, targetId],
    });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'chain:r1:owner:start' });
    accept(run.session, ownerId, {
      type: 'AbilityCheck', commandId: 'chain:r1:owner:check', ability: 'cha', dc: 10,
    });
    accept(run.session, ownerId, {
      type: 'AttemptHide', commandId: 'chain:r1:owner:hide',
      eligibility: {
        factsSource: 'scenario', boardRevision: 2, heavilyObscured: true,
        cover: 'three_quarters', visibleToAnyEnemy: false,
      },
    });
    expect(run.session.getState().actors[ownerId].runtime.activeEffects).toContainEqual(
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'invisible' }) }),
    );
    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'chain:r1:owner:end' });
    accept(run.session, targetId, { type: 'StartTurn', commandId: 'chain:r1:target:start' });
    accept(run.session, targetId, {
      type: 'SavingThrow', commandId: 'chain:r1:target:save', ability: 'dex', dc: 10,
    });
    accept(run.session, targetId, { type: 'EndTurn', commandId: 'chain:r1:target:end' });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'chain:r2:owner:start' });
    const slotsBefore = run.session.getState().actors[ownerId].runtime.resources.spell_slot_1;
    const cast = accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'chain:r2:cast',
      actionId: findFamiliar.action.id,
      targetIds: [],
      spell: { baseLevel: 1, grantId: findFamiliar.grantId, mode: 'normal' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fiend',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'pact_chain_magic_action',
      },
    });
    expect(eventTypes(cast)).toContain('FamiliarActorUpserted');
    const familiar = required(
      familiarActorsOwnedBy(run.session.getState(), ownerId)[0],
      'compiled Pact Chain familiar',
    );
    expect(familiar).toMatchObject({
      kind: 'summonedActor',
      familiarMetadata: { formId: 'owl', statBlockId: 'mm2025.creature.owl' },
      familiarState: {
        ownerActorId: ownerId,
        spiritType: 'fiend',
        initiative: { mode: 'own', d20Roll: 11, modifier: 1, total: 12 },
      },
    });
    expect(run.session.getState().actors[ownerId].runtime.resources).toMatchObject({
      spell_slot_1: slotsBefore,
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: 10,
    });
    reload(run);

    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'chain:r2:owner:end' });
    accept(run.session, familiar.id, { type: 'StartTurn', commandId: 'chain:r2:familiar:start' });
    accept(run.session, familiar.id, { type: 'EndTurn', commandId: 'chain:r2:familiar:end' });
    accept(run.session, targetId, { type: 'StartTurn', commandId: 'chain:r2:target:start' });
    accept(run.session, targetId, { type: 'EndTurn', commandId: 'chain:r2:target:end' });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'chain:r3:owner:start' });
    accept(run.session, ownerId, { type: 'BeginAttackAction', commandId: 'chain:r3:attack' });
    const targetHpBeforeAttack = run.session.getState().actors[targetId].runtime.hp.current;
    accept(run.session, ownerId, {
      type: 'PerformPactChainFamiliarAttack', commandId: 'chain:r3:familiar-attack',
      attackActionId: activeAttackActionId(run.session.getState(), ownerId),
      familiarActorId: familiar.id,
      familiarActionId: 'mm2025.owl.talons',
      targetActorId: targetId,
      facts: spatial('enemy'),
    });
    expect(run.session.getState().actors[targetId].runtime.hp.current)
      .toBe(targetHpBeforeAttack - 1);
    expect(run.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(0);
    expect(run.session.getState().actors[ownerId].warlockPacts?.chain?.activeFamiliar)
      .toMatchObject({ actorId: familiar.id, reactionAvailable: false });
    reload(run);

    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'chain:r3:owner:end' });
    accept(run.session, familiar.id, { type: 'StartTurn', commandId: 'chain:r3:familiar:start' });
    expect(run.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(1);
    accept(run.session, familiar.id, { type: 'EndTurn', commandId: 'chain:r3:familiar:end' });
    accept(run.session, targetId, { type: 'StartTurn', commandId: 'chain:r3:target:start' });
    accept(run.session, targetId, { type: 'EndTurn', commandId: 'chain:r3:target:end' });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'chain:r4:owner:start' });
    const hpBeforeTouch = run.session.getState().actors[targetId].runtime.hp.current;
    const delivered = accept(run.session, ownerId, {
      type: 'DeliverTouchSpellThroughFamiliar', commandId: 'chain:r4:deliver-chill-touch',
      familiarActorId: familiar.id,
      spellActionId: chillTouch.action.id,
      targetActorId: targetId,
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: 3, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: { ...spatial('enemy'), targetCanSeeSource: false },
      spell: { baseLevel: 0, grantId: chillTouch.grantId, mode: 'normal' },
    });
    expect(run.session.getState().pendingResolution).toBeNull();
    expect(run.session.getState().actors[targetId].runtime.hp.current).toBe(hpBeforeTouch - 6);
    expect(run.session.getState().actors[familiar.id].runtime.resources.reaction).toBe(0);
    expect(run.session.getState().actors[targetId].runtime.activeEffects).toContainEqual(
      expect.objectContaining({
        sourceId: ownerId,
        mechanics: expect.objectContaining({ op: 'deny', applies_to: { roll: 'healing' } }),
      }),
    );
    expect(delivered.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actorId: ownerId,
        actionId: chillTouch.action.id,
        facts: expect.objectContaining({ deliveryActorId: familiar.id }),
      }),
    }));
    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'chain:r4:owner:end' });
    assertMandatoryTrace(run, ownerId, targetId);
    run.tape.assertExhausted();
  });

  it('runs Pact Tome rest replacement, physical focus, both casting modes, and shared explicit owner death', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: PACT_TOME_SCENARIO_ID },
  }, () => {
    const ownerId = tomeRoot.actor.id;
    const witnessId = fighterRoot.actor.id;
    const detectPoison = spellByCard(tomeRoot, 'SPELL-0236');
    const fireBolt = spellByCard(tomeRoot, 'fire_bolt');
    const catalog = catalogFor(tomeRoot, fighterRoot);
    const run = makeSegmentedSession({
      id: 'compiled-pact-tome-mandatory',
      root: tomeRoot,
      support: fighterRoot,
      catalog,
      dice: [
        { label: 'Pact Tome owner check', sides: 20, value: 12 },
        { label: 'Pact Tome owner Hide', sides: 20, value: 20 },
        { label: 'Pact Tome witness save', sides: 20, value: 13 },
        { label: 'Pact Tome Fire Bolt advantage high', sides: 20, value: 18 },
        { label: 'Pact Tome Fire Bolt advantage low', sides: 20, value: 17 },
        { label: 'Pact Tome Fire Bolt damage', sides: 10, value: 7 },
      ],
    });
    const initialTome = activeTome(run.session.getState(), ownerId);
    const firstBookId = `${ownerId}:acceptance-book:short`;
    const shortRest = accept(run.session, ownerId, {
      type: 'TakeShortRest', commandId: 'tome:short-rest', decisions: [],
      pactTome: {
        bookObjectId: firstBookId,
        cantripActionIds: [...initialTome.cantripActionIds],
        ritualActionIds: [...initialTome.ritualActionIds],
      },
    });
    expect(eventTypes(shortRest)).toContain('PactTomeRestCompleted');
    expect(run.session.getState().objects[initialTome.bookObjectId]).toBeUndefined();
    expect(run.session.getState().objects[firstBookId]).toMatchObject({
      kind: 'item',
      ownerActorId: ownerId,
      carriedByActorId: ownerId,
      sourceActorId: ownerId,
    });
    const firstTome = activeTome(run.session.getState(), ownerId);
    const ritualActionId = detectPoison.action.id;
    expect(firstTome.ritualActionIds).toContain(ritualActionId);
    const normalGrant = required(
      run.session.getState().actors[ownerId].spellcastingAccess?.grants.find((grant) => (
        grant.actionId === ritualActionId && grant.sourceId === firstBookId
      )),
      'normal Pact Tome ritual grant',
    );
    const slotBeforeNormal = run.session.getState().actors[ownerId]
      .runtime.resources.spell_slot_1;
    const normal = accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'tome:cast:normal', actionId: ritualActionId,
      targetIds: [], spell: { baseLevel: 1, grantId: normalGrant.grantId, mode: 'normal' },
    });
    expect(run.session.getState().actors[ownerId].runtime.resources.spell_slot_1)
      .toBe(slotBeforeNormal - 1);
    expect(normal.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        spell: expect.objectContaining({
          sourceId: firstBookId,
          payment: { kind: 'slot', resource: 'spell_slot_1' },
          focusObjectId: firstBookId,
          castingTimeAddedSeconds: 0,
        }),
      }),
    }));
    reload(run);

    const secondBookId = `${ownerId}:acceptance-book:long`;
    accept(run.session, ownerId, {
      type: 'TakeLongRest', commandId: 'tome:long-rest', durationHours: 8,
      pactTome: {
        bookObjectId: secondBookId,
        cantripActionIds: [...firstTome.cantripActionIds],
        ritualActionIds: [...firstTome.ritualActionIds],
      },
    });
    expect(run.session.getState().objects[firstBookId]).toBeUndefined();
    expect(run.session.getState().objects[secondBookId]).toBeDefined();
    const secondTome = activeTome(run.session.getState(), ownerId);
    const ritualGrant = required(
      run.session.getState().actors[ownerId].spellcastingAccess?.grants.find((grant) => (
        grant.actionId === ritualActionId && grant.sourceId === secondBookId
      )),
      'ritual Pact Tome grant',
    );
    const slotBeforeRitual = run.session.getState().actors[ownerId]
      .runtime.resources.spell_slot_1;
    const ritual = accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'tome:cast:ritual', actionId: ritualActionId,
      targetIds: [], spell: { baseLevel: 1, grantId: ritualGrant.grantId, mode: 'ritual' },
    });
    expect(run.session.getState().actors[ownerId].runtime.resources.spell_slot_1)
      .toBe(slotBeforeRitual);
    expect(ritual.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        spell: expect.objectContaining({
          sourceId: secondBookId,
          payment: { kind: 'none' },
          focusObjectId: secondBookId,
          castingTimeAddedSeconds: 600,
        }),
      }),
    }));
    expect(secondTome.spellGrantIds).toHaveLength(5);
    reload(run);

    accept(run.session, ownerId, {
      type: 'StartEncounter', commandId: 'tome:encounter', initiative: [ownerId, witnessId],
    });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'tome:r1:owner:start' });
    accept(run.session, ownerId, {
      type: 'AbilityCheck', commandId: 'tome:r1:owner:check', ability: 'cha', dc: 10,
    });
    accept(run.session, ownerId, {
      type: 'AttemptHide', commandId: 'tome:r1:owner:hide',
      eligibility: {
        factsSource: 'scenario', boardRevision: 2, heavilyObscured: true,
        cover: 'three_quarters', visibleToAnyEnemy: false,
      },
    });
    expect(run.session.getState().actors[ownerId].runtime.activeEffects).toContainEqual(
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'invisible' }) }),
    );
    accept(run.session, ownerId, { type: 'EndTurn', commandId: 'tome:r1:owner:end' });
    accept(run.session, witnessId, { type: 'StartTurn', commandId: 'tome:r1:witness:start' });
    accept(run.session, witnessId, {
      type: 'SavingThrow', commandId: 'tome:r1:witness:save', ability: 'dex', dc: 10,
    });
    accept(run.session, witnessId, { type: 'EndTurn', commandId: 'tome:r1:witness:end' });
    accept(run.session, ownerId, { type: 'StartTurn', commandId: 'tome:r2:owner:start' });
    const fireBoltGrant = required(
      run.session.getState().actors[ownerId].spellcastingAccess?.grants.find((grant) => (
        grant.actionId === fireBolt.action.id && grant.sourceId === secondBookId
      )),
      'Pact Tome Fire Bolt grant',
    );
    const witnessHpBefore = run.session.getState().actors[witnessId].runtime.hp.current;
    const crossPcSpell = accept(run.session, ownerId, {
      type: 'UseAction', commandId: 'tome:r2:fire-bolt', actionId: fireBolt.action.id,
      targetIds: [witnessId],
      factsByTarget: {
        [witnessId]: { ...spatial('enemy', 60), targetCanSeeSource: false },
      },
      spell: { baseLevel: 0, grantId: fireBoltGrant.grantId, mode: 'normal' },
    });
    expect(run.session.getState().actors[witnessId].runtime.hp.current)
      .toBe(witnessHpBefore - 7);
    expect(crossPcSpell.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared', actorId: ownerId, targetIds: [witnessId],
        spell: expect.objectContaining({ sourceId: secondBookId, focusObjectId: secondBookId }),
      }),
    }));
    const beforeDeath = run.session.getState();
    expect(beforeDeath.actors[ownerId].runtime.hp.current).toBeGreaterThan(0);
    const death = accept(run.session, ownerId, {
      type: 'AdjudicateActorDeath', commandId: 'tome:owner-death',
      adjudication: {
        type: 'ActorDeathAdjudicated',
        provenance: ACTOR_LIFECYCLE_PROVENANCE,
        factId: 'fact:compiled-tome-owner-death',
        actorId: ownerId,
        adjudicatedBy: witnessId,
        observedAtWorldRevision: beforeDeath.revision,
        rulesetContentHash: corpus.compiled.ruleset.contentHash,
      },
    });
    expect(eventTypes(death)).toEqual(expect.arrayContaining([
      'ActorDeathAdjudicated', 'PactTomeOwnerDied',
    ]));
    const deadOwner = required(run.session.getState().actors[ownerId], 'dead Pact Tome owner');
    expect(deadOwner.lifecycle?.status).toBe('dead');
    expect(deadOwner.warlockPacts?.tome).toBeUndefined();
    expect(run.session.getState().objects[secondBookId]).toBeUndefined();
    expect(required(run.session.getState().actors[witnessId], 'living Pact Tome witness')
      .lifecycle?.status).toBe('alive');
    assertMandatoryTrace(run, ownerId, witnessId);
    run.tape.assertExhausted();
  });
});
