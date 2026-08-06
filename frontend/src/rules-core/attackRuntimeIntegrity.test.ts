import { describe, expect, it } from 'vitest';
import {
  beginAttackSequence,
  performUnarmedStrike,
  performWeaponSequenceAttack,
  replaceSequenceAttack,
} from './attackSequence';
import { createWorld } from './domain';
import type {
  ActorState,
  AttackActionState,
  GrappleState,
  RuleEventPayload,
  WorldState,
} from './domain';
import { evolve } from './reducer';
import { SYSTEM_ACTION_IDS } from './systemActions';

const ruleset = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'integrity',
  contentHash: 'integrity',
  errataVersion: 'integrity',
};

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    capabilities: { actionIds: [] },
    character: {
      abilityMods: { str: 3, dex: 2, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: { main_hand: null, off_hand: null },
      inventory: [],
      activeEffects: [],
    },
    attackProfile: {
      attacksPerAction: 2,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['fixture:attack-profile'],
    },
  };
}

function baseWorld(): WorldState {
  return createWorld({ id: 'integrity', ruleset, actors: [actor('a'), actor('b')] });
}

function attackAction(id = 'attack', actorId = 'a'): AttackActionState {
  return {
    id,
    actorId,
    startedAtRevision: 0,
    turnKey: 'turn',
    status: 'open',
    sequence: beginAttackSequence({ id, actorId, totalAttacks: 2 }),
  };
}

function startedWorld(action = attackAction()): WorldState {
  return evolve(baseWorld(), { type: 'AttackActionStarted', attackAction: action });
}

function validGrapple(id = 'g', sourcePart = 'main_hand'): GrappleState {
  return {
    id,
    grapplerActorId: 'a',
    targetActorId: 'b',
    sourcePart,
    escapeDc: 13,
    reachFt: 5,
    sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'],
    startedAtRevision: 0,
  };
}

function expectEventRejected(
  world: WorldState,
  payload: RuleEventPayload,
  pattern: RegExp,
): void {
  expect(() => evolve(world, payload)).toThrow(pattern);
}

describe('Attack/grapple reducer integrity guards', () => {
  it('rejects every malformed AttackActionStarted shape and a second open budget', () => {
    const valid = attackAction();
    const cases: Array<[AttackActionState, RegExp]> = [
      [{ ...valid, actorId: 'missing', sequence: { ...valid.sequence, actorId: 'missing' } }, /Invalid Attack/],
      [{ ...valid, status: 'completed' }, /Invalid Attack/],
      [{ ...valid, sequence: { ...valid.sequence, actorId: 'b' } }, /Invalid Attack/],
      [{ ...valid, sequence: { ...valid.sequence, id: 'other' } }, /Invalid Attack/],
      [{ ...valid, sequence: { ...valid.sequence, entries: [{} as never] } }, /Invalid Attack/],
      [{ ...valid, sequence: { ...valid.sequence, totalAttacks: 1, attacksRemaining: 1 } }, /Invalid Attack/],
      [{ ...valid, sequence: { ...valid.sequence, attacksRemaining: -1 } }, /Invalid Attack/],
    ];
    for (const [value, pattern] of cases) {
      expectEventRejected(baseWorld(), { type: 'AttackActionStarted', attackAction: value }, pattern);
    }
    const declared = {
      ...valid,
      declaredActionId: 'action:declared-attack',
      declaredActionSourceEntityIds: [
        'action:declared-attack', 'feature:extra-attack',
      ] as [string, ...string[]],
    };
    expect(evolve(baseWorld(), {
      type: 'AttackActionStarted', attackAction: declared,
    }).attackActions.attack).toEqual(declared);
    for (const malformedDeclaration of [
      { ...valid, declaredActionId: 'action:declared-attack' },
      { ...valid, declaredActionSourceEntityIds: ['action:declared-attack'] },
      { ...valid, declaredActionId: 7, declaredActionSourceEntityIds: ['source'] },
      { ...valid, declaredActionId: '', declaredActionSourceEntityIds: ['source'] },
      { ...valid, declaredActionId: 'action', declaredActionSourceEntityIds: null },
      { ...valid, declaredActionId: 'action', declaredActionSourceEntityIds: [] },
      { ...valid, declaredActionId: 'action', declaredActionSourceEntityIds: [7] },
      { ...valid, declaredActionId: 'action', declaredActionSourceEntityIds: [''] },
      { ...valid, declaredActionId: 'action', declaredActionSourceEntityIds: ['source', 'source'] },
    ]) {
      expectEventRejected(baseWorld(), {
        type: 'AttackActionStarted',
        attackAction: malformedDeclaration as unknown as AttackActionState,
      }, /Invalid Attack/);
    }
    const actorWithoutAttackProfile = baseWorld();
    delete actorWithoutAttackProfile.actors.a.attackProfile;
    expectEventRejected(actorWithoutAttackProfile, {
      type: 'AttackActionStarted', attackAction: valid,
    }, /Invalid Attack/);
    const once = startedWorld();
    expectEventRejected(once, { type: 'AttackActionStarted', attackAction: valid }, /Invalid Attack/);
    expectEventRejected(once, {
      type: 'AttackActionStarted',
      attackAction: attackAction('another'),
    }, /already has an open Attack/);
  });

  it('validates entry kind, system identity, provenance, ordinal, and active state', () => {
    const world = startedWorld();
    const weapon = performWeaponSequenceAttack({
      sequence: world.attackActions.attack.sequence,
      actionId: SYSTEM_ACTION_IDS.weaponAttack,
      weaponCardId: 'weapon',
      sourceEntityIds: ['system:dnd5e-2024:weapon-attack', 'card:weapon'],
    }).entries[0];
    expect(evolve(world, {
      type: 'AttackEntryCommitted', attackActionId: 'attack', entry: weapon,
    }).attackActions.attack.sequence.entries).toHaveLength(1);
    for (const [entry, pattern] of [
      [{ ...weapon, actionId: 'db:shadow' }, /shadows/],
      [{ ...weapon, sourceEntityIds: ['card:weapon'] }, /shadows/],
      [{ ...weapon, weaponCardId: undefined }, /requires a Card ID/],
      [{ ...weapon, ordinal: 2 }, /not the canonical next entry/],
    ] as Array<[typeof weapon, RegExp]>) {
      expectEventRejected(world, {
        type: 'AttackEntryCommitted', attackActionId: 'attack', entry,
      }, pattern);
    }
    const replacement = replaceSequenceAttack({
      sequence: world.attackActions.attack.sequence,
      actionId: 'feature:replacement',
      replacementKey: 'replacement',
      sourceEntityIds: ['feature:replacement'],
    }).entries[0];
    expect(evolve(world, {
      type: 'AttackEntryCommitted', attackActionId: 'attack', entry: replacement,
    }).attackActions.attack.sequence.usedReplacementKeys).toEqual(['replacement']);

    const unarmedDamage = performUnarmedStrike({
      sequence: world.attackActions.attack.sequence,
      actionId: SYSTEM_ACTION_IDS.unarmedDamage,
      option: 'damage',
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:damage'],
    }).entries[0];
    expect(evolve(world, {
      type: 'AttackEntryCommitted', attackActionId: 'attack', entry: unarmedDamage,
    }).attackActions.attack.sequence.entries).toEqual([unarmedDamage]);

    const closed = {
      ...world,
      attackActions: { attack: { ...world.attackActions.attack, status: 'forfeited' as const } },
    };
    const blocked = {
      ...world,
      attackActions: { attack: { ...world.attackActions.attack, blockedByResolutionId: 'r' } },
    };
    for (const state of [baseWorld(), closed, blocked]) {
      expectEventRejected(state, {
        type: 'AttackEntryCommitted', attackActionId: 'attack', entry: weapon,
      }, /inactive Attack/);
    }
  });

  it('rejects illegal block, unblock, and close transitions', () => {
    const world = startedWorld();
    const blocked = evolve(world, {
      type: 'AttackActionBlocked', attackActionId: 'attack', resolutionId: 'r',
    });
    const closed = {
      ...world,
      attackActions: { attack: { ...world.attackActions.attack, status: 'forfeited' as const } },
    };
    for (const state of [baseWorld(), closed, blocked]) {
      expectEventRejected(state, {
        type: 'AttackActionBlocked', attackActionId: 'attack', resolutionId: 'r2',
      }, /Cannot block/);
    }
    for (const state of [baseWorld(), closed, world, {
      ...blocked,
      attackActions: { attack: { ...blocked.attackActions.attack, blockedByResolutionId: 'other' } },
    }]) {
      expectEventRejected(state, {
        type: 'AttackActionUnblocked', attackActionId: 'attack', resolutionId: 'r',
      }, /Cannot unblock/);
    }
    expect(evolve(blocked, {
      type: 'AttackActionUnblocked', attackActionId: 'attack', resolutionId: 'r',
    }).attackActions.attack.blockedByResolutionId).toBeUndefined();

    for (const state of [baseWorld(), closed, blocked]) {
      expectEventRejected(state, {
        type: 'AttackActionClosed', attackActionId: 'attack', reason: 'forfeited',
      }, /Cannot close/);
    }
    expectEventRejected(world, {
      type: 'AttackActionClosed', attackActionId: 'attack', reason: 'completed',
    }, /attacks remaining/);
  });

  it('rejects malformed grapple relations and duplicate condition projections', () => {
    const base = baseWorld();
    const valid = validGrapple();
    expect(evolve(base, {
      type: 'GrappleApplied', grapple: validGrapple('off-hand', 'off_hand'),
    }).grapples['off-hand'].sourcePart).toBe('off_hand');
    const malformedPrimary: GrappleState[] = [
      { ...valid, targetActorId: 'missing' },
      { ...valid, grapplerActorId: 'missing' },
      { ...valid, grapplerActorId: 'a', targetActorId: 'a' },
    ];
    for (const grapple of malformedPrimary) {
      expectEventRejected(base, { type: 'GrappleApplied', grapple }, /Invalid grapple/);
    }
    const applied = evolve(base, { type: 'GrappleApplied', grapple: valid });
    expectEventRejected(applied, { type: 'GrappleApplied', grapple: valid }, /Invalid grapple/);

    const occupiedOther = evolve(base, {
      type: 'GrappleApplied', grapple: validGrapple('existing'),
    });
    const equipped = copyWorld(base);
    equipped.actors.a.runtime.equipment.main_hand = 'weapon';
    const largeTarget = copyWorld(base);
    largeTarget.actors.b.attackProfile!.size = 4;
    const missingProfile = copyWorld(base);
    missingProfile.actors.a.attackProfile = undefined;
    const malformedSecondary: Array<[WorldState, GrappleState]> = [
      [base, { ...valid, sourcePart: 'tail' }],
      [occupiedOther, { ...valid, id: 'other' }],
      [equipped, valid],
      [largeTarget, valid],
      [missingProfile, valid],
      [base, { ...valid, escapeDc: 1.5 }],
      [base, { ...valid, escapeDc: 0 }],
      [base, { ...valid, reachFt: Number.NaN }],
      [base, { ...valid, reachFt: 0 }],
      [base, { ...valid, reachFt: 10 }],
      [base, { ...valid, sourceEntityIds: ['forged'] }],
    ];
    for (const [world, grapple] of malformedSecondary) {
      expectEventRejected(world, { type: 'GrappleApplied', grapple }, /violates/);
    }
    const duplicateProjection = copyWorld(base);
    duplicateProjection.actors.b.runtime.activeEffects.push({
      id: 'grapple:g', name: 'forged', mechanics: {}, source: 'forged',
    });
    expectEventRejected(duplicateProjection, {
      type: 'GrappleApplied', grapple: valid,
    }, /Duplicate grapple effect/);
  });

  it('validates grapple end, shove outcome, and single pending resolution', () => {
    const base = baseWorld();
    expectEventRejected(base, {
      type: 'GrappleEnded', grappleId: 'missing', reason: 'released',
    }, /inactive grapple/);
    const applied = evolve(base, { type: 'GrappleApplied', grapple: validGrapple() });
    const missingTarget = copyWorld(applied);
    delete missingTarget.actors.b;
    expectEventRejected(missingTarget, {
      type: 'GrappleEnded', grappleId: 'g', reason: 'released',
    }, /missing target/);

    const shove = {
      type: 'ShoveApplied' as const,
      effectId: 'prone',
      sourceActorId: 'a',
      targetActorId: 'b',
      outcome: 'prone' as const,
      facts: {
        factsSource: 'scenario' as const,
        boardRevision: 1,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none' as const,
        relation: 'enemy' as const,
      },
    };
    expectEventRejected(base, { ...shove, targetActorId: 'missing' }, /Cannot apply shove/);
    expectEventRejected(base, { ...shove, sourceActorId: 'missing' }, /Cannot apply shove/);
    expectEventRejected(base, { ...shove, outcome: 'forged' as never }, /Invalid shove/);
    expectEventRejected(base, { ...shove, effectId: '' }, /Invalid shove/);
    const duplicate = copyWorld(base);
    duplicate.actors.b.runtime.activeEffects.push({
      id: 'prone', name: 'existing', mechanics: {}, source: 'fixture',
    });
    expectEventRejected(duplicate, shove, /Invalid shove/);
    expect(evolve(base, { ...shove, outcome: 'push_5ft' })).toBe(base);

    const pending = {
      id: 'hazard-resolution',
      type: 'hazard_save' as const,
      openedByCommandId: 'hazard',
      openedAtRevision: 0,
      deadlineLogicalClock: 1,
      targetActorId: 'b',
      hazard: {
        id: 'hazard', name: 'hazard', sourceKind: 'system' as const,
        sourceEntityIds: ['hazard'] as [string],
        save: { ability: 'dex' as const, dc: 10 },
        onFailure: [],
      },
      request: {
        id: 'request', type: 'saving_throw' as const, actorId: 'b',
        ability: 'dex' as const, dc: 10, avoidsConditions: [],
      },
    };
    const opened = evolve(base, { type: 'ResolutionOpened', resolution: pending });
    expectEventRejected(opened, { type: 'ResolutionOpened', resolution: pending }, /Cannot replace/);
  });
});

function copyWorld(world: WorldState): WorldState {
  return JSON.parse(JSON.stringify(world)) as WorldState;
}
