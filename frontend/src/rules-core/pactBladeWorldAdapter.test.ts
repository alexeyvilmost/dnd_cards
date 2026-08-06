import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import {
  createWorld,
  type ActorState,
  type RuleActionDefinition,
  type RulesCatalog,
  type WorldState,
} from './domain';
import { createPactBladeInvocationState, type PactBladeInvocationState } from './warlockPacts';
import {
  PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
} from './testing/pactBladePolicyFixtures';
import {
  applyAuthorizedPactBladeBonded,
  applyAuthorizedPactBladeDistanceAdvanced,
  applyAuthorizedPactBladeEndedOnOwnerDeath,
  evolvePactBladeBonded,
  evolvePactBladeDistanceAdvanced,
  evolvePactBladeEndedOnOwnerDeath,
  pactBladeActorWorldIssue,
  pactBladeAttackIntegrationFixture,
  pactBladeBondIntegrationFixture,
  pactBladeDistanceIntegrationFixture,
  pactBladeItemCardPatchIssue,
  pactBladeOwnerDeathIntegrationFixture,
  planPactBladeAttackProjection,
  planPactBladeBondTransition,
  planPactBladeDistanceTransition,
  planPactBladeMaterialFocus,
  planPactBladeOwnerDeathTransition,
  type AppliedPactBladeWorldAttackPlan,
  type AppliedPactBladeWorldBondPlan,
  type AppliedPactBladeWorldDistancePlan,
  type AppliedPactBladeWorldOwnerDeathPlan,
  type PactBladeBondSelection,
  type PactBladeBoundItemWorldObject,
  type PactBladeItemWorldObject,
  type RejectedPactBladeWorldPlan,
} from './pactBladeWorldAdapter';

const ACTOR = 'actor:warlock';
const RIVAL = 'actor:rival';
const SOURCE = 'effect:pact-blade';
const BOND_ACTION = 'action:pact-blade';
const DAGGER = 'card:dagger';
const LONGSWORD = 'card:magic-longsword';
const LONGBOW = 'card:magic-longbow';
const MATERIAL_SPELL = 'spell:material';
const NO_MATERIAL_SPELL = 'spell:no-material';
const HASH = 'sha256:pact-blade-world';
const RULESET = {
  systemId: 'dnd5e-2024' as const,
  releaseId: 'pact-blade-world-test@1',
  contentHash: HASH,
  errataVersion: '2024-test',
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function card(overrides: Partial<Card> = {}): Card {
  const value = {
    id: DAGGER,
    card_number: 'CARD-dagger',
    name: 'Dagger',
    type: 'weapon',
    weapon_type: 'dagger',
    damage_type: 'piercing',
    bonus_type: 'damage',
    bonus_value: '1d4',
    properties: ['finesse', 'light'],
    tags: ['simple', 'melee'],
    description: '',
    rarity: 'common',
    is_template: 'false',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
  const tags = Array.isArray(value.tags)
    ? value.tags.map((entry) => String(entry).toLowerCase())
    : [];
  const properties = Array.isArray(value.properties) ? value.properties.map((entry) => (
    String(entry).trim().toLowerCase().replace(/[ -]+/g, '_')
  )) : [];
  const ranged = tags.some((entry) => entry.includes('ranged'));
  const profile: Record<string, unknown> = {
    weapon_type: value.weapon_type ?? '',
    proficiency_category: tags.some((entry) => entry.includes('simple')) ? 'simple' : 'martial',
    attack_ability: properties.includes('finesse') ? 'finesse' : ranged ? 'dex' : 'str',
    damage_lines: [{ dice: value.bonus_value || '1d4', type: value.damage_type ?? '' }],
    default_attack_mode: ranged ? 'ranged' : 'melee',
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
    mastery_effect_id: `mastery:${value.id}`,
    ammo: properties.includes('ammunition') ? { card_id: 'card:ammunition' } : null,
    enchantment: {
      attack_bonus: typeof value.enchant_bonus === 'number' ? value.enchant_bonus : 0,
      damage_bonus: typeof value.enchant_bonus === 'number' ? value.enchant_bonus : 0,
      extra_damage_lines: [],
    },
    attunement: { required: value.requires_attunement === true },
  };
  if (properties.includes('versatile')) {
    profile.versatile_grip = { dice: value.bonus_value || '1d4', type: value.damage_type ?? '' };
  }
  return {
    ...value,
    mechanics: overrides.mechanics ?? { weapon_profile: profile },
  } as Card;
}

const CARDS: Card[] = [
  card(),
  card({
    id: LONGSWORD,
    card_number: 'CARD-magic-longsword',
    name: 'Magic Longsword',
    weapon_type: 'longsword',
    damage_type: 'slashing',
    properties: [],
    tags: ['martial', 'melee', 'magic_weapon'],
    enchant_bonus: 1,
  }),
  card({
    id: LONGBOW,
    card_number: 'CARD-magic-longbow',
    name: 'Magic Longbow',
    weapon_type: 'longbow',
    damage_type: 'piercing',
    properties: ['ammunition', 'heavy', 'two-handed'],
    tags: ['martial', 'ranged', 'magic_weapon'],
    enchant_bonus: 1,
  }),
  card({
    id: 'card:enchanted-mace', card_number: 'CARD-enchanted-mace', name: 'Enchanted Mace',
    weapon_type: 'mace', damage_type: 'bludgeoning', properties: [], enchant_bonus: 1,
  }),
  card({
    id: 'card:attuned-spear', card_number: 'CARD-attuned-spear', name: 'Attuned Spear',
    weapon_type: 'spear', damage_type: 'piercing', properties: [], requires_attunement: true,
  }),
];

function nonSpellAction(): RuleActionDefinition {
  return {
    id: BOND_ACTION,
    name: 'Pact of the Blade',
    kind: 'nonSpell',
    sourceEntityIds: [SOURCE, 'EFF-pact-blade'],
    mechanics: {
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      primitive: {
        type: 'pact_blade_bond', stateCapability: 'warlock.pact.blade',
        policy: PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
      },
    },
  };
}

function spellAction(
  id: string,
  components?: { verbal: boolean; somatic: boolean; material: boolean },
): RuleActionDefinition {
  return {
    id,
    name: id,
    kind: 'spell',
    sourceEntityIds: [`content:${id}`, 'CLASS-warlock'],
    spell: { level: 1, sourceClass: 'CLASS-warlock', ...(components ? { components } : {}) },
    mechanics: {},
  };
}

const ACTIONS: RuleActionDefinition[] = [
  nonSpellAction(),
  spellAction(MATERIAL_SPELL, { verbal: true, somatic: true, material: true }),
  spellAction(NO_MATERIAL_SPELL, { verbal: true, somatic: true, material: false }),
  spellAction('spell:missing-components'),
  {
    id: 'action:not-spell', name: 'Not spell', kind: 'nonSpell',
    sourceEntityIds: ['content:not-spell'], mechanics: {},
  },
];

type TestCatalog = RulesCatalog & { getCard(id: string): Card | undefined };

const CATALOG: TestCatalog = {
  getAction: (id) => ACTIONS.find((action) => action.id === id),
  getCard: (id) => CARDS.find((candidate) => candidate.id === id),
};

function actor(input: {
  id?: string;
  invocation?: PactBladeInvocationState;
  bonusActions?: number;
  hp?: number;
} = {}): ActorState {
  const id = input.id ?? ACTOR;
  const invocation = input.invocation ?? createPactBladeInvocationState({
    sourceEntityId: SOURCE,
    ownerActorId: id,
    bondActionId: BOND_ACTION,
    lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  });
  return {
    id,
    name: id,
    kind: 'playerCharacter',
    controllerId: `controller:${id}`,
    capabilities: {
      actionIds: [BOND_ACTION, MATERIAL_SPELL, NO_MATERIAL_SPELL],
      featureSources: {
        'warlock.pact.blade': [SOURCE, 'EFF-pact-blade', 'CLASS-warlock'],
      },
    },
    character: {
      abilityMods: { str: 0, dex: 2, con: 2, int: 0, wis: 1, cha: 3 },
      profBonus: 2,
      level: 1,
      classLevels: { warlock: 1 },
      skillProficiencies: [],
      saveProficiencies: ['wis', 'cha'],
    },
    runtime: {
      hp: { current: input.hp ?? 10, max: 10, temp: 0 },
      resources: { action: 1, bonus_action: input.bonusActions ?? 1, reaction: 1 },
      maxResources: { action: 1, bonus_action: 1, reaction: 1 },
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    warlockPacts: { blade: invocation },
  };
}

function item(input: {
  id?: string;
  cardId?: string;
  magicalAura?: boolean;
  tags?: string[];
  attunedToActorId?: string;
  heldByActorId?: string;
  heldInHand?: 'main_hand' | 'off_hand';
} = {}): PactBladeItemWorldObject {
  const id = input.id ?? 'object:existing';
  return {
    id,
    name: id,
    kind: 'item',
    size: 'small',
    itemCardId: input.cardId ?? LONGSWORD,
    ...(input.magicalAura ? {
      magicalAura: { school: 'evocation', createdBySpell: true, visible: true },
    } : {}),
    ...(input.tags ? { tags: input.tags } : {}),
    ...(input.attunedToActorId ? { attunedToActorId: input.attunedToActorId } : {}),
    ...(input.heldByActorId ? {
      ownerActorId: input.heldByActorId,
      carriedByActorId: input.heldByActorId,
      heldByActorId: input.heldByActorId,
    } : {}),
    ...(input.heldInHand ? { heldInHand: input.heldInHand } : {}),
  };
}

function world(input: {
  actors?: ActorState[];
  objects?: PactBladeItemWorldObject[];
  encounter?: { initiative: string[]; activeIndex: number; turnStarted: boolean };
} = {}): WorldState {
  const value = createWorld({
    id: 'world:pact-blade',
    ruleset: RULESET,
    actors: input.actors ?? [actor()],
    objects: input.objects ?? [],
  });
  if (input.encounter) {
    value.scene = {
      mode: 'encounter',
      initiative: input.encounter.initiative,
      activeIndex: input.encounter.activeIndex,
      round: 1,
      turnStarted: input.encounter.turnStarted,
    };
  }
  return value;
}

function conjureSelection(overrides: Partial<PactBladeBondSelection> = {}): PactBladeBondSelection {
  return {
    mode: 'conjure',
    weaponCardId: DAGGER,
    weaponObjectId: 'object:conjured',
    conjureHand: 'main_hand',
    ...overrides,
  };
}

function touchSelection(
  objectId = 'object:existing',
  cardId = LONGSWORD,
  overrides: Partial<PactBladeBondSelection> = {},
): PactBladeBondSelection {
  return {
    mode: 'touch_existing',
    weaponCardId: cardId,
    weaponObjectId: objectId,
    touchFacts: {
      factsSource: 'board', boardRevision: 7, distanceFt: 0, lineOfSight: true, touched: true,
    },
    ...overrides,
  };
}

function deathFact(state: WorldState, overrides: Partial<{
  type: 'ActorDeathAdjudicated';
  provenance: 'canonical_actor_lifecycle';
  factId: string;
  actorId: string;
  adjudicatedBy: string;
  observedAtWorldRevision: number;
  rulesetContentHash: string;
}> = {}) {
  return {
    type: 'ActorDeathAdjudicated' as const,
    provenance: 'canonical_actor_lifecycle' as const,
    factId: `death:${state.revision}`,
    actorId: ACTOR,
    adjudicatedBy: 'gm:test',
    observedAtWorldRevision: state.revision,
    rulesetContentHash: HASH,
    ...overrides,
  };
}

function bondPlan(input: {
  state?: WorldState;
  catalog?: RulesCatalog;
  actorId?: string;
  commandId?: string;
  selection?: PactBladeBondSelection;
} = {}) {
  return planPactBladeBondTransition({
    world: input.state ?? world(),
    catalog: input.catalog ?? CATALOG,
    actorId: input.actorId ?? ACTOR,
    commandId: input.commandId ?? 'command:bond',
    selection: input.selection ?? conjureSelection(),
  });
}

function appliedBond(value = bondPlan()): AppliedPactBladeWorldBondPlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function appliedAttack(
  value: ReturnType<typeof planPactBladeAttackProjection>,
): AppliedPactBladeWorldAttackPlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function appliedDistance(
  value: ReturnType<typeof planPactBladeDistanceTransition>,
): AppliedPactBladeWorldDistancePlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function appliedDeath(
  value: ReturnType<typeof planPactBladeOwnerDeathTransition>,
): AppliedPactBladeWorldOwnerDeathPlan {
  if (value.status === 'rejected') throw new Error(`${value.code}: ${value.message}`);
  return value;
}

function expectRejected(
  value: { status: 'applied' } | RejectedPactBladeWorldPlan,
  code: string,
  message?: RegExp,
): RejectedPactBladeWorldPlan {
  expect(value.status).toBe('rejected');
  if (value.status !== 'rejected') throw new Error('Expected rejected Pact Blade plan');
  expect(value.code).toBe(code);
  if (message) expect(value.message).toMatch(message);
  return value;
}

function commitBond(
  before: WorldState,
  plan: AppliedPactBladeWorldBondPlan,
  catalog: RulesCatalog = CATALOG,
): WorldState {
  return { ...evolvePactBladeBonded(before, catalog, plan.event), revision: plan.event.revision };
}

function commitDistance(
  before: WorldState,
  plan: AppliedPactBladeWorldDistancePlan,
  catalog: RulesCatalog = CATALOG,
): WorldState {
  return {
    ...evolvePactBladeDistanceAdvanced(before, catalog, plan.event),
    revision: plan.event.revision,
  };
}

function committedConjured(input: { hp?: number; hand?: 'main_hand' | 'off_hand' } = {}): WorldState {
  const before = world({ actors: [actor({ hp: input.hp })] });
  return commitBond(before, appliedBond(bondPlan({
    state: before,
    selection: conjureSelection({ conjureHand: input.hand ?? 'main_hand' }),
  })));
}

function refreshBonusAction(value: WorldState): WorldState {
  const result = clone(value);
  result.actors[ACTOR].runtime.resources.bonus_action = 1;
  return result;
}

describe('Pact Blade canonical WorldState adapter', () => {
  it('conjures a catalog-derived weapon into the declared hand and atomically stores Card↔item bridge', () => {
    const before = world();
    const plan = appliedBond(bondPlan({ state: before }));
    expect(plan.event).toMatchObject({
      type: 'PactBladeBonded', mode: 'conjure', conjureHand: 'main_hand',
      actionCost: { kind: 'bonus_action', amount: 1 },
      activeBlade: {
        weaponCardId: DAGGER,
        weaponObject: {
          id: 'object:conjured', itemCardId: DAGGER,
          carriedByActorId: ACTOR, heldByActorId: ACTOR, heldInHand: 'main_hand',
        },
        invocation: {
          activeBond: {
            weaponObjectId: 'object:conjured', weaponCardId: DAGGER,
            lastDistanceBoardRevision: null, conjured: true,
          },
        },
      },
      upsertWorldObjects: [expect.objectContaining({ id: 'object:conjured', itemCardId: DAGGER })],
    });
    const after = commitBond(before, plan);
    expect(after.actors[ACTOR].runtime.resources.bonus_action).toBe(0);
    expect((after.objects['object:conjured'] as PactBladeItemWorldObject)).toMatchObject({
      itemCardId: DAGGER, heldByActorId: ACTOR, heldInHand: 'main_hand',
    });
    expect((after.actors[ACTOR].warlockPacts?.blade?.activeBond as unknown as {
      weaponCardId: string;
    }).weaponCardId).toBe(DAGGER);
    expect(pactBladeActorWorldIssue(after, CATALOG, ACTOR)).toBeNull();
    expect(pactBladeBondIntegrationFixture(plan)).toMatchObject({
      commandType: 'UseAction', consumeActionEconomy: [{ kind: 'bonus_action', amount: 1 }],
      upsertWeaponBridges: [{ weaponObjectId: 'object:conjured', weaponCardId: DAGGER }],
    });
  });

  it('rejects an occupied hand but atomically frees the previous conjured blade before replacement', () => {
    const occupied = world({
      objects: [item({
        id: 'object:ordinary-held',
        cardId: LONGSWORD,
        heldByActorId: ACTOR,
        heldInHand: 'main_hand',
      })],
    });
    expectRejected(bondPlan({ state: occupied }), 'InvalidWorldState', /occupied main_hand/);

    const first = committedConjured({ hand: 'main_hand' });
    const refreshed = refreshBonusAction(first);
    const replacement = appliedBond(bondPlan({
      state: refreshed,
      commandId: 'command:replace-conjured',
      selection: conjureSelection({ weaponObjectId: 'object:replacement' }),
    }));
    expect(replacement.event).toMatchObject({
      removedWorldObjectIds: ['object:conjured'],
      clearPactBondObjectIds: ['object:conjured'],
      activeBlade: {
        weaponObject: {
          id: 'object:replacement', heldByActorId: ACTOR, heldInHand: 'main_hand',
        },
      },
    });
    const after = commitBond(refreshed, replacement);
    expect(after.objects['object:conjured']).toBeUndefined();
    expect(after.objects['object:replacement']).toMatchObject({
      itemCardId: DAGGER, heldByActorId: ACTOR, heldInHand: 'main_hand',
    });
    expect(Object.values(after.objects).filter((object) => (
      object.heldByActorId === ACTOR && object.heldInHand === 'main_hand'
    ))).toHaveLength(1);
  });

  it('derives per-attack STR/DEX/CHA and every damage choice without mutating the bond', () => {
    const state = committedConjured();
    const originalBond = clone(state.actors[ACTOR].warlockPacts?.blade?.activeBond);
    const cases = [
      { ability: 'str', damage: 'normal', expectedAbility: 'str', expectedDamage: 'piercing' },
      { ability: 'dex', damage: 'necrotic', expectedAbility: 'dex', expectedDamage: 'necrotic' },
      { ability: 'cha', damage: 'psychic', expectedAbility: 'cha', expectedDamage: 'psychic' },
      { ability: 'cha', damage: 'radiant', expectedAbility: 'cha', expectedDamage: 'radiant' },
    ] as const;
    for (const row of cases) {
      const plan = appliedAttack(planPactBladeAttackProjection({
        world: state,
        catalog: CATALOG,
        actorId: ACTOR,
        commandId: `attack:${row.ability}:${row.damage}`,
        selection: {
          weaponObjectId: 'object:conjured', hand: 'main_hand',
          abilityChoice: row.ability, damageType: row.damage,
        },
      }));
      expect(plan.event.projection).toEqual({
        attackAbility: row.expectedAbility,
        damageAbility: row.expectedAbility,
        damageType: row.expectedDamage,
        proficient: true,
        spellcastingFocus: true,
      });
      expect(pactBladeAttackIntegrationFixture(plan)).toMatchObject({
        immutableWeaponCardId: DAGGER,
        weaponObjectId: 'object:conjured',
        attackAbility: row.expectedAbility,
        damageType: row.expectedDamage,
        proficient: true,
      });
    }
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond).toEqual(originalBond);
  });

  it('fails closed when the selected item instance is dropped, moved to another hand, or mismatched', () => {
    const state = committedConjured();
    const base = {
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:held',
      selection: {
        weaponObjectId: 'object:conjured', hand: 'main_hand' as const,
        abilityChoice: 'cha' as const, damageType: 'normal' as const,
      },
    };
    expectRejected(planPactBladeAttackProjection({
      ...base,
      selection: { ...base.selection, hand: 'off_hand' },
    }), 'WeaponNotHeld', /declared hand/);
    const dropped = clone(state);
    delete (dropped.objects['object:conjured'] as PactBladeItemWorldObject).heldByActorId;
    delete (dropped.objects['object:conjured'] as PactBladeItemWorldObject).heldInHand;
    expectRejected(planPactBladeAttackProjection({ ...base, world: dropped }), 'WeaponNotHeld');
    expectRejected(planPactBladeAttackProjection({
      ...base,
      selection: { ...base.selection, weaponObjectId: 'object:other' },
    }), 'WeaponMismatch');
  });

  it('allows DEX only for immutable Finesse Cards', () => {
    const before = world();
    const longsword = commitBond(before, appliedBond(bondPlan({
      state: before,
      selection: conjureSelection({ weaponCardId: LONGSWORD }),
    })));
    expectRejected(planPactBladeAttackProjection({
      world: longsword, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:dex',
      selection: {
        weaponObjectId: 'object:conjured', hand: 'main_hand',
        abilityChoice: 'dex', damageType: 'normal',
      },
    }), 'IllegalAttackChoice');
  });

  it('derives existing magic-weapon eligibility from immutable item provenance, never a generic aura', () => {
    const auraOnly = item({
      id: 'object:aura-only', cardId: DAGGER, magicalAura: true,
    });
    const auraWorld = world({ objects: [auraOnly] });
    expectRejected(bondPlan({
      state: auraWorld,
      selection: touchSelection('object:aura-only', DAGGER),
    }), 'MagicWeaponRequired', /must be magical/);

    for (const [cardId, objectId] of [
      [LONGSWORD, 'object:magic-tag'],
      ['card:enchanted-mace', 'object:enchant'],
      ['card:attuned-spear', 'object:attunement-card'],
    ] as const) {
      const candidate = item({ id: objectId, cardId });
      expect(bondPlan({
        state: world({ objects: [candidate] }),
        selection: touchSelection(objectId, cardId),
      }).status).toBe('applied');
    }
    const objectProvenance = item({ id: 'object:provenance', cardId: DAGGER, tags: ['magic_weapon'] });
    expect(bondPlan({
      state: world({ objects: [objectProvenance] }),
      selection: touchSelection('object:provenance', DAGGER),
    }).status).toBe('applied');
  });

  it('derives attunement and foreign Warlock bonds only from canonical world state', () => {
    const foreignAttuned = item({ attunedToActorId: RIVAL, tags: ['magic_weapon'] });
    expectRejected(bondPlan({
      state: world({ objects: [foreignAttuned] }),
      selection: touchSelection(),
    }), 'AttunedToAnother');
    const selfAttuned = item({ attunedToActorId: ACTOR, tags: ['magic_weapon'] });
    expect(bondPlan({
      state: world({ objects: [selfAttuned] }),
      selection: touchSelection(),
    }).status).toBe('applied');

    const rivalBond = {
      ...createPactBladeInvocationState({
        sourceEntityId: SOURCE, ownerActorId: RIVAL, bondActionId: BOND_ACTION,
        lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      }),
      activeBond: {
        sourceEntityId: SOURCE,
        warlockActorId: RIVAL,
        weaponObjectId: 'object:existing',
        weaponType: 'longsword',
        normalDamageType: 'slashing',
        conjured: false,
        bondedAtRevision: 0,
        continuousSeparationSeconds: 0,
        weaponCardId: LONGSWORD,
        lastDistanceBoardRevision: null,
      },
    } as PactBladeInvocationState;
    const contested = world({ actors: [actor(), actor({ id: RIVAL, invocation: rivalBond })], objects: [item()] });
    expectRejected(bondPlan({ state: contested, selection: touchSelection() }), 'BondedToAnother');
  });

  it('replaces only after all checks pass, deleting old conjured object but preserving existing item state', () => {
    const first = refreshBonusAction(committedConjured());
    const existing = item({
      heldByActorId: ACTOR, heldInHand: 'off_hand', attunedToActorId: ACTOR,
    });
    first.objects[existing.id] = existing;
    const beforeFailure = clone(first);
    expectRejected(bondPlan({
      state: first,
      selection: touchSelection(existing.id, LONGSWORD, {
        touchFacts: {
          factsSource: 'board', boardRevision: 8,
          distanceFt: 0, lineOfSight: true, touched: false,
        },
      }),
    }), 'InvalidTouchFacts');
    expect(first).toEqual(beforeFailure);

    const replacement = appliedBond(bondPlan({
      state: first,
      commandId: 'command:replace',
      selection: touchSelection(),
    }));
    expect(replacement.event).toMatchObject({
      mode: 'touch_existing',
      endedPreviousBond: { weaponObjectId: 'object:conjured', weaponCardId: DAGGER },
      removedWorldObjectIds: ['object:conjured'],
      upsertWorldObjects: [],
      activeBlade: {
        weaponCardId: LONGSWORD,
        weaponObject: { id: 'object:existing', heldInHand: 'off_hand' },
      },
    });
    const after = commitBond(first, replacement);
    expect(after.objects['object:conjured']).toBeUndefined();
    expect(after.objects['object:existing']).toMatchObject({
      itemCardId: LONGSWORD, attunedToActorId: ACTOR,
      heldByActorId: ACTOR, heldInHand: 'off_hand',
    });
  });

  it('does not pretend a touched existing weapon is held after bonding', () => {
    const before = world({ objects: [item()] });
    const after = commitBond(before, appliedBond(bondPlan({
      state: before, selection: touchSelection(),
    })));
    expectRejected(planPactBladeAttackProjection({
      world: after, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:not-held',
      selection: {
        weaponObjectId: 'object:existing', hand: 'main_hand',
        abilityChoice: 'cha', damageType: 'radiant',
      },
    }), 'WeaponNotHeld');
  });

  it('accepts a touched magic ranged Card and rejects the same Card in conjure mode', () => {
    const existing = item({ cardId: LONGBOW });
    const touched = appliedBond(bondPlan({
      state: world({ objects: [existing] }),
      selection: touchSelection(existing.id, LONGBOW),
    }));
    expect(touched.event.activeBlade).toMatchObject({
      weaponCardId: LONGBOW,
      weaponCard: { range: 'ranged', category: 'martial', weaponType: 'longbow' },
      invocation: { activeBond: { conjured: false } },
    });

    expectRejected(bondPlan({
      selection: conjureSelection({ weaponCardId: LONGBOW }),
    }), 'IllegalWeapon');
  });

  it('tracks continuous distance, resets at 5 feet, and ends at the literal >=60-second RAW boundary', () => {
    let state = committedConjured();
    const after59 = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:59',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 6, elapsedSeconds: 59 },
    }));
    state = commitDistance(state, after59);
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond).toMatchObject({
      continuousSeparationSeconds: 59, lastDistanceBoardRevision: 1,
    });
    expect(pactBladeDistanceIntegrationFixture(after59)).toMatchObject({
      commandType: 'AdvanceExplicitTime', removeObjectIds: [],
    });

    const reset = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:reset',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'gm_ruling', boardRevision: 2, distanceFt: 5, elapsedSeconds: 30 },
    }));
    state = commitDistance(state, reset);
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond?.continuousSeparationSeconds).toBe(0);

    const ended = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:60',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'scenario', boardRevision: 3, distanceFt: 6, elapsedSeconds: 60 },
    }));
    expect(ended.event).toMatchObject({
      bondEnded: true, activeBlade: null,
      removedWorldObjectIds: ['object:conjured'], pactState: { activeBond: null },
    });
    state = commitDistance(state, ended);
    expect(state.objects['object:conjured']).toBeUndefined();
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond).toBeNull();
  });

  it('binds a mutated declaration into state/events and evaluates that lifecycle without PHB defaults', () => {
    const lifecyclePolicy = {
      separationDistanceFt: 20,
      continuousSeparationSecondsToEnd: 90,
      endOnOwnerDeath: false,
    } as const;
    const rawLifecyclePolicy = {
      separation_distance_ft: 20,
      continuous_separation_seconds_to_end: 90,
      end_on_owner_death: false,
    } as const;
    const action = nonSpellAction();
    const catalog: TestCatalog = {
      getAction: (id) => id === BOND_ACTION
        ? {
          ...action,
          mechanics: {
            ...action.mechanics,
            primitive: {
              ...(action.mechanics.primitive as Record<string, unknown>),
              policy: rawLifecyclePolicy,
            },
          },
        }
        : CATALOG.getAction(id),
      getCard: CATALOG.getCard,
    };
    const invocation = createPactBladeInvocationState({
      sourceEntityId: SOURCE,
      ownerActorId: ACTOR,
      bondActionId: BOND_ACTION,
      lifecyclePolicy,
    });
    let state = world({ actors: [actor({ invocation })] });
    const bonded = appliedBond(bondPlan({ state, catalog }));
    expect(bonded.event).toMatchObject({
      activeBlade: { invocation: { lifecyclePolicy } },
    });
    state = commitBond(state, bonded, catalog);

    const insideDeclaredThreshold = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog, actorId: ACTOR, commandId: 'distance:mutated:inside',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 10, elapsedSeconds: 89 },
    }));
    state = commitDistance(state, insideDeclaredThreshold, catalog);
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond?.continuousSeparationSeconds).toBe(0);

    const after89 = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog, actorId: ACTOR, commandId: 'distance:mutated:89',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 2, distanceFt: 21, elapsedSeconds: 89 },
    }));
    state = commitDistance(state, after89, catalog);
    expect(state.actors[ACTOR].warlockPacts?.blade?.activeBond?.continuousSeparationSeconds).toBe(89);
    expect(after89.event).toMatchObject({ pactState: { lifecyclePolicy } });

    expectRejected(planPactBladeOwnerDeathTransition({
      world: state,
      catalog,
      actorId: ACTOR,
      commandId: 'death:mutated-disabled',
      deathFact: deathFact(state),
    }), 'InvalidDeathFacts', /does not end/);

    const ended = appliedDistance(planPactBladeDistanceTransition({
      world: state, catalog, actorId: ACTOR, commandId: 'distance:mutated:90',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 3, distanceFt: 21, elapsedSeconds: 1 },
    }));
    expect(ended.event).toMatchObject({
      bondEnded: true,
      pactState: { lifecyclePolicy, activeBond: null },
    });
  });

  it('rejects stale/malformed distance facts and preserves existing magic item at 60 seconds', () => {
    let conjured = committedConjured();
    const observed = appliedDistance(planPactBladeDistanceTransition({
      world: conjured, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:first',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 4, distanceFt: 6, elapsedSeconds: 1 },
    }));
    conjured = commitDistance(conjured, observed);
    expectRejected(planPactBladeDistanceTransition({
      world: conjured, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:stale',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 3, distanceFt: 6, elapsedSeconds: 1 },
    }), 'InvalidDistanceFacts', /stale/);
    expectRejected(planPactBladeDistanceTransition({
      world: conjured, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:bad',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'client' as 'board', boardRevision: 5, distanceFt: -1, elapsedSeconds: 1 },
    }), 'InvalidDistanceFacts');

    const existingObject = item();
    const before = world({ objects: [existingObject] });
    const bound = commitBond(before, appliedBond(bondPlan({ state: before, selection: touchSelection() })));
    const ended = appliedDistance(planPactBladeDistanceTransition({
      world: bound, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:existing:60',
      weaponObjectId: existingObject.id,
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 10, elapsedSeconds: 60 },
    }));
    expect(ended.event.removedWorldObjectIds).toEqual([]);
    const after = commitDistance(bound, ended);
    expect(after.objects[existingObject.id]).toEqual(existingObject);
  });

  it('ends on explicit owner death, never merely because HP is 0', () => {
    const unconscious = committedConjured({ hp: 0 });
    expect(unconscious.actors[ACTOR].runtime.hp.current).toBe(0);
    expect(unconscious.actors[ACTOR].warlockPacts?.blade?.activeBond).not.toBeNull();
    expect(planPactBladeAttackProjection({
      world: unconscious, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:hp-zero',
      selection: {
        weaponObjectId: 'object:conjured', hand: 'main_hand',
        abilityChoice: 'cha', damageType: 'normal',
      },
    }).status).toBe('applied');

    const death = appliedDeath(planPactBladeOwnerDeathTransition({
      world: unconscious, catalog: CATALOG, actorId: ACTOR, commandId: 'death:observed',
      deathFact: deathFact(unconscious, { factId: 'death:9' }),
    }));
    expect(death.event).toMatchObject({
      type: 'PactBladeEndedOnOwnerDeath',
      deathFact: {
        type: 'ActorDeathAdjudicated', provenance: 'canonical_actor_lifecycle',
        actorId: ACTOR, factId: 'death:9',
      },
      removedWorldObjectIds: ['object:conjured'],
      previousBond: { weaponCardId: DAGGER },
      pactState: { activeBond: null },
    });
    expect(pactBladeOwnerDeathIntegrationFixture(death)).toMatchObject({
      commandType: 'ObserveActorDeath', removeObjectIds: ['object:conjured'],
    });
    const after = {
      ...evolvePactBladeEndedOnOwnerDeath(unconscious, CATALOG, death.event),
      revision: death.event.revision,
    };
    expect(after.objects['object:conjured']).toBeUndefined();
    expect(after.actors[ACTOR].warlockPacts?.blade?.activeBond).toBeNull();
  });

  it('preserves an existing item on death and rejects non-authoritative death claims', () => {
    const existingObject = item({ heldByActorId: ACTOR, heldInHand: 'main_hand' });
    const before = world({ objects: [existingObject] });
    const bound = commitBond(before, appliedBond(bondPlan({ state: before, selection: touchSelection() })));
    expectRejected(planPactBladeOwnerDeathTransition({
      world: bound, catalog: CATALOG, actorId: ACTOR, commandId: 'death:false',
      deathFact: deathFact(bound, {
        provenance: 'client' as 'canonical_actor_lifecycle', observedAtWorldRevision: -1,
      }),
    }), 'InvalidDeathFacts');
    const death = appliedDeath(planPactBladeOwnerDeathTransition({
      world: bound, catalog: CATALOG, actorId: ACTOR, commandId: 'death:existing',
      deathFact: deathFact(bound),
    }));
    expect(death.event.removedWorldObjectIds).toEqual([]);
    const after = evolvePactBladeEndedOnOwnerDeath(bound, CATALOG, death.event);
    expect(after.objects[existingObject.id]).toEqual(existingObject);
  });

  it('projects the bonded held weapon only for Material components and preserves V/S and costly-material duties', () => {
    const state = committedConjured({ hand: 'off_hand' });
    const material = planPactBladeMaterialFocus({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'focus:material',
      actionId: MATERIAL_SPELL, weaponObjectId: 'object:conjured', hand: 'off_hand',
    });
    expect(material.status).toBe('applied');
    if (material.status !== 'applied') throw new Error(material.message);
    expect(material.event).toMatchObject({
      weaponCardId: DAGGER,
      components: { verbal: true, somatic: true, material: true },
      replacesMaterialComponent: true,
      preservesCostlyAndConsumedMaterials: true,
      replacesVerbalComponent: false,
      replacesSomaticComponent: false,
    });
    expectRejected(planPactBladeMaterialFocus({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'focus:no-m',
      actionId: NO_MATERIAL_SPELL, weaponObjectId: 'object:conjured', hand: 'off_hand',
    }), 'MaterialComponentRequired');
    expectRejected(planPactBladeMaterialFocus({
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'focus:wrong-hand',
      actionId: MATERIAL_SPELL, weaponObjectId: 'object:conjured', hand: 'main_hand',
    }), 'WeaponNotHeld');
  });

  it('fails focus projection for wrong object, missing action, non-spell, or missing component metadata', () => {
    const state = committedConjured();
    const base = {
      world: state, catalog: CATALOG, actorId: ACTOR, commandId: 'focus:invalid',
      actionId: MATERIAL_SPELL, weaponObjectId: 'object:conjured', hand: 'main_hand' as const,
    };
    expectRejected(planPactBladeMaterialFocus({ ...base, weaponObjectId: 'object:other' }), 'WeaponMismatch');
    expectRejected(planPactBladeMaterialFocus({ ...base, actionId: 'missing' }), 'InvalidCatalogAction');
    expectRejected(planPactBladeMaterialFocus({ ...base, actionId: 'action:not-spell' }), 'InvalidCatalogAction');
    expectRejected(planPactBladeMaterialFocus({
      ...base, actionId: 'spell:missing-components',
    }), 'InvalidCatalogAction', /component metadata/);
  });

  it('makes itemCardId immutable after WorldObjectCreated', () => {
    const bridged = item();
    expect(pactBladeItemCardPatchIssue({ current: bridged, patch: { name: 'Renamed' } })).toBeNull();
    expect(pactBladeItemCardPatchIssue({ current: bridged, patch: { itemCardId: LONGSWORD } })).toBeNull();
    expect(pactBladeItemCardPatchIssue({ current: bridged, patch: { itemCardId: DAGGER } }))
      .toMatch(/immutable/);
    expect(pactBladeItemCardPatchIssue({ current: bridged, patch: {}, unset: ['itemCardId'] }))
      .toMatch(/cannot be unset/);
    const unbridged = item();
    delete unbridged.itemCardId;
    expect(pactBladeItemCardPatchIssue({ current: unbridged, patch: { itemCardId: DAGGER } }))
      .toMatch(/immutable/);
  });

  it('fails closed without actor/capability/invocation/action/Card authority', () => {
    expectRejected(bondPlan({ actorId: 'missing' }), 'ActorNotFound');
    const noFeatureActor = actor();
    delete noFeatureActor.capabilities.featureSources;
    expectRejected(bondPlan({ state: world({ actors: [noFeatureActor] }) }), 'FeatureNotGranted');
    const noInvocation = actor();
    delete noInvocation.warlockPacts;
    expectRejected(bondPlan({ state: world({ actors: [noInvocation] }) }), 'InvalidWorldState');
    const noBondAction = actor();
    noBondAction.capabilities.actionIds = [];
    expectRejected(bondPlan({ state: world({ actors: [noBondAction] }) }), 'InvalidWorldState');
    expectRejected(bondPlan({ catalog: { getAction: CATALOG.getAction } }), 'CatalogCardResolverUnavailable');
    expectRejected(bondPlan({ selection: conjureSelection({ weaponCardId: 'missing' }) }), 'InvalidCatalogCard');
    const noCatalogAction: TestCatalog = { getAction: () => undefined, getCard: CATALOG.getCard };
    expectRejected(bondPlan({ catalog: noCatalogAction }), 'InvalidCatalogAction');
  });

  it('rejects every malformed immutable Card shape before it becomes an item instance', () => {
    const malformed: Card[] = [card({ name: '' }), card(), card(), card(), card()];
    ((malformed[1].mechanics as Record<string, unknown>).weapon_profile as Record<string, unknown>)
      .properties = 1;
    malformed[2].mechanics = {};
    ((malformed[3].mechanics as Record<string, unknown>).weapon_profile as Record<string, unknown>)
      .proficiency_category = 'invalid';
    ((malformed[4].mechanics as Record<string, unknown>).weapon_profile as Record<string, unknown>)
      .attack_modes = [{ kind: 'melee', reach_ft: 5 }, { kind: 'melee', reach_ft: 10 }];
    for (const [index, badCard] of malformed.entries()) {
      const custom: TestCatalog = {
        getAction: CATALOG.getAction,
        getCard: (id) => id === DAGGER ? badCard : CATALOG.getCard(id),
      };
      expectRejected(bondPlan({ catalog: custom }), 'InvalidCatalogCard', undefined);
      expect(index).toBeGreaterThanOrEqual(0);
    }
  });

  it('fails closed for corrupt persisted Card bridge, revision, catalog, attunement, and source ownership', () => {
    const cases: Array<[string, (state: WorldState) => void, RegExp]> = [
      ['missing card id', (state) => {
        delete (state.actors[ACTOR].warlockPacts!.blade!.activeBond as unknown as {
          weaponCardId?: string;
        }).weaponCardId;
      }, /weaponCardId/],
      ['bad board revision', (state) => {
        (state.actors[ACTOR].warlockPacts!.blade!.activeBond as unknown as {
          lastDistanceBoardRevision: number;
        }).lastDistanceBoardRevision = -1;
      }, /lastDistanceBoardRevision/],
      ['wrong bond weapon type', (state) => {
        state.actors[ACTOR].warlockPacts!.blade!.activeBond!.weaponType = 'axe';
      }, /immutable weapon Card/],
      ['foreign attunement after bond', (state) => {
        (state.objects['object:conjured'] as PactBladeItemWorldObject).attunedToActorId = RIVAL;
      }, /attuned to another/],
      ['wrong conjured source', (state) => {
        state.objects['object:conjured'].sourceActorId = RIVAL;
      }, /not source-owned/],
    ];
    for (const [label, mutate, message] of cases) {
      const state = committedConjured();
      mutate(state);
      expectRejected(bondPlan({ state, selection: conjureSelection({
        weaponObjectId: `object:replacement:${label}`,
      }) }), 'InvalidWorldState', message);
    }

    const active = committedConjured();
    const invalidActiveCard: TestCatalog = {
      getAction: CATALOG.getAction,
      getCard: (id) => id === DAGGER ? card({ tags: ['ranged'] }) : CATALOG.getCard(id),
    };
    expectRejected(bondPlan({ state: active, catalog: invalidActiveCard }), 'InvalidWorldState');
  });

  it('rejects blank capability provenance and a catalog action outside the invocation source', () => {
    const blankSource = actor();
    blankSource.capabilities.featureSources!['warlock.pact.blade'] = [SOURCE, ' '] as [string, ...string[]];
    expectRejected(bondPlan({ state: world({ actors: [blankSource] }) }), 'InvalidWorldState', /non-blank/);

    const wrongSourceCatalog: TestCatalog = {
      getAction: (id) => id === BOND_ACTION
        ? { ...nonSpellAction(), sourceEntityIds: ['other-source'] }
        : CATALOG.getAction(id),
      getCard: CATALOG.getCard,
    };
    expectRejected(bondPlan({ catalog: wrongSourceCatalog }), 'InvalidCatalogAction', /not scoped/);

    const blankActionActor = actor({
      invocation: {
        kind: 'blade', sourceEntityId: SOURCE, ownerActorId: ACTOR,
        bondActionId: '', lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
        activeBond: null,
      },
    });
    blankActionActor.capabilities.actionIds = [''];
    const blankActionCatalog: TestCatalog = {
      getAction: (id) => id === '' ? { ...nonSpellAction(), id: '' } : CATALOG.getAction(id),
      getCard: CATALOG.getCard,
    };
    expectRejected(bondPlan({
      state: world({ actors: [blankActionActor] }), catalog: blankActionCatalog,
    }), 'InvalidWorldState', /requires actor, source, action/);
  });

  it('rejects missing/ambiguous item bridges and accepts a started canonical encounter turn', () => {
    expectRejected(bondPlan({
      state: world(), selection: touchSelection('object:missing', LONGSWORD),
    }), 'InvalidWorldState', /not an item/);

    const contestedObject = item();
    const bondedActor = (id: string): ActorState => {
      const invocation = {
        ...createPactBladeInvocationState({
          sourceEntityId: SOURCE, ownerActorId: id, bondActionId: BOND_ACTION,
          lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
        }),
        activeBond: {
          sourceEntityId: SOURCE, warlockActorId: id,
          weaponObjectId: contestedObject.id, weaponType: 'longsword',
          normalDamageType: 'slashing', conjured: false,
          bondedAtRevision: 0, continuousSeparationSeconds: 0,
          weaponCardId: LONGSWORD, lastDistanceBoardRevision: null,
        },
      } as PactBladeInvocationState;
      return actor({ id, invocation });
    };
    expectRejected(bondPlan({
      state: world({
        actors: [actor(), bondedActor(RIVAL), bondedActor('actor:third')],
        objects: [contestedObject],
      }),
      selection: touchSelection(),
    }), 'InvalidWorldState', /multiple Warlocks/);

    const encounter = world({
      encounter: { initiative: [ACTOR], activeIndex: 0, turnStarted: true },
    });
    expect(bondPlan({ state: encounter }).status).toBe('applied');
    const encounterMissingBudget = world({
      encounter: { initiative: [ACTOR], activeIndex: 0, turnStarted: true },
    });
    delete encounterMissingBudget.actors[ACTOR].runtime.resources.bonus_action;
    expectRejected(bondPlan({ state: encounterMissingBudget }), 'TurnUnavailable');
    const missingBudget = world();
    delete missingBudget.actors[ACTOR].runtime.resources.bonus_action;
    expectRejected(bondPlan({ state: missingBudget }), 'TurnUnavailable');
  });

  it('propagates command-envelope rejection for each handler-facing plan', () => {
    const before = world();
    expectRejected(bondPlan({ state: before, commandId: '' }), 'InvalidCommand');
    const active = committedConjured();
    expectRejected(planPactBladeAttackProjection({
      world: active, catalog: CATALOG, actorId: ACTOR, commandId: '',
      selection: {
        weaponObjectId: 'object:conjured', hand: 'main_hand',
        abilityChoice: 'cha', damageType: 'normal',
      },
    }), 'InvalidCommand');
    expectRejected(planPactBladeDistanceTransition({
      world: active, catalog: CATALOG, actorId: ACTOR, commandId: '',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 6, elapsedSeconds: 1 },
    }), 'InvalidCommand');
    expectRejected(planPactBladeOwnerDeathTransition({
      world: active, catalog: CATALOG, actorId: ACTOR, commandId: '',
      deathFact: deathFact(active),
    }), 'InvalidCommand');
  });

  it('rejects inactive and malformed attack/lifecycle/focus requests at the adapter boundary', () => {
    const inactive = world();
    expectRejected(planPactBladeAttackProjection({
      world: inactive, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:inactive',
      selection: null as unknown as Parameters<typeof planPactBladeAttackProjection>[0]['selection'],
    }), 'BladeUnavailable');
    expectRejected(planPactBladeDistanceTransition({
      world: inactive, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:inactive',
      weaponObjectId: 'none',
      facts: { factsSource: 'board', boardRevision: 0, distanceFt: 0, elapsedSeconds: 0 },
    }), 'BladeUnavailable');
    expectRejected(planPactBladeOwnerDeathTransition({
      world: inactive, catalog: CATALOG, actorId: ACTOR, commandId: 'death:inactive',
      deathFact: deathFact(inactive),
    }), 'BladeUnavailable');
    expectRejected(planPactBladeMaterialFocus({
      world: inactive, catalog: CATALOG, actorId: ACTOR, commandId: 'focus:inactive',
      actionId: MATERIAL_SPELL, weaponObjectId: 'none', hand: 'main_hand',
    }), 'BladeUnavailable');

    const active = committedConjured();
    expectRejected(planPactBladeAttackProjection({
      world: active, catalog: CATALOG, actorId: ACTOR, commandId: 'attack:malformed',
      selection: null as unknown as Parameters<typeof planPactBladeAttackProjection>[0]['selection'],
    }), 'IllegalAttackChoice');
    for (const actorId of ['missing:attack', 'missing:distance', 'missing:death', 'missing:focus']) {
      if (actorId.endsWith('attack')) {
        expectRejected(planPactBladeAttackProjection({
          world: active, catalog: CATALOG, actorId, commandId: actorId,
          selection: {
            weaponObjectId: 'object:conjured', hand: 'main_hand',
            abilityChoice: 'cha', damageType: 'normal',
          },
        }), 'ActorNotFound');
      } else if (actorId.endsWith('distance')) {
        expectRejected(planPactBladeDistanceTransition({
          world: active, catalog: CATALOG, actorId, commandId: actorId,
          weaponObjectId: 'object:conjured',
          facts: { factsSource: 'board', boardRevision: 1, distanceFt: 6, elapsedSeconds: 1 },
        }), 'ActorNotFound');
      } else if (actorId.endsWith('death')) {
        expectRejected(planPactBladeOwnerDeathTransition({
          world: active, catalog: CATALOG, actorId, commandId: actorId,
          deathFact: deathFact(active, { actorId }),
        }), 'ActorNotFound');
      } else {
        expectRejected(planPactBladeMaterialFocus({
          world: active, catalog: CATALOG, actorId, commandId: actorId,
          actionId: MATERIAL_SPELL, weaponObjectId: 'object:conjured', hand: 'main_hand',
        }), 'ActorNotFound');
      }
    }
  });

  it('does not trust a mutable catalog resolver between active-state and attack projection checks', () => {
    const active = committedConjured();
    let reads = 0;
    const changingCatalog: TestCatalog = {
      getAction: CATALOG.getAction,
      getCard: (id) => {
        reads += 1;
        return reads === 1 ? CATALOG.getCard(id) : undefined;
      },
    };
    expectRejected(planPactBladeAttackProjection({
      world: active, catalog: changingCatalog, actorId: ACTOR, commandId: 'attack:catalog-race',
      selection: {
        weaponObjectId: 'object:conjured', hand: 'main_hand',
        abilityChoice: 'cha', damageType: 'normal',
      },
    }), 'InvalidCatalogCard');
  });

  it('fails closed for malformed bond selection, touch provenance, turn, and Bonus Action budget', () => {
    for (const selection of [
      null,
      { ...conjureSelection(), mode: 'invalid' },
      { ...conjureSelection(), weaponCardId: ' ' },
      { ...conjureSelection(), weaponObjectId: '' },
    ]) {
      expectRejected(planPactBladeBondTransition({
        world: world(), catalog: CATALOG, actorId: ACTOR,
        commandId: 'bond:malformed', selection: selection as PactBladeBondSelection,
      }), 'InvalidWorldState', /selection is malformed/);
    }
    expectRejected(bondPlan({
      selection: conjureSelection({ conjureHand: undefined }),
    }), 'InvalidWorldState', /explicit hand/);
    expectRejected(bondPlan({
      selection: conjureSelection({ touchFacts: touchSelection().touchFacts }),
    }), 'InvalidTouchFacts');
    const existing = item();
    const existingWorld = world({ objects: [existing] });
    expectRejected(bondPlan({
      state: existingWorld,
      selection: touchSelection(existing.id, LONGSWORD, { conjureHand: 'main_hand' }),
    }), 'InvalidWorldState');
    expectRejected(bondPlan({
      state: existingWorld,
      selection: touchSelection(existing.id, LONGSWORD, {
        touchFacts: {
          factsSource: 'client' as 'board', boardRevision: -1,
          distanceFt: Number.NaN, lineOfSight: true, touched: true,
        },
      }),
    }), 'InvalidTouchFacts');
    expectRejected(bondPlan({ state: world({ actors: [actor({ bonusActions: 0 })] }) }), 'TurnUnavailable');
    const notStarted = world({
      encounter: { initiative: [ACTOR], activeIndex: 0, turnStarted: false },
    });
    expectRejected(bondPlan({ state: notStarted }), 'InvalidTurnState');
    const wrongTurn = world({
      actors: [actor(), actor({ id: RIVAL })],
      encounter: { initiative: [RIVAL, ACTOR], activeIndex: 0, turnStarted: true },
    });
    expectRejected(bondPlan({ state: wrongTurn }), 'InvalidTurnState');
  });

  it('reports catalog-aware reload/migration corruption including bridge, holder, and duplicate bond state', () => {
    expect(pactBladeActorWorldIssue(world(), CATALOG, 'missing')).toMatch(/Unknown actor/);
    expect(pactBladeActorWorldIssue(world(), CATALOG, ACTOR)).toBeNull();
    const active = committedConjured();
    const missingObject = clone(active);
    delete missingObject.objects['object:conjured'];
    expect(pactBladeActorWorldIssue(missingObject, CATALOG, ACTOR)).toMatch(/missing/);
    const wrongBridge = clone(active);
    (wrongBridge.objects['object:conjured'] as PactBladeItemWorldObject).itemCardId = LONGSWORD;
    expect(pactBladeActorWorldIssue(wrongBridge, CATALOG, ACTOR)).toMatch(/bridge diverged/);
    const divergentLifecycle = clone(active);
    divergentLifecycle.actors[ACTOR].warlockPacts!.blade!.lifecyclePolicy = {
      ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      separationDistanceFt: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY.separationDistanceFt + 1,
    };
    expect(pactBladeActorWorldIssue(divergentLifecycle, CATALOG, ACTOR))
      .toMatch(/lifecycle state diverges/);
    const missingTags = clone(active);
    delete missingTags.objects['object:conjured'].tags;
    expect(pactBladeActorWorldIssue(missingTags, CATALOG, ACTOR)).toMatch(/not source-owned/);
    const nonArrayTags = clone(active);
    nonArrayTags.objects['object:conjured'].tags = 'pact_weapon' as unknown as string[];
    expect(pactBladeActorWorldIssue(nonArrayTags, CATALOG, ACTOR)).toMatch(/not source-owned/);
    const nonStringTags = clone(active);
    nonStringTags.objects['object:conjured'].tags = [7] as unknown as string[];
    expect(pactBladeActorWorldIssue(nonStringTags, CATALOG, ACTOR)).toMatch(/not source-owned/);
    const incompleteHeld = clone(active);
    delete (incompleteHeld.objects['object:conjured'] as PactBladeItemWorldObject).heldInHand;
    expect(pactBladeActorWorldIssue(incompleteHeld, CATALOG, ACTOR)).toMatch(/held-item identity/);
    const duplicate = clone(active);
    const rival = actor({ id: RIVAL });
    rival.warlockPacts!.blade!.activeBond = clone(active.actors[ACTOR].warlockPacts!.blade!.activeBond);
    rival.warlockPacts!.blade!.activeBond!.warlockActorId = RIVAL;
    duplicate.actors[RIVAL] = rival;
    expect(pactBladeActorWorldIssue(duplicate, CATALOG, ACTOR)).toMatch(/invalid Warlock bond owner/);

    const featureWithoutInvocation = actor();
    delete featureWithoutInvocation.warlockPacts;
    expect(pactBladeActorWorldIssue(
      world({ actors: [featureWithoutInvocation] }), CATALOG, ACTOR,
    )).toMatch(/invocation state is missing/);
    delete featureWithoutInvocation.capabilities.featureSources;
    expect(pactBladeActorWorldIssue(
      world({ actors: [featureWithoutInvocation] }), CATALOG, ACTOR,
    )).toBeNull();
  });

  it('rejects replay-tampered adapter events and keeps committed state detached from event JSON', () => {
    const before = world();
    const plan = appliedBond(bondPlan({ state: before }));
    const tampered = clone(plan.event);
    tampered.activeBlade.weaponObject.itemCardId = LONGSWORD;
    expect(() => evolvePactBladeBonded(before, CATALOG, tampered)).toThrow(/diverges/);
    const after = evolvePactBladeBonded(before, CATALOG, plan.event);
    (after.objects['object:conjured'] as PactBladeBoundItemWorldObject).name = 'tampered state';
    expect(plan.event.activeBlade.weaponObject.name).not.toBe('tampered state');
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    const missingActor = clone(before);
    delete missingActor.actors[ACTOR];
    expect(() => evolvePactBladeBonded(missingActor, CATALOG, plan.event))
      .toThrow(/Invalid Pact Blade bond event/);

    const committed = commitBond(before, plan);
    const distance = appliedDistance(planPactBladeDistanceTransition({
      world: committed, catalog: CATALOG, actorId: ACTOR, commandId: 'distance:tamper',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 6, elapsedSeconds: 1 },
    }));
    const badDistance = clone(distance.event);
    badDistance.facts.elapsedSeconds = 2;
    expect(() => evolvePactBladeDistanceAdvanced(committed, CATALOG, badDistance))
      .toThrow(/diverges/);
    expect(() => evolvePactBladeDistanceAdvanced(world(), CATALOG, distance.event))
      .toThrow(/Invalid Pact Blade distance event/);
    const death = appliedDeath(planPactBladeOwnerDeathTransition({
      world: committed, catalog: CATALOG, actorId: ACTOR, commandId: 'death:tamper',
      deathFact: deathFact(committed),
    }));
    const badDeath = clone(death.event);
    badDeath.removedWorldObjectIds = [];
    expect(() => evolvePactBladeEndedOnOwnerDeath(committed, CATALOG, badDeath))
      .toThrow(/diverges/);
    expect(() => evolvePactBladeEndedOnOwnerDeath(world(), CATALOG, death.event))
      .toThrow(/Invalid Pact Blade owner-death event/);
  });

  it('fails closed on every reducer-side Pact Blade event authority boundary', () => {
    const before = world();
    const bond = appliedBond(bondPlan({ state: before }));
    const invalidActorWorld = clone(before);
    delete invalidActorWorld.actors[ACTOR];
    expect(() => applyAuthorizedPactBladeBonded(invalidActorWorld, bond.event))
      .toThrow(/unknown actor/);

    const badProvenance = clone(bond.event);
    badProvenance.rulesetContentHash = 'sha256:forged';
    expect(() => applyAuthorizedPactBladeBonded(before, badProvenance))
      .toThrow(/revision or ruleset provenance/);
    const badOwnership = clone(bond.event);
    badOwnership.sourceEntityId = 'effect:foreign';
    expect(() => applyAuthorizedPactBladeBonded(before, badOwnership))
      .toThrow(/actor-owned invocation/);
    const badReplacement = clone(bond.event);
    badReplacement.endedPreviousBond = clone(bond.event.activeBlade.invocation.activeBond!);
    expect(() => applyAuthorizedPactBladeBonded(before, badReplacement))
      .toThrow(/replace exactly/);
    const badBridge = clone(bond.event);
    badBridge.setPactBondObjectId = 'object:foreign';
    expect(() => applyAuthorizedPactBladeBonded(before, badBridge))
      .toThrow(/Card\/Object bridge/);
    const badCost = clone(bond.event);
    (badCost.actionCost as { amount: number }).amount = 2;
    expect(() => applyAuthorizedPactBladeBonded(before, badCost))
      .toThrow(/Bonus Action/);
    const missingBudget = clone(before);
    delete missingBudget.actors[ACTOR].runtime.resources.bonus_action;
    expect(() => applyAuthorizedPactBladeBonded(missingBudget, bond.event))
      .toThrow(/Bonus Action/);
    const badConjure = clone(bond.event);
    badConjure.upsertWorldObjects = [];
    expect(() => applyAuthorizedPactBladeBonded(before, badConjure))
      .toThrow(/held-item authority/);

    for (const occupant of [
      item({ id: 'object:rival-hand', heldByActorId: RIVAL, heldInHand: 'main_hand' }),
      item({ id: 'object:off-hand', heldByActorId: ACTOR, heldInHand: 'off_hand' }),
      item({ id: 'object:main-hand', heldByActorId: ACTOR, heldInHand: 'main_hand' }),
    ]) {
      const occupied = clone(before);
      occupied.objects[occupant.id] = occupant;
      if (occupant.heldByActorId === ACTOR && occupant.heldInHand === 'main_hand') {
        expect(() => applyAuthorizedPactBladeBonded(occupied, bond.event))
          .toThrow(/held-item authority/);
      } else {
        expect(applyAuthorizedPactBladeBonded(occupied, bond.event).objects[occupant.id])
          .toEqual(occupant);
      }
    }

    const existing = item();
    const touchWorld = world({ objects: [existing] });
    const touch = appliedBond(bondPlan({
      state: touchWorld,
      selection: touchSelection(existing.id, LONGSWORD),
    }));
    const badTouch = clone(touch.event);
    badTouch.touchFacts!.touched = false;
    expect(() => applyAuthorizedPactBladeBonded(touchWorld, badTouch))
      .toThrow(/preserve the existing item/);

    const committed = commitBond(before, bond);
    const distance = appliedDistance(planPactBladeDistanceTransition({
      world: committed,
      catalog: CATALOG,
      actorId: ACTOR,
      commandId: 'distance:authorized-boundary',
      weaponObjectId: 'object:conjured',
      facts: { factsSource: 'board', boardRevision: 1, distanceFt: 6, elapsedSeconds: 1 },
    }));
    const badObservedBond = clone(distance.event);
    badObservedBond.previousBond.continuousSeparationSeconds = 30;
    expect(() => applyAuthorizedPactBladeDistanceAdvanced(committed, badObservedBond))
      .toThrow(/observe the active bond/);
    const badDistanceResult = clone(distance.event);
    badDistanceResult.bondEnded = true;
    expect(() => applyAuthorizedPactBladeDistanceAdvanced(committed, badDistanceResult))
      .toThrow(/threshold facts/);
    const badDistanceBridge = clone(distance.event);
    badDistanceBridge.activeBlade!.weaponObject.itemCardId = LONGSWORD;
    expect(() => applyAuthorizedPactBladeDistanceAdvanced(committed, badDistanceBridge))
      .toThrow(/Card\/Object bridge/);

    const death = appliedDeath(planPactBladeOwnerDeathTransition({
      world: committed,
      catalog: CATALOG,
      actorId: ACTOR,
      commandId: 'death:authorized-boundary',
      deathFact: deathFact(committed),
    }));
    const badDeath = clone(death.event);
    badDeath.deathFact.actorId = RIVAL;
    expect(() => applyAuthorizedPactBladeEndedOnOwnerDeath(committed, badDeath))
      .toThrow(/exact active bond/);
    const badRemoval = clone(death.event);
    badRemoval.removedWorldObjectIds = [];
    expect(() => applyAuthorizedPactBladeEndedOnOwnerDeath(committed, badRemoval))
      .toThrow(/foreign world objects/);
  });
});
