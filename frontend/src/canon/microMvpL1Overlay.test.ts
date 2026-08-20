import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalStringify } from '../rules-core/determinism';
import {
  PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
  PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
} from '../rules-core/testing/pactBladePolicyFixtures';
import { actionUsesKey } from '../engine/actionUses';
import { armorClassValue } from '../engine/ac';
import { executeAction } from '../engine/execute';
import { collectRollModifiers } from '../engine/modifiers';
import {
  assertMicroMvpL1OverlayReady,
  compileMicroMvpL1Overlay,
  compileMicroMvpL1OverlayFromCatalogs,
  compileMicroMvpL1ChoiceVariants,
  deriveMicroMvpL1CapabilityGaps,
  MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS,
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  MICRO_MVP_L1_SOURCE_ISSUE_DISPOSITIONS,
  MICRO_MVP_L1_OVERLAY_VERSION,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
  sourceIssueDispositionProblems,
} from './microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from './microMvpL1Overlay';
import {
  assertPinnedProdSnapshotL1Ready,
  readProdSnapshotCatalogs,
} from './prodSnapshotL1Fixtures';

type Dict = Record<string, unknown>;

const DRAGON_LINEAGES = [
  'sub-black', 'sub-blue', 'sub-brass', 'sub-bronze', 'sub-copper',
  'sub-gold', 'sub-green', 'sub-red', 'sub-silver', 'sub-white',
] as const;
const ELF_LINEAGES = ['sub-drow', 'sub-high_elf', 'sub-wood_elf'] as const;

function rootsByClass(provider: CompiledMicroMvpL1Provider, cardNumber: string) {
  return provider.roots.filter((root) => root.matrixCase.klass.card_number === cardNumber);
}

function rootsBySpecies(provider: CompiledMicroMvpL1Provider, cardNumber: string) {
  return provider.roots.filter((root) => root.matrixCase.species.card_number === cardNumber);
}

function effect(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return root.assembled.effects.find((item) => item.effect.card_number === cardNumber)?.effect;
}

function spell(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return root.assembled.spells.find((item) => item.card_number === cardNumber);
}

function invocationCard(root: CompiledMicroMvpL1Root) {
  return root.assembled.effects.find(({ effect }) => (
    root.selectedInvocationEffectIds.includes(effect.id)
  ))?.effect.card_number;
}

function payloads(mechanics: Dict | null | undefined): Dict[] {
  const result: Dict[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Dict;
    if (typeof record.kind === 'string') result.push(record);
    Object.values(record).forEach(visit);
  };
  visit(mechanics);
  return result;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('versioned deterministic micro-MVP L1 content overlay', () => {
  let provider: CompiledMicroMvpL1Provider;
  let warlockInvocationVariants: Map<string, CompiledMicroMvpL1Root>;
  let elfAbilityVariants: Map<string, CompiledMicroMvpL1Root>;

  beforeAll(async () => {
    provider = await compileMicroMvpL1Overlay();
    const stableKey = rootsByClass(provider, 'CLASS-warlock')[0].stableKey;
    const variants = await compileMicroMvpL1ChoiceVariants(
      MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS.map((option) => ({
        stableKey,
        overrides: { warlock_invocation_l1: [option] },
      })),
    );
    warlockInvocationVariants = new Map(variants.map((variant, index) => (
      [MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS[index], variant]
    )));
    const elfStableKey = rootsBySpecies(provider, 'RACE-0004')
      .find((root) => root.speciesAudit.lineageCardNumber === 'sub-high_elf')!.stableKey;
    const abilities = ['int', 'wis', 'cha'] as const;
    const abilityVariants = await compileMicroMvpL1ChoiceVariants(abilities.map((ability) => ({
      stableKey: elfStableKey,
      overrides: { elf_lineage_spellcasting_ability: [ability] },
    })));
    elfAbilityVariants = new Map(abilityVariants.map((variant, index) => (
      [abilities[index], variant]
    )));
  }, 60_000);

  it('compiles all 448 roots without mutating the immutable source snapshot', async () => {
    const before = canonicalStringify(readProdSnapshotCatalogs());
    const rebuilt = await compileMicroMvpL1Overlay();
    const after = canonicalStringify(readProdSnapshotCatalogs());

    expect(provider.roots).toHaveLength(448);
    expect(new Set(provider.roots.map((root) => root.fixtureId)).size).toBe(448);
    expect(before).toBe(after);
    expect(rebuilt.release).toEqual(provider.release);
    expect(rebuilt.roots.map((root) => ({
      fixtureId: root.fixtureId,
      decisions: root.decisions,
      actionIds: root.actor.capabilities.actionIds,
      maxResources: root.actor.runtime.maxResources,
    }))).toEqual(provider.roots.map((root) => ({
      fixtureId: root.fixtureId,
      decisions: root.decisions,
      actionIds: root.actor.capabilities.actionIds,
      maxResources: root.actor.runtime.maxResources,
    })));
  }, 30_000);

  it('uses the same compiler for injected catalog records instead of substituting pinned entities', async () => {
    const catalogs = readProdSnapshotCatalogs();
    const injected = await compileMicroMvpL1OverlayFromCatalogs(copy(catalogs));

    expect(injected.release).toEqual(provider.release);
    expect(injected.roots.map((root) => root.matrixCase.klass))
      .toEqual(provider.roots.map((root) => root.matrixCase.klass));
    expect(injected.roots.map((root) => root.actor.capabilities))
      .toEqual(provider.roots.map((root) => root.actor.capabilities));
  }, 30_000);

  it('exposes immutable Card identity to shared item-instance rules without accepting aliases', () => {
    const card = readProdSnapshotCatalogs().cards.find((candidate) => (
      candidate.type === 'weapon' && typeof candidate.id === 'string' && candidate.id.length > 0
    ));
    expect(card).toBeDefined();
    expect(provider.catalog.getCard?.(card!.id)).toEqual(card);
    expect(provider.catalog.getCard?.(card!.card_number)).toBeUndefined();
  });

  it('pins overlay, compiled content, and release hashes independently from the raw release', () => {
    expect(MICRO_MVP_L1_OVERLAY_VERSION).toBe('1.11.0');
    expect(provider.release).toMatchObject({
      id: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      sourceReleaseId: provider.source.release.id,
      sourceContentHash: provider.source.release.contentHash,
      overlayHash: PINNED_MICRO_MVP_L1_OVERLAY_HASH,
      contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      releaseHash: PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
    });
    expect(provider.ruleset).toEqual({
      systemId: 'dnd5e-2024',
      releaseId: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      contentHash: PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
      errataVersion: provider.source.release.errataVersion,
    });

    expect(() => assertPinnedProdSnapshotL1Ready(provider.source)).toThrow();
    expect(() => assertMicroMvpL1OverlayReady(provider)).not.toThrow();
  });

  it('derives all five L1 caster abilities from their materialized effect primitive', () => {
    const expected = {
      'CLASS-cleric': ['EFF-cleric-spellcasting', 'wis'],
      'CLASS-druid': ['EFF-druid-spellcasting', 'wis'],
      'CLASS-sorcerer': ['EFF-sorcerer-spellcasting', 'cha'],
      'CLASS-warlock': ['EFF-warlock-spellcasting', 'cha'],
      'CLASS-wizard': ['EFF-wizard-spellcasting', 'int'],
    } as const;

    for (const [classCardNumber, [effectCardNumber, ability]] of Object.entries(expected)) {
      const root = rootsByClass(provider, classCardNumber)[0];
      const declaration = payloads(effect(root, effectCardNumber)?.mechanics).find((payload) => (
        payload.kind === 'spellcasting_ability' && payload.role === 'primary'
      ));
      expect(declaration, `${classCardNumber}: primary declaration`).toMatchObject({ ability });
      expect(root.ruleState.spellcasting?.ability, `${classCardNumber}: rule state`).toBe(ability);
      expect(root.actor.spellcastingAccess?.grants.length, `${classCardNumber}: spell grants`)
        .toBeGreaterThan(0);
      expect(root.actor.spellcastingAccess?.grants.every((grant) => (
        grant.spellcastingAbility === ability
      ))).toBe(true);
    }
  });

  it('copies authoritative V/S/M flags onto every compiled spell action', () => {
    for (const root of provider.roots) {
      for (const action of root.rulesActions.filter((candidate) => candidate.kind === 'spell')) {
        const source = root.assembled.spells.find((candidate) => (
          action.sourceEntityIds.includes(candidate.id)
        ));
        expect(source, `${root.stableKey}: missing source spell for ${action.id}`).toBeDefined();
        if (action.kind !== 'spell' || !source) continue;
        expect(action.spell.components, `${root.stableKey}: ${action.id}`).toEqual({
          verbal: source.component_verbal,
          somatic: source.component_somatic,
          material: source.component_material,
        });
      }
    }
  });

  it('resolves every creation and rest choice with exact counts and no silent fallback', () => {
    for (const root of provider.roots) {
      expect(root.unresolvedAcquireChoiceIds).toEqual([]);
      expect(root.unresolvedRuntimeChoiceIds).toEqual([]);
      expect(root.decisions.length).toBeGreaterThan(0);
      for (const choice of root.assembled.pendingChoices) {
        const selected = root.draft.resolvedChoices[choice.id];
        expect(selected, `${root.stableKey}: ${choice.id}`).toHaveLength(choice.count);
        expect(new Set(selected).size, `${root.stableKey}: ${choice.id}`).toBe(selected.length);
      }
      expect(root.decisions.some((decision) => decision.choiceId.includes('warlock_invocations_l2'))).toBe(false);
      expect(root.decisions.some((decision) => decision.choiceId.includes('warlock_pact_boon'))).toBe(false);
    }

    const observedChoiceSuffixes = new Set(provider.roots.flatMap((root) => (
      root.assembled.pendingChoices.map((choice) => choice.id.split(':').at(-1))
    )));
    expect(observedChoiceSuffixes).toEqual(new Set([
      'cleric_cantrips', 'cleric_divine_order', 'cleric_spells_l1', 'druid_cantrips',
      'druid_primal_order', 'druid_spells_l1', 'elf_lineage_spellcasting_ability', 'elf_skill',
      'feat_skilled', 'fighter_fighting_style', 'human_feat', 'human_skill',
      'magic_initiate_wizard_cantrips',
      'magic_initiate_wizard_level_1', 'magic_initiate_spellcasting_ability',
      'rogue_additional_language', 'rogue_expertise_l1',
      'sorcerer_cantrips',
      'sorcerer_spells_known', 'warlock_cantrips', 'warlock_invocation_l1',
      'warlock_spells_known', 'weapon-mastery', 'wizard_cantrips',
      'wizard_prepared_spells_level_1', 'wizard_spellbook_level_1',
    ]));
  });

  it('compiles every declared L1 class-choice branch outside the 448-root product matrix', async () => {
    const rootKey = (cardNumber: string) => rootsByClass(provider, cardNumber)[0].stableKey;
    const catalogs = readProdSnapshotCatalogs();
    const fightingStyles = ['FEAT-0063', 'FEAT-0056', 'FEAT-0061', 'FEAT-0055']
      .map((cardNumber) => catalogs.feats.find((feat) => feat.card_number === cardNumber)!)
      .map((feat) => feat.id);
    const cases = [
      ...['protector', 'thaumaturge'].map((option) => ({
        stableKey: rootKey('CLASS-cleric'),
        choice: 'cleric_divine_order',
        option,
      })),
      ...['magician', 'warden'].map((option) => ({
        stableKey: rootKey('CLASS-druid'),
        choice: 'druid_primal_order',
        option,
      })),
      ...fightingStyles.map((option) => ({
        stableKey: rootKey('CLASS-warrior'),
        choice: 'fighter_fighting_style',
        option,
      })),
    ];

    const variants = await compileMicroMvpL1ChoiceVariants(cases.map((item) => ({
      stableKey: item.stableKey,
      overrides: { [item.choice]: [item.option] },
    })));

    const invocationVariants = [...warlockInvocationVariants.values()];
    expect(variants).toHaveLength(cases.length);
    expect(invocationVariants).toHaveLength(5);
    expect(new Set([...variants, ...invocationVariants]
      .map((variant) => variant.fixtureId)).size).toBe(cases.length + 5);
    variants.forEach((variant, index) => {
      const item = cases[index];
      expect(variant.unresolvedAcquireChoiceIds, `${item.choice}:${item.option}`).toEqual([]);
      expect(variant.unresolvedRuntimeChoiceIds, `${item.choice}:${item.option}`).toEqual([]);
      expect(variant.decisions).toContainEqual(expect.objectContaining({
        choiceId: expect.stringMatching(new RegExp(`:${item.choice}$`)),
        optionIds: [item.option],
        provenance: 'overlay-policy',
      }));
    });

    for (const [option, variant] of warlockInvocationVariants) {
      expect(variant.unresolvedAcquireChoiceIds, option).toEqual([]);
      expect(variant.unresolvedRuntimeChoiceIds, option).toEqual([]);
      expect(variant.decisions).toContainEqual(expect.objectContaining({
        choiceId: expect.stringMatching(/:warlock_invocation_l1$/),
        optionIds: [option],
        provenance: 'overlay-policy',
      }));
    }
    expect(new Set(invocationVariants.flatMap((variant) => (
      variant.assembled.effects
        .filter((item) => MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS
          .some((option) => option === item.effect.card_number))
        .map((item) => item.effect.card_number)
    )))).toEqual(new Set(MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS));
  }, 30_000);

  it('keeps product and Human feat grants independent while honoring repeatable metadata', async () => {
    for (const root of provider.roots) {
      expect(root.draft.swapFeat).toBe(true);
      expect(root.draft.featIds).toEqual([root.matrixCase.originFeat.id]);
      expect(root.assembled.feats.some((feat) => feat.id === root.matrixCase.originFeat.id)).toBe(true);
    }
    for (const root of rootsBySpecies(provider, 'RACE-0002')) {
      const humanFeat = root.decisions.find((decision) => decision.choiceId.endsWith(':human_feat'));
      expect(humanFeat?.optionIds).toHaveLength(1);
      const productFeat = root.assembled.feats.find((feat) => (
        feat.id === root.matrixCase.originFeat.id
      ));
      if (!productFeat?.repeatable) {
        expect(humanFeat?.optionIds[0]).not.toBe(root.matrixCase.originFeat.id);
      }
      expect(root.assembled.feats.map((feat) => feat.id)).toEqual(expect.arrayContaining([
        root.matrixCase.originFeat.id,
        humanFeat?.optionIds[0],
      ]));
      expect(effect(root, 'RE-elf-3')).toBeUndefined();
    }

    const repeatable = rootsBySpecies(provider, 'RACE-0002').find((root) => (
      root.matrixCase.originFeat.card_number === 'FEAT-0008'
    ));
    const nonRepeatable = rootsBySpecies(provider, 'RACE-0002').find((root) => (
      !root.assembled.feats.find((feat) => feat.id === root.matrixCase.originFeat.id)?.repeatable
    ));
    expect(repeatable && nonRepeatable).toBeTruthy();
    const [variant] = await compileMicroMvpL1ChoiceVariants([{
      stableKey: repeatable!.stableKey,
      overrides: { human_feat: [repeatable!.matrixCase.originFeat.id] },
    }]);
    expect(variant.assembled.feats.filter((feat) => feat.id === repeatable!.matrixCase.originFeat.id))
      .toHaveLength(2);
    const skilledChoices = variant.assembled.pendingChoices.filter((choice) => (
      choice.id.endsWith(':feat_skilled')
    ));
    expect(skilledChoices).toHaveLength(2);
    expect(new Set(skilledChoices.map((choice) => choice.id)).size).toBe(2);
    expect(skilledChoices.every((choice) => (
      (variant.draft.resolvedChoices[choice.id] ?? []).length === 3
    ))).toBe(true);

    await expect(compileMicroMvpL1ChoiceVariants([{
      stableKey: nonRepeatable!.stableKey,
      overrides: { human_feat: [nonRepeatable!.matrixCase.originFeat.id] },
    }])).rejects.toThrow('Уже получена');
  }, 60_000);

  it('materializes all Dragonborn L1 ancestries and removes the L5 flight leak', () => {
    const roots = rootsBySpecies(provider, 'RACE-0008');
    expect(roots).toHaveLength(112);
    expect(new Set(roots.map((root) => root.speciesAudit.lineageCardNumber))).toEqual(new Set(DRAGON_LINEAGES));

    for (const root of roots) {
      expect(root.assembled.subrace?.id).toBe(root.speciesAudit.lineageId);
      expect(root.assembled.effects.some((item) => item.effect.card_number === 'RE-dragonborn-4')).toBe(false);
      expect(root.actor.capabilities.actionIds).not.toContain('fe0ac34d-719c-487c-86bd-4d71ed4390da');
      const breathId = root.assembled.subrace?.related_actions?.[0];
      const resistanceId = root.assembled.subrace?.related_effects?.[0];
      const compiledBreath = root.rulesActions.find((action) => action.sourceEntityIds.includes(breathId!));
      expect(compiledBreath).toBeDefined();
      expect(root.actor.capabilities.actionIds).toContain(compiledBreath!.id);
      expect(root.assembled.effects.map((item) => item.effect.id)).toContain(resistanceId);

      const breath = root.assembled.actions.find((item) => item.action.id === breathId)?.action;
      expect(breath).toBeDefined();
      expect(root.actor.runtime.maxResources[actionUsesKey(breath!.card_number)]).toBe(2);
      const save = ((breath!.mechanics as Dict).effects as Dict[])[0];
      expect(save.on_success).toEqual([expect.objectContaining({ kind: 'damage', on_success: 'half' })]);
    }
  });

  it('materializes every Elf L1 lineage grant without exposing its L3/L5 spells', () => {
    const roots = rootsBySpecies(provider, 'RACE-0004');
    expect(roots).toHaveLength(112);
    expect(new Set(roots.map((root) => root.speciesAudit.lineageCardNumber))).toEqual(new Set(ELF_LINEAGES));

    for (const root of roots) {
      expect(root.assembled.subrace?.id).toBe(root.speciesAudit.lineageId);
      const lineageEffectIds = root.assembled.subrace?.related_effects ?? [];
      expect(root.assembled.effects.map((item) => item.effect.id)).toEqual(expect.arrayContaining(lineageEffectIds));
      const lineagePayloads = lineageEffectIds.flatMap((id) => {
        const entity = root.assembled.effects.find((item) => item.effect.id === id)?.effect;
        return payloads(entity?.mechanics as Dict);
      });
      const l1SpellRefs = lineagePayloads
        .filter((payload) => payload.kind === 'grant_spell' && Number(payload.level_gate ?? 1) === 1)
        .map((payload) => String(payload.value))
        .sort();
      const higherSpellRefs = lineagePayloads
        .filter((payload) => payload.kind === 'grant_spell' && Number(payload.level_gate ?? 1) > 1)
        .map((payload) => String(payload.value))
        .sort();
      expect(l1SpellRefs.length).toBeGreaterThan(0);
      expect(root.speciesAudit.l1SpellRefs).toEqual(l1SpellRefs);
      expect(root.speciesAudit.excludedHigherLevelSpellRefs).toEqual(higherSpellRefs);
      expect(root.assembled.spells.some((candidate) => l1SpellRefs.includes(candidate.card_number))).toBe(true);
      const abilityChoice = root.assembled.pendingChoices.find((choice) => (
        choice.id.endsWith(':elf_lineage_spellcasting_ability')
      ));
      expect(abilityChoice).toMatchObject({
        count: 1,
        source: 'ability',
        items: [
          { id: 'int', name: 'INT' },
          { id: 'wis', name: 'WIS' },
          { id: 'cha', name: 'CHA' },
        ],
        origin: { id: root.speciesAudit.lineageId },
      });
      const abilityDecision = root.decisions.find((decision) => (
        decision.choiceId === abilityChoice?.id
      ));
      expect(abilityDecision?.optionIds).toEqual([root.speciesAudit.lineageSpellcastingAbility]);
      expect(['int', 'wis', 'cha']).toContain(root.speciesAudit.lineageSpellcastingAbility);
      const lineageGrants = root.actor.spellcastingAccess?.grants.filter((grant) => (
        grant.sourceId === root.speciesAudit.lineageId
      )) ?? [];
      expect(lineageGrants.length).toBeGreaterThan(0);
      expect(new Set(lineageGrants.map((grant) => grant.spellcastingAbility)))
        .toEqual(new Set([root.speciesAudit.lineageSpellcastingAbility]));
    }
  });

  it('compiles each legal Elf lineage spellcasting ability as source-scoped provenance', () => {
    for (const ability of ['int', 'wis', 'cha'] as const) {
      const root = elfAbilityVariants.get(ability)!;
      expect(root.speciesAudit.lineageSpellcastingAbility).toBe(ability);
      expect(root.decisions).toContainEqual(expect.objectContaining({
        choiceId: expect.stringMatching(/:elf_lineage_spellcasting_ability$/),
        optionIds: [ability],
        stage: 'creation',
      }));
      const lineageGrants = root.actor.spellcastingAccess?.grants.filter((grant) => (
        grant.sourceId === root.speciesAudit.lineageId
      )) ?? [];
      expect(lineageGrants.length).toBeGreaterThan(0);
      expect(lineageGrants.every((grant) => grant.spellcastingAbility === ability)).toBe(true);
    }
  });

  it('promotes L1 active effects to owned actions and seeds Weapon Mastery', () => {
    for (const root of rootsBySpecies(provider, 'RACE-0003')) {
      const stonecunning = effect(root, 'RE-dwarf-4');
      expect(stonecunning).toBeDefined();
      const action = root.rulesActions.find((candidate) => candidate.sourceEntityIds.includes(stonecunning!.id));
      expect(action).toBeDefined();
      expect(root.actor.capabilities.actionIds).toContain(action!.id);
      expect(provider.catalog.getAction(action!.id)).toBeDefined();
    }

    for (const root of rootsByClass(provider, 'CLASS-warrior')) {
      expect(new Set(root.actor.character.weaponMasteries)).toEqual(new Set(['greatsword', 'longbow', 'longsword']));
    }
    for (const root of rootsByClass(provider, 'CLASS-rogue')) {
      expect(root.actor.character.weaponMasteries).toEqual(['dagger', 'shortbow']);
    }
  });

  it('removes every L2 resource/action and compiles exactly one L1 Warlock invocation', () => {
    for (const root of provider.roots) {
      expect(root.actor.runtime.maxResources).not.toHaveProperty('wild_shape');
      expect(root.actor.runtime.maxResources).not.toHaveProperty('sorcery_points');
      expect(root.assembled.klass?.resources).not.toHaveProperty('wild_shape');
      expect(root.assembled.klass?.resources).not.toHaveProperty('sorcery_points');
      expect(root.assembled.spells.every((candidate) => candidate.level <= 1)).toBe(true);
      for (const actionId of root.actor.capabilities.actionIds) {
        const action = provider.catalog.getAction(actionId);
        expect(action, `${root.stableKey}: ${actionId}`).toBeDefined();
        expect(action!.sourceEntityIds.length).toBeGreaterThan(0);
        if (action!.kind === 'spell') {
          expect(action!.spell.level).toBeGreaterThanOrEqual(0);
          expect(action!.spell.level).toBeLessThanOrEqual(1);
        } else {
          expect(action!.spell).toBeUndefined();
        }
      }
    }

    for (const root of rootsByClass(provider, 'CLASS-warlock')) {
      expect(root.selectedInvocationEffectIds).toHaveLength(1);
      expect(root.assembled.effects.some((item) => item.effect.card_number === 'EFF-pact-boon')).toBe(false);
      const invocationChoice = root.assembled.pendingChoices.find((choice) => (
        choice.id.endsWith(':warlock_invocation_l1')
      ));
      expect(invocationChoice).toMatchObject({ count: 1, source: 'effect' });
      expect(invocationChoice!.items?.map((item) => item.id)).toEqual(
        MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS,
      );
      expect(root.draft.resolvedChoices[invocationChoice!.id]).toHaveLength(1);
      expect(root.draft.resolvedChoices[invocationChoice!.id]).toEqual([
        'EFF-invoc-armor_of_shadows',
      ]);
      expect(invocationChoice!.items?.map((item) => item.id)).not.toEqual(expect.arrayContaining([
        'EFF-invoc-agonizing_blast',
        'EFF-invoc-fiendish_vigor',
        'EFF-invoc-mask_of_many_faces',
      ]));
      expect(root.actor.runtime.maxResources.spell_slot_1).toBe(1);
    }
  });

  it('executes Armor of Shadows as self-only at-will Mage Armor with stable invocation provenance', () => {
    const root = warlockInvocationVariants.get('EFF-invoc-armor_of_shadows')!;
    const invocation = effect(root, 'EFF-invoc-armor_of_shadows')!;
    expect(readProdSnapshotCatalogs().effects.some((item) => (
      item.card_number === invocation.card_number
    ))).toBe(false);
    expect(invocation).toMatchObject({
      id: '7c1e7fd0-3a72-5a11-8d31-2d056c71af01',
      author: 'micro-mvp-overlay',
      source: 'PHB 2024; micro-MVP L1 overlay canonical entity v1',
    });

    const action = root.rulesActions.find((candidate) => (
      candidate.kind === 'spell'
      && candidate.sourceEntityIds.includes(invocation.id)
      && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
      && candidate.spell.level === 1
    ))!;
    expect(action).toBeDefined();
    expect(action.id).toBe(`db6433bf-f779-4b65-8766-0feffefd1930@${invocation.id}`);
    expect(action.spell).toMatchObject({ level: 1, sourceClass: 'CLASS-warlock' });
    expect(action.targeting).toMatchObject({
      rangeFt: 0,
      requiresLineOfSight: false,
      allowedRelations: ['self'],
      requiresWilling: true,
      requiresUnarmored: true,
    });
    const mechanics = action.mechanics as Dict;
    expect((mechanics.activation as Dict).cost).toEqual([{ resource: 'action' }]);
    expect(mechanics).not.toHaveProperty('uses');
    expect(root.actor.runtime.maxResources).not.toHaveProperty(actionUsesKey('SPELL-0190'));

    const first = executeAction(copy(root.actor.runtime), mechanics, {
      character: root.actor.character,
      rng: () => 0.5,
      nextId: () => 'armor-of-shadows-effect',
      grantedEffects: root.actor.grantedEffects,
    });
    expect(first.state.resources.spell_slot_1).toBe(root.actor.runtime.resources.spell_slot_1);
    expect(first.state.resources.action).toBe(root.actor.runtime.resources.action - 1);
    expect(first.events.some((event) => JSON.stringify(event).includes('NOT_IMPLEMENTED'))).toBe(false);
    expect(armorClassValue(root.actor.character, first.state, root.actor.passives ?? []).value)
      .toBe(13 + root.actor.character.abilityMods.dex);

    const readyAgain = {
      ...first.state,
      resources: { ...first.state.resources, action: root.actor.runtime.maxResources.action },
    };
    const second = executeAction(readyAgain, mechanics, {
      character: root.actor.character,
      rng: () => 0.5,
      nextId: () => 'armor-of-shadows-effect-2',
      grantedEffects: root.actor.grantedEffects,
    });
    expect(second.state.resources.spell_slot_1).toBe(root.actor.runtime.resources.spell_slot_1);
    expect(armorClassValue(root.actor.character, second.state, root.actor.passives ?? []).value)
      .toBe(13 + root.actor.character.abilityMods.dex);
  });

  it('scopes Eldritch Mind advantage to Constitution saves that maintain Concentration', () => {
    const root = warlockInvocationVariants.get('EFF-invoc-eldritch_mind')!;
    const invocation = effect(root, 'EFF-invoc-eldritch_mind')!;
    expect(readProdSnapshotCatalogs().effects.some((item) => (
      item.card_number === invocation.card_number
    ))).toBe(false);
    expect(invocation).toMatchObject({
      id: '88094c3d-5e06-54fe-b8f3-0c0ee0e18302',
      author: 'micro-mvp-overlay',
      source: 'PHB 2024; micro-MVP L1 overlay canonical entity v1',
    });
    const passives = root.actor.passives ?? [];
    expect(collectRollModifiers(copy(root.actor.runtime), passives, {
      roll: 'saving_throw',
      filter: { ability: 'con', reason: 'maintain_concentration' },
    }).advantage).toBe('advantage');
    expect(collectRollModifiers(copy(root.actor.runtime), passives, {
      roll: 'saving_throw',
      filter: { ability: 'con' },
    }).advantage).toBe('none');
    expect(collectRollModifiers(copy(root.actor.runtime), passives, {
      roll: 'saving_throw',
      filter: { ability: 'con', reason: 'poison' },
    }).advantage).toBe('none');
    expect(collectRollModifiers(copy(root.actor.runtime), passives, {
      roll: 'saving_throw',
      filter: { ability: 'dex', reason: 'maintain_concentration' },
    }).advantage).toBe('none');
  });

  it('compiles Pact Blade as canonical command authority without generic marker effects', () => {
    const root = warlockInvocationVariants.get('EFF-pact-blade')!;
    const invocation = effect(root, 'EFF-pact-blade')!;
    const action = root.rulesActions.find((candidate) => (
      candidate.kind === 'nonSpell' && candidate.sourceEntityIds.includes(invocation.id)
    ))!;
    expect(action).toBeDefined();
    expect(action.targeting!.allowedRelations).toEqual([]);
    expect(((action.mechanics.activation as Dict).cost as Dict[])).toEqual([
      { resource: 'bonus_action' },
    ]);
    expect(action.mechanics.primitive).toEqual({
      type: 'pact_blade_bond',
      stateCapability: 'warlock.pact.blade',
      commandType: 'BondPactBlade',
      authority: 'rules-core',
      modes: ['conjure', 'touch_existing'],
      weaponCardAuthority: 'immutable_catalog_card_id',
      allowedWeaponCategories: ['simple', 'martial'],
      meleeOnly: true,
      conjureRequiresFreeHand: true,
      damageTypeChoices: ['normal', 'necrotic', 'psychic', 'radiant'],
      policy: PACT_BLADE_PHB_2024_RAW_LIFECYCLE_POLICY,
    });
    expect(payloads(action.mechanics as Dict).filter((item) => item.kind === 'choice')).toEqual([]);
    expect(canonicalStringify(action.mechanics)).not.toMatch(/pact_weapon_bond|stack_id/);
    expect(root.decisions.filter(({ choiceId }) => (
      choiceId.includes('pact_blade_weapon') || choiceId.includes('pact_blade_damage_type')
    ))).toEqual([]);

    expect(root.actor.warlockPacts).toEqual({
      blade: {
        kind: 'blade',
        sourceEntityId: invocation.id,
        ownerActorId: root.actor.id,
        bondActionId: action.id,
        lifecyclePolicy: PACT_BLADE_PHB_2024_LIFECYCLE_POLICY,
        activeBond: null,
      },
    });
    expect(root.actor.capabilities.featureSources?.['warlock.pact.blade'])
      .toEqual(expect.arrayContaining([invocation.id, invocation.card_number]));
    expect(root.initialWorldObjects).toEqual([]);
  });

  it('compiles Pact of the Chain as an at-will no-slot Find Familiar canonical hand-off', () => {
    const root = warlockInvocationVariants.get('EFF-pact-chain')!;
    const invocation = effect(root, 'EFF-pact-chain')!;
    const familiar = spell(root, 'SPELL-0241')!;
    expect(familiar).toBeDefined();
    const action = root.rulesActions.find((candidate) => (
      candidate.kind === 'spell'
      && candidate.sourceEntityIds.includes(invocation.id)
      && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
      && candidate.spell.level === 1
    ))!;
    expect(action).toBeDefined();
    expect(action.spell).toMatchObject({ level: 1, sourceClass: 'CLASS-warlock' });
    expect(action.targeting).toMatchObject({
      minTargets: 0, rangeFt: 0, allowedRelations: ['self'],
    });
    expect((action.mechanics.activation as Dict).cost).toEqual([
      { resource: 'action' },
      {
        resource: 'material_incense_gp', amount: 10,
        binding: { kind: 'currency', currency: 'gold' }, recharge: 'never',
      },
    ]);
    expect(action.mechanics).not.toHaveProperty('uses');
    expect(root.actor.runtime.maxResources).not.toHaveProperty(actionUsesKey('SPELL-0241'));

    const beforeRuntime = copy(root.actor.runtime);
    expect(() => executeAction(beforeRuntime, action.mechanics as Dict, {
      character: root.actor.character,
      rng: () => 0.5,
      nextId: () => 'pact-chain-cast',
    })).toThrow(/CANONICAL_PRIMITIVE_REQUIRED/);
    expect(beforeRuntime).toEqual(root.actor.runtime);
    expect(action.mechanics).toMatchObject({
      primitive: { type: 'find_familiar' },
      activation: { cast_time: { unit: 'minute', amount: 60 } },
      effects: [],
    });

    expect(root.actor.warlockPacts?.chain).toEqual({
      kind: 'chain',
      sourceEntityId: invocation.id,
      ownerActorId: root.actor.id,
      template: {
        findFamiliarActionId: action.id,
        normalFormSource: 'find_familiar_spell',
        specialFormIds: [
          'imp', 'pseudodragon', 'quasit', 'skeleton', 'slaad_tadpole',
          'sphinx_of_wonder', 'sprite', 'venomous_snake',
        ],
      },
      activeFamiliar: null,
    });
    expect(root.actor.capabilities.featureSources?.['warlock.pact.chain'])
      .toEqual(expect.arrayContaining([invocation.id, invocation.card_number]));
    expect(root.initialWorldObjects).toEqual([]);
  });

  it('compiles Pact of the Tome rest choices as three cantrips and two L1 rituals with Warlock provenance', () => {
    const root = warlockInvocationVariants.get('EFF-pact-tome')!;
    const invocation = effect(root, 'EFF-pact-tome')!;
    const cantripDecision = root.decisions.find((item) => item.choiceId.endsWith(':pact_tome_cantrips'))!;
    const ritualDecision = root.decisions.find((item) => item.choiceId.endsWith(':pact_tome_rituals'))!;
    expect(cantripDecision).toMatchObject({ stage: 'rest', provenance: 'overlay-policy' });
    expect(ritualDecision).toMatchObject({ stage: 'rest', provenance: 'overlay-policy' });
    expect(cantripDecision.optionIds).toHaveLength(3);
    expect(ritualDecision.optionIds).toHaveLength(2);
    expect(new Set([...cantripDecision.optionIds, ...ritualDecision.optionIds]).size).toBe(5);
    const classPrepared = root.decisions
      .filter((item) => item.choiceId.endsWith(':warlock_cantrips')
        || item.choiceId.endsWith(':warlock_spells_known'))
      .flatMap((item) => item.optionIds);
    expect([...cantripDecision.optionIds, ...ritualDecision.optionIds]
      .some((id) => classPrepared.includes(id))).toBe(false);
    const cantripChoice = root.assembled.pendingChoices.find((item) => (
      item.id.endsWith(':pact_tome_cantrips')
    ))!;
    const ritualChoice = root.assembled.pendingChoices.find((item) => (
      item.id.endsWith(':pact_tome_rituals')
    ))!;
    expect(cantripChoice.options?.filter).toEqual({ levels: [0] });
    expect(ritualChoice.options?.filter).toEqual({ levels: [1], ritual: true });

    const byReference = new Map(root.assembled.spells.flatMap((item) => ([
      [item.id, item] as const,
      [item.card_number, item] as const,
    ])));
    const cantrips = cantripDecision.optionIds.map((id) => byReference.get(id)!);
    const rituals = ritualDecision.optionIds.map((id) => byReference.get(id)!);
    expect(cantrips.every((item) => item.level === 0)).toBe(true);
    expect(rituals.every((item) => item.level === 1 && item.ritual)).toBe(true);

    for (const selected of [...cantrips, ...rituals]) {
      const action = root.rulesActions.find((candidate) => (
        candidate.kind === 'spell'
        && candidate.sourceEntityIds.includes(invocation.id)
        && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
        && candidate.sourceEntityIds.includes(selected.id)
      ));
      expect(action, selected.card_number).toBeDefined();
      expect(action).toMatchObject({ spell: { sourceClass: 'CLASS-warlock' } });
      expect(action!.id).toBe(`${selected.id}@${invocation.id}`);
    }

    const state = root.actor.warlockPacts?.tome;
    expect(state).toMatchObject({
      kind: 'tome',
      sourceEntityId: invocation.id,
      ownerActorId: root.actor.id,
      tome: {
        createdAfterRest: 'long',
        cantripActionIds: expect.arrayContaining(cantrips.map((item) => `${item.id}@${invocation.id}`)),
        ritualActionIds: expect.arrayContaining(rituals.map((item) => `${item.id}@${invocation.id}`)),
      },
    });
    expect(root.initialWorldObjects).toEqual([expect.objectContaining({
      id: state?.tome.bookObjectId,
      name: 'Book of Shadows',
      ownerActorId: root.actor.id,
      carriedByActorId: root.actor.id,
      sourceActionId: invocation.id,
      tags: ['book_of_shadows', 'spellcasting_focus'],
    })]);
    const bookGrants = root.actor.spellcastingAccess?.grants.filter((grant) => (
      grant.sourceId === state?.tome.bookObjectId
    ));
    expect(bookGrants?.filter((grant) => grant.access === 'cantrip')).toHaveLength(3);
    expect(bookGrants?.filter((grant) => (
      grant.access === 'always_prepared'
        && grant.ritual === true
        && grant.slotResource === 'spell_slot_1'
    ))).toHaveLength(2);
    expect(state?.tome.spellGrantIds).toEqual(bookGrants?.map((grant) => grant.grantId).sort());
    expect(root.actor.capabilities.featureSources?.['warlock.pact.tome'])
      .toEqual(expect.arrayContaining([invocation.id, invocation.card_number]));
  });

  it('replaces supported narrative records with executable structured mechanics', () => {
    const alertRoot = provider.roots.find((root) => effect(root, 'EFF-alert'))!;
    expect(payloads(effect(alertRoot, 'EFF-alert')?.mechanics as Dict)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier',
        applies_to: { roll: 'initiative' },
        value: 'prof_bonus',
      }),
    ]));
    expect(effect(alertRoot, 'EFF-alert')?.mechanics).toMatchObject({
      capabilities: [{
        id: 'alert.initiative_swap',
        source_entity_ids: ['FEAT-0001', 'EFF-alert'],
      }],
    });
    expect(alertRoot.actor.capabilities.featureSources?.['alert.initiative_swap']).toEqual([
      expect.any(String), 'FEAT-0001', expect.any(String), 'EFF-alert',
    ]);

    const cleric = rootsByClass(provider, 'CLASS-cleric')[0];
    const divine = payloads(effect(cleric, 'EFF-divine-order')?.mechanics as Dict)
      .find((payload) => payload.id === 'cleric_divine_order')!;
    const protector = (((divine.options as Dict).items as Dict[])
      .find((item) => item.id === 'protector')!.grants as Dict[]);
    expect(protector).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'armor', value: 'heavy' }),
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'weapon', value: 'martial' }),
    ]));

    const druid = rootsByClass(provider, 'CLASS-druid')[0];
    const primal = payloads(effect(druid, 'EFF-primal-order')?.mechanics as Dict)
      .find((payload) => payload.id === 'druid_primal_order')!;
    const warden = (((primal.options as Dict).items as Dict[])
      .find((item) => item.id === 'warden')!.grants as Dict[]);
    expect(warden).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'armor', value: 'medium' }),
      expect.objectContaining({ kind: 'grant_proficiency', prof: 'weapon', value: 'martial' }),
    ]));

    const sorcerer = rootsByClass(provider, 'CLASS-sorcerer')[0];
    expect(payloads(effect(sorcerer, 'EFF-innate-sorcery')?.mechanics as Dict)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier', op: 'add', value: '1',
        applies_to: { roll: 'spell_save_dc', filter: { spellClass: 'CLASS-sorcerer' } },
      }),
      expect.objectContaining({
        kind: 'modifier', op: 'advantage',
        applies_to: { roll: 'attack', filter: { spellClass: 'CLASS-sorcerer' } },
      }),
    ]));
    const sorcererSpellActions = sorcerer.rulesActions.filter((action) => (
      action.kind === 'spell' && action.spell.sourceClass === 'CLASS-sorcerer'
    ));
    expect(sorcererSpellActions.length).toBeGreaterThan(0);
    expect(sorcererSpellActions.every((action) => action.id.endsWith('@CLASS-sorcerer'))).toBe(true);
    expect(sorcererSpellActions.every((action) => action.sourceEntityIds.includes(sorcerer.matrixCase.klass.id))).toBe(true);

    const rogue = rootsByClass(provider, 'CLASS-rogue')[0];
    expect(effect(rogue, 'EFF-sneak-attack')?.mechanics).toMatchObject({
      activation: { mode: 'triggered', trigger: { event: 'hit', timing: 'during' } },
      uses: { count: 1, per: 'turn' },
    });
    expect(payloads(effect(rogue, 'EFF-sneak-attack')?.mechanics as Dict)).toContainEqual(
      expect.objectContaining({ kind: 'damage', dice: '1d6', type: 'weapon' }),
    );

    const spellRoots = provider.roots.filter((root) => root.assembled.spells.length > 0);
    const findSpell = (cardNumber: string) => spellRoots.map((root) => spell(root, cardNumber)).find(Boolean)!;
    const guidance = findSpell('SPELL-0230');
    const guidanceChoice = payloads(guidance.mechanics as Dict)
      .find((payload) => payload.id === 'guidance_skill');
    expect(guidanceChoice).toMatchObject({ kind: 'choice', context: 'in_play', who: 'target' });
    const guidanceItems = ((guidanceChoice?.options as Dict | undefined)?.items ?? []) as Dict[];
    expect(guidanceItems).toHaveLength(18);
    expect(guidanceItems.every((item) => (
      ((item.grants as Dict[] | undefined)?.[0])?.consume == null
    ))).toBe(true);
    const bless = findSpell('SPELL-0163');
    expect(payloads(bless.mechanics as Dict).filter((payload) => payload.op === 'bonus_die')).toHaveLength(2);
    const magicMissile = findSpell('SPELL-0174');
    expect(magicMissile.mechanics).toMatchObject({
      primitive: {
        type: 'magic_missile',
        policy: {
          base_slot_level: 1,
          max_slot_level: 9,
          base_dart_count: 3,
          darts_per_slot_above: 1,
          allocation_choice_id: 'magic_missile_dart_targets',
          simultaneous: true,
          per_dart_effect: {
            resolution: 'auto', who: 'target',
            result: [{ kind: 'damage', dice: '1d4 + 1', type: 'force' }],
          },
        },
      },
      targeting: {
        domain: 'actor', actor_targets: true, shape: 'multiple',
        max_targets: 11, range_ft: 120, range: '120 футов',
      },
    });
    const magicMissileAction = provider.roots.flatMap((root) => root.rulesActions)
      .find((candidate) => candidate.sourceEntityIds.includes(magicMissile.id));
    expect(magicMissileAction).toMatchObject({
      mechanics: {
        primitive: {
          type: 'magic_missile',
          policy: {
            base_dart_count: 3,
            allocation_choice_id: 'magic_missile_dart_targets',
            simultaneous: true,
            per_dart_effect: {
              resolution: 'auto', who: 'target',
              result: [{ kind: 'damage', dice: '1d4 + 1', type: 'force' }],
            },
          },
        },
      },
      targeting: { minTargets: 1, maxTargets: 11, rangeFt: 120 },
    });
    const shield = findSpell('SPELL-0317');
    expect((shield.mechanics as Dict).activation).toMatchObject({
      trigger: { events: ['hit_by_attack', 'targeted_by_magic_missile'] },
    });
    expect(payloads(shield.mechanics as Dict)).toContainEqual(expect.objectContaining({
      kind: 'modifier',
      magic_missile_immunity: true,
    }));
    const shieldAction = provider.roots.flatMap((root) => root.rulesActions)
      .find((candidate) => candidate.sourceEntityIds.includes(shield.id));
    expect(shieldAction?.mechanics).toMatchObject({
      activation: { trigger: { events: ['hit_by_attack', 'targeted_by_magic_missile'] } },
    });
    for (const cardNumber of ['SPELL-0242', 'SPELL-0171']) {
      const areaSpell = findSpell(cardNumber);
      const save = ((areaSpell.mechanics as Dict).effects as Dict[])
        .find((interaction) => interaction.resolution === 'save')!;
      expect(save.on_success).toEqual([expect.objectContaining({ kind: 'damage', on_success: 'half' })]);
      const action = provider.roots.flatMap((root) => root.rulesActions)
        .find((candidate) => candidate.sourceEntityIds.includes(areaSpell.id));
      expect(action?.targeting).toMatchObject({ minTargets: 0, maxTargets: 8, rangeFt: 15 });
      expect(action?.mechanics.primitive).toMatchObject({
        type: cardNumber === 'SPELL-0242' ? 'burning_hands_objects' : 'area_object_push',
      });
    }
    for (const [cardNumber, primitiveType] of [
      ['light', 'light_world_object'],
      ['minor_illusion', 'minor_illusion_world_object'],
      ['detect_magic', 'detect_magic_world_sensing'],
    ] as const) {
      const spell = findSpell(cardNumber);
      const action = provider.roots.flatMap((root) => root.rulesActions)
        .find((candidate) => candidate.sourceEntityIds.includes(spell.id));
      expect(action?.mechanics.primitive).toMatchObject({
        type: primitiveType,
        policy: expect.any(Object),
      });
      expect(action?.targeting?.minTargets).toBe(0);
    }
    expect(payloads(findSpell('SPELL-0218').mechanics as Dict)).toContainEqual(expect.objectContaining({
      kind: 'modifier', applies_to: { roll: 'speed' }, value: '-10',
      duration: { type: 'until_start_of_source_next_turn' },
    }));
    expect(payloads(findSpell('SPELL-0229').mechanics as Dict)).toContainEqual(expect.objectContaining({
      kind: 'modifier', applies_to: { roll: 'attack' }, op: 'advantage', consume: 'next',
      duration: { type: 'until_end_of_source_next_turn' },
    }));
    expect(payloads(findSpell('chill_touch').mechanics as Dict)).toContainEqual(expect.objectContaining({
      kind: 'modifier', applies_to: { roll: 'healing' }, op: 'deny',
      duration: { type: 'until_end_of_source_next_turn' },
    }));
  });

  it('has no unresolved level-1 capability gaps after all Pact verticals became first-class state', () => {
    expect(rootsByClass(provider, 'CLASS-warlock')).toHaveLength(64);
    expect(provider.capabilityGaps).toEqual([]);
  });

  it('derives capability gaps from compiled primitives and typed Pact branches', () => {
    const pactChoiceRoots = [...warlockInvocationVariants.values()];
    expect(deriveMicroMvpL1CapabilityGaps({
      roots: provider.roots,
      pactChoiceRoots,
    })).toEqual([]);

    const detectRoot = provider.roots.find((root) => spell(root, 'detect_magic'))!;
    const mutatedDetectRoot = copy(detectRoot);
    const detectSpell = spell(mutatedDetectRoot, 'detect_magic')!;
    const detectAction = mutatedDetectRoot.rulesActions.find((action) => (
      action.sourceEntityIds.includes(detectSpell.id)
    ))!;
    delete (detectAction.mechanics as Dict).primitive;
    const spellGaps = deriveMicroMvpL1CapabilityGaps({
      roots: provider.roots.map((root) => root === detectRoot ? mutatedDetectRoot : root),
      pactChoiceRoots,
    });
    expect(spellGaps).toContainEqual(expect.objectContaining({
      code: 'detect_magic_world_sensing',
      status: 'partially_expressible',
      affectedRootCount: 1,
    }));

    const bladeRoot = copy(warlockInvocationVariants.get('EFF-pact-blade')!);
    delete bladeRoot.actor.warlockPacts?.blade;
    const pactGaps = deriveMicroMvpL1CapabilityGaps({
      roots: provider.roots,
      pactChoiceRoots: pactChoiceRoots.map((root) => (
        invocationCard(root) === 'EFF-pact-blade' ? bladeRoot : root
      )),
    });
    expect(pactGaps).toContainEqual(expect.objectContaining({
      code: 'warlock_pact_blade_bond_state',
      status: 'partially_expressible',
      affectedRootCount: 1,
    }));
  });

  it('covers every raw source issue with one concrete correction/invariant and fails on a new issue', () => {
    expect(MICRO_MVP_L1_SOURCE_ISSUE_DISPOSITIONS.length).toBeGreaterThan(0);
    expect(sourceIssueDispositionProblems(provider.source)).toEqual([]);

    const sourceWithUnknownIssue = {
      ...provider.source,
      issues: [...provider.source.issues, {
        severity: 'error' as const,
        code: 'broken_reference' as const,
        subjectId: 'new-unreviewed-reference',
        message: 'synthetic fail-closed proof',
      }],
    };
    expect(sourceIssueDispositionProblems(sourceWithUnknownIssue)).toContain(
      'source issue [broken_reference] new-unreviewed-reference has 0 overlay dispositions',
    );
    expect(() => assertMicroMvpL1OverlayReady({
      ...provider,
      source: sourceWithUnknownIssue,
    })).toThrow(/new-unreviewed-reference/);
  });
});
