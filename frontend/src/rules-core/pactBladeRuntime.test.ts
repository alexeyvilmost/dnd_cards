import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import {
  PACT_BLADE_CANONICAL_INTEGRATION_PLAN,
  PACT_BLADE_CATALOG_PROVENANCE,
  PACT_BLADE_RUNTIME_SCHEMA_VERSION,
  PACT_BLADE_TURN_PROVENANCE,
  PACT_BLADE_WORLD_PROVENANCE,
  createPactBladeCanonicalAttackIntegrationFixture,
  createPactBladeCanonicalWorldIntegrationFixture,
  createPactBladeRuntimeState,
  isPactBladeConjurableCard,
  pactBladeConjureCardIssue,
  pactBladeTransitionsToCanonicalJson,
  pactBladeWeaponCardSnapshot,
  replayPactBladeRuntime,
  replayPactBladeRuntimeFromJson,
  transitionPactBladeRuntime,
  type AdvancePactBladeDistanceCommand,
  type AppliedPactBladeRuntimeTransition,
  type PactBladeRuntimeBondCommand,
  type EndPactBladeOnOwnerDeathCommand,
  type PactBladeCatalogAuthority,
  type PactBladeRuntimeCommand,
  type PactBladeRuntimeRejectionCode,
  type PactBladeRuntimeState,
  type PactBladeRuntimeTransitionResult,
  type PactBladeTurnAuthority,
  type PactBladeWeaponObjectAuthority,
  type PactBladeWorldAuthority,
  type ProjectPactBladeAttackCommand,
  type RecordedPactBladeRuntimeTransition,
} from './pactBladeRuntime';
import type { WorldObjectState } from './worldObjects';
import { PACT_BLADE_PHB_2024_LIFECYCLE_POLICY } from './testing/pactBladePolicyFixtures';

const ACTOR = 'actor:warlock';
const SOURCE = 'EFF-pact-blade';
const ACTION = 'action:pact-blade-bond';
const HASH = 'sha256:micro-mvp-rules';

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function weaponCard(overrides: Partial<Card> = {}): Card {
  const card = {
    id: 'card:dagger',
    card_number: 'CARD-dagger',
    name: 'Dagger',
    type: 'weapon',
    weapon_type: 'dagger',
    damage_type: 'piercing',
    bonus_type: 'damage',
    bonus_value: '1d4',
    properties: ['finesse', 'light'],
    tags: ['Простое', 'Ближнее'],
    description: '',
    rarity: 'common',
    is_template: 'false',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
  const tags = (card.tags ?? []).map((value) => String(value).toLowerCase());
  const simple = tags.some((value) => value.includes('прост') || value.includes('simple'));
  const martial = tags.some((value) => value.includes('воин') || value.includes('martial'));
  const melee = tags.some((value) => value.includes('ближ') || value.includes('melee'));
  const ranged = tags.some((value) => value.includes('дальн') || value.includes('ranged'));
  const properties = (card.properties ?? []).map((value) => (
    String(value).trim().toLowerCase().replace(/[ -]+/g, '_')
  ));
  const profile: Record<string, unknown> = {
    weapon_type: card.weapon_type ?? '',
    proficiency_category: simple === martial ? 'invalid' : simple ? 'simple' : 'martial',
    attack_ability: properties.includes('finesse') ? 'finesse' : ranged ? 'dex' : 'str',
    damage_lines: [{ dice: card.bonus_value || '1d4', type: card.damage_type ?? '' }],
    default_attack_mode: melee === ranged ? 'invalid' : ranged ? 'ranged' : 'melee',
    attack_modes: ranged
      ? [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }]
      : [{ kind: 'melee', reach_ft: 5 }],
    properties,
    ...(properties.includes('heavy') ? {
      heavy: {
        minimum_ability_score: 13,
        ability_by_mode: { melee: 'str', ranged: 'dex' },
        consequence: 'attack_disadvantage',
      },
    } : {}),
    mastery_effect_id: `mastery:${card.id}`,
    ammo: properties.includes('ammunition') ? { card_id: 'card:ammunition' } : null,
    enchantment: {
      attack_bonus: typeof card.enchant_bonus === 'number' ? card.enchant_bonus : 0,
      damage_bonus: typeof card.enchant_bonus === 'number' ? card.enchant_bonus : 0,
      extra_damage_lines: [],
    },
    attunement: { required: card.requires_attunement === true },
  };
  if (properties.includes('versatile')) {
    profile.versatile_grip = { dice: card.bonus_value || '1d4', type: card.damage_type ?? '' };
  }
  return {
    ...card,
    mechanics: overrides.mechanics ?? { weapon_profile: profile },
  } as Card;
}

function catalog(cards: Card[] = [weaponCard()]): PactBladeCatalogAuthority {
  return {
    provenance: PACT_BLADE_CATALOG_PROVENANCE,
    rulesetContentHash: HASH,
    cards: jsonClone(cards),
  };
}

function mutableWeaponProfile(card: Card): Record<string, unknown> {
  return ((card.mechanics as Record<string, unknown>).weapon_profile) as Record<string, unknown>;
}

function worldObject(id: string, overrides: Partial<WorldObjectState> = {}): WorldObjectState {
  return {
    id,
    name: `Object ${id}`,
    kind: 'item',
    size: 'small',
    ...overrides,
  };
}

function objectRecord(input: {
  objectId?: string;
  cardId?: string;
  magical?: boolean;
  touchedBy?: string[];
  attunedToActorId?: string;
  bondedWarlockActorId?: string;
  object?: WorldObjectState;
} = {}): PactBladeWeaponObjectAuthority {
  const object = input.object ?? worldObject(input.objectId ?? 'object:magic-dagger', {
    ...(input.magical === false
      ? {}
      : { tags: ['magic_weapon'] }),
  });
  return {
    object,
    weaponCardId: input.cardId ?? 'card:dagger',
    touchedByActorIds: input.touchedBy ?? [ACTOR],
    ...(input.attunedToActorId ? { attunedToActorId: input.attunedToActorId } : {}),
    ...(input.bondedWarlockActorId
      ? { bondedWarlockActorId: input.bondedWarlockActorId }
      : {}),
  };
}

function world(
  weaponObjects: PactBladeWeaponObjectAuthority[] = [],
  worldRevision = 4,
): PactBladeWorldAuthority {
  return {
    provenance: PACT_BLADE_WORLD_PROVENANCE,
    rulesetContentHash: HASH,
    worldRevision,
    weaponObjects: jsonClone(weaponObjects),
  };
}

function turn(overrides: Partial<PactBladeTurnAuthority> = {}): PactBladeTurnAuthority {
  return {
    provenance: PACT_BLADE_TURN_PROVENANCE,
    turnRevision: 7,
    turnId: 'turn:warlock:1',
    activeActorId: ACTOR,
    bonusActionsRemaining: 1,
    ...overrides,
  };
}

function initialState(overrides: Partial<Parameters<typeof createPactBladeRuntimeState>[0]> = {}) {
  return createPactBladeRuntimeState({
    ownerActorId: ACTOR,
    sourceEntityId: SOURCE,
    bondActionId: ACTION,
    capabilitySourceEntityIds: ['CLASS-warlock', SOURCE],
    rulesetContentHash: HASH,
    lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
    ...overrides,
  });
}

function envelope(state: PactBladeRuntimeState) {
  return {
    schemaVersion: PACT_BLADE_RUNTIME_SCHEMA_VERSION,
    expectedRevision: state.revision,
    rulesetContentHash: HASH,
    actorId: ACTOR,
    sourceEntityId: SOURCE,
  } as const;
}

function conjureCommand(
  state: PactBladeRuntimeState,
  overrides: Partial<PactBladeRuntimeBondCommand> = {},
): PactBladeRuntimeBondCommand {
  return {
    ...envelope(state),
    type: 'BondPactBlade',
    commandId: `command:conjure:${state.revision}`,
    mode: 'conjure',
    weaponCardId: 'card:dagger',
    weaponObjectId: `object:conjured:${state.revision}`,
    catalog: catalog(),
    world: world([], 4 + state.revision),
    turn: turn({ turnRevision: 7 + state.revision, turnId: `turn:${state.revision}` }),
    ...overrides,
  };
}

function existingCommand(
  state: PactBladeRuntimeState,
  record = objectRecord(),
  overrides: Partial<PactBladeRuntimeBondCommand> = {},
): PactBladeRuntimeBondCommand {
  return {
    ...envelope(state),
    type: 'BondPactBlade',
    commandId: `command:existing:${state.revision}`,
    mode: 'touch_existing',
    weaponCardId: record.weaponCardId,
    weaponObjectId: record.object.id,
    catalog: catalog(),
    world: world([record], 4 + state.revision),
    turn: turn({ turnRevision: 7 + state.revision, turnId: `turn:${state.revision}` }),
    ...overrides,
  };
}

function applied(result: PactBladeRuntimeTransitionResult): AppliedPactBladeRuntimeTransition {
  expect(result.status).toBe('applied');
  return result as AppliedPactBladeRuntimeTransition;
}

function rejected(
  result: PactBladeRuntimeTransitionResult,
  code: PactBladeRuntimeRejectionCode,
  message?: RegExp,
) {
  expect(result.status).toBe('rejected');
  if (result.status !== 'rejected') throw new Error('Expected rejected Pact Blade transition');
  expect(result.code).toBe(code);
  if (message) expect(result.message).toMatch(message);
  return result;
}

function activeWorld(
  state: PactBladeRuntimeState,
  worldRevision = state.observedWorldRevision,
  overrides: Partial<PactBladeWeaponObjectAuthority> = {},
): PactBladeWorldAuthority {
  const active = state.activeBlade!;
  return world([{
    object: jsonClone(active.weaponObject),
    weaponCardId: active.weaponCardId,
    touchedByActorIds: [ACTOR],
    bondedWarlockActorId: ACTOR,
    ...overrides,
  }], worldRevision);
}

function attackCommand(
  state: PactBladeRuntimeState,
  overrides: Partial<ProjectPactBladeAttackCommand> = {},
): ProjectPactBladeAttackCommand {
  const active = state.activeBlade!;
  return {
    ...envelope(state),
    type: 'ProjectPactBladeAttack',
    commandId: `command:attack:${state.revision}`,
    weaponCardId: active.weaponCardId,
    weaponObjectId: active.weaponObject.id,
    abilityChoice: 'charisma',
    ordinaryAbility: 'str',
    damageType: 'normal',
    catalog: catalog(),
    world: activeWorld(state),
    ...overrides,
  };
}

function distanceCommand(
  state: PactBladeRuntimeState,
  distanceFt: number,
  elapsedSeconds: number,
  boardRevision: number,
  overrides: Partial<AdvancePactBladeDistanceCommand> = {},
): AdvancePactBladeDistanceCommand {
  const active = state.activeBlade!;
  return {
    ...envelope(state),
    type: 'AdvancePactBladeDistance',
    commandId: `command:distance:${state.revision}`,
    world: activeWorld(state),
    facts: {
      factsSource: 'board',
      boardRevision,
      actorId: ACTOR,
      weaponObjectId: active.weaponObject.id,
      distanceFt,
      elapsedSeconds,
    },
    ...overrides,
  };
}

function ownerDeathCommand(
  state: PactBladeRuntimeState,
  overrides: Partial<EndPactBladeOnOwnerDeathCommand> = {},
): EndPactBladeOnOwnerDeathCommand {
  return {
    ...envelope(state),
    type: 'EndPactBladeOnOwnerDeath',
    commandId: `command:owner-death:${state.revision}`,
    world: activeWorld(state),
    deathFact: {
      type: 'ActorDeathAdjudicated',
      provenance: 'canonical_actor_lifecycle',
      factId: `death:${state.revision}`,
      actorId: ACTOR,
      adjudicatedBy: 'system:test',
      observedAtWorldRevision: state.observedWorldRevision,
      rulesetContentHash: HASH,
    },
    ...overrides,
  };
}

function conjured(): AppliedPactBladeRuntimeTransition {
  const state = initialState();
  return applied(transitionPactBladeRuntime(state, conjureCommand(state)));
}

describe('canonical Pact of the Blade runtime', () => {
  it('uses the immutable weapon profile as the single conjuration eligibility oracle', () => {
    const melee = weaponCard();
    expect(pactBladeWeaponCardSnapshot(melee)).toMatchObject({
      id: 'card:dagger', range: 'melee', category: 'simple',
    });
    expect(pactBladeConjureCardIssue(melee)).toBeNull();
    expect(isPactBladeConjurableCard(melee)).toBe(true);

    const ranged = weaponCard({
      id: 'card:shortbow', card_number: 'CARD-shortbow', name: 'Shortbow',
      weapon_type: 'shortbow', properties: ['ammunition', 'two-handed'],
      tags: ['Простое', 'Дальнее'],
    });
    expect(pactBladeConjureCardIssue(ranged)).toMatch(/Melee weapon/);
    expect(isPactBladeConjurableCard(ranged)).toBe(false);

    const incomplete = weaponCard({ id: '' });
    expect(pactBladeConjureCardIssue(incomplete)).toMatch(/complete immutable weapon Card identity/);
    expect(isPactBladeConjurableCard(incomplete)).toBe(false);
  });

  it('creates an empty source/hash/revision authority and publishes the atomic integration contract', () => {
    expect(initialState()).toEqual({
      schemaVersion: 1,
      revision: 0,
      observedWorldRevision: 0,
      authority: {
        capabilityId: 'warlock.pact.blade',
        ownerActorId: ACTOR,
        sourceEntityId: SOURCE,
        bondActionId: ACTION,
        capabilitySourceEntityIds: ['CLASS-warlock', SOURCE],
        rulesetContentHash: HASH,
        lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      },
      activeBlade: null,
    });
    expect(initialState({ observedWorldRevision: 9 }).observedWorldRevision).toBe(9);
    expect(PACT_BLADE_CANONICAL_INTEGRATION_PLAN).toMatchObject({
      authority: expect.arrayContaining([
        expect.stringContaining('immutable rules catalog'),
        expect.stringContaining('canonical WorldState'),
      ]),
      atomicBondCommit: expect.arrayContaining([
        expect.stringContaining('consume exactly one Bonus Action'),
      ]),
      lifecycle: expect.stringContaining('declared separation threshold'),
    });

    expect(() => initialState({ ownerActorId: '' })).toThrow(/requires actor/);
    expect(() => initialState({ sourceEntityId: 'missing' })).toThrow(/not owned/);
    expect(() => initialState({ capabilitySourceEntityIds: [SOURCE, ' '] })).toThrow(/non-blank/);
    expect(() => initialState({ observedWorldRevision: -1 })).toThrow(/revisions/);
  });

  it('conjures a unique immutable Simple/Martial Melee Card as a source-owned WorldObject for one Bonus Action', () => {
    const state = initialState();
    const command = conjureCommand(state, {
      catalog: catalog([weaponCard({
        id: 'card:longsword', card_number: 'CARD-longsword', name: 'Longsword',
        weapon_type: 'longsword', damage_type: 'slashing', properties: ['versatile'],
        tags: ['Martial', 'Melee'],
      })]),
      weaponCardId: 'card:longsword',
      weaponObjectId: 'object:pact-longsword',
    });
    const beforeState = jsonClone(state);
    const beforeCommand = jsonClone(command);
    const result = applied(transitionPactBladeRuntime(state, command));
    expect(state).toEqual(beforeState);
    expect(command).toEqual(beforeCommand);
    expect(result.state).toMatchObject({ revision: 1, observedWorldRevision: 4 });
    expect(result.state.activeBlade).toMatchObject({
      weaponCardId: 'card:longsword',
      weaponCard: {
        id: 'card:longsword', category: 'martial', range: 'melee',
        weaponType: 'longsword', normalDamageType: 'slashing',
      },
      invocation: {
        kind: 'blade', sourceEntityId: SOURCE, ownerActorId: ACTOR,
        bondActionId: ACTION,
        activeBond: {
          weaponObjectId: 'object:pact-longsword', conjured: true,
          bondedAtRevision: 4, continuousSeparationSeconds: 0,
        },
      },
      weaponObject: {
        id: 'object:pact-longsword', ownerActorId: ACTOR, carriedByActorId: ACTOR,
        sourceActorId: ACTOR, sourceActionId: SOURCE,
        tags: expect.arrayContaining(['pact_weapon', 'spellcasting_focus']),
      },
      boundAtRulesetContentHash: HASH,
      lastBoardRevision: null,
    });
    expect(result.transition.event).toMatchObject({
      type: 'PactBladeBonded', revision: 1, worldRevision: 4,
      actionCost: { kind: 'bonus_action', amount: 1 },
      removedWorldObjectIds: [], clearPactBondObjectIds: [],
      setPactBondObjectId: 'object:pact-longsword',
      upsertWeaponBridges: [{
        weaponObjectId: 'object:pact-longsword', weaponCardId: 'card:longsword',
      }],
    });
    const fixture = createPactBladeCanonicalWorldIntegrationFixture(result.transition);
    expect(fixture).toMatchObject({
      commandType: 'UseAction', expectedActorRevision: 0, expectedWorldRevision: 4,
      actorId: ACTOR, sourceEntityId: SOURCE,
      consumeActionEconomy: [{ kind: 'bonus_action', amount: 1 }],
      removeObjectIds: [],
      upsertObjects: [expect.objectContaining({ id: 'object:pact-longsword' })],
      upsertWeaponBridges: [{
        weaponObjectId: 'object:pact-longsword', weaponCardId: 'card:longsword',
      }],
      pactState: expect.objectContaining({ kind: 'blade' }),
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('projects proficiency/focus and every per-attack ordinary/CHA plus physical/necrotic/psychic/radiant choice', () => {
    const first = conjured();
    let state = first.state;
    const transitions: RecordedPactBladeRuntimeTransition[] = [first.transition];
    const cases = [
      { abilityChoice: 'ordinary' as const, ordinaryAbility: 'str' as const, damageType: 'normal' as const, ability: 'str', damage: 'piercing' },
      { abilityChoice: 'ordinary' as const, ordinaryAbility: 'dex' as const, damageType: 'necrotic' as const, ability: 'dex', damage: 'necrotic' },
      { abilityChoice: 'charisma' as const, ordinaryAbility: 'str' as const, damageType: 'psychic' as const, ability: 'cha', damage: 'psychic' },
      { abilityChoice: 'charisma' as const, ordinaryAbility: 'dex' as const, damageType: 'radiant' as const, ability: 'cha', damage: 'radiant' },
    ];
    for (const item of cases) {
      const result = applied(transitionPactBladeRuntime(state, attackCommand(state, {
        commandId: `command:attack:${item.abilityChoice}:${item.damageType}`,
        abilityChoice: item.abilityChoice,
        ordinaryAbility: item.ordinaryAbility,
        damageType: item.damageType,
      })));
      expect(result.transition.event).toMatchObject({
        type: 'PactBladeAttackProjected',
        projection: {
          attackAbility: item.ability, damageAbility: item.ability, damageType: item.damage,
          proficient: true, spellcastingFocus: true,
        },
      });
      const fixture = createPactBladeCanonicalAttackIntegrationFixture(result.transition);
      expect(fixture).toEqual({
        commandType: 'ResolveWeaponAttack',
        expectedActorRevision: result.state.revision - 1,
        expectedWorldRevision: result.state.observedWorldRevision,
        actorId: ACTOR,
        sourceEntityId: SOURCE,
        immutableWeaponCardId: 'card:dagger',
        weaponObjectId: 'object:conjured:0',
        attackAbility: item.ability,
        damageAbility: item.ability,
        damageType: item.damage,
        proficient: true,
        spellcastingFocus: true,
      });
      transitions.push(result.transition);
      state = result.state;
    }
    const json = pactBladeTransitionsToCanonicalJson(transitions);
    expect(replayPactBladeRuntime(initialState(), transitions)).toEqual(state);
    expect(replayPactBladeRuntimeFromJson(initialState(), json)).toEqual(state);
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(transitions)));
  });

  it('replaces a conjured object with a touched existing magic weapon and accepts self-attunement/self-bond', () => {
    const first = conjured();
    const existing = objectRecord({
      objectId: 'object:magic-dagger',
      attunedToActorId: ACTOR,
      bondedWarlockActorId: ACTOR,
    });
    const command = existingCommand(first.state, existing, {
      world: world([
        {
          object: first.state.activeBlade!.weaponObject,
          weaponCardId: first.state.activeBlade!.weaponCardId,
          touchedByActorIds: [],
          bondedWarlockActorId: ACTOR,
        },
        existing,
      ], 9),
    });
    const second = applied(transitionPactBladeRuntime(first.state, command));
    expect(second.state.activeBlade).toMatchObject({
      weaponCardId: 'card:dagger',
      weaponObject: { id: 'object:magic-dagger' },
      invocation: { activeBond: { conjured: false, bondedAtRevision: 9 } },
    });
    expect(second.transition.event).toMatchObject({
      type: 'PactBladeBonded',
      endedPreviousBond: { weaponObjectId: 'object:conjured:0', conjured: true },
      removedWorldObjectIds: ['object:conjured:0'],
      removedWeaponBridgeObjectIds: ['object:conjured:0'],
      upsertWorldObjects: [], upsertWeaponBridges: [],
      clearPactBondObjectIds: ['object:conjured:0'],
      setPactBondObjectId: 'object:magic-dagger',
    });
    expect(createPactBladeCanonicalWorldIntegrationFixture(second.transition)).toMatchObject({
      removeObjectIds: ['object:conjured:0'],
      removeWeaponBridgeObjectIds: ['object:conjured:0'],
      setPactBondObjectId: 'object:magic-dagger',
    });

    const newCard = weaponCard({
      id: 'card:shortsword', card_number: 'CARD-shortsword', name: 'Shortsword',
      weapon_type: 'shortsword', tags: ['martial_melee'],
    });
    const replacement = applied(transitionPactBladeRuntime(second.state, conjureCommand(second.state, {
      commandId: 'command:replace-existing-with-conjured',
      weaponCardId: newCard.id,
      weaponObjectId: 'object:new-conjured',
      catalog: catalog([newCard]),
      world: world([{
        object: existing.object,
        weaponCardId: existing.weaponCardId,
        touchedByActorIds: [],
        bondedWarlockActorId: ACTOR,
      }], 10),
    })));
    expect(replacement.transition.event).toMatchObject({
      removedWorldObjectIds: [], removedWeaponBridgeObjectIds: [],
      clearPactBondObjectIds: ['object:magic-dagger'],
      upsertWorldObjects: [expect.objectContaining({ id: 'object:new-conjured' })],
    });
  });

  it('bonds a touched magic ranged weapon but still rejects conjuring that ranged Card', () => {
    const magicLongbow = weaponCard({
      id: 'card:magic-longbow',
      card_number: 'CARD-magic-longbow',
      name: 'Magic Longbow',
      weapon_type: 'longbow',
      bonus_value: '1d8',
      properties: ['ammunition', 'heavy', 'two-handed'],
      tags: ['Martial', 'Ranged', 'Magic Weapon'],
      enchant_bonus: 1,
    });
    const record = objectRecord({
      objectId: 'object:magic-longbow',
      cardId: magicLongbow.id,
      magical: false,
    });
    const state = initialState();
    const bonded = applied(transitionPactBladeRuntime(state, existingCommand(state, record, {
      catalog: catalog([magicLongbow]),
    })));
    expect(bonded.state.activeBlade).toMatchObject({
      weaponCardId: magicLongbow.id,
      weaponCard: { category: 'martial', range: 'ranged', weaponType: 'longbow' },
      invocation: { activeBond: { conjured: false } },
    });

    const rejectedConjure = rejected(transitionPactBladeRuntime(initialState(), conjureCommand(initialState(), {
      weaponCardId: magicLongbow.id,
      catalog: catalog([magicLongbow]),
    })), 'IllegalWeapon', /conjured Pact Blade.*Melee/);
    expect(rejectedConjure.state.activeBlade).toBeNull();
  });

  it('derives magic from immutable Card/object facts instead of accepting a command boolean', () => {
    const variants = [
      objectRecord({ objectId: 'magic:object-tag', magical: false, object: worldObject('magic:object-tag', { tags: ['magic weapon'] }) }),
    ];
    for (const record of variants) {
      const state = initialState();
      expect(transitionPactBladeRuntime(state, existingCommand(state, record)).status).toBe('applied');
    }
    const magicalCards = [
      weaponCard({ enchant_bonus: 1 }),
      weaponCard({ requires_attunement: true }),
    ];
    for (const [index, card] of magicalCards.entries()) {
      const state = initialState();
      const record = objectRecord({
        objectId: `magic:card:${index}`, magical: false, object: worldObject(`magic:card:${index}`),
      });
      const command = existingCommand(state, record, { catalog: catalog([card]) });
      expect(transitionPactBladeRuntime(state, command).status).toBe('applied');
    }
    const legacyMagicTag = weaponCard({ tags: ['Простое', 'Ближнее', 'Магическое'] });
    const legacyRecord = objectRecord({
      objectId: 'ordinary:legacy-tag', magical: false, object: worldObject('ordinary:legacy-tag'),
    });
    rejected(
      transitionPactBladeRuntime(
        initialState(),
        existingCommand(initialState(), legacyRecord, { catalog: catalog([legacyMagicTag]) }),
      ),
      'MagicWeaponRequired',
      /must be magical/,
    );
    const auraOnly = objectRecord({
      objectId: 'ordinary:light-aura',
      magical: false,
      object: worldObject('ordinary:light-aura', {
        magicalAura: { school: 'evocation', createdBySpell: true, visible: true },
      }),
    });
    rejected(
      transitionPactBladeRuntime(initialState(), existingCommand(initialState(), auraOnly)),
      'MagicWeaponRequired',
      /must be magical/,
    );
  });

  it.each([
    {
      label: 'unknown Card',
      change: (command: PactBladeRuntimeBondCommand) => { command.weaponCardId = 'missing'; },
      code: 'IllegalWeapon', message: /Unknown immutable/,
    },
    {
      label: 'non-weapon Card',
      change: (command: PactBladeRuntimeBondCommand) => { command.catalog.cards[0].type = 'shield'; },
      code: 'IllegalWeapon', message: /complete immutable weapon/,
    },
    {
      label: 'blank Card identity',
      change: (command: PactBladeRuntimeBondCommand) => { command.catalog.cards[0].card_number = ''; },
      code: 'IllegalWeapon', message: /complete immutable weapon/,
    },
    {
      label: 'missing weapon type',
      change: (command: PactBladeRuntimeBondCommand) => {
        mutableWeaponProfile(command.catalog.cards[0]).weapon_type = '';
      },
      code: 'IllegalWeapon', message: /weapon_profile\.weapon_type/,
    },
    {
      label: 'missing physical damage type',
      change: (command: PactBladeRuntimeBondCommand) => {
        const profile = mutableWeaponProfile(command.catalog.cards[0]);
        (profile.damage_lines as Record<string, unknown>[])[0].type = '';
      },
      code: 'IllegalWeapon', message: /damage_lines\[0\]\.type/,
    },
    {
      label: 'missing explicit category',
      change: (command: PactBladeRuntimeBondCommand) => {
        mutableWeaponProfile(command.catalog.cards[0]).proficiency_category = 'invalid';
      },
      code: 'IllegalWeapon', message: /proficiency_category/,
    },
    {
      label: 'both categories',
      change: (command: PactBladeRuntimeBondCommand) => {
        mutableWeaponProfile(command.catalog.cards[0]).proficiency_category = ['simple', 'martial'];
      },
      code: 'IllegalWeapon', message: /proficiency_category/,
    },
    {
      label: 'ranged Card',
      change: (command: PactBladeRuntimeBondCommand) => {
        const profile = mutableWeaponProfile(command.catalog.cards[0]);
        profile.default_attack_mode = 'ranged';
        profile.attack_modes = [{ kind: 'ranged', normal_ft: 20, long_ft: 60 }];
        profile.properties = ['finesse', 'light', 'thrown'];
      },
      code: 'IllegalWeapon', message: /conjured Pact Blade.*Melee/,
    },
    {
      label: 'contradictory melee/ranged Card',
      change: (command: PactBladeRuntimeBondCommand) => {
        mutableWeaponProfile(command.catalog.cards[0]).attack_modes = [
          { kind: 'melee', reach_ft: 5 },
          { kind: 'melee', reach_ft: 10 },
        ];
      },
      code: 'IllegalWeapon', message: /duplicate kinds/,
    },
    {
      label: 'blank new object identity',
      change: (command: PactBladeRuntimeBondCommand) => { command.weaponObjectId = ''; },
      code: 'WorldObjectConflict', message: /unique WorldObject/,
    },
    {
      label: 'colliding conjured object identity',
      change: (command: PactBladeRuntimeBondCommand) => {
        command.world.weaponObjects = [objectRecord({ objectId: command.weaponObjectId })];
      },
      code: 'WorldObjectConflict', message: /already exists/,
    },
    {
      label: 'invalid mode',
      change: (command: PactBladeRuntimeBondCommand) => { command.mode = 'invalid' as 'conjure'; },
      code: 'InvalidCommand', message: /mode/,
    },
  ] as const)('rejects $label without mutating state', ({ change, code, message }) => {
    const state = initialState();
    const before = jsonClone(state);
    const command = conjureCommand(state);
    change(command);
    const result = rejected(transitionPactBladeRuntime(state, command), code, message);
    expect(result.state).toEqual(before);
    expect(state).toEqual(before);
  });

  it.each([
    {
      label: 'missing existing object',
      mutate: (_record: PactBladeWeaponObjectAuthority, command: PactBladeRuntimeBondCommand) => {
        command.world.weaponObjects = [];
      },
      code: 'WeaponMismatch', message: /does not bridge/,
    },
    {
      label: 'wrong Card bridge',
      mutate: (record: PactBladeWeaponObjectAuthority) => { record.weaponCardId = 'card:other'; },
      code: 'WeaponMismatch', message: /does not bridge/,
    },
    {
      label: 'not touched',
      mutate: (record: PactBladeWeaponObjectAuthority) => { record.touchedByActorIds = []; },
      code: 'TouchRequired', message: /not touching/,
    },
    {
      label: 'mundane existing weapon',
      mutate: (record: PactBladeWeaponObjectAuthority) => { delete record.object.tags; },
      code: 'MagicWeaponRequired', message: /must be magical/,
    },
    {
      label: 'foreign attunement',
      mutate: (record: PactBladeWeaponObjectAuthority) => { record.attunedToActorId = 'actor:wizard'; },
      code: 'AttunedToAnother', message: /another creature/,
    },
    {
      label: 'foreign Warlock bond',
      mutate: (record: PactBladeWeaponObjectAuthority) => { record.bondedWarlockActorId = 'actor:rival'; },
      code: 'BondedToAnother', message: /another Warlock/,
    },
  ] as const)('fails closed for $label on an existing weapon', ({ mutate, code, message }) => {
    const state = initialState();
    const record = objectRecord();
    const command = existingCommand(state, record);
    mutate(command.world.weaponObjects[0], command);
    rejected(transitionPactBladeRuntime(state, command), code, message);
  });

  it('rejects rebinding the same object and replacement when the prior Card↔WorldObject bridge disappeared', () => {
    const first = conjured();
    rejected(transitionPactBladeRuntime(first.state, conjureCommand(first.state, {
      weaponObjectId: first.state.activeBlade!.weaponObject.id,
      world: activeWorld(first.state, 5),
    })), 'WorldObjectConflict', /already.*active/);
    rejected(transitionPactBladeRuntime(first.state, conjureCommand(first.state, {
      weaponObjectId: 'object:replacement',
      world: world([], 5),
    })), 'WeaponMismatch', /prior active/);
  });

  it.each([
    {
      label: 'catalog provenance',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.catalog.provenance = 'bad' as typeof PACT_BLADE_CATALOG_PROVENANCE; },
      code: 'InvalidProvenance', message: /catalog provenance/,
    },
    {
      label: 'catalog hash',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.catalog.rulesetContentHash = 'other'; },
      code: 'InvalidProvenance', message: /catalog hash/,
    },
    {
      label: 'catalog array',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.catalog.cards = null as unknown as Card[]; },
      code: 'InvalidProvenance', message: /cards must be an array/,
    },
    {
      label: 'blank catalog id',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.catalog.cards[0].id = ''; },
      code: 'InvalidProvenance', message: /non-blank and unique/,
    },
    {
      label: 'duplicate catalog id',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.catalog.cards.push(jsonClone(command.catalog.cards[0])); },
      code: 'InvalidProvenance', message: /non-blank and unique/,
    },
    {
      label: 'world provenance',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.world.provenance = 'bad' as typeof PACT_BLADE_WORLD_PROVENANCE; },
      code: 'InvalidProvenance', message: /WorldState provenance/,
    },
    {
      label: 'world hash',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.world.rulesetContentHash = 'other'; },
      code: 'InvalidProvenance', message: /WorldState hash/,
    },
    {
      label: 'world revision',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.world.worldRevision = -1; },
      code: 'InvalidProvenance', message: /revision/,
    },
    {
      label: 'world array',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.world.weaponObjects = null as unknown as PactBladeWeaponObjectAuthority[]; },
      code: 'InvalidProvenance', message: /must be an array/,
    },
    {
      label: 'duplicate object ids',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        const record = objectRecord({ objectId: 'duplicate' });
        command.world.weaponObjects = [record, jsonClone(record)];
      },
      code: 'InvalidProvenance', message: /non-blank and unique/,
    },
    {
      label: 'invalid object bridge',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        command.world.weaponObjects = [objectRecord({ cardId: '' })];
      },
      code: 'InvalidProvenance', message: /item shape/,
    },
    {
      label: 'invalid object item kind',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        const record = objectRecord(); record.object.kind = 'environment';
        command.world.weaponObjects = [record];
      },
      code: 'InvalidProvenance', message: /item shape/,
    },
    {
      label: 'invalid touch array',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        const record = objectRecord(); record.touchedByActorIds = ['z', 'a'];
        command.world.weaponObjects = [record];
      },
      code: 'InvalidProvenance', message: /touch facts/,
    },
    {
      label: 'blank attunement identity',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        const record = objectRecord(); record.attunedToActorId = '';
        command.world.weaponObjects = [record];
      },
      code: 'InvalidProvenance', message: /attunement or bond identity/,
    },
    {
      label: 'blank bond identity',
      mutate: (command: PactBladeRuntimeBondCommand) => {
        const record = objectRecord(); record.bondedWarlockActorId = '';
        command.world.weaponObjects = [record];
      },
      code: 'InvalidProvenance', message: /attunement or bond identity/,
    },
  ] as const)('rejects invalid $label authority', ({ mutate, code, message }) => {
    const state = initialState();
    const command = conjureCommand(state);
    mutate(command);
    rejected(transitionPactBladeRuntime(state, command), code, message);
  });

  it.each([
    {
      label: 'turn provenance',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.provenance = 'bad' as typeof PACT_BLADE_TURN_PROVENANCE; },
      message: /turn-state provenance/,
    },
    {
      label: 'turn revision',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.turnRevision = -1; },
      message: /valid revision/,
    },
    {
      label: 'turn identity',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.turnId = ''; },
      message: /turn identity/,
    },
    {
      label: 'inactive actor',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.activeActorId = 'actor:wizard'; },
      message: /active actor/,
    },
    {
      label: 'spent Bonus Action',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.bonusActionsRemaining = 0; },
      message: /available Bonus Action/,
    },
    {
      label: 'fractional action count',
      mutate: (command: PactBladeRuntimeBondCommand) => { command.turn.bonusActionsRemaining = 1.5; },
      message: /available Bonus Action/,
    },
  ] as const)('enforces $label', ({ mutate, message }) => {
    const state = initialState();
    const command = conjureCommand(state);
    mutate(command);
    rejected(transitionPactBladeRuntime(state, command), 'TurnUnavailable', message);
  });

  it('rejects stale world and every invalid command envelope/authority discriminator', () => {
    const current = initialState({ observedWorldRevision: 5 });
    rejected(transitionPactBladeRuntime(current, conjureCommand(current, {
      world: world([], 4),
    })), 'WorldRevisionConflict', /stale/);

    const mutations: Array<{
      code: PactBladeRuntimeRejectionCode;
      mutate: (command: PactBladeRuntimeBondCommand) => void;
    }> = [
      { code: 'InvalidCommand', mutate: (command) => { command.schemaVersion = 2 as 1; } },
      { code: 'InvalidCommand', mutate: (command) => { command.commandId = ''; } },
      { code: 'InvalidCommand', mutate: (command) => { command.expectedRevision = -1; } },
      { code: 'RevisionConflict', mutate: (command) => { command.expectedRevision = 2; } },
      { code: 'AuthorityMismatch', mutate: (command) => { command.actorId = 'actor:wizard'; } },
      { code: 'AuthorityMismatch', mutate: (command) => { command.sourceEntityId = 'other'; } },
      { code: 'RulesetMismatch', mutate: (command) => { command.rulesetContentHash = 'other'; } },
    ];
    for (const { code, mutate } of mutations) {
      const state = initialState();
      const command = conjureCommand(state);
      mutate(command);
      rejected(transitionPactBladeRuntime(state, command), code);
    }
    const state = initialState();
    const unknown = {
      ...conjureCommand(state),
      type: 'UnknownPactBladeCommand',
    } as unknown as PactBladeRuntimeCommand;
    rejected(transitionPactBladeRuntime(state, unknown), 'InvalidCommand', /Unknown/);
  });

  it('fails closed for malformed persisted state before evaluating a command', () => {
    const base = initialState();
    const malformed: Array<(state: PactBladeRuntimeState) => void> = [
      (state) => { state.schemaVersion = 2 as 1; },
      (state) => { state.revision = -1; },
      (state) => { state.observedWorldRevision = -1; },
      (state) => { state.authority.capabilityId = 'bad' as 'warlock.pact.blade'; },
      (state) => { state.authority.ownerActorId = ''; },
      (state) => { state.authority.lifecyclePolicy.separationDistanceFt = -1; },
      (state) => { state.authority.capabilitySourceEntityIds = ['other']; },
      (state) => { state.authority.capabilitySourceEntityIds = [SOURCE, SOURCE]; },
    ];
    for (const mutate of malformed) {
      const state = jsonClone(base);
      mutate(state);
      rejected(transitionPactBladeRuntime(state, conjureCommand(base)), 'InvalidState');
    }

    const bonded = conjured().state;
    const activeMutations: Array<(state: PactBladeRuntimeState) => void> = [
      (state) => { state.activeBlade!.invocation.ownerActorId = 'other'; },
      (state) => { state.activeBlade!.weaponCard.tags = ['melee']; },
      (state) => { state.activeBlade!.weaponCardId = 'other'; },
      (state) => { state.activeBlade!.invocation.activeBond!.bondedAtRevision = 99; },
      (state) => { state.activeBlade!.invocation.activeBond!.continuousSeparationSeconds = 60; },
      (state) => { state.activeBlade!.boundAtRulesetContentHash = 'other'; },
      (state) => { state.activeBlade!.lastBoardRevision = -1; },
      (state) => { state.activeBlade!.weaponObject.ownerActorId = 'other'; },
    ];
    for (const mutate of activeMutations) {
      const state = jsonClone(bonded);
      mutate(state);
      rejected(transitionPactBladeRuntime(state, attackCommand(bonded)), 'InvalidState');
    }
  });

  it.each([
    {
      label: 'wrong Card id',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.weaponCardId = 'card:other'; },
      code: 'IllegalWeapon', message: /Unknown immutable/,
    },
    {
      label: 'wrong object id',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.weaponObjectId = 'object:other'; },
      code: 'WeaponMismatch', message: /does not use/,
    },
    {
      label: 'changed immutable Card',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.catalog.cards[0].name = 'Forged'; },
      code: 'WeaponMismatch', message: /immutable/,
    },
    {
      label: 'DEX on non-Finesse weapon',
      mutate: (command: ProjectPactBladeAttackCommand) => {
        command.ordinaryAbility = 'dex';
        mutableWeaponProfile(command.catalog.cards[0]).properties = [];
      },
      code: 'WeaponMismatch', message: /immutable/,
    },
    {
      label: 'illegal ability selector',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.abilityChoice = 'wisdom' as 'charisma'; },
      code: 'IllegalAttackChoice', message: /ability/,
    },
    {
      label: 'illegal ordinary ability',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.ordinaryAbility = 'int' as 'str'; },
      code: 'IllegalAttackChoice', message: /ability/,
    },
    {
      label: 'illegal damage type',
      mutate: (command: ProjectPactBladeAttackCommand) => { command.damageType = 'fire' as 'normal'; },
      code: 'IllegalAttackChoice', message: /damage/,
    },
  ] as const)('rejects attack with $label', ({ mutate, code, message }) => {
    const state = conjured().state;
    const command = attackCommand(state);
    mutate(command);
    rejected(transitionPactBladeRuntime(state, command), code, message);
  });

  it('rejects attacks without a bond, a missing/foreign world bridge, or stale world provenance', () => {
    const empty = initialState();
    const fake = attackCommand(conjured().state);
    fake.expectedRevision = 0;
    rejected(transitionPactBladeRuntime(empty, fake), 'BladeUnavailable');

    const state = conjured().state;
    rejected(transitionPactBladeRuntime(state, attackCommand(state, {
      world: world([], state.observedWorldRevision),
    })), 'WeaponMismatch', /bridge/);
    rejected(transitionPactBladeRuntime(state, attackCommand(state, {
      world: activeWorld(state, state.observedWorldRevision, { bondedWarlockActorId: 'actor:rival' }),
    })), 'BondedToAnother');
    rejected(transitionPactBladeRuntime(state, attackCommand(state, {
      world: activeWorld(state, state.observedWorldRevision - 1),
    })), 'WorldRevisionConflict');
  });

  it('applies the exact continuous >5 ft lifecycle, resets at 5 ft, and removes a conjured object at 60 seconds', () => {
    const first = conjured();
    const after30 = applied(transitionPactBladeRuntime(first.state, distanceCommand(first.state, 5.0001, 30, 1)));
    expect(after30.state.activeBlade?.invocation.activeBond?.continuousSeparationSeconds).toBe(30);
    expect(after30.transition.event).toMatchObject({
      type: 'PactBladeDistanceAdvanced', bondEnded: false,
      activeBlade: { lastBoardRevision: 1 },
      removedWorldObjectIds: [], removedWeaponBridgeObjectIds: [],
    });
    const afterReset = applied(transitionPactBladeRuntime(after30.state, distanceCommand(after30.state, 5, 10, 2)));
    expect(afterReset.state.activeBlade?.invocation.activeBond?.continuousSeparationSeconds).toBe(0);
    const after59 = applied(transitionPactBladeRuntime(afterReset.state, distanceCommand(afterReset.state, 6, 59.999, 3)));
    expect(after59.state.activeBlade?.invocation.activeBond?.continuousSeparationSeconds).toBe(59.999);
    const ended = applied(transitionPactBladeRuntime(after59.state, distanceCommand(after59.state, 6, 0.001, 4)));
    expect(ended.state.activeBlade).toBeNull();
    expect(ended.transition.event).toMatchObject({
      type: 'PactBladeDistanceAdvanced', bondEnded: true,
      activeBlade: null,
      removedWorldObjectIds: ['object:conjured:0'],
      removedWeaponBridgeObjectIds: ['object:conjured:0'],
      pactState: { kind: 'blade', bondActionId: ACTION, activeBond: null },
    });
    expect(createPactBladeCanonicalWorldIntegrationFixture(ended.transition)).toEqual({
      commandType: 'AdvanceExplicitTime',
      expectedActorRevision: ended.state.revision - 1,
      expectedWorldRevision: ended.state.observedWorldRevision,
      actorId: ACTOR,
      sourceEntityId: SOURCE,
      consumeActionEconomy: [],
      removeObjectIds: ['object:conjured:0'],
      upsertObjects: [],
      removeWeaponBridgeObjectIds: ['object:conjured:0'],
      upsertWeaponBridges: [],
      clearPactBondObjectIds: ['object:conjured:0'],
      setPactBondObjectId: null,
      pactState: expect.objectContaining({ activeBond: null }),
    });

    const keptFixture = createPactBladeCanonicalWorldIntegrationFixture(after30.transition);
    expect(keptFixture).toMatchObject({
      commandType: 'AdvanceExplicitTime', removeObjectIds: [],
      clearPactBondObjectIds: [], setPactBondObjectId: 'object:conjured:0',
      pactState: { activeBond: { continuousSeparationSeconds: 30 } },
    });
  });

  it('ends an existing bond without deleting the physical magic weapon', () => {
    const state = initialState();
    const bound = applied(transitionPactBladeRuntime(state, existingCommand(state)));
    const ended = applied(transitionPactBladeRuntime(bound.state, distanceCommand(bound.state, 10, 60, 1)));
    expect(ended.state.activeBlade).toBeNull();
    expect(ended.transition.event).toMatchObject({
      bondEnded: true, removedWorldObjectIds: [], removedWeaponBridgeObjectIds: [],
    });
    expect(createPactBladeCanonicalWorldIntegrationFixture(ended.transition)).toMatchObject({
      removeObjectIds: [], removeWeaponBridgeObjectIds: [],
      clearPactBondObjectIds: ['object:magic-dagger'], setPactBondObjectId: null,
    });
  });

  it.each([
    {
      label: 'unknown facts provenance',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.factsSource = 'client' as 'board'; },
    },
    {
      label: 'negative board revision',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.boardRevision = -1; },
    },
    {
      label: 'wrong actor',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.actorId = 'actor:wizard'; },
    },
    {
      label: 'wrong object',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.weaponObjectId = 'object:other'; },
    },
    {
      label: 'negative distance',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.distanceFt = -1; },
    },
    {
      label: 'non-finite distance',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.distanceFt = Number.NaN; },
    },
    {
      label: 'negative elapsed time',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.elapsedSeconds = -1; },
    },
    {
      label: 'non-finite elapsed time',
      mutate: (command: AdvancePactBladeDistanceCommand) => { command.facts.elapsedSeconds = Number.POSITIVE_INFINITY; },
    },
  ] as const)('rejects distance facts with $label', ({ mutate }) => {
    const state = conjured().state;
    const command = distanceCommand(state, 6, 1, 1);
    mutate(command);
    rejected(transitionPactBladeRuntime(state, command), 'InvalidDistanceFacts');
  });

  it('rejects distance lifecycle without a bond, with stale board/world facts, missing bridge, or foreign bond', () => {
    const empty = initialState();
    const fake = distanceCommand(conjured().state, 6, 1, 1);
    fake.expectedRevision = 0;
    rejected(transitionPactBladeRuntime(empty, fake), 'BladeUnavailable');

    const first = conjured();
    const advanced = applied(transitionPactBladeRuntime(first.state, distanceCommand(first.state, 6, 1, 2)));
    rejected(transitionPactBladeRuntime(advanced.state, distanceCommand(advanced.state, 6, 1, 1)), 'InvalidDistanceFacts', /stale/);
    rejected(transitionPactBladeRuntime(advanced.state, distanceCommand(advanced.state, 6, 1, 3, {
      world: world([], advanced.state.observedWorldRevision),
    })), 'WeaponMismatch');
    rejected(transitionPactBladeRuntime(advanced.state, distanceCommand(advanced.state, 6, 1, 3, {
      world: activeWorld(advanced.state, advanced.state.observedWorldRevision, { bondedWarlockActorId: 'actor:rival' }),
    })), 'BondedToAnother');
    rejected(transitionPactBladeRuntime(advanced.state, distanceCommand(advanced.state, 6, 1, 3, {
      world: activeWorld(advanced.state, advanced.state.observedWorldRevision - 1),
    })), 'WorldRevisionConflict');
  });

  it('ends the bond only from an explicit owner-death lifecycle fact and removes only conjured objects', () => {
    const conjuredBlade = conjured();
    const ended = applied(transitionPactBladeRuntime(
      conjuredBlade.state,
      ownerDeathCommand(conjuredBlade.state),
    ));
    expect(ended.state.activeBlade).toBeNull();
    expect(ended.transition.event).toMatchObject({
      type: 'PactBladeEndedOnOwnerDeath',
      deathFact: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle', actorId: ACTOR,
      },
      previousBond: { weaponObjectId: 'object:conjured:0', conjured: true },
      removedWorldObjectIds: ['object:conjured:0'],
      removedWeaponBridgeObjectIds: ['object:conjured:0'],
      pactState: { activeBond: null },
    });
    expect(createPactBladeCanonicalWorldIntegrationFixture(ended.transition)).toMatchObject({
      commandType: 'ObserveActorDeath',
      removeObjectIds: ['object:conjured:0'],
      clearPactBondObjectIds: ['object:conjured:0'],
      setPactBondObjectId: null,
    });

    const initial = initialState();
    const existing = applied(transitionPactBladeRuntime(initial, existingCommand(initial)));
    const existingEnded = applied(transitionPactBladeRuntime(
      existing.state,
      ownerDeathCommand(existing.state),
    ));
    expect(existingEnded.transition.event).toMatchObject({
      type: 'PactBladeEndedOnOwnerDeath',
      removedWorldObjectIds: [], removedWeaponBridgeObjectIds: [],
    });
  });

  it.each([
    {
      label: 'unknown provenance',
      mutate: (command: EndPactBladeOnOwnerDeathCommand) => {
        command.deathFact.provenance = 'client' as 'canonical_actor_lifecycle';
      },
    },
    {
      label: 'wrong world revision',
      mutate: (command: EndPactBladeOnOwnerDeathCommand) => {
        command.deathFact.observedAtWorldRevision = -1;
      },
    },
    {
      label: 'wrong owner',
      mutate: (command: EndPactBladeOnOwnerDeathCommand) => {
        command.deathFact.actorId = 'actor:other';
      },
    },
    {
      label: 'wrong fact type',
      mutate: (command: EndPactBladeOnOwnerDeathCommand) => {
        command.deathFact.type = 'Other' as 'ActorDeathAdjudicated';
      },
    },
  ])('rejects owner death facts with $label', ({ mutate }) => {
    const state = conjured().state;
    const command = ownerDeathCommand(state);
    mutate(command);
    rejected(transitionPactBladeRuntime(state, command), 'InvalidDeathFacts');
  });

  it('rejects owner-death lifecycle without an active canonical Card↔object bond', () => {
    const empty = initialState();
    const command = ownerDeathCommand(conjured().state);
    command.expectedRevision = empty.revision;
    rejected(transitionPactBladeRuntime(empty, command), 'BladeUnavailable');

    const active = conjured().state;
    rejected(transitionPactBladeRuntime(active, ownerDeathCommand(active, {
      world: world([], active.observedWorldRevision),
    })), 'WeaponMismatch');
    rejected(transitionPactBladeRuntime(active, ownerDeathCommand(active, {
      world: activeWorld(active, active.observedWorldRevision, {
        bondedWarlockActorId: 'actor:rival',
      }),
    })), 'BondedToAnother');
    rejected(transitionPactBladeRuntime(active, ownerDeathCommand(active, {
      world: activeWorld(active, active.observedWorldRevision - 1),
    })), 'WorldRevisionConflict');
  });

  it('detects deterministic replay divergence, rejected recordings, malformed initial state, and invalid JSON', () => {
    const first = conjured();
    const divergent = jsonClone(first.transition);
    divergent.event.commandId = 'tampered';
    expect(() => replayPactBladeRuntime(initialState(), [divergent])).toThrow(/diverged/);

    const rejectedRecording = jsonClone(first.transition);
    rejectedRecording.command.expectedRevision = 99;
    expect(() => replayPactBladeRuntime(initialState(), [rejectedRecording])).toThrow(/transition rejected/);

    const invalidInitial = initialState();
    invalidInitial.revision = -1;
    expect(() => replayPactBladeRuntime(invalidInitial, [])).toThrow(/invalid Pact Blade state/);
    expect(() => replayPactBladeRuntimeFromJson(initialState(), '{}')).toThrow(/must be an array/);
    expect(() => replayPactBladeRuntimeFromJson(initialState(), '{')).toThrow(/JSON/);
  });

  it('rejects integration fixtures for the wrong transition kind', () => {
    const bond = conjured();
    const attack = applied(transitionPactBladeRuntime(bond.state, attackCommand(bond.state)));
    expect(() => createPactBladeCanonicalWorldIntegrationFixture(attack.transition))
      .toThrow(/requires a bond or lifecycle/);
    expect(() => createPactBladeCanonicalAttackIntegrationFixture(bond.transition))
      .toThrow(/requires a Pact Blade attack/);
  });
});
