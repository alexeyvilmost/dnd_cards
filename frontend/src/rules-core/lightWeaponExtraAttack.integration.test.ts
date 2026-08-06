import { describe, expect, it } from 'vitest';
import { CARD_DAGGER, CARD_LONGSWORD } from '../mvp/fixtures';
import type { EngineEvent } from '../mvp/contracts';
import type { Card } from '../types';
import {
  canonicalStringify,
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
  type ProtectionReactionCandidateFacts,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
} from './domain';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  createMicroMvpFightingStylePassiveMechanics,
} from './testing/fightingStyleFixtures';
import { lightWeaponExtraAttackUseKey } from './lightWeaponExtraAttack';
import { PROTECTION_2024_CAPABILITY_ID } from './protection';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { SYSTEM_ACTION_IDS } from './systemActions';
import { migrateWorldState } from './worldMigration';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'light-extra-attack-test',
  contentHash: 'sha256:light-extra-attack-test',
  errataVersion: '2024-test',
};

const DAGGER: Card = { ...CARD_DAGGER, weapon_type: 'dagger' };
const LONGSWORD: Card = { ...CARD_LONGSWORD, weapon_type: 'longsword' };
const DAGGER_MECHANICS = DAGGER.mechanics as Record<string, unknown>;
const DAGGER_PROFILE = DAGGER_MECHANICS.weapon_profile as Record<string, unknown>;

const SCIMITAR: Card = {
  ...DAGGER,
  id: 'card-scimitar',
  card_number: 'ITEM-scimitar',
  name: 'Скимитар',
  weapon_type: 'scimitar',
  bonus_value: '1d6',
  damage_type: 'slashing',
  properties: ['light', 'finesse'],
  mechanics: {
    ...DAGGER_MECHANICS,
    weapon_profile: {
      ...DAGGER_PROFILE,
      weapon_type: 'scimitar',
      proficiency_category: 'martial',
      damage_lines: [{ dice: '1d6', type: 'slashing' }],
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: ['finesse', 'light'],
      mastery_effect_id: 'mastery:scimitar',
    },
  },
};

const PHYSICAL_SHIELD: Card = {
  ...DAGGER,
  id: 'card-protection-shield',
  card_number: 'CARD-0200',
  name: 'Щит',
  type: 'shield',
  weapon_type: null,
  bonus_value: '+2',
  properties: ['shield'],
};

const SHIELD_REACTION: RuleActionDefinition = {
  id: 'spell.test-shield',
  name: 'Shield',
  kind: 'spell',
  sourceEntityIds: ['spell.test-shield'],
  spell: { level: 1, sourceClass: 'wizard' },
  mechanics: {
    activation: {
      mode: 'reaction',
      trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
    },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'modifier', op: 'add', value: '+5',
        applies_to: { roll: 'ac' },
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

const CATALOG: RulesCatalog = {
  getAction: (id) => id === SHIELD_REACTION.id ? SHIELD_REACTION : undefined,
};

type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;
type LightCommandInput = Omit<
  Extract<GameCommand, { type: 'PerformLightWeaponExtraAttack' }>,
  'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'
>;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function accepted(result: CommandResult) {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function command(
  session: InMemoryRulesSession,
  actorId: string,
  input: CommandInput,
): GameCommand {
  return {
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId,
    ...input,
  } as GameCommand;
}

function dispatch(session: InMemoryRulesSession, actorId: string, input: CommandInput) {
  return accepted(session.dispatch(command(session, actorId, input)));
}

function rejectWithoutMutation(
  session: InMemoryRulesSession,
  actorId: string,
  input: CommandInput,
  code: string,
) {
  const before = copy(session.getState());
  const result = session.dispatch(command(session, actorId, input));
  expect(result).toMatchObject({ status: 'rejected', code });
  expect(session.getState()).toEqual(before);
}

function facts(state: ReturnType<InMemoryRulesSession['getState']>, distanceFt = 5): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: state.revision,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

function twfPassive(): Record<string, unknown> {
  const result = createMicroMvpFightingStylePassiveMechanics({
    kind: 'twoWeaponFighting',
    sourceEntityIds: MICRO_MVP_FIGHTING_STYLE_ENTITIES.twoWeaponFighting.sourceEntityIds,
  });
  if (!result) throw new Error('Missing canonical Two-Weapon Fighting passive');
  return result;
}

function actor(input: {
  id: string;
  main?: Card;
  off?: Card;
  abilityModifier?: number;
  twf?: boolean;
  passives?: ActorState['passives'];
  shieldReaction?: boolean;
}): ActorState {
  const main = input.main;
  const off = input.off;
  const cards = [main, off].filter((card): card is Card => card !== undefined);
  const abilityModifier = input.abilityModifier ?? 3;
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 1,
    capabilities: { actionIds: input.shieldReaction ? [SHIELD_REACTION.id] : [] },
    character: {
      abilityMods: {
        str: abilityModifier, dex: abilityModifier, con: 1, int: 0, wis: 0, cha: 0,
      },
      profBonus: 2,
      level: 1,
      knownCards: copy(cards),
      equippedCards: copy(cards),
      weaponProficiencies: cards.flatMap((card) => card.weapon_type ? [card.weapon_type] : []),
    },
    runtime: {
      hp: { current: 100, max: 100, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      equipment: {
        ...(main ? { main_hand: main.id } : {}),
        ...(off ? { off_hand: off.id } : {}),
      },
      inventory: cards.map((card) => ({ cardId: card.id, qty: 1 })),
      activeEffects: [],
      firedThisTurn: [],
    },
    passives: input.passives ?? (input.twf ? [twfPassive()] : []),
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function engineEvents(result: ReturnType<typeof accepted>): EngineEvent[] {
  return result.events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

function damageEvent(result: ReturnType<typeof accepted>) {
  const damage = engineEvents(result).find((event): event is Extract<EngineEvent, { type: 'damage' }> => (
    event.type === 'damage'
  ));
  if (!damage?.roll) throw new Error('Expected weapon damage roll');
  return damage;
}

function ready(input: {
  id: string;
  abilityModifier?: number;
  twf?: boolean;
  passives?: ActorState['passives'];
  main?: Card;
  off?: Card;
  dice?: readonly DieTapeEntry[];
  extraActors?: ActorState[];
  targetShieldReaction?: boolean;
}) {
  const attacker = actor({
    id: 'attacker',
    main: input.main ?? DAGGER,
    off: input.off ?? SCIMITAR,
    abilityModifier: input.abilityModifier,
    twf: input.twf,
    passives: input.passives,
  });
  const target = actor({ id: 'target', shieldReaction: input.targetShieldReaction });
  const initial = createWorld({
    id: input.id,
    ruleset: RULESET,
    actors: [attacker, target, ...(input.extraActors ?? [])],
  });
  const tape = createStrictRngTape(input.dice ?? [
    { label: 'qualifying attack', sides: 20, value: 10 },
    { label: 'qualifying damage', sides: Number((input.main ?? DAGGER).bonus_value?.match(/d(\d+)/)?.[1] ?? 4), value: 2 },
    { label: 'extra attack', sides: 20, value: 10 },
    { label: 'extra damage', sides: 6, value: 4 },
  ]);
  const session = new InMemoryRulesSession(initial, CATALOG, {
    rng: tape.rng,
    clock: createLogicalClock(70_000),
    nextId: createSequentialIdFactory(`light:${input.id}`),
  });
  dispatch(session, 'attacker', {
    type: 'StartEncounter', commandId: `${input.id}:encounter`,
    initiative: ['attacker', 'target', ...(input.extraActors ?? []).map((entry) => entry.id)],
  });
  dispatch(session, 'attacker', { type: 'StartTurn', commandId: `${input.id}:turn` });
  dispatch(session, 'attacker', { type: 'BeginAttackAction', commandId: `${input.id}:begin` });
  const attackActionId = Object.values(session.getState().attackActions)[0].id;
  dispatch(session, 'attacker', {
    type: 'PerformWeaponAttack', commandId: `${input.id}:qualifying`, attackActionId,
    weaponCardId: (input.main ?? DAGGER).id,
    targetActorId: 'target', facts: facts(session.getState()),
    ...((input.extraActors ?? []).some((entry) => (
      entry.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID]
    )) ? {
      protectionCandidates: (input.extraActors ?? []).flatMap((entry) => (
        entry.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID]
          ? [{
            factsSource: 'scenario' as const,
            boardRevision: session.getState().revision,
            protectorActorId: entry.id,
            protectorCanSeeAttacker: true,
            protectorDistanceToTargetFt: 10,
          }]
          : []
      )),
    } : {}),
  });
  return { attacker, target, initial, session, tape, attackActionId };
}

describe('canonical Light-property Bonus Action attack vertical', () => {
  it('applies RAW positive/negative damage modifiers exactly once with and without TWF', () => {
    const lanes = [
      { id: 'base-positive', ability: 3, twf: false, amount: 4, modifiers: [] },
      {
        id: 'base-negative', ability: -2, twf: false, amount: 2,
        modifiers: [{ value: -2, source: 'СИЛ' }],
      },
      {
        id: 'twf-positive', ability: 3, twf: true, amount: 7,
        modifiers: [{ value: 3, source: 'Fighting Style: Two-Weapon Fighting' }],
      },
      {
        id: 'twf-negative', ability: -2, twf: true, amount: 2,
        modifiers: [{ value: -2, source: 'СИЛ' }],
      },
    ] as const;
    for (const lane of lanes) {
      const test = ready({ id: lane.id, abilityModifier: lane.ability, twf: lane.twf });
      const ledger = copy(test.session.getState().attackActions[test.attackActionId]);
      const result = dispatch(test.session, 'attacker', {
        type: 'PerformLightWeaponExtraAttack', commandId: `${lane.id}:extra`,
        attackActionId: test.attackActionId, weaponCardId: SCIMITAR.id,
        targetActorId: 'target', facts: facts(test.session.getState()),
      });
      const damage = damageEvent(result);
      expect(damage.amount, lane.id).toBe(lane.amount);
      expect(damage.roll!.modifiers, lane.id).toEqual(lane.modifiers);
      expect(test.session.getState().attackActions[test.attackActionId], lane.id).toEqual(ledger);
      expect(test.session.getState().actors.attacker.runtime.resources.bonus_action, lane.id).toBe(0);
      expect(test.session.getState().actors.attacker.runtime.firedThisTurn, lane.id).toContain(
        lightWeaponExtraAttackUseKey(test.attackActionId),
      );
      const declaration = result.events.find((event) => (
        event.payload.type === 'ActionDeclared'
      ));
      expect(declaration?.payload, lane.id).toMatchObject({
        type: 'ActionDeclared', actionId: SYSTEM_ACTION_IDS.lightExtraAttack,
        facts: { qualifyingWeaponCardId: DAGGER.id, weaponCardId: SCIMITAR.id },
      });
      test.tape.assertExhausted();
      expect(foldEvents(copy(test.initial), copy(test.session.getEvents())), lane.id)
        .toEqual(test.session.getState());
    }
  });

  it('attributes a Light attack from modifier mechanics, never a passive display name', () => {
    const declared = twfPassive();
    declared.name = 'Локализованный стиль';
    declared.sourceEntityIds = ['custom:twf:mechanics'];
    const sameNameNarrative = {
      name: 'Fighting Style: Two-Weapon Fighting',
      sourceEntityIds: ['forged:name-only'],
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'No rule' }] }],
    };
    const test = ready({
      id: 'twf-mechanics-provenance',
      passives: [sameNameNarrative, declared],
    });
    const result = dispatch(test.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'twf-mechanics-provenance:extra',
      attackActionId: test.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(test.session.getState()),
    });
    expect(damageEvent(result).amount).toBe(7);
    const declaration = result.events.find((event) => event.payload.type === 'ActionDeclared');
    expect(declaration?.obligationIds).toContain('entity:custom:twf:mechanics');
    expect(declaration?.obligationIds).not.toContain('entity:forged:name-only');
    test.tape.assertExhausted();
  });

  it('rejects non-Light, same-weapon, no qualifying attack, wrong turn, repeat, and no BA without mutation', () => {
    const normal = ready({ id: 'reject-normal' });
    const commandFor = (id: string, weaponCardId: string): LightCommandInput => ({
      type: 'PerformLightWeaponExtraAttack', commandId: id,
      attackActionId: normal.attackActionId, weaponCardId,
      targetActorId: 'target', facts: facts(normal.session.getState()),
    });

    const nonLightState = copy(normal.session.getState());
    nonLightState.actors.attacker.character.knownCards!.push(copy(LONGSWORD));
    nonLightState.actors.attacker.character.equippedCards!.push(copy(LONGSWORD));
    nonLightState.actors.attacker.runtime.equipment.off_hand = LONGSWORD.id;
    nonLightState.actors.attacker.runtime.inventory.push({ cardId: LONGSWORD.id, qty: 1 });
    const nonLight = new InMemoryRulesSession(nonLightState, CATALOG, {
      rng: () => { throw new Error('rejected command must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory('reject'),
    });
    rejectWithoutMutation(nonLight, 'attacker', {
      ...commandFor('reject:non-light', LONGSWORD.id),
      facts: facts(nonLight.getState()),
    }, 'InvalidEquipmentState');
    rejectWithoutMutation(normal.session, 'attacker', commandFor('reject:same', DAGGER.id), 'InvalidEquipmentState');

    const noQualifying = ready({ id: 'reject-no-qualifying', main: LONGSWORD, off: SCIMITAR });
    rejectWithoutMutation(noQualifying.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'reject:no-qualifying',
      attackActionId: noQualifying.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(noQualifying.session.getState()),
    }, 'InvalidEquipmentState');

    const noBonusState = copy(normal.session.getState());
    noBonusState.actors.attacker.runtime.resources.bonus_action = 0;
    const noBonus = new InMemoryRulesSession(noBonusState, CATALOG, {
      rng: () => { throw new Error('rejected command must not roll'); },
      clock: createLogicalClock(), nextId: createSequentialIdFactory('reject'),
    });
    rejectWithoutMutation(noBonus, 'attacker', {
      ...commandFor('reject:no-ba', SCIMITAR.id), facts: facts(noBonus.getState()),
    }, 'InsufficientResources');

    dispatch(normal.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'reject:first-extra',
      attackActionId: normal.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(normal.session.getState()),
    });
    rejectWithoutMutation(normal.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'reject:repeat',
      attackActionId: normal.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(normal.session.getState()),
    }, 'InvalidActionTiming');

    const wrongTurn = ready({ id: 'reject-wrong-turn' });
    dispatch(wrongTurn.session, 'attacker', { type: 'EndTurn', commandId: 'wrong:end-attacker' });
    dispatch(wrongTurn.session, 'target', { type: 'StartTurn', commandId: 'wrong:start-target' });
    dispatch(wrongTurn.session, 'target', { type: 'EndTurn', commandId: 'wrong:end-target' });
    dispatch(wrongTurn.session, 'attacker', { type: 'StartTurn', commandId: 'wrong:start-attacker-again' });
    rejectWithoutMutation(wrongTurn.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'reject:wrong-turn',
      attackActionId: wrongTurn.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(wrongTurn.session.getState()),
    }, 'InvalidActionTiming');
  });

  it('persists selected hand/Card through Protection then Shield and resumes without mutating the Attack ledger', () => {
    const protector = actor({ id: 'protector' });
    protector.capabilities = {
      actionIds: [],
      featureSources: {
        [PROTECTION_2024_CAPABILITY_ID]: [
          ...MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds,
        ],
      },
    };
    protector.character.knownCards = [copy(PHYSICAL_SHIELD)];
    protector.character.equippedCards = [copy(PHYSICAL_SHIELD)];
    protector.runtime.equipment = { off_hand: PHYSICAL_SHIELD.id };
    protector.runtime.inventory = [{ cardId: PHYSICAL_SHIELD.id, qty: 1 }];
    const test = ready({
      id: 'light-reactions',
      extraActors: [protector],
      targetShieldReaction: true,
      dice: [
        { label: 'qualifying attack misses before Shield', sides: 20, value: 1 },
        { label: 'protected Light high d20', sides: 20, value: 10 },
        { label: 'protected Light low d20', sides: 20, value: 9 },
        { label: 'Light damage after declined Shield', sides: 6, value: 4 },
      ],
    });
    const ledger = copy(test.session.getState().attackActions[test.attackActionId]);
    const candidate: ProtectionReactionCandidateFacts = {
      factsSource: 'scenario',
      boardRevision: test.session.getState().revision,
      protectorActorId: 'protector',
      protectorCanSeeAttacker: true,
      protectorDistanceToTargetFt: 5,
    };
    const opened = dispatch(test.session, 'attacker', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'light:protected:extra',
      attackActionId: test.attackActionId, weaponCardId: SCIMITAR.id,
      targetActorId: 'target', facts: facts(test.session.getState()),
      protectionCandidates: [candidate],
    });
    expect(engineEvents(opened).filter((event) => (
      event.type === 'roll' || event.type === 'damage'
    ))).toEqual([]);
    expect(test.tape.consumed()).toBe(1);
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'protection_reaction',
      actionId: SYSTEM_ACTION_IDS.lightExtraAttack,
      weaponHand: 'off', weaponCardId: SCIMITAR.id,
    });
    expect(test.session.getState().attackActions[test.attackActionId]).toEqual(ledger);
    const checkpoint = migrateWorldState(copy(test.session.getState()));
    expect(migrateWorldState(copy(checkpoint))).toEqual(checkpoint);

    const protection = checkpoint.pendingResolution;
    if (!protection || protection.type !== 'protection_reaction') {
      throw new Error('Expected persisted Protection decision');
    }
    const restored = new InMemoryRulesSession(checkpoint, CATALOG, {
      rng: test.tape.rng,
      clock: createLogicalClock(80_000),
      nextId: createSequentialIdFactory('light:reaction:restored'),
    });
    dispatch(restored, 'protector', {
      type: 'ResolveDecision', commandId: 'light:protected:use',
      resolutionId: protection.id, requestId: protection.request.id,
      response: { kind: 'reaction', actionId: PROTECTION_2024_CAPABILITY_ID },
    });
    expect(restored.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      actionId: SYSTEM_ACTION_IDS.lightExtraAttack,
      weaponHand: 'off', weaponCardId: SCIMITAR.id,
      request: { actorId: 'target' },
    });
    const shieldCheckpoint = migrateWorldState(copy(restored.getState()));
    expect(migrateWorldState(copy(shieldCheckpoint))).toEqual(shieldCheckpoint);
    const shieldRestored = new InMemoryRulesSession(shieldCheckpoint, CATALOG, {
      rng: test.tape.rng,
      clock: createLogicalClock(90_000),
      nextId: createSequentialIdFactory('light:shield:restored'),
    });
    const shield = shieldRestored.getState().pendingResolution;
    if (!shield || shield.type !== 'attack_reaction') throw new Error('Expected Shield window');
    const resumed = dispatch(shieldRestored, 'target', {
      type: 'ResolveDecision', commandId: 'light:shield:decline',
      resolutionId: shield.id, requestId: shield.request.id,
      response: { kind: 'reaction', actionId: null },
    });
    expect(damageEvent(resumed)).toMatchObject({ amount: 4, damageType: 'slashing' });
    expect(shieldRestored.getState().pendingResolution).toBeNull();
    expect(shieldRestored.getState().attackActions[test.attackActionId]).toEqual(ledger);
    expect(shieldRestored.getState().actors.attacker.runtime.resources.bonus_action).toBe(0);
    expect(shieldRestored.getState().actors.attacker.runtime.firedThisTurn).toContain(
      lightWeaponExtraAttackUseKey(test.attackActionId),
    );
    test.tape.assertExhausted();
    const replay = foldEvents(
      copy(test.initial),
      copy([
        ...test.session.getEvents(),
        ...restored.getEvents(),
        ...shieldRestored.getEvents(),
      ]),
    );
    expect(canonicalStringify(replay)).toBe(canonicalStringify(shieldRestored.getState()));
  });
});
