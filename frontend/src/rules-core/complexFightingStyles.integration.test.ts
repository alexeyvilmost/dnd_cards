import { describe, expect, it } from 'vitest';
import definitions from '../../../scripts/content/data/mini-mvp-complex-fighting-styles.v1.json';
import { CARD_LONGSWORD } from '../mvp/fixtures';
import type { EngineEvent } from '../mvp/contracts';
import type {
  ActorState,
  CommandResult,
  RuleActionDefinition,
  RulesCatalog,
  SpatialFacts,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { InMemoryRulesSession } from './session';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'complex-fighting-styles-test',
  contentHash: 'sha256:complex-fighting-styles-test',
  errataVersion: '2024-test',
};
const FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 5,
  lineOfSight: true, cover: 'none', relation: 'enemy',
};
const catalog: RulesCatalog = { getAction: () => undefined };
const unarmedMechanics = definitions.find((definition) => definition.card_number === 'fs_unarmed')!.mechanics;
const catalogUnarmed: RuleActionDefinition = {
  id: 'catalog:unarmed',
  name: 'Unarmed Strike',
  kind: 'nonSpell',
  sourceEntityIds: ['action:catalog-unarmed'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    targeting: {
      domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1,
      max_targets: 1, range_ft: 5, requires_line_of_sight: true,
      allowed_relations: ['enemy'],
    },
    effects: [{
      ability: 'str', attack_kind: 'unarmed', resolution: 'attack_roll', vs: 'ac',
      on_hit: [{ amount: '1 + str', kind: 'damage', type: 'bludgeoning' }],
    }],
  },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
};

function accepted(result: CommandResult) {
  if (result.status !== 'accepted') throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function actor(id: string, input: { passives?: Record<string, unknown>[]; weapon?: boolean } = {}): ActorState {
  const weapon = input.weapon ? CARD_LONGSWORD : null;
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}:controller`,
    ac: 10,
    capabilities: { actionIds: [] },
    character: {
      abilityScores: { str: 16, dex: 10, con: 12, int: 10, wis: 10, cha: 10 },
      abilityMods: { str: 3, dex: 0, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
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
    passives: input.passives,
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'],
      sourceEntityIds: ['class:test:attack-profile'],
    },
  };
}

function engineEvents(events: readonly UncommittedRuleEvent[]): EngineEvent[] {
  return events.flatMap((event) => (
    event.payload.type === 'EngineEventRecorded' ? [event.payload.event] : []
  ));
}

function attackSession(input: {
  style: boolean;
  weapon: boolean;
  passives?: Record<string, unknown>[];
  variables?: ActorState['character']['variables'];
  abilityMods?: ActorState['character']['abilityMods'];
}) {
  const attacker = actor('attacker', {
    passives: input.passives ?? (input.style ? [unarmedMechanics] : []),
    weapon: input.weapon,
  });
  attacker.character.variables = input.variables;
  if (input.abilityMods) attacker.character.abilityMods = input.abilityMods;
  const target = actor('target');
  const world = createWorld({ id: 'unarmed-style', ruleset: RULESET, actors: [attacker, target] });
  const rolls = [0.5, 0.999];
  let index = 0;
  let nextId = 0;
  const session = new InMemoryRulesSession(world, catalog, {
    rng: () => rolls[Math.min(index++, rolls.length - 1)],
    clock: () => 42_000,
    nextId: () => `id:${nextId++}`,
  });
  accepted(session.dispatch({
    schemaVersion: 1, type: 'StartEncounter', commandId: 'encounter', expectedRevision: 0,
    rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
    initiative: [attacker.id, target.id],
  }));
  accepted(session.dispatch({
    schemaVersion: 1, type: 'StartTurn', commandId: 'turn',
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
  }));
  accepted(session.dispatch({
    schemaVersion: 1, type: 'BeginAttackAction', commandId: 'begin',
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
  }));
  const attackAction = Object.values(session.getState().attackActions)[0];
  const result = accepted(session.dispatch({
    schemaVersion: 1, type: 'PerformUnarmedStrike', commandId: 'strike',
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
    attackActionId: attackAction.id, option: 'damage', targetActorId: target.id, facts: FACTS,
  }));
  return { session, result };
}

describe('complex Fighting Styles in the canonical RulesSession', () => {
  it('applies the profile to a data-owned catalog Unarmed Strike used by sheet and solo combat', () => {
    const attacker = actor('attacker', { passives: [unarmedMechanics] });
    attacker.capabilities.actionIds = [catalogUnarmed.id];
    const target = actor('target');
    const world = createWorld({ id: 'catalog-unarmed-style', ruleset: RULESET, actors: [attacker, target] });
    const actionCatalog: RulesCatalog = {
      getAction: (id) => id === catalogUnarmed.id ? catalogUnarmed : undefined,
    };
    const rolls = [0.5, 0.999];
    let rollIndex = 0;
    let nextId = 0;
    const session = new InMemoryRulesSession(world, actionCatalog, {
      rng: () => rolls[Math.min(rollIndex++, rolls.length - 1)],
      clock: () => 42_000,
      nextId: () => `catalog-id:${nextId++}`,
    });
    accepted(session.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'encounter', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
      initiative: [attacker.id, target.id],
    }));
    accepted(session.dispatch({
      schemaVersion: 1, type: 'StartTurn', commandId: 'turn',
      expectedRevision: session.getState().revision,
      rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
    }));
    const result = accepted(session.dispatch({
      schemaVersion: 1, type: 'UseAction', commandId: 'strike',
      expectedRevision: session.getState().revision,
      rulesetContentHash: RULESET.contentHash, actorId: attacker.id,
      actionId: catalogUnarmed.id, targetIds: [target.id], factsByTarget: { [target.id]: FACTS },
    }));

    expect(session.getState().actors.target.runtime.hp.current).toBe(19);
    expect(engineEvents(result.events).filter((event) => event.type === 'damage'))
      .toEqual([expect.objectContaining({ amount: 11, damageType: 'bludgeoning' })]);
  });

  it('uses d8 with empty hands, d6 while holding a weapon, and the core flat damage without the style', () => {
    const emptyHands = attackSession({ style: true, weapon: false });
    const armed = attackSession({ style: true, weapon: true });
    const baseline = attackSession({ style: false, weapon: false });
    expect(emptyHands.session.getState().actors.target.runtime.hp.current).toBe(19);
    expect(armed.session.getState().actors.target.runtime.hp.current).toBe(21);
    expect(baseline.session.getState().actors.target.runtime.hp.current).toBe(26);
    expect(engineEvents(emptyHands.result.events).filter((event) => event.type === 'damage'))
      .toEqual([expect.objectContaining({ amount: 11, damageType: 'bludgeoning' })]);
  });

  it('resolves the Monk variable die and uses the better Dexterity modifier in a system strike', () => {
    const martialArts = {
      activation: { mode: 'passive' },
      effects: [{ resolution: 'auto', result: [{
        kind: 'unarmed_damage_profile',
        dice: 'martial_arts_die',
        ability_options: ['str', 'dex'],
        damage_type: 'bludgeoning',
        requires_unarmored: true,
        source: 'Martial Arts',
      }] }],
    };
    const monk = attackSession({
      style: false,
      weapon: false,
      passives: [martialArts],
      variables: { martial_arts_die: { count: 1, sides: 8 } },
      abilityMods: { str: 1, dex: 4, con: 0, int: 0, wis: 3, cha: 0 },
    });

    expect(monk.session.getState().actors.target.runtime.hp.current).toBe(18);
    expect(engineEvents(monk.result.events).filter((event) => event.type === 'damage'))
      .toEqual([expect.objectContaining({ amount: 12, damageType: 'bludgeoning' })]);
  });

  it('applies the selected d4 at StartTurn only to a persisted grapple target', () => {
    const fighter = actor('fighter', { passives: [unarmedMechanics] });
    const goblin = actor('goblin');
    const world = createWorld({ id: 'grapple-style', ruleset: RULESET, actors: [fighter, goblin] });
    world.grapples['grapple:1'] = {
      id: 'grapple:1', grapplerActorId: fighter.id, targetActorId: goblin.id,
      sourcePart: 'main_hand', escapeDc: 13, reachFt: 5,
      sourceEntityIds: ['system:dnd5e-2024:unarmed-strike:grapple'], startedAtRevision: 0,
    };
    let nextId = 0;
    const session = new InMemoryRulesSession(world, catalog, {
      rng: () => 0.999,
      clock: () => 42_000,
      nextId: () => `id:${nextId++}`,
    });
    accepted(session.dispatch({
      schemaVersion: 1, type: 'StartEncounter', commandId: 'encounter', expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash, actorId: fighter.id,
      initiative: [fighter.id, goblin.id],
    }));
    const result = accepted(session.dispatch({
      schemaVersion: 1, type: 'StartTurn', commandId: 'turn',
      expectedRevision: session.getState().revision,
      rulesetContentHash: RULESET.contentHash, actorId: fighter.id,
      turnStartChoices: [{
        capabilityId: 'fighting_style.unarmed.turn_start_grapple_damage',
        targetActorId: goblin.id,
      }],
    }));
    expect(session.getState().actors.goblin.runtime.hp.current).toBe(26);
    expect(engineEvents(result.events)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'damage', amount: 4, damageType: 'bludgeoning' }),
    ]));
  });
});
