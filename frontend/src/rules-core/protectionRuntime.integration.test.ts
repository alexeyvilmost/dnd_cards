import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import { materializeMicroMvpL1ContentPatch } from '../canon/declarativeMechanicsPatch';
import type { Card } from '../types';
import { createLogicalClock, createStrictRngTape, type DieTapeEntry } from './determinism';
import {
  createWorld,
  type ActorState,
  type GameCommand,
  type ProtectionReactionCandidateFacts,
  type RuleActionDefinition,
  type RulesCatalog,
  type SpatialFacts,
  type UncommittedRuleEvent,
  type WorldState,
} from './domain';
import { PROTECTION_2024_CAPABILITY_ID } from './protection';
import { actorProtectionEffects } from './protectionRuntime';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { replacePreparedSpells } from './spellcastingAccess';
import { migrateWorldState } from './worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './testing/compiledMicroMvpAcceptanceCorpus';
import {
  createCompiledRuntimeScenarioFoundation,
  runCompiledRuntimeScenario,
} from './testing/compiledMicroMvpSpeciesFeatStyleRuntime';

const FIGHTER = 'CLASS-warrior';
const WIZARD = 'CLASS-wizard';
const PROTECTION_FEAT = 'FEAT-0055';
const SHIELD_SPELL = 'SPELL-0317';
const FIRE_BOLT = 'fire_bolt';
const PHYSICAL_SHIELD = 'CARD-0200';
const MONSTER_WEAPON = 'CARD-0294';

type SpellAction = Extract<RuleActionDefinition, { kind: 'spell' }>;
type SessionCommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing Protection fixture: ${description}`);
  return value;
}

function withId(source: ActorState, id: string): ActorState {
  return {
    ...copy(source),
    id,
    name: id,
    controllerId: `${id}:controller`,
  };
}

function withCard(cards: readonly Card[] | undefined, card: Card): Card[] {
  return [...new Map([...(cards ?? []), card].map((entry) => [entry.id, entry])).values()];
}

function spatial(state: WorldState, distanceFt = 5): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: state.revision,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation: 'enemy',
  };
}

function protectionCandidate(
  state: WorldState,
  input: { visible?: boolean; distanceFt?: number; boardRevision?: number } = {},
): ProtectionReactionCandidateFacts {
  return {
    factsSource: 'scenario',
    boardRevision: input.boardRevision ?? state.revision,
    protectorActorId: 'protector',
    protectorCanSeeAttacker: input.visible ?? true,
    protectorDistanceToTargetFt: input.distanceFt ?? 5,
  };
}

function command(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: SessionCommandInput,
): GameCommand {
  return {
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: rulesetHash,
    actorId,
    ...value,
  } as GameCommand;
}

function accept(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: SessionCommandInput,
) {
  const result = session.dispatch(command(session, rulesetHash, actorId, value));
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function reject(
  session: InMemoryRulesSession,
  rulesetHash: string,
  actorId: string,
  value: SessionCommandInput,
) {
  const before = copy(session.getState());
  const result = session.dispatch(command(session, rulesetHash, actorId, value));
  expect(result.status).toBe('rejected');
  expect(session.getState()).toEqual(before);
  return result;
}

function payloads<T extends UncommittedRuleEvent['payload']['type']>(
  events: readonly UncommittedRuleEvent[],
  type: T,
): Array<Extract<UncommittedRuleEvent['payload'], { type: T }>> {
  return events.flatMap((event) => event.payload.type === type
    ? [event.payload as Extract<UncommittedRuleEvent['payload'], { type: T }>]
    : []);
}

function openAttackId(session: InMemoryRulesSession, actorId: string): string {
  return required(Object.values(session.getState().attackActions).find((entry) => (
    entry.actorId === actorId && entry.status === 'open'
  )), `${actorId} open Attack action`).id;
}

describe('compiled D&D 2024 Protection runtime vertical', () => {
  let provider: CompiledMicroMvpL1Provider;
  let acceptanceCorpus: CompiledMicroMvpAcceptanceCorpus;
  let protectionRoot: CompiledMicroMvpL1Root;
  let wizardRoot: CompiledMicroMvpL1Root;
  let physicalShield: Card;
  let monsterWeapon: Card;
  let shieldAction: SpellAction;
  let shieldGrantId: string;
  let fireBoltAction: SpellAction;
  let fireBoltGrantId: string;
  let catalog: RulesCatalog;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for Protection runtime tests');
    };
    try {
      acceptanceCorpus = await compileMicroMvpAcceptanceCorpus();
      provider = acceptanceCorpus.compiled;
      const catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
      const feat = required(catalogs.feats.find((entry) => entry.card_number === PROTECTION_FEAT), PROTECTION_FEAT);
      const fighterBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === FIGHTER
      )), FIGHTER);
      protectionRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: fighterBase.stableKey,
        overrides: { fighter_fighting_style: [feat.id] },
      });

      const wizardBase = required(provider.roots.find((root) => (
        root.matrixCase.klass.card_number === WIZARD
      )), WIZARD);
      const spellbookCards = [
        SHIELD_SPELL, 'detect_magic', 'SPELL-0174', 'SPELL-0242', 'SPELL-0190', 'SPELL-0171',
      ].map((cardNumber) => required(
        catalogs.spells.find((spell) => spell.card_number === cardNumber),
        cardNumber,
      ));
      wizardRoot = await compileMicroMvpL1ChoiceVariant({
        stableKey: wizardBase.stableKey,
        overrides: { wizard_spellbook_level_1: spellbookCards.map((spell) => spell.id) },
      });
      const shieldEntity = required(
        wizardRoot.assembled.spells.find((spell) => spell.card_number === SHIELD_SPELL),
        'compiled Shield entity',
      );
      shieldAction = required(wizardRoot.rulesActions.find((action): action is SpellAction => (
        action.kind === 'spell' && action.sourceEntityIds.includes(shieldEntity.id)
      )), 'compiled Shield action');
      shieldGrantId = required(wizardRoot.actor.spellcastingAccess?.grants.find((grant) => (
        grant.actionId === shieldAction.id && grant.sourceId === WIZARD
      )), 'compiled Shield grant').grantId;
      const access = required(wizardRoot.actor.spellcastingAccess, 'Wizard spell access');
      const prepared = required(access.preparedSources[WIZARD], 'Wizard prepared source');
      const preparedIds = [
        shieldAction.id,
        ...prepared.availableActionIds.filter((id) => id !== shieldAction.id),
      ].slice(0, prepared.capacity);
      const replaced = replacePreparedSpells(access, WIZARD, preparedIds);
      if ('status' in replaced) throw new Error(replaced.message);
      wizardRoot = { ...wizardRoot, actor: { ...wizardRoot.actor, spellcastingAccess: replaced } };

      const fireBoltEntity = required(
        wizardRoot.assembled.spells.find((spell) => spell.card_number === FIRE_BOLT),
        'compiled Fire Bolt entity',
      );
      fireBoltAction = required(wizardRoot.rulesActions.find((action): action is SpellAction => (
        action.kind === 'spell' && action.sourceEntityIds.includes(fireBoltEntity.id)
      )), 'compiled Fire Bolt action');
      fireBoltGrantId = required(wizardRoot.actor.spellcastingAccess?.grants.find((grant) => (
        grant.actionId === fireBoltAction.id
      )), 'compiled Fire Bolt grant').grantId;

      physicalShield = required(catalogs.cards.find((card) => (
        card.card_number === PHYSICAL_SHIELD
      )), PHYSICAL_SHIELD);
      monsterWeapon = required(catalogs.cards.find((card) => (
        card.card_number === MONSTER_WEAPON
      )), MONSTER_WEAPON);
      const actions = new Map([
        ...provider.roots.flatMap((root) => root.rulesActions),
        ...protectionRoot.rulesActions,
        ...wizardRoot.rulesActions,
      ].map((action) => [action.id, action] as const));
      catalog = { getAction: (id) => actions.get(id) ?? provider.catalog.getAction(id) };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  function actors(input: { protectorShield?: boolean; protectorReaction?: number } = {}) {
    const protector = withId(protectionRoot.actor, 'protector');
    if (input.protectorShield !== false) {
      protector.character = {
        ...protector.character,
        knownCards: withCard(protector.character.knownCards, physicalShield),
        equippedCards: withCard(protector.character.equippedCards, physicalShield),
      };
      protector.runtime.equipment = { ...protector.runtime.equipment, off_hand: physicalShield.id };
      protector.runtime.inventory = [
        ...protector.runtime.inventory.filter((entry) => entry.cardId !== physicalShield.id),
        { cardId: physicalShield.id, qty: 1 },
      ];
    }
    if (input.protectorReaction !== undefined) {
      protector.runtime.resources.reaction = input.protectorReaction;
    }
    const target = withId(wizardRoot.actor, 'target');
    target.ac = 12;
    target.runtime.hp = { current: 40, max: 40, temp: 0 };
    const monster: ActorState = {
      id: 'monster',
      name: 'monster',
      kind: 'monster',
      controllerId: 'gm',
      ac: 13,
      capabilities: { actionIds: [] },
      character: {
        abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
        profBonus: 2,
        level: 1,
        knownCards: [copy(monsterWeapon)],
        equippedCards: [copy(monsterWeapon)],
        weaponProficiencies: [monsterWeapon.weapon_type!],
        saveProficiencies: [],
      },
      runtime: {
        hp: { current: 50, max: 50, temp: 0 },
        resources: { action: 1, bonus_action: 1, reaction: 1 },
        maxResources: { action: 1, bonus_action: 1, reaction: 1 },
        equipment: { main_hand: monsterWeapon.id },
        inventory: [{ cardId: monsterWeapon.id, qty: 1 }],
        activeEffects: [],
      },
      passives: [],
      attackProfile: {
        attacksPerAction: 3,
        size: 2,
        reachFt: 5,
        graspingParts: ['main_hand', 'off_hand'],
        sourceEntityIds: ['monster:test:multiattack'],
      },
    };
    return { protector, target, monster };
  }

  function harness(id: string, dice: readonly DieTapeEntry[], actorOptions = {}) {
    const trio = actors(actorOptions);
    const initial = createWorld({ id, ruleset: provider.ruleset, actors: Object.values(trio) });
    const tape = createStrictRngTape(dice);
    const session = new InMemoryRulesSession(initial, catalog, {
      rng: tape.rng,
      clock: createLogicalClock(30_000),
      nextId: () => { throw new Error('persisted IDs must be command-derived'); },
    });
    return { ...trio, initial: copy(initial), session, tape };
  }

  function startMonsterAttack(session: InMemoryRulesSession, prefix: string): string {
    accept(session, provider.ruleset.contentHash, 'monster', {
      type: 'StartEncounter', commandId: `${prefix}:encounter`,
      initiative: ['monster', 'target', 'protector'],
    });
    accept(session, provider.ruleset.contentHash, 'monster', {
      type: 'StartTurn', commandId: `${prefix}:monster:start`,
    });
    accept(session, provider.ruleset.contentHash, 'monster', {
      type: 'BeginAttackAction', commandId: `${prefix}:monster:attack-action`,
    });
    return openAttackId(session, 'monster');
  }

  function weaponAttack(
    session: InMemoryRulesSession,
    commandId: string,
    attackActionId: string,
    candidate: ProtectionReactionCandidateFacts,
  ) {
    const state = session.getState();
    return accept(session, provider.ruleset.contentHash, 'monster', {
      type: 'PerformWeaponAttack', commandId, attackActionId,
      weaponCardId: monsterWeapon.id,
      targetActorId: 'target',
      facts: spatial(state),
      protectionCandidates: [candidate],
    });
  }

  function resolveProtection(session: InMemoryRulesSession, commandId: string, use: boolean) {
    const pending = session.getState().pendingResolution;
    if (!pending || pending.type !== 'protection_reaction') throw new Error('Protection window disappeared');
    return accept(session, provider.ruleset.contentHash, pending.request.actorId, {
      type: 'ResolveDecision', commandId,
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'reaction', actionId: use ? PROTECTION_2024_CAPABILITY_ID : null },
    });
  }

  it('protects the first and later attacks before RNG, survives later invisibility and Shield, then ends irreversibly beyond 5 feet', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-PROTECTION-RUNTIME-01' },
  }, () => {
    const protocol = createCompiledRuntimeScenarioFoundation({
      corpus: acceptanceCorpus,
      root: protectionRoot,
      index: 9_003,
      idPrefix: 'compiled-protection-mandatory',
    });
    runCompiledRuntimeScenario({ foundation: protocol, spec: copy(protocol.spec) });

    const test = harness('protection:compiled:multiattack', [
      { label: 'first protected attack high d20', sides: 20, value: 2 },
      { label: 'first protected attack low d20', sides: 20, value: 1 },
      { label: 'later protected attack high d20', sides: 20, value: 11 },
      { label: 'later protected attack low d20', sides: 20, value: 10 },
      { label: 'unprotected third attack d20', sides: 20, value: 15 },
      { label: 'unprotected mace damage', sides: 6, value: 4 },
      { label: 'compiled Fire Bolt attack', sides: 20, value: 15 },
      { label: 'compiled Fire Bolt damage', sides: 10, value: 6 },
      { label: 'target Arcana check', sides: 20, value: 12 },
      { label: 'target Wisdom save', sides: 20, value: 13 },
    ]);
    expect(Object.values(test.initial.actors).filter((actor) => actor.kind === 'playerCharacter'))
      .toHaveLength(2);
    expect(test.initial.actors.protector.capabilities.featureSources?.[PROTECTION_2024_CAPABILITY_ID])
      .toHaveLength(4);
    const attackActionId = startMonsterAttack(test.session, 'multi');

    const opening = weaponAttack(
      test.session,
      'multi:first',
      attackActionId,
      protectionCandidate(test.session.getState()),
    );
    expect(test.tape.consumed()).toBe(0);
    expect(payloads(opening.events, 'EngineEventRecorded')).toEqual([]);
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'protection_reaction',
      sourceActorId: 'monster', targetActorId: 'target',
      weaponHand: 'main', weaponCardId: monsterWeapon.id,
      request: {
        actorId: 'protector',
        trigger: { type: 'protection_before_attack' },
        options: [{
          actionId: PROTECTION_2024_CAPABILITY_ID,
          label: 'Боевой стиль: Защита',
        }],
      },
    });
    const checkpoint = copy(test.session.getState());
    expect(migrateWorldState(checkpoint)).toEqual(checkpoint);

    const first = resolveProtection(test.session, 'multi:first:protection', true);
    expect(test.tape.consumed()).toBe(2);
    expect(payloads(first.events, 'ProtectionEffectActivated')).toHaveLength(1);
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toHaveLength(1);
    expect(test.session.getState().actors.protector.runtime.resources.reaction).toBe(0);
    const firstRoll = payloads(first.events, 'EngineEventRecorded').find((payload) => (
      payload.event.type === 'roll'
    ));
    expect(firstRoll?.event).toMatchObject({
      type: 'roll', roll: {
        kind: 'd20', outcome: 'miss',
        dice: [{ sides: 20, result: 1 }, { sides: 20, result: 2, discarded: true }],
      },
    });

    const second = weaponAttack(test.session, 'multi:second', attackActionId, protectionCandidate(
      test.session.getState(), { visible: false },
    ));
    expect(test.tape.consumed()).toBe(4);
    expect(test.session.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      weaponHand: 'main', weaponCardId: monsterWeapon.id,
      request: { actorId: 'target' },
    });
    expect(payloads(second.events, 'ProtectionEffectEnded')).toEqual([]);
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toHaveLength(1);
    expect(migrateWorldState(copy(test.session.getState()))).toEqual(test.session.getState());
    const shieldPending = test.session.getState().pendingResolution;
    if (!shieldPending || shieldPending.type !== 'attack_reaction') throw new Error('Shield window disappeared');
    const shield = accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'ResolveDecision', commandId: 'multi:second:shield',
      resolutionId: shieldPending.id,
      requestId: shieldPending.request.id,
      response: {
        kind: 'reaction', actionId: shieldAction.id,
        spell: { grantId: shieldGrantId, mode: 'normal' },
      },
    });
    expect(payloads(shield.events, 'ActionDeclared')).toEqual([
      expect.objectContaining({ actionId: shieldAction.id, actionKind: 'spell' }),
    ]);
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toHaveLength(1);

    accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'ObserveProtectionProximity', commandId: 'multi:distance-break',
      protectorActorId: 'protector', protectedTargetActorId: 'target',
      factsSource: 'board', boardRevision: test.session.getState().revision,
      distanceFt: 10,
    });
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toEqual([]);
    const returned = reject(test.session, provider.ruleset.contentHash, 'target', {
      type: 'ObserveProtectionProximity', commandId: 'multi:return-within-five',
      protectorActorId: 'protector', protectedTargetActorId: 'target',
      factsSource: 'board', boardRevision: test.session.getState().revision,
      distanceFt: 5,
    });
    expect(returned).toMatchObject({ status: 'rejected', code: 'InvalidDecision' });

    const third = weaponAttack(test.session, 'multi:third', attackActionId, protectionCandidate(
      test.session.getState(), { distanceFt: 10 },
    ));
    const thirdRoll = payloads(third.events, 'EngineEventRecorded').find((payload) => (
      payload.event.type === 'roll'
    ));
    expect(thirdRoll?.event).toMatchObject({
      type: 'roll', roll: { kind: 'd20', dice: [{ sides: 20, result: 15 }] },
    });
    expect(test.session.getState().attackActions[attackActionId].status).toBe('completed');

    accept(test.session, provider.ruleset.contentHash, 'monster', {
      type: 'EndTurn', commandId: 'multi:monster:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'StartTurn', commandId: 'multi:target:start',
    });
    const fire = accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'UseAction', commandId: 'multi:target:fire-bolt',
      actionId: fireBoltAction.id,
      targetIds: ['monster'],
      factsByTarget: { monster: spatial(test.session.getState(), 60) },
      protectionCandidates: [protectionCandidate(test.session.getState(), { distanceFt: 10 })],
      spell: { baseLevel: 0, grantId: fireBoltGrantId },
    });
    expect(payloads(fire.events, 'ActionDeclared')).toEqual([
      expect.objectContaining({ actionId: fireBoltAction.id, actionKind: 'spell' }),
    ]);
    const check = accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'AbilityCheck', commandId: 'multi:target:check', ability: 'int', skill: 'arcana', dc: 10,
    });
    expect(payloads(check.events, 'EngineEventRecorded')).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'check' }) }) }),
    ]));
    const save = accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'SavingThrow', commandId: 'multi:target:save', ability: 'wis', dc: 10,
    });
    expect(payloads(save.events, 'EngineEventRecorded')).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'save' }) }) }),
    ]));

    test.tape.assertExhausted();
    expect(migrateWorldState(copy(test.session.getState()))).toEqual(test.session.getState());
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents()))).toEqual(test.session.getState());
  });

  it('expires at the protector next turn start and rejects incomplete or stale attack observations atomically', () => {
    const test = harness('protection:compiled:expiry', [
      { label: 'protected expiry attack high d20', sides: 20, value: 2 },
      { label: 'protected expiry attack low d20', sides: 20, value: 1 },
    ]);
    const attackActionId = startMonsterAttack(test.session, 'expiry');
    const missing = reject(test.session, provider.ruleset.contentHash, 'monster', {
      type: 'PerformWeaponAttack', commandId: 'expiry:missing-facts', attackActionId,
      weaponCardId: monsterWeapon.id, targetActorId: 'target',
      facts: spatial(test.session.getState()),
    });
    expect(missing).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(test.tape.consumed()).toBe(0);
    const staleState = test.session.getState();
    const stale = reject(test.session, provider.ruleset.contentHash, 'monster', {
      type: 'PerformWeaponAttack', commandId: 'expiry:stale-facts', attackActionId,
      weaponCardId: monsterWeapon.id, targetActorId: 'target',
      facts: spatial(staleState),
      protectionCandidates: [protectionCandidate(staleState, { boardRevision: staleState.revision + 1 })],
    });
    expect(stale).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    expect(test.tape.consumed()).toBe(0);

    weaponAttack(test.session, 'expiry:first', attackActionId, protectionCandidate(test.session.getState()));
    resolveProtection(test.session, 'expiry:use', true);
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toHaveLength(1);
    const withoutPhysicalShield = copy(test.session.getState());
    delete withoutPhysicalShield.actors.protector.runtime.equipment.off_hand;
    expect(() => migrateWorldState(withoutPhysicalShield)).not.toThrow();

    accept(test.session, provider.ruleset.contentHash, 'monster', {
      type: 'EndTurn', commandId: 'expiry:monster:end',
    });
    accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'StartTurn', commandId: 'expiry:target:start',
    });
    accept(test.session, provider.ruleset.contentHash, 'target', {
      type: 'EndTurn', commandId: 'expiry:target:end',
    });
    const start = accept(test.session, provider.ruleset.contentHash, 'protector', {
      type: 'StartTurn', commandId: 'expiry:protector:start',
    });
    expect(payloads(start.events, 'ProtectionEffectEnded')).toEqual([
      expect.objectContaining({ reason: 'protector_turn_started' }),
    ]);
    expect(actorProtectionEffects(test.session.getState().actors.protector)).toEqual([]);
    expect(test.session.getState().actors.protector.runtime.resources.reaction).toBe(1);
    test.tape.assertExhausted();
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents()))).toEqual(test.session.getState());
  });
});
