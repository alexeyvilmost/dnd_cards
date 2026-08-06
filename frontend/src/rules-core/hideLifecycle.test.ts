import { describe, expect, it } from 'vitest';
import { executeAction } from '../engine/execute';
import type { ActiveEffectEntry, RuntimeState } from '../mvp/contracts';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'hide-lifecycle@1',
  contentHash: 'sha256:hide-lifecycle',
  errataVersion: 'test-1',
};

const HIDE_TRIGGERS = [
  'noise_above_whisper',
  'enemy_finds_actor',
  'actor_makes_attack_roll',
  'actor_casts_spell_with_verbal_component',
] as const;

function invisible(): ActiveEffectEntry {
  return {
    id: 'hide-invisible',
    name: 'Invisible (Hide)',
    source: 'core.action.hide',
    expiry: 'manual',
    mechanics: {
      kind: 'condition',
      value: 'invisible',
      op: 'apply',
      hidden_end_triggers: [...HIDE_TRIGGERS],
    },
  };
}

function unrelated(): ActiveEffectEntry {
  return {
    id: 'unrelated',
    name: 'Unrelated effect',
    source: 'test',
    expiry: 'manual',
    mechanics: { kind: 'modifier', applies_to: { roll: 'saving_throw' }, op: 'add', value: '+1' },
  };
}

function actor(id: string, options: { hidden?: boolean; actionIds?: string[] } = {}): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `${id}-controller`,
    ac: 13,
    capabilities: { actionIds: options.actionIds ?? [] },
    character: {
      abilityMods: { str: 0, dex: 3, con: 1, int: 1, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1, spell_slot_1: 1 },
      equipment: {},
      inventory: [],
      activeEffects: options.hidden === false ? [unrelated()] : [invisible(), unrelated()],
    },
  };
}

const VERBAL: RuleActionDefinition = {
  id: 'spell.verbal',
  name: 'Verbal spell',
  kind: 'spell',
  sourceEntityIds: ['PHB:spell:verbal'],
  spell: {
    level: 1,
    sourceClass: 'CLASS-wizard',
    components: { verbal: true, somatic: true, material: false },
  },
  mechanics: {
    name: 'Verbal spell',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [],
  },
};

const NONVERBAL: RuleActionDefinition = {
  id: 'spell.nonverbal',
  name: 'Nonverbal spell',
  kind: 'spell',
  sourceEntityIds: ['PHB:spell:nonverbal'],
  spell: {
    level: 0,
    sourceClass: 'CLASS-wizard',
    components: { verbal: false, somatic: true, material: true },
  },
  mechanics: {
    name: 'Nonverbal spell',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [],
  },
};

const VERBAL_SAVE: RuleActionDefinition = {
  id: 'spell.verbal-save',
  name: 'Verbal save spell',
  kind: 'spell',
  sourceEntityIds: ['PHB:spell:verbal-save'],
  spell: {
    level: 1,
    sourceClass: 'CLASS-wizard',
    components: { verbal: true, somatic: false, material: false },
  },
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 30,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Verbal save spell',
    activation: {
      mode: 'active',
      cost: [{ resource: 'action' }, { resource: 'spell_slot_1' }],
    },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'wis',
      dc: '13',
      on_fail: [{ kind: 'condition', value: 'frightened', op: 'apply' }],
      on_success: [],
    }],
  },
};

const ACTIONS = [VERBAL, NONVERBAL, VERBAL_SAVE] as const;
const catalog: RulesCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
};
const noActions: RulesCatalog = { getAction: () => undefined };

function command<T extends GameCommand>(value: T): T {
  return value;
}

function enginePayloads(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload] : []
  ));
}

function session(initial: ReturnType<typeof createWorld>, rules = catalog) {
  return new InMemoryRulesSession(initial, rules, {
    rng: () => { throw new Error('this lifecycle step must not roll'); },
    clock: createLogicalClock(),
    nextId: createSequentialIdFactory('ignored-by-command-ids'),
  });
}

const enemyFacts = {
  factsSource: 'scenario' as const,
  boardRevision: 4,
  distanceFt: 20,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
};

describe('PHB 2024 Hide / Invisible lifecycle', () => {
  it('keeps Hide for a whisper, expires it for louder noise, and replays the audited facts', () => {
    const initial = createWorld({
      id: 'noise',
      ruleset: RULESET,
      actors: [actor('rogue'), actor('guard', { hidden: false })],
    });
    const rules = session(initial, noActions);

    const quiet = rules.dispatch(command({
      schemaVersion: 1,
      type: 'MakeNoise',
      commandId: 'noise-quiet',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      facts: { factsSource: 'board', boardRevision: 10, loudness: 'whisper_or_quieter' },
    }));
    expect(quiet.status).toBe('accepted');
    expect(rules.getState().actors.rogue.runtime.activeEffects.map(({ id }) => id)).toEqual([
      'hide-invisible', 'unrelated',
    ]);
    expect(enginePayloads(quiet.status === 'accepted' ? quiet.events : [])).toContainEqual(
      expect.objectContaining({
        actorId: 'rogue',
        facts: {
          observation: 'actor_makes_noise',
          trigger: 'noise_at_or_below_whisper',
          noise: { factsSource: 'board', boardRevision: 10, loudness: 'whisper_or_quieter' },
        },
      }),
    );

    const loud = rules.dispatch(command({
      schemaVersion: 1,
      type: 'MakeNoise',
      commandId: 'noise-loud',
      expectedRevision: 1,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'rogue',
      facts: { factsSource: 'gm_ruling', boardRevision: 11, loudness: 'above_whisper' },
    }));
    expect(loud.status).toBe('accepted');
    expect(rules.getState().actors.rogue.runtime.activeEffects.map(({ id }) => id)).toEqual(['unrelated']);
    expect(enginePayloads(loud.status === 'accepted' ? loud.events : [])).toContainEqual(
      expect.objectContaining({
        actorId: 'rogue',
        event: { type: 'effect_expired', name: 'Invisible (Hide)' },
        facts: expect.objectContaining({ trigger: 'noise_above_whisper' }),
      }),
    );

    const serializedInitial = JSON.parse(JSON.stringify(initial)) as typeof initial;
    const serializedEvents = JSON.parse(JSON.stringify([
      ...(quiet.status === 'accepted' ? quiet.events : []),
      ...(loud.status === 'accepted' ? loud.events : []),
    ])) as UncommittedRuleEvent[];
    expect(foldEvents(serializedInitial, serializedEvents)).toEqual(rules.getState());
  });

  it('expires Hide on an explicit enemy finding fact and rejects unproven findings atomically', () => {
    const initial = createWorld({
      id: 'finding',
      ruleset: RULESET,
      actors: [actor('guard', { hidden: false }), actor('rogue')],
    });
    const rules = session(initial, noActions);
    const found = rules.dispatch(command({
      schemaVersion: 1,
      type: 'FindHiddenActor',
      commandId: 'find-rogue',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'guard',
      targetActorId: 'rogue',
      facts: { factsSource: 'board', boardRevision: 12, relation: 'enemy', found: true },
    }));

    expect(found.status).toBe('accepted');
    expect(rules.getState().actors.rogue.runtime.activeEffects.map(({ id }) => id)).toEqual(['unrelated']);
    expect(rules.getState().actors.guard).toEqual(initial.actors.guard);
    expect(enginePayloads(found.status === 'accepted' ? found.events : [])).toContainEqual(
      expect.objectContaining({
        actorId: 'rogue',
        targetIds: ['rogue'],
        event: { type: 'effect_expired', name: 'Invisible (Hide)' },
        facts: {
          observation: 'enemy_finds_actor',
          targetActorId: 'rogue',
          finding: { factsSource: 'board', boardRevision: 12, relation: 'enemy', found: true },
        },
      }),
    );
    expect((found.status === 'accepted' ? found.events : []).find((entry) => (
      entry.payload.type === 'EngineEventRecorded'
      && entry.payload.event.type === 'effect_expired'
    ))?.sourceActorId).toBe('guard');

    const rejectedWorld = createWorld({
      id: 'finding-rejected',
      ruleset: RULESET,
      actors: [actor('guard', { hidden: false }), actor('rogue')],
    });
    const rejectedRules = session(rejectedWorld, noActions);
    const rejected = rejectedRules.dispatch({
      schemaVersion: 1,
      type: 'FindHiddenActor',
      commandId: 'not-an-enemy',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'guard',
      targetActorId: 'rogue',
      facts: { factsSource: 'scenario', boardRevision: 1, relation: 'ally', found: true },
    } as unknown as GameCommand);
    expect(rejected).toMatchObject({ status: 'rejected', code: 'IllegalRelation' });
    expect(rejectedRules.getState()).toBe(rejectedWorld);
    expect(rejectedRules.getEvents()).toEqual([]);
    expect(rejectedWorld.actors.rogue.runtime.activeEffects.map(({ id }) => id)).toContain('hide-invisible');
  });

  it('uses catalog V/S/M metadata: verbal spells end Hide, nonverbal and rejected spells do not', () => {
    const verbalWorld = createWorld({
      id: 'verbal',
      ruleset: RULESET,
      actors: [actor('wizard', { actionIds: [VERBAL.id] }), actor('guard', { hidden: false })],
    });
    const verbalRules = session(verbalWorld);
    const cast = verbalRules.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'cast-verbal',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: VERBAL.id,
      targetIds: [],
      spell: { baseLevel: 1 },
    }));
    expect(cast.status).toBe('accepted');
    expect(verbalRules.getState().actors.wizard.runtime.activeEffects.map(({ id }) => id)).toEqual(['unrelated']);
    expect(enginePayloads(cast.status === 'accepted' ? cast.events : []).map(({ event }) => event)).toContainEqual({
      type: 'effect_expired', name: 'Invisible (Hide)',
    });
    expect(cast.status === 'accepted' ? cast.events : []).toContainEqual(expect.objectContaining({
      payload: expect.objectContaining({
        type: 'ActionDeclared',
        actionId: VERBAL.id,
        spell: {
          baseLevel: 1,
          castLevel: 1,
          sourceClass: 'CLASS-wizard',
          components: { verbal: true, somatic: true, material: false },
        },
      }),
    }));

    const nonverbalWorld = createWorld({
      id: 'nonverbal',
      ruleset: RULESET,
      actors: [actor('wizard', { actionIds: [NONVERBAL.id] }), actor('guard', { hidden: false })],
    });
    const nonverbalRules = session(nonverbalWorld);
    const silentCast = nonverbalRules.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'cast-nonverbal',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: NONVERBAL.id,
      targetIds: [],
      spell: { baseLevel: 0 },
    }));
    expect(silentCast.status).toBe('accepted');
    expect(nonverbalRules.getState().actors.wizard.runtime.activeEffects.map(({ id }) => id)).toContain('hide-invisible');
    expect(enginePayloads(silentCast.status === 'accepted' ? silentCast.events : []).map(({ event }) => event))
      .not.toContainEqual(expect.objectContaining({ type: 'effect_expired' }));

    const rejectedWorld = createWorld({
      id: 'verbal-rejected',
      ruleset: RULESET,
      actors: [actor('wizard', { actionIds: [NONVERBAL.id] }), actor('guard', { hidden: false })],
    });
    const rejectedRules = session(rejectedWorld);
    const rejected = rejectedRules.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'cast-unowned-verbal',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: VERBAL.id,
      targetIds: [],
      spell: { baseLevel: 1 },
    }));
    expect(rejected).toMatchObject({ status: 'rejected', code: 'ActionNotGranted' });
    expect(rejectedRules.getState()).toBe(rejectedWorld);
    expect(rejectedRules.getEvents()).toEqual([]);
    expect(rejectedWorld.actors.wizard.runtime.activeEffects.map(({ id }) => id)).toContain('hide-invisible');
  });

  it('ends Hide when an accepted verbal save spell opens its persisted decision window', () => {
    const initial = createWorld({
      id: 'verbal-save',
      ruleset: RULESET,
      actors: [
        actor('wizard', { actionIds: [VERBAL_SAVE.id] }),
        actor('guard', { hidden: false }),
      ],
    });
    const rules = session(initial);
    const opened = rules.dispatch(command({
      schemaVersion: 1,
      type: 'UseAction',
      commandId: 'cast-verbal-save',
      expectedRevision: 0,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      actionId: VERBAL_SAVE.id,
      targetIds: ['guard'],
      factsByTarget: { guard: enemyFacts },
      spell: { baseLevel: 1 },
    }));

    expect(opened.status).toBe('accepted');
    expect(rules.getState().pendingResolution).toMatchObject({
      type: 'target_save',
      sourceActorId: 'wizard',
      targetActorId: 'guard',
      spell: {
        baseLevel: 1,
        castLevel: 1,
        sourceClass: 'CLASS-wizard',
        components: { verbal: true, somatic: false, material: false },
      },
    });
    expect(rules.getState().actors.wizard.runtime.activeEffects.map(({ id }) => id)).toEqual(['unrelated']);
    expect(rules.getState().actors.guard.runtime).toEqual(initial.actors.guard.runtime);
    expect(enginePayloads(opened.status === 'accepted' ? opened.events : []).map(({ event }) => event)).toContainEqual({
      type: 'effect_expired', name: 'Invisible (Hide)',
    });

    const persisted = JSON.parse(JSON.stringify(rules.getState())) as typeof initial;
    expect(persisted).toEqual(rules.getState());
    const replayed = foldEvents(
      JSON.parse(JSON.stringify(initial)) as typeof initial,
      JSON.parse(JSON.stringify(opened.status === 'accepted' ? opened.events : [])) as UncommittedRuleEvent[],
    );
    expect(replayed).toEqual(persisted);
  });

  it('applies Invisible to the first attack roll, then removes it before a second attack in one action', () => {
    const state: RuntimeState = actor('rogue').runtime;
    const values = [18, 4, 12];
    let cursor = 0;
    const result = executeAction(state, {
      name: 'Two attacks',
      activation: { mode: 'active', cost: [] },
      effects: [
        { resolution: 'attack_roll', ability: 'dex', on_hit: [] },
        { resolution: 'attack_roll', ability: 'dex', on_hit: [] },
      ],
    }, {
      character: actor('rogue').character,
      selfId: 'rogue',
      target: { id: 'guard', ac: 30, runtimeState: actor('guard', { hidden: false }).runtime },
      conditionRelationFacts: {
        visibility: { guard: { rogue: false } },
      },
      rng: () => {
        const value = values[cursor++];
        return (value - 0.5) / 20;
      },
    });
    const attacks = result.events.flatMap((event) => (
      event.type === 'roll' && event.roll.kind === 'd20' ? [event.roll] : []
    ));

    expect(cursor).toBe(3);
    expect(attacks.map(({ advantage }) => advantage)).toEqual(['advantage', 'none']);
    expect(result.state.activeEffects.map(({ id }) => id)).toEqual(['unrelated']);
    expect(result.events).toContainEqual({ type: 'effect_expired', name: 'Invisible (Hide)' });
  });
});
