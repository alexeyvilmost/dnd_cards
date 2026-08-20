import { describe, expect, it } from 'vitest';
import { CARD_DAGGER } from '../mvp/fixtures';
import type { Card } from '../types';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
} from '../rules-core/domain';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import {
  executeSheetCombatAction,
  prepareSheetCombatCommit,
  type SheetCombatSession,
} from './sheetCombatSession';
import type { ForgeCharacter } from './types';

const MAIN = 'action:weapon-main';
const OFF = 'action:weapon-light-extra';
const ATTACKER = 'actor:attacker';
const TARGET = 'actor:target';

function declaredAction(input: { id: string; off?: boolean }): RuleActionDefinition {
  const off = input.off === true;
  return {
    id: input.id,
    name: off ? 'Light extra attack' : 'Weapon attack',
    kind: 'nonSpell',
    sourceEntityIds: [`content:${input.id}`],
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt: 200,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
    mechanics: {
      primitive: {
        type: off ? LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE : WEAPON_ATTACK_PRIMITIVE,
      },
      activation: {
        mode: 'active',
        cost: [
          { resource: off ? 'bonus_action' : 'action' },
          { resource: 'equipped_weapon_ammo', amount: 1 },
        ],
      },
      targeting: {
        domain: 'actor',
        actor_targets: true,
        shape: 'single',
        min_targets: 1,
        max_targets: 1,
        range_ft: 200,
        requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll',
        attack_kind: 'weapon_melee',
        ability: 'auto',
        vs: 'ac',
        ...(off ? { tags: ['off_hand', 'two_weapon'] } : {}),
        on_hit: [{
          kind: 'damage',
          dice: 'weapon',
          type: 'weapon',
          ability: off ? 'none' : 'auto',
        }],
      }],
    },
  };
}

const BOLT = { ...CARD_DAGGER, id: 'card:bolt', name: 'Bolt', type: 'ammunition' } as Card;
const MAIN_WEAPON = {
  ...CARD_DAGGER,
  id: 'card:hand-crossbow',
  name: 'Hand crossbow',
  weapon_type: 'hand_crossbow',
  range: '30/120',
  properties: ['light', 'ammunition'],
  mechanics: {
    weapon_profile: {
      weapon_type: 'hand_crossbow',
      proficiency_category: 'martial',
      attack_ability: 'dex',
      damage_lines: [{ dice: '1d6', type: 'piercing' }],
      default_attack_mode: 'ranged',
      attack_modes: [{ kind: 'ranged', normal_ft: 30, long_ft: 120 }],
      properties: ['ammunition', 'light'],
      mastery_effect_id: 'mastery_vex',
      ammo: { card_id: BOLT.id, name: BOLT.name },
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
} as Card;
const OFF_WEAPON = {
  ...CARD_DAGGER,
  id: 'card:scimitar',
  name: 'Scimitar',
  weapon_type: 'scimitar',
  bonus_value: '1d6',
  properties: ['light', 'finesse'],
  mechanics: {
    weapon_profile: {
      weapon_type: 'scimitar',
      proficiency_category: 'martial',
      attack_ability: 'finesse',
      damage_lines: [{ dice: '1d6', type: 'slashing' }],
      default_attack_mode: 'melee',
      attack_modes: [{ kind: 'melee', reach_ft: 5 }],
      properties: ['finesse', 'light'],
      mastery_effect_id: 'mastery_nick',
      ammo: null,
      enchantment: { attack_bonus: 0, damage_bonus: 0, extra_damage_lines: [] },
      attunement: { required: false },
    },
  },
} as Card;

function actor(id: string): ActorState {
  const attacker = id === ATTACKER;
  const cards = attacker ? [MAIN_WEAPON, OFF_WEAPON, BOLT] : [];
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    ac: 10,
    capabilities: { actionIds: attacker ? [MAIN, OFF] : [] },
    character: {
      abilityMods: { str: 2, dex: 4, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: cards,
      equippedCards: attacker ? [MAIN_WEAPON, OFF_WEAPON] : [],
      weaponProficiencies: attacker ? ['hand_crossbow', 'scimitar'] : [],
    },
    runtime: {
      hp: { current: 30, max: 30, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: attacker
        ? { main_hand: MAIN_WEAPON.id, off_hand: OFF_WEAPON.id }
        : {},
      inventory: attacker ? [
        { cardId: MAIN_WEAPON.id, qty: 1 },
        { cardId: OFF_WEAPON.id, qty: 1 },
        { cardId: BOLT.id, qty: 3 },
      ] : [],
      activeEffects: [],
      firedThisTurn: [],
    },
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function session(): SheetCombatSession {
  const actions = [declaredAction({ id: MAIN }), declaredAction({ id: OFF, off: true })];
  const byId = new Map(actions.map((action) => [action.id, action]));
  const catalog: RulesCatalog = {
    getAction: (id) => byId.get(id),
    listActions: () => actions,
  };
  const world = createWorld({
    id: 'world:sheet-weapon-actions',
    ruleset: {
      systemId: 'dnd5e-2024',
      releaseId: 'test',
      contentHash: 'sha256:test-sheet-weapon-actions',
      errataVersion: '2024',
    },
    actors: [actor(ATTACKER), actor(TARGET)],
  });
  world.scene = {
    mode: 'encounter',
    initiative: [ATTACKER, TARGET],
    activeIndex: 0,
    round: 1,
    turnStarted: true,
  };
  return {
    sourceCharacterId: ATTACKER,
    participantRevisions: { [ATTACKER]: 0, [TARGET]: 0 },
    catalogActions: actions,
    certifiedActionIdsByActor: { [ATTACKER]: [MAIN, OFF], [TARGET]: [] },
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
  };
}

function persistedCharacter(id: string): ForgeCharacter {
  const state = actor(id).runtime;
  return {
    id,
    name: id,
    runtime_revision: 0,
    current_encounter_id: null,
    current_hp: state.hp.current,
    max_hp: state.hp.max,
    equipment: { ...state.equipment },
    inventory_items: state.inventory.map((row) => ({
      card_id: row.cardId,
      qty: row.qty,
      ...(row.containerId ? { container_id: row.containerId } : {}),
    })),
    resources: { ...state.resources },
    max_resources: { ...state.maxResources },
    active_effects: [],
    turn_state: {},
    currency: { gold: 0, silver: 0, copper: 0 },
  } as unknown as ForgeCharacter;
}

describe('sheet weapon actions use one atomic canonical session', () => {
  it('opens and completes Attack, pays contextual ammo, then consumes the persisted Light ledger', () => {
    const initial = session();
    const main = executeSheetCombatAction({
      session: initial,
      actorId: ATTACKER,
      actionId: MAIN,
      declaration: declaration(),
      commandId: '11111111-1111-4111-8111-111111111111',
      rng: () => 0.99,
    });
    const afterMain = main.nextWorld;
    expect(afterMain.actors[ATTACKER].runtime.resources.action).toBe(0);
    expect(afterMain.actors[ATTACKER].runtime.inventory.find((row) => row.cardId === BOLT.id)?.qty)
      .toBe(2);
    expect(afterMain.actors[TARGET].runtime.hp.current).toBeLessThan(30);
    const ledger = Object.values(afterMain.attackActions);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ actorId: ATTACKER, status: 'completed' });
    expect(ledger[0].sequence.entries[0]).toMatchObject({
      kind: 'weapon_attack',
      weaponCardId: MAIN_WEAPON.id,
    });
    expect(main.events.some((event) => (
      event.payload.type === 'EngineEventRecorded'
      && event.payload.event.type === 'item_consumed'
      && event.payload.event.cardId === BOLT.id
    ))).toBe(true);
    const prepared = prepareSheetCombatCommit({
      transition: main,
      characters: {
        [ATTACKER]: persistedCharacter(ATTACKER),
        [TARGET]: persistedCharacter(TARGET),
      },
    });
    const attackerPatch = prepared.request.participants.find((participant) => (
      participant.character_id === ATTACKER
    ))?.patch;
    expect(attackerPatch?.inventory_items).toEqual([
      { card_id: MAIN_WEAPON.id, qty: 1 },
      { card_id: OFF_WEAPON.id, qty: 1 },
      { card_id: BOLT.id, qty: 2 },
    ]);
    expect(prepared.request.events.some((event) => (
      event.character_id === ATTACKER && event.payload.type === 'item_consumed'
    ))).toBe(true);

    const afterMainSession: SheetCombatSession = { ...initial, world: afterMain };
    afterMainSession.world.actors[ATTACKER].character.weaponMasteries = ['scimitar'];
    afterMainSession.world.actors[ATTACKER].masteryEffects = {
      mastery_nick: {
        name: 'Data-owned slowing mastery',
        mechanics: { weapon_mastery: {
          type: 'slow', penaltyFt: 10, requiresDamage: true,
          expires: 'start_of_source_next_turn', choiceId: 'apply-slow',
        } },
      },
    };
    const off = executeSheetCombatAction({
      session: afterMainSession,
      actorId: ATTACKER,
      actionId: OFF,
      declaration: { ...declaration(), choices: { 'apply-slow': ['use'] } },
      commandId: '22222222-2222-4222-8222-222222222222',
      rng: () => 0.99,
    });
    expect(off.nextWorld.actors[ATTACKER].runtime.resources.bonus_action).toBe(0);
    expect(off.nextWorld.actors[ATTACKER].runtime.inventory.find((row) => row.cardId === BOLT.id)?.qty)
      .toBe(2);
    expect(off.nextWorld.actors[TARGET].runtime.hp.current)
      .toBeLessThan(afterMain.actors[TARGET].runtime.hp.current);
    expect(off.nextWorld.attackActions[ledger[0].id]).toEqual(ledger[0]);
    expect(off.nextWorld.actors[TARGET].runtime.activeEffects).toContainEqual(
      expect.objectContaining({
        mechanics: expect.objectContaining({
          kind: 'modifier', op: 'add', value: '-10',
          applies_to: { roll: 'speed' },
        }),
      }),
    );
  });

  it('carries optional Light mastery choices through the strict bridge', () => {
    for (const selected of ['skip', '5']) {
      const initial = session();
      const main = executeSheetCombatAction({
        session: initial,
        actorId: ATTACKER,
        actionId: MAIN,
        declaration: declaration(),
        commandId: selected === 'skip'
          ? '44444444-4444-4444-8444-444444444444'
          : '55555555-5555-4555-8555-555555555555',
        rng: () => 0.99,
      });
      const bridged: SheetCombatSession = { ...initial, world: main.nextWorld };
      bridged.world.actors[ATTACKER].character.weaponMasteries = ['scimitar'];
      bridged.world.actors[ATTACKER].masteryEffects = {
        mastery_nick: {
          name: 'Data-owned pushing mastery',
          mechanics: { weapon_mastery: {
            type: 'push', maxDistanceFt: 10, maxTargetSize: 'large',
            choiceId: 'push-distance',
          } },
        },
      };
      const off = executeSheetCombatAction({
        session: bridged,
        actorId: ATTACKER,
        actionId: OFF,
        declaration: { ...declaration(), choices: { 'push-distance': [selected] } },
        commandId: selected === 'skip'
          ? '66666666-6666-4666-8666-666666666666'
          : '77777777-7777-4777-8777-777777777777',
        rng: () => 0.99,
      });
      const movements = off.events.filter((event) => (
        event.payload.type === 'EngineEventRecorded'
        && event.payload.event.type === 'movement'
      ));
      if (selected === 'skip') {
        expect(movements).toEqual([]);
      } else {
        expect(movements).toContainEqual(expect.objectContaining({
          payload: expect.objectContaining({
            event: { type: 'movement', mode: 'push', distanceFt: 5 },
          }),
        }));
      }
    }
  });

  it('rejects a mutated data-owned timing cost instead of falling back to CORE Attack cost', () => {
    const initial = session();
    const mutated = declaredAction({ id: MAIN });
    const activation = mutated.mechanics.activation as Record<string, unknown>;
    activation.cost = [
      { resource: 'action', amount: 2 },
      { resource: 'equipped_weapon_ammo', amount: 1 },
    ];
    const actions = [mutated, declaredAction({ id: OFF, off: true })];
    const byId = new Map(actions.map((action) => [action.id, action]));
    const mutatedSession: SheetCombatSession = {
      ...initial,
      catalogActions: actions,
      catalog: {
        getAction: (id) => byId.get(id),
        listActions: () => actions,
      },
    };
    expect(() => executeSheetCombatAction({
      session: mutatedSession,
      actorId: ATTACKER,
      actionId: MAIN,
      declaration: declaration(),
      commandId: '33333333-3333-4333-8333-333333333333',
      rng: () => { throw new Error('invalid timing cost must not roll'); },
    })).toThrow(/InvalidActionDefinition|exactly one action cost/);
    expect(initial.world.actors[ATTACKER].runtime.resources.action).toBe(1);
    expect(Object.keys(initial.world.attackActions)).toHaveLength(0);
  });
});
