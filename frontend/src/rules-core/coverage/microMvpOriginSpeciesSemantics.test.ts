import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import type { AssembledCharacter } from '../../character/assemble';
import { SKILL_IDS } from '../../character/rules/foundation';
import { resolveCharacterRules } from '../../character/rules/resolveCharacterRules';
import { collectModifiers } from '../../engine/modifiers';
import { longRest } from '../../engine/turn';
import type { CharacterContext } from '../../mvp/contracts';

const ALERT_FEAT_CARD = 'FEAT-0001';
const ALERT_EFFECT_CARD = 'EFF-alert';
const HUMAN_CARD = 'RACE-0002';
const ELF_CARD = 'RACE-0004';

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing origin/species semantic fixture: ${description}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rootsForSpecies(
  provider: CompiledMicroMvpL1Provider,
  cardNumber: string,
): CompiledMicroMvpL1Root[] {
  return provider.roots.filter((root) => root.matrixCase.species.card_number === cardNumber);
}

function decision(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.decisions.find((candidate) => candidate.choiceId.endsWith(`:${suffix}`)),
    `${root.stableKey} decision ${suffix}`,
  );
}

function effect(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.effects.find((candidate) => candidate.effect.card_number === cardNumber),
    `${root.stableKey} effect ${cardNumber}`,
  );
}

function withoutEffect(
  root: CompiledMicroMvpL1Root,
  cardNumber: string,
): AssembledCharacter {
  return {
    ...root.assembled,
    effects: root.assembled.effects.filter((candidate) => (
      candidate.effect.card_number !== cardNumber
    )),
  };
}

describe('compiled micro-MVP origin feat and species semantics', () => {
  let provider: CompiledMicroMvpL1Provider;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for origin/species semantic tests');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 60_000);

  it('executes compiled Alert as Proficiency Bonus on Initiative only with exact feat provenance', () => {
    const alertRoots = provider.roots.filter((root) => (
      root.assembled.feats.some((feat) => feat.card_number === ALERT_FEAT_CARD)
    ));
    expect(alertRoots.length).toBeGreaterThan(0);

    for (const root of alertRoots) {
      const alertFeat = required(
        root.assembled.feats.find((feat) => feat.card_number === ALERT_FEAT_CARD),
        `${root.stableKey} ${ALERT_FEAT_CARD}`,
      );
      const alertEffect = effect(root, ALERT_EFFECT_CARD);
      const alertPassive = required(
        (root.actor.passives ?? []).find((passive) => passive.id === ALERT_EFFECT_CARD),
        `${root.stableKey} Alert passive`,
      );

      expect(alertEffect.origin).toMatchObject({ kind: 'feat', id: alertFeat.id });
      expect(root.actor.capabilities.featureSources?.['alert.initiative_swap']).toEqual([
        alertFeat.id,
        ALERT_FEAT_CARD,
        alertEffect.effect.id,
        ALERT_EFFECT_CARD,
      ]);

      const initiative = collectModifiers(root.actor.runtime, [alertPassive], {
        roll: 'initiative',
        formulaCtx: { profBonus: root.actor.character.profBonus },
      });
      expect(initiative.modifiers).toEqual([{
        value: root.actor.character.profBonus,
        source: 'Бонус мастерства',
      }]);
      expect(root.ruleState.initiativeBonus).toBe(
        root.actor.character.abilityMods.dex + root.actor.character.profBonus,
      );

      for (const roll of ['ability_check', 'attack', 'damage', 'saving_throw']) {
        expect(collectModifiers(root.actor.runtime, [alertPassive], {
          roll,
          formulaCtx: { profBonus: root.actor.character.profBonus },
        }).modifiers).toEqual([]);
      }
    }
  });

  it('executes Human Resourceful after Long Rest and excludes the foreign Elf choice', () => {
    const humanRoots = rootsForSpecies(provider, HUMAN_CARD);
    expect(humanRoots).toHaveLength(112);

    for (const root of humanRoots) {
      const raceEffects = root.assembled.effects.filter(({ origin }) => (
        origin.kind === 'race' && origin.id === root.matrixCase.species.id
      ));
      expect(raceEffects.map(({ effect: raceEffect }) => raceEffect.card_number).sort()).toEqual([
        'RE-human-1',
        'RE-human-2',
        'RE-human-3',
      ]);
      expect(root.assembled.effects.some(({ effect: raceEffect }) => (
        raceEffect.card_number === 'RE-elf-3'
      ))).toBe(false);
      expect(root.actor.runtime.maxResources.heroic_inspiration).toBe(1);
      expect(root.actor.runtime.resources.heroic_inspiration).toBe(1);
      expect(root.actor.passives ?? []).toContainEqual(expect.objectContaining({
        id: 'RE-human-1',
        activation: {
          mode: 'triggered',
          trigger: { event: 'long_rest', timing: 'after' },
        },
      }));
    }

    const human = humanRoots[0];
    const before = copy(human.actor.runtime);
    before.resources.heroic_inspiration = 0;
    const context: CharacterContext & { passives: Record<string, unknown>[] } = {
      ...human.actor.character,
      passives: human.actor.passives ?? [],
    };
    const rested = longRest(before, context);
    expect(rested.state.resources.heroic_inspiration).toBe(1);
    expect(rested.events).toContainEqual({
      type: 'resource_restored',
      resource: 'heroic_inspiration',
      amount: 1,
      current: 1,
    });
    expect(rested.events).toContainEqual(expect.objectContaining({
      type: 'narrative',
      text: 'Сработало: Находчивый',
    }));
  });

  it('resolves every legal Human Skillful branch as one source-owned proficiency', async () => {
    const root = rootsForSpecies(provider, HUMAN_CARD)[0];
    const baseline = resolveCharacterRules({
      draft: root.draft,
      assembled: withoutEffect(root, 'RE-human-2'),
    });
    const legalSkills = SKILL_IDS.filter((skill) => (
      !baseline.proficiencies.skills.includes(skill)
    ));
    expect(legalSkills.length).toBeGreaterThan(0);

    const variants = await compileMicroMvpL1ChoiceVariants(legalSkills.map((skill) => ({
      stableKey: root.stableKey,
      overrides: { human_skill: [skill] },
    })));
    expect(variants).toHaveLength(legalSkills.length);

    for (const [index, variant] of variants.entries()) {
      const skill = legalSkills[index];
      const selected = decision(variant, 'human_skill');
      const choice = required(
        variant.assembled.pendingChoices.find((candidate) => candidate.id === selected.choiceId),
        `${variant.stableKey} Human Skillful pending choice`,
      );
      const rules = resolveCharacterRules({ draft: variant.draft, assembled: variant.assembled });
      const grants = rules.appliedGrants.filter((grant) => grant.choiceId === selected.choiceId);

      expect(choice).toMatchObject({ count: 1, source: 'skill', filter: 'all' });
      expect(selected).toMatchObject({
        optionIds: [skill],
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        kind: 'skill',
        value: skill,
        mode: 'proficiency',
        source: { type: 'species' },
      });
      expect(grants[0].source.id).toContain(variant.matrixCase.species.id);
      expect(grants[0].source.id).toContain(effect(variant, 'RE-human-2').effect.id);
      expect(rules.proficiencies.skills).toContain(skill);
    }
  }, 60_000);

  it('projects Elf Darkvision and Fey Ancestry and resolves every Keen Senses branch', async () => {
    const elfRoots = rootsForSpecies(provider, ELF_CARD);
    expect(elfRoots).toHaveLength(112);

    for (const root of elfRoots) {
      expect(root.assembled.race?.darkvision).toBe(60);
      const darkvision = required(
        root.ruleState.senses.find((sense) => sense.sense === 'darkvision'),
        `${root.stableKey} projected Darkvision`,
      );
      expect(darkvision.range).toBeGreaterThanOrEqual(60);
      expect(effect(root, 'EFF-darkvision-60').origin).toMatchObject({
        kind: 'race', id: root.matrixCase.species.id,
      });
      expect(effect(root, 'RE-elf-2').origin).toMatchObject({
        kind: 'race', id: root.matrixCase.species.id,
      });
      expect(effect(root, 'RE-elf-3').origin).toMatchObject({
        kind: 'race', id: root.matrixCase.species.id,
      });
    }

    const root = elfRoots.find((candidate) => {
      const selected = decision(candidate, 'elf_skill').optionIds[0];
      return ['insight', 'perception', 'survival'].filter((skill) => (
        candidate.ruleState.proficiencies.skills.includes(skill)
      )).every((skill) => skill === selected);
    });
    const base = required(root, 'Elf root without a pre-existing Keen Senses proficiency');
    const feyPassive = required(
      (base.actor.passives ?? []).find((passive) => passive.id === 'RE-elf-2'),
      `${base.stableKey} Fey Ancestry passive`,
    );
    const feyContext = {
      character: base.actor.character,
      state: base.actor.runtime,
      savedConditions: new Set(['charmed']),
    };
    expect(collectModifiers(base.actor.runtime, [feyPassive], {
      roll: 'saving_throw', evalCtx: feyContext,
    }).advantage).toBe('advantage');
    expect(collectModifiers(base.actor.runtime, [feyPassive], {
      roll: 'saving_throw',
      evalCtx: { ...feyContext, savedConditions: new Set(['poisoned']) },
    }).advantage).toBe('none');
    expect(collectModifiers(base.actor.runtime, [feyPassive], {
      roll: 'ability_check', evalCtx: feyContext,
    }).advantage).toBe('none');

    const keenSenses = ['insight', 'perception', 'survival'] as const;
    const variants = await compileMicroMvpL1ChoiceVariants(keenSenses.map((skill) => ({
      stableKey: base.stableKey,
      overrides: { elf_skill: [skill] },
    })));
    for (const [index, variant] of variants.entries()) {
      const skill = keenSenses[index];
      const selected = decision(variant, 'elf_skill');
      const choice = required(
        variant.assembled.pendingChoices.find((candidate) => candidate.id === selected.choiceId),
        `${variant.stableKey} Elf Keen Senses pending choice`,
      );
      const rules = resolveCharacterRules({ draft: variant.draft, assembled: variant.assembled });
      const grants = rules.appliedGrants.filter((grant) => grant.choiceId === selected.choiceId);

      expect(choice).toMatchObject({
        count: 1,
        source: 'skill',
        filter: ['insight', 'perception', 'survival'],
      });
      expect(selected).toMatchObject({ optionIds: [skill], stage: 'creation' });
      expect(grants).toHaveLength(1);
      expect(grants[0]).toMatchObject({
        kind: 'skill', value: skill, mode: 'proficiency', source: { type: 'species' },
      });
      expect(grants[0].source.id).toContain(variant.matrixCase.species.id);
      expect(grants[0].source.id).toContain(effect(variant, 'RE-elf-3').effect.id);
      expect(rules.proficiencies.skills).toContain(skill);
    }
  }, 60_000);
});
