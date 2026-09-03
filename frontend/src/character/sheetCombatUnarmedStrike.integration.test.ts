import { describe, expect, it } from 'vitest';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
} from '../rules-core/domain';
import {
  UNARMED_STRIKE_CHOICE_ID,
  UNARMED_STRIKE_PRIMITIVE,
} from './sheetCombatDeclaration';
import {
  executeSheetCombatAction,
  SheetCombatSessionError,
  type SheetCombatSession,
} from './sheetCombatSession';

const ACTION_ID = 'action:unarmed';
const ATTACKER = 'actor:fighter';
const TARGET = 'actor:target';

const UNARMED: RuleActionDefinition = {
  id: ACTION_ID,
  name: 'Безоружный удар',
  kind: 'nonSpell',
  sourceEntityIds: ['action_basic_unarmed'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    primitive: { type: UNARMED_STRIKE_PRIMITIVE },
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    targeting: {
      domain: 'actor', actor_targets: true, shape: 'single',
      min_targets: 1, max_targets: 1, range_ft: 5,
      requires_line_of_sight: true, allowed_relations: ['enemy'],
    },
    effects: [{
      resolution: 'attack_roll', attack_kind: 'unarmed', ability: 'str', vs: 'ac',
      on_hit: [{ kind: 'damage', amount: '1 + str', type: 'bludgeoning' }],
    }],
  },
};

function actor(id: string): ActorState {
  const fighter = id === ATTACKER;
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    ac: 10,
    capabilities: { actionIds: fighter ? [ACTION_ID] : [] },
    character: {
      abilityMods: { str: fighter ? 3 : 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      profBonus: 3,
      level: fighter ? 5 : 1,
    },
    runtime: {
      hp: { current: 100, max: 100, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {}, inventory: [], activeEffects: [], firedThisTurn: [],
    },
    attackProfile: {
      attacksPerAction: fighter ? 2 : 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: [fighter ? 'EFF-extra-attack' : 'system:base-attack'],
    },
  };
}

function baseSession(): SheetCombatSession {
  const catalog: RulesCatalog = {
    getAction: (id) => id === ACTION_ID ? UNARMED : undefined,
    listActions: () => [UNARMED],
  };
  const world = createWorld({
    id: 'world:sheet-unarmed-extra-attack',
    ruleset: {
      systemId: 'dnd5e-2024', releaseId: 'test',
      contentHash: 'sha256:sheet-unarmed-extra-attack', errataVersion: '2024',
    },
    actors: [actor(ATTACKER), actor(TARGET)],
  });
  world.scene = {
    mode: 'encounter', initiative: [ATTACKER, TARGET],
    activeIndex: 0, round: 1, turnStarted: true,
  };
  return {
    sourceCharacterId: ATTACKER,
    participantRevisions: { [ATTACKER]: 0, [TARGET]: 0 },
    catalogActions: [UNARMED],
    certifiedActionIdsByActor: { [ATTACKER]: [ACTION_ID], [TARGET]: [] },
    resourceBindingsByActor: { [ATTACKER]: {}, [TARGET]: {} },
    world,
    catalog,
  };
}

function declaration() {
  return {
    sceneMode: 'encounter' as const,
    targetIds: [TARGET],
    factsByTarget: {
      [TARGET]: {
        factsSource: 'scenario' as const,
        boardRevision: 0,
        relation: 'enemy' as const,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none' as const,
      },
    },
    choices: { [UNARMED_STRIKE_CHOICE_ID]: 'damage' },
  };
}

function strike(
  session: SheetCombatSession,
  commandId: string,
): ReturnType<typeof executeSheetCombatAction> {
  return executeSheetCombatAction({
    session,
    actorId: ATTACKER,
    actionId: ACTION_ID,
    declaration: declaration(),
    commandId,
    rng: () => 0.99,
  });
}

function continued(
  initial: SheetCombatSession,
  transition: ReturnType<typeof executeSheetCombatAction>,
): SheetCombatSession {
  return { ...initial, world: transition.nextWorld };
}

describe('sheet Unarmed Strike owns the canonical Attack-action ledger', () => {
  it('spends one Action, allows exactly two level-5 attacks, and rejects a third', () => {
    const initial = baseSession();
    const first = strike(initial, '11111111-1111-4111-8111-111111111111');
    expect(first.nextWorld.actors[ATTACKER].runtime.resources.action).toBe(0);
    const firstLedger = Object.values(first.nextWorld.attackActions);
    expect(firstLedger).toHaveLength(1);
    expect(firstLedger[0]).toMatchObject({ status: 'open' });
    expect(firstLedger[0].sequence.attacksRemaining).toBe(1);

    const second = strike(
      continued(initial, first),
      '22222222-2222-4222-8222-222222222222',
    );
    const completed = Object.values(second.nextWorld.attackActions);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ status: 'completed' });
    expect(completed[0].sequence.entries).toHaveLength(2);

    expect(() => strike(
      continued(initial, second),
      '33333333-3333-4333-8333-333333333333',
    )).toThrowError(new SheetCombatSessionError(
      'InsufficientResources: Missing resources: action',
    ));
  });

  it('an Action restored by Action Surge opens one new two-attack budget', () => {
    const initial = baseSession();
    const first = strike(initial, '44444444-4444-4444-8444-444444444444');
    const second = strike(
      continued(initial, first),
      '55555555-5555-4555-8555-555555555555',
    );
    const surgedWorld = structuredClone(second.nextWorld);
    surgedWorld.actors[ATTACKER].runtime.resources.action = 1;
    const surged: SheetCombatSession = { ...initial, world: surgedWorld };

    const third = strike(surged, '66666666-6666-4666-8666-666666666666');
    const fourth = strike(
      continued(surged, third),
      '77777777-7777-4777-8777-777777777777',
    );
    const ledgers = Object.values(fourth.nextWorld.attackActions);
    expect(ledgers).toHaveLength(2);
    expect(ledgers.every((ledger) => (
      ledger.status === 'completed' && ledger.sequence.entries.length === 2
    ))).toBe(true);
    expect(fourth.nextWorld.actors[ATTACKER].runtime.resources.action).toBe(0);
    expect(() => strike(
      continued(surged, fourth),
      '88888888-8888-4888-8888-888888888888',
    )).toThrowError(/InsufficientResources/);
  });
});
