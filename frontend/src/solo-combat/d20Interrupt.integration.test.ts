import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type RulesetReference,
} from '../rules-core/domain';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import {
  createSoloCombatState,
  executeCombatAction,
  resolveD20Interrupt,
  runMonsterTurn,
} from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';
import type { SoloCombatState } from './types';
import { validateMechanics } from '../engine/validateMechanics';

const fixture = compiledFixtureJson as unknown as {
  source: { ruleset: RulesetReference };
  roots: {
    magicInitiateFighter: { actor: ActorState; actions: RuleActionDefinition[] };
    wizard: { actor: ActorState; actions: RuleActionDefinition[] };
  };
};

const ATTACK_ID = 'a8400000-0000-4000-8000-000000000001';
const CHECK_ID = 'a8400000-0000-4000-8000-000000000002';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function participant(root: 'magicInitiateFighter' | 'wizard'): SheetCombatParticipantSeed {
  const actor = clone(fixture.roots[root].actor);
  delete actor.capabilities.featureSources?.['alert.initiative_swap'];
  const actions = clone(fixture.roots[root].actions);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const catalog: RulesCatalog = { getAction: (id) => byId.get(id), listActions: () => actions };
  const canonical: SheetCanonicalRuntime = {
    actorId: actor.id,
    world: createWorld({ id: `d20-interrupt:${actor.id}`, ruleset: fixture.source.ruleset, actors: [actor] }),
    actions, catalog, cards: [], resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const character = {
    id: actor.id, name: actor.name, user_id: 'd20-interrupt-test', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 3,
    current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {},
    initiative_bonus: root === 'wizard' ? 10 : 0, speed: actor.character.characterSpeed ?? 30,
  } as unknown as ForgeCharacter;
  return { character, canonical };
}

function interruptPassive(kind: 'warding' | 'cutting'): Record<string, unknown> {
  if (kind === 'warding') {
    return {
      id: 'EFFECT-0121', name: 'Защищающая вспышка',
      activation: {
        mode: 'triggered', optional: true,
        cost: [{ resource: 'reaction' }, { resource: 'warding_flare' }],
        trigger: { event: 'attack_roll_made', timing: 'before' },
      },
      effects: [{ resolution: 'auto', result: [
        { kind: 'resource', op: 'grant', id: 'warding_flare', amount: 'max(1,wis)', per: 'long_rest' },
        {
          kind: 'd20_interrupt', operation: 'impose_disadvantage', timing: 'before_roll',
          eligible_rolls: ['attack_roll'], range_ft: 30, requires_line_of_sight: true,
          allowed_relations: ['enemy'],
        },
      ] }],
    };
  }
  return {
    id: 'EFFECT-0012', name: 'Острое словцо',
    activation: {
      mode: 'triggered', optional: true,
      cost: [{ resource: 'reaction' }, { resource: 'bardic_inspiration' }],
      trigger: { events: ['attack_roll_made', 'ability_check_made'], timing: 'after' },
    },
    effects: [{ resolution: 'auto', result: [{
      kind: 'd20_interrupt', operation: 'subtract_die', timing: 'after_outcome',
      eligible_rolls: ['attack_roll', 'ability_check'], eligible_outcomes: ['hit', 'success'],
      range_ft: 60, requires_line_of_sight: true, allowed_relations: ['enemy'],
      die: { class: 'bard', by_level: { 1: 6, 5: 8, 10: 10, 15: 12 } },
    }] }],
  };
}

function reactor(kind: 'warding' | 'cutting') {
  const seed = participant('wizard');
  const actor = seed.canonical.world.actors[seed.character.id];
  actor.character.level = 5;
  actor.character.classLevels = { bard: 5 };
  delete actor.capabilities.featureSources?.['alert.initiative_swap'];
  actor.passives = [...(actor.passives ?? []), interruptPassive(kind)];
  const resource = kind === 'warding' ? 'warding_flare' : 'bardic_inspiration';
  actor.runtime.resources[resource] = 2;
  actor.runtime.maxResources[resource] = 2;
  seed.character.resources = clone(actor.runtime.resources);
  seed.character.max_resources = clone(actor.runtime.maxResources);
  return seed;
}

function monsterAttack(): Action {
  return {
    id: ATTACK_ID, name: 'Клинок испытаний', description: '', rarity: 'common',
    card_number: 'MONSTER-ACTION-D20-INTERRUPT', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
        range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'],
      },
      effects: [{
        resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee', vs: 'ac',
        on_hit: [{ kind: 'damage', dice: '1d6', ability: 'str', type: 'slashing' }],
      }],
    },
  } as Action;
}

function monsterCheck(): Action {
  return {
    id: CHECK_ID, name: 'Испытание силы', description: '', rarity: 'common',
    card_number: 'MONSTER-CHECK-D20-INTERRUPT', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'action' }] },
      targeting: {
        domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1,
        range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'],
      },
      effects: [{
        resolution: 'ability_check', ability: 'str', dc: 10,
        on_success: [{ kind: 'temp_hp', amount: 5 }], on_failure: [],
      }],
    },
  } as Action;
}

function enemy(action: Action): Monster {
  return {
    id: 'c8400000-0000-4000-8000-000000000001', slug: 'd20-interrupt-enemy',
    name: 'Проверяющий противник', description: '', size: 'medium', creature_type: 'humanoid',
    alignment: '', challenge_rating: '1', armor_class: 12, max_hp: 30, speed: 30,
    initiative_bonus: 100, proficiency_bonus: 2,
    abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    action_ids: [action.id], effect_ids: [], ai: { strategy: 'melee_chase' }, token_url: '',
    source: 'test', created_at: '', updated_at: '',
  };
}

async function combat(kind: 'warding' | 'cutting', action = monsterAttack()) {
  const target = participant('magicInitiateFighter');
  const responder = reactor(kind);
  let state = await createSoloCombatState({
    character: target.character, participant: target, allies: [responder],
    selected: [{ monster: enemy(action), quantity: 1 }], actions: [action], effects: [],
    rng: () => 0.5,
  });
  const monsterId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
  const targetId = target.character.id;
  const responderId = responder.character.id;
  const targetPosition = state.tokens[targetId].position;
  state = {
    ...state,
    tokens: {
      ...state.tokens,
      [monsterId]: { ...state.tokens[monsterId], position: { x: targetPosition.x, y: targetPosition.y - 1 } },
      [responderId]: { ...state.tokens[responderId], position: { x: targetPosition.x + 1, y: targetPosition.y } },
    },
    boardRevision: state.boardRevision + 1,
  } as SoloCombatState;
  return { state, monsterId, targetId, responderId, action };
}

describe('persisted cross-actor d20 interrupts', () => {
  it('accepts the data-driven interrupt contract and rejects an incomplete payload', () => {
    for (const kind of ['warding', 'cutting'] as const) {
      expect(validateMechanics(
        interruptPassive(kind),
        { id: `interrupt-${kind}`, name: kind, kind: 'passive_effect' },
      )).toEqual({ valid: true, errors: [] });
    }
    const incomplete = interruptPassive('warding');
    const payload = (incomplete.effects as Array<{ result: Record<string, unknown>[] }>)[0].result
      .find((candidate) => candidate.kind === 'd20_interrupt')!;
    delete payload.range_ft;
    expect(validateMechanics(
      incomplete,
      { id: 'interrupt-invalid', name: 'invalid', kind: 'passive_effect' },
    ).valid).toBe(false);
  });

  it('holds Warding Flare before the attack, persists it, then spends both resources and applies real Disadvantage', async () => {
    const setup = await combat('warding');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.95,
    });
    expect(state.pendingD20Interrupt).toMatchObject({
      timing: 'before_roll', operation: 'impose_disadvantage',
      responders: [{ actorId: setup.responderId, effectId: 'EFFECT-0121' }],
    });
    expect(state.world.actors[setup.monsterId].runtime.resources.action).toBe(1);
    expect(readSoloCombatState(
      writeSoloCombatState({}, state), state.characterId, state.runtimeRevision,
    )?.pendingD20Interrupt).toEqual(state.pendingD20Interrupt);

    const rolls = [0.95, 0];
    state = resolveD20Interrupt(state, setup.responderId, () => rolls.shift() ?? 0);
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 0, warding_flare: 1,
    });
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);
    expect(state.world.actors[setup.monsterId].runtime.activeEffects).toHaveLength(0);
    const attackRoll = state.log.flatMap((entry) => entry.records ?? [])
      .flatMap((record) => record.event?.type === 'roll' ? [record.event.roll] : [])
      .find((roll) => roll.kind === 'd20' && roll.target?.type === 'ac');
    expect(attackRoll?.outcome).toBe('miss');
    expect(attackRoll?.advantage).toBe('disadvantage');
  });

  it('declining Warding Flare commits the attack only once', async () => {
    const setup = await combat('warding');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    const pending = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.95,
    });
    const resolved = resolveD20Interrupt(pending, null, () => 0.95);
    expect(resolved.world.actors[setup.targetId].runtime.hp.current).toBeLessThan(hpBefore);
    expect(resolved.world.actors[setup.monsterId].runtime.resources.action).toBe(0);
    expect(resolved.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 1, warding_flare: 2,
    });
  });

  it('pauses the autonomous monster controller and advances only after the held attack resolves', async () => {
    const setup = await combat('warding');
    const pending = runMonsterTurn(setup.state, () => 0.95);
    expect(pending.pendingD20Interrupt?.operation).toBe('impose_disadvantage');
    expect(pending.world.scene.mode === 'encounter'
      ? pending.world.scene.initiative[pending.world.scene.activeIndex]
      : null).toBe(setup.monsterId);
    const resolved = resolveD20Interrupt(pending, null, () => 0.95);
    const advanced = runMonsterTurn(resolved, () => 0.5);
    expect(advanced.world.scene.mode === 'encounter'
      ? advanced.world.scene.initiative[advanced.world.scene.activeIndex]
      : null).not.toBe(setup.monsterId);
  });

  it('previews a successful attack once, persists its transcript, and Cutting Words can turn it into a miss', async () => {
    const setup = await combat('cutting');
    const hpBefore = setup.state.world.actors[setup.targetId].runtime.hp.current;
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.75,
    });
    expect(state.pendingD20Interrupt).toMatchObject({
      timing: 'after_outcome', operation: 'subtract_die',
      preview: { rollKind: 'attack_roll', outcome: 'hit' },
      responders: [{ actorId: setup.responderId, effectId: 'EFFECT-0012' }],
    });
    expect(state.pendingD20Interrupt?.randomValues?.length).toBeGreaterThan(1);
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);

    state = resolveD20Interrupt(state, setup.responderId, () => 0.999);
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.targetId].runtime.hp.current).toBe(hpBefore);
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 0, bardic_inspiration: 1,
    });
    expect(state.log.some((entry) => entry.text.includes('1к8 = 8'))).toBe(true);
  });

  it('uses the same after-outcome continuation for a successful DC ability check', async () => {
    const check = monsterCheck();
    const setup = await combat('cutting', check);
    let state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: check.id,
      targetIds: [setup.monsterId], rng: () => 0.55,
    });
    expect(state.pendingD20Interrupt?.preview).toMatchObject({
      rollKind: 'ability_check', outcome: 'success',
    });
    state = resolveD20Interrupt(state, setup.responderId, () => 0.999);
    expect(state.world.actors[setup.monsterId].runtime.hp.temp).toBe(0);
    const checkRolls = state.log.flatMap((entry) => entry.records ?? [])
      .flatMap((record) => record.event?.type === 'roll' ? [record.event.roll] : []);
    expect(checkRolls.some((roll) => roll.outcome === 'fail')).toBe(true);
  });

  it('fails closed outside declared range without spending or pausing', async () => {
    const setup = await combat('warding');
    setup.state.tokens[setup.responderId].position = { x: 0, y: 0 };
    setup.state.tokens[setup.monsterId].position = { x: 11, y: 9 };
    setup.state.tokens[setup.targetId].position = { x: 10, y: 9 };
    const state = executeCombatAction({
      state: setup.state, actorId: setup.monsterId, actionId: setup.action.id,
      targetIds: [setup.targetId], rng: () => 0.75,
    });
    expect(state.pendingD20Interrupt).toBeUndefined();
    expect(state.world.actors[setup.responderId].runtime.resources).toMatchObject({
      reaction: 1, warding_flare: 2,
    });
  });
});
