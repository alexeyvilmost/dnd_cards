import { describe, expect, it } from 'vitest';
import type { ActorState, RuleActionDefinition } from './domain';
import type { FamiliarActionDefinition } from './familiarActorCatalog';
import {
  castFindFamiliar,
  type FamiliarState,
} from './findFamiliar';
import {
  canonicalTouchSpell,
  familiarActorsOwnedBy,
  familiarActorStateIssue,
  familiarAttackRuleAction,
  findFamiliarMaterialCost,
  materializeCanonicalFamiliarActor,
  pactChainProjection,
  requireOwnedFamiliar,
  rollFamiliarInitiative,
} from './familiarRuntime';
import { createPactChainInvocationState } from './warlockPacts';

const OWNER_ID = 'actor:owner';
const SUMMON_ACTION_ID = 'action:find-familiar';
const CHAIN_SOURCE_ID = 'effect:pact-chain';
const BASE_SOURCE_ID = 'spell:find-familiar';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ownerActor(): ActorState {
  return {
    id: OWNER_ID,
    name: 'Owner',
    kind: 'playerCharacter',
    controllerId: 'controller:owner',
    capabilities: { actionIds: [SUMMON_ACTION_ID] },
    character: {
      abilityMods: { str: 0, dex: 1, con: 1, int: 3, wis: 1, cha: 0 },
      profBonus: 2,
      level: 1,
    },
    runtime: {
      hp: { current: 8, max: 8, temp: 0 },
      resources: {},
      maxResources: {},
      equipment: {},
      inventory: [],
      activeEffects: [],
    },
    lifecycle: { status: 'alive' },
    attackProfile: {
      attacksPerAction: 1,
      size: 2,
      reachFt: 5,
      graspingParts: ['main_hand'],
      sourceEntityIds: ['system:attack-action'],
    },
  };
}

function familiarState(formId = 'owl', chain = false): FamiliarState {
  return castFindFamiliar({
    familiarActorId: `${OWNER_ID}:familiar`,
    ownerActorId: OWNER_ID,
    policy: chain
      ? { kind: 'pact_chain', sourceEntityId: CHAIN_SOURCE_ID }
      : { kind: 'base', sourceEntityId: BASE_SOURCE_ID },
    method: chain ? 'pact_chain_magic_action' : 'ritual',
    formId,
    spiritType: 'fey',
    resources: { level1SpellSlots: 1, incenseGp: 10 },
    incenseOfferingGp: 10,
    materialCostGp: 10,
    baseCastingTimeSeconds: 3_600,
    mechanicsPolicy: { connectionRangeFt: 100, reappearRangeFt: 30, ritualCastingAddedSeconds: 600 },
    existingFamiliar: null,
  }).familiar;
}

function actorBundle(formId = 'owl', chain = false): {
  owner: ActorState;
  familiar: ActorState;
} {
  const owner = ownerActor();
  const state = familiarState(formId, chain);
  const familiar = materializeCanonicalFamiliarActor({
    familiar: state,
    owner,
    summoningActionId: SUMMON_ACTION_ID,
  });
  if (chain) {
    const invocation = createPactChainInvocationState({
      sourceEntityId: CHAIN_SOURCE_ID,
      ownerActorId: OWNER_ID,
      findFamiliarActionId: SUMMON_ACTION_ID,
    });
    invocation.activeFamiliar = pactChainProjection(state);
    owner.warlockPacts = { chain: invocation };
  }
  return { owner, familiar };
}

function bundleIssue(bundle: ReturnType<typeof actorBundle>): string | null {
  return familiarActorStateIssue({ actor: bundle.familiar, owner: bundle.owner });
}

function withMetadataAction(
  actor: ActorState,
  action: FamiliarActionDefinition,
): ActorState {
  const next = copy(actor);
  if (!next.familiarMetadata) throw new Error('test fixture requires familiar metadata');
  next.familiarMetadata.actions = [copy(action)];
  next.capabilities.featureSources = {
    ...next.capabilities.featureSources,
    [action.id]: [next.familiarState!.sourceEntityId, next.familiarMetadata.sourceEntityId],
  };
  return next;
}

describe('canonical familiar runtime helpers', () => {
  it('reads the exact data-owned Find Familiar material cost declaration', () => {
    for (const currency of ['gold', 'silver', 'copper'] as const) {
      expect(findFamiliarMaterialCost({
        mechanics: {
          primitive: {
            type: 'find_familiar',
            materialCostResource: 'material_incense_gp',
          },
          activation: {
            cost: [{
              resource: 'material_incense_gp',
              amount: 10,
              binding: { kind: 'currency', currency },
              recharge: 'never',
            }],
          },
        },
      })).toEqual({
        resource: 'material_incense_gp',
        amount: 10,
        binding: { kind: 'currency', currency },
        recharge: 'never',
      });
    }
  });

  it('rejects missing, non-object, ambiguous, or unrelated material declarations', () => {
    const validCost = {
      resource: 'material_incense_gp',
      amount: 10,
      binding: { kind: 'currency', currency: 'gold' },
      recharge: 'never',
    };
    const candidates: RuleActionDefinition['mechanics'][] = [
      { primitive: null },
      { primitive: 1 },
      { primitive: [] },
      { primitive: { type: 'other', materialCostResource: 'material_incense_gp' } },
      { primitive: { type: 'find_familiar' } },
      { primitive: { type: 'find_familiar', materialCostResource: 10 } },
      { primitive: { type: 'find_familiar', materialCostResource: ' ' } },
      {
        primitive: { type: 'find_familiar', materialCostResource: 'material_incense_gp' },
      },
      {
        primitive: { type: 'find_familiar', materialCostResource: 'material_incense_gp' },
        activation: [],
      },
      {
        primitive: { type: 'find_familiar', materialCostResource: 'material_incense_gp' },
        activation: { cost: {} },
      },
      {
        primitive: { type: 'find_familiar', materialCostResource: 'material_incense_gp' },
        activation: { cost: [null, 1, [], { resource: 'other' }] },
      },
      {
        primitive: { type: 'find_familiar', materialCostResource: 'material_incense_gp' },
        activation: { cost: [validCost, { ...validCost }] },
      },
    ];
    for (const mechanics of candidates) {
      expect(findFamiliarMaterialCost({ mechanics })).toBeNull();
    }
  });

  it('rejects every malformed field on the matching material cost', () => {
    const validCost = {
      resource: 'material_incense_gp',
      amount: 10,
      binding: { kind: 'currency', currency: 'gold' },
      recharge: 'never',
    };
    const invalidCosts: RuleActionDefinition['mechanics'][] = [
      { ...validCost, amount: 1.5 },
      { ...validCost, amount: 0 },
      { ...validCost, recharge: 'long_rest' },
      { ...validCost, binding: null },
      { ...validCost, binding: 1 },
      { ...validCost, binding: [] },
      { ...validCost, binding: { kind: 'resource', currency: 'gold' } },
      { ...validCost, binding: { kind: 'currency' } },
      { ...validCost, binding: { kind: 'currency', currency: 'platinum' } },
    ];
    for (const cost of invalidCosts) {
      expect(findFamiliarMaterialCost({
        mechanics: {
          primitive: {
            type: 'find_familiar',
            materialCostResource: 'material_incense_gp',
          },
          activation: { cost: [cost] },
        },
      })).toBeNull();
    }
  });

  it('selects owned familiars deterministically and rejects absent or foreign ownership', () => {
    const first = actorBundle('owl').familiar;
    const secondState = { ...familiarState('cat'), actorId: `${OWNER_ID}:familiar-2` };
    const second = materializeCanonicalFamiliarActor({
      familiar: secondState,
      owner: ownerActor(),
      summoningActionId: SUMMON_ACTION_ID,
    });
    const foreign = copy(first);
    foreign.id = 'actor:foreign:familiar';
    foreign.familiarState!.actorId = foreign.id;
    foreign.familiarState!.ownerActorId = 'actor:foreign';
    const world = { actors: { [second.id]: second, [foreign.id]: foreign, [first.id]: first } };

    expect(familiarActorsOwnedBy(world, OWNER_ID).map(({ id }) => id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(requireOwnedFamiliar(world, OWNER_ID, first.id)?.id).toBe(first.id);
    expect(requireOwnedFamiliar(world, OWNER_ID, foreign.id)).toBeNull();
    expect(requireOwnedFamiliar(world, OWNER_ID, 'missing')).toBeNull();
  });

  it('rolls initiative through die-aware and unit-interval RNG and rejects every invalid sample', () => {
    const state = familiarState();
    const dieAware = Object.assign(() => 0, { rollDie: (sides: number) => sides - 1 });
    expect(rollFamiliarInitiative({ familiar: state, modifier: 2, rng: dieAware }).initiative)
      .toEqual({ mode: 'own', d20Roll: 19, modifier: 2, total: 21 });
    expect(rollFamiliarInitiative({ familiar: state, modifier: -1, rng: () => 0.5 }).initiative)
      .toEqual({ mode: 'own', d20Roll: 11, modifier: -1, total: 10 });
    for (const sample of [Number.NaN, -0.1, 1]) {
      expect(() => rollFamiliarInitiative({ familiar: state, modifier: 0, rng: () => sample }))
        .toThrow(/\[0, 1\)/);
    }
  });

  it('materializes an exact pinned actor and projects the five Chain mirror fields', () => {
    const { owner, familiar } = actorBundle('imp', true);
    expect(familiar.controllerId).toBe(owner.controllerId);
    expect(familiar.familiarMetadata).toMatchObject({
      summoningActionId: SUMMON_ACTION_ID,
      catalogId: 'dnd2024.familiar-stat-blocks.mm2025.v1',
    });
    expect(pactChainProjection(familiar.familiarState!)).toEqual(
      owner.warlockPacts!.chain!.activeFamiliar,
    );
  });
});

describe('persisted familiar actor integrity', () => {
  it('accepts exact base and Chain projections and ignores ordinary actors', () => {
    const base = actorBundle();
    const chain = actorBundle('imp', true);
    expect(bundleIssue(base)).toBeNull();
    expect(bundleIssue(chain)).toBeNull();
    expect(familiarActorStateIssue({ actor: ownerActor(), owner: undefined })).toBeNull();

    const noReactionOwner = ownerActor();
    const noReactionState = { ...familiarState(), reactionAvailable: false };
    const noReaction = materializeCanonicalFamiliarActor({
      familiar: noReactionState,
      owner: noReactionOwner,
      summoningActionId: SUMMON_ACTION_ID,
    });
    expect(familiarActorStateIssue({ actor: noReaction, owner: noReactionOwner })).toBeNull();
  });

  it('requires both familiar branches, summoned kind, canonical state identity, and another owner', () => {
    const valid = actorBundle();
    const stateOnly = copy(valid.familiar);
    delete stateOnly.familiarMetadata;
    expect(familiarActorStateIssue({ actor: stateOnly, owner: valid.owner })).toMatch(/both/);
    const metadataOnly = copy(valid.familiar);
    delete metadataOnly.familiarState;
    expect(familiarActorStateIssue({ actor: metadataOnly, owner: valid.owner })).toMatch(/both/);

    const wrongKind = copy(valid.familiar);
    wrongKind.kind = 'monster';
    expect(familiarActorStateIssue({ actor: wrongKind, owner: valid.owner })).toMatch(/summonedActor/);
    const malformedState = copy(valid.familiar);
    malformedState.familiarState!.ownerActorId = '';
    expect(familiarActorStateIssue({ actor: malformedState, owner: valid.owner })).not.toBeNull();
    const wrongActorId = copy(valid.familiar);
    wrongActorId.familiarState!.actorId = 'actor:forged';
    expect(familiarActorStateIssue({ actor: wrongActorId, owner: valid.owner })).toMatch(/actorId/);

    expect(familiarActorStateIssue({ actor: valid.familiar, owner: undefined })).toMatch(/owner/);
    const wrongOwner = copy(valid.owner);
    wrongOwner.id = 'actor:wrong';
    expect(familiarActorStateIssue({ actor: valid.familiar, owner: wrongOwner })).toMatch(/owner/);
    const selfOwner = copy(valid.owner);
    selfOwner.id = valid.familiar.id;
    valid.familiar.familiarState!.ownerActorId = selfOwner.id;
    expect(familiarActorStateIssue({ actor: valid.familiar, owner: selfOwner }))
      .toMatch(/distinct|another actor/);
  });

  it('pins the owner-held summoning action and catalog identity', () => {
    const invalidActionIds = ['', ` ${SUMMON_ACTION_ID} `, 'action:not-owned'];
    for (const summoningActionId of invalidActionIds) {
      const { owner, familiar } = actorBundle();
      familiar.familiarMetadata!.summoningActionId = summoningActionId;
      expect(familiarActorStateIssue({ actor: familiar, owner })).toMatch(/summoning action/);
    }
    const badCatalog = actorBundle();
    badCatalog.familiar.familiarMetadata!.catalogId = 'catalog:forged';
    expect(bundleIssue(badCatalog)).toMatch(/pinned catalog/);
    const badHash = actorBundle();
    badHash.familiar.familiarMetadata!.catalogContentHash = 'fnv1a32:00000000';
    expect(bundleIssue(badHash)).toMatch(/pinned catalog/);
  });

  it('rejects an unmaterializable form and every immutable or resource forgery', () => {
    const invalidForm = actorBundle();
    invalidForm.familiar.familiarState!.form.id = 'wolf';
    invalidForm.familiar.familiarState!.form.statBlockId = 'mm2025.selection.wolf';
    expect(bundleIssue(invalidForm)).not.toBeNull();

    for (const key of [
      'name', 'kind', 'controllerId', 'ac', 'capabilities', 'character',
      'passives', 'attackProfile', 'familiarMetadata',
    ] as const) {
      const { owner, familiar } = actorBundle();
      if (key === 'kind') familiar.kind = 'monster';
      else if (key === 'ac') familiar.ac = 99;
      else if (key === 'capabilities') familiar.capabilities = { actionIds: ['forged'] };
      else if (key === 'character') familiar.character = { ...familiar.character, profBonus: 99 };
      else if (key === 'passives') familiar.passives = [{ forged: true }];
      else if (key === 'attackProfile') familiar.attackProfile = { ...familiar.attackProfile!, reachFt: 99 };
      else if (key === 'familiarMetadata') familiar.familiarMetadata = { ...familiar.familiarMetadata!, formId: 'cat' };
      else familiar[key] = 'forged';
      expect(familiarActorStateIssue({ actor: familiar, owner })).not.toBeNull();
    }

    const maxResources = actorBundle();
    maxResources.familiar.runtime.maxResources.action = 2;
    expect(bundleIssue(maxResources)).toMatch(/maximum resources/);
  });

  it('enforces pinned HP bounds, Reaction mirror, and disappearance lifecycle', () => {
    const mutations: Array<[string, (actor: ActorState) => void]> = [
      ['max', (actor) => { actor.runtime.hp.max += 1; }],
      ['integer', (actor) => { actor.runtime.hp.current = 0.5; }],
      ['negative', (actor) => { actor.runtime.hp.current = -1; }],
      ['overflow', (actor) => { actor.runtime.hp.current = actor.runtime.hp.max + 1; }],
    ];
    for (const [, mutate] of mutations) {
      const fixture = actorBundle();
      mutate(fixture.familiar);
      expect(bundleIssue(fixture)).toMatch(/hit points/);
    }

    const reaction = actorBundle();
    delete reaction.familiar.runtime.resources.reaction;
    expect(bundleIssue(reaction)).toMatch(/Reaction resource/);
    const presentAtZero = actorBundle();
    presentAtZero.familiar.runtime.hp.current = 0;
    expect(bundleIssue(presentAtZero)).toMatch(/cannot remain present/);
    const disappearedAboveZero = actorBundle();
    disappearedAboveZero.familiar.familiarState!.presence = 'disappeared_zero_hp';
    expect(bundleIssue(disappearedAboveZero)).toMatch(/retain zero/);
    const validDisappearance = actorBundle();
    validDisappearance.familiar.familiarState!.presence = 'disappeared_zero_hp';
    validDisappearance.familiar.runtime.hp.current = 0;
    expect(bundleIssue(validDisappearance)).toBeNull();
  });

  it('requires every Pact Chain mirror and forbids a base familiar in that projection', () => {
    const mutations: Array<(owner: ActorState) => void> = [
      (owner) => { delete owner.warlockPacts; },
      (owner) => { owner.warlockPacts!.chain!.ownerActorId = 'actor:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.sourceEntityId = 'effect:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.template.findFamiliarActionId = 'action:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar = null; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar!.actorId = 'actor:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar!.ownerActorId = 'actor:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar!.formId = 'quasit'; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar!.sourceEntityId = 'effect:wrong'; },
      (owner) => { owner.warlockPacts!.chain!.activeFamiliar!.reactionAvailable = false; },
    ];
    for (const mutate of mutations) {
      const fixture = actorBundle('imp', true);
      mutate(fixture.owner);
      expect(bundleIssue(fixture)).toMatch(/exactly mirror/);
    }

    const base = actorBundle();
    const invocation = createPactChainInvocationState({
      sourceEntityId: CHAIN_SOURCE_ID,
      ownerActorId: OWNER_ID,
      findFamiliarActionId: SUMMON_ACTION_ID,
    });
    invocation.activeFamiliar = pactChainProjection(base.familiar.familiarState!);
    base.owner.warlockPacts = { chain: invocation };
    expect(bundleIssue(base)).toMatch(/base familiar/);
  });
});

describe('familiar attack and Touch spell projections', () => {
  it('rejects missing state, metadata, definitions, attack data, and source authority', () => {
    const { familiar } = actorBundle();
    const noState = copy(familiar);
    delete noState.familiarState;
    expect(familiarAttackRuleAction(noState, 'anything')).toBeNull();
    const noMetadata = copy(familiar);
    delete noMetadata.familiarMetadata;
    expect(familiarAttackRuleAction(noMetadata, 'anything')).toBeNull();
    expect(familiarAttackRuleAction(familiar, 'missing')).toBeNull();

    const utility = withMetadataAction(familiar, {
      id: 'action:utility',
      name: 'Utility',
      kind: 'utility',
      economy: 'action',
      offensive: false,
    });
    expect(familiarAttackRuleAction(utility, 'action:utility')).toBeNull();
    const attackWithoutData = withMetadataAction(familiar, {
      id: 'action:no-data',
      name: 'No data',
      kind: 'attack',
      economy: 'action',
      offensive: true,
    });
    expect(familiarAttackRuleAction(attackWithoutData, 'action:no-data')).toBeNull();
    const noSource = copy(familiar);
    const attackId = noSource.familiarMetadata!.actions.find(({ kind }) => kind === 'attack')!.id;
    delete noSource.capabilities.featureSources![attackId];
    expect(familiarAttackRuleAction(noSource, attackId)).toBeNull();
  });

  it('projects melee reach/defaults, formula/average damage, ability match, and fallback', () => {
    const base = actorBundle().familiar;
    const melee: FamiliarActionDefinition = {
      id: 'action:test-melee',
      name: 'Test melee',
      kind: 'attack',
      economy: 'action',
      offensive: true,
      attack: {
        mode: 'melee',
        bonus: 3,
        reachFt: 10,
        damage: [
          { average: 2, formula: '1d4', type: 'piercing' },
          { average: 1, type: 'poison' },
        ],
      },
    };
    const projected = familiarAttackRuleAction(withMetadataAction(base, melee), melee.id)!;
    expect(projected.targeting?.rangeFt).toBe(10);
    expect(projected.mechanics.effects).toEqual([expect.objectContaining({
      ability: 'dex',
      attack_kind: 'melee',
      on_hit: [
        expect.objectContaining({ dice: '1d4' }),
        expect.objectContaining({ dice: '1' }),
      ],
    })]);

    const defaultReach = copy(melee);
    delete defaultReach.attack!.reachFt;
    expect(familiarAttackRuleAction(withMetadataAction(base, defaultReach), defaultReach.id)!
      .targeting?.rangeFt).toBe(5);

    const fallbackAbility = copy(melee);
    fallbackAbility.attack!.bonus = 99;
    expect(familiarAttackRuleAction(withMetadataAction(base, fallbackAbility), fallbackAbility.id)!
      .mechanics.effects).toEqual([expect.objectContaining({ ability: 'str' })]);
  });

  it('projects ranged long/normal/zero range and ranged ability preference', () => {
    const base = actorBundle('skeleton', true).familiar;
    const ranged: FamiliarActionDefinition = {
      id: 'action:test-ranged',
      name: 'Test ranged',
      kind: 'attack',
      economy: 'action',
      offensive: true,
      attack: {
        mode: 'ranged',
        bonus: 5,
        normalRangeFt: 80,
        longRangeFt: 320,
        damage: [{ average: 5, formula: '1d6+2', type: 'piercing' }],
      },
    };
    const projected = familiarAttackRuleAction(withMetadataAction(base, ranged), ranged.id)!;
    expect(projected.targeting?.rangeFt).toBe(320);
    expect(projected.mechanics.effects).toEqual([expect.objectContaining({
      ability: 'dex',
      attack_kind: 'ranged',
    })]);
    const normalOnly = copy(ranged);
    delete normalOnly.attack!.longRangeFt;
    expect(familiarAttackRuleAction(withMetadataAction(base, normalOnly), normalOnly.id)!
      .targeting?.rangeFt).toBe(80);
    const noRange = copy(normalOnly);
    delete noRange.attack!.normalRangeFt;
    expect(familiarAttackRuleAction(withMetadataAction(base, noRange), noRange.id)!
      .targeting?.rangeFt).toBe(0);
  });

  it('recognizes only spells with the compiled five-foot Touch declaration', () => {
    const action = (requiresTouch: boolean, rangeFt: number | undefined): RuleActionDefinition => ({
      id: `spell:${String(requiresTouch)}:${String(rangeFt)}`,
      name: 'Touch spell',
      kind: 'spell',
      sourceEntityIds: ['spell:touch'],
      spell: { level: 0, components: { verbal: true, somatic: true, material: false } },
      targeting: rangeFt === undefined ? undefined : {
        minTargets: 1,
        maxTargets: 1,
        rangeFt,
        requiresLineOfSight: true,
        allowedRelations: ['ally', 'enemy'],
        ...(requiresTouch ? { requiresTouch: true as const } : {}),
      },
      // Display text is deliberately unrelated to the executable declaration.
      mechanics: { targeting: { range: requiresTouch ? 'not localized as touch' : 'Touch' } },
    });
    const nonSpell: RuleActionDefinition = {
      id: 'action:not-spell', name: 'Not spell', kind: 'nonSpell',
      sourceEntityIds: ['action:not-spell'], mechanics: {},
    };
    expect(canonicalTouchSpell(nonSpell)).toBe(false);
    expect(canonicalTouchSpell(action(false, 5))).toBe(false);
    expect(canonicalTouchSpell(action(true, undefined))).toBe(false);
    expect(canonicalTouchSpell(action(true, 30))).toBe(false);
    expect(canonicalTouchSpell(action(true, 5))).toBe(true);
  });
});
