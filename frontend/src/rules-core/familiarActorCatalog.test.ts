import { describe, expect, it } from 'vitest';
import {
  canonicalFamiliarCatalogJson,
  FAMILIAR_ACTOR_CATALOG,
  familiarActorCatalogIssue,
  familiarActorTemplateIssue,
  familiarCatalogContentHash,
  getFamiliarActorTemplate,
  materializeFamiliarActor,
  type FamiliarStatTemplate,
} from './familiarActorCatalog';
import {
  castFindFamiliar,
  FIND_FAMILIAR_BASE_FORMS,
  PACT_CHAIN_SPECIAL_FAMILIAR_FORMS,
} from './findFamiliar';

const expected = {
  bat: ['tiny', 'beast', 12, 1, -4, 2, -1, -4, 1, -3, 2, 'walk:5,fly:30', 'blindsight:60', 'bite'],
  cat: ['tiny', 'beast', 12, 2, -4, 2, 0, -4, 1, -2, 2, 'walk:40,climb:40', 'darkvision:60', 'scratch'],
  frog: ['tiny', 'beast', 11, 1, -5, 1, -1, -5, -1, -4, 1, 'walk:20,swim:20', 'darkvision:30', 'bite'],
  hawk: ['tiny', 'beast', 13, 1, -3, 3, -1, -4, 2, -2, 3, 'walk:10,fly:60', 'normal', 'talons'],
  lizard: ['tiny', 'beast', 10, 2, -4, 0, 0, -5, -1, -4, 0, 'walk:20,climb:20', 'darkvision:30', 'bite'],
  octopus: ['small', 'beast', 12, 3, -3, 2, 0, -4, 0, -3, 2, 'walk:5,swim:30', 'darkvision:30', 'tentacles,ink-cloud'],
  owl: ['tiny', 'beast', 11, 1, -4, 1, -1, -4, 1, -2, 1, 'walk:5,fly:60', 'darkvision:120', 'talons'],
  rat: ['tiny', 'beast', 10, 1, -4, 0, -1, -4, 0, -3, 0, 'walk:20,climb:20', 'darkvision:30', 'bite'],
  raven: ['tiny', 'beast', 12, 2, -4, 2, 0, -3, 1, -2, 2, 'walk:10,fly:50', 'normal', 'beak'],
  spider: ['tiny', 'beast', 12, 1, -4, 2, -1, -5, 0, -4, 2, 'walk:20,climb:20', 'darkvision:30', 'bite'],
  weasel: ['tiny', 'beast', 13, 1, -4, 3, -1, -4, 1, -4, 3, 'walk:30,climb:30', 'darkvision:60', 'bite'],
  imp: ['tiny', 'fiend:devil', 13, 21, -2, 3, 1, 0, 1, 2, 3, 'walk:20,fly:40', 'darkvision:120:magic', 'sting,invisibility,shape-shift'],
  pseudodragon: ['tiny', 'dragon', 14, 10, -2, 2, 1, 0, 1, 0, 2, 'walk:15,fly:60', 'blindsight:10,darkvision:60', 'multiattack,bite,sting'],
  quasit: ['tiny', 'fiend:demon', 13, 25, -3, 3, 0, -2, 0, 0, 3, 'walk:40', 'darkvision:120', 'rend,invisibility,scare,shape-shift'],
  skeleton: ['medium', 'undead', 14, 13, 0, 3, 2, -2, -1, -3, 3, 'walk:30', 'darkvision:60', 'shortsword,shortbow'],
  slaad_tadpole: ['tiny', 'aberration', 12, 7, -2, 2, 0, -4, -3, -4, 2, 'walk:30,burrow:10', 'darkvision:60', 'bite'],
  sphinx_of_wonder: ['tiny', 'celestial', 13, 24, -2, 3, 1, 2, 1, 0, 3, 'walk:20,fly:40', 'darkvision:60', 'rend,burst-of-ingenuity'],
  sprite: ['tiny', 'fey', 15, 10, -4, 4, 0, 2, 1, 0, 4, 'walk:10,fly:40', 'normal', 'needle-sword,enchanting-bow,heart-sight,invisibility'],
  venomous_snake: ['tiny', 'beast', 12, 5, -4, 2, 0, -5, 0, -4, 2, 'walk:30,swim:30', 'blindsight:10', 'bite'],
} as const;

function summary(template: FamiliarStatTemplate) {
  const mods = template.abilityMods;
  const speeds = Object.entries(template.speeds).map(([mode, value]) => `${mode}:${value}`).join(',');
  const senses = [
    template.senses.blindsightFt === undefined ? null : `blindsight:${template.senses.blindsightFt}`,
    template.senses.darkvisionFt === undefined ? null : `darkvision:${template.senses.darkvisionFt}${template.senses.magicalDarknessDoesNotImpede ? ':magic' : ''}`,
  ].filter(Boolean).join(',') || 'normal';
  return [
    template.size, template.nativeCreatureType, template.ac, template.hp.max,
    mods.str, mods.dex, mods.con, mods.int, mods.wis, mods.cha,
    template.initiativeModifier, speeds, senses,
    template.actions.map(({ id }) => id.split('.').at(-1)).join(','),
  ];
}

function familiar(formId: string, chain = false) {
  return castFindFamiliar({
    familiarActorId: 'owner:familiar', ownerActorId: 'owner',
    policy: { kind: chain ? 'pact_chain' : 'base', sourceEntityId: chain ? 'EFF-pact-chain' : 'SPELL-find-familiar' },
    method: chain ? 'pact_chain_magic_action' : 'ritual', formId, spiritType: 'fey',
    resources: { level1SpellSlots: 1, incenseGp: 10 }, incenseOfferingGp: 10,
    materialCostGp: 10,
    baseCastingTimeSeconds: 3_600,
    mechanicsPolicy: { connectionRangeFt: 100, reappearRangeFt: 30, ritualCastingAddedSeconds: 600 },
    existingFamiliar: null,
  }).familiar;
}

describe('ruleset-owned familiar actor stat catalog', () => {
  it('pins the post-PHB-errata source and exactly nineteen canonical forms', () => {
    expect(FAMILIAR_ACTOR_CATALOG).toMatchObject({
      schemaVersion: 1,
      catalogId: 'dnd2024.familiar-stat-blocks.mm2025.v1',
      sourceVersion: 'phb2024-errata-v1.mm2025.dndbeyond-live-2026-08-04',
    });
    expect(FAMILIAR_ACTOR_CATALOG.forms.map(({ formId }) => formId)).toEqual([
      ...FIND_FAMILIAR_BASE_FORMS, ...PACT_CHAIN_SPECIAL_FAMILIAR_FORMS,
    ]);
    expect(FAMILIAR_ACTOR_CATALOG.forms).toHaveLength(19);
    expect(FAMILIAR_ACTOR_CATALOG.contentHash).toBe('fnv1a32:0d9fccea');
    const { contentHash, ...catalogPayload } = FAMILIAR_ACTOR_CATALOG;
    expect(familiarCatalogContentHash(catalogPayload)).toBe(contentHash);
  });

  it.each(Object.entries(expected))('pins every exact stat row and action set for %s', (formId, row) => {
    const template = getFamiliarActorTemplate(formId);
    expect(summary(template)).toEqual(row);
    expect(template.proficiencyBonus).toBe(2);
    expect(template.saves).toEqual(Object.fromEntries(
      (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((ability) => [ability,
        formId === 'cat' && ability === 'dex' ? 4 : template.abilityMods[ability]]),
    ));
    expect(template.statBlockId).toBe(`mm2025.creature.${formId}`);
    expect(template.sourceEntityId).toBe(`official.dnd2024.mm2025.${formId}`);
    expect(template.sourceLocator).toMatch(/^https:\/\/www\.dndbeyond\.com\//);
  });

  it('pins compound damage, defenses, traits, and non-attack mechanics', () => {
    expect(getFamiliarActorTemplate('spider').actions[0].attack?.damage).toEqual([
      { average: 1, type: 'piercing' }, { average: 2, formula: '1d4', type: 'poison' },
    ]);
    expect(getFamiliarActorTemplate('imp')).toMatchObject({
      resistances: ['cold'], damageImmunities: ['fire', 'poison'], conditionImmunities: ['poisoned'],
      senses: { darkvisionFt: 120, magicalDarknessDoesNotImpede: true },
    });
    expect(getFamiliarActorTemplate('quasit')).toMatchObject({
      resistances: ['cold', 'fire', 'lightning'], damageImmunities: ['poison'],
    });
    expect(getFamiliarActorTemplate('skeleton')).toMatchObject({
      ac: 14, vulnerabilities: ['bludgeoning'], damageImmunities: ['poison'],
      conditionImmunities: ['exhaustion', 'poisoned'], gear: ['shortbow', 'shortsword'],
    });
    expect(getFamiliarActorTemplate('slaad_tadpole').resistances)
      .toEqual(['acid', 'cold', 'fire', 'lightning', 'thunder']);
    expect(getFamiliarActorTemplate('sphinx_of_wonder').actions[1]).toMatchObject({
      economy: 'reaction', uses: { count: 2, recharge: 'day' },
      mechanics: { modifier: 2, rangeFt: 30 },
    });
    expect(getFamiliarActorTemplate('pseudodragon').actions[2].save).toEqual({
      ability: 'con', dc: 12, rangeFt: 5,
      damage: [{ average: 5, formula: '2d4', type: 'poison' }],
      effects: [
        { condition: 'poisoned', durationMinutes: 60 },
        { condition: 'unconscious', whileCondition: 'poisoned', endsOnDamageOrWakeActionWithinFt: 5 },
      ],
    });
    expect(getFamiliarActorTemplate('sprite').actions[2].save).toMatchObject({
      automaticFailureCreatureTypes: ['celestial', 'fiend', 'undead'],
    });
    expect(getFamiliarActorTemplate('octopus').actions[1]).toMatchObject({
      economy: 'reaction', uses: { count: 1, recharge: 'day' },
      mechanics: { cubeSideFt: 5, heavilyObscuredMinutes: 1, moveUpToSwimSpeed: true },
    });
  });

  it('is deeply frozen and validates an exact JSON-restored catalog', () => {
    const visit = (value: unknown): void => {
      if (value === null || typeof value !== 'object') return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value as Record<string, unknown>).forEach(visit);
    };
    visit(FAMILIAR_ACTOR_CATALOG);
    const restored = JSON.parse(JSON.stringify(FAMILIAR_ACTOR_CATALOG));
    expect(familiarActorCatalogIssue(restored)).toBeNull();
    expect(familiarCatalogContentHash({ a: 1, b: 2 })).toBe(familiarCatalogContentHash({ b: 2, a: 1 }));
    expect(canonicalFamiliarCatalogJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('fails closed on forged identities, ordering, hashes, templates, and unknown ids', () => {
    const restored = JSON.parse(JSON.stringify(FAMILIAR_ACTOR_CATALOG));
    const invalid: unknown[] = [
      null, [], {}, { ...restored, schemaVersion: 2 }, { ...restored, catalogId: 'forged' },
      { ...restored, forms: restored.forms.slice(1) }, { ...restored, contentHash: 'fnv1a32:00000000' },
      { ...restored, sourceVersion: 'floating' },
      { ...restored, forms: [restored.forms[1], restored.forms[0], ...restored.forms.slice(2)] },
    ];
    invalid.forEach((candidate) => expect(familiarActorCatalogIssue(candidate)).not.toBeNull());
    expect(familiarActorTemplateIssue(null)).toMatch(/must be an object/);
    expect(familiarActorTemplateIssue({})).toMatch(/stable form id/);
    expect(familiarActorTemplateIssue({ formId: 'wolf' })).toMatch(/not in/);
    expect(familiarActorTemplateIssue({ ...restored.forms[0], ac: 99 })).toMatch(/forged/);
    expect(() => getFamiliarActorTemplate(' owl ')).toThrow(/canonical stable id/);
    expect(() => getFamiliarActorTemplate('wolf')).toThrow(/outside/);
    expect(() => getFamiliarActorTemplate('owl', { ...restored, contentHash: 'bad' })).toThrow(/hash/);
  });
});

describe('familiar ActorState materialization', () => {
  it('creates a complete controlled summoned actor without minting ordinary attack authority', () => {
    const state = familiar('owl');
    const actor = materializeFamiliarActor({
      familiar: state, template: getFamiliarActorTemplate('owl'), ownerControllerId: 'owner:controller',
    });
    expect(actor).toMatchObject({
      id: 'owner:familiar', name: 'Owl', kind: 'summonedActor', controllerId: 'owner:controller', ac: 11,
      capabilities: { actionIds: [] },
      character: { abilityMods: { dex: 1, wis: 1 }, profBonus: 2, level: 0, characterSpeed: 5 },
      runtime: { hp: { current: 1, max: 1, temp: 0 }, resources: { action: 1, bonus_action: 1, reaction: 1 } },
      attackProfile: { attacksPerAction: 1, size: 0, reachFt: 5, graspingParts: [] },
      familiarMetadata: {
        ownerActorId: 'owner', spiritType: 'fey', nativeCreatureType: 'beast', effectiveCreatureType: 'fey',
        statBlockId: 'mm2025.creature.owl', canInitiateAttackAction: false, attackAuthorization: 'forbidden',
      },
    });
    expect(actor.capabilities.featureSources['mm2025.owl.talons'])
      .toEqual(['SPELL-find-familiar', 'official.dnd2024.mm2025.owl']);
    expect(actor.familiarMetadata.actions[0].kind).toBe('attack');
    expect(actor.passives).toEqual([{
      id: 'flyby', mechanics: { avoidsOpportunityAttackOnFlyOut: true },
      sourceEntityId: 'official.dnd2024.mm2025.owl',
    }]);
  });

  it('retains Chain action definitions but restricts attacks to the owner replacement path', () => {
    const state = familiar('imp', true);
    const actor = materializeFamiliarActor({
      familiar: state, template: getFamiliarActorTemplate('imp'), ownerControllerId: 'owner:controller',
    });
    expect(actor.capabilities.actionIds).toEqual([]);
    expect(actor.familiarMetadata.attackAuthorization).toBe('owner_attack_replacement_only');
    expect(actor.familiarMetadata.actions.map(({ kind }) => kind)).toEqual(['attack', 'spell', 'utility']);
    expect(actor.runtime.hp).toEqual({ current: 21, max: 21, temp: 0 });
    expect(actor.familiarMetadata.effectiveCreatureType).toBe('fey');
    expect(actor.familiarMetadata.nativeCreatureType).toBe('fiend:devil');
  });

  it('projects reaction availability, size, skills, saves, defenses, and equipment', () => {
    const state = { ...familiar('skeleton', true), reactionAvailable: false };
    const actor = materializeFamiliarActor({
      familiar: state, template: getFamiliarActorTemplate('skeleton'), ownerControllerId: 'owner:controller',
    });
    expect(actor.runtime.resources.reaction).toBe(0);
    expect(actor.attackProfile.size).toBe(2);
    expect(actor.character.skillProficiencies).toEqual([]);
    expect(actor.familiarMetadata).toMatchObject({
      saves: { dex: 3, con: 2 }, vulnerabilities: ['bludgeoning'], damageImmunities: ['poison'],
      conditionImmunities: ['exhaustion', 'poisoned'], gear: ['shortbow', 'shortsword'],
    });
    const smallActor = materializeFamiliarActor({
      familiar: familiar('octopus'), template: getFamiliarActorTemplate('octopus'),
      ownerControllerId: 'owner:controller',
    });
    expect(smallActor.attackProfile.size).toBe(1);
  });

  it('fails closed on invalid state, forged template, wrong join, wrong extension, absence, and controller id', () => {
    const owl = familiar('owl');
    const template = getFamiliarActorTemplate('owl');
    const materialize = (overrides: Partial<Parameters<typeof materializeFamiliarActor>[0]> = {}) => (
      materializeFamiliarActor({ familiar: owl, template, ownerControllerId: 'owner:controller', ...overrides })
    );
    expect(() => materialize({ familiar: { ...owl, actorId: '' } })).toThrow(/actor/);
    expect(() => materialize({ template: { ...template, ac: 99 } })).toThrow(/forged/);
    expect(() => materialize({ template: getFamiliarActorTemplate('cat') })).toThrow(/does not match/);
    expect(() => materialize({ familiar: { ...owl, form: { ...owl.form, statBlockId: 'forged' } } })).toThrow(/not a PHB CR 0 Beast|does not match/);
    expect(() => materialize({ familiar: { ...owl, presence: 'pocket_dimension' } })).toThrow(/present/);
    expect(() => materialize({ ownerControllerId: '' })).toThrow(/canonical stable id/);
    expect(() => materialize({ ownerControllerId: ' controller ' })).toThrow(/canonical stable id/);
    const imp = familiar('imp', true);
    expect(() => materialize({
      familiar: { ...imp, extension: 'base' }, template: getFamiliarActorTemplate('imp'),
    })).toThrow(/requires Pact/);
  });
});
