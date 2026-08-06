import { describe, expect, it } from 'vitest';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { executeAction } from '../engine/execute';
import { collectModifiers, conditionCapabilityDenied, foldModifiers } from '../engine/modifiers';
import { activeConditionsOf } from '../engine/circumstances';
import {
  activeConditionWorldFactEnabled,
  activeConditionWorldFactValues,
  conditionLeaves,
  conditionLevel,
} from '../engine/conditions';
import { longRest } from '../engine/turn';
import { createWorld, type ActorState, type WorldState } from './domain';
import {
  conditionEvalContext,
  conditionInteractionDenied,
  conditionTargetingSightIssue,
  projectConditionRules,
  terminalConditionFacts,
} from './conditionsRuntime';
import {
  PHB_2024_CONDITION_EVIDENCE,
  PHB_2024_CONDITION_OBLIGATIONS,
  PHB_2024_CONDITION_OBLIGATION_CARDINALITY,
  validatePhb2024ConditionEvidenceContract,
  type Phb2024ConditionObligationEvidence,
} from './coverage/phb2024ConditionEvidence';

type Dict = Record<string, unknown>;

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'conditions-2024@1',
  contentHash: 'sha256:conditions-2024',
  errataVersion: 'phb-2024',
};

const CHARACTER: CharacterContext = {
  abilityMods: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: 2 },
  profBonus: 2,
  level: 1,
};

function runtime(): RuntimeState {
  return {
    hp: { current: 30, max: 30, temp: 0 },
    resources: { action: 1, bonus_action: 1, reaction: 1 },
    maxResources: { action: 1, bonus_action: 1, reaction: 1 },
    equipment: {}, inventory: [], activeEffects: [],
  };
}

function actor(id: string): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 12,
    capabilities: { actionIds: [] },
    character: { ...CHARACTER },
    runtime: runtime(),
  };
}

function world(): WorldState {
  return createWorld({ id: 'conditions:two-pc', ruleset: RULESET, actors: [actor('source'), actor('subject')] });
}

function runTargetPayload(worldBefore: WorldState, payload: Dict): {
  world: WorldState;
  events: ReturnType<typeof executeAction>['events'];
} {
  const source = worldBefore.actors.source;
  const subject = worldBefore.actors.subject;
  let id = 0;
  const result = executeAction(source.runtime, {
    name: 'Condition acceptance action',
    activation: { mode: 'active', cost: [] },
    effects: [{ resolution: 'auto', who: 'target', result: [payload] }],
  }, {
    character: source.character,
    selfRuntime: source.runtime,
    selfId: source.id,
    rng: () => 0.5,
    nextId: () => `condition-runtime:${++id}`,
    target: {
      id: subject.id,
      ac: subject.ac,
      characterContext: subject.character,
      runtimeState: subject.runtime,
      conditionImmunities: subject.traits?.conditionImmunities,
    },
  });
  if (!result.targetState) throw new Error('Condition scenario did not mutate the target actor');
  return {
    world: {
      ...worldBefore,
      actors: {
        ...worldBefore.actors,
        subject: { ...subject, runtime: result.targetState },
      },
    },
    events: result.events,
  };
}

function applyCondition(worldBefore: WorldState, condition: string): WorldState {
  return runTargetPayload(worldBefore, { kind: 'condition', value: condition, op: 'apply' }).world;
}

function selfCollect(
  scenario: WorldState,
  roll: string,
  filter?: Record<string, unknown>,
  lineOfSight = true,
  canSourceSeeSubject = false,
  rollTargetActorId = 'source',
) {
  const subject = scenario.actors.subject;
  return collectModifiers(subject.runtime, subject.passives ?? [], {
    roll,
    ...(filter ? { filter } : {}),
    evalCtx: conditionEvalContext({
      rollerActorId: subject.id,
      rollTargetActorId,
      sourceObservations: [{
        sourceActorId: 'source', lineOfSight,
        factsSource: 'scenario', boardRevision: scenario.revision,
      }],
      visibilityObservations: [{
        observerActorId: 'source', observedActorId: 'subject',
        canSee: canSourceSeeSubject,
        factsSource: 'scenario', boardRevision: scenario.revision,
      }],
    }),
  });
}

type ConditionEvidenceMode = 'unit' | 'two-PC';

function addDirectCondition(worldBefore: WorldState, conditionId: string): WorldState {
  const subject = worldBefore.actors.subject;
  const nextIndex = subject.runtime.activeEffects.length + 1;
  return {
    ...worldBefore,
    actors: {
      ...worldBefore.actors,
      subject: {
        ...subject,
        runtime: {
          ...subject.runtime,
          activeEffects: [...subject.runtime.activeEffects, {
            id: `unit-condition:${conditionId}:${nextIndex}`,
            name: conditionId,
            mechanics: { kind: 'condition', value: conditionId, op: 'apply' },
            source: 'unit-condition-evidence',
            sourceId: 'source',
          }],
        },
      },
    },
  };
}

function addConditionForEvidence(
  worldBefore: WorldState,
  conditionId: string,
  mode: ConditionEvidenceMode,
): WorldState {
  return mode === 'two-PC'
    ? applyCondition(worldBefore, conditionId)
    : addDirectCondition(worldBefore, conditionId);
}

function verifyConditionClause(
  mode: ConditionEvidenceMode,
  evidence: Phb2024ConditionObligationEvidence,
): void {
  const { conditionId, clauseId } = evidence;
  let scenario = addConditionForEvidence(world(), conditionId, mode);
  const subject = scenario.actors.subject;
  expect(activeConditionsOf(subject.runtime).has(conditionId)).toBe(true);
  const projectionAt = (distanceFt: number, canSourceSeeSubject = false) => projectConditionRules({
    world: scenario,
    rollerActorId: 'source', targetActorId: 'subject',
    roll: 'attack',
    distanceObservations: [{
      actorAId: 'source', actorBId: 'subject', distanceFt,
      factsSource: 'scenario', boardRevision: scenario.revision,
    }],
    visibilityObservations: [{
      observerActorId: 'source', observedActorId: 'subject',
      canSee: canSourceSeeSubject,
      factsSource: 'scenario', boardRevision: scenario.revision,
    }],
  });

  const levels = (count: number): WorldState => {
    let result = scenario;
    for (let level = 1; level < count; level += 1) {
      result = addConditionForEvidence(result, conditionId, mode);
    }
    return result;
  };

  switch (`${conditionId}.${clauseId}`) {
    case 'blinded.cannot_see':
      expect(activeConditionWorldFactEnabled(subject.runtime, 'cannot_see')).toBe(true);
      break;
    case 'blinded.sight_check_auto_fail':
      expect(selfCollect(scenario, 'ability_check', { sense: 'sight' }).autoFail).toBe(true);
      break;
    case 'blinded.own_attack_disadvantage':
      expect(selfCollect(scenario, 'attack').advantage).toBe('disadvantage');
      break;
    case 'blinded.incoming_attack_advantage':
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'charmed.source_scoped_harm_denial':
      expect(conditionInteractionDenied({
        world: scenario, actorId: 'subject', targetActorId: 'source', capability: 'harm',
      })).toBe(true);
      expect(conditionInteractionDenied({
        world: scenario, actorId: 'subject', targetActorId: 'subject', capability: 'harm',
      })).toBe(false);
      break;
    case 'charmed.source_social_advantage':
      expect(projectConditionRules({
        world: scenario, rollerActorId: 'source', targetActorId: 'subject',
        roll: 'ability_check', filter: { interaction: 'social' },
      }).advantage).toBe('advantage');
      break;
    case 'deafened.hearing_check_auto_fail':
      expect(selfCollect(scenario, 'ability_check', { sense: 'hearing' }).autoFail).toBe(true);
      break;
    case 'exhaustion.level_stacking':
      expect(conditionLevel(levels(3).actors.subject.runtime, conditionId)).toBe(3);
      break;
    case 'exhaustion.d20_minus_2_per_level': {
      const exhausted = levels(3);
      expect(selfCollect(exhausted, 'saving_throw', { ability: 'wis' }).modifiers
        .map(({ value }) => value)).toEqual([-2, -2, -2]);
      break;
    }
    case 'exhaustion.speed_minus_5_per_level': {
      const exhausted = levels(3);
      expect(foldModifiers(30, selfCollect(exhausted, 'speed')).value).toBe(15);
      break;
    }
    case 'exhaustion.long_rest_minus_one': {
      const exhausted = levels(3);
      const rested = longRest(exhausted.actors.subject.runtime, CHARACTER).state;
      expect(conditionLevel(rested, conditionId)).toBe(2);
      break;
    }
    case 'exhaustion.level_6_death': {
      const exhausted = levels(6);
      expect(terminalConditionFacts(exhausted)).toContainEqual({
        actorId: 'subject', condition: 'exhaustion', level: 6, outcome: 'death',
      });
      break;
    }
    case 'frightened.source_los_attack_disadvantage':
      expect(selfCollect(scenario, 'attack', undefined, true).advantage).toBe('disadvantage');
      expect(selfCollect(scenario, 'attack', undefined, false).advantage).toBe('none');
      break;
    case 'frightened.source_los_check_disadvantage':
      expect(selfCollect(scenario, 'ability_check', undefined, true).advantage).toBe('disadvantage');
      expect(selfCollect(scenario, 'ability_check', undefined, false).advantage).toBe('none');
      break;
    case 'frightened.cannot_approach_source_even_without_los':
      expect(conditionInteractionDenied({
        world: scenario, actorId: 'subject', targetActorId: 'source',
        capability: 'movement_toward_condition_source',
        sourceObservations: [{
          sourceActorId: 'source', lineOfSight: false,
          factsSource: 'scenario', boardRevision: scenario.revision,
        }],
      })).toBe(true);
      break;
    case 'grappled.speed_zero':
      expect(foldModifiers(30, selfCollect(scenario, 'speed')).value).toBe(0);
      break;
    case 'grappled.attack_disadvantage_except_grappler':
      expect(selfCollect(scenario, 'attack').advantage).toBe('none');
      expect(selfCollect(scenario, 'attack', undefined, true, false, 'other').advantage)
        .toBe('disadvantage');
      break;
    case 'incapacitated.deny_action_bonus_reaction_concentration_and_speech':
      for (const capability of ['action', 'bonus_action', 'reaction', 'concentration', 'speech']) {
        expect(conditionCapabilityDenied(subject.runtime, capability, {
          rollerActorId: subject.id,
        })).toBe(true);
      }
      break;
    case 'incapacitated.initiative_disadvantage':
      expect(selfCollect(scenario, 'initiative').advantage).toBe('disadvantage');
      break;
    case 'invisible.own_attack_advantage_unless_seen':
      expect(selfCollect(scenario, 'attack').advantage).toBe('advantage');
      expect(selfCollect(scenario, 'attack', undefined, true, true).advantage).toBe('none');
      break;
    case 'invisible.incoming_attack_disadvantage_unless_seen':
      expect(projectionAt(5).advantage).toBe('disadvantage');
      expect(projectionAt(5, true).advantage).toBe('none');
      break;
    case 'invisible.initiative_advantage':
      expect(selfCollect(scenario, 'initiative').advantage).toBe('advantage');
      break;
    case 'invisible.requires_sight_targeting_world_fact':
      expect(conditionTargetingSightIssue({
        world: scenario, sourceActorId: 'source', targetActorId: 'subject',
        requiresSight: true, canSeeTarget: false,
      })).toBe('target_unseen');
      expect(conditionTargetingSightIssue({
        world: scenario, sourceActorId: 'source', targetActorId: 'subject',
        requiresSight: true, canSeeTarget: true,
      })).toBeNull();
      break;
    case 'paralyzed.includes_incapacitated':
      expect(activeConditionsOf(subject.runtime).has('incapacitated')).toBe(true);
      break;
    case 'paralyzed.speed_zero':
      expect(foldModifiers(30, selfCollect(scenario, 'speed')).value).toBe(0);
      break;
    case 'paralyzed.str_dex_auto_fail':
      expect(selfCollect(scenario, 'saving_throw', { ability: 'str' }).autoFail).toBe(true);
      expect(selfCollect(scenario, 'saving_throw', { ability: 'dex' }).autoFail).toBe(true);
      break;
    case 'paralyzed.incoming_advantage':
      expect(projectionAt(10).advantage).toBe('advantage');
      break;
    case 'paralyzed.within_5ft_auto_crit':
      expect(projectionAt(5).autoCrit).toBe(true);
      expect(projectionAt(10).autoCrit).toBe(false);
      break;
    case 'petrified.includes_incapacitated':
      expect(activeConditionsOf(subject.runtime).has('incapacitated')).toBe(true);
      break;
    case 'petrified.speed_zero':
      expect(foldModifiers(30, selfCollect(scenario, 'speed')).value).toBe(0);
      break;
    case 'petrified.str_dex_auto_fail':
      expect(selfCollect(scenario, 'saving_throw', { ability: 'str' }).autoFail).toBe(true);
      expect(selfCollect(scenario, 'saving_throw', { ability: 'dex' }).autoFail).toBe(true);
      break;
    case 'petrified.incoming_advantage':
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'petrified.all_damage_resistance': {
      const damaged = runTargetPayload(scenario, { kind: 'damage', amount: '8', type: 'fire' });
      expect(damaged.world.actors.subject.runtime.hp.current).toBe(26);
      break;
    }
    case 'petrified.poisoned_immunity': {
      const poisoned = runTargetPayload(scenario, {
        kind: 'condition', value: 'poisoned', op: 'apply',
      });
      expect(activeConditionsOf(poisoned.world.actors.subject.runtime).has('poisoned')).toBe(false);
      expect(poisoned.events).toContainEqual(expect.objectContaining({
        type: 'condition_immune', condition: 'poisoned',
      }));
      break;
    }
    case 'poisoned.own_attack_disadvantage':
      expect(selfCollect(scenario, 'attack').advantage).toBe('disadvantage');
      break;
    case 'poisoned.ability_check_disadvantage':
      expect(selfCollect(scenario, 'ability_check', { ability: 'wis' }).advantage).toBe('disadvantage');
      break;
    case 'prone.own_attack_disadvantage':
      expect(selfCollect(scenario, 'attack').advantage).toBe('disadvantage');
      break;
    case 'prone.incoming_within_5ft_advantage':
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'prone.incoming_beyond_5ft_disadvantage':
      expect(projectConditionRules({
        world: scenario, rollerActorId: 'source', targetActorId: 'subject',
        roll: 'attack',
        distanceObservations: [{
          actorAId: 'source', actorBId: 'subject', distanceFt: 10,
          factsSource: 'scenario', boardRevision: scenario.revision,
        }],
      }).advantage).toBe('disadvantage');
      break;
    case 'prone.stand_cost_world_fact':
      expect(activeConditionWorldFactValues(subject.runtime, 'stand_cost')).toEqual(['half_speed']);
      break;
    case 'restrained.speed_zero':
      expect(foldModifiers(30, selfCollect(scenario, 'speed')).value).toBe(0);
      break;
    case 'restrained.own_attack_disadvantage':
      expect(selfCollect(scenario, 'attack').advantage).toBe('disadvantage');
      break;
    case 'restrained.dex_save_disadvantage':
      expect(selfCollect(scenario, 'saving_throw', { ability: 'dex' }).advantage).toBe('disadvantage');
      break;
    case 'restrained.incoming_attack_advantage':
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'stunned.includes_incapacitated':
      expect(activeConditionsOf(subject.runtime).has('incapacitated')).toBe(true);
      break;
    case 'stunned.str_dex_auto_fail':
      expect(selfCollect(scenario, 'saving_throw', { ability: 'str' }).autoFail).toBe(true);
      expect(selfCollect(scenario, 'saving_throw', { ability: 'dex' }).autoFail).toBe(true);
      break;
    case 'stunned.incoming_attack_advantage':
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'unconscious.includes_incapacitated_and_prone_not_paralyzed': {
      const active = activeConditionsOf(subject.runtime);
      expect(active.has('incapacitated')).toBe(true);
      expect(active.has('prone')).toBe(true);
      expect(active.has('paralyzed')).toBe(false);
      break;
    }
    case 'unconscious.speed_zero':
      expect(foldModifiers(30, selfCollect(scenario, 'speed')).value).toBe(0);
      break;
    case 'unconscious.str_dex_auto_fail':
      expect(selfCollect(scenario, 'saving_throw', { ability: 'str' }).autoFail).toBe(true);
      expect(selfCollect(scenario, 'saving_throw', { ability: 'dex' }).autoFail).toBe(true);
      break;
    case 'unconscious.incoming_advantage':
      expect(projectionAt(10).advantage).toBe('none');
      expect(projectionAt(5).advantage).toBe('advantage');
      break;
    case 'unconscious.within_5ft_auto_crit':
      expect(projectionAt(5).autoCrit).toBe(true);
      expect(projectionAt(10).autoCrit).toBe(false);
      break;
    case 'unconscious.leaves_prone':
      if (mode === 'unit') {
        expect(conditionLeaves('unconscious')).toEqual(['prone']);
      } else {
        scenario = runTargetPayload(scenario, {
          kind: 'condition', value: 'unconscious', op: 'remove',
        }).world;
        expect(activeConditionsOf(scenario.actors.subject.runtime).has('unconscious')).toBe(false);
        expect(activeConditionsOf(scenario.actors.subject.runtime).has('prone')).toBe(true);
      }
      break;
    case 'unconscious.drops_held_items_world_fact':
      expect(activeConditionWorldFactEnabled(subject.runtime, 'drops_held_items')).toBe(true);
      break;
    case 'unconscious.unaware_of_surroundings_world_fact':
      expect(activeConditionWorldFactEnabled(subject.runtime, 'unaware_of_surroundings')).toBe(true);
      break;
    default:
      throw new Error(`Missing atomic verifier for ${evidence.obligationId}`);
  }
}

describe('PHB 2024 conditions — atomic mandatory evidence', () => {
  it('pins the exact 15-condition and 55-clause denominator', () => {
    expect(() => validatePhb2024ConditionEvidenceContract()).not.toThrow();
    expect(PHB_2024_CONDITION_EVIDENCE).toHaveLength(15);
    expect(new Set(PHB_2024_CONDITION_EVIDENCE.map((entry) => entry.conditionId)).size).toBe(15);
    expect(PHB_2024_CONDITION_OBLIGATIONS)
      .toHaveLength(PHB_2024_CONDITION_OBLIGATION_CARDINALITY);
  });

  it.each(PHB_2024_CONDITION_OBLIGATIONS.map((item) => [item.obligationId, item] as const))(
    'unit %s',
    (_obligationId, item) => verifyConditionClause('unit', item),
  );

  it.each(PHB_2024_CONDITION_OBLIGATIONS.map((item) => [item.obligationId, item] as const))(
    'two-PC %s',
    (_obligationId, item) => verifyConditionClause('two-PC', item),
  );
});
