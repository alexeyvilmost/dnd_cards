import { describe, expect, it } from 'vitest';
import { CARD_LONGSWORD } from '../mvp/fixtures';
import type { Card } from '../types';
import type { EngineEvent } from '../mvp/contracts';
import type {
  ActorState,
  CommandResult,
  GrappleState,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { migrateWorldState } from './worldMigration';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'attack-v4-test',
  contentHash: 'sha256:attack-v4-test',
  errataVersion: '2024-test',
};

const FACTS: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

const SHADOW: RuleActionDefinition = {
  id: 'core.attack.weapon',
  name: 'Forged catalog shadow',
  kind: 'nonSpell',
  sourceEntityIds: ['db:forged-system-action'],
  mechanics: {
    activation: { mode: 'active', cost: [] },
    effects: [{ resolution: 'auto', result: [{ kind: 'damage', amount: '999' }] }],
  },
};

const catalog: RulesCatalog = {
  getAction: (id) => id === SHADOW.id ? SHADOW : undefined,
};

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function accepted(result: CommandResult) {
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function environment(rng: () => number = () => 0.5) {
  return { rng, clock: () => 42_000, nextId: () => 'ignored' };
}

function actor(input: {
  id: string;
  attacks?: number;
  size?: number;
  weapon?: boolean;
  weaponCard?: Card;
  abilityScores?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  weaponProficiencies?: string[];
  graspingParts?: string[];
}): ActorState {
  const weapon = input.weaponCard
    ?? (input.weapon ? { ...CARD_LONGSWORD, weapon_type: 'longsword' } : undefined);
  return {
    id: input.id,
    name: input.id,
    kind: 'playerCharacter',
    controllerId: `${input.id}:controller`,
    ac: 12,
    capabilities: { actionIds: [] },
    character: {
      abilityScores: input.abilityScores ?? { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      ...(input.weaponProficiencies === undefined
        ? {} : { weaponProficiencies: input.weaponProficiencies }),
      ...(weapon ? { knownCards: [weapon], equippedCards: [weapon] } : {}),
    },
    runtime: {
      hp: { current: 30, max: 30, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: weapon ? { main_hand: weapon.id, off_hand: null } : {},
      inventory: weapon ? [{ cardId: weapon.id, qty: 1 }] : [],
      activeEffects: [],
    },
    attackProfile: {
      attacksPerAction: input.attacks ?? 1,
      size: input.size ?? 2,
      reachFt: 5,
      graspingParts: input.graspingParts ?? ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function started(input?: {
  attacks?: number;
  targetSize?: number;
  weapon?: boolean;
  weaponCard?: Card;
  abilityScores?: Partial<Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>>;
  rng?: () => number;
  weaponProficiencies?: string[];
  graspingParts?: string[];
}) {
  const attacker = actor({
    id: 'attacker',
    attacks: input?.attacks,
    weapon: input?.weapon,
    weaponCard: input?.weaponCard,
    abilityScores: input?.abilityScores,
    weaponProficiencies: input?.weaponProficiencies,
    graspingParts: input?.graspingParts,
  });
  const target = actor({ id: 'target', size: input?.targetSize });
  const initial = createWorld({ id: 'attack-runtime', ruleset: RULESET, actors: [attacker, target] });
  const session = new InMemoryRulesSession(initial, catalog, environment(input?.rng));
  accepted(session.dispatch({
    schemaVersion: 1,
    type: 'StartEncounter',
    commandId: 'encounter',
    expectedRevision: 0,
    rulesetContentHash: RULESET.contentHash,
    actorId: attacker.id,
    initiative: [attacker.id, target.id],
  }));
  accepted(session.dispatch({
    schemaVersion: 1,
    type: 'StartTurn',
    commandId: 'attacker-turn',
    expectedRevision: 1,
    rulesetContentHash: RULESET.contentHash,
    actorId: attacker.id,
  }));
  return { attacker, target, initial, session };
}

function begin(session: InMemoryRulesSession, commandId = 'begin') {
  const result = accepted(session.dispatch({
    schemaVersion: 1,
    type: 'BeginAttackAction',
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'attacker',
  }));
  const attackAction = Object.values(session.getState().attackActions).find((entry) => (
    entry.actorId === 'attacker' && entry.status === 'open'
  ));
  if (!attackAction) throw new Error('Expected open Attack action');
  return { result, attackAction };
}

function engineEvents(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

describe('schema-v4 canonical Attack runtime', () => {
  it('uses the ruleset-owned weapon action, actor proficiency, durable budget, and byte-stable replay', {
    meta: { basicPrimitive: 'attack', evidenceKind: 'two_pc' },
  }, () => {
    const test = started({ weapon: true, weaponProficiencies: [] });
    const { attackAction } = begin(test.session);
    const executed = accepted(test.session.dispatch({
      schemaVersion: 1,
      type: 'PerformWeaponAttack',
      commandId: 'weapon-entry',
      expectedRevision: test.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.attacker.id,
      attackActionId: attackAction.id,
      weaponCardId: CARD_LONGSWORD.id,
      targetActorId: test.target.id,
      facts: FACTS,
    }));

    const stored = test.session.getState().attackActions[attackAction.id];
    expect(stored).toMatchObject({
      status: 'completed',
      sequence: {
        totalAttacks: 1,
        attacksRemaining: 0,
        entries: [{ kind: 'weapon_attack', weaponCardId: CARD_LONGSWORD.id }],
      },
    });
    const attackRoll = engineEvents(executed.events).find((event) => (
      event.type === 'roll' && event.label.includes('Атака')
    ));
    expect(attackRoll).toMatchObject({
      type: 'roll',
      roll: { total: 14, modifiers: [{ value: 3, source: 'СИЛ' }] },
    });
    expect(JSON.stringify(attackRoll)).not.toContain('db:forged-system-action');
    expect(test.session.getState().actors.target.runtime.hp.current).toBe(22);
    const declaration = executed.events.find((event) => (
      event.payload.type === 'ActionDeclared' && event.payload.actionId === 'core.attack.weapon'
    ));
    expect(declaration?.payload).toMatchObject({
      type: 'ActionDeclared',
      sourceEntityIds: expect.arrayContaining([
        'system:dnd5e-2024:weapon-attack',
        `card:${CARD_LONGSWORD.id}`,
      ]),
      facts: { proficient: false, weaponType: 'longsword' },
    });

    const checkpoint = migrateWorldState(copy(test.session.getState()));
    expect(checkpoint).toEqual(test.session.getState());
    expect(foldEvents(copy(test.initial), copy(test.session.getEvents())))
      .toEqual(test.session.getState());
  });

  it('applies the data-owned Heavy threshold in canonical attacks and fails closed without score facts', () => {
    const heavy = structuredClone(CARD_LONGSWORD);
    heavy.id = 'card:heavy-test';
    heavy.card_number = 'CARD-heavy-test';
    heavy.slot = 'one_hand';
    heavy.properties = [];
    const mechanics = structuredClone(heavy.mechanics) as Record<string, unknown>;
    const profile = mechanics.weapon_profile as Record<string, unknown>;
    profile.weapon_type = 'greatsword';
    profile.damage_lines = [{ dice: '2d6', type: 'slashing' }];
    profile.properties = ['two_handed', 'heavy'];
    profile.heavy = {
      minimum_ability_score: 13,
      ability_by_mode: { melee: 'str', ranged: 'dex' },
      consequence: 'attack_disadvantage',
    };
    heavy.mechanics = mechanics;

    const attack = (str: number | undefined) => {
      const tape = [0.95, 0, 0.5, 0.5];
      const test = started({
        weaponCard: heavy,
        abilityScores: str === undefined ? { dex: 20 } : { str, dex: 20 },
        rng: () => tape.shift() ?? 0.5,
      });
      const { attackAction } = begin(test.session, `begin-heavy-${str ?? 'missing'}`);
      return test.session.dispatch({
        schemaVersion: 1,
        type: 'PerformWeaponAttack',
        commandId: `heavy-${str ?? 'missing'}`,
        expectedRevision: test.session.getState().revision,
        rulesetContentHash: RULESET.contentHash,
        actorId: test.attacker.id,
        attackActionId: attackAction.id,
        weaponCardId: heavy.id,
        targetActorId: test.target.id,
        facts: FACTS,
      });
    };

    const low = accepted(attack(12));
    const lowRoll = engineEvents(low.events).find((event) => event.type === 'roll');
    expect(lowRoll).toMatchObject({
      type: 'roll',
      roll: { advantage: 'disadvantage' },
    });
    expect(lowRoll?.type === 'roll' ? lowRoll.roll.dice.map((die) => die.result) : [])
      .toEqual([1, 20]);
    const threshold = accepted(attack(13));
    expect(engineEvents(threshold.events).find((event) => event.type === 'roll'))
      .toMatchObject({ type: 'roll', roll: { advantage: 'none', dice: [{ result: 20 }] } });
    expect(attack(undefined)).toMatchObject({
      status: 'rejected',
      code: 'InvalidEquipmentState',
      message: expect.stringMatching(/authoritative str ability score/),
    });
  });

  it('runs two-PC grapple → chosen save → shove choice → escape across JSON reloads', () => {
    const test = started({ attacks: 2 });
    const { attackAction } = begin(test.session, 'begin-control');
    accepted(test.session.dispatch({
      schemaVersion: 1,
      type: 'PerformUnarmedStrike',
      commandId: 'grapple-entry',
      expectedRevision: test.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.attacker.id,
      attackActionId: attackAction.id,
      option: 'grapple',
      targetActorId: test.target.id,
      facts: FACTS,
    }));
    const grappleSave = test.session.getState().pendingResolution;
    if (!grappleSave || grappleSave.type !== 'unarmed_save') throw new Error('Expected grapple save');
    const checkpoint = migrateWorldState(copy(test.session.getState()));
    const restored = new InMemoryRulesSession(copy(checkpoint), catalog, environment());
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'grapple-save',
      expectedRevision: checkpoint.revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.target.id,
      resolutionId: grappleSave.id,
      requestId: grappleSave.request.id,
      response: {
        kind: 'roll',
        selectedAbility: 'dex',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
      },
    }));
    const grapple = Object.values(restored.getState().grapples)[0];
    expect(new Set([
      attackAction.id,
      grappleSave.id,
      grappleSave.request.id,
      grapple.id,
    ]).size).toBe(4);
    expect(grapple).toMatchObject({
      grapplerActorId: test.attacker.id,
      targetActorId: test.target.id,
      sourcePart: 'main_hand',
      escapeDc: 13,
      reachFt: 5,
    });
    expect(restored.getState().actors.target.runtime.activeEffects).toContainEqual(
      expect.objectContaining({
        id: `grapple:${grapple.id}`,
        mechanics: expect.objectContaining({ kind: 'condition', value: 'grappled' }),
      }),
    );
    expect(restored.getState().attackActions[attackAction.id].sequence.attacksRemaining).toBe(1);

    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'PerformUnarmedStrike',
      commandId: 'shove-entry',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.attacker.id,
      attackActionId: attackAction.id,
      option: 'shove',
      targetActorId: test.target.id,
      facts: FACTS,
    }));
    const shoveSave = restored.getState().pendingResolution;
    if (!shoveSave || shoveSave.type !== 'unarmed_save') throw new Error('Expected shove save');
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'shove-save',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.target.id,
      resolutionId: shoveSave.id,
      requestId: shoveSave.request.id,
      response: { kind: 'voluntary_fail' },
    }));
    const shoveChoice = restored.getState().pendingResolution;
    if (!shoveChoice || shoveChoice.type !== 'shove_outcome') throw new Error('Expected shove outcome');
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'shove-prone',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.attacker.id,
      resolutionId: shoveChoice.id,
      requestId: shoveChoice.request.id,
      response: { kind: 'shove_outcome', outcome: 'prone' },
    }));
    expect(restored.getState().attackActions[attackAction.id]).toMatchObject({
      status: 'completed', sequence: { attacksRemaining: 0 },
    });
    expect(restored.getState().actors.target.runtime.activeEffects.map((effect) => (
      (effect.mechanics as Record<string, unknown>).value
    ))).toEqual(expect.arrayContaining(['grappled', 'prone']));

    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'attacker-end',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.attacker.id,
    }));
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'target-turn',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.target.id,
    }));
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'EscapeGrapple',
      commandId: 'escape',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.target.id,
      grappleId: grapple.id,
      skill: 'acrobatics',
    }));
    const escape = restored.getState().pendingResolution;
    if (!escape || escape.type !== 'escape_grapple') throw new Error('Expected escape check');
    accepted(restored.dispatch({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'escape-roll',
      expectedRevision: restored.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: test.target.id,
      resolutionId: escape.id,
      requestId: escape.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 20 }] } },
    }));
    expect(restored.getState().grapples).toEqual({});
    const finalConditions = restored.getState().actors.target.runtime.activeEffects.map((effect) => (
      (effect.mechanics as Record<string, unknown>).value
    ));
    expect(finalConditions).not.toContain('grappled');
    expect(finalConditions).toContain('prone');
    expect(foldEvents(copy(checkpoint), copy(restored.getEvents()))).toEqual(restored.getState());
  });

  it('fails closed on size/free-part/equipment facts and ends grapples only from explicit lifecycle facts', () => {
    const tooSmall = started({ attacks: 2, targetSize: 4 });
    const { attackAction } = begin(tooSmall.session, 'begin-size-gate');
    const baseline = copy(tooSmall.session.getState());
    expect(tooSmall.session.dispatch({
      schemaVersion: 1,
      type: 'PerformUnarmedStrike',
      commandId: 'too-large',
      expectedRevision: baseline.revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      attackActionId: attackAction.id,
      option: 'grapple',
      targetActorId: 'target',
      facts: FACTS,
    })).toMatchObject({ status: 'rejected', code: 'TargetTooLarge' });
    expect(tooSmall.session.getState()).toEqual(baseline);

    const noWeapon = started();
    const noWeaponAction = begin(noWeapon.session, 'begin-no-weapon').attackAction;
    expect(noWeapon.session.dispatch({
      schemaVersion: 1,
      type: 'PerformWeaponAttack',
      commandId: 'missing-card',
      expectedRevision: noWeapon.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      attackActionId: noWeaponAction.id,
      weaponCardId: 'missing',
      targetActorId: 'target',
      facts: FACTS,
    })).toMatchObject({ status: 'rejected', code: 'CardNotFound' });

    const occupiedHand = started({ weapon: true, graspingParts: ['main_hand'] });
    const occupiedAction = begin(occupiedHand.session, 'begin-occupied').attackAction;
    expect(occupiedHand.session.dispatch({
      schemaVersion: 1,
      type: 'PerformUnarmedStrike',
      commandId: 'occupied-grapple',
      expectedRevision: occupiedHand.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      attackActionId: occupiedAction.id,
      option: 'grapple',
      targetActorId: 'target',
      facts: FACTS,
    })).toMatchObject({ status: 'rejected', code: 'NoFreeGraspingPart' });

    const source = actor({ id: 'source' });
    const target = actor({ id: 'victim' });
    const base = createWorld({ id: 'grapple-lifecycle', ruleset: RULESET, actors: [source, target] });
    const grapple: GrappleState = {
      id: 'g1',
      grapplerActorId: source.id,
      targetActorId: target.id,
      sourcePart: 'main_hand',
      escapeDc: 13,
      reachFt: 5,
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
      startedAtRevision: 0,
    };
    const seeded = foldEvents(base, [{
      ordinal: 0,
      sourceActorId: source.id,
      obligationIds: ['system:grapple-lifecycle'],
      payload: { type: 'GrappleApplied', grapple },
    }]);
    const lifecycle = new InMemoryRulesSession(seeded, catalog, environment());
    const insideReach = lifecycle.dispatch({
      schemaVersion: 1,
      type: 'BreakGrappleRange',
      commandId: 'still-near',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: target.id,
      grappleId: grapple.id,
      facts: { ...FACTS, distanceFt: 5 },
    });
    expect(insideReach).toMatchObject({ status: 'rejected', code: 'InvalidFacts' });
    accepted(lifecycle.dispatch({
      schemaVersion: 1,
      type: 'BreakGrappleRange',
      commandId: 'range-broken',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: target.id,
      grappleId: grapple.id,
      facts: { ...FACTS, distanceFt: 10 },
    }));
    expect(lifecycle.getState().grapples).toEqual({});
    expect(lifecycle.getState().actors.victim.runtime.activeEffects).toEqual([]);
  });

  it('forfeits unused entries, releases for free, and auto-ends a relation when the grappler is incapacitated', () => {
    const attack = started({ attacks: 2 });
    const opened = begin(attack.session, 'begin-forfeit').attackAction;
    accepted(attack.session.dispatch({
      schemaVersion: 1,
      type: 'ForfeitAttackAction',
      commandId: 'forfeit',
      expectedRevision: attack.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
      attackActionId: opened.id,
    }));
    expect(attack.session.getState().attackActions[opened.id]).toMatchObject({
      status: 'forfeited', sequence: { attacksRemaining: 2 },
    });

    const turnBoundary = started({ attacks: 2 });
    const stale = begin(turnBoundary.session, 'begin-before-end').attackAction;
    accepted(turnBoundary.session.dispatch({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'end-with-open-attack',
      expectedRevision: turnBoundary.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
    }));
    expect(turnBoundary.session.getState().attackActions[stale.id].status).toBe('forfeited');
    accepted(turnBoundary.session.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'target-start-boundary',
      expectedRevision: turnBoundary.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target',
    }));
    accepted(turnBoundary.session.dispatch({
      schemaVersion: 1,
      type: 'EndTurn',
      commandId: 'target-end-boundary',
      expectedRevision: turnBoundary.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'target',
    }));
    accepted(turnBoundary.session.dispatch({
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: 'attacker-next-round',
      expectedRevision: turnBoundary.session.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'attacker',
    }));
    expect(() => begin(turnBoundary.session, 'begin-next-round')).not.toThrow();

    const source = actor({ id: 'source' });
    const target = actor({ id: 'target' });
    const initial = createWorld({ id: 'release', ruleset: RULESET, actors: [source, target] });
    const grapple: GrappleState = {
      id: 'release-g',
      grapplerActorId: source.id,
      targetActorId: target.id,
      sourcePart: 'main_hand',
      escapeDc: 13,
      reachFt: 5,
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
      startedAtRevision: 0,
    };
    const seeded = foldEvents(initial, [{
      ordinal: 0,
      sourceActorId: source.id,
      obligationIds: ['system:grapple-lifecycle'],
      payload: { type: 'GrappleApplied', grapple },
    }]);
    const released = new InMemoryRulesSession(seeded, catalog, environment());
    accepted(released.dispatch({
      schemaVersion: 1,
      type: 'ReleaseGrapple',
      commandId: 'release-free',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: source.id,
      grappleId: grapple.id,
    }));
    expect(released.getState().grapples).toEqual({});
    expect(released.getState().actors.source.runtime.resources.action).toBe(1);

    const incapacitatedSeed = foldEvents(initial, [
      {
        ordinal: 0,
        sourceActorId: source.id,
        obligationIds: ['system:grapple-lifecycle'],
        payload: { type: 'GrappleApplied', grapple },
      },
      {
        ordinal: 1,
        sourceActorId: source.id,
        obligationIds: ['fixture'],
        payload: {
          type: 'ActorRuntimePatched',
          actorId: source.id,
          reason: 'action',
          patch: {
            activeEffects: [{
              id: 'incapacitated',
              name: 'Incapacitated',
              mechanics: { kind: 'condition', value: 'incapacitated' },
              source: 'fixture',
              ownerId: source.id,
              sourceId: target.id,
            }],
          },
        },
      },
    ]);
    const automatic = new InMemoryRulesSession(incapacitatedSeed, catalog, environment());
    const cleanup = accepted(automatic.dispatch({
      schemaVersion: 1,
      type: 'SavingThrow',
      commandId: 'observe-incapacitation',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: source.id,
      ability: 'con',
      dc: 10,
    }));
    expect(cleanup.events).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'GrappleEnded', grappleId: grapple.id, reason: 'grappler_incapacitated',
      }),
    }));
    expect(automatic.getState().grapples).toEqual({});
  });
});
