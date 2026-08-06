import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildMicroMvpSpellScopePolicy,
  createMicroMvpSpellScopeHook,
  MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS,
  type MicroMvpSpellScopeHook,
  type MicroMvpSpellScopePolicy,
} from '../rules-core/microMvpSpellScope';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from './microMvpL1Overlay';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
} from './prodSnapshotL1Fixtures';

type Dict = Record<string, unknown>;

const FIXED_GRANT_CARDS = [
  'RE-sub-drow',
  'RE-sub-high_elf',
  'RE-sub-wood_elf',
  'EFF-pact-chain',
  'EFF-invoc-armor_of_shadows',
] as const;

function rootByClass(
  provider: CompiledMicroMvpL1Provider,
  classCardNumber: string,
  predicate: (root: CompiledMicroMvpL1Root) => boolean = () => true,
): CompiledMicroMvpL1Root {
  const root = provider.roots.find((candidate) => (
    candidate.matrixCase.klass.card_number === classCardNumber && predicate(candidate)
  ));
  if (!root) throw new Error(`Missing test root for ${classCardNumber}`);
  return root;
}

function directL1SpellGrants(mechanics: Dict | null | undefined): string[] {
  const result: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Dict;
    if (record.kind === 'grant_spell' && typeof record.value === 'string'
      && Number(record.level_gate ?? record.min_level ?? 1) <= 1) {
      result.push(record.value);
    }
    Object.values(record).forEach(visit);
  };
  visit(mechanics);
  return [...new Set(result)].sort();
}

function assertRootUsesOnlyCuratedSpells(
  root: CompiledMicroMvpL1Root,
  policy: MicroMvpSpellScopePolicy,
  hook: MicroMvpSpellScopeHook,
  observedChoiceIds: Set<string>,
): void {
  const byId = new Map(policy.spells.map((spell) => [spell.id, spell]));
  const curatedReferences = new Set(policy.spells.flatMap((spell) => [spell.id, spell.cardNumber]));

  for (const choice of root.assembled.pendingChoices.filter((candidate) => (
    candidate.source === 'spell'
  ))) {
    const suffix = choice.id.split(':').at(-1)!;
    observedChoiceIds.add(suffix);
    const selected = root.draft.resolvedChoices[choice.id] ?? [];
    expect(selected, `${root.stableKey}:${choice.id}`).toHaveLength(choice.count);
    expect(hook.assertChoice(choice.id, selected), `${root.stableKey}:${choice.id}`)
      .toEqual(selected);
    for (const spellId of selected) {
      const spell = byId.get(spellId);
      expect(spell, `${root.stableKey}:${choice.id}:${spellId}`).toBeDefined();
      const choicePolicy = policy.choices[suffix as keyof typeof policy.choices];
      expect(spell!.level, `${root.stableKey}:${choice.id}:${spell!.cardNumber}`)
        .toBe(choicePolicy.level);
      if (choicePolicy.catalogClassName) {
        expect(spell!.classes, `${root.stableKey}:${choice.id}:${spell!.cardNumber}`)
          .toContain(choicePolicy.catalogClassName);
      }
      if (choicePolicy.ritual) {
        expect(spell!.ritual, `${root.stableKey}:${choice.id}:${spell!.cardNumber}`).toBe(true);
      }
    }
  }

  for (const spell of root.assembled.spells) {
    expect(curatedReferences.has(spell.id), `${root.stableKey}:${spell.card_number}:id`).toBe(true);
    expect(curatedReferences.has(spell.card_number), `${root.stableKey}:${spell.card_number}:card`)
      .toBe(true);
  }
  for (const action of root.rulesActions.filter((candidate) => candidate.kind === 'spell')) {
    expect(
      action.sourceEntityIds.some((sourceId) => curatedReferences.has(sourceId)),
      `${root.stableKey}:${action.id}`,
    ).toBe(true);
  }
}

describe('micro-MVP overlay fail-closed curated spell scope', () => {
  let provider: CompiledMicroMvpL1Provider;
  let policy: MicroMvpSpellScopePolicy;
  let hook: MicroMvpSpellScopeHook;
  let branchRoots: CompiledMicroMvpL1Root[];

  beforeAll(async () => {
    const [compiled, manifest] = await Promise.all([
      compileMicroMvpL1Overlay(),
      readMicroMvpSnapshotManifest(),
    ]);
    provider = compiled;
    policy = buildMicroMvpSpellScopePolicy({
      manifest,
      snapshotSpells: readProdSnapshotCatalogs().spells,
    });
    hook = createMicroMvpSpellScopeHook(policy);

    const cleric = rootByClass(provider, 'CLASS-cleric');
    const druid = rootByClass(provider, 'CLASS-druid');
    const warlock = rootByClass(provider, 'CLASS-warlock');
    branchRoots = await compileMicroMvpL1ChoiceVariants([
      {
        stableKey: cleric.stableKey,
        overrides: { cleric_divine_order: ['thaumaturge'] },
      },
      {
        stableKey: druid.stableKey,
        overrides: { druid_primal_order: ['magician'] },
      },
      {
        stableKey: warlock.stableKey,
        overrides: { warlock_invocation_l1: ['EFF-pact-chain'] },
      },
      {
        stableKey: warlock.stableKey,
        overrides: { warlock_invocation_l1: ['EFF-pact-tome'] },
      },
    ]);
  }, 60_000);

  it('applies the same exact count/class/level/ritual policy to all 16 choices across 448 roots', () => {
    expect(provider.roots).toHaveLength(448);
    expect(policy.spells).toHaveLength(26);
    const observedChoiceIds = new Set<string>();
    for (const root of [...provider.roots, ...branchRoots]) {
      assertRootUsesOnlyCuratedSpells(root, policy, hook, observedChoiceIds);
    }
    expect(observedChoiceIds).toEqual(new Set(
      MICRO_MVP_L1_SPELL_CHOICE_DEFINITIONS.map((definition) => definition.id),
    ));
  });

  it('validates every feature-owned fixed spell grant exactly', () => {
    const allRoots = [...provider.roots, ...branchRoots];
    const observed = new Set<string>();
    for (const root of allRoots) {
      for (const cardNumber of FIXED_GRANT_CARDS) {
        const grants = root.assembled.effects
          .filter((item) => item.effect.card_number === cardNumber)
          .flatMap((item) => directL1SpellGrants(item.effect.mechanics as Dict));
        if (!grants.length) continue;
        observed.add(cardNumber);
        expect(hook.assertFixedGrants(cardNumber, grants), `${root.stableKey}:${cardNumber}`)
          .toHaveLength(1);
      }
    }
    expect(observed).toEqual(new Set(FIXED_GRANT_CARDS));
  });

  it('rejects Wizard Mage Hand and foreign-list Druidcraft overrides at compilation', async () => {
    const wizard = rootByClass(provider, 'CLASS-wizard');
    const valid = policy.choices.wizard_cantrips.spellIds;
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: wizard.stableKey,
      overrides: { wizard_cantrips: ['SPELL-0173', valid[0], valid[1]] },
    })).rejects.toThrow(/SPELL-0173 is outside the curated manifest/);
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: wizard.stableKey,
      overrides: { wizard_cantrips: ['druidcraft', valid[0], valid[1]] },
    })).rejects.toThrow(/druidcraft is not on the wizard spell list/);
  }, 30_000);

  it('persists an exact Wizard prepared subset and rejects a spell outside the selected book', async () => {
    const wizard = rootByClass(provider, 'CLASS-wizard');
    const pool = policy.choices.wizard_spellbook_level_1.spellIds;
    expect(pool.length).toBeGreaterThan(6);
    const spellbook = pool.slice(0, 6);
    const prepared = [spellbook[5], spellbook[1], spellbook[3], spellbook[0]];
    const compiled = await compileMicroMvpL1ChoiceVariant({
      stableKey: wizard.stableKey,
      overrides: {
        wizard_spellbook_level_1: spellbook,
        wizard_prepared_spells_level_1: prepared,
      },
    });
    const preparedChoice = compiled.assembled.pendingChoices.find((choice) => (
      choice.source === 'prepared_spell'
    ))!;
    expect(compiled.draft.resolvedChoices[preparedChoice.id]).toEqual(prepared);
    const source = compiled.actor.spellcastingAccess?.preparedSources['CLASS-wizard'];
    const actionIds = prepared.map((spellId) => compiled.rulesActions.find((action) => (
      action.kind === 'spell'
        && action.sourceEntityIds.includes(spellId)
        && action.spell.sourceClass === 'CLASS-wizard'
    ))?.id);
    expect(actionIds.every(Boolean)).toBe(true);
    expect(source?.preparedActionIds).toEqual([...actionIds].sort());

    const outside = pool.find((spellId) => !spellbook.includes(spellId))!;
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: wizard.stableKey,
      overrides: {
        wizard_spellbook_level_1: spellbook,
        wizard_prepared_spells_level_1: [outside, ...prepared.slice(0, 3)],
      },
    })).rejects.toThrow(/Вариант отсутствует в объявленном домене выбора/);
  }, 30_000);

  it('rejects Magic Initiate Cure Wounds at compilation', async () => {
    const magicInitiate = rootByClass(provider, 'CLASS-wizard', (root) => (
      root.matrixCase.originFeat.card_number === 'FEAT-0009'
    ));
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: magicInitiate.stableKey,
      overrides: { magic_initiate_wizard_level_1: ['SPELL-0214'] },
    })).rejects.toThrow(/SPELL-0214 is not on the wizard spell list/);
  }, 30_000);

  it('rejects non-ritual Pact Tome False Life and Mage Armor at compilation', async () => {
    const warlock = rootByClass(provider, 'CLASS-warlock');
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: warlock.stableKey,
      overrides: {
        warlock_invocation_l1: ['EFF-pact-tome'],
        pact_tome_rituals: ['false_life', 'SPELL-0190'],
      },
    })).rejects.toThrow(/is not a ritual/);
  }, 30_000);
});
