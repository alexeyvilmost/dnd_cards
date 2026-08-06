import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import {
  beginAttackSequence,
  performWeaponSequenceAttack,
} from './attackSequence';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  type DieTapeEntry,
} from './determinism';
import {
  createWorld,
  type ActorState,
  type CommandResult,
  type GameCommand,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type WorldState,
} from './domain';
import { castFindFamiliar } from './findFamiliar';
import {
  materializeCanonicalFamiliarActor,
  pactChainProjection,
} from './familiarRuntime';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { createPactChainInvocationState } from './warlockPacts';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'condition-handler-integration@1',
  contentHash: 'sha256:condition-handler-integration',
  errataVersion: 'phb-2024',
};

const SWORD = withDeclaredTestWeaponProfile({
  id: 'card:sword',
  card_number: 'TEST-SWORD',
  name: 'Sword',
  type: 'weapon',
  weapon_type: 'longsword',
  bonus_value: '1d8',
  damage_type: 'slashing',
  properties: [],
} as unknown as Card, {
  weaponType: 'longsword',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '1d8', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: [],
  masteryEffectId: 'effect:mastery:sap',
});

const LIGHT_MAIN = withDeclaredTestWeaponProfile({
  id: 'card:light-main',
  card_number: 'TEST-LIGHT-MAIN',
  name: 'Light main',
  type: 'weapon',
  weapon_type: 'shortsword',
  bonus_value: '1d6',
  damage_type: 'piercing',
  properties: ['Light'],
} as unknown as Card, {
  weaponType: 'shortsword',
  proficiencyCategory: 'martial',
  attackAbility: 'finesse',
  damageLines: [{ dice: '1d6', type: 'piercing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['finesse', 'light'],
  masteryEffectId: 'effect:mastery:vex',
});

const LIGHT_OFF = withDeclaredTestWeaponProfile({
  id: 'card:light-off',
  card_number: 'TEST-LIGHT-OFF',
  name: 'Light off',
  type: 'weapon',
  weapon_type: 'dagger',
  bonus_value: '1d4',
  damage_type: 'piercing',
  properties: ['Light'],
} as unknown as Card, {
  weaponType: 'dagger',
  proficiencyCategory: 'simple',
  attackAbility: 'finesse',
  damageLines: [{ dice: '1d4', type: 'piercing' }],
  defaultAttackMode: 'melee',
  attackModes: [
    { kind: 'melee', reach_ft: 5 },
    { kind: 'ranged', normal_ft: 20, long_ft: 60 },
  ],
  properties: ['finesse', 'light', 'thrown'],
  masteryEffectId: 'effect:mastery:nick',
});

const CLEAVE_EFFECT_ID = 'effect:mastery:cleave';
const CLEAVE_WEAPON = withDeclaredTestWeaponProfile({
  id: 'card:cleave',
  card_number: 'TEST-CLEAVE',
  name: 'Cleave weapon',
  type: 'weapon',
  weapon_type: 'greataxe',
  bonus_value: '1d12',
  damage_type: 'slashing',
  properties: ['Heavy', 'Two-Handed'],
  mastery: CLEAVE_EFFECT_ID,
} as unknown as Card, {
  weaponType: 'greataxe',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '1d12', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: ['heavy', 'two_handed'],
  masteryEffectId: CLEAVE_EFFECT_ID,
});

const FACTS: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 0,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function charmedBy(sourceActorId: string, id = 'effect:charmed') {
  return {
    id,
    name: 'Condition from data',
    source: 'test',
    sourceId: sourceActorId,
    expiry: 'manual' as const,
    mechanics: { kind: 'condition', value: 'charmed' },
  };
}

function condition(value: string, id = `effect:${value}`) {
  return {
    id,
    name: 'Condition from data',
    source: 'test',
    expiry: 'manual' as const,
    mechanics: { kind: 'condition', value },
  };
}

function exhaustion(level: number) {
  return Array.from({ length: level }, (_, index) => ({
    id: `effect:terminal:${index + 1}`,
    name: 'Cumulative condition',
    source: 'test',
    expiry: 'manual' as const,
    mechanics: { kind: 'condition', value: 'exhaustion' },
  }));
}

function pc(input: {
  id: string;
  actionIds?: string[];
  cards?: Card[];
  activeEffects?: ActorState['runtime']['activeEffects'];
}): ActorState {
  const cards = copy(input.cards ?? []);
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 10,
    capabilities: { actionIds: [...(input.actionIds ?? [])] },
    character: {
      abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: cards,
      equippedCards: cards,
      weaponProficiencies: cards.flatMap((card) => card.weapon_type ? [card.weapon_type] : []),
    },
    runtime: {
      hp: { current: 30, max: 30, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {
        ...(cards[0] ? { main_hand: cards[0].id } : {}),
        ...(cards[1] ? { off_hand: cards[1].id } : {}),
      },
      inventory: cards.map((card) => ({ cardId: card.id, qty: 1 })),
      activeEffects: copy(input.activeEffects ?? []),
      firedThisTurn: [],
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

function testSession(world: WorldState, catalog: RulesCatalog, dice: readonly DieTapeEntry[] = []) {
  const tape = createStrictRngTape(dice);
  const session = new InMemoryRulesSession(world, catalog, {
    rng: tape.rng,
    clock: createLogicalClock(700_000),
    nextId: createSequentialIdFactory('condition-handler'),
  });
  return { initial: copy(world), session, tape };
}

function dispatch(session: InMemoryRulesSession, actorId: string, input: CommandInput) {
  return session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId,
    ...input,
  } as GameCommand);
}

function accepted(result: CommandResult) {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function expectReplay(test: ReturnType<typeof testSession>) {
  expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
    .toEqual(test.session.getState());
  test.tape.assertExhausted();
}

function openAttack(session: InMemoryRulesSession, actorId: string, commandId: string) {
  accepted(dispatch(session, actorId, { type: 'BeginAttackAction', commandId }));
  const action = Object.values(session.getState().attackActions)
    .find((candidate) => candidate.actorId === actorId && candidate.status === 'open');
  if (!action) throw new Error('Expected an open Attack action');
  return action.id;
}

function startTurn(input: {
  session: InMemoryRulesSession;
  actorId: string;
  initiative: string[];
  commandPrefix: string;
}) {
  accepted(dispatch(input.session, input.actorId, {
    type: 'StartEncounter',
    commandId: `${input.commandPrefix}:encounter`,
    initiative: input.initiative,
  }));
  accepted(dispatch(input.session, input.actorId, {
    type: 'StartTurn',
    commandId: `${input.commandPrefix}:turn`,
  }));
}

function currentFacts(session: InMemoryRulesSession): SpatialFacts {
  return { ...FACTS, boardRevision: session.getState().revision };
}

function autoDamageAction(input: {
  id: string;
  marker?: boolean;
  payload?: Record<string, unknown>;
}): RuleActionDefinition {
  return {
    id: input.id,
    name: 'The name is deliberately non-authoritative',
    kind: 'nonSpell',
    sourceEntityIds: [`source:${input.id}`],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 30,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      ...(input.marker ? { interaction: { intent: 'harmful' } } : {}),
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [input.payload ?? { kind: 'damage', amount: '1', type: 'force' }],
      }],
    },
  };
}

function attackReplacementAction(id: string): RuleActionDefinition {
  return {
    id,
    name: 'The attack-replacement name is not authoritative',
    kind: 'nonSpell',
    sourceEntityIds: [`source:${id}`],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 15,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    attackReplacement: {
      replacementKey: `${id}:replacement`,
      replacesAttacks: 1,
      totalAttacks: 1,
      oncePerAttackAction: true,
    },
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'save',
        who: 'target',
        ability: 'dex',
        dc: '10',
        on_fail: [{ kind: 'damage', amount: '1', type: 'force' }],
        on_success: [],
      }],
    },
  };
}

describe('condition interactions at the authoritative command handler', () => {
  it('enforces data-declared sight restrictions for a blinded source and an unseen target', () => {
    const sightAction = {
      ...autoDamageAction({ id: 'action:requires-sight' }),
      targeting: {
        ...autoDamageAction({ id: 'action:requires-sight' }).targeting!,
        requiresSight: true,
      },
    } satisfies RuleActionDefinition;
    const blinded = pc({
      id: 'pc:blinded',
      actionIds: [sightAction.id],
      activeEffects: [condition('blinded')],
    });
    const visibleTarget = pc({ id: 'pc:visible-target' });
    const blindedTest = testSession(
      createWorld({ id: 'world:blinded-sight', ruleset: RULESET, actors: [blinded, visibleTarget] }),
      { getAction: (id) => id === sightAction.id ? sightAction : undefined },
    );
    const blindedBefore = copy(blindedTest.session.getState());
    expect(dispatch(blindedTest.session, blinded.id, {
      type: 'UseAction', commandId: 'sight:blinded', actionId: sightAction.id,
      targetIds: [visibleTarget.id],
      factsByTarget: { [visibleTarget.id]: { ...FACTS, canSeeTarget: true } },
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied', state: blindedBefore });
    expectReplay(blindedTest);

    const observer = pc({ id: 'pc:observer', actionIds: [sightAction.id] });
    const invisible = pc({
      id: 'pc:invisible-target',
      activeEffects: [condition('invisible')],
    });
    const invisibleTest = testSession(
      createWorld({ id: 'world:invisible-sight', ruleset: RULESET, actors: [observer, invisible] }),
      { getAction: (id) => id === sightAction.id ? sightAction : undefined },
    );
    const unseenBefore = copy(invisibleTest.session.getState());
    expect(dispatch(invisibleTest.session, observer.id, {
      type: 'UseAction', commandId: 'sight:unseen', actionId: sightAction.id,
      targetIds: [invisible.id], factsByTarget: { [invisible.id]: FACTS },
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied', state: unseenBefore });
    accepted(dispatch(invisibleTest.session, observer.id, {
      type: 'UseAction', commandId: 'sight:seen', actionId: sightAction.id,
      targetIds: [invisible.id],
      factsByTarget: { [invisible.id]: { ...FACTS, canSeeTarget: true } },
    }));
    expect(invisibleTest.session.getState().actors[invisible.id].runtime.hp.current).toBe(29);
    expectReplay(invisibleTest);
  });

  it('rejects explicit weapon and Unarmed Strike commands against the exact condition source before RNG', () => {
    for (const attack of ['weapon', 'unarmed'] as const) {
      const attacker = pc({
        id: `pc:attacker:${attack}`,
        cards: [SWORD],
        activeEffects: [charmedBy('pc:charmer', `effect:charmed:${attack}`)],
      });
      const charmer = pc({ id: 'pc:charmer' });
      const world = createWorld({ id: `world:${attack}`, ruleset: RULESET, actors: [attacker, charmer] });
      const test = testSession(world, { getAction: () => undefined });
      startTurn({
        session: test.session,
        actorId: attacker.id,
        initiative: [attacker.id, charmer.id],
        commandPrefix: `${attack}:start`,
      });
      const attackActionId = openAttack(test.session, attacker.id, `${attack}:begin`);
      const before = copy(test.session.getState());
      const result = dispatch(test.session, attacker.id, attack === 'weapon' ? {
        type: 'PerformWeaponAttack', commandId: 'weapon:denied', attackActionId,
        weaponCardId: SWORD.id, targetActorId: charmer.id, facts: currentFacts(test.session),
      } : {
        type: 'PerformUnarmedStrike', commandId: 'unarmed:denied', attackActionId,
        option: 'damage', targetActorId: charmer.id, facts: currentFacts(test.session),
      });
      expect(result).toMatchObject({ status: 'rejected', code: 'CapabilityDenied', state: before });
      expect(test.session.getState()).toEqual(before);
      expectReplay(test);
    }
  });

  it('gates UseAction only by the exact generic harmful marker, never by name or damage payload', () => {
    const marked = autoDamageAction({ id: 'action:marked', marker: true });
    const unmarked = autoDamageAction({ id: 'action:unmarked' });
    const malformed = {
      ...autoDamageAction({ id: 'action:malformed' }),
      mechanics: {
        ...autoDamageAction({ id: 'action:malformed' }).mechanics,
        interaction: { intent: 'friendly' },
      },
    } as unknown as RuleActionDefinition;
    const attacker = pc({
      id: 'pc:actor',
      actionIds: [marked.id, unmarked.id, malformed.id],
      activeEffects: [charmedBy('pc:target')],
    });
    const target = pc({ id: 'pc:target' });
    const actions = new Map([marked, unmarked, malformed].map((action) => [action.id, action]));
    const test = testSession(
      createWorld({ id: 'world:marker', ruleset: RULESET, actors: [attacker, target] }),
      { getAction: (id) => actions.get(id) },
    );

    expect(dispatch(test.session, attacker.id, {
      type: 'UseAction', commandId: 'marker:malformed', actionId: malformed.id,
      targetIds: [target.id], factsByTarget: { [target.id]: FACTS },
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionDefinition' });
    expect(dispatch(test.session, attacker.id, {
      type: 'UseAction', commandId: 'marker:denied', actionId: marked.id,
      targetIds: [target.id], factsByTarget: { [target.id]: FACTS },
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    const hpBefore = test.session.getState().actors[target.id].runtime.hp.current;
    accepted(dispatch(test.session, attacker.id, {
      type: 'UseAction', commandId: 'marker:unmarked', actionId: unmarked.id,
      targetIds: [target.id], factsByTarget: { [target.id]: FACTS },
    }));
    expect(test.session.getState().actors[target.id].runtime.hp.current).toBe(hpBefore - 1);
    expectReplay(test);
  });

  it('always treats an explicit Attack-action replacement as harmful without a content-name heuristic', () => {
    const replacement = attackReplacementAction('action:replacement');
    const attacker = pc({
      id: 'pc:replacement-attacker',
      actionIds: [replacement.id],
      activeEffects: [charmedBy('pc:replacement-target')],
    });
    const target = pc({ id: 'pc:replacement-target' });
    const test = testSession(
      createWorld({ id: 'world:replacement-denied', ruleset: RULESET, actors: [attacker, target] }),
      { getAction: (id) => id === replacement.id ? replacement : undefined },
    );
    const before = copy(test.session.getState());

    expect(dispatch(test.session, attacker.id, {
      type: 'UseAttackReplacement', commandId: 'replacement:denied',
      actionId: replacement.id, targetIds: [target.id],
      factsByTarget: { [target.id]: FACTS },
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied', state: before });
    expect(test.session.getState()).toEqual(before);
    expectReplay(test);
  });

  it('uses the familiar as the exact attacker for Pact Chain substitution', () => {
    const summonActionId = 'action:find-familiar';
    const chainSourceId = 'effect:pact-chain';
    const owner = pc({ id: 'pc:owner', actionIds: [summonActionId] });
    const target = pc({ id: 'pc:target' });
    const familiarState = castFindFamiliar({
      familiarActorId: 'familiar:owl',
      ownerActorId: owner.id,
      policy: { kind: 'pact_chain', sourceEntityId: chainSourceId },
      method: 'pact_chain_magic_action',
      formId: 'owl',
      spiritType: 'fey',
      resources: { level1SpellSlots: 0, incenseGp: 10 },
      incenseOfferingGp: 10,
      materialCostGp: 10,
      baseCastingTimeSeconds: 3_600,
      mechanicsPolicy: { connectionRangeFt: 100, reappearRangeFt: 30, ritualCastingAddedSeconds: 600 },
      existingFamiliar: null,
    }).familiar;
    const familiar = materializeCanonicalFamiliarActor({
      familiar: familiarState,
      owner,
      summoningActionId: summonActionId,
    });
    const chain = createPactChainInvocationState({
      sourceEntityId: chainSourceId,
      ownerActorId: owner.id,
      findFamiliarActionId: summonActionId,
    });
    chain.activeFamiliar = pactChainProjection(familiarState);
    owner.warlockPacts = { chain };

    const ownerCharmed = copy(owner);
    ownerCharmed.runtime.activeEffects.push(charmedBy(target.id, 'effect:owner-charmed'));
    const allowed = testSession(
      createWorld({
        id: 'world:familiar-allowed', ruleset: RULESET,
        actors: [ownerCharmed, copy(familiar), copy(target)],
      }),
      { getAction: () => undefined },
      [
        { label: 'uncharmed familiar initiative', sides: 20, value: 10 },
        { label: 'uncharmed familiar attack', sides: 20, value: 10 },
      ],
    );
    startTurn({
      session: allowed.session,
      actorId: owner.id,
      initiative: [owner.id, familiar.id, target.id],
      commandPrefix: 'familiar:allowed:start',
    });
    const allowedAttackId = openAttack(allowed.session, owner.id, 'familiar:allowed:begin');
    accepted(dispatch(allowed.session, owner.id, {
      type: 'PerformPactChainFamiliarAttack', commandId: 'familiar:allowed:attack',
      attackActionId: allowedAttackId, familiarActorId: familiar.id,
      familiarActionId: 'mm2025.owl.talons', targetActorId: target.id,
      facts: currentFacts(allowed.session),
    }));
    expectReplay(allowed);

    const charmedFamiliar = copy(familiar);
    charmedFamiliar.runtime.activeEffects.push(charmedBy(target.id, 'effect:familiar-charmed'));
    const denied = testSession(
      createWorld({
        id: 'world:familiar-denied', ruleset: RULESET,
        actors: [copy(owner), charmedFamiliar, copy(target)],
      }),
      { getAction: () => undefined },
      [{ label: 'charmed familiar initiative', sides: 20, value: 10 }],
    );
    startTurn({
      session: denied.session,
      actorId: owner.id,
      initiative: [owner.id, familiar.id, target.id],
      commandPrefix: 'familiar:denied:start',
    });
    const deniedAttackId = openAttack(denied.session, owner.id, 'familiar:denied:begin');
    expect(dispatch(denied.session, owner.id, {
      type: 'PerformPactChainFamiliarAttack', commandId: 'familiar:denied:attack',
      attackActionId: deniedAttackId, familiarActorId: familiar.id,
      familiarActionId: 'mm2025.owl.talons', targetActorId: target.id,
      facts: currentFacts(denied.session),
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    expectReplay(denied);
  });

  it('materializes a data-declared terminal threshold once after an accepted cross-PC action', () => {
    const inflict = autoDamageAction({
      id: 'action:add-condition-level',
      payload: { kind: 'condition', value: 'exhaustion' },
    });
    const source = pc({ id: 'pc:source', actionIds: [inflict.id] });
    const target = pc({ id: 'pc:target', activeEffects: exhaustion(5) });
    const test = testSession(
      createWorld({ id: 'world:terminal', ruleset: RULESET, actors: [source, target] }),
      { getAction: (id) => id === inflict.id ? inflict : undefined },
      [{ label: 'post-terminal source check', sides: 20, value: 10 }],
    );

    const applied = accepted(dispatch(test.session, source.id, {
      type: 'UseAction', commandId: 'terminal:apply-sixth', actionId: inflict.id,
      targetIds: [target.id], factsByTarget: { [target.id]: FACTS },
    }));
    expect(applied.events.filter((event) => event.payload.type === 'ActorDeathAdjudicated'))
      .toHaveLength(1);
    expect(test.session.getState().actors[target.id].lifecycle).toMatchObject({
      status: 'dead',
      adjudication: {
        provenance: 'canonical_actor_lifecycle',
        actorId: target.id,
        adjudicatedBy: 'system:data-declared-condition-threshold',
      },
    });

    accepted(dispatch(test.session, source.id, {
      type: 'AbilityCheck', commandId: 'terminal:next-command', ability: 'wis', dc: 10,
    }));
    expect(test.session.getEvents().filter((event) => (
      event.payload.type === 'ActorDeathAdjudicated' && event.payload.actorId === target.id
    ))).toHaveLength(1);
    expectReplay(test);
  });

  it('rejects Light and Cleave follow-up attack commands before consuming their windows', () => {
    const charmer = pc({ id: 'pc:charmer' });
    const lightActor = pc({
      id: 'pc:light', cards: [LIGHT_MAIN, LIGHT_OFF],
      activeEffects: [charmedBy(charmer.id, 'effect:light-charmed')],
    });
    const lightWorld = createWorld({
      id: 'world:light-denied', ruleset: RULESET, actors: [lightActor, copy(charmer)],
    });
    const lightSequence = performWeaponSequenceAttack({
      sequence: beginAttackSequence({ id: 'attack:light', actorId: lightActor.id, totalAttacks: 1 }),
      actionId: 'core.attack.weapon', weaponCardId: LIGHT_MAIN.id,
      sourceEntityIds: ['system:dnd5e-2024:weapon-attack'],
    });
    lightWorld.attackActions['attack:light'] = {
      id: 'attack:light', actorId: lightActor.id, startedAtRevision: 0,
      turnKey: `exploration:0:${lightActor.id}`, status: 'completed', sequence: lightSequence,
    };
    const light = testSession(lightWorld, { getAction: () => undefined });
    expect(dispatch(light.session, lightActor.id, {
      type: 'PerformLightWeaponExtraAttack', commandId: 'light:denied',
      attackActionId: 'attack:light', weaponCardId: LIGHT_OFF.id,
      targetActorId: charmer.id, facts: FACTS,
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    expect(light.session.getState().actors[lightActor.id].runtime.resources.bonus_action).toBe(1);
    expectReplay(light);

    const cleaver = pc({
      id: 'pc:cleaver', cards: [CLEAVE_WEAPON],
      activeEffects: [
        charmedBy(charmer.id, 'effect:cleave-charmed'),
        {
          id: 'effect:cleave-window', name: 'Cleave window', source: 'test', expiry: 'turn_end',
          mechanics: {
            kind: 'attack_follow_up', follow_up: 'cleave',
            weaponCardId: CLEAVE_WEAPON.id, attackActionId: 'attack:cleave',
            primaryTargetActorId: 'monster:primary', secondaryWithinPrimaryFt: 5,
            sourceEntityId: CLEAVE_EFFECT_ID,
          },
        },
      ],
    });
    cleaver.character.weaponMasteries = [CLEAVE_WEAPON.weapon_type!];
    cleaver.masteryEffects = {
      [CLEAVE_EFFECT_ID]: {
        name: 'Cleave', mechanics: { weapon_mastery: {
          type: 'cleave', maximumPerTurn: 1, secondaryWithinPrimaryFt: 5,
          sameWeapon: true, positiveAbilityModifier: false, expires: 'end_of_turn',
        } },
        weaponTypes: [CLEAVE_WEAPON.weapon_type!],
        sourceEntityIds: [CLEAVE_EFFECT_ID],
      },
    };
    const primary = { ...pc({ id: 'monster:primary' }), kind: 'monster' as const };
    const cleaveWorld = createWorld({
      id: 'world:cleave-denied', ruleset: RULESET,
      actors: [cleaver, copy(charmer), primary],
    });
    const cleaveSequence = performWeaponSequenceAttack({
      sequence: beginAttackSequence({ id: 'attack:cleave', actorId: cleaver.id, totalAttacks: 1 }),
      actionId: 'core.attack.weapon', weaponCardId: CLEAVE_WEAPON.id,
      sourceEntityIds: ['system:dnd5e-2024:weapon-attack'],
    });
    cleaveWorld.attackActions['attack:cleave'] = {
      id: 'attack:cleave', actorId: cleaver.id, startedAtRevision: 0,
      turnKey: `exploration:0:${cleaver.id}`, status: 'completed', sequence: cleaveSequence,
    };
    const cleave = testSession(cleaveWorld, { getAction: () => undefined });
    expect(dispatch(cleave.session, cleaver.id, {
      type: 'PerformWeaponMasteryCleaveAttack', commandId: 'cleave:denied',
      attackActionId: 'attack:cleave', weaponCardId: CLEAVE_WEAPON.id,
      targetActorId: charmer.id, secondaryDistanceFromPrimaryFt: 5, facts: FACTS,
    })).toMatchObject({ status: 'rejected', code: 'CapabilityDenied' });
    expect(cleave.session.getState().actors[cleaver.id].runtime.activeEffects)
      .toContainEqual(expect.objectContaining({ id: 'effect:cleave-window' }));
    expectReplay(cleave);
  });
});
