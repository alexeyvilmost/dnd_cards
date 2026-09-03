import { describe, expect, it } from 'vitest';
import compiledFixtureJson from '../pages/rulesLabFixture.generated.json';
import { createWorld, type ActorState, type RuleActionDefinition, type RulesCatalog, type RulesetReference } from '../rules-core/domain';
import type { SheetCanonicalRuntime } from '../character/sheetCanonicalWorld';
import type { SheetCombatParticipantSeed } from '../character/sheetCombatSession';
import type { ForgeCharacter } from '../character/types';
import type { Action } from '../types';
import type { Monster } from '../monsters/types';
import { createSoloCombatState, executeCombatAction, resolveTriggeredCombatAction } from './engine';
import { readSoloCombatState, writeSoloCombatState } from './persistence';

const fixture = compiledFixtureJson as unknown as {
  source: { ruleset: RulesetReference };
  roots: { magicInitiateFighter: { actor: ActorState; actions: RuleActionDefinition[] } };
};

const ATTACK_ID = 'a5000000-0000-4000-8000-000000000001';
const WITHDRAW_ID = 'a5000000-0000-4000-8000-000000000002';
const SNEAK_ATTACK_ID = 'EFF-sneak-attack';

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function monsterAttack(): Action {
  return {
    id: 'b5000000-0000-4000-8000-000000000001', name: 'Тестовая атака', description: '',
    rarity: 'common', card_number: 'MONSTER-ACTION-CUNNING-STRIKE-TEST', resource: 'action',
    action_type: 'base_action', type: 'monster', created_at: '', updated_at: '',
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
      effects: [{ resolution: 'attack_roll', ability: 'dex', attack_kind: 'weapon_melee', vs: 'ac', on_hit: [{ kind: 'damage', dice: '1d4', ability: 'dex', type: 'slashing' }] }],
    },
  } as Action;
}

function targetMonster(maxHp = 40): Monster {
  return {
    id: 'c5000000-0000-4000-8000-000000000001', slug: 'cunning-strike-target', name: 'Цель Хитрого удара',
    description: '', size: 'medium', creature_type: 'humanoid', alignment: '', challenge_rating: '1',
    armor_class: 10, max_hp: maxHp, speed: 30, initiative_bonus: 0, proficiency_bonus: 2,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    action_ids: [monsterAttack().id], effect_ids: [], ai: { strategy: 'melee_chase' }, token_url: '',
    source: 'test', created_at: '', updated_at: '',
  };
}

function rogueSeed(): SheetCombatParticipantSeed {
  const actor = clone(fixture.roots.magicInitiateFighter.actor);
  actor.character.level = 5;
  actor.character.abilityMods.dex = 4;
  actor.runtime.resources.action = 1;
  actor.runtime.maxResources.action = 1;
  actor.runtime.activeEffects.push({
    id: 'cunning-strike-test-advantage', name: 'Тестовое преимущество', source: 'test',
    mechanics: { kind: 'modifier', op: 'advantage', applies_to: { roll: 'attack' } },
  });
  actor.passives = [...(actor.passives ?? []), {
    id: SNEAK_ATTACK_ID,
    name: 'Скрытая атака',
    activation: {
      mode: 'triggered',
      trigger: {
        event: 'hit', timing: 'during',
        circumstances: [{
          kind: 'all_of',
          of: [
            { kind: 'attack_weapon_property', value: 'finesse' },
            { kind: 'attack_advantage_state', value: 'advantage' },
          ],
        }],
      },
    },
    uses: { count: 1, per: 'turn' },
    effects: [{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', dice: '3d6', type: 'piercing', ability: 'none' }],
    }],
  }];
  const attack: RuleActionDefinition = {
    id: ATTACK_ID, name: 'Точная атака', kind: 'nonSpell', sourceEntityIds: ['test:rogue-attack'],
    targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
    mechanics: {
      interaction: { intent: 'harmful' },
      activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
      targeting: { domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1, range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy'] },
      effects: [{
        resolution: 'attack_roll', ability: 'dex', attack_kind: 'weapon_melee', vs: 'ac',
        weapon_properties: ['finesse'],
        on_hit: [{ kind: 'damage', dice: '1d4', ability: 'dex', type: 'piercing' }],
      }],
    },
  };
  const withdraw: RuleActionDefinition = {
    id: WITHDRAW_ID, name: 'Хитрый удар: отступление', kind: 'nonSpell',
    sourceEntityIds: ['EFF-rogue-cunning-strike', WITHDRAW_ID],
    targeting: { minTargets: 0, maxTargets: 1, rangeFt: 0, requiresLineOfSight: false, allowedRelations: ['self'] },
    mechanics: {
      activation: { mode: 'triggered', optional: true, cost: [], trigger: { event: 'sneak_attack_hit', timing: 'after' } },
      targeting: { domain: 'actor', actor_targets: false, shape: 'self', min_targets: 0, max_targets: 1, range_ft: 0, requires_line_of_sight: false, allowed_relations: ['self'] },
      effects: [{ resolution: 'auto', result: [{ kind: 'narrative', description: 'Перемещение без Провоцированных атак.' }] }],
    },
  };
  const actions = [...clone(fixture.roots.magicInitiateFighter.actions), attack, withdraw];
  actor.capabilities.actionIds.push(attack.id, withdraw.id);
  const byId = new Map(actions.map((action) => [action.id, action]));
  const catalog: RulesCatalog = { getAction: (id) => byId.get(id), listActions: () => actions };
  const canonical: SheetCanonicalRuntime = {
    actorId: actor.id,
    world: createWorld({ id: `cunning-strike-test:${actor.id}`, ruleset: fixture.source.ruleset, actors: [actor] }),
    actions, catalog, cards: [], resourceBindings: {},
    actionFor: () => { throw new Error('not used'); },
  };
  const character = {
    id: actor.id, name: 'Разбойник 5', user_id: 'test', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 0,
    current_hp: actor.runtime.hp.current, max_hp: actor.runtime.hp.max,
    resources: clone(actor.runtime.resources), max_resources: clone(actor.runtime.maxResources),
    active_effects: clone(actor.runtime.activeEffects), turn_state: {},
    initiative_bonus: 20, speed: 30,
  } as unknown as ForgeCharacter;
  return { character, canonical };
}

async function afterSneakAttack(resistPiercing = false, rng: () => number = () => 0.6, maxHp = 40) {
  const participant = rogueSeed();
  let state = await createSoloCombatState({
    character: participant.character,
    participant,
    selected: [{ monster: targetMonster(maxHp), quantity: 1 }],
    actions: [monsterAttack()], effects: [], rng,
  });
  const actorId = participant.character.id;
  const targetId = Object.values(state.world.actors).find((actor) => actor.kind === 'monster')!.id;
  const sourcePosition = state.tokens[actorId].position;
  const target = state.world.actors[targetId];
  state = {
    ...state,
    boardRevision: state.boardRevision + 1,
    world: resistPiercing ? {
      ...state.world,
      actors: {
        ...state.world.actors,
        [targetId]: {
          ...target,
          runtime: {
            ...target.runtime,
            activeEffects: [...target.runtime.activeEffects, {
              id: 'test:piercing-resistance', name: 'Сопротивление колющему урону', source: 'test',
              mechanics: { kind: 'resistance', damage_type: 'piercing', value: 'resistance' },
            }],
          },
        },
      },
    } : state.world,
    tokens: {
      ...state.tokens,
      [targetId]: {
        ...state.tokens[targetId],
        position: { x: sourcePosition.x, y: sourcePosition.y - 1 },
      },
    },
  };
  state = executeCombatAction({ state, actorId, actionId: ATTACK_ID, targetIds: [targetId], rng });
  return { state, actorId, targetId };
}

describe('Cunning Strike solo-combat interrupt', () => {
  it('opens only after the exact Sneak Attack ledger transition and records the deterministic 1d6 tradeoff', async () => {
    const { state, targetId } = await afterSneakAttack();
    expect(state.world.actors[targetId].runtime.hp.current).toBe(25); // 1d4 = 3, Sneak Attack = 12
    expect(state.pendingTriggeredAction).toMatchObject({
      event: 'sneak_attack_hit',
      optionActionIds: [WITHDRAW_ID],
      sneakAttackTradeoff: {
        targetActorId: targetId,
        dieResults: [4],
        effectiveDamage: 4,
        committedHp: { current: 25, max: 40, temp: 0 },
        replacementHp: { current: 29, max: 40, temp: 0 },
      },
    });
    expect(readSoloCombatState(
      writeSoloCombatState({}, state), state.characterId, state.runtimeRevision,
    )?.pendingTriggeredAction).toEqual(state.pendingTriggeredAction);
  });

  it('refunds exactly the sacrificed die only when a Cunning Strike option is accepted', async () => {
    const accepted = await afterSneakAttack();
    const resolved = resolveTriggeredCombatAction(accepted.state, WITHDRAW_ID, () => 0.6);
    expect(resolved.pendingTriggeredAction).toBeUndefined();
    expect(resolved.world.actors[accepted.targetId].runtime.hp.current).toBe(29);
    expect(resolved.log.at(-2)?.text).toContain('отказ от 1к6');

    const declined = await afterSneakAttack();
    const skipped = resolveTriggeredCombatAction(declined.state, null, () => 0.6);
    expect(skipped.pendingTriggeredAction).toBeUndefined();
    expect(skipped.world.actors[declined.targetId].runtime.hp.current).toBe(25);
  });

  it('refunds only the effective post-resistance share of the sacrificed die', async () => {
    const resisted = await afterSneakAttack(true);
    expect(resisted.state.world.actors[resisted.targetId].runtime.hp.current).toBe(33);
    expect(resisted.state.pendingTriggeredAction?.sneakAttackTradeoff).toMatchObject({
      dieResults: [4],
      effectiveDamage: 2,
      committedHp: { current: 33 },
      replacementHp: { current: 35 },
    });
    const resolved = resolveTriggeredCombatAction(resisted.state, WITHDRAW_ID, () => 0.6);
    expect(resolved.world.actors[resisted.targetId].runtime.hp.current).toBe(35);
  });

  it('foregoes both rolled copies of one Sneak Attack die on a critical hit', async () => {
    const critical = await afterSneakAttack(false, () => 0.999, 100);
    expect(critical.state.world.actors[critical.targetId].runtime.hp.current).toBe(56);
    expect(critical.state.pendingTriggeredAction?.sneakAttackTradeoff).toMatchObject({
      dieResults: [6, 6],
      effectiveDamage: 12,
      committedHp: { current: 56 },
      replacementHp: { current: 68 },
    });
    const resolved = resolveTriggeredCombatAction(critical.state, WITHDRAW_ID, () => 0.999);
    expect(resolved.world.actors[critical.targetId].runtime.hp.current).toBe(68);
  });

  it('does not reopen Cunning Strike for another hit after Sneak Attack was spent this turn', async () => {
    const first = await afterSneakAttack();
    const skipped = resolveTriggeredCombatAction(first.state, null, () => 0.6);
    const actor = skipped.world.actors[first.actorId];
    const ready = {
      ...skipped,
      world: {
        ...skipped.world,
        actors: {
          ...skipped.world.actors,
          [first.actorId]: {
            ...actor,
            runtime: {
              ...actor.runtime,
              resources: { ...actor.runtime.resources, action: 1 },
            },
          },
        },
      },
    };
    const second = executeCombatAction({
      state: ready,
      actorId: first.actorId,
      actionId: ATTACK_ID,
      targetIds: [first.targetId],
      rng: () => 0.6,
    });
    expect(second.pendingTriggeredAction).toBeUndefined();
    expect(second.world.actors[first.targetId].runtime.hp.current).toBe(22);
  });
});
