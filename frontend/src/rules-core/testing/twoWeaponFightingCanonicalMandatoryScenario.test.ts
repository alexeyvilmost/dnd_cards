import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../../canon/prodSnapshotL1Fixtures';
import { materializeMicroMvpL1ContentPatch } from '../../canon/declarativeMechanicsPatch';
import type { Card } from '../../types';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from '../determinism';
import { createWorld, type ActorState, type CommandResult, type GameCommand } from '../domain';
import { MICRO_MVP_FIGHTING_STYLE_ENTITIES } from './fightingStyleFixtures';
import { lightWeaponExtraAttackUseKey } from '../lightWeaponExtraAttack';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import { SYSTEM_ACTION_IDS } from '../systemActions';
import { migrateWorldState } from '../worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import {
  createCompiledRuntimeScenarioFoundation,
  runCompiledRuntimeScenario,
} from './compiledMicroMvpSpeciesFeatStyleRuntime';

const FIGHTER = 'CLASS-warrior';
const DWARF = 'RACE-0003';
const TOUGH = 'FEAT-0005';
const TWO_WEAPON_FIGHTING = 'FEAT-0061';
const DAGGER = 'CARD-0297';
const SCIMITAR = 'CARD-0311';

type CommandInput = GameCommand extends infer Command
  ? Command extends GameCommand
    ? Omit<Command, 'schemaVersion' | 'expectedRevision' | 'rulesetContentHash' | 'actorId'>
    : never
  : never;

let corpus: CompiledMicroMvpAcceptanceCorpus;
let root: CompiledMicroMvpL1Root;
let dagger: Card;
let scimitar: Card;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing Two-Weapon Fighting fixture: ${label}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function accept(result: CommandResult) {
  if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function dispatch(
  session: InMemoryRulesSession,
  actorId: string,
  input: CommandInput,
) {
  return accept(session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: corpus.compiled.ruleset.contentHash,
    actorId,
    ...input,
  } as GameCommand));
}

function equip(actor: ActorState, id: string): ActorState {
  return {
    ...copy(actor),
    id,
    name: id,
    controllerId: `${id}:controller`,
    character: {
      ...copy(actor.character),
      knownCards: [copy(dagger), copy(scimitar)],
      equippedCards: [copy(dagger), copy(scimitar)],
      weaponProficiencies: [dagger.weapon_type!, scimitar.weapon_type!],
    },
    runtime: {
      ...copy(actor.runtime),
      hp: { current: 40, max: 40, temp: 0 },
      resources: {
        ...copy(actor.runtime.resources), action: 1, bonus_action: 1, reaction: 1,
      },
      maxResources: {
        ...copy(actor.runtime.maxResources), action: 1, bonus_action: 1, reaction: 1,
      },
      equipment: { main_hand: dagger.id, off_hand: scimitar.id },
      inventory: [{ cardId: dagger.id, qty: 1 }, { cardId: scimitar.id, qty: 1 }],
      activeEffects: [],
      firedThisTurn: [],
    },
  };
}

describe('compiled Two-Weapon Fighting canonical mandatory scenario evidence', () => {
  beforeAll(async () => {
    corpus = await compileMicroMvpAcceptanceCorpus();
    const catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;
    const base = required(corpus.compiled.roots.find((candidate) => (
      candidate.matrixCase.klass.card_number === FIGHTER
        && candidate.matrixCase.species.card_number === DWARF
        && candidate.matrixCase.originFeat.card_number === TOUGH
    )), 'Dwarf Fighter base root');
    const style = required(catalogs.feats.find((feat) => (
      feat.card_number === TWO_WEAPON_FIGHTING
    )), TWO_WEAPON_FIGHTING);
    root = await compileMicroMvpL1ChoiceVariant({
      stableKey: base.stableKey,
      overrides: { fighter_fighting_style: [style.id] },
    });
    dagger = required(catalogs.cards.find((card) => card.card_number === DAGGER), DAGGER);
    scimitar = required(catalogs.cards.find((card) => card.card_number === SCIMITAR), SCIMITAR);
  }, 60_000);

  it('executes the canonical Light-property Bonus Action attack with compiled Two-Weapon Fighting exactly once inside a real two-PC protocol, reload, and replay', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-TWO-WEAPON-FIGHTING-01' },
  }, () => {
    const foundation = createCompiledRuntimeScenarioFoundation({
      corpus,
      root,
      index: 9_002,
      idPrefix: 'compiled-two-weapon-fighting-mandatory',
    });
    const protocol = runCompiledRuntimeScenario({
      foundation,
      spec: copy(foundation.spec),
    });
    expect(Object.values(protocol.initialState.actors)).toHaveLength(2);
    expect(protocol.observedTrace).toEqual([
      'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
    ]);
    expect(protocol.checkpoints.length).toBeGreaterThanOrEqual(2);
    expect(canonicalStringify(protocol.replayState)).toBe(canonicalStringify(protocol.finalState));

    const compiledSubject = required(
      foundation.provider.getActor(root.fixtureId),
      'compiled focused actor',
    );
    const supportFixture = required(
      foundation.provider.getActor(foundation.acceptance.support.fixtureId),
      'compiled support actor',
    );
    const subject = equip(compiledSubject, 'subject');
    const support: ActorState = {
      ...copy(supportFixture),
      id: 'support',
      name: 'support',
      controllerId: 'support:controller',
      ac: 1,
      runtime: {
        ...copy(supportFixture.runtime),
        hp: { current: 40, max: 40, temp: 0 },
        resources: { ...copy(supportFixture.runtime.resources), reaction: 0 },
        activeEffects: [],
      },
    };
    const stylePassive = required(subject.passives?.find((passive) => (
      passive.name === 'Fighting Style: Two-Weapon Fighting'
    )), 'compiled Two-Weapon Fighting passive');
    expect(stylePassive.sourceEntityIds).toEqual(
      MICRO_MVP_FIGHTING_STYLE_ENTITIES.twoWeaponFighting.sourceEntityIds,
    );
    stylePassive.name = 'Локализованный боевой стиль';
    stylePassive.sourceEntityIds = ['custom:two-weapon-style'];

    const initial = createWorld({
      id: 'compiled-two-weapon-fighting-focused',
      ruleset: corpus.compiled.ruleset,
      actors: [subject, support],
    });
    const tape = createStrictRngTape([
      { label: 'qualifying dagger attack', sides: 20, value: 10 },
      { label: 'qualifying dagger damage', sides: 4, value: 2 },
      { label: 'Light extra scimitar attack', sides: 20, value: 10 },
      { label: 'Light extra scimitar damage', sides: 6, value: 4 },
    ]);
    const environment = {
      rng: tape.rng,
      clock: createLogicalClock(140_000),
      nextId: createSequentialIdFactory('compiled-twf'),
    };
    const firstSession = new InMemoryRulesSession(initial, foundation.provider.catalog, environment);
    const facts = {
      factsSource: 'scenario' as const,
      boardRevision: 1,
      distanceFt: 5,
      lineOfSight: true,
      cover: 'none' as const,
      relation: 'enemy' as const,
    };
    dispatch(firstSession, 'subject', {
      type: 'StartEncounter', commandId: 'twf:encounter', initiative: ['subject', 'support'],
    });
    dispatch(firstSession, 'subject', { type: 'StartTurn', commandId: 'twf:turn:start' });
    dispatch(firstSession, 'subject', { type: 'BeginAttackAction', commandId: 'twf:attack:begin' });
    const attackAction = required(Object.values(firstSession.getState().attackActions)[0], 'Attack action');
    dispatch(firstSession, 'subject', {
      type: 'PerformWeaponAttack', commandId: 'twf:attack:dagger',
      attackActionId: attackAction.id, weaponCardId: dagger.id,
      targetActorId: 'support', facts,
    });
    const ledgerBeforeExtra = copy(firstSession.getState().attackActions[attackAction.id]);
    expect(ledgerBeforeExtra).toMatchObject({
      status: 'completed',
      sequence: {
        attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: dagger.id }],
      },
    });
    const checkpoint = migrateWorldState(copy(firstSession.getState()));
    expect(migrateWorldState(copy(checkpoint))).toEqual(checkpoint);

    const restored = new InMemoryRulesSession(checkpoint, foundation.provider.catalog, environment);
    const extra = dispatch(restored, 'subject', {
      type: 'PerformLightWeaponExtraAttack', commandId: 'twf:light:scimitar',
      attackActionId: attackAction.id, weaponCardId: scimitar.id,
      targetActorId: 'support', facts: { ...facts, boardRevision: checkpoint.revision },
    });
    expect(restored.getState().attackActions[attackAction.id]).toEqual(ledgerBeforeExtra);
    expect(restored.getState().actors.subject.runtime.resources.bonus_action).toBe(0);
    expect(restored.getState().actors.subject.runtime.firedThisTurn).toContain(
      lightWeaponExtraAttackUseKey(attackAction.id),
    );
    const declaration = extra.events.find((event) => (
      event.payload.type === 'ActionDeclared'
        && event.payload.actionId === SYSTEM_ACTION_IDS.lightExtraAttack
    ));
    expect(declaration?.payload).toMatchObject({
      type: 'ActionDeclared',
      sourceEntityIds: expect.arrayContaining([
        'system:dnd5e-2024:light-property-extra-attack',
        `card:${scimitar.id}`,
      ]),
      facts: {
        attackActionId: attackAction.id,
        qualifyingWeaponCardId: dagger.id,
        weaponCardId: scimitar.id,
        hand: 'off',
      },
    });
    expect(declaration?.obligationIds).toEqual(expect.arrayContaining([
      'entity:custom:two-weapon-style',
    ]));
    const extraDamage = extra.events.flatMap((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'damage'
        ? [event.payload.event]
        : []
    ));
    expect(extraDamage).toHaveLength(1);
    const weaponMod = Math.max(
      subject.character.abilityMods.str ?? 0,
      subject.character.abilityMods.dex ?? 0,
    );
    expect(extraDamage[0]).toMatchObject({ amount: 4 + weaponMod, damageType: 'slashing' });
    expect(extraDamage[0].roll?.modifiers.filter((modifier) => (
      modifier.source === 'Fighting Style: Two-Weapon Fighting'
    ))).toEqual([{ value: weaponMod, source: 'Fighting Style: Two-Weapon Fighting' }]);
    tape.assertExhausted();

    const allEvents = [...firstSession.getEvents(), ...restored.getEvents()];
    expect(foldEvents(copy(initial), copy(allEvents))).toEqual(restored.getState());
    expect(migrateWorldState(copy(restored.getState()))).toEqual(restored.getState());
  });
});
