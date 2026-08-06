import cards from '../../../../officials/canon/prod-snapshot/cards.json';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
} from '../../canon/microMvpL1Overlay';
import type {
  CompiledMicroMvpL1Provider,
  CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  readProdSnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import type { SnapshotCatalogs } from '../../canon/prodSnapshotL1Fixtures';
import type { AssembledCharacter } from '../../character/assemble';
import { buildSavePayload } from '../../character/forgeHelpers';
import { EQUIPMENT_OPTION_KEY } from '../../character/pointBuy';
import { resolveCharacterRules } from '../../character/rules/resolveCharacterRules';
import { armorClassValue } from '../../engine/ac';
import { applyFreeuseCost, freeuseKey } from '../../engine/freeuse';
import { payloadsOf } from '../../engine/mechanicsView';
import { collectModifiers } from '../../engine/modifiers';
import { longRest } from '../../engine/turn';
import type { RuntimeState } from '../../mvp/contracts';
import { createLogicalClock, createSequentialIdFactory } from '../determinism';
import { createWorld, type ActorState, type RulesCatalog } from '../domain';
import { InMemoryRulesSession } from '../session';
import {
  MICRO_MVP_FIGHTING_STYLE_ENTITIES,
  PROTECTION_REACTION_CAPABILITY,
  protectionReactionEligibility,
} from '../testing/fightingStyleFixtures';
import type { Background, Card } from '../../types';

type JsonObject = Record<string, unknown>;

const FIGHTER_CARD = 'CLASS-warrior';
const DWARF_CARD = 'RACE-0003';
const TOUGH_CARD = 'FEAT-0005';
const SKILLED_CARD = 'FEAT-0008';
const MAGIC_INITIATE_CARD = 'FEAT-0009';

const BACKGROUND_EXPECTATIONS = [
  {
    entityKey: 'background.soldier',
    cardNumber: 'BG-0012',
    officialFeatCardNumber: 'FEAT-0004',
    abilityScores: ['str', 'dex', 'con'],
    abilityAssignments: { str: 2, dex: 1 },
    skills: ['athletics', 'intimidation'],
    tool: 'Выберите один вид Игрового набора',
    equipment: {
      gold: 14,
      items: [
        { card_id: '12b175a4-cbc3-42bd-9d8d-50193a112389', quantity: 1 },
        { card_id: '3d68bd64-50ca-4f7a-b5a9-c79a911b2475', quantity: 1 },
        { card_id: '59b10a1e-8669-4bf6-88a5-69d0abfc76a6', quantity: 20 },
        { card_id: '148bffd3-d797-47a5-b66c-c7d3d04e9c00', quantity: 1 },
        { card_id: 'c70618ac-be64-42fe-b338-b6669d1ecf2a', quantity: 1 },
        { card_id: '6112aaef-39b3-4b91-a0fa-96f56987ebb2', quantity: 1 },
        { card_id: 'bbc804a1-3a7e-4b09-88c7-21d863ea2d85', quantity: 1 },
      ],
    },
  },
  {
    entityKey: 'background.sage',
    cardNumber: 'BG-0005',
    officialFeatCardNumber: 'FEAT-0009',
    abilityScores: ['con', 'int', 'wis'],
    abilityAssignments: { con: 2, int: 1 },
    skills: ['history', 'arcana'],
    tool: 'Инструменты каллиграфа',
    equipment: {
      gold: 8,
      items: [
        { card_id: '416ce3b6-193e-4186-a481-09375444c090', quantity: 1 },
        { card_id: '69e3364b-e5e9-4a28-92fe-f419d88648bd', quantity: 1 },
        { card_id: '67a7e163-8723-4296-a8cd-67f3e7c4f852', quantity: 1 },
        { card_id: 'c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', quantity: 8 },
        { card_id: '40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', quantity: 1 },
      ],
    },
  },
  {
    entityKey: 'background.criminal',
    cardNumber: 'BG-0008',
    officialFeatCardNumber: 'FEAT-0001',
    abilityScores: ['dex', 'con', 'int'],
    abilityAssignments: { dex: 2, con: 1 },
    skills: ['sleight_of_hand', 'stealth'],
    tool: 'Воровские инструменты',
    equipment: {
      gold: 16,
      items: [
        { card_id: 'db5d576b-3ae1-4402-b4dc-8f7ec7d88b29', quantity: 2 },
        { card_id: '2be96522-100a-46f4-ba35-6e98cb10186c', quantity: 1 },
        { card_id: '75873843-f449-4f2f-8237-3d8dac21ec85', quantity: 1 },
        { card_id: 'fdd3770f-0eda-446d-bd78-5944f4d95d9d', quantity: 2 },
        { card_id: 'bbc804a1-3a7e-4b09-88c7-21d863ea2d85', quantity: 1 },
      ],
    },
  },
  {
    entityKey: 'background.acolyte',
    cardNumber: 'BG-0009',
    officialFeatCardNumber: 'FEAT-0077',
    abilityScores: ['int', 'wis', 'cha'],
    abilityAssignments: { int: 2, wis: 1 },
    skills: ['insight', 'religion'],
    tool: 'Инструменты каллиграфа',
    equipment: {
      gold: 8,
      items: [
        { card_id: '69e3364b-e5e9-4a28-92fe-f419d88648bd', quantity: 1 },
        { card_id: 'c569802e-b19b-4a50-be1d-63bc9718d95e', quantity: 1 },
        { card_id: 'dfca725c-d14b-4f6f-afa7-4d778e764aa0', quantity: 1 },
        { card_id: 'c10d9a5f-f5b3-44d3-9c62-6bdc4ef90dc4', quantity: 10 },
        { card_id: '40fc2ff7-f2d9-424b-a2c6-7819ddd7b3a5', quantity: 1 },
      ],
    },
  },
] as const;

const FIGHTING_STYLE_EXPECTATIONS = [
  { entityKey: 'fighting-style.archery', featCard: 'FEAT-0063', effectCard: 'fs_archery' },
  { entityKey: 'fighting-style.defense', featCard: 'FEAT-0056', effectCard: 'fs_defense' },
  {
    entityKey: 'fighting-style.two-weapon-fighting',
    featCard: 'FEAT-0061',
    effectCard: 'fs_two_weapon',
  },
  { entityKey: 'fighting-style.protection', featCard: 'FEAT-0055', effectCard: 'fs_protection' },
] as const;

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Missing semantic fixture: ${description}`);
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function rootFor(
  provider: CompiledMicroMvpL1Provider,
  backgroundCard: string,
  originFeatCard: string,
): CompiledMicroMvpL1Root {
  return required(provider.roots.find((root) => (
    root.matrixCase.klass.card_number === FIGHTER_CARD
      && root.matrixCase.species.card_number === DWARF_CARD
      && root.matrixCase.background.card_number === backgroundCard
      && root.matrixCase.originFeat.card_number === originFeatCard
  )), `${FIGHTER_CARD}/${DWARF_CARD}/${backgroundCard}/${originFeatCard}`);
}

function choiceDecision(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.decisions.find((decision) => decision.choiceId.endsWith(`:${suffix}`)),
    `${root.stableKey} decision ${suffix}`,
  );
}

function pendingChoice(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.assembled.pendingChoices.find((choice) => choice.id.endsWith(`:${suffix}`)),
    `${root.stableKey} pending choice ${suffix}`,
  );
}

function effectFor(root: CompiledMicroMvpL1Root, cardNumber: string) {
  return required(
    root.assembled.effects.find(({ effect }) => effect.card_number === cardNumber),
    `${root.stableKey} effect ${cardNumber}`,
  );
}

function styleVariant(
  variants: ReadonlyMap<string, CompiledMicroMvpL1Root>,
  featCard: string,
): CompiledMicroMvpL1Root {
  return required(variants.get(featCard), `Fighting Style variant ${featCard}`);
}

function runtimeWithHp(source: RuntimeState, hp = 30): RuntimeState {
  const next = cloneJson(source);
  next.hp = { current: hp, max: hp, temp: 0 };
  return next;
}

function actorPassives(root: CompiledMicroMvpL1Root): JsonObject[] {
  return root.actor.passives ?? [];
}

function stylePayloads(root: CompiledMicroMvpL1Root, effectCard: string): JsonObject[] {
  return payloadsOf(effectFor(root, effectCard).effect.mechanics as JsonObject);
}

describe('micro-MVP entity semantics from pinned compiled builds', () => {
  let provider: CompiledMicroMvpL1Provider;
  let catalogs: SnapshotCatalogs;
  let backgroundRoots: ReadonlyMap<string, CompiledMicroMvpL1Root>;
  let magicInitiateRoot: CompiledMicroMvpL1Root;
  let skilledRoot: CompiledMicroMvpL1Root;
  let toughRoot: CompiledMicroMvpL1Root;
  let fightingStyleVariants: ReadonlyMap<string, CompiledMicroMvpL1Root>;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for micro-MVP entity semantics');
    };
    try {
      provider = await compileMicroMvpL1Overlay();
      catalogs = readProdSnapshotCatalogs();
      backgroundRoots = new Map(BACKGROUND_EXPECTATIONS.map((expectation) => [
        expectation.cardNumber,
        rootFor(provider, expectation.cardNumber, TOUGH_CARD),
      ]));
      magicInitiateRoot = rootFor(provider, 'BG-0012', MAGIC_INITIATE_CARD);
      skilledRoot = rootFor(provider, 'BG-0012', SKILLED_CARD);
      toughRoot = rootFor(provider, 'BG-0012', TOUGH_CARD);

      const styleBase = toughRoot.stableKey;
      const styles = FIGHTING_STYLE_EXPECTATIONS.map((expectation) => ({
        expectation,
        feat: required(
          catalogs.feats.find((feat) => feat.card_number === expectation.featCard),
          expectation.featCard,
        ),
      }));
      const variants = await compileMicroMvpL1ChoiceVariants(styles.map(({ feat }) => ({
        stableKey: styleBase,
        overrides: { fighter_fighting_style: [feat.id] },
      })));
      fightingStyleVariants = new Map(styles.map(({ expectation }, index) => [
        expectation.featCard,
        variants[index],
      ]));
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 30_000);

  it('materializes Soldier, Sage, Criminal, and Acolyte stable grants while replacing each official Origin feat', () => {
    const selectedTough = required(
      catalogs.feats.find((feat) => feat.card_number === TOUGH_CARD),
      TOUGH_CARD,
    );

    for (const expectation of BACKGROUND_EXPECTATIONS) {
      const root = required(backgroundRoots.get(expectation.cardNumber), expectation.cardNumber);
      const background = root.matrixCase.background as Background;
      const rules = resolveCharacterRules({ draft: root.draft, assembled: root.assembled });
      const sourceRoot = required(
        provider.source.getFixture(root.sourceFixtureId),
        root.sourceFixtureId,
      );
      const officialFeat = required(
        catalogs.feats.find((feat) => feat.card_number === expectation.officialFeatCardNumber),
        expectation.officialFeatCardNumber,
      );

      expect(root.stableKey).toContain(expectation.entityKey);
      expect(background).toMatchObject({
        card_number: expectation.cardNumber,
        ability_scores: expectation.abilityScores,
        skill_proficiencies: expectation.skills,
        tool_proficiency: expectation.tool,
      });
      expect(root.draft.abilityBonuses).toEqual({
        mode: 'two_one',
        assignments: expectation.abilityAssignments,
        anyAbilities: false,
      });
      for (const [ability, bonus] of Object.entries(expectation.abilityAssignments)) {
        const recommendedAbilities = (
          root.matrixCase.klass as unknown as { recommended_abilities?: Record<string, number> }
        ).recommended_abilities ?? {};
        const recommended = Number(
          recommendedAbilities[ability] ?? 10,
        );
        expect(root.draft.abilities[ability as keyof typeof root.draft.abilities]).toBe(
          recommended + bonus,
        );
      }

      expect(rules.proficiencies.skills).toEqual(
        expect.arrayContaining([...expectation.skills]),
      );
      expect(rules.proficiencies.tools).toContain(expectation.tool);
      const backgroundGrants = rules.appliedGrants
        .filter((grant) => grant.source.type === 'background')
        .map((grant) => ({
          sourceId: grant.source.id,
          kind: grant.kind,
          value: grant.value,
          mode: grant.mode,
        }));
      expect(backgroundGrants).toEqual([
        ...expectation.skills.map((skill) => ({
          sourceId: background.id,
          kind: 'skill',
          value: skill,
          mode: 'proficiency',
        })),
        {
          sourceId: background.id,
          kind: 'tool',
          value: expectation.tool,
          mode: 'proficiency',
        },
      ]);

      expect(root.draft.equipmentOption).toBe('a');
      expect(background.equipment_options?.option_a).toEqual(expectation.equipment);
      expect(background.equipment_options?.option_b).toEqual({ items: [], gold: 50 });
      const savePayload = buildSavePayload(root.draft, root.assembled, rules);
      expect(savePayload.resolved_choices?.[EQUIPMENT_OPTION_KEY]).toEqual(['a']);
      expect(savePayload.tool_proficiencies).toContain(expectation.tool);

      expect(sourceRoot.originFeatAudit).toEqual({
        productRuleId: 'free_origin_feat_choice_v1',
        selectedOriginFeatId: selectedTough.id,
        suppressedOfficialBackgroundFeatId: officialFeat.id,
        grants: [{
          entityId: selectedTough.id,
          sourceType: 'product_rule',
          sourceId: 'free_origin_feat_choice_v1',
        }],
      });
      expect(root.draft.swapFeat).toBe(true);
      expect(root.assembled.feats.filter((feat) => feat.category === 'origin').map((feat) => feat.id))
        .toEqual([selectedTough.id]);
      expect(root.assembled.feats.some((feat) => feat.id === officialFeat.id)).toBe(false);
    }
  });

  it('resolves the pinned Magic Initiate spells with feat provenance and exercises free-use and slot-paid casts', () => {
    const cantripDecision = choiceDecision(
      magicInitiateRoot,
      'magic_initiate_wizard_cantrips',
    );
    const leveledDecision = choiceDecision(
      magicInitiateRoot,
      'magic_initiate_wizard_level_1',
    );
    const selectedIds = [...cantripDecision.optionIds, ...leveledDecision.optionIds];
    const selectedSpells = selectedIds.map((id) => required(
      catalogs.spells.find((spell) => spell.id === id),
      `Magic Initiate spell ${id}`,
    ));

    expect(cantripDecision).toMatchObject({
      optionIds: expect.arrayContaining(cantripDecision.optionIds),
      stage: 'creation',
      provenance: 'overlay-policy',
    });
    expect(cantripDecision.optionIds).toHaveLength(2);
    expect(new Set(cantripDecision.optionIds).size).toBe(2);
    expect(leveledDecision).toMatchObject({
      optionIds: [expect.any(String)],
      stage: 'creation',
      provenance: 'overlay-policy',
    });
    expect(selectedSpells.map((spell) => spell.card_number)).toEqual([
      'fire_bolt',
      'minor_illusion',
      'SPELL-0174',
    ]);
    expect(selectedSpells.slice(0, 2).every((spell) => (
      spell.level === 0 && (spell.classes ?? []).includes('волшебник')
    ))).toBe(true);
    expect(selectedSpells[2].level).toBe(1);
    expect(selectedSpells[2].classes ?? []).toContain('волшебник');

    const feat = magicInitiateRoot.matrixCase.originFeat;
    const sourceEffect = effectFor(magicInitiateRoot, 'magic_initiate_wizard');
    expect(sourceEffect.origin).toMatchObject({ kind: 'feat', id: feat.id });
    const rules = resolveCharacterRules({
      draft: magicInitiateRoot.draft,
      assembled: magicInitiateRoot.assembled,
    });
    const spellGrants = rules.appliedGrants.filter((grant) => (
      grant.source.type === 'feat' && grant.kind === 'spell'
    ));
    expect(spellGrants.map((grant) => grant.value)).toEqual(selectedIds);
    expect(spellGrants.every((grant) => grant.source.id.includes(feat.id))).toBe(true);
    expect(spellGrants.map((grant) => grant.choiceId)).toEqual([
      cantripDecision.choiceId,
      cantripDecision.choiceId,
      leveledDecision.choiceId,
    ]);
    expect(rules.spells.cantrips).toEqual(cantripDecision.optionIds);
    expect(rules.spells.leveled).toEqual(leveledDecision.optionIds);
    expect(rules.freeuseSpells).toEqual([{
      spell: leveledDecision.optionIds[0],
      count: 1,
      recharge: 'long_rest',
    }]);

    const levelOneSpell = selectedSpells[2];
    const spellAction = required(magicInitiateRoot.rulesActions.find((action) => (
      action.kind === 'spell' && action.sourceEntityIds.includes(levelOneSpell.id)
    )), 'compiled Magic Initiate level-1 action');
    const poolKey = freeuseKey(levelOneSpell.id);
    expect(magicInitiateRoot.actor.runtime.maxResources[poolKey]).toBe(1);

    // Cost projection remains a pure data transform, but the spell itself is a
    // world primitive and must execute through rules-core rather than a direct
    // legacy executeAction call.
    const freeMechanics = applyFreeuseCost(spellAction.mechanics, poolKey);
    expect(((freeMechanics.activation as JsonObject).cost as JsonObject[])).toEqual([
      { resource: 'action' }, { resource: poolKey, amount: 1 },
    ]);
    const grant = required(magicInitiateRoot.actor.spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === spellAction.id && candidate.freeUseResource === poolKey
    )), 'compiled Magic Initiate spell grant');
    const primitive = spellAction.mechanics.primitive as JsonObject;
    const primitivePolicy = primitive.policy as JsonObject;
    const allocationChoiceId = required(
      typeof primitivePolicy.allocation_choice_id === 'string'
        ? primitivePolicy.allocation_choice_id
        : undefined,
      'Magic Missile allocation choice id',
    );
    const ruleset = {
      systemId: 'dnd5e-2024' as const,
      releaseId: 'compiled-magic-initiate-semantics@1',
      contentHash: 'sha256:compiled-magic-initiate-semantics',
      errataVersion: 'PHB-2024',
    };
    const catalog: RulesCatalog = {
      getAction: (id) => magicInitiateRoot.rulesActions.find((candidate) => candidate.id === id),
    };
    const cast = (input: {
      id: string;
      runtime: RuntimeState;
      preferFreeUse?: boolean;
    }) => {
      const caster: ActorState = {
        ...cloneJson(magicInitiateRoot.actor),
        runtime: cloneJson(input.runtime),
      };
      const target: ActorState = {
        ...cloneJson(magicInitiateRoot.actor),
        id: `${input.id}:target`,
        name: `${input.id}:target`,
        controllerId: `${input.id}:target-controller`,
        capabilities: { actionIds: [] },
        runtime: runtimeWithHp(magicInitiateRoot.actor.runtime),
        spellcastingAccess: undefined,
      };
      const session = new InMemoryRulesSession(
        createWorld({ id: input.id, ruleset, actors: [caster, target] }),
        catalog,
        {
          rng: () => 0,
          clock: createLogicalClock(),
          nextId: createSequentialIdFactory(`${input.id}:id`),
        },
      );
      const result = session.dispatch({
        schemaVersion: 1,
        type: 'UseAction',
        commandId: `${input.id}:cast`,
        expectedRevision: 0,
        rulesetContentHash: ruleset.contentHash,
        actorId: caster.id,
        actionId: spellAction.id,
        targetIds: [target.id],
        factsByTarget: {
          [target.id]: {
            factsSource: 'scenario', boardRevision: 1, distanceFt: 30,
            lineOfSight: true, cover: 'none', relation: 'enemy',
          },
        },
        choices: { [allocationChoiceId]: [target.id, target.id, target.id] },
        spell: {
          baseLevel: 1,
          castLevel: 1,
          grantId: grant.grantId,
          ...(input.preferFreeUse === undefined ? {} : { preferFreeUse: input.preferFreeUse }),
        },
      });
      return { result, session, casterId: caster.id, targetId: target.id };
    };

    const freeRuntime = runtimeWithHp(magicInitiateRoot.actor.runtime);
    const free = cast({ id: 'magic-initiate-free', runtime: freeRuntime });
    expect(free.result.status).toBe('accepted');
    expect(free.session.getState().actors[free.casterId].runtime.resources).toMatchObject({
      action: 0, [poolKey]: 0,
    });
    expect(free.session.getState().actors[free.casterId].runtime.resources.spell_slot_1).toBeUndefined();
    expect(free.session.getState().actors[free.targetId].runtime.hp.current).toBe(24);
    const restored = longRest(
      free.session.getState().actors[free.casterId].runtime,
      free.session.getState().actors[free.casterId].character,
    );
    expect(restored.state.resources[poolKey]).toBe(1);

    const slotRuntime = runtimeWithHp(magicInitiateRoot.actor.runtime);
    slotRuntime.resources.spell_slot_1 = 1;
    slotRuntime.maxResources.spell_slot_1 = 1;
    const slot = cast({ id: 'magic-initiate-slot', runtime: slotRuntime, preferFreeUse: false });
    expect(slot.result.status).toBe('accepted');
    expect(slot.session.getState().actors[slot.casterId].runtime.resources).toMatchObject({
      action: 0, spell_slot_1: 0, [poolKey]: 1,
    });
    expect(slot.session.getState().actors[slot.targetId].runtime.hp.current).toBe(24);

    const depleted = runtimeWithHp(magicInitiateRoot.actor.runtime);
    depleted.resources[poolKey] = 0;
    expect(cast({ id: 'magic-initiate-depleted', runtime: depleted }).result).toMatchObject({
      status: 'rejected', code: 'InsufficientResources',
    });
  });

  it('persists every Magic Initiate spellcasting-ability branch and scopes its spell grants to the feat', async () => {
    const effect = effectFor(magicInitiateRoot, 'magic_initiate_wizard').effect;
    const records: JsonObject[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as JsonObject;
      records.push(record);
      Object.values(record).forEach(visit);
    };
    visit(effect.mechanics);

    expect(records).toContainEqual(expect.objectContaining({
      kind: 'choice',
      id: 'magic_initiate_spellcasting_ability',
      count: 1,
      options: expect.objectContaining({
        source: 'ability',
        items: [
          { id: 'int', name: 'INT' },
          { id: 'wis', name: 'WIS' },
          { id: 'cha', name: 'CHA' },
        ],
      }),
    }));
    expect(magicInitiateRoot.actor.character.spellcastingAbility).toBeUndefined();
    expect(magicInitiateRoot.actor.character.spellcastingMod).toBeUndefined();

    const variants = await compileMicroMvpL1ChoiceVariants(
      (['int', 'wis', 'cha'] as const).map((ability) => ({
        stableKey: magicInitiateRoot.stableKey,
        overrides: { magic_initiate_spellcasting_ability: [ability] },
      })),
    );
    for (const [index, root] of variants.entries()) {
      const ability = (['int', 'wis', 'cha'] as const)[index];
      expect(choiceDecision(root, 'magic_initiate_spellcasting_ability')).toMatchObject({
        optionIds: [ability], stage: 'creation', provenance: 'overlay-policy',
      });
      const selectedSpellIds = new Set([
        ...choiceDecision(root, 'magic_initiate_wizard_cantrips').optionIds,
        ...choiceDecision(root, 'magic_initiate_wizard_level_1').optionIds,
      ]);
      const featActions = root.rulesActions.filter((candidate) => (
        candidate.kind === 'spell'
          && candidate.sourceEntityIds.some((id) => selectedSpellIds.has(id))
          && candidate.sourceEntityIds.includes(root.matrixCase.originFeat.id)
      ));
      expect(featActions).toHaveLength(3);
      expect(featActions.every((action) => action.sourceEntityIds.includes(effect.id))).toBe(true);
      const featGrants = root.actor.spellcastingAccess?.grants.filter((grant) => (
        grant.sourceId === MAGIC_INITIATE_CARD
      ));
      expect(featGrants).toHaveLength(3);
      expect(featGrants?.every((grant) => grant.spellcastingAbility === ability)).toBe(true);
      expect(new Set(featGrants?.map((grant) => grant.actionId))).toEqual(
        new Set(featActions.map((action) => action.id)),
      );
    }
  });

  it('resolves Skilled as three distinct pinned choice grants with exact feat provenance', async () => {
    const decision = choiceDecision(skilledRoot, 'feat_skilled');
    const choice = pendingChoice(skilledRoot, 'feat_skilled');
    const effect = effectFor(skilledRoot, 'EFF-skilled');
    const rules = resolveCharacterRules({ draft: skilledRoot.draft, assembled: skilledRoot.assembled });
    const baselineRules = resolveCharacterRules({ draft: toughRoot.draft, assembled: toughRoot.assembled });
    const selected = [...decision.optionIds];

    expect(decision).toMatchObject({ stage: 'creation', provenance: 'overlay-policy' });
    expect(selected).toHaveLength(3);
    expect(new Set(selected).size).toBe(3);
    expect(choice.count).toBe(3);
    expect(effect.origin).toMatchObject({
      kind: 'feat',
      id: skilledRoot.matrixCase.originFeat.id,
    });

    const grants = rules.appliedGrants.filter((grant) => grant.choiceId === decision.choiceId);
    const selectedValues = selected.map((value) => value.replace(/^skill:/, ''));
    expect(selected.every((value) => value.startsWith('skill:'))).toBe(true);
    expect(grants.map((grant) => grant.value)).toEqual(selectedValues);
    expect(grants.every((grant) => (
      grant.kind === 'skill'
        && grant.mode === 'proficiency'
        && grant.source.type === 'feat'
        && grant.source.id.includes(skilledRoot.matrixCase.originFeat.id)
    ))).toBe(true);
    expect(rules.proficiencies.skills).toEqual(expect.arrayContaining(selectedValues));
    expect(rules.proficiencies.skills.filter((skill) => (
      !baselineRules.proficiencies.skills.includes(skill)
    ))).toEqual(selectedValues);

    await expect(compileMicroMvpL1ChoiceVariant({
      stableKey: skilledRoot.stableKey,
      overrides: { feat_skilled: [selected[0], selected[0], selected[0]] },
    })).rejects.toThrow('override must contain exactly 3 distinct option IDs');
  }, 30_000);

  it('allows Skilled to mix any three distinct PHB skills and tool variants', async () => {
    const choice = pendingChoice(skilledRoot, 'feat_skilled');
    const effect = effectFor(skilledRoot, 'EFF-skilled').effect;
    const options = choice.options as JsonObject | undefined;
    const mechanics = effect.mechanics as JsonObject;
    const rawChoices = (mechanics.effects as JsonObject[] | undefined) ?? [];
    const rawChoice = required(
      rawChoices.find((entry) => entry.kind === 'choice' && entry.id === 'feat_skilled'),
      'EFF-skilled choice feat_skilled',
    );

    expect(choice.source).toBe('explicit');
    expect(choice.grantKind).toBe('grant_proficiency');
    expect(options).toMatchObject({ source: 'explicit' });
    const items = options?.items as JsonObject[];
    expect(items).toHaveLength(55);
    expect(items.filter((item) => String(item.id).startsWith('skill:'))).toHaveLength(18);
    expect(items.filter((item) => String(item.id).startsWith('tool:'))).toHaveLength(37);
    expect(rawChoice.grant).toEqual({ kind: 'grant_proficiency' });

    const selections = ['skill:arcana', 'tool:smith', 'tool:thieves_tools'];
    const variant = await compileMicroMvpL1ChoiceVariant({
      stableKey: skilledRoot.stableKey,
      overrides: { feat_skilled: selections },
    });
    expect(choiceDecision(variant, 'feat_skilled').optionIds).toEqual(selections);
    const rules = resolveCharacterRules({ draft: variant.draft, assembled: variant.assembled });
    const grants = rules.appliedGrants.filter((entry) => (
      entry.choiceId === choiceDecision(variant, 'feat_skilled').choiceId
    ));
    expect(grants.map(({ kind, value, mode }) => ({ kind, value, mode }))).toEqual([
      { kind: 'skill', value: 'arcana', mode: 'proficiency' },
      { kind: 'tool', value: 'smith', mode: 'proficiency' },
      { kind: 'tool', value: 'thieves_tools', mode: 'proficiency' },
    ]);
    expect(rules.proficiencies.skills).toContain('arcana');
    expect(rules.proficiencies.tools).toEqual(expect.arrayContaining(['smith', 'thieves_tools']));
  }, 30_000);

  it('rebuilds Tough maximum HP as exactly twice character level with pinned feat provenance', () => {
    const toughEffect = effectFor(toughRoot, 'EFF-tough');
    expect(toughEffect.origin).toMatchObject({
      kind: 'feat',
      id: toughRoot.matrixCase.originFeat.id,
    });
    expect(payloadsOf(toughEffect.effect.mechanics as JsonObject)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier',
        applies_to: { roll: 'max_hp' },
        op: 'add',
        value: '2 * self_level',
        source: 'Крепкий',
      }),
    ]));

    const withoutTough: AssembledCharacter = {
      ...toughRoot.assembled,
      effects: toughRoot.assembled.effects.filter(({ effect }) => effect.card_number !== 'EFF-tough'),
    };
    for (const level of [1, 2, 5]) {
      const draft = { ...toughRoot.draft, level };
      const withFeat = resolveCharacterRules({ draft, assembled: toughRoot.assembled });
      const withoutFeat = resolveCharacterRules({ draft, assembled: withoutTough });
      expect(withFeat.maxHP - withoutFeat.maxHP, `Tough at level ${level}`).toBe(2 * level);
    }
    const levelOne = resolveCharacterRules({ draft: toughRoot.draft, assembled: toughRoot.assembled });
    expect(toughRoot.actor.runtime.hp).toEqual({
      current: levelOne.maxHP,
      max: levelOne.maxHP,
      temp: 0,
    });
    expect(actorPassives(toughRoot).filter((passive) => passive.id === 'EFF-tough')).toHaveLength(1);
  });

  it('materializes every micro-MVP Fighting Style choice from its pinned feat with overlay provenance', () => {
    for (const expectation of FIGHTING_STYLE_EXPECTATIONS) {
      const variant = styleVariant(fightingStyleVariants, expectation.featCard);
      const feat = required(
        catalogs.feats.find((candidate) => candidate.card_number === expectation.featCard),
        expectation.featCard,
      );
      const decision = choiceDecision(variant, 'fighter_fighting_style');
      const effect = effectFor(variant, expectation.effectCard);

      expect(expectation.entityKey).toMatch(/^fighting-style\./);
      expect(decision).toEqual({
        choiceId: expect.stringMatching(/:fighter_fighting_style$/),
        optionIds: [feat.id],
        stage: 'creation',
        provenance: 'overlay-policy',
      });
      expect(variant.assembled.feats.filter((candidate) => candidate.category === 'fighting_style'))
        .toEqual([feat]);
      expect(effect.origin).toMatchObject({ kind: 'feat', id: feat.id });
      expect(feat.related_effects).toContain(effect.effect.id);
      if (expectation.effectCard === 'fs_protection') {
        expect(actorPassives(variant)).not.toContainEqual(expect.objectContaining({
          id: expectation.effectCard,
        }));
        expect(variant.actor.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
          .toEqual(MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds);
      } else {
        expect(actorPassives(variant)).toContainEqual(expect.objectContaining({
          id: expectation.effectCard,
        }));
      }
    }
  });

  it('compiles Archery and adds +2 only to ranged-weapon attack rolls', () => {
    const archery = styleVariant(fightingStyleVariants, 'FEAT-0063');
    expect(stylePayloads(archery, 'fs_archery')).toEqual([
      {
        kind: 'modifier',
        applies_to: {
          roll: 'attack',
          filter: { attackKind: 'weapon', weaponCategory: 'ranged' },
        },
        op: 'add',
        value: '+2',
        source: 'Fighting Style: Archery',
      },
    ]);

    const rangedAttack = collectModifiers(archery.actor.runtime, actorPassives(archery), {
      roll: 'attack',
      filter: { weaponCategory: 'ranged', attackKind: 'weapon' },
    });
    const meleeAttack = collectModifiers(archery.actor.runtime, actorPassives(archery), {
      roll: 'attack',
      filter: { weaponCategory: 'melee', attackKind: 'weapon' },
    });
    const rangedDamage = collectModifiers(archery.actor.runtime, actorPassives(archery), {
      roll: 'damage',
      filter: { weaponCategory: 'ranged', attackKind: 'weapon' },
    });
    expect(rangedAttack.modifiers).toEqual([{ value: 2, source: 'Fighting Style: Archery' }]);
    expect(meleeAttack.modifiers).toEqual([]);
    expect(rangedDamage.modifiers).toEqual([]);
  });

  it('compiles Defense and adds +1 AC only while body armor is worn', () => {
    const defense = styleVariant(fightingStyleVariants, 'FEAT-0056');
    const archery = styleVariant(fightingStyleVariants, 'FEAT-0063');
    const leather = required(
      cards.find((card) => card.card_number === 'CARD-0249'),
      'CARD-0249 light armor',
    ) as unknown as Card;

    expect(stylePayloads(defense, 'fs_defense')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'modifier',
        applies_to: { roll: 'ac', filter: { wearingArmor: true } },
        op: 'add',
        value: '+1',
      }),
    ]));
    const unarmoredDefense = armorClassValue(
      defense.actor.character,
      defense.actor.runtime,
      actorPassives(defense),
    );
    const unarmoredBaseline = armorClassValue(
      archery.actor.character,
      archery.actor.runtime,
      actorPassives(archery),
    );
    expect(unarmoredDefense.value - unarmoredBaseline.value).toBe(0);

    const armoredRuntime = cloneJson(defense.actor.runtime);
    armoredRuntime.equipment.body = leather.id;
    const armoredCharacter = {
      ...defense.actor.character,
      equippedCards: [leather],
      knownCards: [leather],
    };
    const armoredDefense = armorClassValue(
      armoredCharacter,
      armoredRuntime,
      actorPassives(defense),
    );
    const armoredBaseline = armorClassValue(
      armoredCharacter,
      armoredRuntime,
      actorPassives(archery),
    );
    expect(armoredDefense.value - armoredBaseline.value).toBe(1);
  });

  it('compiles Two-Weapon Fighting and adds the ability modifier only to a Light extra attack', () => {
    const twoWeapon = styleVariant(fightingStyleVariants, 'FEAT-0061');
    const archery = styleVariant(fightingStyleVariants, 'FEAT-0063');
    expect(stylePayloads(twoWeapon, 'fs_two_weapon')).toEqual([
      {
        kind: 'modifier',
        applies_to: {
          roll: 'damage',
          filter: {
            attackKind: 'weapon',
            extraAttackSource: 'light_property',
            abilityModifierAlreadyIncluded: false,
          },
        },
        op: 'add',
        value: 'weapon_mod',
        source: 'Fighting Style: Two-Weapon Fighting',
      },
    ]);

    const extraAttackFilter = {
      attackKind: 'weapon' as const,
      extraAttackSource: 'light_property' as const,
      abilityModifierAlreadyIncluded: false,
    };
    const withStyle = collectModifiers(twoWeapon.actor.runtime, actorPassives(twoWeapon), {
      roll: 'damage', filter: extraAttackFilter, formulaCtx: { weaponMod: 3 },
    });
    const withoutStyle = collectModifiers(archery.actor.runtime, actorPassives(archery), {
      roll: 'damage', filter: extraAttackFilter, formulaCtx: { weaponMod: 3 },
    });
    expect(withStyle.modifiers).toEqual([{
      value: 3, source: 'Fighting Style: Two-Weapon Fighting',
    }]);
    expect(withoutStyle.modifiers).toEqual([]);
  });

  it('compiles Protection only as a source-owned shield-gated multi-actor Reaction capability', () => {
    const protection = styleVariant(fightingStyleVariants, 'FEAT-0055');
    const shield = required(
      cards.find((card) => card.card_number === 'CARD-0200'),
      'CARD-0200 shield',
    ) as unknown as Card;
    const shieldRuntime = cloneJson(protection.actor.runtime);
    shieldRuntime.equipment.off_hand = shield.id;
    const shieldCharacter = {
      ...protection.actor.character,
      equippedCards: [shield],
      knownCards: [shield],
    };

    expect(stylePayloads(protection, 'fs_protection')).toEqual([]);
    expect(effectFor(protection, 'fs_protection').effect.mechanics).toMatchObject({
      activation: { mode: 'reaction', cost: [{ resource: 'reaction' }] },
      capabilities: [{
        id: PROTECTION_REACTION_CAPABILITY,
        trigger: 'other_target_attacked',
        requirements: {
          target: 'not_self',
          defender_distance_to_target_ft: { max: 5 },
          defender_can_see_attacker: true,
          equipped_shield: true,
        },
      }],
      effects: [],
    });
    expect(protection.actor.capabilities.featureSources?.[PROTECTION_REACTION_CAPABILITY])
      .toEqual(MICRO_MVP_FIGHTING_STYLE_ENTITIES.protection.sourceEntityIds);
    expect(protection.rulesActions.some((action) => (
      action.sourceEntityIds.includes(effectFor(protection, 'fs_protection').effect.id)
    ))).toBe(false);
    expect(protectionReactionEligibility({
      factsSource: 'scenario',
      boardRevision: 1,
      defenderActorId: protection.actor.id,
      attackerActorId: 'enemy',
      targetActorId: 'other',
      targetRelationToDefender: 'neutral',
      defenderDistanceToTargetFt: 5,
      defenderCanSeeAttacker: true,
      defenderHasEquippedShield: shieldCharacter.equippedCards?.some((card) => card.id === shield.id) === true,
      defenderReactionAvailable: shieldRuntime.resources.reaction === 1,
    })).toEqual({ eligible: true });
    expect(shieldRuntime.resources.reaction).toBe(1);
  });
});
