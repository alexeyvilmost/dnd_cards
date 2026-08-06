import { describe, expect, it } from 'vitest';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { InMemoryRulesSession } from './session';
import type { SpellcastingAccessState } from './spellcastingAccess';
import { managedWorldSpellMechanics } from './testing/worldSpellPolicyFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'spell-reaction-access@1',
  contentHash: 'sha256:spell-reaction-access',
  errataVersion: 'PHB-2024',
};

const STRIKE: RuleActionDefinition = {
  id: 'test:longsword-strike',
  name: 'Longsword',
  kind: 'nonSpell',
  sourceEntityIds: ['test:longsword'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'str',
      on_hit: [{ kind: 'damage', dice: '1d6', type: 'slashing', ability: 'none' }],
    }],
  },
};

const MAGIC_MISSILE: RuleActionDefinition = {
  id: 'test:magic-missile',
  name: 'Magic Missile',
  kind: 'spell',
  sourceEntityIds: ['PHB24:SPELL-0174'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 3,
    rangeFt: 120,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    ...managedWorldSpellMechanics('magic_missile'),
    effects: [],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'test:shield',
  name: 'Shield',
  kind: 'spell',
  sourceEntityIds: ['PHB24:SPELL-0317'],
  spell: {
    level: 1,
    sourceClass: 'wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  mechanics: {
    activation: {
      mode: 'reaction',
      trigger: {
        event: 'hit_by_attack',
        events: ['hit_by_attack', 'targeted_by_magic_missile'],
      },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot', level: 1, amount: 1 }],
    },
    effects: [{
      resolution: 'auto',
      who: 'self',
      result: [{
        kind: 'modifier',
        applies_to: { roll: 'ac' },
        op: 'add',
        value: '+5',
        duration: { type: 'until_start_of_next_turn' },
        magic_missile_immunity: true,
      }, {
        // Test-only observable probe that proves the selected source ability
        // reaches formula evaluation inside the reaction executor.
        kind: 'set_value',
        target: 'temp_hp',
        value: 'spellcasting',
      }],
    }],
  },
};

const ACTIONS = [STRIKE, MAGIC_MISSILE, SHIELD];
const catalog: RulesCatalog = {
  getAction: (actionId) => ACTIONS.find((action) => action.id === actionId),
};

function actor(input: {
  id: string;
  actionIds: string[];
  access?: SpellcastingAccessState;
  resources?: Record<string, number>;
  abilityMods?: ActorState['character']['abilityMods'];
}): ActorState {
  const resources = {
    action: 1,
    bonus_action: 1,
    reaction: 1,
    spell_slot_1: 1,
    ...(input.resources ?? {}),
  };
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 12,
    capabilities: { actionIds: input.actionIds },
    character: {
      abilityMods: input.abilityMods ?? { str: 3, dex: 2, con: 1, int: 1, wis: 2, cha: 4 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources,
      maxResources: { ...resources },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    ...(input.access ? { spellcastingAccess: input.access } : {}),
  };
}

function knownShieldGrant(input: {
  grantId: string;
  sourceId: string;
  ability: 'int' | 'wis' | 'cha';
  slotResource: string;
  freeUseResource?: string;
}) {
  return {
    grantId: input.grantId,
    actionId: SHIELD.id,
    sourceId: input.sourceId,
    access: 'known' as const,
    level: 1,
    spellcastingAbility: input.ability,
    slotResource: input.slotResource,
    ...(input.freeUseResource ? { freeUseResource: input.freeUseResource } : {}),
  };
}

function access(grants: SpellcastingAccessState['grants']): SpellcastingAccessState {
  return { grants, preparedSources: {} };
}

function spellbookShieldAccess(prepared: boolean): SpellcastingAccessState {
  return {
    grants: [{
      grantId: 'wizard:shield',
      actionId: SHIELD.id,
      sourceId: 'CLASS-wizard',
      access: 'spellbook',
      level: 1,
      spellcastingAbility: 'int',
      slotResource: 'spell_slot_1',
    }],
    preparedSources: {
      'CLASS-wizard': {
        sourceId: 'CLASS-wizard',
        capacity: 1,
        availableActionIds: [SHIELD.id],
        preparedActionIds: prepared ? [SHIELD.id] : [],
      },
    },
  };
}

function enemyFacts(distanceFt: number): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

function accepted(result: ReturnType<InMemoryRulesSession['dispatch']>): UncommittedRuleEvent[] {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result.events;
}

function hitReactionSession(defender: ActorState, prefix: string) {
  const attacker = actor({ id: `${prefix}:attacker`, actionIds: [STRIKE.id] });
  const tape = createStrictRngTape([{ label: `${prefix}:attack`, sides: 20, value: 10 }]);
  const session = new InMemoryRulesSession(
    createWorld({ id: prefix, ruleset: RULESET, actors: [attacker, defender] }),
    catalog,
    {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(`${prefix}:id`),
    },
  );
  accepted(session.dispatch(command({
    schemaVersion: 1,
    type: 'UseAction',
    commandId: `${prefix}:strike`,
    expectedRevision: 0,
    rulesetContentHash: RULESET.contentHash,
    actorId: attacker.id,
    actionId: STRIKE.id,
    targetIds: [defender.id],
    factsByTarget: { [defender.id]: enemyFacts(5) },
  })));
  tape.assertExhausted();
  return session;
}

function reactionCommand(
  world: WorldState,
  commandId: string,
  spell?: { grantId?: string; preferFreeUse?: boolean },
): Extract<GameCommand, { type: 'ResolveDecision' }> {
  const pending = world.pendingResolution;
  if (!pending || (pending.type !== 'attack_reaction' && pending.type !== 'magic_missile_reaction')) {
    throw new Error('Expected a Shield reaction window');
  }
  return {
    schemaVersion: 1,
    type: 'ResolveDecision',
    commandId,
    expectedRevision: world.revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: {
      kind: 'reaction',
      actionId: SHIELD.id,
      ...(spell ? { spell } : {}),
    },
  };
}

function declaredShield(events: readonly UncommittedRuleEvent[]) {
  return events.find((event) => (
    event.payload.type === 'ActionDeclared'
    && event.payload.actionId === SHIELD.id
    && event.payload.timing === 'reaction'
  ));
}

describe('source-scoped spell reactions', () => {
  it('pays the selected Pact Magic slot for hit-triggered Shield and records complete provenance', () => {
    const defender = actor({
      id: 'pact-defender',
      actionIds: [SHIELD.id],
      access: access([knownShieldGrant({
        grantId: 'warlock:shield',
        sourceId: 'CLASS-warlock',
        ability: 'cha',
        slotResource: 'pact_slot_1',
      })]),
      resources: { pact_slot_1: 1 },
    });
    const session = hitReactionSession(defender, 'pact-hit');
    expect(session.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      request: {
        options: [{
          actionId: SHIELD.id,
          spellSources: [{
            grantId: 'warlock:shield',
            sourceId: 'CLASS-warlock',
            spellcastingAbility: 'cha',
            payment: { kind: 'slot', resource: 'pact_slot_1' },
          }],
        }],
      },
    });

    const events = accepted(session.dispatch(reactionCommand(
      session.getState(),
      'pact-hit:shield',
      { grantId: 'warlock:shield' },
    )));
    expect(session.getState().actors[defender.id].runtime.resources).toMatchObject({
      reaction: 0,
      pact_slot_1: 0,
      spell_slot_1: 1,
    });
    expect(session.getState().actors[defender.id].runtime.hp.temp).toBe(4);
    expect(declaredShield(events)?.payload).toMatchObject({
      type: 'ActionDeclared',
      spell: {
        grantId: 'warlock:shield',
        sourceId: 'CLASS-warlock',
        spellcastingAbility: 'cha',
        mode: 'normal',
        payment: { kind: 'slot', resource: 'pact_slot_1' },
      },
    });
    expect(events).not.toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: expect.objectContaining({ type: 'resource_spent', resource: 'spell_slot_1' }),
      }),
    }));
    expect(session.getState().actors[defender.id].runtime.hp.current).toBe(20);
  });

  it('uses a source-owned free use for Shield against Magic Missile without spending a slot', () => {
    const freeUseResource = 'freeuse-FEAT-magic-initiate:shield';
    const caster = actor({ id: 'missile-caster', actionIds: [MAGIC_MISSILE.id] });
    const defender = actor({
      id: 'freeuse-defender',
      actionIds: [SHIELD.id],
      access: access([knownShieldGrant({
        grantId: 'feat:shield',
        sourceId: 'FEAT-magic-initiate',
        ability: 'wis',
        slotResource: 'spell_slot_1',
        freeUseResource,
      })]),
      resources: { [freeUseResource]: 1 },
    });
    const session = new InMemoryRulesSession(
      createWorld({ id: 'freeuse-missile', ruleset: RULESET, actors: [caster, defender] }),
      catalog,
      {
        rng: () => { throw new Error('Shielded Magic Missile must not roll damage'); },
        clock: createLogicalClock(),
        nextId: createSequentialIdFactory('freeuse-missile:id'),
      },
    );
    accepted(session.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'freeuse-missile:cast',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: caster.id,
      actionId: MAGIC_MISSILE.id,
      targetIds: [defender.id],
      factsByTarget: { [defender.id]: enemyFacts(30) },
      choices: {
        magic_missile_dart_targets: [defender.id, defender.id, defender.id],
      },
      spell: { baseLevel: 1, castLevel: 1, sourceClass: 'wizard' },
    })));
    expect(session.getState().pendingResolution).toMatchObject({
      type: 'magic_missile_reaction',
      request: {
        options: [{
          actionId: SHIELD.id,
          spellSources: [{
            grantId: 'feat:shield',
            sourceId: 'FEAT-magic-initiate',
            spellcastingAbility: 'wis',
            payment: { kind: 'free_use', resource: freeUseResource },
          }],
        }],
      },
    });

    const events = accepted(session.dispatch(reactionCommand(
      session.getState(),
      'freeuse-missile:shield',
      { grantId: 'feat:shield' },
    )));
    expect(session.getState().actors[defender.id].runtime.resources).toMatchObject({
      reaction: 0,
      spell_slot_1: 1,
      [freeUseResource]: 0,
    });
    expect(session.getState().actors[defender.id].runtime.hp.temp).toBe(2);
    expect(declaredShield(events)?.payload).toMatchObject({
      spell: {
        grantId: 'feat:shield',
        sourceId: 'FEAT-magic-initiate',
        spellcastingAbility: 'wis',
        mode: 'normal',
        payment: { kind: 'free_use', resource: freeUseResource },
      },
    });
    expect(session.getState().actors[defender.id].runtime.hp.current).toBe(20);
  });

  it('rejects an omitted or foreign source for ambiguous Shield before events or costs', () => {
    const defender = actor({
      id: 'ambiguous-defender',
      actionIds: [SHIELD.id],
      access: access([
        knownShieldGrant({
          grantId: 'wizard:shield', sourceId: 'CLASS-wizard', ability: 'int', slotResource: 'spell_slot_1',
        }),
        knownShieldGrant({
          grantId: 'warlock:shield', sourceId: 'CLASS-warlock', ability: 'cha', slotResource: 'pact_slot_1',
        }),
      ]),
      resources: { pact_slot_1: 1 },
    });
    const session = hitReactionSession(defender, 'ambiguous-hit');
    expect(session.getState().pendingResolution).toMatchObject({
      request: { options: [{ spellSources: [{ grantId: 'wizard:shield' }, { grantId: 'warlock:shield' }] }] },
    });
    const before = session.getState();
    const eventCount = session.getEvents().length;

    expect(session.dispatch(reactionCommand(before, 'ambiguous-hit:missing-source'))).toMatchObject({
      status: 'rejected',
      code: 'InvalidSpellDeclaration',
      message: expect.stringContaining('grantId is required'),
    });
    expect(session.getState()).toBe(before);
    expect(session.getEvents()).toHaveLength(eventCount);

    expect(session.dispatch(reactionCommand(
      before,
      'ambiguous-hit:foreign-source',
      { grantId: 'cleric:shield' },
    ))).toMatchObject({
      status: 'rejected',
      code: 'InvalidSpellDeclaration',
      message: expect.stringContaining('does not own spell action'),
    });
    expect(session.getState()).toBe(before);
    expect(session.getEvents()).toHaveLength(eventCount);
    expect(before.actors[defender.id].runtime.resources).toMatchObject({
      reaction: 1, spell_slot_1: 1, pact_slot_1: 1,
    });
  });

  it.each([
    {
      label: 'missing grant',
      commandId: 'stale-hit:missing-grant',
      corrupt: (world: WorldState) => {
        world.actors['stale-defender'].spellcastingAccess!.grants = [];
      },
      message: 'has no actor-owned grant',
    },
    {
      label: 'unprepared spellbook spell',
      commandId: 'stale-hit:unprepared',
      corrupt: (world: WorldState) => {
        world.actors['stale-defender'].spellcastingAccess!
          .preparedSources['CLASS-wizard']!.preparedActionIds = [];
      },
      message: 'is not prepared',
    },
  ])('revalidates a stale reaction and rejects a $label atomically', ({
    corrupt, message, commandId,
  }) => {
    const defender = actor({
      id: 'stale-defender',
      actionIds: [SHIELD.id],
      access: spellbookShieldAccess(true),
    });
    const opening = hitReactionSession(defender, 'stale-hit');
    const checkpoint = JSON.parse(JSON.stringify(opening.getState())) as WorldState;
    corrupt(checkpoint);
    const resumed = new InMemoryRulesSession(checkpoint, catalog, {
      rng: () => { throw new Error('Rejected reaction must not resume the attack'); },
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: () => { throw new Error('Rejected reaction must not allocate ids'); },
    });
    const before = resumed.getState();
    const result = resumed.dispatch(reactionCommand(
      before,
      commandId,
      { grantId: 'wizard:shield' },
    ));

    expect(result).toMatchObject({
      status: 'rejected',
      code: 'InvalidSpellDeclaration',
      message: expect.stringContaining(message),
    });
    expect(resumed.getState()).toBe(before);
    expect(resumed.getEvents()).toEqual([]);
    expect(before.actors['stale-defender'].runtime.resources).toMatchObject({
      reaction: 1,
      spell_slot_1: 1,
    });
  });
});
