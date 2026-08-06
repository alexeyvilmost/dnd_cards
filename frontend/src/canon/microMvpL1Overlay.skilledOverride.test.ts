import { beforeAll, describe, expect, it } from 'vitest';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Root,
} from './microMvpL1Overlay';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function skilledChoice(root: CompiledMicroMvpL1Root) {
  const choice = root.assembled.pendingChoices.find((candidate) => (
    candidate.id.endsWith(':feat_skilled')
  ));
  if (!choice) throw new Error(`Missing Skilled choice in ${root.stableKey}`);
  return choice;
}

describe('micro-MVP explicit Skilled override replacement', () => {
  let root: CompiledMicroMvpL1Root;
  let eligible: string[];
  let alreadyKnown: string[];

  beforeAll(async () => {
    const provider = await compileMicroMvpL1Overlay();
    const regressionSelection = new Set(['skill:arcana', 'tool:smith', 'tool:thieves_tools']);
    root = provider.roots.filter((candidate) => (
      candidate.matrixCase.originFeat.card_number === 'FEAT-0008'
    )).find((candidate) => {
      const candidateChoice = skilledChoice(candidate);
      const candidateDraft = clone(candidate.draft);
      delete candidateDraft.resolvedChoices[candidateChoice.id];
      const before = resolveCharacterRules({ draft: candidateDraft, assembled: candidate.assembled });
      return [...regressionSelection].every((id) => {
        const [kind, value] = id.split(':', 2);
        return kind === 'skill'
          ? !before.proficiencies.skills.includes(value)
          : !before.proficiencies.tools.includes(value);
      });
    })!;
    if (!root) throw new Error('Missing Skilled root eligible for the mixed regression selection');
    const choice = skilledChoice(root);
    const draftBeforeSkilled = clone(root.draft);
    delete draftBeforeSkilled.resolvedChoices[choice.id];
    const rulesBeforeSkilled = resolveCharacterRules({
      draft: draftBeforeSkilled,
      assembled: root.assembled,
    });
    const knownSkills = new Set(rulesBeforeSkilled.proficiencies.skills);
    const knownTools = new Set(rulesBeforeSkilled.proficiencies.tools);
    const itemIds = (choice.items ?? []).map((item) => item.id);
    const isKnown = (id: string) => {
      const [kind, value] = id.split(':', 2);
      return kind === 'skill' ? knownSkills.has(value) : kind === 'tool' && knownTools.has(value);
    };
    eligible = itemIds.filter((id) => !isKnown(id));
    alreadyKnown = itemIds.filter(isKnown);
  }, 60_000);

  it('atomically replaces the default with every eligible PHB skill/tool option', async () => {
    const choice = skilledChoice(root);
    expect(choice.items).toHaveLength(55);
    expect(eligible.length).toBeGreaterThanOrEqual(3);
    const selections = eligible.map((candidate) => [
      candidate,
      ...eligible.filter((option) => option !== candidate).slice(0, 2),
    ]);
    const variants = await compileMicroMvpL1ChoiceVariants(selections.map((selection) => ({
      stableKey: root.stableKey,
      overrides: { feat_skilled: selection },
    })));
    expect(variants).toHaveLength(eligible.length);

    variants.forEach((variant, index) => {
      const variantChoice = skilledChoice(variant);
      const selection = selections[index];
      expect(variant.draft.resolvedChoices[variantChoice.id]).toEqual(selection);
      expect(variant.decisions).toContainEqual(expect.objectContaining({
        choiceId: variantChoice.id,
        optionIds: selection,
        provenance: 'overlay-policy',
      }));
      const rules = resolveCharacterRules({ draft: variant.draft, assembled: variant.assembled });
      const grants = rules.appliedGrants.filter((grant) => grant.choiceId === variantChoice.id);
      expect(grants).toHaveLength(3);
      expect(grants.map((grant) => `${grant.kind}:${grant.value}`)).toEqual(selection);
    });
  }, 60_000);

  it('accepts the reported mixed regression case without retaining old default grants', async () => {
    const selection = ['skill:arcana', 'tool:smith', 'tool:thieves_tools'];
    expect(selection.every((option) => eligible.includes(option))).toBe(true);
    const variant = await compileMicroMvpL1ChoiceVariant({
      stableKey: root.stableKey,
      overrides: { feat_skilled: selection },
    });
    const choice = skilledChoice(variant);
    expect(variant.draft.resolvedChoices[choice.id]).toEqual(selection);
    const rules = resolveCharacterRules({ draft: variant.draft, assembled: variant.assembled });
    const grants = rules.appliedGrants.filter((grant) => grant.choiceId === choice.id);
    expect(grants.map((grant) => `${grant.kind}:${grant.value}`)).toEqual(selection);
  });

  it('still rejects duplicate and genuinely pre-existing proficiencies', async () => {
    expect(alreadyKnown.length).toBeGreaterThan(0);
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: root.stableKey,
      overrides: { feat_skilled: [eligible[0], eligible[0], eligible[1]] },
    })).rejects.toThrow('override must contain exactly 3 distinct option IDs');
    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: root.stableKey,
      overrides: { feat_skilled: [alreadyKnown[0], eligible[0], eligible[1]] },
    })).rejects.toThrow('Уже получено');
  });
});
