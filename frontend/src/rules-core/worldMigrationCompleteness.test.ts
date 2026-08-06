import { describe, expect, it } from 'vitest';
import {
  createWorld,
  type ActorState,
  type PactBladeAttackContinuationProjection,
  type WorldState,
} from './domain';
import type { Card } from '../types';
import {
  PROTECTION_2024_CAPABILITY_ID,
} from './protection';
import { PROTECTION_2024_SOURCE_ENTITY_IDS } from './testing/fightingStyleFixtures';
import { SYSTEM_ACTION_IDS } from './systemActions';
import { createPactBladeInvocationState } from './warlockPacts';
import { PACT_BLADE_PHB_2024_LIFECYCLE_POLICY } from './testing/pactBladePolicyFixtures';
import { migrateWorldState } from './worldMigration';

type MutableRecord = Record<string, unknown>;

const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'world-migration-completeness',
  contentHash: 'sha256:world-migration-completeness',
  errataVersion: 'PHB-2024',
};

const PACT_SOURCE = 'effect:pact-blade';
const PACT_ACTION = 'action:pact-blade';
const PACT_CARD = 'card:pact-longsword';
const PACT_OBJECT = 'object:pact-longsword';

const CANONICAL_SHIELD: Card = {
  id: 'card:canonical-shield',
  card_number: 'CARD-0200',
  name: 'Shield',
  type: 'shield',
  weapon_type: '',
  damage_type: '',
  bonus_type: null,
  bonus_value: '',
  properties: ['shield'],
  tags: ['armor', 'shield'],
  description: '',
  rarity: 'common',
  is_template: 'false',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

function actor(id = 'a', actionIds: string[] = []): ActorState {
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: { actionIds },
    character: {
      abilityMods: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 10, max: 10, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
  };
}

function world(input: {
  actors?: ActorState[];
  objects?: MutableRecord[];
} = {}): WorldState {
  return createWorld({
    id: 'world:migration-completeness',
    ruleset: RULESET,
    actors: input.actors ?? [actor()],
    objects: (input.objects ?? []) as never[],
  });
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function raw(value: unknown): MutableRecord {
  return value as MutableRecord;
}

function rawActor(value: WorldState, id = 'a'): MutableRecord {
  return raw(raw(value.actors)[id]);
}

function plainObject(overrides: MutableRecord = {}): MutableRecord {
  return {
    id: 'object',
    name: 'Object',
    kind: 'environment',
    size: 'small',
    ...overrides,
  };
}

function objectWorld(overrides: MutableRecord): WorldState {
  return world({ objects: [plainObject(overrides)] });
}

function pactActor(id: string, objectId = PACT_OBJECT): ActorState {
  const value = actor(id, [PACT_ACTION]);
  value.capabilities.featureSources = { 'warlock.pact.blade': [PACT_SOURCE] };
  value.warlockPacts = {
    blade: {
      ...createPactBladeInvocationState({
        sourceEntityId: PACT_SOURCE,
        ownerActorId: id,
        bondActionId: PACT_ACTION,
        lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      }),
      activeBond: {
        sourceEntityId: PACT_SOURCE,
        warlockActorId: id,
        weaponObjectId: objectId,
        weaponCardId: PACT_CARD,
        weaponType: 'longsword',
        normalDamageType: 'slashing',
        conjured: false,
        bondedAtRevision: 0,
        continuousSeparationSeconds: 0,
        lastDistanceBoardRevision: null,
      },
    },
  };
  return value;
}

function pactObject(overrides: MutableRecord = {}): MutableRecord {
  return {
    id: PACT_OBJECT,
    name: 'Pact Longsword',
    kind: 'item',
    size: 'small',
    itemCardId: PACT_CARD,
    carriedByActorId: 'warlock',
    heldByActorId: 'warlock',
    heldInHand: 'main_hand',
    ...overrides,
  };
}

function projection(
  overrides: Partial<PactBladeAttackContinuationProjection> = {},
): PactBladeAttackContinuationProjection {
  return {
    weaponObjectId: PACT_OBJECT,
    weaponCardId: PACT_CARD,
    weaponHand: 'main',
    abilityChoice: 'cha',
    attackAbility: 'cha',
    damageAbility: 'cha',
    damageChoice: 'normal',
    resolvedDamageType: 'slashing',
    ...overrides,
  };
}

function pactContinuationWorld(): WorldState {
  const value = world({
    actors: [pactActor('warlock')],
    objects: [pactObject()],
  });
  raw(value).pendingResolution = {
    id: 'resolution:pact-attack',
    type: 'attack_reaction',
    sourceActorId: 'warlock',
    actionId: SYSTEM_ACTION_IDS.weaponAttack,
    weaponHand: 'main',
    weaponCardId: PACT_CARD,
    pactBladeProjection: projection(),
  };
  return value;
}

function rawPending(value: WorldState): MutableRecord {
  return raw(raw(value).pendingResolution);
}

function rawProjection(value: WorldState): MutableRecord {
  return raw(rawPending(value).pactBladeProjection);
}

describe('persisted WorldState migration completeness', () => {
  it('fails closed for item-only identities and inseparable canonical hand references', () => {
    const cases: Array<[string, WorldState, RegExp]> = [
      [
        'Card bridge on environment',
        objectWorld({ itemCardId: 'card:forged' }),
        /itemCardId requires an item object/,
      ],
      [
        'attunement on environment',
        objectWorld({ attunedToActorId: 'a' }),
        /attunedToActorId requires an item object/,
      ],
      [
        'holder without hand',
        objectWorld({ kind: 'item', carriedByActorId: 'a', heldByActorId: 'a' }),
        /persist holder and hand together/,
      ],
      [
        'hand without holder',
        objectWorld({ kind: 'item', carriedByActorId: 'a', heldInHand: 'main_hand' }),
        /persist holder and hand together/,
      ],
      [
        'unsupported hand',
        objectWorld({
          kind: 'item', carriedByActorId: 'a', heldByActorId: 'a', heldInHand: 'left_hand',
        }),
        /heldInHand is invalid/,
      ],
      [
        'held non-item',
        objectWorld({ carriedByActorId: 'a', heldByActorId: 'a', heldInHand: 'main_hand' }),
        /held identity must match its item carrier/,
      ],
      [
        'holder differs from carrier',
        world({
          actors: [actor('a'), actor('b')],
          objects: [plainObject({
            kind: 'item', carriedByActorId: 'b', heldByActorId: 'a', heldInHand: 'off_hand',
          })],
        }),
        /held identity must match its item carrier/,
      ],
    ];

    for (const [label, value, message] of cases) {
      expect(() => migrateWorldState(value), label).toThrow(message);
    }
  });

  it('requires complete, positive source-turn expiry provenance', () => {
    const invalidCases: Array<[string, MutableRecord, RegExp]> = [
      ['zero duration', { sourceTurnEndingsLeft: 0 }, /positive integer/],
      ['missing both sources', { sourceTurnEndingsLeft: 1 }, /requires source actor and action IDs/],
      [
        'missing source action',
        { sourceTurnEndingsLeft: 1, sourceActorId: 'a' },
        /requires source actor and action IDs/,
      ],
      [
        'missing source actor',
        { sourceTurnEndingsLeft: 1, sourceActionId: 'spell.prestidigitation' },
        /requires source actor and action IDs/,
      ],
    ];
    for (const [label, overrides, message] of invalidCases) {
      expect(() => migrateWorldState(objectWorld(overrides)), label).toThrow(message);
    }

    const valid = objectWorld({
      sourceTurnEndingsLeft: 2,
      sourceActorId: 'a',
      sourceActionId: 'spell.prestidigitation',
    });
    expect(migrateWorldState(valid).objects.object.sourceTurnEndingsLeft).toBe(2);
  });

  it('validates every persisted Dancing Lights primitive and exact group membership', () => {
    const dancing = (overrides: MutableRecord = {}): MutableRecord => plainObject({
      kind: 'spell_effect',
      sourceActorId: 'a',
      sourceActionId: 'spell.dancing-lights',
      roundsLeft: 10,
      distanceFromSourceFt: 5,
      dancingLight: { groupId: 'group', form: 'individual', dimRadiusFt: 10 },
      ...overrides,
    });
    const invalidCases: Array<[string, MutableRecord, RegExp]> = [
      [
        'invalid form',
        dancing({ dancingLight: { groupId: 'group', form: 'swarm', dimRadiusFt: 10 } }),
        /dancingLight\.form is invalid/,
      ],
      [
        'invalid dim radius',
        dancing({ dancingLight: { groupId: 'group', form: 'individual', dimRadiusFt: 0 } }),
        /dimRadiusFt must be a positive number/,
      ],
      [
        'non-spell effect',
        dancing({ kind: 'environment' }),
        /requires a source-owned spell-effect object/,
      ],
      [
        'missing source actor',
        dancing({ sourceActorId: undefined }),
        /requires a source-owned spell-effect object/,
      ],
      [
        'missing source action',
        dancing({ sourceActionId: undefined }),
        /requires a source-owned spell-effect object/,
      ],
      ['zero duration', dancing({ roundsLeft: 0 }), /roundsLeft must be a positive integer/],
      ['non-finite distance', dancing({ distanceFromSourceFt: Number.NaN }), /non-negative source distance/],
      ['negative distance', dancing({ distanceFromSourceFt: -1 }), /non-negative source distance/],
    ];
    for (const [label, object, message] of invalidCases) {
      expect(() => migrateWorldState(world({ objects: [object] })), label).toThrow(message);
    }
    const alternativeRuleValues = world({
      actors: [actor('a', ['spell.dancing-lights'])],
      objects: [dancing({
        dancingLight: { groupId: 'group', form: 'individual', dimRadiusFt: 20 },
        roundsLeft: 11,
      })],
    });
    alternativeRuleValues.concentrations.a = {
      id: 'concentration:dancing-lights:alternative',
      sourceActorId: 'a',
      actionId: 'spell.dancing-lights',
      startedAtRevision: 0,
      effectLinks: [],
    };
    expect(migrateWorldState(alternativeRuleValues).objects.object).toMatchObject({
      roundsLeft: 11,
      dancingLight: { dimRadiusFt: 20 },
    });

    const valid = world({
      actors: [actor('a', ['spell.dancing-lights'])],
      objects: [
        dancing({ id: 'light:one', name: 'Light one' }),
        dancing({ id: 'light:two', name: 'Light two' }),
      ],
    });
    valid.concentrations.a = {
      id: 'concentration:dancing-lights',
      sourceActorId: 'a',
      actionId: 'spell.dancing-lights',
      startedAtRevision: 0,
      effectLinks: [],
    };
    expect(Object.keys(migrateWorldState(valid).objects)).toEqual(['light:one', 'light:two']);

    const invalidMemberships: Array<[string, MutableRecord[]]> = [
      [
        'mixed forms',
        [
          dancing({ id: 'light:one', name: 'Light one' }),
          dancing({
            id: 'light:two', name: 'Light two',
            dancingLight: { groupId: 'group', form: 'medium_humanoid', dimRadiusFt: 10 },
          }),
        ],
      ],
      [
        'five individual lights',
        Array.from({ length: 5 }, (_, index) => dancing({
          id: `light:${index}`, name: `Light ${index}`,
        })),
      ],
      [
        'two humanoid lights',
        [0, 1].map((index) => dancing({
          id: `light:${index}`,
          name: `Light ${index}`,
          dancingLight: { groupId: 'group', form: 'medium_humanoid', dimRadiusFt: 10 },
        })),
      ],
    ];
    for (const [label, objects] of invalidMemberships) {
      const invalid = world({ actors: [actor('a', ['spell.dancing-lights'])], objects });
      expect(() => migrateWorldState(invalid), label).toThrow(/invalid persisted membership/);
    }
  });

  it('validates Prestidigitation attachments and their actor-owned source action', () => {
    const attachment = (overrides: MutableRecord = {}): MutableRecord => ({
      id: 'effect:warm',
      sourceActorId: 'a',
      sourceActionId: 'spell.prestidigitation',
      kind: 'minor_sensation',
      description: 'Warm to the touch',
      roundsLeft: 600,
      ...overrides,
    });
    const withAttachments = (attachments: unknown): WorldState => objectWorld({
      prestidigitation: attachments,
    });
    const invalidCases: Array<[string, WorldState, RegExp]> = [
      ['not an array', withAttachments(null), /must be a non-empty array/],
      ['empty array', withAttachments([]), /must be a non-empty array/],
      ['non-object attachment', withAttachments([null]), /\[0\] must be an object/],
      ['blank id', withAttachments([attachment({ id: '' })]), /\[0\]\.id must be a non-empty string/],
      [
        'duplicate id',
        withAttachments([attachment(), attachment()]),
        /contains duplicate effect effect:warm/,
      ],
      [
        'blank source actor',
        withAttachments([attachment({ sourceActorId: '' })]),
        /sourceActorId must be a non-empty string/,
      ],
      [
        'blank source action',
        withAttachments([attachment({ sourceActionId: '' })]),
        /sourceActionId must be a non-empty string/,
      ],
      ['invalid kind', withAttachments([attachment({ kind: 'odor' })]), /kind is invalid/],
      ['blank description', withAttachments([attachment({ description: '' })]), /description must be a non-empty string/],
      ['zero duration', withAttachments([attachment({ roundsLeft: 0 })]), /roundsLeft must be a positive integer/],
    ];
    for (const [label, value, message] of invalidCases) {
      expect(() => migrateWorldState(value), label).toThrow(message);
    }
    const alternativeDuration = world({
      actors: [actor('a', ['spell.prestidigitation'])],
      objects: [plainObject({ prestidigitation: [attachment({ roundsLeft: 601 })] })],
    });
    expect(migrateWorldState(alternativeDuration)
      .objects.object.prestidigitation?.[0].roundsLeft).toBe(601);

    const unknownActor = withAttachments([attachment({ sourceActorId: 'missing' })]);
    expect(() => migrateWorldState(unknownActor)).toThrow(/retain an actor-owned source action/);

    const foreignAction = withAttachments([attachment()]);
    expect(() => migrateWorldState(foreignAction)).toThrow(/retain an actor-owned source action/);

    const valid = world({
      actors: [actor('a', ['spell.prestidigitation'])],
      objects: [plainObject({ prestidigitation: [attachment()] })],
    });
    expect(migrateWorldState(valid).objects.object.prestidigitation).toEqual([attachment()]);
  });

  it('accepts only a canonical, committed actor-death adjudication', () => {
    const livingWithFact = world();
    rawActor(livingWithFact).lifecycle = { status: 'alive', adjudication: {} };
    expect(() => migrateWorldState(livingWithFact)).toThrow(/invalid for a living actor/);

    const invalidStatus = world();
    rawActor(invalidStatus).lifecycle = { status: 'unconscious' };
    expect(() => migrateWorldState(invalidStatus)).toThrow(/lifecycle\.status is invalid/);

    const valid = world();
    valid.revision = 1;
    rawActor(valid).lifecycle = {
      status: 'dead',
      adjudication: {
        type: 'ActorDeathAdjudicated',
        provenance: 'canonical_actor_lifecycle',
        factId: 'death:a',
        actorId: 'a',
        adjudicatedBy: 'gm',
        observedAtWorldRevision: 0,
        rulesetContentHash: RULESET.contentHash,
      },
    };

    const badType = clone(valid);
    raw(rawActor(badType).lifecycle).adjudication = {
      ...raw(raw(rawActor(badType).lifecycle).adjudication),
      type: 'ActorKnockedOut',
    };
    expect(() => migrateWorldState(badType)).toThrow(/non-authoritative lifecycle provenance/);

    const badProvenance = clone(valid);
    raw(raw(rawActor(badProvenance).lifecycle).adjudication).provenance = 'client_patch';
    expect(() => migrateWorldState(badProvenance)).toThrow(/non-authoritative lifecycle provenance/);

    const wrongActor = clone(valid);
    raw(raw(rawActor(wrongActor).lifecycle).adjudication).actorId = 'b';
    expect(() => migrateWorldState(wrongActor)).toThrow(/actorId must match its actor/);

    const wrongHash = clone(valid);
    raw(raw(rawActor(wrongHash).lifecycle).adjudication).rulesetContentHash = 'sha256:foreign';
    expect(() => migrateWorldState(wrongHash)).toThrow(/rulesetContentHash must match/);

    expect(migrateWorldState(valid).actors.a.lifecycle).toEqual(rawActor(valid).lifecycle);
  });

  it('rejects a Pact bond whose immutable Card/item bridge diverges or is shared', () => {
    const invalidLifecycle = world({
      actors: [pactActor('warlock')],
      objects: [pactObject()],
    });
    const blade = raw(rawActor(invalidLifecycle, 'warlock').warlockPacts).blade as MutableRecord;
    blade.lifecyclePolicy = {
      ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      continuousSeparationSecondsToEnd: 0,
    };
    expect(() => migrateWorldState(invalidLifecycle))
      .toThrow(/lifecycle policy requires finite distance, positive duration, and death behavior/);

    const wrongBridge = world({
      actors: [pactActor('warlock')],
      objects: [pactObject({ itemCardId: 'card:other' })],
    });
    expect(() => migrateWorldState(wrongBridge)).toThrow(/exact immutable Card-to-item bridge/);

    const shared = world({
      actors: [pactActor('warlock'), pactActor('rival')],
      objects: [pactObject({ carriedByActorId: undefined, heldByActorId: undefined, heldInHand: undefined })],
    });
    expect(() => migrateWorldState(shared)).toThrow(/bonds an already bonded item/);
  });

  it('round-trips an exact Pact Blade continuation and rejects each integrity layer', () => {
    const valid = pactContinuationWorld();
    expect(migrateWorldState(clone(valid)).pendingResolution).toEqual(valid.pendingResolution);

    const malformed = clone(valid);
    rawProjection(malformed).damageChoice = 'force';
    expect(() => migrateWorldState(malformed)).toThrow(/malformed Pact Blade attack projection/);

    const wrongHand = clone(valid);
    rawPending(wrongHand).weaponHand = 'off';
    expect(() => migrateWorldState(wrongHand)).toThrow(/diverges from its weapon continuation identity/);

    const wrongCard = clone(valid);
    rawPending(wrongCard).weaponCardId = 'card:other';
    expect(() => migrateWorldState(wrongCard)).toThrow(/diverges from its weapon continuation identity/);

    const staleBond = clone(valid);
    rawProjection(staleBond).attackAbility = 'str';
    expect(() => migrateWorldState(staleBond)).toThrow(/diverges from its active held Card\/Object bond/);

    const unheld = clone(valid);
    delete raw(raw(unheld.objects)[PACT_OBJECT]).heldByActorId;
    delete raw(raw(unheld.objects)[PACT_OBJECT]).heldInHand;
    expect(() => migrateWorldState(unheld)).toThrow(/diverges from its active held Card\/Object bond/);

    const alternateDamage = clone(valid);
    Object.assign(rawProjection(alternateDamage), {
      damageChoice: 'radiant',
      resolvedDamageType: 'radiant',
    });
    expect(migrateWorldState(alternateDamage).pendingResolution).toEqual(
      alternateDamage.pendingResolution,
    );
  });

  it('normalizes a non-null Pact distance observation and an off-hand continuation', () => {
    const value = pactContinuationWorld();
    const blade = raw(rawActor(value, 'warlock').warlockPacts).blade as MutableRecord;
    raw(blade.activeBond).lastDistanceBoardRevision = 7;
    raw(blade.activeBond).continuousSeparationSeconds = 600;
    raw(raw(value.objects)[PACT_OBJECT]).heldInHand = 'off_hand';
    rawPending(value).weaponHand = 'off';
    rawProjection(value).weaponHand = 'off';
    rawPending(value).attackContinuationKind = 'weapon_ranged';

    const migrated = migrateWorldState(value);
    expect(migrated.actors.warlock.warlockPacts?.blade?.activeBond).toMatchObject({
      lastDistanceBoardRevision: 7,
      continuousSeparationSeconds: 600,
    });
    expect(migrated.pendingResolution).toMatchObject({
      weaponHand: 'off',
      attackContinuationKind: 'weapon_ranged',
    });
  });

  it('rejects non-string Pact continuation ownership and actor key forgery', () => {
    const nonStringOwner = pactContinuationWorld();
    rawPending(nonStringOwner).sourceActorId = 7;
    expect(() => migrateWorldState(nonStringOwner))
      .toThrow(/diverges from its active held Card\/Object bond/);

    const wrongActorKey = world();
    rawActor(wrongActorKey).id = 'different';
    expect(() => migrateWorldState(wrongActorKey)).toThrow(/id must match its key/);
  });

  it('rejects malformed non-object and Protection active-effect entries', () => {
    const nonObject = world();
    raw(rawActor(nonObject).runtime).activeEffects = [null];
    expect(() => migrateWorldState(nonObject)).toThrow();

    const invalidProtection = world();
    raw(rawActor(invalidProtection).runtime).activeEffects = [{
      id: 'effect:invalid-protection',
      name: 'Fighting Style: Protection',
      source: PROTECTION_2024_CAPABILITY_ID,
      ownerId: 'a',
      sourceId: 'a',
      expiry: 'manual',
      mechanics: {
        kind: 'fighting_style_protection_2024',
        id: 'effect:invalid-protection',
      },
    }];
    expect(() => migrateWorldState(invalidProtection)).toThrow(/Protection effect is invalid/);
  });

  it('fails closed when incomplete familiar metadata has no canonical owner state', () => {
    const value = world();
    rawActor(value).familiarMetadata = {};
    expect(() => migrateWorldState(value)).toThrow(
      /requires both canonical state and pinned metadata/,
    );
  });

  it('checks a legacy Dancing Lights group even when concentration storage is absent', () => {
    const value = world({
      actors: [actor('a', ['spell.dancing-lights'])],
      objects: [plainObject({
        kind: 'spell_effect',
        sourceActorId: 'a',
        sourceActionId: 'spell.dancing-lights',
        roundsLeft: 10,
        distanceFromSourceFt: 0,
        dancingLight: { groupId: 'legacy-group', form: 'individual', dimRadiusFt: 10 },
      })],
    });
    raw(value).schemaVersion = 4;
    delete raw(value).concentrations;
    expect(() => migrateWorldState(value)).toThrow(/requires its exact active concentration/);
  });

  it('rejects a Pact projection only after a valid Protection continuation is restored', () => {
    const attacker = actor('attacker');
    const target = actor('target');
    const protector = actor('protector');
    protector.capabilities.featureSources = {
      [PROTECTION_2024_CAPABILITY_ID]: [...PROTECTION_2024_SOURCE_ENTITY_IDS],
    };
    protector.character.knownCards = [CANONICAL_SHIELD];
    protector.character.equippedCards = [CANONICAL_SHIELD];
    protector.runtime.resources.reaction = 1;
    protector.runtime.maxResources.reaction = 1;
    protector.runtime.equipment.off_hand = CANONICAL_SHIELD.id;

    const value = world({ actors: [attacker, target, protector] });
    raw(value).pendingResolution = {
      id: 'resolution:protection',
      type: 'protection_reaction',
      openedByCommandId: 'attack:protected',
      openedAtRevision: 0,
      deadlineLogicalClock: 1,
      sourceActorId: 'attacker',
      targetActorId: 'target',
      actionId: SYSTEM_ACTION_IDS.weaponAttack,
      facts: {
        factsSource: 'scenario',
        boardRevision: 1,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none',
        relation: 'enemy',
      },
      attackContinuationKind: 'weapon_melee',
      weaponHand: 'main',
      weaponCardId: 'card:attacker-weapon',
      pactBladeProjection: {},
      preRollDisadvantageReasons: [],
      protectionCandidates: [{
        factsSource: 'scenario',
        boardRevision: 1,
        protectorActorId: 'protector',
        protectorCanSeeAttacker: true,
        protectorDistanceToTargetFt: 5,
      }],
      remainingReactions: [],
      request: {
        id: 'request:protection',
        type: 'reaction',
        actorId: 'protector',
        trigger: {
          type: 'protection_before_attack',
          sourceActorId: 'attacker',
          targetActorId: 'target',
          actionId: SYSTEM_ACTION_IDS.weaponAttack,
          attackId: 'attack:protected',
        },
        options: [{ actionId: PROTECTION_2024_CAPABILITY_ID, label: 'Protection' }],
      },
    };

    expect(() => migrateWorldState(value)).toThrow(/malformed Pact Blade attack projection/);
  });

  it('does not resolve a legacy weapon continuation from absent Card collections', () => {
    const source = actor('source');
    source.runtime.equipment.main_hand = 'card:missing';
    const value = world({ actors: [source] });
    raw(value).pendingResolution = {
      id: 'resolution:legacy-weapon',
      type: 'attack_reaction',
      sourceActorId: 'source',
      actionId: SYSTEM_ACTION_IDS.weaponAttack,
      weaponHand: 'main',
      weaponCardId: 'card:missing',
    };

    expect(() => migrateWorldState(value)).toThrow(/must match the source equipped Card/);
  });
});
