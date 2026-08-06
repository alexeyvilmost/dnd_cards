import { describe, expect, it } from 'vitest';
import { beginAttackSequence } from './attackSequence';
import {
  activateFamiliarSharedSenses as activateFamiliarSharedSensesPrimitive,
  canCommunicateWithFamiliar as canCommunicateWithFamiliarPrimitive,
  canFamiliarUseOrdinaryAction,
  castFindFamiliar,
  createInjectedFamiliarFormCatalog,
  deliverTouchSpellThroughFamiliar as deliverTouchSpellThroughFamiliarPrimitive,
  dismissFamiliar,
  familiarDropsToZeroHp,
  familiarSharedSensesActive,
  familiarStateIssue,
  FAMILIAR_SPIRIT_TYPES,
  FIND_FAMILIAR_BASE_FORMS,
  injectedFamiliarFormCatalogIssue,
  PACT_CHAIN_ATTACK_REPLACEMENT_KEY,
  PACT_CHAIN_SPECIAL_FAMILIAR_FORMS,
  parseFindFamiliarMechanicsPolicy,
  reappearFamiliar as reappearFamiliarPrimitive,
  resolveFamiliarForm,
  setFamiliarEquipment,
  setFamiliarInitiative,
  startFamiliarTurn,
  startOwnerTurnForFamiliar,
  substitutePactChainFamiliarAttack,
  type FamiliarState,
  type FindFamiliarCastMethod,
  type FindFamiliarExtensionPolicy,
  type FindFamiliarMechanicsPolicy,
  type FindFamiliarResources,
  type FamiliarSpiritType,
  type FamiliarValidationContext,
  type InjectedCr0BeastForm,
} from './findFamiliar';

const basePolicy = { kind: 'base', sourceEntityId: 'SPELL-find-familiar' } as const;
const chainPolicy = { kind: 'pact_chain', sourceEntityId: 'EFF-pact-chain' } as const;
const mechanicsPolicy: FindFamiliarMechanicsPolicy = {
  connectionRangeFt: 100,
  reappearRangeFt: 30,
  ritualCastingAddedSeconds: 600,
};
const materialCostGp = 10;
const baseCastingTimeSeconds = 3_600;
const injectedCatalog = createInjectedFamiliarFormCatalog({
  catalogId: 'micro-mvp.cr0-beasts.v1',
  forms: [
    { id: 'fish', name: 'Fish', statBlockId: 'MM-fish', creatureType: 'beast', challengeRating: 0 },
    { id: 'almiraj', name: 'Almiraj', statBlockId: 'MM2024-almiraj', creatureType: 'beast', challengeRating: 0 },
  ],
});
const injectedValidation = { injectedFormCatalog: injectedCatalog } as const;

function canCommunicateWithFamiliar(
  input: Omit<Parameters<typeof canCommunicateWithFamiliarPrimitive>[0], 'mechanicsPolicy'>,
) {
  return canCommunicateWithFamiliarPrimitive({ ...input, mechanicsPolicy });
}

function activateFamiliarSharedSenses(
  input: Omit<Parameters<typeof activateFamiliarSharedSensesPrimitive>[0], 'mechanicsPolicy'>,
) {
  return activateFamiliarSharedSensesPrimitive({ ...input, mechanicsPolicy });
}

function deliverTouchSpellThroughFamiliar(
  input: Omit<Parameters<typeof deliverTouchSpellThroughFamiliarPrimitive>[0], 'mechanicsPolicy'>,
) {
  return deliverTouchSpellThroughFamiliarPrimitive({ ...input, mechanicsPolicy });
}

function reappearFamiliar(
  input: Omit<Parameters<typeof reappearFamiliarPrimitive>[0], 'mechanicsPolicy'>,
) {
  return reappearFamiliarPrimitive({ ...input, mechanicsPolicy });
}

function cast(input: {
  policy?: FindFamiliarExtensionPolicy;
  method?: FindFamiliarCastMethod;
  formId?: string;
  spiritType?: FamiliarSpiritType;
  familiarActorId?: string;
  ownerActorId?: string;
  resources?: FindFamiliarResources;
  incenseOfferingGp?: number;
  existingFamiliar?: FamiliarState;
  validation?: FamiliarValidationContext;
} = {}) {
  return castFindFamiliar({
    familiarActorId: input.familiarActorId ?? 'wizard:familiar',
    ownerActorId: input.ownerActorId ?? 'wizard',
    policy: input.policy ?? basePolicy,
    method: input.method ?? 'ritual',
    formId: input.formId ?? 'owl',
    spiritType: input.spiritType ?? 'fey',
    resources: input.resources ?? { level1SpellSlots: 1, incenseGp: 10 },
    incenseOfferingGp: input.incenseOfferingGp ?? 10,
    materialCostGp,
    baseCastingTimeSeconds,
    mechanicsPolicy,
    existingFamiliar: input.existingFamiliar ?? null,
    ...(input.validation ? { validation: input.validation } : {}),
  });
}

function presentFamiliar(): FamiliarState {
  return cast().familiar;
}

function jsonRoundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Find Familiar form extension policy', () => {
  it('parses an exact data-owned primitive and rejects every omission, extra field, and invalid value', () => {
    const primitive = {
      type: 'find_familiar',
      materialCostResource: 'material_incense_gp',
      policy: {
        connection_range_ft: 75,
        reappear_range_ft: 12,
        ritual_casting_added_seconds: 42,
      },
    };
    expect(parseFindFamiliarMechanicsPolicy({ primitive })).toEqual({
      status: 'valid',
      materialCostResource: 'material_incense_gp',
      policy: {
        connectionRangeFt: 75,
        reappearRangeFt: 12,
        ritualCastingAddedSeconds: 42,
      },
    });
    for (const field of Object.keys(primitive)) {
      const incomplete = { ...primitive } as Record<string, unknown>;
      delete incomplete[field];
      expect(parseFindFamiliarMechanicsPolicy({ primitive: incomplete }).status).toBe('invalid');
    }
    for (const field of Object.keys(primitive.policy)) {
      const policy = { ...primitive.policy } as Record<string, unknown>;
      delete policy[field];
      expect(parseFindFamiliarMechanicsPolicy({
        primitive: { ...primitive, policy },
      }).status).toBe('invalid');
    }
    for (const candidate of [
      { ...primitive, unknown: true },
      { ...primitive, materialCostResource: ' ' },
      { ...primitive, policy: { ...primitive.policy, unknown: true } },
      { ...primitive, policy: { ...primitive.policy, connection_range_ft: 0 } },
      { ...primitive, policy: { ...primitive.policy, reappear_range_ft: Number.NaN } },
      { ...primitive, policy: { ...primitive.policy, ritual_casting_added_seconds: 1.5 } },
    ]) {
      expect(parseFindFamiliarMechanicsPolicy({ primitive: candidate }).status).toBe('invalid');
    }
  });

  it('interprets mutated ranges and ritual duration instead of PHB-named defaults', () => {
    const policy: FindFamiliarMechanicsPolicy = {
      connectionRangeFt: 75,
      reappearRangeFt: 12,
      ritualCastingAddedSeconds: 42,
    };
    const familiar = presentFamiliar();
    expect(canCommunicateWithFamiliarPrimitive({
      familiar, ownerActorId: 'wizard', distanceFt: 75, mechanicsPolicy: policy,
    })).toBe(true);
    expect(canCommunicateWithFamiliarPrimitive({
      familiar, ownerActorId: 'wizard', distanceFt: 75.001, mechanicsPolicy: policy,
    })).toBe(false);
    const pocket = dismissFamiliar({
      familiar, ownerActorId: 'wizard', mode: 'temporary',
    }).familiar!;
    expect(reappearFamiliarPrimitive({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 12,
      unoccupiedSpace: true, mechanicsPolicy: policy,
    }).presence).toBe('present');
    expect(() => reappearFamiliarPrimitive({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 12.001,
      unoccupiedSpace: true, mechanicsPolicy: policy,
    })).toThrow(/within 12 feet/);
    expect(castFindFamiliar({
      familiarActorId: 'wizard:mutated-familiar', ownerActorId: 'wizard',
      policy: basePolicy, method: 'ritual', formId: 'cat', spiritType: 'fey',
      resources: { level1SpellSlots: 1, incenseGp: 10 }, incenseOfferingGp: 10,
      materialCostGp, baseCastingTimeSeconds, mechanicsPolicy: policy,
      existingFamiliar: null,
    }).castingDuration).toEqual({
      kind: 'timed', baseSeconds: 3_600, ritualAddedSeconds: 42, totalSeconds: 3_642,
    });
  });

  it('exposes exactly the eleven PHB base forms and eight Pact Chain special forms', () => {
    expect(FIND_FAMILIAR_BASE_FORMS).toEqual([
      'bat', 'cat', 'frog', 'hawk', 'lizard', 'octopus',
      'owl', 'rat', 'raven', 'spider', 'weasel',
    ]);
    expect(PACT_CHAIN_SPECIAL_FAMILIAR_FORMS).toEqual([
      'imp', 'pseudodragon', 'quasit', 'skeleton', 'slaad_tadpole',
      'sphinx_of_wonder', 'sprite', 'venomous_snake',
    ]);
    expect(FAMILIAR_SPIRIT_TYPES).toEqual(['celestial', 'fey', 'fiend']);
    expect(materialCostGp).toBe(10);
    expect(mechanicsPolicy).toEqual({
      connectionRangeFt: 100,
      reappearRangeFt: 30,
      ritualCastingAddedSeconds: 600,
    });
    expect(baseCastingTimeSeconds).toBe(3_600);
  });

  it.each(FIND_FAMILIAR_BASE_FORMS)('resolves base form %s for both policies', (formId) => {
    for (const policy of [basePolicy, chainPolicy]) {
      expect(resolveFamiliarForm({ formId, policy })).toEqual({
        id: formId,
        name: `${formId.charAt(0).toUpperCase()}${formId.slice(1)}`,
        statBlockId: `phb2024.beast.${formId}`,
        eligibility: 'base_standard',
        baseCreatureType: 'beast',
        challengeRating: 0,
      });
    }
  });

  it.each(PACT_CHAIN_SPECIAL_FAMILIAR_FORMS)('adds Chain-only special form %s', (formId) => {
    const result = resolveFamiliarForm({ formId, policy: chainPolicy });
    expect(result).toMatchObject({
      id: formId,
      statBlockId: `phb2024.pact_chain.${formId}`,
      eligibility: 'pact_chain_special',
    });
    expect(result.name).toBe(formId.split('_').map((part) => (
      `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )).join(' '));
    expect(() => resolveFamiliarForm({ formId, policy: basePolicy }))
      .toThrow(/requires Pact of the Chain/);
  });

  it('admits an explicitly catalog-proven CR 0 Beast under either policy', () => {
    for (const policy of [basePolicy, chainPolicy]) {
      expect(resolveFamiliarForm({
        formId: 'almiraj', policy, validation: injectedValidation,
      })).toEqual({
        id: 'almiraj', name: 'Almiraj', statBlockId: 'MM2024-almiraj',
        eligibility: 'injected_cr0_beast', baseCreatureType: 'beast', challengeRating: 0,
        injectedFormProof: {
          catalogId: 'micro-mvp.cr0-beasts.v1',
          formId: 'almiraj',
          statBlockId: 'MM2024-almiraj',
        },
      });
    }
    expect(Object.isFrozen(injectedCatalog)).toBe(true);
    expect(Object.isFrozen(injectedCatalog.forms)).toBe(true);
    expect(injectedCatalog.forms.every(Object.isFrozen)).toBe(true);
    expect(injectedCatalog.forms.map(({ id }) => id)).toEqual(['almiraj', 'fish']);
    expect(injectedFamiliarFormCatalogIssue(jsonRoundTrip(injectedCatalog))).toBeNull();
  });

  it('fails closed on invalid injected forms, collisions, duplicates, and unknown forms', () => {
    const valid: InjectedCr0BeastForm = {
      id: 'fish', name: 'Fish', statBlockId: 'MM-fish', creatureType: 'beast', challengeRating: 0,
    };
    const invalidCandidates: unknown[] = [
      { ...valid, id: ' ' },
      { ...valid, name: ' ' },
      { ...valid, statBlockId: '' },
      { ...valid, creatureType: 'monstrosity' },
      { ...valid, challengeRating: 0.125 },
      { ...valid, id: 'owl' },
      { ...valid, id: 'imp' },
    ];
    for (const candidate of invalidCandidates) {
      expect(() => createInjectedFamiliarFormCatalog({
        catalogId: 'bad', forms: [candidate as InjectedCr0BeastForm],
      })).toThrow(/stable|non-empty|CR 0 Beast|collides/);
    }
    expect(() => createInjectedFamiliarFormCatalog({
      catalogId: 'bad', forms: [valid, { ...valid }],
    })).toThrow(/duplicated/);
    expect(() => createInjectedFamiliarFormCatalog({ catalogId: ' ', forms: [] }))
      .toThrow(/stable non-empty/);
    expect(() => resolveFamiliarForm({ formId: 'wolf', policy: basePolicy }))
      .toThrow(/Unknown eligible/);
    expect(() => resolveFamiliarForm({ formId: ' ', policy: basePolicy }))
      .toThrow(/stable non-empty/);
    expect(() => resolveFamiliarForm({
      formId: 'cat', policy: { kind: 'base', sourceEntityId: ' ' },
    })).toThrow(/policy source/);
    expect(() => resolveFamiliarForm({
      formId: 'cat',
      policy: { kind: 'tome', sourceEntityId: 'source' } as unknown as FindFamiliarExtensionPolicy,
    })).toThrow(/unknown extension policy/);
  });

  it('validates serialized catalogs and rejects noncanonical or self-declared authority', () => {
    const valid = jsonRoundTrip(injectedCatalog);
    const cases: Array<[unknown, RegExp]> = [
      [null, /schema version 1/],
      [{}, /schema version 1/],
      [{ ...valid, schemaVersion: 2 }, /schema version 1/],
      [{ ...valid, catalogId: '' }, /canonical stable id/],
      [{ ...valid, catalogId: ' catalog ' }, /canonical stable id/],
      [{ ...valid, forms: null }, /forms array/],
      [{ ...valid, forms: [{}] }, /contains an invalid form/],
      [{ ...valid, forms: [{ ...valid.forms[0], challengeRating: 1 }] }, /contains an invalid form/],
      [{ ...valid, forms: [valid.forms[1], valid.forms[0]] }, /canonical and sorted/],
      [{ ...valid, forms: [{ ...valid.forms[0], name: ' Almiraj ' }, valid.forms[1]] }, /canonical and sorted/],
    ];
    for (const [candidate, message] of cases) {
      expect(injectedFamiliarFormCatalogIssue(candidate)).toMatch(message);
    }
    const invalidContext = {
      injectedFormCatalog: { ...valid, forms: [valid.forms[1], valid.forms[0]] },
    } as FamiliarValidationContext;
    expect(() => resolveFamiliarForm({
      formId: 'cat', policy: basePolicy, validation: invalidContext,
    })).toThrow(/canonical and sorted/);
    expect(() => resolveFamiliarForm({
      formId: 'almiraj', policy: basePolicy,
    })).toThrow(/Unknown eligible/);
  });

  it('requires the same trusted catalog proof for every injected-form operation', () => {
    const injected = cast({ formId: 'almiraj', validation: injectedValidation }).familiar;
    expect(familiarStateIssue(injected)).toMatch(/trusted validation catalog/);
    expect(familiarStateIssue(injected, injectedValidation)).toBeNull();
    expect(canCommunicateWithFamiliar({
      familiar: jsonRoundTrip(injected), ownerActorId: 'wizard', distanceFt: 100,
      validation: { injectedFormCatalog: jsonRoundTrip(injectedCatalog) },
    })).toBe(true);
    expect(() => canCommunicateWithFamiliar({
      familiar: injected, ownerActorId: 'wizard', distanceFt: 0,
    })).toThrow(/trusted validation catalog/);

    const otherCatalog = createInjectedFamiliarFormCatalog({
      catalogId: 'other.catalog',
      forms: [{
        id: 'almiraj', name: 'Almiraj', statBlockId: 'MM2024-almiraj',
        creatureType: 'beast', challengeRating: 0,
      }],
    });
    expect(familiarStateIssue(injected, { injectedFormCatalog: otherCatalog }))
      .toMatch(/does not match its trusted catalog proof/);
    expect(familiarStateIssue(injected, {
      injectedFormCatalog: {
        ...jsonRoundTrip(injectedCatalog),
        forms: [...jsonRoundTrip(injectedCatalog).forms].reverse(),
      },
    })).toMatch(/canonical and sorted/);
    expect(familiarStateIssue({
      ...injected,
      form: { ...injected.form, injectedFormProof: { ...injected.form.injectedFormProof!, formId: 'fish' } },
    }, injectedValidation)).toMatch(/does not match/);
    expect(familiarStateIssue({
      ...injected,
      form: { ...injected.form, name: 'Forged Beast' },
    }, injectedValidation)).toMatch(/does not match/);
    expect(familiarStateIssue({
      ...injected,
      form: { ...injected.form, injectedFormProof: undefined },
    }, injectedValidation)).toMatch(/does not match/);
  });
});

describe('Find Familiar casting, resources, and one-familiar invariant', () => {
  it('rejects invalid declared mechanics policy, material cost, and casting time', () => {
    const validInput: Parameters<typeof castFindFamiliar>[0] = {
      familiarActorId: 'wizard:familiar',
      ownerActorId: 'wizard',
      policy: basePolicy,
      method: 'ritual',
      formId: 'owl',
      spiritType: 'fey',
      resources: { level1SpellSlots: 1, incenseGp: 10 },
      incenseOfferingGp: 10,
      materialCostGp,
      baseCastingTimeSeconds,
      mechanicsPolicy,
      existingFamiliar: null,
    };
    const invalidPolicies = [
      null,
      { ...mechanicsPolicy, connectionRangeFt: 0 },
      { ...mechanicsPolicy, reappearRangeFt: Number.NaN },
      { ...mechanicsPolicy, ritualCastingAddedSeconds: 1.5 },
    ];
    for (const invalidPolicy of invalidPolicies) {
      expect(() => castFindFamiliar({
        ...validInput,
        mechanicsPolicy: invalidPolicy as unknown as FindFamiliarMechanicsPolicy,
      })).toThrow(/mechanics policy is invalid/);
    }

    expect(() => castFindFamiliar({ ...validInput, materialCostGp: 0 }))
      .toThrow(/positive declared material cost and casting time/);
    expect(() => castFindFamiliar({ ...validInput, baseCastingTimeSeconds: 0 }))
      .toThrow(/positive declared material cost and casting time/);
  });

  it.each(FAMILIAR_SPIRIT_TYPES)('creates an independent %s spirit with its own Initiative', (spiritType) => {
    const result = cast({ spiritType });
    expect(result).toMatchObject({
      consumedIncenseGp: 10,
      spellSlotsExpended: 0,
      castingTime: 'ritual',
      castingDuration: {
        kind: 'timed', baseSeconds: 3_600, ritualAddedSeconds: 600, totalSeconds: 4_200,
      },
      created: true,
      changedForm: false,
      resources: { level1SpellSlots: 1, incenseGp: 0 },
    });
    expect(result.familiar).toEqual({
      schemaVersion: 1,
      actorId: 'wizard:familiar',
      ownerActorId: 'wizard',
      sourceEntityId: 'SPELL-find-familiar',
      extension: 'base',
      form: {
        id: 'owl', name: 'Owl', statBlockId: 'phb2024.beast.owl',
        eligibility: 'base_standard', baseCreatureType: 'beast', challengeRating: 0,
      },
      spiritType,
      presence: 'present',
      initiative: { mode: 'own', d20Roll: null, modifier: null, total: null },
      reactionAvailable: true,
      sharedSenses: null,
      carriedItemIds: [],
      wornItemIds: [],
      allyToOwnerAndAllies: true,
      actsIndependently: true,
      obeysOwnerCommands: true,
      canAttackNormally: false,
    });
    expect(familiarStateIssue(jsonRoundTrip(result.familiar))).toBeNull();
  });

  it('distinguishes slot, ritual, and Pact Chain Magic-action casts while always consuming incense', () => {
    const resources = { level1SpellSlots: 2, incenseGp: 36 };
    const slotted = cast({ method: 'spell_slot', resources, incenseOfferingGp: 10 });
    expect(slotted).toMatchObject({
      castingTime: 'one_hour', spellSlotsExpended: 1, consumedIncenseGp: 10,
      castingDuration: {
        kind: 'timed', baseSeconds: 3_600, ritualAddedSeconds: 0, totalSeconds: 3_600,
      },
      resources: { level1SpellSlots: 1, incenseGp: 26 },
    });
    const ritual = cast({ method: 'ritual', resources, incenseOfferingGp: 11 });
    expect(ritual).toMatchObject({
      castingTime: 'ritual', spellSlotsExpended: 0, consumedIncenseGp: 11,
      castingDuration: {
        kind: 'timed', baseSeconds: 3_600, ritualAddedSeconds: 600, totalSeconds: 4_200,
      },
      resources: { level1SpellSlots: 2, incenseGp: 25 },
    });
    const chain = cast({
      policy: chainPolicy, method: 'pact_chain_magic_action', formId: 'imp',
      resources: { level1SpellSlots: 0, incenseGp: 15 }, incenseOfferingGp: 15,
    });
    expect(chain).toMatchObject({
      castingTime: 'magic_action', spellSlotsExpended: 0, consumedIncenseGp: 15,
      castingDuration: { kind: 'magic_action' },
      resources: { level1SpellSlots: 0, incenseGp: 0 },
      familiar: { extension: 'pact_chain', sourceEntityId: 'EFF-pact-chain' },
    });
    expect(resources).toEqual({ level1SpellSlots: 2, incenseGp: 36 });

    expect(() => cast({
      policy: chainPolicy, method: 'pact_chain_magic_action',
      resources: { level1SpellSlots: 99, incenseGp: 9.99 }, incenseOfferingGp: 9.99,
    })).toThrow(/at least 10 GP/);
  });

  it('recasts by transforming the same actor, never by retaining a second familiar', () => {
    const existing = setFamiliarEquipment({
      familiar: setFamiliarInitiative({
        familiar: presentFamiliar(), familiarActorId: 'wizard:familiar', d20Roll: 17, modifier: 3,
      }),
      carriedItemIds: ['key'], wornItemIds: ['collar'],
    });
    const transformed = cast({
      policy: chainPolicy,
      method: 'pact_chain_magic_action',
      formId: 'sphinx_of_wonder',
      familiarActorId: existing.actorId,
      ownerActorId: existing.ownerActorId,
      spiritType: existing.spiritType,
      existingFamiliar: existing,
      resources: { level1SpellSlots: 0, incenseGp: 10 },
    });
    expect(transformed).toMatchObject({ created: false, changedForm: true });
    expect(transformed.familiar).toMatchObject({
      actorId: existing.actorId,
      ownerActorId: existing.ownerActorId,
      extension: 'pact_chain',
      sourceEntityId: 'EFF-pact-chain',
      presence: 'present',
      form: { id: 'sphinx_of_wonder', eligibility: 'pact_chain_special' },
      initiative: { mode: 'own', d20Roll: 17, modifier: 3, total: 20 },
      carriedItemIds: ['key'],
      wornItemIds: ['collar'],
    });
    expect(existing.form.id).toBe('owl');
    expect(existing.extension).toBe('base');

    const sameForm = cast({
      familiarActorId: existing.actorId,
      existingFamiliar: existing,
      spiritType: existing.spiritType,
    });
    expect(sameForm).toMatchObject({ created: false, changedForm: false });
    expect(sameForm.familiar.actorId).toBe(existing.actorId);
  });

  it('recasts after zero HP to reappear, including in the same form', () => {
    const vanished = familiarDropsToZeroHp(presentFamiliar()).familiar!;
    const restored = cast({
      existingFamiliar: vanished,
      familiarActorId: vanished.actorId,
      ownerActorId: vanished.ownerActorId,
      spiritType: vanished.spiritType,
      formId: vanished.form.id,
    });
    expect(restored).toMatchObject({ created: false, changedForm: false });
    expect(restored.familiar.presence).toBe('present');
  });

  it('rejects resource, material, identity, type, method, and recast forgeries', () => {
    const badResourceCases: Array<[Partial<FindFamiliarResources>, number, RegExp]> = [
      [{ level1SpellSlots: -1 }, 10, /non-negative integer/],
      [{ level1SpellSlots: 1.5 }, 10, /non-negative integer/],
      [{ incenseGp: -1 }, 10, /finite and non-negative/],
      [{ incenseGp: Number.NaN }, 10, /finite and non-negative/],
      [{ incenseGp: Number.POSITIVE_INFINITY }, 10, /finite and non-negative/],
      [{ incenseGp: 100 }, -1, /finite and non-negative/],
      [{ incenseGp: 100 }, Number.NaN, /finite and non-negative/],
      [{ incenseGp: 100 }, 9.999, /at least 10 GP/],
      [{ incenseGp: 10 }, 10.001, /at least 10 GP/],
    ];
    for (const [override, offering, message] of badResourceCases) {
      expect(() => cast({
        resources: { level1SpellSlots: 1, incenseGp: 10, ...override },
        incenseOfferingGp: offering,
      })).toThrow(message);
    }
    expect(() => cast({
      method: 'spell_slot', resources: { level1SpellSlots: 0, incenseGp: 10 },
    })).toThrow(/requires a level-1 slot/);
    expect(() => cast({ method: 'pact_chain_magic_action', policy: basePolicy }))
      .toThrow(/Only Pact of the Chain/);
    expect(() => cast({ method: 'instant' as FindFamiliarCastMethod }))
      .toThrow(/unknown casting method/);
    expect(() => cast({ familiarActorId: ' ' })).toThrow(/Familiar actor/);
    expect(() => cast({ ownerActorId: '' })).toThrow(/Familiar owner/);
    expect(() => cast({ familiarActorId: 'wizard', ownerActorId: 'wizard' }))
      .toThrow(/cannot be its own owner/);
    expect(() => cast({ spiritType: 'elemental' as FamiliarSpiritType }))
      .toThrow(/Celestial, Fey, or Fiend/);

    const existing = presentFamiliar();
    expect(() => cast({
      existingFamiliar: existing, familiarActorId: 'other:familiar',
    })).toThrow(/existing familiar actor/);
    expect(() => cast({
      existingFamiliar: existing, ownerActorId: 'other',
    })).toThrow(/existing familiar actor/);
    expect(() => cast({
      existingFamiliar: existing, spiritType: 'fiend',
    })).toThrow(/changes form, not/);
    expect(() => cast({
      existingFamiliar: { ...existing, schemaVersion: 2 as 1 },
    })).toThrow(/schema version/);
  });
});

describe('Find Familiar connection, senses, and spell delivery', () => {
  it('allows telepathy at 0 and exactly 100 feet, but only while present', () => {
    const familiar = presentFamiliar();
    for (const distanceFt of [0, 100]) {
      expect(canCommunicateWithFamiliar({
        familiar, ownerActorId: 'wizard', distanceFt,
      })).toBe(true);
    }
    expect(canCommunicateWithFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 100.001,
    })).toBe(false);
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(canCommunicateWithFamiliar({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 0,
    })).toBe(false);
    expect(() => canCommunicateWithFamiliar({
      familiar, ownerActorId: 'other', distanceFt: 0,
    })).toThrow(/not owned/);
    for (const distanceFt of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => canCommunicateWithFamiliar({
        familiar, ownerActorId: 'wizard', distanceFt,
      })).toThrow(/finite and non-negative/);
    }
  });

  it('uses a Bonus Action to share all familiar senses until exactly the next owner-turn start', () => {
    const familiar = presentFamiliar();
    const shared = activateFamiliarSharedSenses({
      familiar, ownerActorId: 'wizard', distanceFt: 100, ownerTurn: 7,
    });
    expect(shared.sharedSenses).toEqual({
      activatedOnOwnerTurn: 7,
      expiresAtOwnerTurnStart: 8,
      includesFormSpecialSenses: true,
    });
    expect(familiar.sharedSenses).toBeNull();
    expect(familiarSharedSensesActive({
      familiar: shared, ownerActorId: 'wizard', ownerTurn: 7,
    })).toBe(true);
    expect(familiarSharedSensesActive({
      familiar: shared, ownerActorId: 'wizard', ownerTurn: 6,
    })).toBe(false);
    expect(familiarSharedSensesActive({
      familiar: shared, ownerActorId: 'wizard', ownerTurn: 8,
    })).toBe(false);
    const beforeExpiry = startOwnerTurnForFamiliar({
      familiar: shared, ownerActorId: 'wizard', ownerTurn: 7,
    });
    expect(beforeExpiry.sharedSenses).toEqual(shared.sharedSenses);
    expect(beforeExpiry).not.toBe(shared);
    const expired = startOwnerTurnForFamiliar({
      familiar: shared, ownerActorId: 'wizard', ownerTurn: 8,
    });
    expect(expired.sharedSenses).toBeNull();
    expect(startOwnerTurnForFamiliar({
      familiar, ownerActorId: 'wizard', ownerTurn: 1,
    })).toEqual(familiar);
  });

  it('fails closed when shared senses lack range, presence, owner, or turn facts', () => {
    const familiar = presentFamiliar();
    expect(() => activateFamiliarSharedSenses({
      familiar, ownerActorId: 'wizard', distanceFt: 100.001, ownerTurn: 0,
    })).toThrow(/within 100 feet/);
    expect(() => activateFamiliarSharedSenses({
      familiar, ownerActorId: 'wizard', distanceFt: -1, ownerTurn: 0,
    })).toThrow(/finite and non-negative/);
    expect(() => activateFamiliarSharedSenses({
      familiar, ownerActorId: 'wizard', distanceFt: 0, ownerTurn: -1,
    })).toThrow(/non-negative integer/);
    expect(() => activateFamiliarSharedSenses({
      familiar, ownerActorId: 'wizard', distanceFt: 0, ownerTurn: 1.5,
    })).toThrow(/non-negative integer/);
    expect(() => activateFamiliarSharedSenses({
      familiar, ownerActorId: 'other', distanceFt: 0, ownerTurn: 0,
    })).toThrow(/not owned/);
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(() => activateFamiliarSharedSenses({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 0, ownerTurn: 0,
    })).toThrow(/must be present/);
    expect(() => familiarSharedSensesActive({
      familiar, ownerActorId: 'wizard', ownerTurn: -1,
    })).toThrow(/non-negative integer/);
    expect(() => startOwnerTurnForFamiliar({
      familiar, ownerActorId: 'other', ownerTurn: 0,
    })).toThrow(/not owned/);
  });

  it('delivers only Touch spells within 100 feet by spending the familiar Reaction', () => {
    for (const distanceFt of [0, 100]) {
      const familiar = presentFamiliar();
      const result = deliverTouchSpellThroughFamiliar({
        familiar,
        ownerActorId: 'wizard',
        distanceFt,
        spellActionId: 'spell.cure-wounds',
        spellRange: 'touch',
      });
      expect(result).toEqual({
        familiar: { ...familiar, reactionAvailable: false },
        delivery: {
          spellActionId: 'spell.cure-wounds',
          casterActorId: 'wizard',
          deliveryActorId: 'wizard:familiar',
          range: 'touch',
          reactionSpent: true,
        },
      });
      expect(familiar.reactionAvailable).toBe(true);
    }
  });

  it('rejects non-Touch, distant, absent, ownerless, actionless, or Reaction-less delivery', () => {
    const familiar = presentFamiliar();
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: 'spell.magic-missile', spellRange: 'other',
    })).toThrow(/only a Touch-range/);
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 100.001,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    })).toThrow(/within 100 feet/);
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: -1,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    })).toThrow(/finite and non-negative/);
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: ' ', spellRange: 'touch',
    })).toThrow(/stable non-empty/);
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'other', distanceFt: 0,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    })).toThrow(/not owned/);
    const spent = deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    }).familiar;
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar: spent, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    })).toThrow(/Reaction is unavailable/);
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(() => deliverTouchSpellThroughFamiliar({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    })).toThrow(/must be present/);
  });
});

describe('Find Familiar combat and Pact Chain attack replacement', () => {
  it('rolls its own Initiative, is an ally, acts independently, and normally cannot Attack', () => {
    const familiar = presentFamiliar();
    expect(familiar).toMatchObject({
      allyToOwnerAndAllies: true,
      actsIndependently: true,
      obeysOwnerCommands: true,
      canAttackNormally: false,
      initiative: { mode: 'own' },
    });
    for (const [d20Roll, modifier, total] of [[1, -5, -4], [20, 4, 24]]) {
      const rolled = setFamiliarInitiative({
        familiar, familiarActorId: familiar.actorId, d20Roll, modifier,
      });
      expect(rolled.initiative).toEqual({ mode: 'own', d20Roll, modifier, total });
      expect(familiar.initiative.total).toBeNull();
    }
    expect(canFamiliarUseOrdinaryAction({ familiar, actionKind: 'Attack' })).toBe(false);
    expect(canFamiliarUseOrdinaryAction({ familiar, actionKind: 'attack' })).toBe(false);
    for (const actionKind of ['dash', 'dodge', 'help', 'hide', 'ready', 'search']) {
      expect(canFamiliarUseOrdinaryAction({ familiar, actionKind })).toBe(true);
    }
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(canFamiliarUseOrdinaryAction({ familiar: pocket, actionKind: 'help' })).toBe(false);
  });

  it('fails closed on forged Initiative or action facts and refreshes Reaction only on its own turn', () => {
    const familiar = presentFamiliar();
    for (const [d20Roll, modifier] of [
      [0, 0], [21, 0], [1.5, 0], [Number.NaN, 0], [10, 1.5], [10, Number.NaN],
    ]) {
      expect(() => setFamiliarInitiative({
        familiar, familiarActorId: familiar.actorId, d20Roll, modifier,
      })).toThrow(/explicit d20 roll/);
    }
    expect(() => setFamiliarInitiative({
      familiar, familiarActorId: 'wizard', d20Roll: 10, modifier: 0,
    })).toThrow(/own Initiative/);
    expect(() => canFamiliarUseOrdinaryAction({ familiar, actionKind: ' ' }))
      .toThrow(/stable non-empty/);

    const spent = deliverTouchSpellThroughFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 0,
      spellActionId: 'spell.cure-wounds', spellRange: 'touch',
    }).familiar;
    expect(startFamiliarTurn({ familiar: spent, familiarActorId: spent.actorId }).reactionAvailable)
      .toBe(true);
    expect(() => startFamiliarTurn({ familiar: spent, familiarActorId: 'wizard' }))
      .toThrow(/own turn/);
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(() => startFamiliarTurn({ familiar: pocket, familiarActorId: pocket.actorId }))
      .toThrow(/must be present/);
    expect(() => setFamiliarInitiative({
      familiar: pocket, familiarActorId: pocket.actorId, d20Roll: 10, modifier: 0,
    })).toThrow(/must be present/);
  });

  it('uses one familiar Reaction to replace exactly one attack in the owner Attack action', () => {
    const familiar = cast({
      policy: chainPolicy, method: 'pact_chain_magic_action', formId: 'imp',
    }).familiar;
    const sequence = beginAttackSequence({ id: 'attack-1', actorId: 'wizard', totalAttacks: 2 });
    const result = substitutePactChainFamiliarAttack({
      familiar,
      ownerActorId: 'wizard',
      policy: chainPolicy,
      sequence,
      familiarAttackActionId: 'imp.sting',
    });
    expect(result).toMatchObject({
      attackingActorId: familiar.actorId,
      reactionSpent: true,
      familiar: { reactionAvailable: false },
      sequence: {
        id: 'attack-1',
        attacksRemaining: 1,
        usedReplacementKeys: [PACT_CHAIN_ATTACK_REPLACEMENT_KEY],
        entries: [{
          ordinal: 1,
          kind: 'replacement',
          actionId: 'imp.sting',
          replacementKey: PACT_CHAIN_ATTACK_REPLACEMENT_KEY,
          sourceEntityIds: ['EFF-pact-chain', 'phb2024.pact_chain.imp'],
        }],
      },
    });
    expect(sequence.attacksRemaining).toBe(2);
    expect(familiar.reactionAvailable).toBe(true);

    const refreshed = startFamiliarTurn({
      familiar: result.familiar, familiarActorId: familiar.actorId,
    });
    expect(() => substitutePactChainFamiliarAttack({
      familiar: refreshed, ownerActorId: 'wizard', policy: chainPolicy,
      sequence: result.sequence, familiarAttackActionId: 'imp.sting',
    })).toThrow(/already used in this Attack action/);
  });

  it('permits a normal-form Chain familiar attack but rejects every unauthorized substitution', () => {
    const familiar = cast({ policy: chainPolicy, method: 'ritual', formId: 'cat' }).familiar;
    const sequence = beginAttackSequence({ id: 'attack', actorId: 'wizard', totalAttacks: 1 });
    expect(substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'wizard', policy: chainPolicy,
      sequence, familiarAttackActionId: 'cat.scratch',
    }).sequence.attacksRemaining).toBe(0);

    const base = presentFamiliar();
    expect(() => substitutePactChainFamiliarAttack({
      familiar: base, ownerActorId: 'wizard', policy: chainPolicy,
      sequence, familiarAttackActionId: 'owl.talons',
    })).toThrow(/not owned by this extension policy/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'other', policy: chainPolicy,
      sequence, familiarAttackActionId: 'cat.scratch',
    })).toThrow(/not owned by this actor/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'wizard',
      policy: { ...chainPolicy, sourceEntityId: 'other-source' },
      sequence, familiarAttackActionId: 'cat.scratch',
    })).toThrow(/not owned by this extension policy/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'wizard', policy: chainPolicy,
      sequence: beginAttackSequence({ id: 'other', actorId: 'fighter', totalAttacks: 1 }),
      familiarAttackActionId: 'cat.scratch',
    })).toThrow(/only its owner/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar: { ...familiar, reactionAvailable: false },
      ownerActorId: 'wizard', policy: chainPolicy, sequence,
      familiarAttackActionId: 'cat.scratch',
    })).toThrow(/Reaction is unavailable/);
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(() => substitutePactChainFamiliarAttack({
      familiar: pocket, ownerActorId: 'wizard', policy: chainPolicy,
      sequence, familiarAttackActionId: 'cat.scratch',
    })).toThrow(/must be present/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'wizard', policy: chainPolicy,
      sequence, familiarAttackActionId: ' ',
    })).toThrow(/stable non-empty/);
    expect(() => substitutePactChainFamiliarAttack({
      familiar, ownerActorId: 'wizard', policy: chainPolicy,
      sequence: { ...sequence, attacksRemaining: 0 }, familiarAttackActionId: 'cat.scratch',
    })).toThrow(/Invalid attack sequence state/);
  });
});

describe('Find Familiar disappearance, dismissal, equipment, and replay-safe state', () => {
  it('drops every carried/worn item and disappears at 0 HP without mutating input', () => {
    const equipped = setFamiliarEquipment({
      familiar: activateFamiliarSharedSenses({
        familiar: presentFamiliar(), ownerActorId: 'wizard', distanceFt: 0, ownerTurn: 1,
      }),
      carriedItemIds: ['key', 'potion'],
      wornItemIds: ['collar', 'saddle'],
    });
    expect(equipped.carriedItemIds).toEqual(['key', 'potion']);
    expect(equipped.wornItemIds).toEqual(['collar', 'saddle']);
    const result = familiarDropsToZeroHp(equipped);
    expect(result).toMatchObject({
      reason: 'zero_hp',
      droppedItemIds: ['collar', 'key', 'potion', 'saddle'],
      familiar: {
        presence: 'disappeared_zero_hp',
        sharedSenses: null,
        carriedItemIds: [],
        wornItemIds: [],
      },
    });
    expect(equipped.presence).toBe('present');
    expect(equipped.carriedItemIds).toEqual(['key', 'potion']);
  });

  it('temporarily dismisses by Magic action and reappears at 0 or exactly 30 feet', () => {
    for (const distanceFt of [0, 30]) {
      const equipped = setFamiliarEquipment({
        familiar: presentFamiliar(), carriedItemIds: ['message'], wornItemIds: ['collar'],
      });
      const dismissed = dismissFamiliar({
        familiar: equipped, ownerActorId: 'wizard', mode: 'temporary',
      });
      expect(dismissed).toMatchObject({
        reason: 'temporary_dismissal',
        droppedItemIds: ['collar', 'message'],
        familiar: { presence: 'pocket_dimension', carriedItemIds: [], wornItemIds: [] },
      });
      const returned = reappearFamiliar({
        familiar: dismissed.familiar!, ownerActorId: 'wizard', distanceFt, unoccupiedSpace: true,
      });
      expect(returned.presence).toBe('present');
      expect(dismissed.familiar!.presence).toBe('pocket_dimension');
    }
  });

  it('dismisses forever without leaving a hidden familiar or taking its items', () => {
    const equipped = setFamiliarEquipment({
      familiar: presentFamiliar(), carriedItemIds: ['ring'], wornItemIds: ['ribbon'],
    });
    expect(dismissFamiliar({
      familiar: equipped, ownerActorId: 'wizard', mode: 'forever',
    })).toEqual({
      familiar: null,
      droppedItemIds: ['ribbon', 'ring'],
      reason: 'forever_dismissal',
    });
  });

  it('fails closed on illegal equipment, disappearance, dismissal, and reappearance facts', () => {
    const familiar = presentFamiliar();
    for (const input of [
      { carriedItemIds: ['same', 'same'], wornItemIds: [] },
      { carriedItemIds: [], wornItemIds: ['same', 'same'] },
      { carriedItemIds: ['same'], wornItemIds: ['same'] },
      { carriedItemIds: [' '], wornItemIds: [] },
      { carriedItemIds: [], wornItemIds: [''] },
    ]) {
      expect(() => setFamiliarEquipment({ familiar, ...input })).toThrow(/stable|distinct/);
    }
    const pocket = dismissFamiliar({ familiar, ownerActorId: 'wizard', mode: 'temporary' }).familiar!;
    expect(() => familiarDropsToZeroHp(pocket)).toThrow(/must be present/);
    expect(() => dismissFamiliar({
      familiar: pocket, ownerActorId: 'wizard', mode: 'forever',
    })).toThrow(/must be present/);
    expect(() => dismissFamiliar({
      familiar, ownerActorId: 'other', mode: 'temporary',
    })).toThrow(/not owned/);
    expect(() => dismissFamiliar({
      familiar, ownerActorId: 'wizard', mode: 'banished' as 'temporary',
    })).toThrow(/mode must be temporary or forever/);
    expect(() => reappearFamiliar({
      familiar, ownerActorId: 'wizard', distanceFt: 0, unoccupiedSpace: true,
    })).toThrow(/temporarily dismissed/);
    expect(() => reappearFamiliar({
      familiar: { ...familiar, presence: 'disappeared_zero_hp' },
      ownerActorId: 'wizard', distanceFt: 0, unoccupiedSpace: true,
    })).toThrow(/temporarily dismissed/);
    expect(() => reappearFamiliar({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 30.001, unoccupiedSpace: true,
    })).toThrow(/within 30 feet/);
    expect(() => reappearFamiliar({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: 0, unoccupiedSpace: false,
    })).toThrow(/unoccupied space/);
    expect(() => reappearFamiliar({
      familiar: pocket, ownerActorId: 'wizard', distanceFt: -1, unoccupiedSpace: true,
    })).toThrow(/finite and non-negative/);
    expect(() => reappearFamiliar({
      familiar: pocket, ownerActorId: 'other', distanceFt: 0, unoccupiedSpace: true,
    })).toThrow(/not owned/);
  });

  it('round-trips complete state through JSON and remains deterministic after replay', () => {
    const original = setFamiliarEquipment({
      familiar: setFamiliarInitiative({
        familiar: cast({
          policy: chainPolicy, method: 'pact_chain_magic_action', formId: 'sprite',
          spiritType: 'celestial',
        }).familiar,
        familiarActorId: 'wizard:familiar', d20Roll: 12, modifier: 4,
      }),
      carriedItemIds: ['tiny-letter'], wornItemIds: ['tiny-belt'],
    });
    const restored = jsonRoundTrip(original);
    expect(familiarStateIssue(restored)).toBeNull();
    expect(restored).toEqual(original);
    const first = dismissFamiliar({ familiar: original, ownerActorId: 'wizard', mode: 'temporary' });
    const replayed = dismissFamiliar({ familiar: restored, ownerActorId: 'wizard', mode: 'temporary' });
    expect(jsonRoundTrip(first)).toEqual(replayed);
  });
});

describe('persisted FamiliarState integrity guard', () => {
  it('rejects every corrupted identity, policy, form, spirit, presence, and role invariant', () => {
    const valid = presentFamiliar();
    const validChain = cast({
      policy: chainPolicy, method: 'pact_chain_magic_action', formId: 'imp',
    }).familiar;
    const injected = cast({
      formId: 'fish',
      validation: injectedValidation,
    }).familiar;
    expect(familiarStateIssue(valid)).toBeNull();
    expect(familiarStateIssue(validChain)).toBeNull();
    expect(familiarStateIssue(injected)).toMatch(/trusted validation catalog/);
    expect(familiarStateIssue(injected, injectedValidation)).toBeNull();

    const cases: Array<[unknown, RegExp]> = [
      [null, /schema version/],
      [{}, /schema version/],
      [{ ...valid, schemaVersion: 2 }, /schema version/],
      [{ ...valid, actorId: '' }, /distinct stable/],
      [{ ...valid, ownerActorId: '' }, /distinct stable/],
      [{ ...valid, sourceEntityId: '' }, /distinct stable/],
      [{ ...valid, actorId: 'wizard' }, /distinct stable/],
      [{ ...valid, extension: 'tome' }, /unknown extension/],
      [{ ...valid, form: null }, /stable identity/],
      [{ ...valid, form: { ...valid.form, id: '' } }, /stable identity/],
      [{ ...valid, form: { ...valid.form, name: '' } }, /stable identity/],
      [{ ...valid, form: { ...valid.form, statBlockId: '' } }, /stable identity/],
      [{ ...valid, form: { ...valid.form, id: 'wolf' } }, /not a PHB CR 0 Beast/],
      [{ ...valid, form: { ...valid.form, statBlockId: 'MM-ancient-red-dragon' } }, /not a PHB CR 0 Beast/],
      [{ ...valid, form: { ...valid.form, baseCreatureType: 'fiend' } }, /not a PHB CR 0 Beast/],
      [{ ...valid, form: { ...valid.form, injectedFormProof: {} } }, /not a PHB CR 0 Beast/],
      [{ ...injected, form: { ...injected.form, challengeRating: 1 } }, /not a CR 0 Beast/],
      [{ ...injected, form: { ...injected.form, id: 'owl' } }, /not a CR 0 Beast/],
      [{ ...validChain, extension: 'base' }, /requires Pact/],
      [{ ...validChain, form: { ...validChain.form, id: 'pit_fiend' } }, /requires Pact/],
      [{ ...validChain, form: { ...validChain.form, statBlockId: 'MM-pit-fiend' } }, /requires Pact/],
      [{ ...validChain, form: { ...validChain.form, injectedFormProof: {} } }, /requires Pact/],
      [{ ...valid, form: { ...valid.form, eligibility: 'homebrew' } }, /unknown eligibility/],
      [{ ...valid, spiritType: 'elemental' }, /Celestial, Fey, or Fiend/],
      [{ ...valid, presence: 'ethereal' }, /presence/],
      [{ ...valid, reactionAvailable: 1 }, /Reaction availability/],
      [{ ...valid, carriedItemIds: 'key' }, /equipment IDs/],
      [{ ...valid, carriedItemIds: ['key', 'key'] }, /equipment IDs/],
      [{ ...valid, wornItemIds: [''] }, /equipment IDs/],
      [{ ...valid, wornItemIds: [' ribbon '] }, /equipment IDs/],
      [{ ...valid, carriedItemIds: ['key'], wornItemIds: ['key'] }, /equipment IDs/],
      [{
        ...valid, presence: 'pocket_dimension',
        sharedSenses: { activatedOnOwnerTurn: 1, expiresAtOwnerTurnStart: 2, includesFormSpecialSenses: true },
      }, /non-present familiar/],
      [{ ...valid, presence: 'disappeared_zero_hp', carriedItemIds: ['key'] }, /non-present familiar/],
      [{ ...valid, presence: 'pocket_dimension', wornItemIds: ['collar'] }, /non-present familiar/],
      [{ ...valid, allyToOwnerAndAllies: false }, /combat-role/],
      [{ ...valid, actsIndependently: false }, /combat-role/],
      [{ ...valid, obeysOwnerCommands: false }, /combat-role/],
      [{ ...valid, canAttackNormally: true }, /combat-role/],
    ];
    for (const [candidate, message] of cases) {
      expect(familiarStateIssue(candidate)).toMatch(message);
    }
  });

  it('rejects malformed own-Initiative and source-turn shared-senses snapshots', () => {
    const valid = presentFamiliar();
    const initiativeCases = [
      null,
      { mode: 'shared', d20Roll: null, modifier: null, total: null },
      { mode: 'own', d20Roll: 1, modifier: null, total: null },
      { mode: 'own', d20Roll: 0, modifier: 0, total: 0 },
      { mode: 'own', d20Roll: 21, modifier: 0, total: 21 },
      { mode: 'own', d20Roll: 10, modifier: 0.5, total: 10.5 },
      { mode: 'own', d20Roll: 10, modifier: 2, total: 99 },
    ];
    for (const initiative of initiativeCases) {
      expect(familiarStateIssue({ ...valid, initiative })).toMatch(/independent Initiative/);
    }
    const sensesCases = [
      undefined,
      {},
      { activatedOnOwnerTurn: -1, expiresAtOwnerTurnStart: 0, includesFormSpecialSenses: true },
      { activatedOnOwnerTurn: 1.5, expiresAtOwnerTurnStart: 2.5, includesFormSpecialSenses: true },
      { activatedOnOwnerTurn: 1, expiresAtOwnerTurnStart: 3, includesFormSpecialSenses: true },
      { activatedOnOwnerTurn: 1, expiresAtOwnerTurnStart: 2, includesFormSpecialSenses: false },
    ];
    for (const sharedSenses of sensesCases) {
      expect(familiarStateIssue({ ...valid, sharedSenses })).toMatch(/shared-senses expiry/);
    }
    expect(() => setFamiliarEquipment({
      familiar: { ...valid, reactionAvailable: 'yes' as unknown as boolean },
      carriedItemIds: [], wornItemIds: [],
    })).toThrow(/Reaction availability/);
  });
});
