import { describe, expect, it } from 'vitest';
import {
  advancePactBladeDistance,
  conjurePactTome,
  createPactBladeBond,
  createPactBladeInvocationState,
  createPactChainInvocationState,
  createPactTomeInvocationState,
  pactBladeLifecyclePolicyIssue,
  pactBladeAttackProjection,
  substitutePactChainAttack,
  summonPactChainFamiliar,
} from './warlockPacts';
import { PACT_BLADE_PHB_2024_LIFECYCLE_POLICY } from './testing/pactBladePolicyFixtures';

describe('level-1 Warlock pact invocation state', () => {
  it('fails closed on malformed declarative Pact Blade lifecycle policies', () => {
    for (const malformed of [null, [], 7]) {
      expect(pactBladeLifecyclePolicyIssue(malformed)).toMatch(/must be an object/);
    }
    expect(pactBladeLifecyclePolicyIssue({
      ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      unknownField: true,
    })).toMatch(/missing or unknown fields/);
    for (const malformed of [
      { ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, separationDistanceFt: -1 },
      { ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, continuousSeparationSecondsToEnd: 0 },
      { ...PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, endOnOwnerDeath: 'yes' },
    ]) {
      expect(pactBladeLifecyclePolicyIssue(malformed))
        .toMatch(/finite distance, positive duration, and death behavior/);
    }
    expect(pactBladeLifecyclePolicyIssue(PACT_BLADE_PHB_2024_LIFECYCLE_POLICY)).toBeNull();
    expect(() => createPactBladeInvocationState({
      sourceEntityId: 'EFF-pact-blade', ownerActorId: 'warlock', bondActionId: 'bind-blade',
      lifecyclePolicy: null as unknown as typeof PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
    })).toThrow(/must be an object/);
  });

  it('creates and replaces a Pact Blade bond with proficiency, focus, Charisma, and per-attack damage choice', () => {
    const first = createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade',
      warlockActorId: 'warlock',
      worldRevision: 4,
      candidate: {
        objectId: 'pact-longsword', weaponCardId: 'card:longsword',
        name: 'Longsword', weaponType: 'longsword',
        category: 'martial', melee: true, magical: false, normalDamageType: 'slashing',
      },
      conjure: true,
      touched: false,
    });
    expect(first.conjuredObject?.tags).toContain('spellcasting_focus');
    expect(pactBladeAttackProjection({
      bond: first.bond,
      weaponObjectId: 'pact-longsword',
      useCharisma: true,
      ordinaryAbility: 'str',
      damageType: 'psychic',
    })).toEqual({
      attackAbility: 'cha', damageAbility: 'cha', damageType: 'psychic',
      proficient: true, spellcastingFocus: true,
    });
    expect(pactBladeAttackProjection({
      bond: first.bond,
      weaponObjectId: 'pact-longsword',
      useCharisma: false,
      ordinaryAbility: 'str',
      damageType: 'normal',
    }).damageType).toBe('slashing');

    const replacement = createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade',
      warlockActorId: 'warlock',
      worldRevision: 9,
      candidate: {
        objectId: 'magic-dagger', weaponCardId: 'card:magic-dagger',
        name: 'Magic Dagger', weaponType: 'dagger',
        category: 'simple', melee: true, magical: true, normalDamageType: 'piercing',
      },
      previousBond: first.bond,
      conjure: false,
      touched: true,
    });
    expect(replacement.endedPreviousBond?.weaponObjectId).toBe('pact-longsword');
    expect(replacement.bond.weaponObjectId).toBe('magic-dagger');
    expect(replacement.conjuredObject).toBeUndefined();
  });

  it('rejects illegal Pact Blade candidates and ends a bond after a continuous minute beyond 5 feet', () => {
    for (const candidate of [
      {
        objectId: ' ', weaponCardId: 'card:dagger', name: 'Dagger', weaponType: 'dagger',
        category: 'simple' as const, melee: true, magical: false, normalDamageType: 'piercing',
      },
      {
        objectId: 'object:dagger', weaponCardId: ' ', name: 'Dagger', weaponType: 'dagger',
        category: 'simple' as const, melee: true, magical: false, normalDamageType: 'piercing',
      },
    ]) {
      expect(() => createPactBladeBond({
        sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
        candidate, conjure: true, touched: false,
      })).toThrow(/immutable weapon Card identity/);
    }
    expect(() => createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'longbow', weaponCardId: 'card:longbow',
        name: 'Longbow', weaponType: 'longbow', category: 'martial',
        melee: false, magical: false, normalDamageType: 'piercing',
      },
      conjure: true, touched: false,
    })).toThrow(/Melee/);
    expect(createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'magic-longbow', weaponCardId: 'card:magic-longbow',
        name: 'Magic Longbow', weaponType: 'longbow', category: 'martial',
        melee: false, magical: true, normalDamageType: 'piercing',
      },
      conjure: false, touched: true,
    }).bond).toMatchObject({
      weaponObjectId: 'magic-longbow', weaponCardId: 'card:magic-longbow', conjured: false,
    });
    expect(() => createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'improvised', weaponCardId: 'card:improvised',
        name: 'Improvised', weaponType: 'improvised', category: 'simple',
        melee: true, magical: false, normalDamageType: 'bludgeoning',
      },
      conjure: false, touched: true,
    })).toThrow(/touched magic weapon/);
    expect(() => createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'attuned', weaponCardId: 'card:attuned',
        name: 'Attuned', weaponType: 'dagger', category: 'simple',
        melee: true, magical: true, normalDamageType: 'piercing', attunedToActorId: 'wizard',
      },
      conjure: false, touched: true,
    })).toThrow(/attuned to another/);
    expect(() => createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'bonded', weaponCardId: 'card:bonded',
        name: 'Bonded', weaponType: 'dagger', category: 'simple',
        melee: true, magical: true, normalDamageType: 'piercing', bondedWarlockId: 'other-warlock',
      },
      conjure: false, touched: true,
    })).toThrow(/bonded to another/);
    const bond = createPactBladeBond({
      sourceEntityId: 'EFF-pact-blade', warlockActorId: 'warlock', worldRevision: 1,
      candidate: {
        objectId: 'blade', weaponCardId: 'card:blade',
        name: 'Blade', weaponType: 'dagger', category: 'simple',
        melee: true, magical: false, normalDamageType: 'piercing',
      },
      conjure: true, touched: false,
    }).bond;
    const after30 = advancePactBladeDistance(
      bond, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 10, 30, 4,
    )!;
    expect(after30.continuousSeparationSeconds).toBe(30);
    expect(after30.lastDistanceBoardRevision).toBe(4);
    expect(advancePactBladeDistance(
      after30, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 5, 10, 5,
    )).toMatchObject({
      continuousSeparationSeconds: 0, lastDistanceBoardRevision: 5,
    });
    expect(advancePactBladeDistance(after30, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 10, 29)).not.toBeNull();
    expect(advancePactBladeDistance(after30, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 10, 30)).toBeNull();
    expect(() => advancePactBladeDistance(bond, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, -1, 0)).toThrow(/non-negative/);
    expect(() => advancePactBladeDistance(bond, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 1, -1)).toThrow(/non-negative/);
    expect(() => advancePactBladeDistance(after30, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 1, 1, 3)).toThrow(/stale/);
    expect(() => advancePactBladeDistance(bond, PACT_BLADE_PHB_2024_LIFECYCLE_POLICY, 1, 1, -1)).toThrow(/non-negative/);
    const mutatedPolicy = {
      separationDistanceFt: 20,
      continuousSeparationSecondsToEnd: 90,
      endOnOwnerDeath: false,
    };
    expect(advancePactBladeDistance(bond, mutatedPolicy, 10, 89)).toMatchObject({
      continuousSeparationSeconds: 0,
    });
    const mutated89 = advancePactBladeDistance(bond, mutatedPolicy, 21, 89)!;
    expect(mutated89.continuousSeparationSeconds).toBe(89);
    expect(advancePactBladeDistance(mutated89, mutatedPolicy, 21, 1)).toBeNull();
    expect(() => pactBladeAttackProjection({
      bond, weaponObjectId: 'wrong', useCharisma: true, ordinaryAbility: 'str', damageType: 'normal',
    })).toThrow(/not the active pact weapon/);
  });

  it('creates a Pact Tome after either rest with exactly three cantrips and two new level-1 rituals', () => {
    const options = [
      { actionId: 'light', level: 0, ritual: false },
      { actionId: 'guidance', level: 0, ritual: false },
      { actionId: 'minor-illusion', level: 0, ritual: false },
      { actionId: 'detect-magic', level: 1, ritual: true },
      { actionId: 'identify', level: 1, ritual: true },
      { actionId: 'mage-armor', level: 1, ritual: false },
    ];
    const result = conjurePactTome({
      sourceEntityId: 'EFF-pact-tome',
      ownerActorId: 'warlock',
      bookObjectId: 'book-2',
      rest: 'short',
      cantripActionIds: ['minor-illusion', 'light', 'guidance'],
      ritualActionIds: ['identify', 'detect-magic'],
      options,
      alreadyPreparedActionIds: ['mage-armor'],
      slotResource: 'spell_slot_1',
      previousTome: {
        sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'book-1',
        cantripActionIds: [], ritualActionIds: [], spellGrantIds: [], createdAfterRest: 'long',
      },
    });
    expect(result.replacedBookObjectId).toBe('book-1');
    expect(result.tome.cantripActionIds).toEqual(['guidance', 'light', 'minor-illusion']);
    expect(result.tome.ritualActionIds).toEqual(['detect-magic', 'identify']);
    expect(result.grants).toHaveLength(5);
    expect(result.grants.every((grant) => grant.spellcastingAbility === 'cha')).toBe(true);
    expect(result.grants.filter((grant) => grant.level === 1).every((grant) => (
      grant.access === 'always_prepared' && grant.ritual === true && grant.slotResource === 'spell_slot_1'
    ))).toBe(true);
    expect(result.bookObject.tags).toContain('spellcasting_focus');

    const firstTome = conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'book-first', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options, alreadyPreparedActionIds: [],
      slotResource: 'spell_slot_1',
    });
    expect(firstTome.replacedBookObjectId).toBeUndefined();

    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'mage-armor'], options, alreadyPreparedActionIds: [],
      slotResource: 'spell_slot_1',
    })).toThrow(/not an eligible level-1 ritual/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-2', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options, alreadyPreparedActionIds: ['identify'],
      slotResource: 'spell_slot_1',
    })).toThrow(/already prepared/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-3', rest: 'long',
      cantripActionIds: ['light', 'light', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options, alreadyPreparedActionIds: [],
      slotResource: 'spell_slot_1',
    })).toThrow(/3 distinct/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-4', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'mage-armor'],
      ritualActionIds: ['detect-magic', 'identify'], options, alreadyPreparedActionIds: [],
      slotResource: 'spell_slot_1',
    })).toThrow(/not an eligible cantrip/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-5', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options, alreadyPreparedActionIds: [],
      slotResource: ' ',
    })).toThrow(/slot resource is required/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-6', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options,
      alreadyPreparedActionIds: ['light'], slotResource: 'spell_slot_1',
    })).toThrow(/light is already prepared/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-7', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options: [...options, options[0]],
      alreadyPreparedActionIds: [], slotResource: 'spell_slot_1',
    })).toThrow(/distinct action IDs/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-8',
      rest: 'invalid' as 'long', cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options,
      alreadyPreparedActionIds: [], slotResource: 'spell_slot_1',
    })).toThrow(/completed rest/);
    expect(() => conjurePactTome({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'bad-9', rest: 'long',
      cantripActionIds: ['light', 'guidance', 'minor-illusion'],
      ritualActionIds: ['detect-magic', 'identify'], options,
      alreadyPreparedActionIds: [], slotResource: 'spell_slot_1',
      previousTome: {
        sourceEntityId: 'EFF-pact-tome', ownerActorId: 'other', bookObjectId: 'foreign-book',
        cantripActionIds: [], ritualActionIds: [], spellGrantIds: [], createdAfterRest: 'long',
      },
    })).toThrow(/same actor’s source-owned book/);
  });

  it('creates source-owned invocation projections without inventing active Blade or Chain entities', () => {
    expect(createPactBladeInvocationState({
      sourceEntityId: 'EFF-pact-blade', ownerActorId: 'warlock', bondActionId: 'bind-blade',
      lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
    })).toEqual({
      kind: 'blade', sourceEntityId: 'EFF-pact-blade', ownerActorId: 'warlock',
      bondActionId: 'bind-blade', lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
      activeBond: null,
    });
    expect(createPactChainInvocationState({
      sourceEntityId: 'EFF-pact-chain', ownerActorId: 'warlock',
      findFamiliarActionId: 'find-familiar',
    })).toEqual({
      kind: 'chain', sourceEntityId: 'EFF-pact-chain', ownerActorId: 'warlock',
      template: {
        findFamiliarActionId: 'find-familiar', normalFormSource: 'find_familiar_spell',
        specialFormIds: [
          'imp', 'pseudodragon', 'quasit', 'skeleton', 'slaad_tadpole',
          'sphinx_of_wonder', 'sprite', 'venomous_snake',
        ],
      },
      activeFamiliar: null,
    });
    const tome = {
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', bookObjectId: 'book',
      cantripActionIds: ['a', 'b', 'c'], ritualActionIds: ['d', 'e'],
      spellGrantIds: ['ga', 'gb', 'gc', 'gd', 'ge'], createdAfterRest: 'long' as const,
    };
    const projected = createPactTomeInvocationState({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', tome,
    });
    expect(projected).toEqual({
      kind: 'tome', sourceEntityId: 'EFF-pact-tome', ownerActorId: 'warlock', tome,
    });
    expect(projected.tome).not.toBe(tome);
    expect(projected.tome.cantripActionIds).not.toBe(tome.cantripActionIds);

    expect(() => createPactBladeInvocationState({
      sourceEntityId: ' ', ownerActorId: 'warlock', bondActionId: 'bind-blade',
      lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
    })).toThrow(/sourceEntityId is required/);
    expect(() => createPactTomeInvocationState({
      sourceEntityId: 'other-source', ownerActorId: 'warlock', tome,
    })).toThrow(/same source and actor/);
    expect(() => createPactTomeInvocationState({
      sourceEntityId: 'EFF-pact-tome', ownerActorId: 'other-warlock', tome,
    })).toThrow(/same source and actor/);
  });

  it('materializes a legal Pact Chain familiar and spends one owner attack plus the familiar Reaction', () => {
    const summoned = summonPactChainFamiliar({
      actorId: 'familiar-2',
      ownerActorId: 'warlock',
      formId: 'imp',
      sourceEntityId: 'EFF-pact-chain',
      normalFormIds: ['cat', 'owl'],
      previousFamiliar: {
        actorId: 'familiar-1', ownerActorId: 'warlock', formId: 'owl',
        sourceEntityId: 'EFF-pact-chain', reactionAvailable: true,
      },
    });
    expect(summoned.replacedActorId).toBe('familiar-1');
    expect(summoned.familiar.formId).toBe('imp');
    const substituted = substitutePactChainAttack({
      familiar: summoned.familiar,
      ownerActorId: 'warlock',
      attacksRemaining: 1,
    });
    expect(substituted.attacksRemaining).toBe(0);
    expect(substituted.familiar.reactionAvailable).toBe(false);
    expect(() => substitutePactChainAttack({
      familiar: substituted.familiar,
      ownerActorId: 'warlock',
      attacksRemaining: 1,
    })).toThrow(/Reaction/);
    expect(() => summonPactChainFamiliar({
      actorId: 'bad', ownerActorId: 'warlock', formId: 'dragon',
      sourceEntityId: 'EFF-pact-chain', normalFormIds: ['cat', 'owl'],
    })).toThrow(/Illegal/);
    const normal = summonPactChainFamiliar({
      actorId: 'cat-familiar', ownerActorId: 'warlock', formId: 'cat',
      sourceEntityId: 'EFF-pact-chain', normalFormIds: ['cat', 'owl'],
    });
    expect(normal.replacedActorId).toBeUndefined();
    expect(() => substitutePactChainAttack({
      familiar: normal.familiar, ownerActorId: 'other-warlock', attacksRemaining: 1,
    })).toThrow(/not owned/);
    expect(() => substitutePactChainAttack({
      familiar: normal.familiar, ownerActorId: 'warlock', attacksRemaining: 0,
    })).toThrow(/remaining Attack-action attack/);
    expect(() => substitutePactChainAttack({
      familiar: normal.familiar, ownerActorId: 'warlock', attacksRemaining: 1.5,
    })).toThrow(/remaining Attack-action attack/);
  });
});
