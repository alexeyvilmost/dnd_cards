import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import type {
  ActorState,
  GameCommand,
  RuleActionDefinition,
  RulesCatalog,
  UncommittedRuleEvent,
  WorldState,
} from './domain';
import { createWorld } from './domain';
import { createLogicalClock, createSequentialIdFactory, createStrictRngTape } from './determinism';
import { foldEvents } from './reducer';
import { InMemoryRulesSession } from './session';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'mastery-continuation@1',
  contentHash: 'sha256:mastery-continuation',
  errataVersion: 'test-1',
};

const TOPPLE_ID = 'EFFECT-2024-TOPPLE';
const LONGSWORD = withDeclaredTestWeaponProfile({
  id: 'ITEM-2024-LONGSWORD',
  name: 'Longsword',
  type: 'weapon',
  weapon_type: 'longsword',
  bonus_value: '1d8',
  damage_type: 'slashing',
  mastery: TOPPLE_ID,
} as unknown as Card, {
  weaponType: 'longsword',
  proficiencyCategory: 'martial',
  attackAbility: 'str',
  damageLines: [{ dice: '1d8', type: 'slashing' }],
  defaultAttackMode: 'melee',
  attackModes: [{ kind: 'melee', reach_ft: 5 }],
  properties: [],
  masteryEffectId: TOPPLE_ID,
});

const TOPPLE = {
  name: 'Topple',
  mechanics: {
    activation: { mode: 'triggered', trigger: { event: 'hit' } },
    effects: [{
      resolution: 'save',
      who: 'target',
      ability: 'con',
      dc: '8 + prof + weapon_mod',
      on_fail: [{ kind: 'condition', value: 'prone', op: 'apply' }],
      on_success: [],
    }],
  },
};

const ATTACK: RuleActionDefinition = {
  id: 'action.weapon-attack',
  name: 'Weapon Attack',
  kind: 'nonSpell',
  sourceEntityIds: ['ACTION-2024-ATTACK'],
  targeting: {
    minTargets: 1,
    maxTargets: 1,
    rangeFt: 5,
    requiresLineOfSight: true,
    allowedRelations: ['enemy'],
  },
  mechanics: {
    name: 'Weapon Attack',
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'attack_roll',
      ability: 'str',
      on_hit: [{ kind: 'damage', dice: 'weapon', type: 'weapon' }],
    }],
  },
};

const SHIELD: RuleActionDefinition = {
  id: 'spell.shield',
  name: 'Shield',
  kind: 'spell',
  sourceEntityIds: ['SPELL-2024-SHIELD'],
  spell: { level: 1, sourceClass: 'CLASS-wizard' },
  mechanics: {
    name: 'Shield',
    activation: {
      mode: 'reaction',
      trigger: { event: 'hit_by_attack' },
      cost: [{ resource: 'reaction' }, { resource: 'spell_slot_1' }],
    },
    effects: [{
      resolution: 'auto',
      result: [{
        kind: 'modifier', applies_to: { roll: 'ac' }, op: 'add', value: '+5',
        duration: { type: 'until_start_of_next_turn' },
      }],
    }],
  },
};

const catalog: RulesCatalog = {
  getAction: (id) => [ATTACK, SHIELD].find((action) => action.id === id),
};

function fighter(): ActorState {
  return {
    id: 'fighter',
    name: 'Fighter',
    kind: 'playerCharacter',
    controllerId: 'fighter-controller',
    ac: 16,
    capabilities: { actionIds: [ATTACK.id] },
    character: {
      abilityMods: { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      equippedCards: [LONGSWORD],
      knownCards: [LONGSWORD],
      weaponMasteries: ['longsword'],
      saveProficiencies: ['con'],
    },
    runtime: {
      hp: { current: 20, max: 20, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: { main_hand: LONGSWORD.id },
      inventory: [],
      activeEffects: [],
    },
    masteryEffects: { [TOPPLE_ID]: TOPPLE },
  };
}

function target(options: { shield?: boolean; concentrating?: boolean } = {}): ActorState {
  return {
    id: 'wizard',
    name: 'Wizard',
    kind: 'playerCharacter',
    controllerId: 'wizard-controller',
    ac: 12,
    capabilities: { actionIds: options.shield ? [SHIELD.id] : [] },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      saveProficiencies: [],
    },
    runtime: {
      hp: { current: 24, max: 24, temp: 0 },
      resources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        ...(options.shield ? { spell_slot_1: 1 } : {}),
      },
      maxResources: {
        action: 1,
        bonus_action: 1,
        reaction: 1,
        ...(options.shield ? { spell_slot_1: 1 } : {}),
      },
      equipment: {},
      inventory: [],
      activeEffects: options.concentrating ? [{
        id: 'bless-effect',
        name: 'Bless',
        source: 'Wizard',
        expiry: 'manual',
        mechanics: {
          kind: 'modifier', op: 'bonus_die', faces: 4,
          applies_to: { roll: 'saving_throw' },
        },
      }] : [],
    },
  };
}

function world(options: { shield?: boolean; concentrating?: boolean } = {}): WorldState {
  const created = createWorld({ id: 'mastery-world', ruleset: RULESET, actors: [fighter(), target(options)] });
  if (!options.concentrating) return created;
  return {
    ...created,
    concentrations: {
      wizard: {
        id: 'wizard-concentration',
        sourceActorId: 'wizard',
        actionId: 'spell.bless',
        startedAtRevision: 0,
        effectLinks: [{ actorId: 'wizard', effectId: 'bless-effect' }],
      },
    },
  };
}

function command<T extends GameCommand>(value: T): T {
  return value;
}

const facts = {
  factsSource: 'scenario' as const,
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none' as const,
  relation: 'enemy' as const,
};

function engineEvents(events: readonly UncommittedRuleEvent[]) {
  return events.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded' ? [entry.payload.event] : []
  ));
}

function useAttack(session: InMemoryRulesSession, commandId: string) {
  return session.dispatch(command({
    schemaVersion: 1,
    type: 'UseAction',
    commandId,
    expectedRevision: session.getState().revision,
    rulesetContentHash: RULESET.contentHash,
    actorId: 'fighter',
    actionId: ATTACK.id,
    targetIds: ['wizard'],
    factsByTarget: { wizard: facts },
  }));
}

describe('serializable weapon mastery saving throws', () => {
  it('commits hit damage, opens Topple without rolling the target, and resumes manually after reload', () => {
    const initial = world();
    const attackTape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 15 },
      { label: 'damage', sides: 8, value: 5 },
    ]);
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: attackTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const attack = useAttack(opening, 'attack');

    expect(attack.status).toBe('accepted');
    attackTape.assertExhausted();
    expect(opening.getState().actors.wizard.runtime.hp.current).toBe(16);
    expect(opening.getState().actors.wizard.runtime.activeEffects).toEqual([]);
    expect(engineEvents(attack.status === 'accepted' ? attack.events : []).filter((event) => event.type === 'roll')).toHaveLength(1);
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'mastery_save',
      id: 'attack:id:1',
      sourceActorId: 'fighter',
      targetActorId: 'wizard',
      actionId: ATTACK.id,
      mastery: { sourceEntityId: TOPPLE_ID, name: 'Topple', weaponMod: 3 },
      request: { id: 'attack:id:2', actorId: 'wizard', ability: 'con', dc: 13 },
      followUps: [],
    });
    expect(attack.status === 'accepted' ? attack.events : []).toContainEqual(expect.objectContaining({
      obligationIds: expect.arrayContaining([
        `entity:${TOPPLE_ID}`,
        'system:weapon-mastery',
        'system:target-save',
      ]),
      payload: expect.objectContaining({ type: 'ResolutionOpened' }),
    }));

    const paused = JSON.parse(JSON.stringify(opening.getState())) as WorldState;
    const resumed = new InMemoryRulesSession(paused, catalog, {
      rng: () => { throw new Error('manual save and condition consequence need no system RNG'); },
      clock: createLogicalClock(paused.logicalClock),
      nextId: createSequentialIdFactory('unused'),
    });
    const resolved = resumed.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'topple-manual',
      expectedRevision: paused.revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      resolutionId: 'attack:id:1',
      requestId: 'attack:id:2',
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }] } },
    }));

    expect(resolved.status).toBe('accepted');
    expect(resumed.getState().pendingResolution).toBeNull();
    expect(resumed.getState().actors.wizard.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ kind: 'condition', value: 'prone' }) }),
    ]);
    expect(engineEvents(resolved.status === 'accepted' ? resolved.events : [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'roll', roll: expect.objectContaining({ kind: 'save', outcome: 'fail' }) }),
      { type: 'condition_applied', condition: 'prone' },
    ]));
    const combined = [
      ...(attack.status === 'accepted' ? attack.events : []),
      ...(resolved.status === 'accepted' ? resolved.events : []),
    ];
    expect(foldEvents(initial, combined)).toEqual(resumed.getState());
  });

  it('opens the same mastery continuation after Shield resolves but the attack still hits', () => {
    const initial = world({ shield: true });
    const attackTape = createStrictRngTape([{ label: 'attack before Shield', sides: 20, value: 15 }]);
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: attackTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const attack = useAttack(opening, 'shielded-attack');
    expect(attack.status).toBe('accepted');
    attackTape.assertExhausted();
    expect(opening.getState().pendingResolution).toMatchObject({ type: 'attack_reaction' });
    expect(opening.getState().actors.wizard.runtime.hp.current).toBe(24);

    const damageTape = createStrictRngTape([{ label: 'damage after Shield', sides: 8, value: 4 }]);
    const shielded = new InMemoryRulesSession(
      JSON.parse(JSON.stringify(opening.getState())) as WorldState,
      catalog,
      {
        rng: damageTape.rng,
        clock: createLogicalClock(opening.getState().logicalClock),
        nextId: createSequentialIdFactory('unused'),
      },
    );
    const shield = shielded.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'use-shield',
      expectedRevision: shielded.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      resolutionId: 'shielded-attack:id:1',
      requestId: 'shielded-attack:id:2',
      response: { kind: 'reaction', actionId: SHIELD.id },
    }));

    expect(shield.status).toBe('accepted');
    damageTape.assertExhausted();
    expect(shielded.getState().actors.wizard.runtime.hp.current).toBe(17);
    expect(shielded.getState().actors.wizard.runtime.resources).toMatchObject({ reaction: 0, spell_slot_1: 0 });
    expect(shielded.getState().pendingResolution).toMatchObject({
      type: 'mastery_save',
      id: 'use-shield:id:2',
      request: { id: 'use-shield:id:3', dc: 13 },
      mastery: { sourceEntityId: TOPPLE_ID },
    });
    const resolutionEvents = shield.status === 'accepted' ? shield.events : [];
    const closeIndex = resolutionEvents.findIndex((event) => event.payload.type === 'ResolutionClosed');
    const openIndex = resolutionEvents.findIndex((event) => (
      event.payload.type === 'ResolutionOpened' && event.payload.resolution.type === 'mastery_save'
    ));
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(openIndex).toBeGreaterThan(closeIndex);

    const saveTape = createStrictRngTape([{ label: 'Topple system save', sides: 20, value: 20 }]);
    const mastery = new InMemoryRulesSession(
      JSON.parse(JSON.stringify(shielded.getState())) as WorldState,
      catalog,
      {
        rng: saveTape.rng,
        clock: createLogicalClock(shielded.getState().logicalClock),
        nextId: createSequentialIdFactory('unused'),
      },
    );
    const resolved = mastery.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'topple-system',
      expectedRevision: mastery.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      resolutionId: 'use-shield:id:2',
      requestId: 'use-shield:id:3',
      response: { kind: 'roll', roll: { mode: 'system' } },
    }));
    expect(resolved.status).toBe('accepted');
    saveTape.assertExhausted();
    expect(mastery.getState().actors.wizard.runtime.activeEffects.some((effect) => (
      (effect.mechanics as Record<string, unknown>).value === 'prone'
    ))).toBe(false);
  });

  it('queues the base-damage concentration save behind Topple and opens one pending at a time', () => {
    const initial = world({ concentrating: true });
    const attackTape = createStrictRngTape([
      { label: 'attack', sides: 20, value: 14 },
      { label: 'damage', sides: 8, value: 5 },
    ]);
    const opening = new InMemoryRulesSession(initial, catalog, {
      rng: attackTape.rng,
      clock: createLogicalClock(),
      nextId: createSequentialIdFactory('unused'),
    });
    const attack = useAttack(opening, 'attack-concentrator');
    expect(attack.status).toBe('accepted');
    attackTape.assertExhausted();
    expect(opening.getState().pendingResolution).toMatchObject({
      type: 'mastery_save',
      followUps: [{
        type: 'concentration_save',
        actorId: 'wizard',
        concentrationId: 'wizard-concentration',
        damage: 8,
        dc: 10,
      }],
    });
    expect((attack.status === 'accepted' ? attack.events : [])
      .filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(1);

    const afterAttack = JSON.parse(JSON.stringify(opening.getState())) as WorldState;
    const mastery = new InMemoryRulesSession(afterAttack, catalog, {
      rng: () => { throw new Error('manual Topple save needs no system RNG'); },
      clock: createLogicalClock(afterAttack.logicalClock),
      nextId: createSequentialIdFactory('unused'),
    });
    const toppled = mastery.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'topple-before-concentration',
      expectedRevision: afterAttack.revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      resolutionId: 'attack-concentrator:id:1',
      requestId: 'attack-concentrator:id:2',
      response: {
        kind: 'roll',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 3 }, { sides: 4, value: 1 }] },
      },
    }));
    expect(toppled.status).toBe('accepted');
    expect(mastery.getState().pendingResolution).toMatchObject({
      type: 'concentration_save',
      id: 'topple-before-concentration:id:2',
      request: { id: 'topple-before-concentration:id:3', actorId: 'wizard', dc: 10 },
    });
    const masteryEvents = toppled.status === 'accepted' ? toppled.events : [];
    expect(masteryEvents.filter((event) => event.payload.type === 'ResolutionClosed')).toHaveLength(1);
    expect(masteryEvents.filter((event) => event.payload.type === 'ResolutionOpened')).toHaveLength(1);
    expect(masteryEvents.findIndex((event) => event.payload.type === 'ResolutionOpened')).toBeGreaterThan(
      masteryEvents.findIndex((event) => event.payload.type === 'ResolutionClosed'),
    );

    const concentrationTape = createStrictRngTape([
      { label: 'concentration', sides: 20, value: 2 },
      { label: 'Bless on concentration', sides: 4, value: 1 },
    ]);
    const concentration = new InMemoryRulesSession(
      JSON.parse(JSON.stringify(mastery.getState())) as WorldState,
      catalog,
      {
        rng: concentrationTape.rng,
        clock: createLogicalClock(mastery.getState().logicalClock),
        nextId: createSequentialIdFactory('unused'),
      },
    );
    const resolved = concentration.dispatch(command({
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: 'resolve-concentration',
      expectedRevision: concentration.getState().revision,
      rulesetContentHash: RULESET.contentHash,
      actorId: 'wizard',
      resolutionId: 'topple-before-concentration:id:2',
      requestId: 'topple-before-concentration:id:3',
      response: { kind: 'roll', roll: { mode: 'system' } },
    }));
    expect(resolved.status).toBe('accepted');
    concentrationTape.assertExhausted();
    expect(concentration.getState().pendingResolution).toBeNull();
    expect(concentration.getState().concentrations).toEqual({});
    expect(concentration.getState().actors.wizard.runtime.activeEffects).toEqual([
      expect.objectContaining({ mechanics: expect.objectContaining({ value: 'prone' }) }),
    ]);

    const allEvents = [
      ...(attack.status === 'accepted' ? attack.events : []),
      ...(toppled.status === 'accepted' ? toppled.events : []),
      ...(resolved.status === 'accepted' ? resolved.events : []),
    ];
    expect(foldEvents(initial, allEvents)).toEqual(concentration.getState());
  });
});
