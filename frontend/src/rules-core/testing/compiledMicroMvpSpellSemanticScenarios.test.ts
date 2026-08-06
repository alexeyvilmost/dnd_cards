import { beforeAll, describe, expect, it } from 'vitest';
import { armorClassValue } from '../../engine/ac';
import { breakdownValue } from '../../engine/breakdown';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import type { EngineEvent } from '../../mvp/contracts';
import {
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
  createLogicalClock,
  createSequentialIdFactory,
  createStrictRngTape,
  type DieTapeEntry,
  type StrictRngTape,
} from '../determinism';
import { foldEvents } from '../reducer';
import { InMemoryRulesSession } from '../session';
import type { SpellGrantAccess } from '../spellcastingAccess';
import { migrateWorldState } from '../worldMigration';
import type { WorldObjectState } from '../worldObjects';

type Accepted = Extract<CommandResult, { status: 'accepted' }>;
type CompiledSpellAction = Extract<RuleActionDefinition, { kind: 'spell' }>;

interface CompiledSpellFixture {
  root: CompiledMicroMvpL1Root;
  entityId: string;
  cardNumber: string;
  action: CompiledSpellAction;
  grant: SpellGrantAccess;
}

interface ActorOptions {
  ac?: number;
  hp?: { current: number; max: number; temp: number };
  abilityMods?: Partial<ActorState['character']['abilityMods']>;
}

const BASE_ENVELOPE_TAPE: readonly DieTapeEntry[] = [
  { label: 'envelope ability check', sides: 20, value: 12 },
  { label: 'envelope Hide check', sides: 20, value: 20 },
  { label: 'envelope saving throw', sides: 20, value: 12 },
];

const CLASS = {
  wizard: 'CLASS-wizard',
  cleric: 'CLASS-cleric',
  druid: 'CLASS-druid',
  fighter: 'CLASS-warrior',
} as const;

let provider: CompiledMicroMvpL1Provider;
let wizard: CompiledMicroMvpL1Root;
let cleric: CompiledMicroMvpL1Root;
let druid: CompiledMicroMvpL1Root;
let fighter: CompiledMicroMvpL1Root;
let catalog: RulesCatalog;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing compiled spell scenario fixture: ${description}`);
  return value;
}

function rootByClass(
  compiled: CompiledMicroMvpL1Provider,
  classCardNumber: string,
): CompiledMicroMvpL1Root {
  return required(compiled.roots.find((root) => (
    root.matrixCase.klass.card_number === classCardNumber
      && root.matrixCase.species.card_number === 'RACE-0003'
      && root.matrixCase.originFeat.card_number === 'FEAT-0001'
  )), `${classCardNumber} Dwarf/Alert root`);
}

function spellFixture(
  root: CompiledMicroMvpL1Root,
  cardNumber: string,
  sourceId: string,
): CompiledSpellFixture {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === cardNumber),
    `${root.stableKey}:${cardNumber} entity`,
  );
  const action = required(root.rulesActions.find((candidate): candidate is CompiledSpellAction => (
    candidate.kind === 'spell'
      && candidate.sourceEntityIds.includes(entity.id)
      && candidate.spell.sourceClass === sourceId
  )), `${root.stableKey}:${cardNumber} action`);
  const grant = required(root.actor.spellcastingAccess?.grants.find((candidate) => (
    candidate.actionId === action.id && candidate.sourceId === sourceId
  )), `${root.stableKey}:${cardNumber} ${sourceId} grant`);
  return { root, entityId: entity.id, cardNumber, action, grant };
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
  const selected = new Set(actionIds);
  const actions = root.rulesActions.filter((action) => selected.has(action.id));
  actor.capabilities = actions.length
    ? {
        actionIds: actions.map((action) => action.id),
        featureSources: Object.fromEntries(actions.map((action) => (
          [action.id, [...action.sourceEntityIds]]
        ))),
      }
    : { actionIds: [] };
  if (actor.spellcastingAccess) {
    const grants = actor.spellcastingAccess.grants.filter((grant) => selected.has(grant.actionId));
    if (!grants.length) {
      delete actor.spellcastingAccess;
    } else {
      const spellbookSources = [...new Set(grants.filter((grant) => (
        grant.access === 'spellbook'
      )).map((grant) => grant.sourceId))].sort();
      actor.spellcastingAccess = {
        grants,
        preparedSources: Object.fromEntries(spellbookSources.map((sourceId) => {
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
    abilityMods: { ...actor.character.abilityMods, ...(options.abilityMods ?? {}) },
    skillProficiencies: [],
    skillExpertise: [],
    saveProficiencies: [],
  };
  if (options.ac !== undefined) actor.ac = options.ac;
  return actor;
}

function monsterFrom(root: CompiledMicroMvpL1Root, id: string): ActorState {
  const actor = isolatedActor(root, id, [], {
    ac: 10,
    hp: { current: 60, max: 60, temp: 0 },
    abilityMods: { dex: 0, con: 0 },
  });
  actor.kind = 'monster';
  return actor;
}

function facts(
  relation: SpatialFacts['relation'],
  distanceFt: number,
  extra: Partial<SpatialFacts> = {},
): SpatialFacts {
  return {
    factsSource: 'scenario',
    boardRevision: 1,
    distanceFt,
    lineOfSight: true,
    cover: 'none',
    relation,
    ...extra,
  };
}

function selfFacts(): SpatialFacts {
  return facts('self', 0);
}

function recorded(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

function rolls(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((event): event is Extract<EngineEvent, { type: 'roll' }> => (
    event.type === 'roll'
  ));
}

function damages(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((event): event is Extract<EngineEvent, { type: 'damage' }> => (
    event.type === 'damage'
  ));
}

function healings(events: readonly UncommittedRuleEvent[]) {
  return recorded(events).filter((event): event is Extract<EngineEvent, { type: 'healing' }> => (
    event.type === 'healing'
  ));
}

function conditions(actor: ActorState): string[] {
  return actor.runtime.activeEffects.flatMap((effect) => {
    const mechanics = effect.mechanics as Record<string, unknown>;
    return mechanics.kind === 'condition' && typeof mechanics.value === 'string'
      ? [mechanics.value]
      : [];
  });
}

class CompiledSpellEnvelope {
  readonly initial: WorldState;
  readonly tape: StrictRngTape;
  readonly events: UncommittedRuleEvent[] = [];
  readonly initiative: string[];
  private commandOrdinal = 0;
  private checkpointCount = 0;
  private session: InMemoryRulesSession;

  constructor(input: {
    id: string;
    actors: ActorState[];
    dice: readonly DieTapeEntry[];
    objects?: WorldObjectState[];
  }) {
    this.initial = createWorld({
      id: input.id,
      ruleset: provider.ruleset,
      actors: input.actors,
      objects: input.objects,
    });
    this.initiative = input.actors.map((actor) => actor.id);
    this.tape = createStrictRngTape(input.dice);
    const env = {
      rng: this.tape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory(`${input.id}:event`),
    };
    this.session = new InMemoryRulesSession(this.initial, catalog, env);
    this.environment = env;
  }

  private readonly environment: {
    rng: StrictRngTape['rng'];
    clock: () => number;
    nextId: () => string;
  };

  state(): WorldState {
    return this.session.getState();
  }

  dispatch(actorId: string, command: Record<string, unknown>): Accepted {
    this.commandOrdinal += 1;
    const result = this.session.dispatch({
      schemaVersion: 1,
      commandId: `${this.initial.id}:command:${this.commandOrdinal}`,
      expectedRevision: this.state().revision,
      rulesetContentHash: provider.ruleset.contentHash,
      actorId,
      ...command,
    } as unknown as GameCommand);
    if (result.status === 'rejected') throw new Error(`${result.code}: ${result.message}`);
    this.events.push(...result.events);
    return result;
  }

  checkpoint(): void {
    const before = copy(this.state());
    const persisted = JSON.parse(JSON.stringify(before)) as WorldState;
    const migrated = migrateWorldState(persisted);
    expect(migrated).toEqual(before);
    this.session = new InMemoryRulesSession(copy(migrated), catalog, this.environment);
    this.checkpointCount += 1;
  }

  preamble(casterId: string, targetId: string): void {
    this.dispatch(casterId, { type: 'StartEncounter', initiative: this.initiative });
    this.dispatch(casterId, { type: 'StartTurn' });
    const checked = this.dispatch(casterId, {
      type: 'AbilityCheck', ability: 'int', skill: 'investigation', dc: 5,
    });
    expect(rolls(checked.events)).toContainEqual(expect.objectContaining({
      roll: expect.objectContaining({ kind: 'check', outcome: 'success' }),
    }));
    const hidden = this.dispatch(casterId, {
      type: 'AttemptHide',
      eligibility: {
        factsSource: 'scenario', boardRevision: 1,
        heavilyObscured: true, cover: 'three_quarters', visibleToAnyEnemy: false,
      },
    });
    expect(hidden.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared', actionId: 'core.action.hide', actionKind: 'nonSpell',
      }),
    }));
    expect(conditions(this.state().actors[casterId])).toContain('invisible');
    this.checkpoint();
    expect(conditions(this.state().actors[casterId])).toContain('invisible');
    this.dispatch(casterId, {
      type: 'MakeNoise',
      facts: { factsSource: 'scenario', boardRevision: 2, loudness: 'above_whisper' },
    });
    expect(conditions(this.state().actors[casterId])).not.toContain('invisible');
    this.dispatch(casterId, { type: 'EndTurn' });
    this.dispatch(targetId, { type: 'StartTurn' });
    const saved = this.dispatch(targetId, { type: 'SavingThrow', ability: 'con', dc: 5 });
    expect(rolls(saved.events)).toContainEqual(expect.objectContaining({
      roll: expect.objectContaining({ kind: 'save', outcome: 'success' }),
    }));
    this.dispatch(targetId, { type: 'EndTurn' });
    for (const actorId of this.initiative.slice(2)) {
      this.dispatch(actorId, { type: 'StartTurn' });
      this.dispatch(actorId, { type: 'EndTurn' });
    }
    this.dispatch(casterId, { type: 'StartTurn' });
    expect(this.state().scene).toMatchObject({
      mode: 'encounter', round: 2, turnStarted: true,
    });
  }

  cast(input: {
    casterId: string;
    spell: CompiledSpellFixture;
    targetIds: string[];
    factsByTarget: Record<string, SpatialFacts>;
    choices?: Record<string, string | string[]>;
    worldInput?: Record<string, unknown>;
  }): Accepted {
    return this.dispatch(input.casterId, {
      type: 'UseAction',
      actionId: input.spell.action.id,
      targetIds: input.targetIds,
      factsByTarget: input.factsByTarget,
      ...(input.choices ? { choices: input.choices } : {}),
      ...(input.worldInput ? { worldInput: input.worldInput } : {}),
      spell: {
        baseLevel: input.spell.action.spell.level,
        grantId: input.spell.grant.grantId,
        mode: 'normal',
      },
    });
  }

  resolveTargetSave(value: number): Accepted {
    const pending = this.state().pendingResolution;
    if (!pending || pending.type !== 'target_save') throw new Error('Expected target-save continuation');
    return this.dispatch(pending.targetActorId, {
      type: 'ResolveDecision',
      resolutionId: pending.id,
      requestId: pending.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value }] } },
    });
  }

  cycleToCaster(casterId: string): void {
    this.dispatch(casterId, { type: 'EndTurn' });
    for (const actorId of this.initiative.filter((id) => id !== casterId)) {
      this.dispatch(actorId, { type: 'StartTurn' });
      this.dispatch(actorId, { type: 'EndTurn' });
    }
    this.dispatch(casterId, { type: 'StartTurn' });
  }

  finish(spell: CompiledSpellFixture): void {
    const playerCharacters = Object.values(this.initial.actors).filter((actor) => (
      actor.kind === 'playerCharacter'
    ));
    expect(playerCharacters).toHaveLength(2);
    expect(this.checkpointCount).toBeGreaterThanOrEqual(2);
    const declarations = this.events.flatMap((entry) => (
      entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
    ));
    expect(declarations).toContainEqual(expect.objectContaining({
      actionId: 'core.action.hide', actionKind: 'nonSpell',
    }));
    expect(declarations).toContainEqual(expect.objectContaining({
      actionId: spell.action.id,
      actionKind: 'spell',
      sourceEntityIds: expect.arrayContaining([spell.entityId]),
      spell: expect.objectContaining({
        grantId: spell.grant.grantId,
        sourceId: spell.grant.sourceId,
        spellcastingAbility: spell.grant.spellcastingAbility,
      }),
    }));
    const playerIds = new Set(playerCharacters.map((actor) => actor.id));
    expect(declarations.some((declaration) => (
      declaration.actionKind === 'spell'
        && declaration.targetIds.some((targetId) => (
          playerIds.has(declaration.actorId)
            && playerIds.has(targetId)
            && targetId !== declaration.actorId
        ))
    ))).toBe(true);
    const allRolls = rolls(this.events);
    expect(allRolls.some((event) => event.roll.kind === 'check')).toBe(true);
    expect(allRolls.some((event) => event.roll.kind === 'save')).toBe(true);
    expect(recorded(this.events)).toContainEqual({
      type: 'condition_applied', condition: 'invisible',
    });
    const expectedStrictTurns = [
      ...this.initiative.flatMap((actorId) => [
        `turn_started:${actorId}`,
        `turn_ended:${actorId}`,
      ]),
      `turn_started:${this.initiative[0]}`,
    ];
    expect(this.events.flatMap((entry) => (
      entry.payload.type === 'EngineEventRecorded'
        && (entry.payload.event.type === 'turn_started'
          || entry.payload.event.type === 'turn_ended')
        ? [`${entry.payload.event.type}:${entry.sourceActorId}`]
        : []
    )).slice(0, expectedStrictTurns.length)).toEqual(expectedStrictTurns);
    this.tape.assertExhausted();
    expect(migrateWorldState(copy(this.state()))).toEqual(this.state());
    expect(foldEvents(copy(this.initial), copy(this.events))).toEqual(this.state());
  }
}

function attackRoll(events: readonly UncommittedRuleEvent[]) {
  return required(rolls(events).find((event) => event.label.includes('Атака')), 'attack roll');
}

describe('compiled micro-MVP spell semantic scenarios', () => {
  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for compiled semantic scenarios');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
      fighter = rootByClass(provider, CLASS.fighter);
      [wizard, cleric, druid] = await compileMicroMvpL1ChoiceVariants([
        {
          stableKey: rootByClass(provider, CLASS.wizard).stableKey,
          overrides: {
            wizard_cantrips: ['fire_bolt', 'SPELL-0218', 'chill_touch'],
            wizard_spellbook_level_1: [
              'false_life', 'SPELL-0190', 'SPELL-0242',
              'SPELL-0171', 'SPELL-0174', 'SPELL-0317',
            ],
          },
        },
        {
          stableKey: rootByClass(provider, CLASS.cleric).stableKey,
          overrides: {
            cleric_cantrips: ['SPELL-0286', 'SPELL-0230', 'light'],
            cleric_spells_l1: ['SPELL-0214', 'SPELL-0229', 'SPELL-0163', 'SPELL-0236'],
          },
        },
        {
          stableKey: rootByClass(provider, CLASS.druid).stableKey,
          overrides: {
            druid_cantrips: ['poison_spray', 'SPELL-0230'],
          },
        },
      ]);
      const actions = new Map<string, RuleActionDefinition>();
      for (const root of [wizard, cleric, druid, fighter]) {
        for (const action of root.rulesActions) actions.set(action.id, action);
      }
      catalog = { getAction: (id) => actions.get(id) };
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('runs Fire Bolt, Poison Spray, and Ray of Frost hit/miss envelopes with exact damage and source-turn expiry', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-SPELL-ATTACK-CANTRIPS-01' },
  }, () => {
    const cases = [
      {
        spell: spellFixture(wizard, 'fire_bolt', CLASS.wizard),
        distanceFt: 120,
        die: 10,
        amount: 7,
        damageType: 'fire',
      },
      {
        spell: spellFixture(druid, 'poison_spray', CLASS.druid),
        distanceFt: 30,
        die: 12,
        amount: 9,
        damageType: 'poison',
      },
      {
        spell: spellFixture(wizard, 'SPELL-0218', CLASS.wizard),
        distanceFt: 60,
        die: 8,
        amount: 6,
        damageType: 'cold',
      },
    ] as const;

    for (const current of cases) {
      expect(current.spell.action.sourceEntityIds).toContain(current.spell.entityId);
      for (const lane of ['hit', 'miss'] as const) {
        const caster = isolatedActor(current.spell.root, 'caster', [current.spell.action.id]);
        const target = isolatedActor(fighter, 'target', [], {
          ac: 10,
          hp: { current: 50, max: 50, temp: 0 },
        });
        const test = new CompiledSpellEnvelope({
          id: `compiled-${current.spell.cardNumber}-${lane}`,
          actors: [caster, target],
          dice: [
            ...BASE_ENVELOPE_TAPE,
            { label: `${current.spell.cardNumber} attack`, sides: 20, value: lane === 'hit' ? 10 : 1 },
            ...(lane === 'hit' ? [{
              label: `${current.spell.cardNumber} damage`, sides: current.die, value: current.amount,
            }] : []),
          ],
        });
        test.preamble(caster.id, target.id);
        const targetHp = test.state().actors[target.id].runtime.hp.current;
        const baseSpeed = breakdownValue(
          'speed', target.character, target.runtime, target.passives ?? [],
        ).value;
        const cast = test.cast({
          casterId: caster.id,
          spell: current.spell,
          targetIds: [target.id],
          factsByTarget: { [target.id]: facts('enemy', current.distanceFt) },
        });
        expect(attackRoll(cast.events).roll.outcome).toBe(lane);
        if (lane === 'hit') {
          expect(damages(cast.events)).toEqual([expect.objectContaining({
            amount: current.amount,
            damageType: current.damageType,
            roll: expect.objectContaining({
              dice: [{ sides: current.die, result: current.amount }],
            }),
          })]);
          expect(test.state().actors[target.id].runtime.hp.current).toBe(targetHp - current.amount);
        } else {
          expect(damages(cast.events)).toEqual([]);
          expect(test.state().actors[target.id].runtime.hp.current).toBe(targetHp);
        }

        if (current.spell.cardNumber === 'SPELL-0218') {
          if (lane === 'hit') {
            const slowed = test.state().actors[target.id];
            expect(slowed.runtime.activeEffects).toContainEqual(expect.objectContaining({
              ownerId: target.id,
              sourceId: caster.id,
              sourceTurnExpiry: expect.objectContaining({ boundary: 'start' }),
            }));
            expect(breakdownValue(
              'speed', slowed.character, slowed.runtime, slowed.passives ?? [],
            ).value).toBe(baseSpeed - 10);
          } else {
            expect(test.state().actors[target.id].runtime.activeEffects).toEqual([]);
          }
        }
        test.checkpoint();
        if (current.spell.cardNumber === 'SPELL-0218' && lane === 'hit') {
          test.cycleToCaster(caster.id);
          const restored = test.state().actors[target.id];
          expect(restored.runtime.activeEffects).toEqual([]);
          expect(breakdownValue(
            'speed', restored.character, restored.runtime, restored.passives ?? [],
          ).value).toBe(baseSpeed);
        }
        test.finish(current.spell);
      }
    }
  });

  it('runs Chill Touch hit/miss envelopes through healing denial and exact source-turn expiry', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-SPELL-CHILL-TOUCH-01' },
  }, () => {
    const chill = spellFixture(wizard, 'chill_touch', CLASS.wizard);
    const cure = spellFixture(cleric, 'SPELL-0214', CLASS.cleric);

    for (const lane of ['hit', 'miss'] as const) {
      const caster = isolatedActor(wizard, 'caster', [chill.action.id]);
      const healer = isolatedActor(cleric, 'healer', [cure.action.id], {
        ac: 10,
        hp: { current: 30, max: 40, temp: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: `compiled-chill-touch-${lane}`,
        actors: [caster, healer],
        dice: [
          ...BASE_ENVELOPE_TAPE,
          { label: `Chill Touch ${lane}`, sides: 20, value: lane === 'hit' ? 10 : 1 },
          ...(lane === 'hit' ? [
            { label: 'Chill Touch damage', sides: 10, value: 6 },
            { label: 'Cure after expiry die 1', sides: 8, value: 2 },
            { label: 'Cure after expiry die 2', sides: 8, value: 3 },
          ] : []),
        ],
      });
      test.preamble(caster.id, healer.id);
      const cast = test.cast({
        casterId: caster.id,
        spell: chill,
        targetIds: [healer.id],
        factsByTarget: { [healer.id]: facts('enemy', 5) },
      });
      expect(attackRoll(cast.events).roll.outcome).toBe(lane);
      if (lane === 'miss') {
        expect(damages(cast.events)).toEqual([]);
        expect(test.state().actors[healer.id].runtime.activeEffects).toEqual([]);
        test.checkpoint();
        test.finish(chill);
        continue;
      }

      expect(damages(cast.events)).toEqual([
        expect.objectContaining({ amount: 6, damageType: 'necrotic' }),
      ]);
      expect(test.state().actors[healer.id].runtime.activeEffects).toContainEqual(
        expect.objectContaining({
          ownerId: healer.id,
          sourceId: caster.id,
          sourceTurnExpiry: expect.objectContaining({ boundary: 'end' }),
          mechanics: expect.objectContaining({ applies_to: { roll: 'healing' }, op: 'deny' }),
        }),
      );
      test.checkpoint();
      test.dispatch(caster.id, { type: 'EndTurn' });
      test.dispatch(healer.id, { type: 'StartTurn' });
      const slotsBeforeDenied = test.state().actors[healer.id].runtime.resources.spell_slot_1;
      const denied = test.cast({
        casterId: healer.id,
        spell: cure,
        targetIds: [healer.id],
        factsByTarget: { [healer.id]: selfFacts() },
      });
      expect(healings(denied.events)).toEqual([]);
      expect(recorded(denied.events)).toContainEqual({
        type: 'narrative', text: 'Лечение заблокировано действующим эффектом.',
      });
      expect(test.state().actors[healer.id].runtime.resources.spell_slot_1)
        .toBe(slotsBeforeDenied - 1);

      test.dispatch(healer.id, { type: 'EndTurn' });
      test.dispatch(caster.id, { type: 'StartTurn' });
      expect(test.state().actors[healer.id].runtime.activeEffects[0].sourceTurnExpiry)
        .toMatchObject({ boundary: 'end', armed: true });
      test.dispatch(caster.id, { type: 'EndTurn' });
      expect(test.state().actors[healer.id].runtime.activeEffects).toEqual([]);
      test.dispatch(healer.id, { type: 'StartTurn' });
      const allowed = test.cast({
        casterId: healer.id,
        spell: cure,
        targetIds: [healer.id],
        factsByTarget: { [healer.id]: selfFacts() },
      });
      expect(healings(allowed.events)).toEqual([expect.objectContaining({
        amount: 2 + 3 + (healer.character.spellcastingMod ?? 0),
      })]);
      test.checkpoint();
      test.finish(chill);
    }
  });

  it('runs Sacred Flame fail/success and compiled Burning Hands/Thunderwave multi-target save envelopes', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-SPELL-SAVES-AREAS-01' },
  }, () => {
    const sacred = spellFixture(cleric, 'SPELL-0286', CLASS.cleric);
    const observedDcs: number[] = [];
    for (const lane of ['fail', 'success'] as const) {
      const caster = isolatedActor(cleric, 'caster', [sacred.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        hp: { current: 40, max: 40, temp: 0 },
        abilityMods: { dex: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: `compiled-sacred-flame-${lane}`,
        actors: [caster, target],
        dice: [
          ...BASE_ENVELOPE_TAPE,
          ...(lane === 'fail'
            ? [{ label: 'Sacred Flame damage', sides: 8, value: 6 }]
            : []),
        ],
      });
      test.preamble(caster.id, target.id);
      const hpBefore = test.state().actors[target.id].runtime.hp.current;
      test.cast({
        casterId: caster.id,
        spell: sacred,
        targetIds: [target.id],
        factsByTarget: {
          [target.id]: facts('enemy', 60, {
            cover: lane === 'fail' ? 'half' : 'three_quarters',
          }),
        },
      });
      const pending = test.state().pendingResolution;
      if (!pending || pending.type !== 'target_save') throw new Error('Sacred Flame save did not open');
      observedDcs.push(pending.request.dc);
      test.checkpoint();
      const resolved = test.resolveTargetSave(lane === 'fail' ? 1 : 20);
      const save = required(rolls(resolved.events).find((event) => event.roll.kind === 'save'), 'Sacred Flame save');
      expect(save.roll.outcome).toBe(lane);
      expect(save.roll.modifiers).toEqual([{ value: 0, source: 'ЛВК' }]);
      if (lane === 'fail') {
        expect(damages(resolved.events)).toEqual([
          expect.objectContaining({ amount: 6, damageType: 'radiant' }),
        ]);
        expect(test.state().actors[target.id].runtime.hp.current).toBe(hpBefore - 6);
      } else {
        expect(damages(resolved.events)).toEqual([]);
        expect(test.state().actors[target.id].runtime.hp.current).toBe(hpBefore);
      }
      test.finish(sacred);
    }
    expect(observedDcs[0]).toBe(observedDcs[1]);

    const areaCases = [
      {
        spell: spellFixture(wizard, 'SPELL-0242', CLASS.wizard),
        type: 'fire',
        dice: [
          { label: 'Burning Hands die 1', sides: 6, value: 1 },
          { label: 'Burning Hands die 2', sides: 6, value: 2 },
          { label: 'Burning Hands die 3', sides: 6, value: 4 },
        ],
        total: 7,
        saveAbility: 'dex',
        objects: [
          { id: 'inside', name: 'Curtain', kind: 'environment', size: 'large', flammable: true },
          { id: 'outside', name: 'Banner', kind: 'environment', size: 'large', flammable: true },
        ] satisfies WorldObjectState[],
        worldInput: {
          type: 'area_objects',
          factsByObject: {
            inside: {
              factsSource: 'scenario', boardRevision: 3, distanceFt: 10,
              lineOfSight: true, inArea: true,
            },
            outside: {
              factsSource: 'scenario', boardRevision: 3, distanceFt: 20,
              lineOfSight: true, inArea: false,
            },
          },
        },
      },
      {
        spell: spellFixture(wizard, 'SPELL-0171', CLASS.wizard),
        type: 'thunder',
        dice: [
          { label: 'Thunderwave die 1', sides: 8, value: 4 },
          { label: 'Thunderwave die 2', sides: 8, value: 5 },
        ],
        total: 9,
        saveAbility: 'con',
        objects: [
          { id: 'inside', name: 'Crate', kind: 'environment', size: 'medium', secured: false },
          { id: 'outside', name: 'Pillar', kind: 'environment', size: 'medium', secured: true },
        ] satisfies WorldObjectState[],
        worldInput: {
          type: 'area_objects',
          factsByObject: {
            inside: {
              factsSource: 'scenario', boardRevision: 4, distanceFt: 10,
              lineOfSight: true, entirelyInArea: true,
            },
            outside: {
              factsSource: 'scenario', boardRevision: 4, distanceFt: 10,
              lineOfSight: true, entirelyInArea: false,
            },
          },
        },
      },
    ] as const;

    for (const current of areaCases) {
      const caster = isolatedActor(wizard, 'caster', [current.spell.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        hp: { current: 60, max: 60, temp: 0 },
        abilityMods: { dex: 0, con: 0 },
      });
      const extra = monsterFrom(fighter, 'area-monster');
      const test = new CompiledSpellEnvelope({
        id: `compiled-area-${current.spell.cardNumber}`,
        actors: [caster, target, extra],
        objects: copy(current.objects),
        dice: [...BASE_ENVELOPE_TAPE, ...current.dice],
      });
      test.preamble(caster.id, target.id);
      const hpBefore = {
        target: test.state().actors[target.id].runtime.hp.current,
        extra: test.state().actors[extra.id].runtime.hp.current,
      };
      test.cast({
        casterId: caster.id,
        spell: current.spell,
        targetIds: [target.id, extra.id],
        factsByTarget: {
          [target.id]: facts('enemy', 5),
          [extra.id]: facts('enemy', 10),
        },
        worldInput: copy(current.worldInput),
      });
      expect(test.state().pendingResolution).toMatchObject({
        type: 'target_save',
        targetActorId: target.id,
        request: { ability: current.saveAbility },
        remainingTargets: [{ targetActorId: extra.id }],
      });
      test.checkpoint();
      const failed = test.resolveTargetSave(1);
      expect(damages(failed.events)).toEqual([
        expect.objectContaining({ amount: current.total, damageType: current.type }),
      ]);
      expect(test.state().pendingResolution).toMatchObject({
        type: 'target_save', targetActorId: extra.id, resolvedTargetIds: [target.id],
      });
      test.checkpoint();
      const succeeded = test.resolveTargetSave(20);
      expect(damages(succeeded.events)).toEqual([
        expect.objectContaining({ amount: Math.floor(current.total / 2), damageType: current.type }),
      ]);
      expect(test.state().actors[target.id].runtime.hp.current).toBe(hpBefore.target - current.total);
      expect(test.state().actors[extra.id].runtime.hp.current)
        .toBe(hpBefore.extra - Math.floor(current.total / 2));
      if (current.spell.cardNumber === 'SPELL-0242') {
        expect(test.state().objects.inside.ignited).toBe(true);
        expect(test.state().objects.outside.ignited).toBeUndefined();
      } else {
        expect(test.state().objects.inside.displacementFt).toBe(10);
        expect(test.state().objects.outside.displacementFt).toBeUndefined();
        const pushes = recorded(test.events).filter((event) => (
          event.type === 'movement' && event.mode === 'push'
        ));
        expect(pushes).toEqual([expect.objectContaining({ distanceFt: 10 })]);
      }
      test.finish(current.spell);
    }
  });

  it('runs Guidance, Cure Wounds, False Life, and Mage Armor envelopes through persistent and restorative state', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-SPELL-SUPPORT-RECOVERY-01' },
  }, () => {
    const guidance = spellFixture(cleric, 'SPELL-0230', CLASS.cleric);
    {
      const caster = isolatedActor(cleric, 'caster', [guidance.action.id]);
      const target = isolatedActor(fighter, 'target', []);
      const test = new CompiledSpellEnvelope({
        id: 'compiled-guidance',
        actors: [caster, target],
        dice: [
          ...BASE_ENVELOPE_TAPE,
          { label: 'Guidance nonmatching check', sides: 20, value: 10 },
          { label: 'Guidance matching check', sides: 20, value: 10 },
          { label: 'Guidance d4', sides: 4, value: 3 },
          { label: 'Guidance repeated matching check', sides: 20, value: 9 },
          { label: 'Guidance repeated d4', sides: 4, value: 2 },
        ],
      });
      test.preamble(caster.id, target.id);
      test.cast({
        casterId: caster.id,
        spell: guidance,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('ally', 5, { willing: true }) },
        choices: { guidance_skill: 'investigation' },
      });
      expect(test.state().concentrations[caster.id]?.actionId).toBe(guidance.action.id);
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      test.checkpoint();
      test.dispatch(caster.id, { type: 'EndTurn' });
      test.dispatch(target.id, { type: 'StartTurn' });
      const nonmatching = test.dispatch(target.id, {
        type: 'AbilityCheck', ability: 'wis', skill: 'perception', dc: 5,
      });
      expect(rolls(nonmatching.events)[0].roll.dice).toEqual([{ sides: 20, result: 10 }]);
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      expect(test.state().concentrations[caster.id]).toBeDefined();
      const matching = test.dispatch(target.id, {
        type: 'AbilityCheck', ability: 'int', skill: 'investigation', dc: 5,
      });
      expect(rolls(matching.events)[0].roll.dice).toEqual([
        { sides: 20, result: 10 },
        expect.objectContaining({ sides: 4, result: 3 }),
      ]);
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      expect(test.state().concentrations[caster.id]).toBeDefined();
      const repeated = test.dispatch(target.id, {
        type: 'AbilityCheck', ability: 'int', skill: 'investigation', dc: 5,
      });
      expect(rolls(repeated.events)[0].roll.dice).toEqual([
        { sides: 20, result: 9 },
        expect.objectContaining({ sides: 4, result: 2 }),
      ]);
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      expect(test.state().concentrations[caster.id]).toBeDefined();
      test.checkpoint();
      test.finish(guidance);
    }

    const cure = spellFixture(cleric, 'SPELL-0214', CLASS.cleric);
    {
      const caster = isolatedActor(cleric, 'caster', [cure.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        hp: { current: 5, max: 30, temp: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: 'compiled-cure-wounds',
        actors: [caster, target],
        dice: [
          ...BASE_ENVELOPE_TAPE,
          { label: 'Cure Wounds die 1', sides: 8, value: 3 },
          { label: 'Cure Wounds die 2', sides: 8, value: 4 },
        ],
      });
      test.preamble(caster.id, target.id);
      const slots = test.state().actors[caster.id].runtime.resources.spell_slot_1;
      const cast = test.cast({
        casterId: caster.id,
        spell: cure,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('ally', 5, { willing: true }) },
      });
      const amount = 3 + 4 + (caster.character.spellcastingMod ?? 0);
      expect(healings(cast.events)).toEqual([expect.objectContaining({ amount })]);
      expect(test.state().actors[target.id].runtime.hp.current).toBe(5 + amount);
      expect(test.state().actors[caster.id].runtime.resources.spell_slot_1).toBe(slots - 1);
      test.checkpoint();
      test.finish(cure);
    }

    const falseLife = spellFixture(wizard, 'false_life', CLASS.wizard);
    {
      const protocolFireBolt = spellFixture(wizard, 'fire_bolt', CLASS.wizard);
      const caster = isolatedActor(wizard, 'caster', [falseLife.action.id, protocolFireBolt.action.id], {
        hp: { current: 7, max: 15, temp: 0 },
      });
      const target = isolatedActor(fighter, 'target', []);
      const test = new CompiledSpellEnvelope({
        id: 'compiled-false-life',
        actors: [caster, target],
        dice: [
          { label: 'Protocol Fire Bolt attack', sides: 20, value: 19 },
          { label: 'Protocol Fire Bolt damage', sides: 10, value: 1 },
          ...BASE_ENVELOPE_TAPE,
          { label: 'False Life die 1', sides: 4, value: 2 },
          { label: 'False Life die 2', sides: 4, value: 3 },
        ],
      });
      test.cast({
        casterId: caster.id,
        spell: protocolFireBolt,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('enemy', 5) },
      });
      test.preamble(caster.id, target.id);
      const cast = test.cast({
        casterId: caster.id,
        spell: falseLife,
        targetIds: [caster.id],
        factsByTarget: { [caster.id]: selfFacts() },
      });
      expect(recorded(cast.events)).toContainEqual({ type: 'temp_hp', amount: 9 });
      expect(test.state().actors[caster.id].runtime.hp).toEqual({
        current: 7, max: 15, temp: 9,
      });
      test.checkpoint();
      test.finish(falseLife);
    }

    const mageArmor = spellFixture(wizard, 'SPELL-0190', CLASS.wizard);
    {
      const caster = isolatedActor(wizard, 'caster', [mageArmor.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        hp: { current: 20, max: 20, temp: 0 },
        abilityMods: { dex: 3 },
      });
      const test = new CompiledSpellEnvelope({
        id: 'compiled-mage-armor',
        actors: [caster, target],
        dice: [...BASE_ENVELOPE_TAPE],
      });
      test.preamble(caster.id, target.id);
      const castMageArmor = () => test.cast({
        casterId: caster.id,
        spell: mageArmor,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('ally', 5, { willing: true }) },
      });
      castMageArmor();
      const armored = test.state().actors[target.id];
      expect(armored.runtime.activeEffects).toEqual([expect.objectContaining({
        ownerId: target.id,
        sourceId: caster.id,
        roundsLeft: 4_800,
        mechanics: expect.objectContaining({
          stack_id: 'EFFECT-0256',
          effects: [expect.objectContaining({
            result: [expect.objectContaining({
              kind: 'set_value', target: 'ac_base', formula: '13 + dex',
            })],
          })],
        }),
      })]);
      expect(armorClassValue(
        armored.character, armored.runtime, armored.passives ?? [],
      ).value).toBe(16);
      test.checkpoint();
      test.cycleToCaster(caster.id);
      castMageArmor();
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      expect(test.state().actors[target.id].runtime.activeEffects[0].roundsLeft).toBe(4_800);
      test.checkpoint();
      test.finish(mageArmor);
    }
  });

  it('runs Guiding Bolt hit/miss envelopes through next-attack consumption and source-turn expiry', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-SPELL-GUIDING-BOLT-01' },
  }, () => {
    const guiding = spellFixture(cleric, 'SPELL-0229', CLASS.cleric);

    {
      const caster = isolatedActor(cleric, 'caster', [guiding.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        ac: 10,
        hp: { current: 80, max: 80, temp: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: 'compiled-guiding-bolt-miss',
        actors: [caster, target],
        dice: [...BASE_ENVELOPE_TAPE, {
          label: 'Guiding Bolt miss', sides: 20, value: 1,
        }],
      });
      test.preamble(caster.id, target.id);
      const cast = test.cast({
        casterId: caster.id,
        spell: guiding,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('enemy', 120) },
      });
      expect(attackRoll(cast.events).roll.outcome).toBe('miss');
      expect(damages(cast.events)).toEqual([]);
      expect(test.state().actors[target.id].runtime.activeEffects).toEqual([]);
      test.checkpoint();
      test.finish(guiding);
    }

    const hitTape = [
      { label: 'Guiding Bolt attack', sides: 20, value: 10 },
      { label: 'Guiding Bolt damage 1', sides: 6, value: 1 },
      { label: 'Guiding Bolt damage 2', sides: 6, value: 2 },
      { label: 'Guiding Bolt damage 3', sides: 6, value: 3 },
      { label: 'Guiding Bolt damage 4', sides: 6, value: 4 },
    ] satisfies DieTapeEntry[];

    {
      const caster = isolatedActor(cleric, 'caster', [guiding.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        ac: 10,
        hp: { current: 80, max: 80, temp: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: 'compiled-guiding-bolt-consumed',
        actors: [caster, target],
        dice: [
          ...BASE_ENVELOPE_TAPE,
          ...hitTape,
          { label: 'Guiding Bolt advantage high', sides: 20, value: 12 },
          { label: 'Guiding Bolt advantage low', sides: 20, value: 2 },
        ],
      });
      test.preamble(caster.id, target.id);
      const cast = test.cast({
        casterId: caster.id,
        spell: guiding,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('enemy', 120) },
      });
      expect(damages(cast.events)).toEqual([
        expect.objectContaining({ amount: 10, damageType: 'radiant' }),
      ]);
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      test.checkpoint();
      test.cycleToCaster(caster.id);
      const opened = test.dispatch(caster.id, { type: 'BeginAttackAction' });
      const attackActionId = required(opened.events.flatMap((event) => (
        event.payload.type === 'AttackActionStarted' ? [event.payload.attackAction.id] : []
      ))[0], 'Guiding Bolt follow-up Attack action');
      const followUp = test.dispatch(caster.id, {
        type: 'PerformUnarmedStrike',
        attackActionId,
        option: 'damage',
        targetActorId: target.id,
        facts: facts('enemy', 5),
      });
      expect(attackRoll(followUp.events).roll).toMatchObject({
        advantage: 'advantage',
        outcome: 'hit',
        dice: [
          { sides: 20, result: 12 },
          { sides: 20, result: 2, discarded: true },
        ],
      });
      expect(test.state().actors[target.id].runtime.activeEffects).toEqual([]);
      test.checkpoint();
      test.finish(guiding);
    }

    {
      const caster = isolatedActor(cleric, 'caster', [guiding.action.id]);
      const target = isolatedActor(fighter, 'target', [], {
        ac: 10,
        hp: { current: 80, max: 80, temp: 0 },
      });
      const test = new CompiledSpellEnvelope({
        id: 'compiled-guiding-bolt-expired',
        actors: [caster, target],
        dice: [...BASE_ENVELOPE_TAPE, ...hitTape],
      });
      test.preamble(caster.id, target.id);
      test.cast({
        casterId: caster.id,
        spell: guiding,
        targetIds: [target.id],
        factsByTarget: { [target.id]: facts('enemy', 120) },
      });
      expect(test.state().actors[target.id].runtime.activeEffects).toHaveLength(1);
      test.checkpoint();
      test.cycleToCaster(caster.id);
      expect(test.state().actors[target.id].runtime.activeEffects[0].sourceTurnExpiry)
        .toMatchObject({ boundary: 'end', armed: true });
      test.dispatch(caster.id, { type: 'EndTurn' });
      expect(test.state().actors[target.id].runtime.activeEffects).toEqual([]);
      test.checkpoint();
      test.finish(guiding);
    }
  });
});
