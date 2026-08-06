import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { createWorld, type ActorState, type RuleEventPayload, type WorldState } from './domain';
import {
  PROTECTION_2024_CAPABILITY_ID,
  resolveProtection2024Reaction,
  type Protection2024ReactionFacts,
} from './protection';
import { PROTECTION_2024_SOURCE_ENTITY_IDS } from './testing/fightingStyleFixtures';
import { protectionEffectEntry } from './protectionRuntime';
import { evolve } from './reducer';
import { SYSTEM_ACTION_IDS } from './systemActions';
import { migrateWorldState } from './worldMigration';

const ruleset = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'protection-integrity',
  contentHash: 'protection-integrity',
  errataVersion: 'protection-integrity',
};

const shield = {
  id: 'shield-card', card_number: 'CARD-0200', name: 'Shield', type: 'shield', properties: ['shield'],
} as unknown as Card;
const mace = {
  id: 'mace-card', card_number: 'CARD-0009', name: 'Mace', type: 'weapon',
  weapon_type: 'mace', bonus_value: '1d6', damage_type: 'bludgeoning', properties: [],
} as unknown as Card;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function actor(id: string, protection = false): ActorState {
  return {
    id,
    name: id,
    kind: id === 'attacker' ? 'monster' : 'playerCharacter',
    controllerId: `${id}:controller`,
    lifecycle: { status: 'alive' },
    capabilities: protection ? {
      actionIds: [],
      featureSources: {
        [PROTECTION_2024_CAPABILITY_ID]: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
      },
    } : { actionIds: [] },
    character: {
      abilityMods: { str: 2, dex: 1, con: 1, int: 0, wis: 0, cha: 0 },
      profBonus: 2,
      level: 1,
      knownCards: protection ? [shield] : id === 'attacker' ? [mace] : [],
      equippedCards: protection ? [shield] : id === 'attacker' ? [mace] : [],
      weaponProficiencies: id === 'attacker' ? ['mace'] : [],
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: protection ? { off_hand: shield.id }
        : id === 'attacker' ? { main_hand: mace.id } : {},
      inventory: protection ? [{ cardId: shield.id, qty: 1 }]
        : id === 'attacker' ? [{ cardId: mace.id, qty: 1 }] : [],
      activeEffects: [],
    },
    attackProfile: {
      attacksPerAction: 1, size: 2, reachFt: 5,
      graspingParts: ['main_hand', 'off_hand'], sourceEntityIds: [`fixture:${id}:attack`],
    },
  };
}

function world(): WorldState {
  const value = createWorld({
    id: 'protection-integrity', ruleset,
    actors: [actor('protector', true), actor('target'), actor('attacker')],
  });
  value.revision = 2;
  return value;
}

function facts(): Protection2024ReactionFacts {
  return {
    factsSource: 'scenario', worldRevision: 1, attackId: 'attack-command',
    protectorActorId: 'protector', attackerActorId: 'attacker', targetActorId: 'target',
    attackRollStage: 'before_roll', protectorCanSeeAttacker: true,
    protectorHoldingShield: true, protectorReactionAvailable: true,
    protectorDistanceToTargetFt: 5,
  };
}

function effect() {
  const result = resolveProtection2024Reaction({
    decision: 'use', effectId: 'protection-effect',
    source: {
      ownerActorId: 'protector', capabilityId: PROTECTION_2024_CAPABILITY_ID,
      sourceEntityIds: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
    },
    facts: facts(),
  });
  if (result.status !== 'activated') throw new Error('fixture Protection did not activate');
  return result.effect;
}

function activation(value = effect(), observed = facts()): RuleEventPayload {
  return { type: 'ProtectionEffectActivated', effect: value, facts: observed };
}

describe('Protection reducer and checkpoint integrity', () => {
  it('rejects every forged activation identity before spending a Reaction', () => {
    const cases: Array<[string, (value: WorldState, payload: Extract<
      RuleEventPayload, { type: 'ProtectionEffectActivated' }
    >) => void]> = [
      ['missing protector', (value) => { delete value.actors.protector; }],
      ['missing target', (value) => { delete value.actors.target; }],
      ['missing attacker', (value) => { delete value.actors.attacker; }],
      ['facts protector', (_value, payload) => { payload.facts.protectorActorId = 'other'; }],
      ['facts target', (_value, payload) => { payload.facts.targetActorId = 'other'; }],
      ['facts attacker', (_value, payload) => { payload.facts.attackerActorId = 'other'; }],
      ['facts attack', (_value, payload) => { payload.facts.attackId = 'other'; }],
      ['shield mismatch', (_value, payload) => { payload.facts.protectorHoldingShield = false; }],
      ['reaction fact', (_value, payload) => { payload.facts.protectorReactionAvailable = false; }],
      ['reaction resource', (value) => { value.actors.protector.runtime.resources.reaction = 0; }],
      ['duplicate effect', (value) => {
        value.actors.protector.runtime.activeEffects.push(protectionEffectEntry(effect()));
      }],
    ];
    for (const [label, mutate] of cases) {
      const value = world();
      const payload = copy(activation()) as Extract<RuleEventPayload, { type: 'ProtectionEffectActivated' }>;
      mutate(value, payload);
      expect(() => evolve(value, payload), label).toThrow(/Invalid Protection activation/);
    }
  });

  it('rejects pure-contract mismatches and a source envelope that differs from actor ownership', () => {
    const rejectedSource = copy(effect());
    rejectedSource.source.sourceEntityIds = ['forged'];
    expect(() => evolve(world(), activation(rejectedSource))).toThrow(/actor capability/);

    const mismatched = copy(effect());
    mismatched.activatedAtWorldRevision += 1;
    expect(() => evolve(world(), activation(mismatched))).toThrow(/pure contract/);

    const mismatchedOwner = world();
    mismatchedOwner.actors.protector.capabilities.featureSources![PROTECTION_2024_CAPABILITY_ID] = [
      ...PROTECTION_2024_SOURCE_ENTITY_IDS,
    ].reverse() as [string, ...string[]];
    expect(() => evolve(mismatchedOwner, activation())).toThrow(/actor capability/);
  });

  it('uses mechanics and declarative item facts, not localized names or card numbers', () => {
    const alternateShield = {
      ...shield,
      id: 'alternate-shield',
      card_number: 'homebrew:shield:1',
      name: 'Башенный щит',
    } as unknown as Card;
    const value = world();
    value.actors.protector.character.knownCards = [alternateShield];
    value.actors.protector.character.equippedCards = [alternateShield];
    value.actors.protector.runtime.equipment.off_hand = alternateShield.id;
    expect(() => evolve(value, activation())).not.toThrow();

    const active = evolve(world(), activation());
    active.actors.protector.runtime.activeEffects[0].name = 'Защита';
    expect(() => migrateWorldState(active)).not.toThrow();
  });

  it('rejects every inactive or non-terminal end event', () => {
    const active = evolve(world(), activation());
    const base: Extract<RuleEventPayload, { type: 'ProtectionEffectEnded' }> = {
      type: 'ProtectionEffectEnded', protectorActorId: 'protector', protectedTargetActorId: 'target',
      effectId: 'protection-effect', reason: 'proximity_broken',
      lifecycleEvent: {
        type: 'distance_observed', factsSource: 'scenario', worldRevision: 2,
        protectorActorId: 'protector', protectedTargetActorId: 'target', distanceFt: 10,
      },
    };
    const missingProtector = copy(active);
    delete missingProtector.actors.protector;
    expect(() => evolve(missingProtector, base)).toThrow(/inactive Protection/);
    expect(() => evolve(world(), base)).toThrow(/inactive Protection/);
    const ordinary = world();
    ordinary.actors.protector.runtime.activeEffects.push({
      id: base.effectId, name: 'ordinary', mechanics: { kind: 'condition', value: 'prone' },
      source: 'fixture', ownerId: 'protector', sourceId: 'attacker',
    });
    expect(() => evolve(ordinary, base)).toThrow(/inactive Protection/);
    expect(() => evolve(active, { ...base, protectedTargetActorId: 'attacker' }))
      .toThrow(/inactive Protection/);
    expect(() => evolve(active, {
      ...base,
      lifecycleEvent: {
        type: 'distance_observed', factsSource: 'scenario', worldRevision: 2,
        protectorActorId: 'protector', protectedTargetActorId: 'target', distanceFt: 5,
      },
    })).toThrow(/invalid terminal observation/);
    expect(() => evolve(active, {
      ...base,
      lifecycleEvent: {
        type: 'turn_started', factsSource: 'scenario', worldRevision: 2, actorId: 'protector',
      },
    })).toThrow(/invalid terminal observation/);
  });

  it('fails closed for duplicate effects and malformed Protection/weapon continuations', () => {
    const duplicate = world();
    const first = effect();
    duplicate.actors.protector.runtime.activeEffects.push(protectionEffectEntry(first));
    const secondProtector = actor('second-protector', true);
    const second = {
      ...first,
      protectorActorId: secondProtector.id,
      source: { ...first.source, ownerActorId: secondProtector.id },
      expiry: { ...first.expiry, actorId: secondProtector.id },
    };
    secondProtector.runtime.activeEffects.push(protectionEffectEntry(second));
    duplicate.actors[secondProtector.id] = secondProtector;
    expect(() => migrateWorldState(duplicate)).toThrow(/duplicated/);

    const malformedProtection = world();
    malformedProtection.pendingResolution = {
      id: 'pending', type: 'protection_reaction', openedByCommandId: 'attack-command',
      openedAtRevision: 1, deadlineLogicalClock: 10,
      sourceActorId: 'attacker', targetActorId: 'target', actionId: 'attack',
      facts: {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 5, lineOfSight: true,
        cover: 'none', relation: 'enemy',
      },
      attackContinuationKind: 'catalog', preRollDisadvantageReasons: [],
      protectionCandidates: [], remainingReactions: [],
      request: {
        id: 'request', type: 'reaction', actorId: 'protector',
        trigger: {
          type: 'protection_before_attack', sourceActorId: 'attacker', targetActorId: 'target',
          actionId: 'attack', attackId: 'attack-command',
        },
        options: [{ actionId: PROTECTION_2024_CAPABILITY_ID, label: 'Protection' }],
      },
    };
    expect(() => migrateWorldState(malformedProtection)).toThrow(/does not cover every/);

    const attackReaction = world();
    attackReaction.pendingResolution = {
      id: 'shield-pending', type: 'attack_reaction', openedByCommandId: 'attack-command',
      openedAtRevision: 1, deadlineLogicalClock: 10,
      sourceActorId: 'attacker', targetActorId: 'target', actionId: SYSTEM_ACTION_IDS.weaponAttack,
      facts: {
        factsSource: 'scenario', boardRevision: 1, distanceFt: 5, lineOfSight: true,
        cover: 'none', relation: 'enemy',
      },
      attackRoll: {
        kind: 'd20', dice: [{ sides: 20, result: 10 }], advantage: 'none',
        modifiers: [{ value: 4, source: 'fixture' }], total: 14,
        text: '10 + 4 = 14', target: { type: 'ac', value: 12 }, outcome: 'hit',
      },
      request: {
        id: 'shield-request', type: 'reaction', actorId: 'target',
        trigger: {
          type: 'hit_by_attack', sourceActorId: 'attacker', actionId: SYSTEM_ACTION_IDS.weaponAttack,
          attackTotal: 14, originalAc: 12,
        },
        options: [],
      },
      weaponHand: 'main', weaponCardId: mace.id,
    };
    expect(migrateWorldState(attackReaction).pendingResolution).toMatchObject({
      weaponHand: 'main', weaponCardId: mace.id,
    });
    const missingHand = copy(attackReaction);
    delete (missingHand.pendingResolution as { weaponHand?: string }).weaponHand;
    expect(() => migrateWorldState(missingHand)).toThrow(/invalid weapon continuation identity/);
    const wrongHand = copy(attackReaction);
    (wrongHand.pendingResolution as { weaponHand?: string }).weaponHand = 'off';
    expect(() => migrateWorldState(wrongHand)).toThrow(/must match the source equipped Card/);
  });
});
