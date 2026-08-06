import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import {
  createWorld,
  type ActorState,
  type CommandResult,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type UncommittedRuleEvent,
  type WorldState,
} from './domain';
import { createStrictRngTape } from './determinism';
import {
  PROTECTION_2024_CAPABILITY_ID,
} from './protection';
import { PROTECTION_2024_SOURCE_ENTITY_IDS } from './testing/fightingStyleFixtures';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { createPactBladeInvocationState } from './warlockPacts';
import {
  PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
} from './testing/pactBladePolicyFixtures';
import { migrateWorldState } from './worldMigration';

const WARLOCK = 'actor:warlock';
const TARGET = 'actor:target';
const PROTECTOR = 'actor:protector';
const SOURCE = 'effect:pact-blade';
const BOND = 'action:pact-blade';
const DAGGER = 'card:pact-dagger';
const MAGIC_SWORD = 'card:magic-sword';
const MATERIAL_SPELL = 'spell:material';
const NO_MATERIAL_SPELL = 'spell:no-material';
const SHIELD = 'spell:shield';
const HASH = 'sha256:pact-blade-shared-integration';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'pact-blade-shared@1',
  contentHash: HASH,
  errataVersion: 'PHB-2024',
};

const DAGGER_CARD: Card = {
  id: DAGGER,
  card_number: 'CARD-pact-dagger',
  name: 'Dagger',
  type: 'weapon',
  weapon_type: 'dagger',
  damage_type: 'piercing',
  bonus_type: 'damage',
  bonus_value: '1d4',
  properties: ['finesse', 'light'],
  tags: ['simple', 'melee'],
  mechanics: {
    weapon_profile: {
      weapon_type: 'dagger',
      proficiency_category: 'simple',
      attack_ability: 'finesse',
      damage_lines: [{ dice: '1d4', type: 'piercing' }],
      default_attack_mode: 'melee',
      attack_modes: [
        { kind: 'melee', reach_ft: 5 },
        { kind: 'ranged', normal_ft: 20, long_ft: 60 },
      ],
      properties: ['finesse', 'light', 'thrown'],
      mastery_effect_id: 'effect:mastery:nick',
      ammo: null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
  description: '',
  rarity: 'common',
  is_template: 'false',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const MAGIC_SWORD_CARD: Card = {
  ...DAGGER_CARD,
  id: MAGIC_SWORD,
  card_number: 'CARD-magic-sword',
  name: 'Magic Sword',
  weapon_type: 'longsword',
  damage_type: 'slashing',
  bonus_value: '1d8',
  properties: [],
  tags: ['martial', 'melee', 'magic_weapon'],
  mechanics: {
    weapon_profile: {
      weapon_type: 'longsword',
      proficiency_category: 'martial',
      attack_ability: 'str',
      damage_lines: [{ dice: '1d8', type: 'slashing' }],
      versatile_grip: { dice: '1d10', type: 'slashing' },
      default_attack_mode: 'melee',
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: ['versatile'],
      mastery_effect_id: 'effect:mastery:sap',
      ammo: null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
};

const PHYSICAL_SHIELD: Card = {
  ...DAGGER_CARD,
  id: 'card:physical-shield',
  card_number: 'CARD-0200',
  name: 'Shield',
  type: 'shield',
  weapon_type: '',
  damage_type: '',
  bonus_value: '',
  properties: ['shield'],
  tags: ['armor', 'shield'],
};

const ACTIONS: RuleActionDefinition[] = [
  {
    id: BOND,
    name: 'Pact of the Blade',
    kind: 'nonSpell',
    sourceEntityIds: [SOURCE],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      primitive: {
        type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade',
        policy: PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
      },
      effects: [],
    },
  },
  {
    id: MATERIAL_SPELL,
    name: 'Material spell',
    kind: 'spell',
    sourceEntityIds: ['content:material-spell', 'CLASS-warlock'],
    spell: {
      level: 1,
      sourceClass: 'CLASS-warlock',
      components: { verbal: true, somatic: true, material: true },
    },
    mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [] },
  },
  {
    id: NO_MATERIAL_SPELL,
    name: 'No-material spell',
    kind: 'spell',
    sourceEntityIds: ['content:no-material-spell', 'CLASS-warlock'],
    spell: {
      level: 1,
      sourceClass: 'CLASS-warlock',
      components: { verbal: true, somatic: true, material: false },
    },
    mechanics: { activation: { mode: 'active', cost: [{ resource: 'action' }] }, effects: [] },
  },
  {
    id: SHIELD,
    name: 'Shield',
    kind: 'spell',
    sourceEntityIds: ['content:shield'],
    spell: {
      level: 1,
      sourceClass: 'wizard',
      components: { verbal: true, somatic: true, material: false },
    },
    mechanics: {
      activation: {
        mode: 'reaction',
        trigger: { event: 'hit_by_attack' },
        cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
      },
      effects: [{
        resolution: 'auto',
        result: [{
          kind: 'modifier', op: 'add', value: '+5', applies_to: { roll: 'ac' },
          duration: { type: 'until_start_of_next_turn' },
        }],
      }],
    },
  },
];

const CATALOG: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
  getCard: (id) => [DAGGER_CARD, MAGIC_SWORD_CARD, PHYSICAL_SHIELD]
    .find((card) => card.id === id),
};

const FACTS: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

function actor(id: string, input: {
  shield?: boolean;
  protection?: boolean;
  hp?: number;
} = {}): ActorState {
  const warlock = id === WARLOCK;
  const protection = input.protection === true;
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    ac: 12,
    capabilities: warlock ? {
      actionIds: [BOND, MATERIAL_SPELL, NO_MATERIAL_SPELL],
      featureSources: { 'warlock.pact.blade': [SOURCE] },
    } : {
      actionIds: input.shield ? [SHIELD] : [],
      ...(protection ? {
        featureSources: {
          [PROTECTION_2024_CAPABILITY_ID]: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
        },
      } : {}),
    },
    character: {
      abilityMods: warlock
        ? { str: -1, dex: 1, con: 2, int: 0, wis: 0, cha: 3 }
        : { str: 0, dex: 0, con: 0, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      classLevels: warlock ? { warlock: 1 } : { wizard: 1 },
      ...(protection ? {
        knownCards: [PHYSICAL_SHIELD],
        equippedCards: [PHYSICAL_SHIELD],
      } : {}),
      weaponProficiencies: [],
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: input.hp ?? 20, max: 20, temp: 0 },
      resources: {
        action: 1, bonus_action: 1, reaction: 1,
        ...(input.shield ? { spell_slot_1: 1 } : {}),
      },
      maxResources: {
        action: 1, bonus_action: 1, reaction: 1,
        ...(input.shield ? { spell_slot_1: 1 } : {}),
      },
      equipment: protection ? { off_hand: PHYSICAL_SHIELD.id } : {},
      inventory: protection ? [{ cardId: PHYSICAL_SHIELD.id, qty: 1 }] : [],
      activeEffects: [],
    },
    ...(warlock ? {
      warlockPacts: {
        blade: createPactBladeInvocationState({
          sourceEntityId: SOURCE,
          ownerActorId: id,
          bondActionId: BOND,
          lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
        }),
      },
    } : {}),
  };
}

function world(input: {
  shield?: boolean;
  protection?: boolean;
  hp?: number;
  existing?: boolean;
} = {}): WorldState {
  return createWorld({
    id: 'world:pact-blade-shared',
    ruleset: RULESET,
    actors: [
      actor(WARLOCK, { hp: input.hp }),
      actor(TARGET, { shield: input.shield }),
      ...(input.protection ? [actor(PROTECTOR, { protection: true })] : []),
    ],
    ...(input.existing ? {
      objects: [{
        id: 'object:magic-sword',
        name: 'Magic Sword instance',
        kind: 'item',
        size: 'small',
        itemCardId: MAGIC_SWORD,
        ownerActorId: WARLOCK,
        carriedByActorId: WARLOCK,
        heldByActorId: WARLOCK,
        heldInHand: 'off_hand',
        tags: ['magic_weapon'],
      }],
    } : {}),
  });
}

function environment(tape?: ReturnType<typeof createStrictRngTape>) {
  let clock = 10_000;
  return {
    rng: tape?.rng ?? (() => 0.5),
    clock: () => ++clock,
    nextId: () => 'ignored',
  };
}

function accepted(result: CommandResult): Extract<CommandResult, { status: 'accepted' }> {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

type WithoutCommandEnvelope<T> = T extends unknown
  ? Omit<T, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash'>
  : never;

type DispatchCommand = WithoutCommandEnvelope<Parameters<InMemoryRulesSession['dispatch']>[0]>;

function dispatch(
  session: InMemoryRulesSession,
  command: DispatchCommand,
): Extract<CommandResult, { status: 'accepted' }> {
  return accepted(session.dispatch({
    ...command,
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: HASH,
  } as Parameters<InMemoryRulesSession['dispatch']>[0]));
}

function startAndBond(session: InMemoryRulesSession) {
  dispatch(session, {
    type: 'StartEncounter', commandId: 'encounter', actorId: WARLOCK,
    initiative: [WARLOCK, TARGET],
  });
  dispatch(session, { type: 'StartTurn', commandId: 'turn', actorId: WARLOCK });
  return dispatch(session, {
    type: 'BondPactBlade', commandId: 'bond', actorId: WARLOCK,
    mode: 'conjure', weaponCardId: DAGGER, hand: 'main_hand',
  });
}

function beginAttack(session: InMemoryRulesSession): string {
  dispatch(session, { type: 'BeginAttackAction', commandId: 'begin', actorId: WARLOCK });
  const attack = Object.values(session.getState().attackActions).find((entry) => (
    entry.actorId === WARLOCK && entry.status === 'open'
  ));
  if (!attack) throw new Error('Expected open Attack action');
  return attack.id;
}

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((event) => event.payload.type === 'EngineEventRecorded'
    ? [event.payload.event]
    : []);
}

describe('Pact Blade shared command/event integration', () => {
  it('fails closed when the bond action is routed through generic UseAction', () => {
    const session = new InMemoryRulesSession(world(), CATALOG, environment());
    const before = session.getState();
    expect(session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'generic-bond-bypass',
      expectedRevision: before.revision,
      rulesetContentHash: HASH,
      actorId: WARLOCK,
      actionId: BOND,
      targetIds: [],
    })).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(session.getState()).toEqual(before);

    dispatch(session, {
      type: 'BondPactBlade', commandId: 'canonical-bond-after-rejection', actorId: WARLOCK,
      mode: 'conjure', weaponCardId: DAGGER, hand: 'main_hand',
    });
    expect(session.getState().actors[WARLOCK].runtime.resources.bonus_action).toBe(0);
    expect(Object.values(session.getState().objects)).toContainEqual(expect.objectContaining({
      itemCardId: DAGGER, heldByActorId: WARLOCK, heldInHand: 'main_hand',
    }));
  });

  it('conjures a held Card/item instance and attacks another actor with CHA, proficiency, and radiant damage', () => {
    const tape = createStrictRngTape([
      { label: 'Pact Blade attack', sides: 20, value: 10 },
      { label: 'Pact Blade radiant damage', sides: 4, value: 4 },
    ]);
    const initial = world();
    const session = new InMemoryRulesSession(initial, CATALOG, environment(tape));
    const bonded = startAndBond(session);
    expect(bonded.events.map((event) => event.payload.type)).toContain('PactBladeBonded');
    const pactObject = Object.values(session.getState().objects)[0];
    expect(pactObject).toMatchObject({
      itemCardId: DAGGER,
      carriedByActorId: WARLOCK,
      heldByActorId: WARLOCK,
      heldInHand: 'main_hand',
    });
    const attackActionId = beginAttack(session);
    const attack = dispatch(session, {
      type: 'PerformWeaponAttack', commandId: 'pact-attack', actorId: WARLOCK,
      attackActionId,
      weaponCardId: DAGGER,
      weaponObjectId: pactObject.id,
      pactBlade: { abilityChoice: 'cha', damageType: 'radiant' },
      targetActorId: TARGET,
      facts: FACTS,
    });
    tape.assertExhausted();
    expect(attack.events.map((event) => event.payload.type)).toContain('PactBladeAttackProjected');
    expect(attack.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        facts: expect.objectContaining({
          proficient: true,
          pactBlade: expect.objectContaining({
            attackAbility: 'cha', damageAbility: 'cha', resolvedDamageType: 'radiant',
          }),
        }),
      }),
    }));
    expect(engineEvents(attack.events)).toContainEqual(expect.objectContaining({
      type: 'damage', amount: 7, damageType: 'radiant',
    }));
    expect(session.getState().actors[TARGET].runtime.hp.current).toBe(13);
    expect(session.getState().actors[WARLOCK].runtime.equipment).toEqual({});
    expect(migrateWorldState(JSON.parse(JSON.stringify(session.getState()))))
      .toEqual(session.getState());
    expect(foldEvents(initial, session.getEvents())).toEqual(session.getState());
  });

  it('persists the Pact projection through Shield/reload and keeps lifecycle observations locked while pending', () => {
    const tape = createStrictRngTape([{ label: 'Pact Blade attack before Shield', sides: 20, value: 10 }]);
    const initial = world({ shield: true });
    const opening = new InMemoryRulesSession(initial, CATALOG, environment(tape));
    startAndBond(opening);
    const attackActionId = beginAttack(opening);
    dispatch(opening, {
      type: 'PerformWeaponAttack', commandId: 'shielded-pact-attack', actorId: WARLOCK,
      attackActionId,
      weaponCardId: DAGGER,
      weaponObjectId: Object.values(opening.getState().objects)[0].id,
      pactBlade: { abilityChoice: 'cha', damageType: 'psychic' },
      targetActorId: TARGET,
      facts: FACTS,
    });
    tape.assertExhausted();
    const paused = opening.getState();
    expect(paused.pendingResolution).toMatchObject({
      type: 'attack_reaction',
      pactBladeProjection: {
        weaponCardId: DAGGER,
        abilityChoice: 'cha',
        damageChoice: 'psychic',
        resolvedDamageType: 'psychic',
      },
    });
    const blockedDeath = opening.dispatch({
      schemaVersion: 1,
      type: 'AdjudicateActorDeath',
      commandId: 'blocked-death',
      expectedRevision: paused.revision,
      rulesetContentHash: HASH,
      actorId: WARLOCK,
      adjudication: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle',
        factId: 'death:blocked', actorId: WARLOCK, adjudicatedBy: 'gm',
        observedAtWorldRevision: paused.revision, rulesetContentHash: HASH,
      },
    });
    expect(blockedDeath).toMatchObject({ status: 'rejected', code: 'ResolutionInProgress' });

    const checkpoint = migrateWorldState(JSON.parse(JSON.stringify(paused)));
    const restored = new InMemoryRulesSession(checkpoint, CATALOG, {
      rng: () => { throw new Error('Shielded miss must not roll Pact Blade damage'); },
      clock: () => 20_000,
      nextId: () => 'ignored',
    });
    const pending = checkpoint.pendingResolution;
    if (!pending || pending.type !== 'attack_reaction') throw new Error('Expected Shield continuation');
    dispatch(restored, {
      type: 'ResolveDecision', commandId: 'accept-shield', actorId: TARGET,
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'reaction', actionId: SHIELD },
    });
    expect(restored.getState().pendingResolution).toBeNull();
    expect(restored.getState().actors[TARGET].runtime.hp.current).toBe(20);
    expect(restored.getState().actors[WARLOCK].runtime.equipment).toEqual({});
    expect(foldEvents(initial, [...opening.getEvents(), ...restored.getEvents()]))
      .toEqual(restored.getState());
  });

  it('persists the Pact projection through Protection, reload, Shield, and a second reload', () => {
    const tape = createStrictRngTape([
      { label: 'Pact Blade attack', sides: 20, value: 15 },
      { label: 'Pact Blade attack', sides: 20, value: 14 },
      { label: 'Pact Blade psychic damage', sides: 4, value: 3 },
    ]);
    const initial = world({ shield: true, protection: true });
    const opening = new InMemoryRulesSession(initial, CATALOG, environment(tape));
    startAndBond(opening);
    const attackActionId = beginAttack(opening);
    dispatch(opening, {
      type: 'PerformWeaponAttack', commandId: 'protected-pact-attack', actorId: WARLOCK,
      attackActionId,
      weaponCardId: DAGGER,
      weaponObjectId: Object.values(opening.getState().objects)[0].id,
      pactBlade: { abilityChoice: 'cha', damageType: 'psychic' },
      targetActorId: TARGET,
      facts: FACTS,
      protectionCandidates: [{
        factsSource: 'scenario',
        boardRevision: FACTS.boardRevision,
        protectorActorId: PROTECTOR,
        protectorCanSeeAttacker: true,
        protectorDistanceToTargetFt: 5,
      }],
    });
    expect(tape.consumed()).toBe(0);
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'protection_reaction',
      request: { actorId: PROTECTOR },
      pactBladeProjection: {
        weaponCardId: DAGGER,
        weaponHand: 'main',
        abilityChoice: 'cha',
        damageChoice: 'psychic',
        resolvedDamageType: 'psychic',
      },
    });

    const protectionCheckpoint = migrateWorldState(JSON.parse(JSON.stringify(opening.getState())));
    const protectedSession = new InMemoryRulesSession(
      protectionCheckpoint,
      CATALOG,
      environment(tape),
    );
    const protection = protectionCheckpoint.pendingResolution;
    if (!protection || protection.type !== 'protection_reaction') {
      throw new Error('Expected Protection continuation');
    }
    dispatch(protectedSession, {
      type: 'ResolveDecision', commandId: 'use-protection', actorId: PROTECTOR,
      resolutionId: protection.id,
      requestId: protection.request.id,
      response: { kind: 'reaction', actionId: PROTECTION_2024_CAPABILITY_ID },
    });
    expect(tape.consumed()).toBe(2);
    expect(protectedSession.getState().actors[PROTECTOR].runtime.resources.reaction).toBe(0);
    expect(protectedSession.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      request: { actorId: TARGET },
      pactBladeProjection: {
        weaponCardId: DAGGER,
        weaponHand: 'main',
        abilityChoice: 'cha',
        damageChoice: 'psychic',
        resolvedDamageType: 'psychic',
      },
    });

    const shieldCheckpoint = migrateWorldState(JSON.parse(JSON.stringify(protectedSession.getState())));
    const shieldSession = new InMemoryRulesSession(shieldCheckpoint, CATALOG, environment(tape));
    const shield = shieldCheckpoint.pendingResolution;
    if (!shield || shield.type !== 'attack_reaction') throw new Error('Expected Shield continuation');
    const resumed = dispatch(shieldSession, {
      type: 'ResolveDecision', commandId: 'decline-shield-after-protection', actorId: TARGET,
      resolutionId: shield.id,
      requestId: shield.request.id,
      response: { kind: 'reaction', actionId: null },
    });
    tape.assertExhausted();
    expect(engineEvents(resumed.events)).toContainEqual(expect.objectContaining({
      type: 'damage', amount: 6, damageType: 'psychic',
    }));
    expect(shieldSession.getState().actors[TARGET].runtime.hp.current).toBe(14);
    expect(shieldSession.getState().actors[WARLOCK].runtime.equipment).toEqual({});
    expect(foldEvents(initial, [
      ...opening.getEvents(), ...protectedSession.getEvents(), ...shieldSession.getEvents(),
    ])).toEqual(shieldSession.getState());
  });

  it('uses the held blade only for M, derives touched Card identity, and preserves an existing item', () => {
    const touchSession = new InMemoryRulesSession(world({ existing: true }), CATALOG, environment());
    const touched = dispatch(touchSession, {
      type: 'BondPactBlade', commandId: 'touch', actorId: WARLOCK,
      mode: 'touch_existing', weaponObjectId: 'object:magic-sword',
      facts: {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
        lineOfSight: true, touched: true,
      },
    });
    expect(touched.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'PactBladeBonded', mode: 'touch_existing',
        activeBlade: expect.objectContaining({ weaponCardId: MAGIC_SWORD }),
      }),
    }));
    expect(touchSession.getState().objects['object:magic-sword']).toMatchObject({
      itemCardId: MAGIC_SWORD, heldByActorId: WARLOCK, heldInHand: 'off_hand',
    });

    const focusSession = new InMemoryRulesSession(world(), CATALOG, environment());
    dispatch(focusSession, {
      type: 'BondPactBlade', commandId: 'focus-bond', actorId: WARLOCK,
      mode: 'conjure', weaponCardId: DAGGER, hand: 'main_hand',
    });
    const objectId = Object.values(focusSession.getState().objects)[0].id;
    const noMaterial = focusSession.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'focus-rejected',
      expectedRevision: focusSession.getState().revision,
      rulesetContentHash: HASH,
      actorId: WARLOCK,
      actionId: NO_MATERIAL_SPELL,
      targetIds: [],
      spell: { baseLevel: 1, focusObjectId: objectId, focusHand: 'main_hand' },
    });
    expect(noMaterial).toMatchObject({ status: 'rejected', code: 'InvalidActionDefinition' });
    const cast = dispatch(focusSession, {
      type: 'UseAction', commandId: 'focus-cast', actorId: WARLOCK,
      actionId: MATERIAL_SPELL,
      targetIds: [],
      spell: { baseLevel: 1, focusObjectId: objectId, focusHand: 'main_hand' },
    });
    expect(cast.events.map((event) => event.payload.type))
      .toEqual(expect.arrayContaining(['PactBladeMaterialFocusProjected', 'ActionDeclared']));
    expect(cast.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        spell: expect.objectContaining({ focusObjectId: objectId, focusHand: 'main_hand' }),
      }),
    }));
  });

  it('does not infer death from 0 HP and atomically cleans Blade, concentration, effects, and grapples on explicit death', () => {
    const session = new InMemoryRulesSession(world({ hp: 0 }), CATALOG, environment());
    dispatch(session, {
      type: 'BondPactBlade', commandId: 'death-bond', actorId: WARLOCK,
      mode: 'conjure', weaponCardId: DAGGER, hand: 'main_hand',
    });
    const before = JSON.parse(JSON.stringify(session.getState())) as WorldState;
    expect(before.actors[WARLOCK].lifecycle).toEqual({ status: 'alive' });
    expect(before.actors[WARLOCK].warlockPacts?.blade?.activeBond).not.toBeNull();
    before.actors[TARGET].runtime.activeEffects.push({
      id: 'effect:concentration', name: 'Concentrated effect', mechanics: {
        kind: 'modifier', duration: { concentration: true },
      }, source: MATERIAL_SPELL, ownerId: TARGET, sourceId: WARLOCK,
    }, {
      id: 'grapple:g1', name: 'Grappled',
      mechanics: { kind: 'condition', value: 'grappled', grappleId: 'g1' },
      expiry: 'manual', source: 'system:dnd5e-2024:unarmed-strike',
      ownerId: TARGET, sourceId: WARLOCK,
    });
    before.concentrations[WARLOCK] = {
      id: 'concentration:1', sourceActorId: WARLOCK, actionId: MATERIAL_SPELL,
      startedAtRevision: before.revision,
      effectLinks: [{ actorId: TARGET, effectId: 'effect:concentration' }],
    };
    before.objects['object:dancing-light'] = {
      id: 'object:dancing-light', name: 'Dancing Light', kind: 'spell_effect', size: 'tiny',
      sourceActorId: WARLOCK, sourceActionId: MATERIAL_SPELL, roundsLeft: 10,
      distanceFromSourceFt: 5,
      dancingLight: { groupId: 'group:1', form: 'individual', dimRadiusFt: 10 },
    };
    before.grapples.g1 = {
      id: 'g1', grapplerActorId: WARLOCK, targetActorId: TARGET,
      sourcePart: 'main_hand', escapeDc: 13, reachFt: 5,
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike'],
      startedAtRevision: before.revision,
    };
    const deathSession = new InMemoryRulesSession(before, CATALOG, environment());
    const death = dispatch(deathSession, {
      type: 'AdjudicateActorDeath', commandId: 'death', actorId: WARLOCK,
      adjudication: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle',
        factId: 'death:1', actorId: WARLOCK, adjudicatedBy: 'gm:1',
        observedAtWorldRevision: before.revision, rulesetContentHash: HASH,
      },
    });
    expect(death.events.map((event) => event.payload.type)).toEqual(expect.arrayContaining([
      'ActorDeathAdjudicated', 'PactBladeEndedOnOwnerDeath',
      'ConcentrationCleared', 'WorldObjectMutationRecorded', 'GrappleEnded',
    ]));
    const after = deathSession.getState();
    expect(after.actors[WARLOCK].lifecycle).toMatchObject({ status: 'dead' });
    expect(after.actors[WARLOCK].warlockPacts?.blade?.activeBond).toBeNull();
    expect(Object.values(after.objects).some((object) => object.tags?.includes('pact_weapon'))).toBe(false);
    expect(after.objects['object:dancing-light']).toBeUndefined();
    expect(after.concentrations[WARLOCK]).toBeUndefined();
    expect(after.actors[TARGET].runtime.activeEffects).toEqual([]);
    expect(after.grapples).toEqual({});

    expect(deathSession.dispatch({
      schemaVersion: 1, type: 'BeginAttackAction', commandId: 'dead-command',
      expectedRevision: after.revision, rulesetContentHash: HASH, actorId: WARLOCK,
    })).toMatchObject({ status: 'rejected', code: 'ActorDead' });
    expect(deathSession.dispatch({
      schemaVersion: 1, type: 'AdjudicateActorDeath', commandId: 'duplicate-death',
      expectedRevision: after.revision, rulesetContentHash: HASH, actorId: WARLOCK,
      adjudication: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle',
        factId: 'death:2', actorId: WARLOCK, adjudicatedBy: 'gm:1',
        observedAtWorldRevision: after.revision, rulesetContentHash: HASH,
      },
    })).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(deathSession.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'dead-initiative',
      expectedRevision: after.revision, rulesetContentHash: HASH, actorId: TARGET,
      initiative: [TARGET, WARLOCK],
    })).toMatchObject({ status: 'rejected', code: 'InvalidInitiative' });
  });

  it('allows distance observations out of turn and ends the conjured bond at sixty seconds', () => {
    const session = new InMemoryRulesSession(world(), CATALOG, environment());
    startAndBond(session);
    dispatch(session, { type: 'EndTurn', commandId: 'end-warlock-turn', actorId: WARLOCK });
    const objectId = Object.values(session.getState().objects)[0].id;
    dispatch(session, {
      type: 'ObservePactBladeDistance', commandId: 'distance-59', actorId: WARLOCK,
      weaponObjectId: objectId,
      facts: { factsSource: 'scenario', boardRevision: 2, distanceFt: 6, elapsedSeconds: 59 },
    });
    expect(session.getState().actors[WARLOCK].warlockPacts?.blade?.activeBond)
      .toMatchObject({ continuousSeparationSeconds: 59, lastDistanceBoardRevision: 2 });
    dispatch(session, {
      type: 'ObservePactBladeDistance', commandId: 'distance-60', actorId: WARLOCK,
      weaponObjectId: objectId,
      facts: { factsSource: 'scenario', boardRevision: 3, distanceFt: 6, elapsedSeconds: 1 },
    });
    expect(session.getState().actors[WARLOCK].warlockPacts?.blade?.activeBond).toBeNull();
    expect(session.getState().objects[objectId]).toBeUndefined();
  });
});
