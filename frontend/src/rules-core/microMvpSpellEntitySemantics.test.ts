import { beforeAll, describe, expect, it } from 'vitest';
import { armorClassValue } from '../engine/ac';
import { actionUsesKey } from '../engine/actionUses';
import { breakdownValue } from '../engine/breakdown';
import { activeConditionsOf } from '../engine/circumstances';
import { deniedCapabilities } from '../engine/modifiers';
import { CARD_LEATHER_ARMOR, CARD_SHIELD } from '../mvp/fixtures';
import type { EngineEvent } from '../mvp/contracts';
import {
  compileMicroMvpL1Overlay,
} from '../canon/microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import type {
  ActorState,
  CommandResult,
  GameCommand,
  RuleActionDefinition,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { createWorld } from './domain';
import {
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
} from './determinism';
import type { DieTapeEntry, StrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

type AcceptedCommand = Extract<CommandResult, { status: 'accepted' }>;
type SpellEntity = CompiledMicroMvpL1Root['assembled']['spells'][number];

interface CompiledSpellFixture {
  root: CompiledMicroMvpL1Root;
  entity: SpellEntity;
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
}

interface SessionHarness {
  initial: WorldState;
  session: InMemoryRulesSession;
  tape: StrictRngTape;
}

interface ActorOptions {
  ac?: number;
  hp?: { current: number; max: number; temp: number };
  abilityMods?: Partial<ActorState['character']['abilityMods']>;
  saveProficiencies?: string[];
}

let provider: CompiledMicroMvpL1Provider;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findSpell(
  cardNumber: string,
  classCardNumber: string,
  root?: CompiledMicroMvpL1Root,
): CompiledSpellFixture {
  const candidates = root ? [root] : provider.roots
    .filter((candidate) => candidate.matrixCase.klass.card_number === classCardNumber)
    .sort((left, right) => {
      const leftHuman = left.matrixCase.species.card_number === 'RACE-0002' ? 0 : 1;
      const rightHuman = right.matrixCase.species.card_number === 'RACE-0002' ? 0 : 1;
      return leftHuman - rightHuman || left.stableKey.localeCompare(right.stableKey);
    });

  for (const candidate of candidates) {
    const entity = candidate.assembled.spells.find((spell) => spell.card_number === cardNumber);
    if (!entity) continue;
    const action = candidate.rulesActions.find((definition): definition is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => definition.kind === 'spell' && definition.sourceEntityIds.includes(entity.id));
    if (action) return { root: candidate, entity, action };
  }
  throw new Error(`No compiled ${classCardNumber} action for ${cardNumber}`);
}

function findRootWithSpells(
  classCardNumber: string,
  cardNumbers: readonly string[],
): CompiledMicroMvpL1Root {
  const root = provider.roots
    .filter((candidate) => candidate.matrixCase.klass.card_number === classCardNumber)
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))
    .find((candidate) => cardNumbers.every((cardNumber) => (
      candidate.assembled.spells.some((spell) => spell.card_number === cardNumber)
    )));
  if (!root) throw new Error(`${classCardNumber} has no compiled root with ${cardNumbers.join(', ')}`);
  return root;
}

function isolatedActor(
  root: CompiledMicroMvpL1Root,
  id: string,
  actionIds: readonly string[],
  options: ActorOptions = {},
): ActorState {
  const actor = copy(root.actor);
  actor.id = id;
  actor.name = id;
  actor.controllerId = `${id}:controller`;
  actor.capabilities = { actionIds: [...actionIds] };
  if (actor.spellcastingAccess) {
    const selectedActions = new Set(actionIds);
    const grants = actor.spellcastingAccess.grants.filter((grant) => (
      selectedActions.has(grant.actionId)
    ));
    if (!grants.length) {
      delete actor.spellcastingAccess;
    } else {
      const spellbookSources = new Set(grants.filter((grant) => (
        grant.access === 'spellbook'
      )).map((grant) => grant.sourceId));
      actor.spellcastingAccess = {
        grants,
        preparedSources: Object.fromEntries([...spellbookSources].sort().map((sourceId) => {
          const availableActionIds = grants.filter((grant) => (
            grant.sourceId === sourceId && grant.access === 'spellbook'
          )).map((grant) => grant.actionId).sort();
          return [sourceId, {
            sourceId,
            capacity: availableActionIds.length,
            availableActionIds,
            preparedActionIds: [...availableActionIds],
          }];
        })),
      };
    }
  }
  actor.passives = [];
  actor.runtime = {
    ...actor.runtime,
    hp: options.hp ? { ...options.hp } : { ...actor.runtime.hp },
    resources: { ...actor.runtime.resources },
    maxResources: { ...actor.runtime.maxResources },
    equipment: {},
    inventory: [],
    activeEffects: [],
    firedThisTurn: [],
    firedThisRest: [],
  };
  actor.character = {
    ...actor.character,
    abilityMods: {
      ...actor.character.abilityMods,
      ...(options.abilityMods ?? {}),
    },
    ...(options.saveProficiencies ? { saveProficiencies: [...options.saveProficiencies] } : {}),
  };
  if (options.ac != null) actor.ac = options.ac;
  return actor;
}

function harness(
  id: string,
  actors: ActorState[],
  entries: readonly DieTapeEntry[],
): SessionHarness {
  const initial = createWorld({ id, ruleset: provider.ruleset, actors });
  const tape = createStrictRngTape(entries);
  return {
    initial: copy(initial),
    tape,
    session: new InMemoryRulesSession(initial, provider.catalog, {
      rng: tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(`${id}:event`),
    }),
  };
}

function dispatchAccepted(
  session: InMemoryRulesSession,
  command: Record<string, unknown>,
): AcceptedCommand {
  const result = session.dispatch({
    schemaVersion: 1,
    expectedRevision: session.getState().revision,
    rulesetContentHash: provider.ruleset.contentHash,
    ...command,
  } as unknown as GameCommand);
  if (result.status !== 'accepted') {
    throw new Error(`${result.code}: ${result.message}`);
  }
  return result;
}

function startEncounter(
  session: InMemoryRulesSession,
  prefix: string,
  initiative: string[],
): void {
  dispatchAccepted(session, {
    type: 'StartEncounter', commandId: `${prefix}:encounter`, actorId: initiative[0], initiative,
  });
  dispatchAccepted(session, {
    type: 'StartTurn', commandId: `${prefix}:turn:${initiative[0]}:1`, actorId: initiative[0],
  });
}

function endTurn(session: InMemoryRulesSession, commandId: string, actorId: string): void {
  dispatchAccepted(session, { type: 'EndTurn', commandId, actorId });
}

function startTurn(session: InMemoryRulesSession, commandId: string, actorId: string): void {
  dispatchAccepted(session, { type: 'StartTurn', commandId, actorId });
}

function enemyFacts(
  distanceFt: number,
  cover: 'none' | 'half' | 'three_quarters' | 'total' = 'none',
) {
  return {
    factsSource: 'scenario' as const,
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover,
    relation: 'enemy' as const,
  };
}

function selfFacts() {
  return {
    factsSource: 'scenario' as const,
    boardRevision: 1,
    distanceFt: 0,
    lineOfSight: true,
    cover: 'none' as const,
    relation: 'self' as const,
  };
}

function allyFacts(distanceFt: number, willing?: boolean) {
  return {
    factsSource: 'scenario' as const,
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover: 'none' as const,
    relation: 'ally' as const,
    ...(willing == null ? {} : { willing }),
  };
}

function recorded(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

function damageEvents(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((event): event is Extract<EngineEvent, { type: 'damage' }> => (
    event.type === 'damage'
  ));
}

function rollEvents(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((event): event is Extract<EngineEvent, { type: 'roll' }> => (
    event.type === 'roll'
  ));
}

function expectReplay({ initial, session }: SessionHarness): void {
  expect(foldEvents(copy(initial), copy(session.getEvents()))).toEqual(copy(session.getState()));
}

function expectPinnedSpell(fixture: CompiledSpellFixture, cardNumber: string): void {
  expect(fixture.entity.card_number).toBe(cardNumber);
  expect(fixture.action.kind).toBe('spell');
  expect(fixture.action.sourceEntityIds).toContain(fixture.entity.id);
  expect(provider.catalog.getAction(fixture.action.id)).toEqual(fixture.action);
}

function resolveManualSave(
  session: InMemoryRulesSession,
  commandId: string,
  value: number,
): AcceptedCommand {
  const pending = session.getState().pendingResolution;
  if (!pending || pending.type !== 'target_save') throw new Error('Expected target-save decision');
  return dispatchAccepted(session, {
    type: 'ResolveDecision',
    commandId,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value }] } },
  });
}

function resolveReaction(
  session: InMemoryRulesSession,
  commandId: string,
  actionId: string | null,
): AcceptedCommand {
  const pending = session.getState().pendingResolution;
  if (!pending || pending.type !== 'attack_reaction') throw new Error('Expected attack-reaction decision');
  return dispatchAccepted(session, {
    type: 'ResolveDecision',
    commandId,
    actorId: pending.targetActorId,
    resolutionId: pending.id,
    requestId: pending.request.id,
    response: { kind: 'reaction', actionId },
  });
}

describe('micro-MVP compiled spell entity semantics', () => {
  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
  }, 60_000);

  it('executes Fire Bolt hit and miss from the pinned entity with one action, 1d10 Fire, and no miss damage', () => {
    const spell = findSpell('fire_bolt', 'CLASS-wizard');
    expectPinnedSpell(spell, 'fire_bolt');
    expect(spell.action.spell.level).toBe(0);
    expect(spell.action.mechanics).toMatchObject({
      activation: { cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', ability: 'spellcasting', attack_kind: 'spell_ranged',
        on_hit: [{ kind: 'damage', dice: '1d10', type: 'fire' }],
      }],
    });

    const run = (lane: 'hit' | 'miss') => {
      const entries: DieTapeEntry[] = lane === 'hit'
        ? [
            { label: 'Fire Bolt attack', sides: 20, value: 10 },
            { label: 'Fire Bolt damage', sides: 10, value: 7 },
          ]
        : [{ label: 'Fire Bolt miss', sides: 20, value: 2 }];
      const source = isolatedActor(spell.root, 'fire-caster', [spell.action.id]);
      const target = isolatedActor(spell.root, 'fire-target', [], {
        ac: 10,
        hp: { current: 30, max: 30, temp: 0 },
      });
      const test = harness(`fire-bolt-${lane}`, [source, target], entries);
      startEncounter(test.session, `fire-${lane}`, [source.id, target.id]);
      const before = copy(test.session.getState().actors[source.id].runtime.resources);
      const result = dispatchAccepted(test.session, {
        type: 'UseAction', commandId: `fire-${lane}:cast`, actorId: source.id,
        actionId: spell.action.id, targetIds: [target.id],
        factsByTarget: { [target.id]: enemyFacts(120) },
      });
      const rolls = rollEvents(result.events);
      expect(rolls).toHaveLength(1);
      expect(rolls[0].roll).toMatchObject({ outcome: lane, target: { type: 'ac', value: 10 } });
      expect(test.session.getState().actors[source.id].runtime.resources.action).toBe(before.action - 1);
      expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1)
        .toBe(before.spell_slot_1);

      const damage = damageEvents(result.events);
      if (lane === 'hit') {
        expect(damage).toEqual([expect.objectContaining({
          amount: 7,
          damageType: 'fire',
          roll: expect.objectContaining({
            total: 7,
            dice: [{ sides: 10, result: 7 }],
          }),
        })]);
        expect(test.session.getState().actors[target.id].runtime.hp.current).toBe(23);
      } else {
        expect(damage).toEqual([]);
        expect(test.session.getState().actors[target.id].runtime.hp.current).toBe(30);
      }
      test.tape.assertExhausted();
      expectReplay(test);
    };

    run('hit');
    run('miss');
  });

  it('resolves Command: Grovel automatically when the target turn starts', () => {
    const root = provider.roots[0];
    if (!root) throw new Error('Missing compiled mini-MVP root');
    const caster = isolatedActor(root, 'command-caster', []);
    const target = isolatedActor(root, 'command-target', []);
    target.runtime.activeEffects.push({
      id: 'command:grovel',
      name: 'Приказ: Падай',
      source: 'Приказ',
      ownerId: target.id,
      sourceId: caster.id,
      expiry: 'manual',
      mechanics: {
        kind: 'turn_command', command: 'grovel', execute_at: 'next_turn',
        stack_id: 'spell:command', stack_type: 'overwrite',
      },
    });
    const test = harness('compiled-command-grovel', [caster, target], []);
    startEncounter(test.session, 'command', [caster.id, target.id]);
    const waiting = test.session.getState().actors[target.id].runtime.activeEffects;
    expect(waiting).toHaveLength(1);
    expect(waiting[0].name).toContain('Падай');
    expect(waiting[0].name).not.toBe('действие');

    endTurn(test.session, 'command:caster:end', caster.id);
    const started = dispatchAccepted(test.session, {
      type: 'StartTurn', commandId: 'command:target:start', actorId: target.id,
    });
    const targetRuntime = test.session.getState().actors[target.id].runtime;
    expect(activeConditionsOf(targetRuntime).has('prone')).toBe(true);
    expect([...deniedCapabilities(targetRuntime)].sort()).toEqual([
      'action', 'bonus_action', 'movement',
    ]);
    expect(recorded(started.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'effect_expired', name: expect.stringContaining('Падай') }),
      expect.objectContaining({ type: 'condition_applied', condition: 'prone' }),
    ]));
    test.tape.assertExhausted();
    expectReplay(test);
  });

  it('executes Sacred Flame Dexterity save boundaries without cover bonuses and deals 1d8 Radiant only on failure', () => {
    const spell = findSpell('SPELL-0286', 'CLASS-cleric');
    expectPinnedSpell(spell, 'SPELL-0286');
    expect(spell.action.spell.level).toBe(0);
    expect(spell.action.mechanics).toMatchObject({
      activation: { cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'save', who: 'target', ability: 'dex', dc: '8 + prof + spellcasting',
        on_fail: [{ kind: 'damage', dice: '1d8', type: 'radiant' }],
        on_success: [],
      }],
    });

    const run = (
      lane: 'fail' | 'success',
      cover: 'half' | 'three_quarters',
      saveDie: number,
    ) => {
      const source = isolatedActor(spell.root, `flame-caster-${lane}`, [spell.action.id]);
      const target = isolatedActor(spell.root, `flame-target-${lane}`, [], {
        ac: 10,
        hp: { current: 30, max: 30, temp: 0 },
        abilityMods: { dex: 0 },
        saveProficiencies: [],
      });
      const test = harness(`sacred-flame-${lane}`, [source, target], lane === 'fail'
        ? [{ label: 'Sacred Flame damage', sides: 8, value: 6 }]
        : []);
      startEncounter(test.session, `flame-${lane}`, [source.id, target.id]);
      const before = copy(test.session.getState().actors[source.id].runtime.resources);
      const opened = dispatchAccepted(test.session, {
        type: 'UseAction', commandId: `flame-${lane}:cast`, actorId: source.id,
        actionId: spell.action.id, targetIds: [target.id],
        factsByTarget: { [target.id]: enemyFacts(60, cover) },
      });
      expect(damageEvents(opened.events)).toEqual([]);
      const expectedDc = 8 + source.character.profBonus + (source.character.spellcastingMod ?? 0);
      expect(test.session.getState().pendingResolution).toMatchObject({
        type: 'target_save',
        request: { actorId: target.id, ability: 'dex', dc: expectedDc },
        facts: { cover },
      });
      expect(test.session.getState().actors[source.id].runtime.resources.action).toBe(before.action - 1);
      expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1)
        .toBe(before.spell_slot_1);

      const resolved = resolveManualSave(test.session, `flame-${lane}:save`, saveDie);
      const save = rollEvents(resolved.events).find((event) => event.roll.kind === 'save');
      expect(save?.roll).toMatchObject({
        outcome: lane,
        total: saveDie,
        target: { type: 'dc', value: expectedDc },
        modifiers: [{ value: 0, source: 'ЛВК' }],
      });
      const damage = damageEvents(resolved.events);
      if (lane === 'fail') {
        expect(damage).toEqual([expect.objectContaining({
          amount: 6,
          damageType: 'radiant',
          roll: expect.objectContaining({ dice: [{ sides: 8, result: 6 }] }),
        })]);
        expect(test.session.getState().actors[target.id].runtime.hp.current).toBe(24);
      } else {
        expect(damage).toEqual([]);
        expect(test.session.getState().actors[target.id].runtime.hp.current).toBe(30);
      }
      test.tape.assertExhausted();
      expectReplay(test);
      return expectedDc;
    };

    expect(run('fail', 'half', 1)).toBe(run('success', 'three_quarters', 20));
  });

  it('executes Cure Wounds on a touched ally for 2d8 plus spellcasting modifier and spends exactly one action and slot', () => {
    const spell = findSpell('SPELL-0214', 'CLASS-cleric');
    expectPinnedSpell(spell, 'SPELL-0214');
    expect(spell.action.spell.level).toBe(1);
    expect(spell.action.targeting).toMatchObject({
      rangeFt: 5,
      allowedRelations: expect.arrayContaining(['ally']),
    });
    expect(spell.action.mechanics).toMatchObject({
      activation: {
        cost: [
          { resource: 'action' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'healing', amount: '2d8 + spellcasting' }],
      }],
    });

    const source = isolatedActor(spell.root, 'cure-caster', [spell.action.id], {
      hp: { current: 12, max: 12, temp: 0 },
    });
    const target = isolatedActor(spell.root, 'cure-target', [], {
      hp: { current: 5, max: 30, temp: 0 },
    });
    const test = harness('cure-wounds', [source, target], [
      { label: 'Cure Wounds die 1', sides: 8, value: 3 },
      { label: 'Cure Wounds die 2', sides: 8, value: 4 },
    ]);
    startEncounter(test.session, 'cure', [source.id, target.id]);
    const sourceBefore = copy(test.session.getState().actors[source.id].runtime);
    const targetBefore = copy(test.session.getState().actors[target.id].runtime);
    const result = dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'cure:cast', actorId: source.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: allyFacts(5) },
    });
    const expectedHealing = 3 + 4 + (source.character.spellcastingMod ?? 0);
    const healing = recorded(result.events).filter((event): event is Extract<
      EngineEvent,
      { type: 'healing' }
    > => event.type === 'healing');
    expect(healing).toEqual([expect.objectContaining({
      amount: expectedHealing,
      roll: expect.objectContaining({
        total: expectedHealing,
        dice: [
          { sides: 8, result: 3 },
          { sides: 8, result: 4 },
        ],
        modifiers: [expect.objectContaining({
          value: source.character.spellcastingMod,
        })],
      }),
    })]);
    expect(test.session.getState().actors[target.id].runtime.hp).toEqual({
      current: 5 + expectedHealing,
      max: 30,
      temp: 0,
    });
    expect(test.session.getState().actors[source.id].runtime.hp).toEqual(sourceBefore.hp);
    expect(test.session.getState().actors[source.id].runtime.resources.action)
      .toBe(sourceBefore.resources.action - 1);
    expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1)
      .toBe(sourceBefore.resources.spell_slot_1 - 1);
    expect(test.session.getState().actors[target.id].runtime.resources).toEqual(targetBefore.resources);
    test.tape.assertExhausted();
    expectReplay(test);
  });

  it('compiles pinned Mage Armor with willing-unarmored targeting and rejects every unproven target before cost', () => {
    const spell = findSpell('SPELL-0190', 'CLASS-wizard');
    expectPinnedSpell(spell, 'SPELL-0190');
    expect(spell.action.targeting).toMatchObject({
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 5,
      requiresWilling: true,
      requiresUnarmored: true,
    });
    expect(spell.action.mechanics).toMatchObject({
      targeting: {
        requires_willing: true,
        requires_unarmored: true,
      },
    });
    expect(spell.root.actor.grantedEffects?.['EFFECT-0256']?.mechanics).toMatchObject({
      duration: { type: 'rounds', amount: 4_800 },
      end_triggers: ['wearer_dons_armor'],
      effects: [{
        result: [{ kind: 'set_value', target: 'ac_base', formula: '13 + dex' }],
      }],
    });

    const rejectedCast = (
      id: string,
      target: ActorState,
      facts: ReturnType<typeof allyFacts>,
      expectedCode: Extract<CommandResult, { status: 'rejected' }>['code'],
    ) => {
      const source = isolatedActor(spell.root, `${id}:caster`, [spell.action.id]);
      const test = harness(id, [source, target], []);
      const sourceBefore = copy(source.runtime);
      const targetBefore = copy(target.runtime);
      const result = test.session.dispatch({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `${id}:cast`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: source.id,
        actionId: spell.action.id,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts },
      });
      expect(result).toMatchObject({ status: 'rejected', code: expectedCode });
      expect(test.session.getState().actors[source.id].runtime).toEqual(sourceBefore);
      expect(test.session.getState().actors[target.id].runtime).toEqual(targetBefore);
      expect(test.session.getEvents()).toEqual([]);
      test.tape.assertExhausted();
    };

    rejectedCast(
      'mage-armor:missing-consent',
      isolatedActor(spell.root, 'missing-consent:target', []),
      allyFacts(5),
      'TargetNotWilling',
    );
    rejectedCast(
      'mage-armor:refused',
      isolatedActor(spell.root, 'refused:target', []),
      allyFacts(5, false),
      'TargetNotWilling',
    );

    const armored = isolatedActor(spell.root, 'armored:target', []);
    armored.character = {
      ...armored.character,
      knownCards: [CARD_LEATHER_ARMOR],
      equippedCards: [CARD_LEATHER_ARMOR],
    };
    armored.runtime.equipment = { body: CARD_LEATHER_ARMOR.id };
    rejectedCast('mage-armor:armored', armored, allyFacts(5, true), 'TargetArmored');

    const unresolved = isolatedActor(spell.root, 'unresolved-armor:target', []);
    unresolved.runtime.equipment = { body: 'missing-authoritative-card' };
    rejectedCast(
      'mage-armor:unresolved-armor',
      unresolved,
      allyFacts(5, true),
      'InvalidEquipmentState',
    );
  });

  it('executes pinned Mage Armor as one non-stacking 13+Dex AC method for exactly eight hours', () => {
    const spell = findSpell('SPELL-0190', 'CLASS-wizard');
    expectPinnedSpell(spell, 'SPELL-0190');
    expect(spell.action.spell.level).toBe(1);
    expect(spell.action.targeting).toMatchObject({
      rangeFt: 5,
      allowedRelations: expect.arrayContaining(['ally']),
    });
    expect(spell.action.mechanics).not.toHaveProperty('uses');
    expect(spell.action.mechanics).toMatchObject({
      activation: {
        cost: [
          { resource: 'action' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{
        resolution: 'auto',
        who: 'target',
        result: [{ kind: 'grant_effect', values: ['EFFECT-0256'] }],
      }],
    });
    expect(spell.root.actor.runtime.maxResources)
      .not.toHaveProperty(actionUsesKey('SPELL-0190'));

    const source = isolatedActor(spell.root, 'mage-armor-caster', [spell.action.id]);
    const target = isolatedActor(spell.root, 'mage-armor-target', [], {
      hp: { current: 20, max: 20, temp: 0 },
      abilityMods: { dex: 3 },
    });
    const observer = isolatedActor(spell.root, 'mage-armor-observer', []);
    const test = harness('mage-armor', [source, target, observer], []);
    startEncounter(test.session, 'mage-armor', [source.id, target.id, observer.id]);
    const sourceBefore = copy(test.session.getState().actors[source.id].runtime);
    const targetBefore = copy(test.session.getState().actors[target.id]);
    const baseAc = armorClassValue(
      targetBefore.character,
      targetBefore.runtime,
      targetBefore.passives ?? [],
    ).value;
    expect(baseAc).toBe(13);
    dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'mage-armor:cast:1', actorId: source.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: allyFacts(5, true) },
    });
    const sourceAfter = test.session.getState().actors[source.id];
    const targetAfter = test.session.getState().actors[target.id];
    expect(sourceAfter.runtime.resources.action).toBe(sourceBefore.resources.action - 1);
    expect(sourceAfter.runtime.resources.spell_slot_1).toBe(sourceBefore.resources.spell_slot_1 - 1);
    expect(sourceAfter.runtime.activeEffects).toEqual([]);
    expect(targetAfter.runtime.activeEffects).toEqual([
      expect.objectContaining({
        name: spell.action.name,
        ownerId: target.id,
        sourceId: source.id,
        roundsLeft: 4_800,
        mechanics: expect.objectContaining({
          stack_id: 'EFFECT-0256',
          duration: { type: 'rounds', amount: 4_800 },
          effects: [expect.objectContaining({
            result: [expect.objectContaining({
              kind: 'set_value', target: 'ac_base', formula: '13 + dex',
            })],
          })],
        }),
      }),
    ]);
    expect(armorClassValue(
      targetAfter.character,
      targetAfter.runtime,
      targetAfter.passives ?? [],
    ).value).toBe(16);

    endTurn(test.session, 'mage-armor:source:end:1', source.id);
    startTurn(test.session, 'mage-armor:target:start:1', target.id);
    endTurn(test.session, 'mage-armor:target:end:1', target.id);
    startTurn(test.session, 'mage-armor:observer:start:1', observer.id);
    endTurn(test.session, 'mage-armor:observer:end:1', observer.id);
    startTurn(test.session, 'mage-armor:source:start:2', source.id);
    dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'mage-armor:cast:2', actorId: source.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: allyFacts(5, true) },
    });
    const recastTarget = test.session.getState().actors[target.id];
    expect(recastTarget.runtime.activeEffects).toHaveLength(1);
    expect(recastTarget.runtime.activeEffects[0].roundsLeft).toBe(4_800);
    expect(armorClassValue(
      recastTarget.character,
      recastTarget.runtime,
      recastTarget.passives ?? [],
    ).value).toBe(16);
    expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1)
      .toBe(sourceBefore.resources.spell_slot_1 - 2);
    test.tape.assertExhausted();
    expectReplay(test);

    // Time passage is legal in exploration, not during an encounter. Persist
    // the exact post-cast actor into a fresh world and advance eight one-hour
    // Short Rests through the same command/event/replay boundary.
    const duration = harness(
      'mage-armor-duration',
      [copy(recastTarget), copy(observer)],
      [],
    );
    for (let hour = 1; hour <= 8; hour += 1) {
      dispatchAccepted(duration.session, {
        type: 'TakeShortRest',
        commandId: `mage-armor:target:hour:${hour}`,
        actorId: target.id,
      });
      const effects = duration.session.getState().actors[target.id].runtime.activeEffects;
      if (hour < 8) {
        expect(effects).toHaveLength(1);
        expect(effects[0].roundsLeft).toBe(4_800 - hour * 600);
      } else {
        expect(effects).toEqual([]);
      }
    }
    expect(armorClassValue(
      duration.session.getState().actors[target.id].character,
      duration.session.getState().actors[target.id].runtime,
      duration.session.getState().actors[target.id].passives ?? [],
    ).value).toBe(baseAc);
    duration.tape.assertExhausted();
    expectReplay(duration);
  });

  it('ends pinned Mage Armor immediately and permanently through canonical DonArmor events and JSON replay', () => {
    const spell = findSpell('SPELL-0190', 'CLASS-wizard');
    expectPinnedSpell(spell, 'SPELL-0190');
    const source = isolatedActor(spell.root, 'mage-armor-don:caster', [spell.action.id]);
    const target = isolatedActor(spell.root, 'mage-armor-don:target', [], {
      abilityMods: { dex: 3 },
    });
    target.character = {
      ...target.character,
      knownCards: [CARD_LEATHER_ARMOR],
      equippedCards: [],
    };
    target.runtime.inventory = [{ cardId: CARD_LEATHER_ARMOR.id, qty: 1 }];
    const test = harness('mage-armor-don', [source, target], []);

    dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'mage-armor-don:cast', actorId: source.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: allyFacts(5, true) },
    });
    const applied = test.session.getState().actors[target.id].runtime.activeEffects;
    expect(applied).toHaveLength(1);
    const mageArmorEffectId = applied[0].id;
    expect(armorClassValue(
      target.character,
      test.session.getState().actors[target.id].runtime,
      [],
    ).value).toBe(16);

    const result = dispatchAccepted(test.session, {
      type: 'DonArmor',
      commandId: 'mage-armor-don:equip-leather',
      actorId: target.id,
      armorCardId: CARD_LEATHER_ARMOR.id,
    });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        payload: {
          type: 'EquipmentChanged',
          actorId: target.id,
          operation: 'don_armor',
          cardId: CARD_LEATHER_ARMOR.id,
          equipment: expect.objectContaining({ body: CARD_LEATHER_ARMOR.id }),
          endedEffectIds: [mageArmorEffectId],
        },
      }),
      expect.objectContaining({
        payload: expect.objectContaining({
          type: 'EngineEventRecorded',
          event: { type: 'effect_expired', name: expect.any(String) },
        }),
      }),
    ]));
    const donned = test.session.getState().actors[target.id];
    expect(donned.runtime.equipment.body).toBe(CARD_LEATHER_ARMOR.id);
    expect(donned.runtime.activeEffects).toEqual([]);
    expect(armorClassValue(donned.character, donned.runtime, donned.passives ?? []).value).toBe(14);

    const persisted = JSON.parse(JSON.stringify(test.session.snapshot())) as {
      world: WorldState;
      events: UncommittedRuleEvent[];
    };
    expect(persisted.world.actors[target.id].runtime.activeEffects).toEqual([]);
    expect(foldEvents(copy(test.initial), persisted.events)).toEqual(persisted.world);
    expect(armorClassValue(
      donned.character,
      { ...donned.runtime, equipment: {} },
      donned.passives ?? [],
    ).value).toBe(13);
    test.tape.assertExhausted();
  });

  it('rejects invalid canonical DonArmor commands without mutating equipment or effects', () => {
    const spell = findSpell('SPELL-0190', 'CLASS-wizard');
    const rejectedDon = (
      id: string,
      mutate: (target: ActorState) => void,
      armorCardId: string,
      expectedCode: Extract<CommandResult, { status: 'rejected' }>['code'],
    ) => {
      const target = isolatedActor(spell.root, `${id}:target`, []);
      mutate(target);
      const observer = isolatedActor(spell.root, `${id}:observer`, []);
      const test = harness(id, [target, observer], []);
      const before = copy(test.session.getState());
      const result = test.session.dispatch({
        schemaVersion: 1,
        type: 'DonArmor',
        commandId: `${id}:don`,
        expectedRevision: 0,
        rulesetContentHash: provider.ruleset.contentHash,
        actorId: target.id,
        armorCardId,
      });
      expect(result).toMatchObject({ status: 'rejected', code: expectedCode });
      expect(test.session.getState()).toEqual(before);
      expect(test.session.getEvents()).toEqual([]);
      test.tape.assertExhausted();
    };

    rejectedDon('don:unknown', () => undefined, 'missing-card', 'CardNotFound');
    rejectedDon('don:not-owned', (target) => {
      target.character = { ...target.character, knownCards: [CARD_LEATHER_ARMOR] };
    }, CARD_LEATHER_ARMOR.id, 'ItemNotOwned');
    rejectedDon('don:not-armor', (target) => {
      target.character = { ...target.character, knownCards: [CARD_SHIELD] };
      target.runtime.inventory = [{ cardId: CARD_SHIELD.id, qty: 1 }];
    }, CARD_SHIELD.id, 'NotArmor');
    rejectedDon('don:already-worn', (target) => {
      target.character = { ...target.character, knownCards: [CARD_LEATHER_ARMOR] };
      target.runtime.inventory = [{ cardId: CARD_LEATHER_ARMOR.id, qty: 1 }];
      target.runtime.equipment = { body: CARD_LEATHER_ARMOR.id };
    }, CARD_LEATHER_ARMOR.id, 'InvalidEquipmentState');

    const target = isolatedActor(spell.root, 'don:encounter:target', []);
    target.character = { ...target.character, knownCards: [CARD_LEATHER_ARMOR] };
    target.runtime.inventory = [{ cardId: CARD_LEATHER_ARMOR.id, qty: 1 }];
    const observer = isolatedActor(spell.root, 'don:encounter:observer', []);
    const encounter = harness('don:encounter', [target, observer], []);
    startEncounter(encounter.session, 'don:encounter', [target.id, observer.id]);
    const before = copy(encounter.session.getState());
    const result = encounter.session.dispatch({
      schemaVersion: 1,
      type: 'DonArmor',
      commandId: 'don:encounter:don',
      expectedRevision: before.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: target.id,
      armorCardId: CARD_LEATHER_ARMOR.id,
    });
    expect(result).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(encounter.session.getState()).toEqual(before);
    encounter.tape.assertExhausted();
  });

  it('executes False Life from the pinned entity as 2d4+4 Temporary HP without changing HP and without stacking', () => {
    const spell = findSpell('false_life', 'CLASS-wizard');
    expectPinnedSpell(spell, 'false_life');
    expect(spell.action.spell.level).toBe(1);
    expect(spell.action.targeting).toMatchObject({ allowedRelations: ['self'] });
    expect(spell.action.mechanics).toMatchObject({
      activation: {
        cost: [
          { resource: 'action' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{ resolution: 'auto', result: [{ kind: 'temp_hp', amount: '2d4 + 4' }] }],
    });

    const run = (existingTemp: number, expectedTemp: number) => {
      const source = isolatedActor(spell.root, `false-life-${existingTemp}`, [spell.action.id], {
        hp: { current: 7, max: 15, temp: existingTemp },
      });
      const observer = isolatedActor(spell.root, `false-life-observer-${existingTemp}`, []);
      const test = harness(`false-life-${existingTemp}`, [source, observer], [
        { label: 'False Life die 1', sides: 4, value: 2 },
        { label: 'False Life die 2', sides: 4, value: 3 },
      ]);
      startEncounter(test.session, `false-${existingTemp}`, [source.id, observer.id]);
      const before = copy(test.session.getState().actors[source.id].runtime);
      const result = dispatchAccepted(test.session, {
        type: 'UseAction', commandId: `false-${existingTemp}:cast`, actorId: source.id,
        actionId: spell.action.id, targetIds: [source.id],
        factsByTarget: { [source.id]: selfFacts() },
      });
      const after = test.session.getState().actors[source.id].runtime;
      expect(recorded(result.events)).toContainEqual({ type: 'temp_hp', amount: 9 });
      expect(after.hp).toEqual({ current: 7, max: 15, temp: expectedTemp });
      expect(after.resources.action).toBe(before.resources.action - 1);
      expect(after.resources.spell_slot_1).toBe(before.resources.spell_slot_1 - 1);
      expect(test.session.getState().actors[observer.id].runtime).toEqual(observer.runtime);
      test.tape.assertExhausted();
      expectReplay(test);
    };

    run(0, 9);
    run(12, 12);
  });

  it('executes Ray of Frost hit damage and a source-owned -10 Speed effect through the caster next-turn start', () => {
    const spell = findSpell('SPELL-0218', 'CLASS-wizard');
    expectPinnedSpell(spell, 'SPELL-0218');
    expect(spell.action.spell.level).toBe(0);
    expect(spell.action.mechanics).toMatchObject({
      activation: { cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'spell_ranged',
        on_hit: [
          { kind: 'damage', dice: '1d8', type: 'cold' },
          {
            kind: 'modifier', applies_to: { roll: 'speed' }, op: 'add', value: '-10',
            duration: { type: 'until_start_of_source_next_turn' },
          },
        ],
      }],
    });

    const source = isolatedActor(spell.root, 'ray-caster', [spell.action.id]);
    const target = isolatedActor(spell.root, 'ray-target', [], {
      ac: 10,
      hp: { current: 30, max: 30, temp: 0 },
    });
    const test = harness('ray-of-frost', [source, target], [
      { label: 'Ray of Frost attack', sides: 20, value: 10 },
      { label: 'Ray of Frost damage', sides: 8, value: 6 },
    ]);
    startEncounter(test.session, 'ray', [source.id, target.id]);
    const beforeResources = copy(test.session.getState().actors[source.id].runtime.resources);
    const baseSpeed = breakdownValue('speed', target.character, target.runtime, target.passives ?? []).value;
    const result = dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'ray:cast', actorId: source.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: enemyFacts(60) },
    });
    expect(rollEvents(result.events)[0].roll.outcome).toBe('hit');
    expect(damageEvents(result.events)).toEqual([expect.objectContaining({
      amount: 6,
      damageType: 'cold',
      roll: expect.objectContaining({ dice: [{ sides: 8, result: 6 }] }),
    })]);
    const targetAfterHit = test.session.getState().actors[target.id];
    expect(targetAfterHit.runtime.hp.current).toBe(24);
    expect(targetAfterHit.runtime.activeEffects).toEqual([
      expect.objectContaining({
        name: spell.action.name,
        ownerId: target.id,
        sourceId: source.id,
        expiry: 'source_turn',
        sourceTurnExpiry: {
          sourceActorId: source.id,
          ownerActorId: target.id,
          boundary: 'start',
        },
        mechanics: expect.objectContaining({
          applies_to: { roll: 'speed' }, value: '-10',
        }),
      }),
    ]);
    expect(breakdownValue(
      'speed', targetAfterHit.character, targetAfterHit.runtime, targetAfterHit.passives ?? [],
    ).value).toBe(baseSpeed - 10);
    expect(test.session.getState().actors[source.id].runtime.resources.action)
      .toBe(beforeResources.action - 1);
    expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1)
      .toBe(beforeResources.spell_slot_1);

    endTurn(test.session, 'ray:source:end:1', source.id);
    startTurn(test.session, 'ray:target:start:1', target.id);
    expect(test.session.getState().actors[target.id].runtime.activeEffects).toHaveLength(1);
    endTurn(test.session, 'ray:target:end:1', target.id);
    startTurn(test.session, 'ray:source:start:2', source.id);
    const expired = test.session.getState().actors[target.id];
    expect(expired.runtime.activeEffects).toEqual([]);
    expect(breakdownValue('speed', expired.character, expired.runtime, expired.passives ?? []).value)
      .toBe(baseSpeed);
    test.tape.assertExhausted();
    expectReplay(test);
  });

  it('executes Chill Touch melee hit damage and denies only HP healing through the caster next-turn end', () => {
    const spell = findSpell('chill_touch', 'CLASS-wizard');
    const cure = findSpell('SPELL-0214', 'CLASS-cleric');
    expectPinnedSpell(spell, 'chill_touch');
    expectPinnedSpell(cure, 'SPELL-0214');
    expect(spell.action.spell.level).toBe(0);
    expect(spell.action.targeting?.rangeFt).toBe(5);
    expect(spell.action.mechanics).toMatchObject({
      activation: { cost: [{ resource: 'action' }] },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'spell_melee',
        on_hit: [
          { kind: 'damage', dice: '1d10', type: 'necrotic' },
          {
            kind: 'modifier', applies_to: { roll: 'healing' }, op: 'deny',
            duration: { type: 'until_end_of_source_next_turn' },
          },
        ],
      }],
    });

    const source = isolatedActor(spell.root, 'chill-caster', [spell.action.id]);
    const healer = isolatedActor(cure.root, 'chill-healer', [cure.action.id], {
      ac: 10,
      hp: { current: 25, max: 30, temp: 7 },
    });
    expect(healer.runtime.resources.spell_slot_1).toBeGreaterThanOrEqual(2);
    const test = harness('chill-touch', [source, healer], [
      { label: 'Chill Touch attack', sides: 20, value: 10 },
      { label: 'Chill Touch damage', sides: 10, value: 6 },
      { label: 'Cure Wounds after expiry die 1', sides: 8, value: 2 },
      { label: 'Cure Wounds after expiry die 2', sides: 8, value: 3 },
    ]);
    startEncounter(test.session, 'chill', [source.id, healer.id]);
    const sourceAction = test.session.getState().actors[source.id].runtime.resources.action;
    const sourceSlots = test.session.getState().actors[source.id].runtime.resources.spell_slot_1;
    const hit = dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'chill:cast', actorId: source.id,
      actionId: spell.action.id, targetIds: [healer.id],
      factsByTarget: { [healer.id]: enemyFacts(5) },
    });
    expect(damageEvents(hit.events)).toEqual([expect.objectContaining({
      amount: 6,
      damageType: 'necrotic',
      roll: expect.objectContaining({ dice: [{ sides: 10, result: 6 }] }),
    })]);
    expect(test.session.getState().actors[source.id].runtime.resources.spell_slot_1).toBe(sourceSlots);
    expect(test.session.getState().actors[source.id].runtime.resources.action).toBe(sourceAction - 1);
    const chilled = test.session.getState().actors[healer.id];
    expect(chilled.runtime.hp).toEqual({ current: 25, max: 30, temp: 1 });
    expect(chilled.runtime.activeEffects).toEqual([
      expect.objectContaining({
        ownerId: healer.id,
        sourceId: source.id,
        sourceTurnExpiry: {
          sourceActorId: source.id,
          ownerActorId: healer.id,
          boundary: 'end',
        },
        mechanics: expect.objectContaining({ applies_to: { roll: 'healing' }, op: 'deny' }),
      }),
    ]);

    endTurn(test.session, 'chill:source:end:1', source.id);
    startTurn(test.session, 'chill:healer:start:1', healer.id);
    const healerSlots = test.session.getState().actors[healer.id].runtime.resources.spell_slot_1;
    const denied = dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'chill:cure:denied', actorId: healer.id,
      actionId: cure.action.id, targetIds: [healer.id],
      factsByTarget: { [healer.id]: selfFacts() },
    });
    expect(recorded(denied.events)).toContainEqual({
      type: 'narrative', text: 'Лечение заблокировано действующим эффектом.',
    });
    expect(recorded(denied.events).some((event) => event.type === 'healing')).toBe(false);
    expect(test.session.getState().actors[healer.id].runtime.hp)
      .toEqual({ current: 25, max: 30, temp: 1 });
    expect(test.session.getState().actors[healer.id].runtime.resources.spell_slot_1)
      .toBe(healerSlots - 1);

    endTurn(test.session, 'chill:healer:end:1', healer.id);
    startTurn(test.session, 'chill:source:start:2', source.id);
    expect(test.session.getState().actors[healer.id].runtime.activeEffects[0].sourceTurnExpiry)
      .toMatchObject({ boundary: 'end', armed: true });
    endTurn(test.session, 'chill:source:end:2', source.id);
    expect(test.session.getState().actors[healer.id].runtime.activeEffects).toEqual([]);
    startTurn(test.session, 'chill:healer:start:2', healer.id);
    const healed = dispatchAccepted(test.session, {
      type: 'UseAction', commandId: 'chill:cure:allowed', actorId: healer.id,
      actionId: cure.action.id, targetIds: [healer.id],
      factsByTarget: { [healer.id]: selfFacts() },
    });
    const healing = recorded(healed.events).filter((event): event is Extract<
      EngineEvent,
      { type: 'healing' }
    > => event.type === 'healing');
    const expectedHealing = 2 + 3 + (healer.character.spellcastingMod ?? 0);
    expect(healing).toEqual([expect.objectContaining({
      amount: expectedHealing,
      roll: expect.objectContaining({
        dice: [
          { sides: 8, result: 2 },
          { sides: 8, result: 3 },
        ],
      }),
    })]);
    expect(test.session.getState().actors[healer.id].runtime.hp).toEqual({
      current: Math.min(30, 25 + expectedHealing),
      max: 30,
      temp: 1,
    });
    expect(test.session.getState().actors[healer.id].runtime.resources.spell_slot_1)
      .toBe(healerSlots - 2);
    test.tape.assertExhausted();
    expectReplay(test);
  });

  it('executes Guiding Bolt 4d6 Radiant and consumes next-attack Advantage or expires it at the source-turn boundary', () => {
    const root = findRootWithSpells('CLASS-cleric', ['SPELL-0229', 'fire_bolt']);
    const spell = findSpell('SPELL-0229', 'CLASS-cleric', root);
    const followUp = findSpell('fire_bolt', 'CLASS-cleric', root);
    expectPinnedSpell(spell, 'SPELL-0229');
    expectPinnedSpell(followUp, 'fire_bolt');
    expect(spell.action.spell.level).toBe(1);
    expect(spell.action.mechanics).toMatchObject({
      activation: {
        cost: [
          { resource: 'action' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{
        resolution: 'attack_roll', attack_kind: 'spell_ranged',
        on_hit: [
          { kind: 'damage', dice: '4d6', type: 'radiant' },
          {
            kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage',
            scope: 'target', consume: 'next',
            duration: { type: 'until_end_of_source_next_turn' },
          },
        ],
      }],
    });

    const caster = isolatedActor(root, 'bolt-caster', [spell.action.id, followUp.action.id]);
    const target = isolatedActor(root, 'bolt-target', [], {
      ac: 10,
      hp: { current: 50, max: 50, temp: 0 },
    });
    const consumed = harness('guiding-bolt-consumed', [caster, target], [
      { label: 'Guiding Bolt attack', sides: 20, value: 8 },
      { label: 'Guiding Bolt damage 1', sides: 6, value: 1 },
      { label: 'Guiding Bolt damage 2', sides: 6, value: 2 },
      { label: 'Guiding Bolt damage 3', sides: 6, value: 3 },
      { label: 'Guiding Bolt damage 4', sides: 6, value: 4 },
      { label: 'advantaged Fire Bolt high', sides: 20, value: 15 },
      { label: 'advantaged Fire Bolt low', sides: 20, value: 3 },
      { label: 'Fire Bolt damage', sides: 10, value: 5 },
    ]);
    startEncounter(consumed.session, 'bolt-consume', [caster.id, target.id]);
    const actionResource = consumed.session.getState().actors[caster.id].runtime.resources.action;
    const slots = consumed.session.getState().actors[caster.id].runtime.resources.spell_slot_1;
    const cast = dispatchAccepted(consumed.session, {
      type: 'UseAction', commandId: 'bolt-consume:cast', actorId: caster.id,
      actionId: spell.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: enemyFacts(120) },
    });
    expect(damageEvents(cast.events)).toEqual([expect.objectContaining({
      amount: 10,
      damageType: 'radiant',
      roll: expect.objectContaining({
        dice: [
          { sides: 6, result: 1 },
          { sides: 6, result: 2 },
          { sides: 6, result: 3 },
          { sides: 6, result: 4 },
        ],
      }),
    })]);
    expect(consumed.session.getState().actors[caster.id].runtime.resources.spell_slot_1)
      .toBe(slots - 1);
    expect(consumed.session.getState().actors[caster.id].runtime.resources.action)
      .toBe(actionResource - 1);
    expect(consumed.session.getState().actors[target.id].runtime.activeEffects).toEqual([
      expect.objectContaining({
        ownerId: target.id,
        sourceId: caster.id,
        sourceTurnExpiry: {
          sourceActorId: caster.id,
          ownerActorId: target.id,
          boundary: 'end',
        },
        mechanics: expect.objectContaining({
          applies_to: { roll: 'attack' }, op: 'advantage', scope: 'target', consume: 'next',
        }),
      }),
    ]);

    endTurn(consumed.session, 'bolt-consume:caster:end:1', caster.id);
    startTurn(consumed.session, 'bolt-consume:target:start:1', target.id);
    endTurn(consumed.session, 'bolt-consume:target:end:1', target.id);
    startTurn(consumed.session, 'bolt-consume:caster:start:2', caster.id);
    const followUpResult = dispatchAccepted(consumed.session, {
      type: 'UseAction', commandId: 'bolt-consume:follow-up', actorId: caster.id,
      actionId: followUp.action.id, targetIds: [target.id],
      factsByTarget: { [target.id]: enemyFacts(120) },
    });
    const followUpRoll = rollEvents(followUpResult.events)[0].roll;
    expect(followUpRoll).toMatchObject({
      advantage: 'advantage',
      outcome: 'hit',
      dice: [
        { sides: 20, result: 15 },
        { sides: 20, result: 3, discarded: true },
      ],
    });
    expect(consumed.session.getState().actors[target.id].runtime.activeEffects).toEqual([]);
    expect(damageEvents(followUpResult.events)).toEqual([
      expect.objectContaining({ amount: 5, damageType: 'fire' }),
    ]);
    consumed.tape.assertExhausted();
    expectReplay(consumed);

    const expiringCaster = isolatedActor(root, 'bolt-expiry-caster', [spell.action.id]);
    const expiringTarget = isolatedActor(root, 'bolt-expiry-target', [], {
      ac: 10,
      hp: { current: 50, max: 50, temp: 0 },
    });
    const expired = harness('guiding-bolt-expired', [expiringCaster, expiringTarget], [
      { label: 'Guiding Bolt expiry attack', sides: 20, value: 8 },
      { label: 'Guiding Bolt expiry damage 1', sides: 6, value: 1 },
      { label: 'Guiding Bolt expiry damage 2', sides: 6, value: 1 },
      { label: 'Guiding Bolt expiry damage 3', sides: 6, value: 1 },
      { label: 'Guiding Bolt expiry damage 4', sides: 6, value: 1 },
    ]);
    startEncounter(expired.session, 'bolt-expiry', [expiringCaster.id, expiringTarget.id]);
    dispatchAccepted(expired.session, {
      type: 'UseAction', commandId: 'bolt-expiry:cast', actorId: expiringCaster.id,
      actionId: spell.action.id, targetIds: [expiringTarget.id],
      factsByTarget: { [expiringTarget.id]: enemyFacts(120) },
    });
    endTurn(expired.session, 'bolt-expiry:caster:end:1', expiringCaster.id);
    startTurn(expired.session, 'bolt-expiry:target:start:1', expiringTarget.id);
    endTurn(expired.session, 'bolt-expiry:target:end:1', expiringTarget.id);
    startTurn(expired.session, 'bolt-expiry:caster:start:2', expiringCaster.id);
    expect(expired.session.getState().actors[expiringTarget.id].runtime.activeEffects[0].sourceTurnExpiry)
      .toMatchObject({ boundary: 'end', armed: true });
    endTurn(expired.session, 'bolt-expiry:caster:end:2', expiringCaster.id);
    expect(expired.session.getState().actors[expiringTarget.id].runtime.activeEffects).toEqual([]);
    expired.tape.assertExhausted();
    expectReplay(expired);
  });

  it('executes compiled Magic Missile as three distributed d4+1 darts and lets compiled Shield negate its allocated darts', () => {
    const root = findRootWithSpells('CLASS-wizard', ['SPELL-0174', 'SPELL-0317']);
    const magicMissile = findSpell('SPELL-0174', 'CLASS-wizard', root);
    const shield = findSpell('SPELL-0317', 'CLASS-wizard', root);
    expectPinnedSpell(magicMissile, 'SPELL-0174');
    expectPinnedSpell(shield, 'SPELL-0317');
    expect(magicMissile.action.mechanics).toMatchObject({
      primitive: {
        type: 'magic_missile',
        policy: {
          base_dart_count: 3,
          darts_per_slot_above: 1,
          allocation_choice_id: 'magic_missile_dart_targets',
          simultaneous: true,
          per_dart_effect: {
            resolution: 'auto', who: 'target',
            result: [{ kind: 'damage', dice: '1d4 + 1', type: 'force' }],
          },
        },
      },
    });
    expect(magicMissile.action.targeting).toMatchObject({ minTargets: 1, maxTargets: 11, rangeFt: 120 });
    expect(shield.action.mechanics).toMatchObject({
      activation: {
        mode: 'reaction',
        trigger: { events: ['hit_by_attack', 'targeted_by_magic_missile'] },
      },
    });

    const soloCaster = isolatedActor(root, 'missile-solo-caster', [magicMissile.action.id]);
    const soloTarget = isolatedActor(root, 'missile-solo-target', [], {
      hp: { current: 30, max: 30, temp: 0 },
    });
    const solo = harness('compiled-missile-solo', [soloCaster, soloTarget], [
      { label: 'compiled solo dart 1', sides: 4, value: 1 },
      { label: 'compiled solo dart 2', sides: 4, value: 2 },
      { label: 'compiled solo dart 3', sides: 4, value: 3 },
    ]);
    startEncounter(solo.session, 'compiled-missile-solo', [soloCaster.id, soloTarget.id]);
    const soloBefore = copy(solo.session.getState().actors[soloCaster.id].runtime.resources);
    const soloResult = dispatchAccepted(solo.session, {
      type: 'UseAction', commandId: 'compiled-missile-solo:cast', actorId: soloCaster.id,
      actionId: magicMissile.action.id,
      targetIds: [soloTarget.id],
      factsByTarget: { [soloTarget.id]: enemyFacts(120) },
      choices: {
        magic_missile_dart_targets: [soloTarget.id, soloTarget.id, soloTarget.id],
      },
      spell: { baseLevel: 1, castLevel: 1 },
    });
    expect(solo.session.getState().pendingResolution).toBeNull();
    expect(solo.session.getState().actors[soloTarget.id].runtime.hp.current).toBe(21);
    expect(damageEvents(soloResult.events).map((event) => ({
      amount: event.amount,
      damageType: event.damageType,
      die: event.roll?.dice[0]?.result,
    }))).toEqual([
      { amount: 2, damageType: 'force', die: 1 },
      { amount: 3, damageType: 'force', die: 2 },
      { amount: 4, damageType: 'force', die: 3 },
    ]);
    expect(solo.session.getState().actors[soloCaster.id].runtime.resources).toMatchObject({
      action: soloBefore.action - 1,
      spell_slot_1: soloBefore.spell_slot_1 - 1,
    });
    solo.tape.assertExhausted();
    expectReplay(solo);

    const caster = isolatedActor(root, 'missile-mixed-caster', [magicMissile.action.id]);
    const protectedTarget = isolatedActor(root, 'missile-mixed-protected', [shield.action.id], {
      hp: { current: 30, max: 30, temp: 0 },
    });
    const unprotectedTarget = isolatedActor(root, 'missile-mixed-unprotected', [], {
      hp: { current: 30, max: 30, temp: 0 },
    });
    const mixed = harness(
      'compiled-missile-mixed',
      [caster, protectedTarget, unprotectedTarget],
      [{ label: 'compiled unprotected dart', sides: 4, value: 4 }],
    );
    startEncounter(mixed.session, 'compiled-missile-mixed', [
      caster.id,
      protectedTarget.id,
      unprotectedTarget.id,
    ]);
    const opening = dispatchAccepted(mixed.session, {
      type: 'UseAction', commandId: 'compiled-missile-mixed:cast', actorId: caster.id,
      actionId: magicMissile.action.id,
      targetIds: [protectedTarget.id, unprotectedTarget.id],
      factsByTarget: {
        [protectedTarget.id]: enemyFacts(30),
        [unprotectedTarget.id]: enemyFacts(60),
      },
      choices: {
        magic_missile_dart_targets: [protectedTarget.id, protectedTarget.id, unprotectedTarget.id],
      },
      spell: { baseLevel: 1, castLevel: 1 },
    });
    expect(damageEvents(opening.events)).toEqual([]);
    expect(mixed.tape.consumed()).toBe(0);
    expect(mixed.session.getState().pendingResolution).toMatchObject({
      type: 'magic_missile_reaction',
      targetActorId: protectedTarget.id,
      request: {
        trigger: { type: 'targeted_by_magic_missile', dartCount: 2 },
        options: [{ actionId: shield.action.id }],
      },
    });

    const openingEvents = copy(mixed.session.getEvents());
    const checkpoint = JSON.parse(JSON.stringify(mixed.session.getState())) as WorldState;
    const restored = new InMemoryRulesSession(checkpoint, provider.catalog, {
      rng: mixed.tape.rng,
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: createSequentialIdFactory('unused-compiled-missile-reload'),
    });
    const pending = restored.getState().pendingResolution;
    if (!pending || pending.type !== 'magic_missile_reaction') {
      throw new Error('Compiled Magic Missile reaction disappeared after reload');
    }
    const resolution = dispatchAccepted(restored, {
      type: 'ResolveDecision', commandId: 'compiled-missile-mixed:shield', actorId: protectedTarget.id,
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'reaction', actionId: shield.action.id },
    });
    mixed.tape.assertExhausted();
    const final = restored.getState();
    expect(final.pendingResolution).toBeNull();
    expect(final.actors[protectedTarget.id].runtime.hp.current).toBe(30);
    expect(final.actors[unprotectedTarget.id].runtime.hp.current).toBe(25);
    expect(final.actors[protectedTarget.id].runtime.resources).toMatchObject({
      reaction: 0,
      spell_slot_1: protectedTarget.runtime.resources.spell_slot_1 - 1,
    });
    expect(final.actors[protectedTarget.id].runtime.activeEffects).toEqual([
      expect.objectContaining({
        expiry: 'start_of_next_turn',
        mechanics: expect.objectContaining({
          applies_to: { roll: 'ac' }, op: 'add', value: '+5',
          magic_missile_immunity: true,
        }),
      }),
    ]);
    expect(damageEvents(resolution.events)).toEqual([
      expect.objectContaining({ amount: 5, damageType: 'force' }),
    ]);
    expect(recorded(resolution.events).filter((event) => (
      event.type === 'narrative' && event.text.startsWith('Shield blocks Magic Missile dart')
    ))).toHaveLength(2);
    expect(foldEvents(copy(mixed.initial), [...openingEvents, ...resolution.events])).toEqual(final);

    const replayTape = createStrictRngTape([
      { label: 'replayed compiled unprotected dart', sides: 4, value: 4 },
    ]);
    const replay = new InMemoryRulesSession(copy(checkpoint), provider.catalog, {
      rng: replayTape.rng,
      clock: createLogicalClock(checkpoint.logicalClock),
      nextId: createSequentialIdFactory('different-compiled-missile-id-state'),
    });
    const replayPending = replay.getState().pendingResolution;
    if (!replayPending || replayPending.type !== 'magic_missile_reaction') {
      throw new Error('Compiled Magic Missile replay reaction disappeared');
    }
    const replayResolution = dispatchAccepted(replay, {
      type: 'ResolveDecision', commandId: 'compiled-missile-mixed:shield', actorId: protectedTarget.id,
      resolutionId: replayPending.id,
      requestId: replayPending.request.id,
      response: { kind: 'reaction', actionId: shield.action.id },
    });
    replayTape.assertExhausted();
    expect(JSON.stringify(replayResolution.events)).toBe(JSON.stringify(resolution.events));
    expect(JSON.stringify(replay.getState())).toBe(JSON.stringify(final));
  });

  it('executes Shield only in a hit reaction window with accept, decline, exact costs, +5 AC, and start-turn expiry', () => {
    const attack = findSpell('fire_bolt', 'CLASS-wizard');
    const shield = findSpell('SPELL-0317', 'CLASS-wizard');
    expectPinnedSpell(attack, 'fire_bolt');
    expectPinnedSpell(shield, 'SPELL-0317');
    expect(shield.action.spell.level).toBe(1);
    expect(shield.action.mechanics).toMatchObject({
      activation: {
        mode: 'reaction',
        trigger: { event: 'hit_by_attack' },
        cost: [
          { resource: 'reaction' },
          { resource: 'spell_slot', level: 1, amount: 1 },
        ],
      },
      effects: [{ resolution: 'auto' }],
    });
    const shieldEffect = (shield.action.mechanics.effects as Array<Record<string, unknown>>)[0];
    expect(shieldEffect.result).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+5',
      duration: { type: 'until_start_of_next_turn' },
    })]));

    const directDefender = isolatedActor(shield.root, 'shield-direct', [shield.action.id], { ac: 12 });
    const directAttacker = isolatedActor(attack.root, 'shield-direct-attacker', [attack.action.id]);
    const direct = harness('shield-direct', [directDefender, directAttacker], []);
    startEncounter(direct.session, 'shield-direct', [directDefender.id, directAttacker.id]);
    const beforeDirect = direct.session.getState();
    const rejected = direct.session.dispatch({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'shield-direct:illegal-cast',
      expectedRevision: beforeDirect.revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId: directDefender.id,
      actionId: shield.action.id,
      targetIds: [directDefender.id],
      factsByTarget: { [directDefender.id]: selfFacts() },
    });
    expect(rejected).toMatchObject({ status: 'rejected', code: 'InvalidActionTiming' });
    expect(direct.session.getState()).toBe(beforeDirect);
    direct.tape.assertExhausted();
    expectReplay(direct);

    const acceptingAttacker = isolatedActor(attack.root, 'shield-accept-attacker', [attack.action.id]);
    const acceptingDefender = isolatedActor(shield.root, 'shield-accept-defender', [shield.action.id], {
      ac: 12,
      hp: { current: 30, max: 30, temp: 0 },
    });
    const accepted = harness('shield-accepted', [acceptingAttacker, acceptingDefender], [
      { label: 'attack before accepted Shield', sides: 20, value: 10 },
    ]);
    startEncounter(accepted.session, 'shield-accept', [acceptingAttacker.id, acceptingDefender.id]);
    const defenderBefore = copy(accepted.session.getState().actors[acceptingDefender.id]);
    const attackOpened = dispatchAccepted(accepted.session, {
      type: 'UseAction', commandId: 'shield-accept:attack', actorId: acceptingAttacker.id,
      actionId: attack.action.id, targetIds: [acceptingDefender.id],
      factsByTarget: { [acceptingDefender.id]: enemyFacts(120) },
    });
    expect(damageEvents(attackOpened.events)).toEqual([]);
    expect(accepted.session.getState().pendingResolution).toMatchObject({
      type: 'attack_reaction',
      request: {
        actorId: acceptingDefender.id,
        trigger: { type: 'hit_by_attack', originalAc: 12 },
        options: [{ actionId: shield.action.id }],
      },
    });
    const reaction = resolveReaction(
      accepted.session,
      'shield-accept:reaction',
      shield.action.id,
    );
    expect(damageEvents(reaction.events)).toEqual([]);
    const defenderAfter = accepted.session.getState().actors[acceptingDefender.id];
    expect(defenderAfter.runtime.hp.current).toBe(30);
    expect(defenderAfter.runtime.resources.reaction).toBe(defenderBefore.runtime.resources.reaction - 1);
    expect(defenderAfter.runtime.resources.spell_slot_1)
      .toBe(defenderBefore.runtime.resources.spell_slot_1 - 1);
    expect(defenderAfter.runtime.activeEffects).toEqual([
      expect.objectContaining({
        expiry: 'start_of_next_turn',
        mechanics: expect.objectContaining({
          applies_to: { roll: 'ac' }, op: 'add', value: '+5',
        }),
      }),
    ]);
    const beforeAc = armorClassValue(
      defenderBefore.character,
      defenderBefore.runtime,
      defenderBefore.passives ?? [],
    ).value;
    expect(armorClassValue(
      defenderAfter.character,
      defenderAfter.runtime,
      defenderAfter.passives ?? [],
    ).value).toBe(beforeAc + 5);
    const resumedAttack = rollEvents(reaction.events).find((event) => (
      event.label === 'Атака — после реакции'
    ));
    expect(resumedAttack?.roll).toMatchObject({
      outcome: 'miss',
      target: { type: 'ac', value: 17 },
    });
    expect(reaction.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actorId: acceptingDefender.id,
        actionId: shield.action.id,
        actionKind: 'spell',
        timing: 'reaction',
      }),
    }));
    endTurn(accepted.session, 'shield-accept:attacker:end', acceptingAttacker.id);
    startTurn(accepted.session, 'shield-accept:defender:start', acceptingDefender.id);
    const afterExpiry = accepted.session.getState().actors[acceptingDefender.id];
    expect(afterExpiry.runtime.activeEffects).toEqual([]);
    expect(afterExpiry.runtime.resources.reaction).toBe(afterExpiry.runtime.maxResources.reaction);
    expect(armorClassValue(
      afterExpiry.character,
      afterExpiry.runtime,
      afterExpiry.passives ?? [],
    ).value).toBe(beforeAc);
    accepted.tape.assertExhausted();
    expectReplay(accepted);

    const decliningAttacker = isolatedActor(attack.root, 'shield-decline-attacker', [attack.action.id]);
    const decliningDefender = isolatedActor(shield.root, 'shield-decline-defender', [shield.action.id], {
      ac: 12,
      hp: { current: 30, max: 30, temp: 0 },
    });
    const declined = harness('shield-declined', [decliningAttacker, decliningDefender], [
      { label: 'attack before declined Shield', sides: 20, value: 10 },
      { label: 'damage after declined Shield', sides: 10, value: 6 },
    ]);
    startEncounter(declined.session, 'shield-decline', [decliningAttacker.id, decliningDefender.id]);
    const declineResources = copy(declined.session.getState().actors[decliningDefender.id].runtime.resources);
    dispatchAccepted(declined.session, {
      type: 'UseAction', commandId: 'shield-decline:attack', actorId: decliningAttacker.id,
      actionId: attack.action.id, targetIds: [decliningDefender.id],
      factsByTarget: { [decliningDefender.id]: enemyFacts(120) },
    });
    const declineResult = resolveReaction(declined.session, 'shield-decline:reaction', null);
    expect(damageEvents(declineResult.events)).toEqual([
      expect.objectContaining({ amount: 6, damageType: 'fire' }),
    ]);
    expect(declined.session.getState().actors[decliningDefender.id].runtime.hp.current).toBe(24);
    expect(declined.session.getState().actors[decliningDefender.id].runtime.resources)
      .toEqual(declineResources);
    expect(declined.session.getState().actors[decliningDefender.id].runtime.activeEffects).toEqual([]);
    declined.tape.assertExhausted();
    expectReplay(declined);

    const missingAttacker = isolatedActor(attack.root, 'shield-miss-attacker', [attack.action.id]);
    const missingDefender = isolatedActor(shield.root, 'shield-miss-defender', [shield.action.id], {
      ac: 12,
      hp: { current: 30, max: 30, temp: 0 },
    });
    const missed = harness('shield-missed', [missingAttacker, missingDefender], [
      { label: 'attack that misses before Shield', sides: 20, value: 2 },
    ]);
    startEncounter(missed.session, 'shield-miss', [missingAttacker.id, missingDefender.id]);
    const missResources = copy(missed.session.getState().actors[missingDefender.id].runtime.resources);
    const missResult = dispatchAccepted(missed.session, {
      type: 'UseAction', commandId: 'shield-miss:attack', actorId: missingAttacker.id,
      actionId: attack.action.id, targetIds: [missingDefender.id],
      factsByTarget: { [missingDefender.id]: enemyFacts(120) },
    });
    expect(rollEvents(missResult.events)[0].roll.outcome).toBe('miss');
    expect(missed.session.getState().pendingResolution).toBeNull();
    expect(missed.session.getState().actors[missingDefender.id].runtime.resources).toEqual(missResources);
    expect(missed.session.getState().actors[missingDefender.id].runtime.hp.current).toBe(30);
    missed.tape.assertExhausted();
    expectReplay(missed);
  });
});
