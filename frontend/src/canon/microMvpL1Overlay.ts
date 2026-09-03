import { createHash } from 'node:crypto';
import {
  assemble,
  collectEffectGrantRefs,
  collectFeatChoiceRefs,
  gatherFeatureRefs,
} from '../character/assemble';
import type {
  AssembledCharacter,
  EntityBundle,
  OriginAction,
  OriginEffect,
} from '../character/assemble';
import { collectPassiveMechanics, syncRuntimeResources } from '../character/resourceInit';
import { collectActionUsesRecharge, collectActionUsesRecovery } from '../character/actionSheet';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { CharacterRuleState } from '../character/rules/types';
import {
  unavailableChoiceOptions,
  validateChoiceSelection,
  type ChoiceAvailabilityPolicy,
} from '../character/choiceAvailability';
import { buildCharacterContext } from '../character/runtime';
import { ABILITY_KEYS, type CharacterDraft } from '../character/types';
import {
  collectFreeuseRecharge,
  findFreeusePoolKey,
} from '../engine/freeuse';
import {
  LANGUAGES,
  optionsForChoiceSource,
  SKILLS,
  WEAPON_TYPES,
} from '../mechanics/registries';
import {
  preparedSpellSelectionIssues,
  type PendingChoice,
} from '../mechanics/collectChoices';
import { canonicalStringify } from '../rules-core/determinism';
import {
  buildMicroMvpSpellScopePolicy,
  createMicroMvpSpellScopeHook,
  type MicroMvpSpellScopeHook,
  type MicroMvpSpellScopePolicy,
} from '../rules-core/microMvpSpellScope';
import type {
  Ability,
  RuleActionDefinition,
  RulesCatalog,
  RulesetReference,
} from '../rules-core/domain';
import type { SpellAccessKind } from '../rules-core/spellcastingAccess';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import {
  projectSpellcastingAccess,
  type SpellGrantProjection,
} from './spellcastingAccessProjection';
import type { ActorRuleTraits } from '../rules-core/actorTraits';
import { DWARF_SPECIES_CARD } from '../rules-core/dwarfTraits';
import {
  bindDeclarativeFightingStyleProjection,
  type DeclarativeFightingStyleProjectionBinding,
} from '../rules-core/fightingStyles';
import type { WorldObjectState } from '../rules-core/worldObjects';
import {
  conjurePactTome,
  createPactBladeInvocationState,
  createPactChainInvocationState,
  createPactTomeInvocationState,
  PACT_BLADE_STATE_CAPABILITY,
  PACT_CHAIN_STATE_CAPABILITY,
  PACT_TOME_STATE_CAPABILITY,
  type WarlockPactStates,
} from '../rules-core/warlockPacts';
import {
  bindWarlockPactDeclaration,
  type WarlockPactDeclaration,
} from '../rules-core/warlockPactDeclaration';
import type {
  Action,
  CharacterClass,
  Feat,
  PassiveEffect,
  Race,
  Spell,
} from '../types';
import {
  loadPinnedProdSnapshotL1Provider,
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
} from './prodSnapshotL1Fixtures';
import {
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  MICRO_MVP_L1_OVERLAY_VERSION,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './microMvpL1ReleaseIdentity';

export {
  MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  MICRO_MVP_L1_OVERLAY_VERSION,
  PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH,
  PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH,
  PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
  PINNED_MICRO_MVP_L1_OVERLAY_HASH,
} from './microMvpL1ReleaseIdentity';
import {
  materializeMicroMvpL1ContentPatch,
  MICRO_MVP_L1_CONTENT_PATCH,
  type ContentPatchMode,
} from './declarativeMechanicsPatch';
import {
  applySpellCastingOverride,
  declaredSpellCastingOverride as compileDeclaredSpellCastingOverride,
  projectRuleAction,
  RuleActionProjectionError,
  type RuleActionProjectionProvenance,
  type SpellCastingOverride,
} from './ruleActionProjection';
import { excludesMicroMvpL1SourceEffect } from './microMvpSourceCorrections';
import type {
  FixtureActorState,
  MicroMvpSnapshotManifest,
  PinnedL1RootFixture,
  PinnedProdSnapshotL1Provider,
  SnapshotCatalogs,
  SnapshotFixtureIssue,
  SnapshotFixtureIssueCode,
} from './prodSnapshotL1Fixtures';

type JsonObject = Record<string, unknown>;

export const MICRO_MVP_L1_OVERLAY_SPEC = {
  schemaVersion: 1,
  version: MICRO_MVP_L1_OVERLAY_VERSION,
  sourceReleaseId: 'prod-snapshot@2026-08-20.micro-mvp-l1.v2',
  rulesLine: 'dnd5e-2024',
  characterLevel: 1,
  contentAuthority: {
    patchId: MICRO_MVP_L1_CONTENT_PATCH.patchId,
    patchVersion: MICRO_MVP_L1_CONTENT_PATCH.patchVersion,
    patchHash: PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH,
    productionMode: 'database-materialized-verify-only',
  },
  deterministicPolicy: {
    ordering: 'manifest-priority-then-card-number-then-uuid',
    collisionPolicy: 'choose-next-distinct-option',
    speciesLineagePolicy: 'stable-root-hash-modulo-eligible-lineages',
    originFeatPolicy: 'one-product-rule-feat-plus-human-species-feat-repeatable-aware',
    weaponMasteryPolicy: 'strict-qualified-data-declarations',
    warlockInvocationPolicy: 'phb-2024-level-1-options-without-prerequisites-only',
  },
  sourceCorrections: [
    'human.remove-foreign-elf-keen-senses',
    'dragonborn.move-draconic-flight-to-level-5',
    'dragonborn.breath-weapon-attack-sequence-replacement',
    'actions.declarative-attack-replacement-policy',
    'dwarf.stonecunning-runtime-sense-duration-and-stonework-scope',
    'species.materialize-selected-l1-lineage',
    'elf.lineage-spellcasting-ability-is-an-int-wis-cha-choice',
    'class.primary-spellcasting-ability-declared-by-effect-mechanics',
    'warlock.one-l1-eldritch-invocation-no-separate-pact-boon',
    'warlock.l1-invocation-prerequisite-eligibility',
    'warlock.overlay-owned-armor-of-shadows-and-eldritch-mind',
    'warlock.structured-pact-invocation-branches',
    'warlock.source-owned-pact-state-and-runtime-templates',
    'warlock.pact-blade-canonical-command-not-generic-marker-effects',
    'warlock.pact-tome-prepared-warlock-spells-and-focus-object',
    'class.remove-l2-only-resource-pools-at-level-1',
    'wizard.declarative-slot-recovery-rest-decision',
    'targeting.explicit-requires-sight-gate',
    'conditions.explicit-stable-identity-and-sight-facts',
    'alert.use-proficiency-bonus-for-initiative',
    'alert.structured-initiative-swap-capability',
    'fighting-styles.declarative-effect-mechanics-and-capability',
    'divine-order.structured-grants',
    'primal-order.structured-grants',
    'innate-sorcery.class-scoped-runtime-modifiers',
    'sneak-attack.weapon-roll-and-ally-eligibility',
    'rogue.thieves-cant-and-one-language',
    'guidance.structured-skill-choice',
    'bless.structured-roll-bonuses',
    'burning-hands-and-thunderwave.half-damage-on-save',
    'ray-of-frost.structured-speed-penalty',
    'guiding-bolt.structured-next-attack-advantage',
    'chill-touch.structured-healing-lock',
    'cure-wounds.route-healing-to-selected-creature',
    'mage-armor.willing-unarmored-target-slot-eight-hour-method-and-armor-don-ending',
    'light.persistent-world-object-illumination',
    'minor-illusion.persistent-object-study-and-physical-disclosure',
    'detect-magic.concentration-world-query-and-magic-action',
    'dancing-lights-druidcraft-mending-prestidigitation.canonical-world-primitives',
    'detect-poison-disease-and-purify-food-drink.canonical-world-primitives',
    'temporary-hit-points.declarative-melee-retaliation-policy',
    'poison-spray.canonical-ranged-spell-attack',
    'area-effects.declarative-object-mutation-policies',
  ],
} as const;

/**
 * A source record without `support` is discharged only by the semantic
 * unit+scenario evidence profile.  Keeping this ID next to the compiler makes
 * the raw-source disposition and the live certification attestation refer to
 * the same independently versioned gate.
 */
export const MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID =
  'micro-mvp-l1-semantic-unit-and-scenario-v1' as const;

export type MicroMvpL1ReadinessInvariant =
  | 'compiled-release-pins-match'
  | 'every-creation-and-rest-choice-resolved'
  | 'exactly-one-l1-warlock-invocation'
  | 'no-level-2-resource-in-l1-runtime'
  | 'narrative-record-replaced-by-structured-mechanics';

export interface MicroMvpL1SourceIssueDisposition {
  code: SnapshotFixtureIssueCode;
  /** Exact source subjects, a manifest-scope lookup, or a compiler-wide invariant. */
  subjects: readonly string[] | 'manifest-scope' | 'compiler-invariant';
  correctionIds: readonly (typeof MICRO_MVP_L1_OVERLAY_SPEC.sourceCorrections)[number][];
  readinessInvariant: MicroMvpL1ReadinessInvariant;
  semanticEvidenceProfileId?: typeof MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID;
}

/**
 * Exhaustive dispositions for the issues emitted by the immutable source
 * snapshot today.  Unknown codes and unknown exact subjects fail readiness;
 * they cannot be made green merely by adding another issue to the source.
 */
export const MICRO_MVP_L1_SOURCE_ISSUE_DISPOSITIONS = [
  {
    code: 'missing_support_certification',
    subjects: 'manifest-scope',
    correctionIds: [],
    readinessInvariant: 'compiled-release-pins-match',
    semanticEvidenceProfileId: MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID,
  },
  {
    code: 'l1_choice_unresolved',
    subjects: 'compiler-invariant',
    correctionIds: [
      'species.materialize-selected-l1-lineage',
      'elf.lineage-spellcasting-ability-is-an-int-wis-cha-choice',
      'warlock.one-l1-eldritch-invocation-no-separate-pact-boon',
      'divine-order.structured-grants',
      'primal-order.structured-grants',
    ],
    readinessInvariant: 'every-creation-and-rest-choice-resolved',
  },
  {
    code: 'l1_warlock_invocation_mismatch',
    subjects: 'compiler-invariant',
    correctionIds: [
      'warlock.one-l1-eldritch-invocation-no-separate-pact-boon',
      'warlock.l1-invocation-prerequisite-eligibility',
      'warlock.structured-pact-invocation-branches',
    ],
    readinessInvariant: 'exactly-one-l1-warlock-invocation',
  },
  {
    code: 'l2_resource_source_leak',
    subjects: ['CLASS-druid:wild_shape', 'CLASS-sorcerer:sorcery_points'],
    correctionIds: ['class.remove-l2-only-resource-pools-at-level-1'],
    readinessInvariant: 'no-level-2-resource-in-l1-runtime',
  },
  {
    code: 'narrative_only_mechanic',
    subjects: ['EFF-alert'],
    correctionIds: [
      'alert.use-proficiency-bonus-for-initiative',
      'alert.structured-initiative-swap-capability',
    ],
    readinessInvariant: 'narrative-record-replaced-by-structured-mechanics',
  },
  {
    code: 'narrative_only_mechanic',
    subjects: ['EFF-divine-order'],
    correctionIds: ['divine-order.structured-grants'],
    readinessInvariant: 'narrative-record-replaced-by-structured-mechanics',
  },
  {
    code: 'narrative_only_mechanic',
    subjects: ['EFF-innate-sorcery'],
    correctionIds: ['innate-sorcery.class-scoped-runtime-modifiers'],
    readinessInvariant: 'narrative-record-replaced-by-structured-mechanics',
  },
  {
    code: 'narrative_only_mechanic',
    subjects: ['EFF-primal-order'],
    correctionIds: ['primal-order.structured-grants'],
    readinessInvariant: 'narrative-record-replaced-by-structured-mechanics',
  },
  {
    code: 'narrative_only_mechanic',
    subjects: ['EFF-sneak-attack'],
    correctionIds: ['sneak-attack.weapon-roll-and-ally-eligibility'],
    readinessInvariant: 'narrative-record-replaced-by-structured-mechanics',
  },
] as const satisfies readonly MicroMvpL1SourceIssueDisposition[];

export type MicroMvpL1CapabilityGapCode =
  | 'detect_magic_world_sensing'
  | 'environmental_object_effects'
  | 'light_world_illumination'
  | 'minor_illusion_world_object_and_study'
  | 'warlock_pact_blade_bond_state'
  | 'warlock_pact_chain_summoned_actor'
  | 'warlock_pact_tome_book_rest_state';

export interface MicroMvpL1CapabilityGap {
  code: MicroMvpL1CapabilityGapCode;
  subjectId: string;
  status: 'not_expressible' | 'partially_expressible';
  message: string;
  affectedRootCount: number;
}

export interface MicroMvpL1Decision {
  choiceId: string;
  optionIds: string[];
  stage: 'creation' | 'rest';
  provenance: 'overlay-policy';
}

export interface MicroMvpL1SpeciesAudit {
  speciesId: string;
  removedSourceEffectIds: string[];
  lineageId?: string;
  lineageCardNumber?: string;
  lineageSpellcastingAbility?: 'int' | 'wis' | 'cha';
  l1EffectIds: string[];
  l1ActionIds: string[];
  l1SpellRefs: string[];
  excludedHigherLevelSpellRefs: string[];
}

export interface CompiledMicroMvpL1Root {
  fixtureId: string;
  sourceFixtureId: string;
  stableKey: string;
  matrixCase: PinnedL1RootFixture['matrixCase'];
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  actor: FixtureActorState;
  /** Canonical build projection consumed by sheets and non-combat rule checks. */
  ruleState: CharacterRuleState;
  decisions: readonly MicroMvpL1Decision[];
  speciesAudit: MicroMvpL1SpeciesAudit;
  unresolvedAcquireChoiceIds: readonly string[];
  unresolvedRuntimeChoiceIds: readonly string[];
  selectedSpellIds: readonly string[];
  selectedInvocationEffectIds: readonly string[];
  excludedResourceIds: readonly string[];
  rulesActions: readonly RuleActionDefinition[];
  /** Non-creature state produced by explicit compiled rest decisions. */
  initialWorldObjects: readonly WorldObjectState[];
}

/**
 * A focused build variant used by semantic tests. The production 448-root
 * matrix keeps one deterministic default per choice, while this override
 * surface makes every declared branch independently compilable and testable
 * without multiplying unrelated species/background/feat dimensions.
 *
 * Keys are stable choice suffixes (for example `druid_primal_order`) or full
 * choice IDs. Values use the same canonical option IDs persisted in a draft.
 */
export interface MicroMvpL1ChoiceOverrides {
  readonly [choiceIdOrSuffix: string]: readonly string[];
}

export interface CompiledMicroMvpL1Release {
  id: typeof MICRO_MVP_L1_OVERLAY_RELEASE_ID;
  systemId: 'dnd5e-2024';
  rulesetVersion: string;
  errataVersion: string;
  sourceReleaseId: string;
  sourceContentHash: string;
  overlayHash: string;
  contentHash: string;
  releaseHash: string;
}

export interface CompiledMicroMvpL1Provider {
  source: PinnedProdSnapshotL1Provider;
  release: CompiledMicroMvpL1Release;
  ruleset: RulesetReference;
  roots: readonly CompiledMicroMvpL1Root[];
  /** Rules granted to every character by the ruleset rather than a feature. */
  globalActions: readonly RuleActionDefinition[];
  capabilityGaps: readonly MicroMvpL1CapabilityGap[];
  catalog: RulesCatalog;
  getRoot(fixtureId: string): CompiledMicroMvpL1Root | undefined;
  getActor(fixtureId: string): FixtureActorState | undefined;
  getInitialWorldObjects(fixtureId: string): readonly WorldObjectState[] | undefined;
}

export class MicroMvpL1OverlayReadinessError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Compiled micro-MVP L1 overlay is not ready:\n${problems.join('\n')}`);
    this.name = 'MicroMvpL1OverlayReadinessError';
  }
}

const FIGHTING_STYLE_PRIORITY = ['FEAT-0063', 'FEAT-0056', 'FEAT-0061', 'FEAT-0055'] as const;
const HUMAN_FEAT_PRIORITY = ['FEAT-0005', 'FEAT-0001', 'FEAT-0008', 'FEAT-0009'] as const;
const ALERT_FEAT_CARD = 'FEAT-0001';
const ALERT_EFFECT_CARD = 'EFF-alert';
const MAGIC_INITIATE_WIZARD_FEAT_CARD = 'FEAT-0009';
const MAGIC_INITIATE_SPELLCASTING_ABILITY_CHOICE = 'magic_initiate_spellcasting_ability';
const MAGIC_INITIATE_SPELLCASTING_ABILITIES = ['int', 'wis', 'cha'] as const;
const ELF_LINEAGE_SPELLCASTING_ABILITY_CHOICE = 'elf_lineage_spellcasting_ability';
const ELF_LINEAGE_SPELLCASTING_ABILITIES = ['int', 'wis', 'cha'] as const;
const ALERT_INITIATIVE_SWAP_CAPABILITY = 'alert.initiative_swap';
export const MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS = [
  'EFF-invoc-armor_of_shadows',
  'EFF-invoc-eldritch_mind',
  'EFF-pact-blade',
  'EFF-pact-chain',
  'EFF-pact-tome',
] as const;

const INVOCATION_PRIORITY = MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS;
const L1_WARLOCK_INVOCATION_OPTION_SET = new Set<string>(
  MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS,
);
const ARMOR_OF_SHADOWS_CARD = MICRO_MVP_L1_WARLOCK_INVOCATION_OPTIONS[0];
const DRAGONBORN_PARENT = 'RACE-0008';
const ELF_PARENT = 'RACE-0004';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hashCanonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function stableIndex(key: string, size: number): number {
  if (size <= 1) return 0;
  const digest = createHash('sha256').update(key).digest();
  return digest.readUInt32BE(0) % size;
}

function catalogContentForCompilation(
  source: SnapshotCatalogs,
  mode: ContentPatchMode = 'apply',
): SnapshotCatalogs {
  return materializeMicroMvpL1ContentPatch(source, { mode }).catalogs;
}

function indexByReference<T extends { id: string; card_number?: string }>(items: readonly T[]): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    result.set(item.id, item);
    if (item.card_number) result.set(item.card_number, item);
  }
  return result;
}

function referenceIds(value: unknown, kind: string): string[] {
  const result: string[] = [];
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as JsonObject;
    if (record.kind === kind) {
      if (typeof record.value === 'string') result.push(record.value);
      if (Array.isArray(record.values)) {
        record.values.forEach((candidate) => {
          if (typeof candidate === 'string') result.push(candidate);
        });
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return [...new Set(result)];
}

function declaredSpellCastingOverride(
  grantMechanics: unknown,
  spell: Spell,
): SpellCastingOverride | undefined {
  try {
    return compileDeclaredSpellCastingOverride(grantMechanics, spell);
  } catch (error) {
    if (error instanceof RuleActionProjectionError) {
      throw new MicroMvpL1OverlayReadinessError([error.message]);
    }
    throw error;
  }
}

function patchBaseEffect(effect: PassiveEffect, _catalogs: SnapshotCatalogs): PassiveEffect {
  return cloneJson(effect);
}

function patchSpell(spell: Spell): Spell {
  return cloneJson(spell);
}

function l1Class(klass: CharacterClass): { klass: CharacterClass; excluded: string[] } {
  const next = cloneJson(klass);
  const resources = (next.resources ?? {}) as Record<string, JsonObject>;
  const kept: Record<string, JsonObject> = {};
  const excluded: string[] = [];
  for (const [id, definition] of Object.entries(resources)) {
    const byLevel = definition?.by_level as Record<string, unknown> | undefined;
    const unlocked = byLevel
      ? Object.entries(byLevel).some(([level, value]) => Number(level) <= 1 && Number(value) > 0)
      : id !== 'wild_shape' && id !== 'sorcery_points';
    if (unlocked) kept[id] = definition;
    else excluded.push(id);
  }
  next.resources = kept;
  return { klass: next, excluded: excluded.sort() };
}

function lineageFor(root: PinnedL1RootFixture, catalogs: SnapshotCatalogs): Race | undefined {
  const parentCard = root.matrixCase.species.card_number;
  if (parentCard !== DRAGONBORN_PARENT && parentCard !== ELF_PARENT) return undefined;
  const candidates = catalogs.races
    .filter((race) => race.parent_race_id === root.matrixCase.species.id)
    .sort((left, right) => left.card_number.localeCompare(right.card_number) || left.id.localeCompare(right.id));
  return candidates[stableIndex(root.stableKey, candidates.length)];
}

function buildBaseBundle(
  raw: PinnedL1RootFixture,
  catalogs: SnapshotCatalogs,
): {
  draft: CharacterDraft;
  bundle: EntityBundle;
  speciesAudit: MicroMvpL1SpeciesAudit;
  excludedResourceIds: string[];
} {
  const draft = cloneJson(raw.draft);
  const race = cloneJson(raw.matrixCase.species as Race);
  const { klass, excluded } = l1Class(raw.matrixCase.klass as CharacterClass);
  const background = cloneJson(raw.matrixCase.background as PinnedL1RootFixture['assembled']['background']);
  const feat = cloneJson(raw.matrixCase.originFeat as Feat);
  const lineage = lineageFor(raw, catalogs);
  if (lineage) draft.lineageId = lineage.id;

  const effectIndex = indexByReference(catalogs.effects);
  const actionIndex = indexByReference(catalogs.actions);
  const refs = gatherFeatureRefs(race, klass, [feat], 1, lineage ?? null);
  const removedSourceEffectIds: string[] = [];
  const effectRefs = refs.effectRefs.filter((reference) => {
    const candidate = effectIndex.get(reference.id);
    if (excludesMicroMvpL1SourceEffect({
      characterLevel: 1,
      raceCardNumber: race.card_number,
      classCardNumber: klass.card_number,
      effectCardNumber: candidate?.card_number,
    })) {
      if (candidate) removedSourceEffectIds.push(candidate.id);
      return false;
    }
    return true;
  });

  const effects: OriginEffect[] = [];
  const seen = new Set<string>();
  for (const reference of effectRefs) {
    const source = effectIndex.get(reference.id);
    if (!source || seen.has(source.id)) continue;
    seen.add(source.id);
    effects.push({ effect: patchBaseEffect(source, catalogs), origin: reference.origin });
  }
  const actions = refs.actionRefs.flatMap((reference): OriginAction[] => {
    const action = actionIndex.get(reference.id);
    return action ? [{ action: cloneJson(action), origin: reference.origin }] : [];
  });
  const lineageEffects = lineage
    ? effects.filter((item) => item.origin.id === lineage.id)
    : [];
  return {
    draft,
    bundle: {
      race,
      subrace: lineage ? cloneJson(lineage) : null,
      klass,
      background,
      feats: [feat],
      effects,
      actions,
      spells: [],
      resources: [],
      variableDefs: cloneJson(catalogs.variables),
    },
    speciesAudit: {
      speciesId: race.id,
      removedSourceEffectIds: removedSourceEffectIds.sort(),
      ...(lineage ? {
        lineageId: lineage.id,
        lineageCardNumber: lineage.card_number,
      } : {}),
      l1EffectIds: effects.map((item) => item.effect.id).sort(),
      l1ActionIds: actions.map((item) => item.action.id).sort(),
      l1SpellRefs: directSpellRefs(lineageEffects, (level) => level <= 1),
      excludedHigherLevelSpellRefs: directSpellRefs(lineageEffects, (level) => level > 1),
    },
    excludedResourceIds: excluded,
  };
}

function priorityRank(cardNumber: string, priority: readonly string[]): number {
  const rank = priority.indexOf(cardNumber);
  return rank < 0 ? priority.length + 1 : rank;
}

interface MicroMvpSpellCompileScope {
  policy: MicroMvpSpellScopePolicy;
  hook: MicroMvpSpellScopeHook;
  curatedReferences: ReadonlySet<string>;
}

function spellScopeReadiness<T>(path: string, operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    throw new MicroMvpL1OverlayReadinessError([
      `${path}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

function createSpellCompileScope(policy: MicroMvpSpellScopePolicy): MicroMvpSpellCompileScope {
  return {
    policy,
    hook: createMicroMvpSpellScopeHook(policy),
    curatedReferences: new Set(policy.spells.flatMap((spell) => [spell.id, spell.cardNumber])),
  };
}

function choicesSelected(draft: CharacterDraft, choice: PendingChoice): string[] {
  return draft.resolvedChoices[choice.id] ?? [];
}

function choiceOverride(
  choice: PendingChoice,
  overrides: MicroMvpL1ChoiceOverrides | undefined,
  spellScope: MicroMvpSpellCompileScope,
): string[] | undefined {
  if (!overrides) return undefined;
  const suffix = choice.id.split(':').at(-1) ?? choice.id;
  const selected = overrides[choice.id] ?? overrides[suffix];
  if (!selected) return undefined;
  if (choice.source === 'spell') {
    return [...spellScopeReadiness(choice.id, () => (
      spellScope.hook.assertChoice(choice.id, selected)
    ))];
  }
  if (selected.length !== choice.count || new Set(selected).size !== selected.length) {
    throw new MicroMvpL1OverlayReadinessError([
      `${choice.id}: override must contain exactly ${choice.count} distinct option IDs`,
    ]);
  }
  return [...selected];
}

function choiceOptionDomain(
  choice: PendingChoice,
  catalogs: SnapshotCatalogs,
  spellScope: MicroMvpSpellCompileScope,
): string[] {
  if (choice.items?.length) return choice.items.map((item) => item.id);
  if (choice.source === 'prepared_spell') return [...(choice.allowedOptionIds ?? [])];
  if (choice.source === 'spell') {
    return [...spellScopeReadiness(choice.id, () => spellScope.hook.choicePool(choice.id))];
  }
  if (choice.source === 'feat') {
    const categories = Array.isArray(choice.options?.categories)
      ? choice.options.categories.map(String)
      : null;
    return catalogs.feats.filter((feat) => {
      if (categories?.length) return categories.includes(feat.category);
      if (Array.isArray(choice.filter)) {
        return choice.filter.includes(feat.id) || choice.filter.includes(feat.card_number);
      }
      if (choice.filter === 'fighting_style') return feat.category === 'fighting_style';
      if (choice.filter === 'general') return feat.category === 'general';
      if (choice.filter === 'epic_boon') return feat.category === 'epic_boon';
      return feat.category === 'origin';
    }).map((feat) => feat.id);
  }
  if (choice.source === 'skill') {
    return Array.isArray(choice.filter) ? [...choice.filter] : SKILLS.map((skill) => skill.id);
  }
  if (choice.source === 'language') {
    return (Array.isArray(choice.filter)
      ? LANGUAGES.filter((language) => choice.filter!.includes(language.id))
      : LANGUAGES).map((language) => language.id);
  }
  if (choice.source === 'weapon') return WEAPON_TYPES.map((weapon) => weapon.id);
  if (choice.source === 'ability') return [...ABILITY_KEYS];
  return optionsForChoiceSource(choice.source).map((option) => option.id);
}

function deterministicChoice(
  choice: PendingChoice,
  raw: PinnedL1RootFixture,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
  reservedSpellIds: Set<string>,
  spellScope: MicroMvpSpellCompileScope,
  stateBeforeChoice: CharacterRuleState,
  availabilityPolicy: ChoiceAvailabilityPolicy,
): string[] {
  const existing = choicesSelected(draft, choice);
  if (existing.length >= choice.count) {
    const selected = existing.slice(0, choice.count);
    return choice.source === 'spell'
      ? [...spellScopeReadiness(choice.id, () => (
        spellScope.hook.assertChoice(choice.id, selected)
      ))]
      : selected;
  }
  const result = [...existing];
  const addFrom = (pool: readonly string[]) => {
    const unavailable = unavailableChoiceOptions(
      choice,
      stateBeforeChoice,
      pool,
      result,
      availabilityPolicy,
    );
    for (const id of pool) {
      if (result.length >= choice.count) break;
      if (!result.includes(id) && !unavailable[id]) result.push(id);
    }
  };
  const suffix = choice.id.split(':').at(-1) ?? choice.id;

  if (suffix === 'cleric_divine_order') { addFrom(['protector']); return result; }
  if (suffix === 'druid_primal_order') { addFrom(['warden']); return result; }
  if (suffix === 'warlock_invocation_l1') { addFrom([ARMOR_OF_SHADOWS_CARD]); return result; }
  if (suffix === ELF_LINEAGE_SPELLCASTING_ABILITY_CHOICE) { addFrom(['int']); return result; }
  if (suffix === MAGIC_INITIATE_SPELLCASTING_ABILITY_CHOICE) { addFrom(['int']); return result; }

  if (choice.source === 'spell') {
    const spellIndex = indexByReference(catalogs.spells);
    const pool = choiceOptionDomain(choice, catalogs, spellScope);
    const unavailable = unavailableChoiceOptions(
      choice,
      stateBeforeChoice,
      pool,
      result,
      availabilityPolicy,
    );
    for (const spellId of pool) {
      if (result.length >= choice.count) break;
      const spell = spellIndex.get(spellId);
      if (!spell) {
        throw new MicroMvpL1OverlayReadinessError([
          `${choice.id}: curated spell ${spellId} is missing from the compile catalog`,
        ]);
      }
      if (unavailable[spellId]) continue;
      if (reservedSpellIds.has(spell.id) || reservedSpellIds.has(spell.card_number)) continue;
      result.push(spell.id);
      reservedSpellIds.add(spell.id);
      reservedSpellIds.add(spell.card_number);
    }
    return result;
  }

  if (choice.source === 'feat') {
    const category = choice.filter === 'fighting_style' ? 'fighting_style' : 'origin';
    const priority = category === 'fighting_style' ? FIGHTING_STYLE_PRIORITY : HUMAN_FEAT_PRIORITY;
    const domain = new Set(choiceOptionDomain(choice, catalogs, spellScope));
    const pool = catalogs.feats
      .filter((feat) => domain.has(feat.id))
      .sort((left, right) => priorityRank(left.card_number, priority) - priorityRank(right.card_number, priority)
        || left.card_number.localeCompare(right.card_number)
        || left.id.localeCompare(right.id))
      .map((feat) => feat.id);
    addFrom(pool);
    return result;
  }

  if (choice.source === 'skill') {
    addFrom(choiceOptionDomain(choice, catalogs, spellScope).sort());
    return result;
  }

  if (choice.source === 'language') {
    addFrom(choiceOptionDomain(choice, catalogs, spellScope));
    return result;
  }

  if (choice.source === 'weapon') {
    const preferred = raw.matrixCase.klass.card_number === 'CLASS-rogue'
      ? ['dagger', 'shortbow']
      : ['longsword', 'longbow', 'greatsword'];
    addFrom([...preferred, ...choiceOptionDomain(choice, catalogs, spellScope)]);
    return result;
  }

  if (choice.source === 'effect') {
    const pool = choiceOptionDomain(choice, catalogs, spellScope).sort((left, right) => (
      priorityRank(left, INVOCATION_PRIORITY) - priorityRank(right, INVOCATION_PRIORITY)
      || left.localeCompare(right)
    ));
    addFrom(pool);
    return result;
  }

  addFrom(choiceOptionDomain(choice, catalogs, spellScope).sort());
  return result;
}

function directSpellRefs(
  effects: readonly OriginEffect[],
  acceptsLevel: (level: number) => boolean,
): string[] {
  const result: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as JsonObject;
    if (record.kind === 'grant_spell' && typeof record.value === 'string'
      && acceptsLevel(Number(record.level_gate ?? record.min_level ?? 1))) {
      result.push(record.value);
    }
    Object.values(record).forEach(visit);
  };
  effects.forEach((item) => visit(item.effect.mechanics));
  return [...new Set(result)].sort();
}

function directL1SpellRefs(effects: readonly OriginEffect[]): string[] {
  return directSpellRefs(effects, (level) => level <= 1);
}

const FIXED_SPELL_GRANT_FEATURE_CARDS = new Set([
  'RE-sub-drow',
  'RE-sub-high_elf',
  'RE-sub-wood_elf',
  'EFF-pact-chain',
  ARMOR_OF_SHADOWS_CARD,
]);

function assertCompiledSpellScope(input: {
  root: PinnedL1RootFixture;
  assembled: AssembledCharacter;
  draft: CharacterDraft;
  spellScope: MicroMvpSpellCompileScope;
}): void {
  for (const choice of input.assembled.pendingChoices) {
    if (choice.source !== 'spell') continue;
    const selected = choicesSelected(input.draft, choice);
    const canonical = spellScopeReadiness(choice.id, () => (
      input.spellScope.hook.assertChoice(choice.id, selected)
    ));
    if (canonicalStringify(canonical) !== canonicalStringify(selected)) {
      throw new MicroMvpL1OverlayReadinessError([
        `${input.root.stableKey}:${choice.id}: spell choices must persist canonical spell IDs`,
      ]);
    }
  }

  for (const item of input.assembled.effects) {
    const directRefs = directL1SpellRefs([item]);
    const hidden = directRefs.filter((reference) => (
      !input.spellScope.curatedReferences.has(reference)
    ));
    if (hidden.length) {
      throw new MicroMvpL1OverlayReadinessError([
        `${input.root.stableKey}:${item.effect.card_number}: fixed L1 spell grants are outside the curated manifest: ${hidden.join(', ')}`,
      ]);
    }
    if (FIXED_SPELL_GRANT_FEATURE_CARDS.has(item.effect.card_number)) {
      spellScopeReadiness(item.effect.card_number, () => (
        input.spellScope.hook.assertFixedGrants(item.effect.card_number, directRefs)
      ));
    }
  }

  const hiddenSpells = input.assembled.spells.filter((spell) => (
    !input.spellScope.curatedReferences.has(spell.id)
      || !input.spellScope.curatedReferences.has(spell.card_number)
  ));
  if (hiddenSpells.length) {
    throw new MicroMvpL1OverlayReadinessError([
      `${input.root.stableKey}: compiled spells are outside the curated manifest: ${hiddenSpells
        .map((spell) => spell.card_number).join(', ')}`,
    ]);
  }
}

function expandSelectedContent(
  bundle: EntityBundle,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
  expandedFeatInstances: Set<string>,
): boolean {
  const effectIndex = indexByReference(catalogs.effects);
  const featIndex = indexByReference(catalogs.feats);
  const actionIndex = indexByReference(catalogs.actions);
  let changed = false;
  const knownEffects = new Set(bundle.effects.flatMap((item) => [item.effect.id, item.effect.card_number]));
  const knownActions = new Set(bundle.actions.flatMap((item) => [item.action.id, item.action.card_number]));
  const knownFeats = new Set(bundle.feats.map((feat) => feat.id));

  for (const item of [...bundle.effects]) {
    for (const reference of collectEffectGrantRefs(item.effect.mechanics, item.effect.id, item.origin, draft)) {
      const effect = effectIndex.get(reference);
      if (!effect || knownEffects.has(effect.id) || knownEffects.has(effect.card_number)) continue;
      knownEffects.add(effect.id);
      knownEffects.add(effect.card_number);
      bundle.effects.push({ effect: patchBaseEffect(effect, catalogs), origin: item.origin });
      changed = true;
    }
    for (const pick of collectFeatChoiceRefs(item.effect.mechanics, item.effect.id, item.origin, draft)) {
      const feat = featIndex.get(pick.featId);
      if (!feat) continue;
      const instanceId = `${feat.id}:${pick.instanceKey}`;
      if (feat.repeatable) {
        if (expandedFeatInstances.has(instanceId)) continue;
        expandedFeatInstances.add(instanceId);
      } else {
        if (knownFeats.has(feat.id)) continue;
        knownFeats.add(feat.id);
      }
      bundle.feats.push(cloneJson(feat));
      const refs = gatherFeatureRefs(null, null, [feat], draft.level);
      const featOrigin = {
        kind: 'feat' as const,
        id: feat.id,
        name: feat.name,
        ...(feat.repeatable ? { instanceKey: pick.instanceKey } : {}),
      };
      for (const reference of refs.effectRefs) {
        const effect = effectIndex.get(reference.id);
        const effectInstanceId = `${effect?.id ?? reference.id}:${pick.instanceKey}`;
        if (!effect || (feat.repeatable
          ? expandedFeatInstances.has(effectInstanceId)
          : knownEffects.has(effect.id) || knownEffects.has(effect.card_number))) continue;
        if (feat.repeatable) expandedFeatInstances.add(effectInstanceId);
        else {
          knownEffects.add(effect.id);
          knownEffects.add(effect.card_number);
        }
        bundle.effects.push({ effect: patchBaseEffect(effect, catalogs), origin: featOrigin });
      }
      for (const reference of refs.actionRefs) {
        const action = actionIndex.get(reference.id);
        if (!action || knownActions.has(action.id) || knownActions.has(action.card_number)) continue;
        knownActions.add(action.id);
        knownActions.add(action.card_number);
        bundle.actions.push({ action: cloneJson(action), origin: reference.origin });
      }
      changed = true;
    }
  }
  return changed;
}

function projectSelectedFightingStyle(
  bundle: EntityBundle,
): DeclarativeFightingStyleProjectionBinding | undefined {
  const selectedStyleFeats = bundle.feats.filter((feat) => feat.category === 'fighting_style');
  if (!selectedStyleFeats.length) return undefined;
  if (selectedStyleFeats.length !== 1) {
    throw new MicroMvpL1OverlayReadinessError([
      `expected exactly one selected Fighting Style feat, got ${selectedStyleFeats.length}`,
    ]);
  }
  const feat = selectedStyleFeats[0];
  const relatedEffectIds = feat.related_effects ?? [];
  const candidates = bundle.effects.filter((item) => (
    item.origin.kind === 'feat'
      && item.origin.id === feat.id
      && relatedEffectIds.includes(item.effect.id)
  ));
  if (candidates.length !== 1) {
    throw new MicroMvpL1OverlayReadinessError([
      `${feat.card_number}/${feat.id}: expected exactly one source-owned Fighting Style effect, got ${candidates.length}`,
    ]);
  }
  const selected = candidates[0];
  const binding = bindDeclarativeFightingStyleProjection({
    featEntityId: feat.id,
    featCardNumber: feat.card_number,
    relatedEffectEntityIds: relatedEffectIds,
    effectEntityId: selected.effect.id,
    effectCardNumber: selected.effect.card_number,
    effectMechanics: selected.effect.mechanics,
  });
  if (!binding) {
    throw new MicroMvpL1OverlayReadinessError([
      `${feat.card_number}/${feat.id} -> ${selected.effect.card_number}/${selected.effect.id}: Fighting Style mechanics or relation is invalid`,
    ]);
  }
  const mechanics = cloneJson(selected.effect.mechanics ?? {});
  const declaredEffects = Array.isArray(mechanics.effects)
    ? mechanics.effects as JsonObject[]
    : [];
  const declaredSourceName = declaredEffects.flatMap((interaction) => (
    Array.isArray(interaction.result) ? interaction.result as JsonObject[] : []
  )).find((payload) => typeof payload.source === 'string')?.source;
  const capabilities = Array.isArray(mechanics.capabilities)
    ? mechanics.capabilities as JsonObject[]
    : [];
  selected.effect = {
    ...cloneJson(selected.effect),
    mechanics: {
      ...mechanics,
      name: typeof declaredSourceName === 'string' ? declaredSourceName : selected.effect.name,
      sourceEntityIds: [...binding.sourceEntityIds],
      ...(capabilities.length ? {
        capabilities: capabilities.map((capability) => (
          capability.id === binding.capabilityId
            ? { ...capability, source_entity_ids: [...binding.sourceEntityIds] }
            : capability
        )),
      } : {}),
    },
  };
  return binding;
}

function activationMode(mechanics: JsonObject | null | undefined): string {
  return String((mechanics?.activation as JsonObject | undefined)?.mode ?? '');
}

function promoteActiveEffects(bundle: EntityBundle, catalogs: SnapshotCatalogs): void {
  const actionTemplate = catalogs.actions[0];
  if (!actionTemplate) return;
  const known = new Set(bundle.actions.map((item) => item.action.id));
  for (const item of bundle.effects) {
    const mode = activationMode(item.effect.mechanics);
    const fightingStyle = item.effect.mechanics?.fighting_style as JsonObject | undefined;
    if (fightingStyle?.mode === 'reaction_capability') continue;
    if ((mode !== 'active' && mode !== 'reaction') || known.has(item.effect.id)) continue;
    known.add(item.effect.id);
    bundle.actions.push({
      origin: item.origin,
      action: {
        ...cloneJson(actionTemplate),
        id: item.effect.id,
        card_number: item.effect.card_number,
        name: item.effect.name,
        description: item.effect.description,
        mechanics: cloneJson(item.effect.mechanics),
        resource: mode === 'reaction' ? 'reaction' : 'action',
        action_type: 'class_feature',
      },
    });
  }
}

function passiveRuleView(assembled: AssembledCharacter): AssembledCharacter {
  return {
    ...assembled,
    effects: assembled.effects.filter((item) => {
      const mode = activationMode(item.effect.mechanics);
      return mode === '' || mode === 'passive' || mode === 'triggered';
    }),
    actions: assembled.actions.filter((item) => activationMode(item.action.mechanics) === 'passive'),
  };
}

function toRulesAction(
  entity: Action | Spell,
  provenance?: RuleActionProjectionProvenance,
): RuleActionDefinition {
  try {
    return projectRuleAction(entity, provenance);
  } catch (error) {
    if (error instanceof RuleActionProjectionError) {
      throw new MicroMvpL1OverlayReadinessError([error.message]);
    }
    throw error;
  }
}

type ClassSpellChoiceAccess = Extract<
  SpellAccessKind,
  'cantrip' | 'known' | 'spellbook' | 'always_prepared'
>;

export interface ClassOwnedSpellSelection {
  choice: PendingChoice;
  access: ClassSpellChoiceAccess;
  selectedReferences: string[];
}

function classSpellAccessForLabel(label: unknown, choiceId: string): ClassSpellChoiceAccess {
  switch (label) {
    case 'cantrip': return 'cantrip';
    case 'known': return 'known';
    case 'spellbook': return 'spellbook';
    case 'prepared':
    case 'always_prepared':
      return 'always_prepared';
    default:
      throw new Error(
        `${choiceId}: class grant_spell label must be cantrip, known, spellbook, prepared, or always_prepared`,
      );
  }
}

/**
 * Finds class-owned spell choices from their persisted provenance and grant
 * declaration. New caster classes therefore enter compilation through data;
 * adding their card number or choice suffix to the compiler is neither needed
 * nor permitted.
 */
export function classOwnedSpellSelections(input: {
  classId: string;
  pendingChoices: readonly PendingChoice[];
  resolvedChoices: Readonly<Record<string, readonly string[]>>;
}): ClassOwnedSpellSelection[] {
  const candidates = input.pendingChoices.filter((choice) => (
    choice.origin.kind === 'class'
      && choice.origin.id === input.classId
      && choice.source === 'spell'
  ));
  const duplicateChoiceIds = candidates
    .map((choice) => choice.id)
    .filter((choiceId, index, all) => all.indexOf(choiceId) !== index);
  if (duplicateChoiceIds.length) {
    throw new Error(`duplicate class spell choices: ${[...new Set(duplicateChoiceIds)].sort().join(', ')}`);
  }
  return candidates.map((choice) => {
    if (choice.grantKind !== 'grant_spell' || choice.grant?.kind !== 'grant_spell') {
      throw new Error(`${choice.id}: class spell choice must declare grant.kind=grant_spell`);
    }
    const selectedReferences = [...(input.resolvedChoices[choice.id] ?? [])];
    if (selectedReferences.length !== choice.count
      || new Set(selectedReferences).size !== selectedReferences.length) {
      throw new Error(`${choice.id}: class spell choice must resolve exactly ${choice.count} distinct spells`);
    }
    return {
      choice,
      access: classSpellAccessForLabel(choice.grant.label, choice.id),
      selectedReferences,
    };
  });
}

function classOwnedSpellSelectionsForRoot(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
): ClassOwnedSpellSelection[] {
  try {
    return classOwnedSpellSelections({
      classId: root.matrixCase.klass.id,
      pendingChoices: assembled.pendingChoices,
      resolvedChoices: draft.resolvedChoices,
    });
  } catch (error) {
    throw new MicroMvpL1OverlayReadinessError([
      `${root.stableKey}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

function classSpellEntityIds(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
): Set<string> {
  const index = indexByReference(catalogs.spells);
  const ids = new Set<string>();
  for (const selection of classOwnedSpellSelectionsForRoot(root, assembled, draft)) {
    for (const selected of selection.selectedReferences) {
      const selectedSpell = index.get(selected);
      if (!selectedSpell) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${selection.choice.id}: selected spell ${selected} is absent`,
        ]);
      }
      ids.add(selectedSpell.id);
      ids.add(selectedSpell.card_number);
    }
  }
  for (const { effect, origin } of assembled.effects) {
    if (origin.kind !== 'class' || L1_WARLOCK_INVOCATION_OPTION_SET.has(effect.card_number)) continue;
    for (const reference of referenceIds(effect.mechanics, 'grant_spell')) {
      const spell = index.get(reference);
      if (!spell) continue;
      ids.add(spell.id);
      ids.add(spell.card_number);
    }
  }
  return ids;
}

function choiceSpellEntityIds(
  suffixes: readonly string[],
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
): Set<string> {
  const index = indexByReference(catalogs.spells);
  const ids = new Set<string>();
  for (const choice of assembled.pendingChoices) {
    if (!suffixes.some((suffix) => choice.id.endsWith(`:${suffix}`))) continue;
    for (const selected of choicesSelected(draft, choice)) {
      const spell = index.get(selected);
      if (!spell) continue;
      ids.add(spell.id);
      ids.add(spell.card_number);
    }
  }
  return ids;
}

function selectedSpells(
  draft: CharacterDraft,
  assembled: AssembledCharacter,
  catalogs: SnapshotCatalogs,
): Spell[] {
  const index = indexByReference(catalogs.spells);
  const ruleState = resolveCharacterRules({ draft, assembled: passiveRuleView(assembled) });
  const refs = new Set([
    ...draft.spellIds,
    ...ruleState.spells.known,
    ...ruleState.spells.cantrips,
    ...ruleState.spells.leveled,
  ]);
  const result = new Map<string, Spell>();
  for (const reference of refs) {
    const spell = index.get(reference);
    if (spell && spell.level <= 1) result.set(spell.id, patchSpell(spell));
  }
  return [...result.values()].sort((left, right) => left.level - right.level
    || left.card_number.localeCompare(right.card_number)
    || left.id.localeCompare(right.id));
}

function preparedSourceProjections(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  spellIndex: Map<string, Spell>,
  grants: readonly SpellGrantProjection[],
): Array<{
  sourceId: string;
  capacity: number;
  availableActionIds: string[];
  preparedActionIds: string[];
}> {
  const choices = assembled.pendingChoices.filter((choice) => choice.source === 'prepared_spell');
  const spellbookGrants = grants.filter((grant) => grant.access === 'spellbook');
  if (!choices.length) return [];
  if (!spellbookGrants.length) {
    throw new MicroMvpL1OverlayReadinessError([
      `${root.stableKey}: prepared-spell choice has no spellbook grants`,
    ]);
  }

  const grantForReference = (choice: PendingChoice, reference: string): SpellGrantProjection => {
    const spell = spellIndex.get(reference);
    if (!spell) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${choice.id}: prepared spell ${reference} is absent`,
      ]);
    }
    const matches = spellbookGrants.filter((grant) => (
      grant.action.sourceEntityIds.includes(spell.id)
        || grant.action.sourceEntityIds.includes(spell.card_number)
    ));
    if (matches.length !== 1) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${choice.id}: prepared spell ${reference} has ${matches.length} spellbook grants`,
      ]);
    }
    return matches[0];
  };

  return choices.map((choice) => {
    const selected = choicesSelected(draft, choice);
    const issues = preparedSpellSelectionIssues(choice, selected);
    if (issues.length) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${choice.id}: ${issues.join('; ')}`,
      ]);
    }
    const available = (choice.allowedOptionIds ?? []).map((reference) => (
      grantForReference(choice, reference)
    ));
    const selectedGrants = selected.map((reference) => grantForReference(choice, reference));
    const sourceIds = new Set([...available, ...selectedGrants].map((grant) => grant.sourceId));
    if (sourceIds.size !== 1) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${choice.id}: prepared source is missing or ambiguous`,
      ]);
    }
    return {
      sourceId: [...sourceIds][0],
      capacity: choice.count,
      availableActionIds: available.map((grant) => grant.action.id),
      preparedActionIds: selectedGrants.map((grant) => grant.action.id),
    };
  });
}

function spellcastingAccessForRoot(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
  rulesActions: readonly RuleActionDefinition[],
  speciesAudit: MicroMvpL1SpeciesAudit,
  selectedInvocation: OriginEffect | undefined,
  pactDeclaration: WarlockPactDeclaration | undefined,
  runtimeResources: Readonly<Record<string, number>>,
  primarySpellcastingAbility: Ability | undefined,
  ruleState: CharacterRuleState,
  pactTomeBookObjectId?: string,
): FixtureActorState['spellcastingAccess'] {
  const classCardNumber = root.matrixCase.klass.card_number;
  const ability = primarySpellcastingAbility;
  const spellIndex = indexByReference(catalogs.spells);
  const classSelections = classOwnedSpellSelectionsForRoot(root, assembled, draft);
  const manualSpellIds = new Set((draft.manualSpellIds ?? []).flatMap((reference) => {
    const spell = spellIndex.get(reference);
    return spell ? [spell.id, spell.card_number] : [];
  }));
  const manualSpellcastingAbility = primarySpellcastingAbility ?? (['int', 'wis', 'cha'] as Ability[])
    .reduce<Ability>((best, candidate) => (
      Number(ruleState.abilities[candidate] ?? 10) > Number(ruleState.abilities[best] ?? 10)
        ? candidate
        : best
    ), 'int');
  const grants: SpellGrantProjection[] = classSelections.flatMap((selection) => {
    const { choice, access } = selection;
    if (!ability) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${choice.id}: class spell choice has no spellcasting ability`,
      ]);
    }
    return selection.selectedReferences.map((reference) => {
      const spell = spellIndex.get(reference);
      if (!spell) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${choice.id}: selected spell ${reference} is missing from the pinned catalog`,
        ]);
      }
      const actions = rulesActions.filter((candidate): candidate is Extract<
        RuleActionDefinition,
        { kind: 'spell' }
      > => (
        candidate.kind === 'spell'
          && candidate.sourceEntityIds.includes(spell.id)
          && candidate.sourceEntityIds.includes(root.matrixCase.klass.id)
          && candidate.spell.sourceClass === classCardNumber
          // Tome-eligible alternatives share the Warlock class provenance but
          // belong to the invocation catalog scope. A class spell choice must
          // keep its class-owned action/grant identity.
          && (!selectedInvocation
            || !candidate.sourceEntityIds.includes(selectedInvocation.effect.id))
      ));
      if (actions.length !== 1) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${choice.id}: expected one class-scoped action for `
            + `${spell.card_number}, got ${actions.length}`,
        ]);
      }
      const [action] = actions;
      if ((spell.level === 0) !== (access === 'cantrip')) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${choice.id}: ${spell.card_number} level does not match ${access}`,
        ]);
      }
      const permitsRitual = spell.ritual === true
        && (access === 'spellbook' || access === 'always_prepared');
      return {
        action,
        sourceId: classCardNumber,
        access,
        spellcastingAbility: ability,
        ...(permitsRitual ? { ritual: true } : {}),
        ...(spell.level > 0 ? { slotResource: `spell_slot_${spell.level}` } : {}),
      };
    });
  });

  const classActionIds = new Set(grants.map((grant) => grant.action.id));
  const magicInitiate = assembled.feats.find((feat) => (
    feat.card_number === MAGIC_INITIATE_WIZARD_FEAT_CARD
  ));
  const magicInitiateAbility = magicInitiate
    ? assembled.pendingChoices
      .find((choice) => choice.id.endsWith(`:${MAGIC_INITIATE_SPELLCASTING_ABILITY_CHOICE}`))
    : undefined;
  const selectedMagicInitiateAbility = magicInitiateAbility
    ? choicesSelected(draft, magicInitiateAbility)[0]
    : undefined;
  const selectedPactTomeActionIds = selectedInvocation && pactDeclaration?.kind === 'tome'
    ? new Set([
      ...pactTomeSelectedActionIds({
        root,
        assembled,
        draft,
        catalogs,
        rulesActions,
        sourceEntityId: selectedInvocation.effect.id,
        declaredChoiceId: pactDeclaration.cantripChoiceId,
      }),
      ...pactTomeSelectedActionIds({
        root,
        assembled,
        draft,
        catalogs,
        rulesActions,
        sourceEntityId: selectedInvocation.effect.id,
        declaredChoiceId: pactDeclaration.ritualChoiceId,
      }),
    ])
    : null;
  if (magicInitiate && (!selectedMagicInitiateAbility
    || !MAGIC_INITIATE_SPELLCASTING_ABILITIES.includes(
      selectedMagicInitiateAbility as (typeof MAGIC_INITIATE_SPELLCASTING_ABILITIES)[number],
    ))) {
    throw new MicroMvpL1OverlayReadinessError([
      `${root.stableKey}: Magic Initiate spellcasting ability must be one of int, wis, or cha`,
    ]);
  }
  for (const action of rulesActions) {
    if (action.kind !== 'spell' || classActionIds.has(action.id)) continue;
    const spell = action.sourceEntityIds
      .map((sourceId) => spellIndex.get(sourceId))
      .find((candidate): candidate is Spell => candidate !== undefined);
    if (!spell) {
      throw new MicroMvpL1OverlayReadinessError([
        `${root.stableKey}:${action.id}: spell action has no pinned spell entity`,
      ]);
    }

    if (selectedInvocation && action.sourceEntityIds.includes(selectedInvocation.effect.id)) {
      const invocationCard = selectedInvocation.effect.card_number;
      if (pactDeclaration?.kind === 'tome') {
        // Every immutable Tome-eligible spell lives in the catalog so a later
        // rest can select it. Only the five spells in the currently active
        // Book of Shadows are actor-owned or source-granted at genesis.
        if (!selectedPactTomeActionIds?.has(action.id)) continue;
        if (!pactTomeBookObjectId) {
          throw new MicroMvpL1OverlayReadinessError([
            `${root.stableKey}:${action.id}: Pact Tome spell has no source-owned Book of Shadows`,
          ]);
        }
        grants.push({
          action,
          sourceId: pactTomeBookObjectId,
          access: spell.level === 0 ? 'cantrip' : 'always_prepared',
          spellcastingAbility: 'cha',
          ...(spell.level > 0 ? {
            ritual: true,
            slotResource: `spell_slot_${spell.level}`,
          } : {}),
        });
      } else {
        grants.push({
          action,
          sourceId: invocationCard,
          access: 'innate',
          spellcastingAbility: 'cha',
        });
      }
      continue;
    }

    // “+ Добавить” is an explicit player-owned grant, independent of class
    // preparation lists. This must run before class-source inference so a
    // manually added spell is usable by every class, including non-casters.
    if (manualSpellIds.has(spell.id) || manualSpellIds.has(spell.card_number)) {
      grants.push({
        action,
        sourceId: `manual-spell:${spell.id}`,
        access: spell.level === 0 ? 'cantrip' : 'always_prepared',
        spellcastingAbility: manualSpellcastingAbility,
        ...(spell.ritual === true ? { ritual: true } : {}),
        ...(spell.level > 0 ? { slotResource: `spell_slot_${spell.level}` } : {}),
      });
      continue;
    }

    if (ability && action.sourceEntityIds.includes(root.matrixCase.klass.id)) {
      const matchingRuleGrants = ruleState.appliedGrants.filter((grant) => {
        if (grant.kind !== 'spell'
          || grant.source.type !== 'class'
          || grant.source.originEntityId !== root.matrixCase.klass.id) return false;
        const grantedSpell = spellIndex.get(grant.value);
        return grantedSpell?.id === spell.id;
      });
      if (matchingRuleGrants.length !== 1) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${action.id}: expected one declarative class spell grant, `
            + `got ${matchingRuleGrants.length}`,
        ]);
      }
      let access: ClassSpellChoiceAccess;
      try {
        access = classSpellAccessForLabel(matchingRuleGrants[0].label, matchingRuleGrants[0].id);
      } catch (error) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}: ${error instanceof Error ? error.message : String(error)}`,
        ]);
      }
      grants.push({
        action,
        sourceId: classCardNumber,
        access,
        spellcastingAbility: ability,
        ...(spell.ritual === true && (access === 'spellbook' || access === 'always_prepared')
          ? { ritual: true }
          : {}),
        ...(spell.level > 0 ? { slotResource: `spell_slot_${spell.level}` } : {}),
      });
      continue;
    }

    if (magicInitiate && action.sourceEntityIds.includes(magicInitiate.id)) {
      const freeUseResource = spell.level > 0
        ? findFreeusePoolKey(runtimeResources as Record<string, number>, {
          cardNumber: spell.card_number,
          id: spell.id,
        })
        : null;
      if (spell.level > 0 && !freeUseResource) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${action.id}: Magic Initiate free-use pool is missing`,
        ]);
      }
      grants.push({
        action,
        sourceId: MAGIC_INITIATE_WIZARD_FEAT_CARD,
        access: spell.level === 0 ? 'cantrip' : 'always_prepared',
        spellcastingAbility: selectedMagicInitiateAbility as 'int' | 'wis' | 'cha',
        ...(freeUseResource ? { freeUseResource } : {}),
        ...(spell.level > 0 ? { slotResource: `spell_slot_${spell.level}` } : {}),
      });
      continue;
    }

    if (speciesAudit.lineageId && action.sourceEntityIds.includes(speciesAudit.lineageId)) {
      if (!speciesAudit.lineageSpellcastingAbility) {
        throw new MicroMvpL1OverlayReadinessError([
          `${root.stableKey}:${action.id}: lineage spellcasting ability is missing`,
        ]);
      }
      grants.push({
        action,
        sourceId: speciesAudit.lineageId,
        access: spell.level === 0 ? 'cantrip' : 'innate',
        spellcastingAbility: speciesAudit.lineageSpellcastingAbility,
      });
      continue;
    }

    throw new MicroMvpL1OverlayReadinessError([
      `${root.stableKey}:${action.id}: actor-owned spell action has no source-scoped grant`,
    ]);
  }

  const preparedSources = preparedSourceProjections(root, assembled, draft, spellIndex, grants);
  if (!grants.length) return undefined;
  return projectSpellcastingAccess({
    grants,
    preparedSources,
  });
}

interface WarlockPactRootProjection {
  states?: WarlockPactStates;
  initialWorldObjects: WorldObjectState[];
  featureSource?: {
    capabilityId:
      | typeof PACT_BLADE_STATE_CAPABILITY
      | typeof PACT_CHAIN_STATE_CAPABILITY
      | typeof PACT_TOME_STATE_CAPABILITY;
    sourceEntityIds: [string, ...string[]];
  };
}

function exactlyOneInvocationAction(
  root: PinnedL1RootFixture,
  actions: readonly RuleActionDefinition[],
  sourceEntityId: string,
  predicate: (action: RuleActionDefinition) => boolean,
  label: string,
): RuleActionDefinition {
  const matches = actions.filter((action) => (
    action.sourceEntityIds.includes(sourceEntityId) && predicate(action)
  ));
  if (matches.length !== 1) {
    throw new MicroMvpL1OverlayReadinessError([
      `${root.stableKey}: ${label} requires exactly one source-owned action; got ${matches.length}`,
    ]);
  }
  return matches[0];
}

function pactTomeSelectedActionIds(input: {
  root: PinnedL1RootFixture;
  assembled: AssembledCharacter;
  draft: CharacterDraft;
  catalogs: SnapshotCatalogs;
  rulesActions: readonly RuleActionDefinition[];
  sourceEntityId: string;
  declaredChoiceId: string;
}): string[] {
  const choice = input.assembled.pendingChoices.find((candidate) => (
    candidate.id === input.declaredChoiceId
      || candidate.id.endsWith(`:${input.declaredChoiceId}`)
  ));
  if (!choice) {
    throw new MicroMvpL1OverlayReadinessError([
      `${input.root.stableKey}: missing declared ${input.declaredChoiceId} rest choice`,
    ]);
  }
  const spellIndex = indexByReference(input.catalogs.spells);
  return choicesSelected(input.draft, choice).map((reference) => {
    const spell = spellIndex.get(reference);
    if (!spell) {
      throw new MicroMvpL1OverlayReadinessError([
        `${input.root.stableKey}:${choice.id}: missing selected spell ${reference}`,
      ]);
    }
    const action = exactlyOneInvocationAction(
      input.root,
      input.rulesActions,
      input.sourceEntityId,
      (candidate) => candidate.kind === 'spell' && candidate.sourceEntityIds.includes(spell.id),
      `${input.declaredChoiceId}:${spell.card_number}`,
    );
    return action.id;
  }).sort((left, right) => left.localeCompare(right));
}

function warlockPactProjectionForRoot(input: {
  root: PinnedL1RootFixture;
  assembled: AssembledCharacter;
  draft: CharacterDraft;
  catalogs: SnapshotCatalogs;
  rulesActions: readonly RuleActionDefinition[];
  selectedInvocation?: OriginEffect;
  pactDeclaration?: WarlockPactDeclaration;
  ownerActorId: string;
  pactTomeBookObjectId?: string;
  spellcastingAccess: FixtureActorState['spellcastingAccess'];
}): WarlockPactRootProjection {
  const selected = input.selectedInvocation;
  const declaration = input.pactDeclaration;
  if (!selected || !declaration) {
    return { initialWorldObjects: [] };
  }
  const sourceEntityIds = [
    selected.effect.id,
    selected.effect.card_number,
    input.root.matrixCase.klass.id,
    input.root.matrixCase.klass.card_number,
  ] as [string, ...string[]];

  if (declaration.kind === 'blade') {
    const action = exactlyOneInvocationAction(
      input.root,
      input.rulesActions,
      selected.effect.id,
      (candidate) => candidate.kind === 'nonSpell'
        && primitiveType(candidate) === declaration.primitiveType,
      'Pact Blade',
    );
    return {
      states: {
        blade: createPactBladeInvocationState({
          sourceEntityId: selected.effect.id,
          ownerActorId: input.ownerActorId,
          bondActionId: action.id,
          lifecyclePolicy: declaration.lifecyclePolicy,
        }),
      },
      initialWorldObjects: [],
      featureSource: { capabilityId: declaration.capabilityId, sourceEntityIds },
    };
  }

  if (declaration.kind === 'chain') {
    const findFamiliar = indexByReference(input.catalogs.spells).get(declaration.grantedSpell);
    if (!findFamiliar) {
      throw new MicroMvpL1OverlayReadinessError([
        `${input.root.stableKey}: Pact Chain Find Familiar entity is missing`,
      ]);
    }
    const action = exactlyOneInvocationAction(
      input.root,
      input.rulesActions,
      selected.effect.id,
      (candidate) => candidate.kind === 'spell'
        && candidate.sourceEntityIds.includes(findFamiliar.id),
      'Pact Chain',
    );
    return {
      states: {
        chain: createPactChainInvocationState({
          sourceEntityId: selected.effect.id,
          ownerActorId: input.ownerActorId,
          findFamiliarActionId: action.id,
        }),
      },
      initialWorldObjects: [],
      featureSource: { capabilityId: declaration.capabilityId, sourceEntityIds },
    };
  }

  if (!input.pactTomeBookObjectId || !input.spellcastingAccess) {
    throw new MicroMvpL1OverlayReadinessError([
      `${input.root.stableKey}: Pact Tome requires a book object and spellcasting access`,
    ]);
  }
  const cantripActionIds = pactTomeSelectedActionIds({
    ...input,
    sourceEntityId: selected.effect.id,
    declaredChoiceId: declaration.cantripChoiceId,
  });
  const ritualActionIds = pactTomeSelectedActionIds({
    ...input,
    sourceEntityId: selected.effect.id,
    declaredChoiceId: declaration.ritualChoiceId,
  });
  const result = conjurePactTome({
    sourceEntityId: selected.effect.id,
    ownerActorId: input.ownerActorId,
    bookObjectId: input.pactTomeBookObjectId,
    // A compiled level-1 fixture starts after its deterministic genesis Long Rest.
    rest: 'long',
    cantripActionIds,
    ritualActionIds,
    options: [
      ...cantripActionIds.map((actionId) => ({ actionId, level: 0, ritual: false })),
      ...ritualActionIds.map((actionId) => ({ actionId, level: 1, ritual: true })),
    ],
    alreadyPreparedActionIds: [],
    slotResource: declaration.slotResource,
  });
  const projectedGrants = input.spellcastingAccess.grants.filter((grant) => (
    grant.sourceId === input.pactTomeBookObjectId
  ));
  if (canonicalStringify(projectedGrants) !== canonicalStringify(result.grants)) {
    throw new MicroMvpL1OverlayReadinessError([
      `${input.root.stableKey}: Pact Tome state and source-scoped spell grants diverged; `
        + `projected=${canonicalStringify(projectedGrants)}; `
        + `expected=${canonicalStringify(result.grants)}`,
    ]);
  }
  return {
    states: {
      tome: createPactTomeInvocationState({
        sourceEntityId: selected.effect.id,
        ownerActorId: input.ownerActorId,
        tome: result.tome,
      }),
    },
    initialWorldObjects: [result.bookObject],
    featureSource: { capabilityId: declaration.capabilityId, sourceEntityIds },
  };
}

function unresolvedChoices(assembled: AssembledCharacter, draft: CharacterDraft, inPlay: boolean): string[] {
  return assembled.pendingChoices
    .filter((choice) => (choice.context === 'in_play') === inPlay)
    .filter((choice) => choicesSelected(draft, choice).length !== choice.count)
    .map((choice) => choice.id)
    .sort();
}

function grantedEffectsFor(
  actions: readonly RuleActionDefinition[],
  catalogs: SnapshotCatalogs,
): FixtureActorState['grantedEffects'] {
  const index = indexByReference(catalogs.effects);
  const result: NonNullable<FixtureActorState['grantedEffects']> = {};
  for (const action of actions) {
    for (const reference of referenceIds(action.mechanics, 'grant_effect')) {
      const effect = index.get(reference);
      if (!effect) continue;
      const entry = {
        id: effect.id,
        card_number: effect.card_number,
        name: effect.name,
        mechanics: cloneJson(effect.mechanics),
        repeatable: effect.repeatable,
      };
      result[effect.id] = entry;
      result[effect.card_number] = entry;
    }
  }
  return result;
}

function choiceStateBeforeSelection(
  choice: PendingChoice,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
): CharacterRuleState {
  const before = cloneJson(draft);
  delete before.resolvedChoices[choice.id];
  return resolveCharacterRules({ draft: before, assembled });
}

function choiceAvailabilityPolicy(
  choice: PendingChoice,
  draft: CharacterDraft,
  assembled: AssembledCharacter,
  baseFeatIds: ReadonlySet<string>,
  catalogs: SnapshotCatalogs,
): ChoiceAvailabilityPolicy {
  const featIndex = indexByReference(catalogs.feats);
  const spellIndex = indexByReference(catalogs.spells);
  const canonicalFeatId = (reference: string) => featIndex.get(reference)?.id ?? reference;
  const canonicalSpellId = (reference: string) => spellIndex.get(reference)?.id ?? reference;
  const activeFeatIds = new Set([...baseFeatIds].map(canonicalFeatId));
  for (const reference of draft.featIds ?? []) activeFeatIds.add(canonicalFeatId(reference));
  // Only other feat choices occupy the baseline. The current choice is an
  // atomic replacement and therefore must not conflict with its old value.
  for (const candidate of assembled.pendingChoices) {
    if (candidate.id === choice.id || candidate.source !== 'feat') continue;
    for (const reference of choicesSelected(draft, candidate)) {
      activeFeatIds.add(canonicalFeatId(reference));
    }
  }
  return {
    activeFeatIds,
    repeatableFeatIds: new Set(catalogs.feats.filter((feat) => feat.repeatable).map((feat) => feat.id)),
    canonicalFeatId,
    canonicalSpellId,
  };
}

function selectedWarlockInvocation(
  assembled: AssembledCharacter,
): OriginEffect | undefined {
  return assembled.effects.find((item) => (
    L1_WARLOCK_INVOCATION_OPTION_SET.has(item.effect.card_number)
  ));
}

function declaredWarlockPact(
  invocation: OriginEffect | undefined,
): WarlockPactDeclaration | undefined {
  if (!invocation) return undefined;
  const declaration = bindWarlockPactDeclaration(invocation.effect.mechanics);
  if (declaration) return declaration;
  if (['EFF-pact-blade', 'EFF-pact-chain', 'EFF-pact-tome']
    .includes(invocation.effect.card_number)) {
    throw new MicroMvpL1OverlayReadinessError([
      `${invocation.effect.card_number}/${invocation.effect.id}: selected pact has no valid data-owned primitive declaration`,
    ]);
  }
  return undefined;
}

function addSpellReferences(
  destination: Set<string>,
  references: readonly string[],
  spellIndex: Map<string, Spell>,
): void {
  for (const reference of references) {
    const selected = spellIndex.get(reference);
    if (!selected) continue;
    destination.add(selected.id);
    destination.add(selected.card_number);
  }
}

/**
 * Returns the spells whose grant comes from the selected invocation rather
 * than the class spell list. This distinction is part of action provenance:
 * the same spell can obey different slot/preparation rules for each grant.
 */
function invocationSpellEntityIds(
  invocation: OriginEffect | undefined,
  pactDeclaration: WarlockPactDeclaration | undefined,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
): Set<string> {
  const ids = new Set<string>();
  if (!invocation) return ids;
  const spellIndex = indexByReference(catalogs.spells);
  addSpellReferences(ids, referenceIds(invocation.effect.mechanics, 'grant_spell'), spellIndex);
  if (pactDeclaration?.kind === 'tome') {
    for (const choice of assembled.pendingChoices) {
      if (choice.id !== pactDeclaration.cantripChoiceId
        && choice.id !== pactDeclaration.ritualChoiceId
        && !choice.id.endsWith(`:${pactDeclaration.cantripChoiceId}`)
        && !choice.id.endsWith(`:${pactDeclaration.ritualChoiceId}`)) continue;
      addSpellReferences(ids, choicesSelected(draft, choice), spellIndex);
    }
  }
  return ids;
}

/** Invocation casts are separate grants, so their resource contract must not
 * inherit the ordinary spell-card slot/uses record from the immutable source. */
function invocationSpellForRules(spell: Spell, override?: SpellCastingOverride): Spell {
  return applySpellCastingOverride(spell, override);
}

function selectedWeaponMasteryEffects(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
  draft: CharacterDraft,
  catalogs: SnapshotCatalogs,
): FixtureActorState['masteryEffects'] {
  const choice = assembled.pendingChoices.find((candidate) => (
    candidate.grantKind === 'weapon_mastery'
  ));
  if (!choice) return undefined;

  const selectedWeaponTypes = choicesSelected(draft, choice);
  if (selectedWeaponTypes.length !== choice.count
    || new Set(selectedWeaponTypes).size !== choice.count) {
    throw new MicroMvpL1OverlayReadinessError([
      `${choice.id}: expected exactly ${choice.count} distinct Weapon Mastery selections`,
    ]);
  }
  const grantingEffect = assembled.effects.find(({ effect }) => (
    effect.id === choice.origin.featureId
  ));
  if (!grantingEffect || grantingEffect.origin.kind !== 'class') {
    throw new MicroMvpL1OverlayReadinessError([
      `${choice.id}: Weapon Mastery must retain its class-feature provenance`,
    ]);
  }

  const effectIndex = indexByReference(catalogs.effects);
  const result: NonNullable<FixtureActorState['masteryEffects']> = {};
  for (const weaponType of selectedWeaponTypes) {
    const masteryIds = [...new Set(catalogs.cards
      .filter((card) => card.type === 'weapon' && card.weapon_type === weaponType && card.mastery)
      .map((card) => card.mastery!))]
      .sort();
    if (masteryIds.length !== 1) {
      throw new MicroMvpL1OverlayReadinessError([
        `${choice.id}:${weaponType}: expected one canonical mastery effect, got ${masteryIds.length}`,
      ]);
    }
    const mastery = effectIndex.get(masteryIds[0]);
    if (!mastery) {
      throw new MicroMvpL1OverlayReadinessError([
        `${choice.id}:${weaponType}: missing canonical mastery effect ${masteryIds[0]}`,
      ]);
    }

    const existing = result[mastery.id];
    const weaponTypes = [...new Set([...(existing?.weaponTypes ?? []), weaponType])].sort();
    const sourceEntityIds = [...new Set([
      root.matrixCase.klass.id,
      root.matrixCase.klass.card_number,
      grantingEffect.effect.id,
      grantingEffect.effect.card_number,
      mastery.id,
      mastery.card_number,
    ])] as [string, ...string[]];
    result[mastery.id] = {
      name: mastery.name,
      mechanics: cloneJson(mastery.mechanics),
      weaponTypes,
      sourceEntityIds,
    };
  }
  return result;
}

function actorTraitsForRoot(
  root: PinnedL1RootFixture,
  assembled: AssembledCharacter,
): ActorRuleTraits | undefined {
  const conditionImmunities: NonNullable<ActorRuleTraits['conditionImmunities']> = [];
  for (const { effect, origin } of assembled.effects) {
    const payloads: Record<string, unknown>[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const candidate = value as Record<string, unknown>;
      if (candidate.kind === 'condition_immunity') payloads.push(candidate);
      Object.values(candidate).forEach(visit);
    };
    visit(effect.mechanics);
    if (!payloads.length) continue;
    const originEntity = origin.kind === 'race'
      ? [assembled.race, assembled.subrace].find((entity) => entity?.id === origin.id)
      : origin.kind === 'class'
        ? [assembled.klass, assembled.subclass].find((entity) => entity?.id === origin.id)
        : origin.kind === 'feat'
          ? assembled.feats.find((entity) => entity.id === origin.id)
          : undefined;
    const sourceEntityIds: [string, ...string[]] = [origin.id, ...new Set([
      originEntity?.card_number,
      effect.id,
      effect.card_number,
    ].filter((value): value is string => (
      typeof value === 'string' && value.length > 0 && value !== origin.id
    )))];
    for (const payload of payloads) {
      const condition = payload.condition;
      const rawTags = payload.required_cause_tags ?? payload.requiredCauseTags;
      if (typeof condition !== 'string' || !condition.trim()
        || (rawTags !== undefined
          && (!Array.isArray(rawTags)
            || rawTags.some((tag) => typeof tag !== 'string' || !tag.trim())))) {
        throw new MicroMvpL1OverlayReadinessError([
          `${effect.card_number}: condition_immunity declaration is malformed`,
        ]);
      }
      conditionImmunities.push({
        condition,
        ...(Array.isArray(rawTags) ? { requiredCauseTags: rawTags.map(String) } : {}),
        sourceEntityIds,
      });
    }
  }
  const isElf = root.matrixCase.species.card_number === ELF_PARENT;
  if (!conditionImmunities.length && !isElf) return undefined;
  const speciesSources = [
    root.matrixCase.species.id,
    root.matrixCase.species.card_number,
  ] as [string, ...string[]];
  return {
    ...(conditionImmunities.length ? { conditionImmunities } : {}),
    ...(isElf ? {
      restProfile: {
        longRestHours: 4,
        sleepRequired: false,
        sourceEntityIds: speciesSources,
      },
    } : {}),
  };
}

function compileRoot(
  raw: PinnedL1RootFixture,
  catalogs: SnapshotCatalogs,
  spellScope: MicroMvpSpellCompileScope,
  releaseId: string,
  choiceOverrides?: MicroMvpL1ChoiceOverrides,
  fixtureIdSuffix = '',
): CompiledMicroMvpL1Root {
  const base = buildBaseBundle(raw, catalogs);
  const { draft, bundle } = base;
  const baseFeatIds = new Set(bundle.feats.map((feat) => feat.id));
  const spellIndex = indexByReference(catalogs.spells);
  const reservedSpellIds = new Set<string>();
  const expandedFeatInstances = new Set<string>();
  for (const reference of directL1SpellRefs(bundle.effects)) {
    const spell = spellIndex.get(reference);
    if (!spell) continue;
    reservedSpellIds.add(spell.id);
    reservedSpellIds.add(spell.card_number);
  }

  let assembled = assemble(bundle, draft);
  for (let pass = 0; pass < 12; pass += 1) {
    let changed = false;
    for (const choice of assembled.pendingChoices) {
      const optionDomain = choiceOptionDomain(choice, catalogs, spellScope);
      const stateBeforeChoice = choiceStateBeforeSelection(choice, draft, assembled);
      const availabilityPolicy = choiceAvailabilityPolicy(
        choice,
        draft,
        assembled,
        baseFeatIds,
        catalogs,
      );
      const overridden = choiceOverride(choice, choiceOverrides, spellScope);
      const existing = choicesSelected(draft, choice);
      if (overridden) {
        // A prepared-spell domain is projected from another choice in the
        // same source. During the first fixed-point pass that source may have
        // just been resolved in `draft` while this assembled view is still
        // intentionally stale; defer validation until the next pass rather
        // than accepting an empty/foreign domain.
        if (choice.source === 'prepared_spell' && optionDomain.length < choice.count) continue;
        const issues = validateChoiceSelection(
          choice,
          stateBeforeChoice,
          overridden,
          optionDomain,
          availabilityPolicy,
        );
        if (issues.length) {
          throw new MicroMvpL1OverlayReadinessError(issues.map((issue) => (
            `${choice.id}${issue.optionId ? `:${issue.optionId}` : ''}: ${issue.reason}`
          )));
        }
        if (canonicalStringify(existing) !== canonicalStringify(overridden)) {
          draft.resolvedChoices[choice.id] = overridden;
          changed = true;
        }
        if (choice.source === 'spell') {
          for (const reference of overridden) {
            const spell = spellIndex.get(reference);
            if (!spell) continue;
            reservedSpellIds.add(spell.id);
            reservedSpellIds.add(spell.card_number);
          }
        }
        continue;
      }
      if (existing.length === choice.count) {
        let canonical = existing;
        let validSpellScope = true;
        if (choice.source === 'spell') {
          try {
            canonical = [...spellScope.hook.assertChoice(choice.id, existing)];
          } catch {
            validSpellScope = false;
          }
        }
        const issues = validSpellScope
          ? validateChoiceSelection(
            choice,
            stateBeforeChoice,
            canonical,
            optionDomain,
            availabilityPolicy,
          )
          : [{ reason: 'Выбор заклинаний находится вне immutable release scope' }];
        if (!issues.length) {
          if (canonicalStringify(existing) !== canonicalStringify(canonical)) {
            draft.resolvedChoices[choice.id] = [...canonical];
            changed = true;
          }
          if (choice.source === 'spell') {
            for (const reference of canonical) {
              const spell = spellIndex.get(reference);
              if (!spell) continue;
              reservedSpellIds.add(spell.id);
              reservedSpellIds.add(spell.card_number);
            }
          }
          continue;
        }
        // Immutable legacy defaults can be stale after another grant changes.
        // Re-resolve from the same generic availability semantics; explicit
        // overrides fail above instead of being silently substituted.
        draft.resolvedChoices[choice.id] = [];
        changed = true;
      } else if (choice.source === 'spell' && existing.length) {
        draft.resolvedChoices[choice.id] = [];
        changed = true;
      }
      const selected = deterministicChoice(
        choice,
        raw,
        draft,
        catalogs,
        reservedSpellIds,
        spellScope,
        stateBeforeChoice,
        availabilityPolicy,
      );
      if (selected.length === choice.count) {
        const canonical = choice.source === 'spell'
          ? [...spellScopeReadiness(choice.id, () => (
            spellScope.hook.assertChoice(choice.id, selected)
          ))]
          : selected;
        draft.resolvedChoices[choice.id] = canonical;
        if (choice.source === 'spell') {
          for (const reference of canonical) {
            const spell = spellIndex.get(reference);
            if (!spell) continue;
            reservedSpellIds.add(spell.id);
            reservedSpellIds.add(spell.card_number);
          }
        }
        changed = true;
      }
    }
    if (expandSelectedContent(bundle, draft, catalogs, expandedFeatInstances)) changed = true;
    const choiceSpellIds = assembled.pendingChoices
      .filter((choice) => choice.source === 'spell')
      .flatMap((choice) => choicesSelected(draft, choice));
    draft.spellIds = [...new Set([
      ...choiceSpellIds,
      ...(draft.manualSpellIds ?? []),
    ])].sort();
    bundle.spells = draft.spellIds.flatMap((id) => {
      const spell = spellIndex.get(id);
      return spell ? [patchSpell(spell)] : [];
    });
    assembled = assemble(bundle, draft);
    if (!changed) break;
  }

  const fightingStyleBinding = projectSelectedFightingStyle(bundle);
  promoteActiveEffects(bundle, catalogs);
  assembled = assemble(bundle, draft);
  bundle.spells = selectedSpells(draft, assembled, catalogs);
  draft.spellIds = bundle.spells.map((spell) => spell.id).sort();
  assembled = assemble(bundle, draft);
  assertCompiledSpellScope({ root: raw, assembled, draft, spellScope });

  if (raw.matrixCase.species.card_number === ELF_PARENT) {
    const abilityChoice = assembled.pendingChoices.find((choice) => (
      choice.id.endsWith(`:${ELF_LINEAGE_SPELLCASTING_ABILITY_CHOICE}`)
        && choice.origin.id === base.speciesAudit.lineageId
    ));
    const selected = abilityChoice ? choicesSelected(draft, abilityChoice) : [];
    if (!abilityChoice || selected.length !== 1
      || !ELF_LINEAGE_SPELLCASTING_ABILITIES.includes(
        selected[0] as (typeof ELF_LINEAGE_SPELLCASTING_ABILITIES)[number],
      )) {
      throw new MicroMvpL1OverlayReadinessError([
        `${raw.stableKey}: Elf lineage spellcasting ability must be one of int, wis, or cha`,
      ]);
    }
    base.speciesAudit.lineageSpellcastingAbility = selected[0] as 'int' | 'wis' | 'cha';
  }

  const ruleView = passiveRuleView(assembled);
  const ruleState = resolveCharacterRules({ draft, assembled: ruleView });
  const character = buildCharacterContext(
    ruleState,
    { level: 1, abilities: draft.abilities as Record<string, number> },
    [],
    assembled.klass,
  );
  const runtimeResources = syncRuntimeResources(character, assembled, undefined, ruleState.freeuseSpells);
  const classResources = (assembled.klass?.resources ?? {}) as Record<
    string,
    { per?: string } | undefined
  >;
  const resourceRecharge = {
    ...Object.fromEntries(Object.entries(classResources).flatMap(([resource, definition]) => (
      resource in runtimeResources.maxResources && definition?.per
        ? [[resource, definition.per]]
        : []
    ))),
    ...collectActionUsesRecharge(assembled),
    ...collectFreeuseRecharge(ruleState.freeuseSpells),
  };
  const resourceRecovery = collectActionUsesRecovery(assembled);
  const classSpellIds = classSpellEntityIds(raw, assembled, draft, catalogs);
  const selectedInvocation = selectedWarlockInvocation(assembled);
  const pactDeclaration = declaredWarlockPact(selectedInvocation);
  const invocationSpellIds = invocationSpellEntityIds(
    selectedInvocation,
    pactDeclaration,
    assembled,
    draft,
    catalogs,
  );
  const pactTomeCatalogSpells = selectedInvocation && pactDeclaration?.kind === 'tome'
    ? spellScope.policy.spells.flatMap((curated) => {
      const spell = catalogs.spells.find((candidate) => candidate.id === curated.id);
      return spell && (spell.level === 0 || (spell.level === 1 && spell.ritual === true))
        ? [patchSpell(spell)]
        : [];
    })
    : [];
  const magicInitiate = assembled.feats.find((feat) => (
    feat.card_number === MAGIC_INITIATE_WIZARD_FEAT_CARD
  ));
  const magicInitiateEffect = assembled.effects.find(({ effect }) => (
    effect.card_number === 'magic_initiate_wizard'
  ))?.effect;
  const magicInitiateSpellIds = choiceSpellEntityIds(
    ['magic_initiate_wizard_cantrips', 'magic_initiate_wizard_level_1'],
    assembled,
    draft,
    catalogs,
  );
  const lineageSpellIds = new Set<string>();
  addSpellReferences(lineageSpellIds, base.speciesAudit.l1SpellRefs, spellIndex);
  const rulesActions = [
    ...assembled.actions.map((item) => {
      const isSpeciesLineageAction = assembled.subrace?.related_actions?.includes(item.action.id) === true;
      return toRulesAction(item.action, {
          sourceEntityIds: [
            item.origin.id,
            ...(isSpeciesLineageAction ? [raw.matrixCase.species.id] : []),
          ],
          grantScopeId: item.origin.id,
        });
    }),
    ...assembled.spells.flatMap((spell) => {
      const actions: RuleActionDefinition[] = [];
      const isInvocationSpell = invocationSpellIds.has(spell.id)
        || invocationSpellIds.has(spell.card_number);
      if (isInvocationSpell && selectedInvocation) {
        actions.push(toRulesAction(
          invocationSpellForRules(
            spell,
            declaredSpellCastingOverride(selectedInvocation.effect.mechanics, spell),
          ),
          {
            sourceEntityIds: [selectedInvocation.effect.id, raw.matrixCase.klass.id],
            sourceClass: raw.matrixCase.klass.card_number,
            grantScopeId: selectedInvocation.effect.id,
          },
        ));
      }
      const isClassSpell = classSpellIds.has(spell.id) || classSpellIds.has(spell.card_number);
      if (isClassSpell) {
        actions.push(toRulesAction(spell, {
          sourceEntityIds: [raw.matrixCase.klass.id],
          sourceClass: raw.matrixCase.klass.card_number,
          grantScopeId: raw.matrixCase.klass.card_number,
        }));
      }
      const isMagicInitiateSpell = magicInitiateSpellIds.has(spell.id)
        || magicInitiateSpellIds.has(spell.card_number);
      if (isMagicInitiateSpell && magicInitiate && magicInitiateEffect) {
        actions.push(toRulesAction(spell, {
          sourceEntityIds: [magicInitiate.id, magicInitiateEffect.id],
          grantScopeId: magicInitiate.id,
        }));
      }
      const isLineageSpell = lineageSpellIds.has(spell.id) || lineageSpellIds.has(spell.card_number);
      if (isLineageSpell && base.speciesAudit.lineageId) {
        actions.push(toRulesAction(spell, {
          sourceEntityIds: [base.speciesAudit.lineageId, raw.matrixCase.species.id],
          grantScopeId: base.speciesAudit.lineageId,
        }));
      }
      return actions.length ? actions : [toRulesAction(spell)];
    }),
    ...pactTomeCatalogSpells.map((spell) => toRulesAction(
      invocationSpellForRules(spell),
      {
        sourceEntityIds: [selectedInvocation!.effect.id, raw.matrixCase.klass.id],
        sourceClass: raw.matrixCase.klass.card_number,
        grantScopeId: selectedInvocation!.effect.id,
      },
    )),
  ].filter((action, index, all) => all.findIndex((candidate) => candidate.id === action.id) === index)
    .sort((left, right) => left.id.localeCompare(right.id));
  const fixtureId = `${releaseId}:${raw.stableKey}${fixtureIdSuffix}`;
  const passives = collectPassiveMechanics(ruleView, draft.resolvedChoices).map((passive) => {
    if (raw.matrixCase.species.card_number === DWARF_SPECIES_CARD) {
      const source = assembled.effects.find(({ effect }) => (
        assembled.race?.related_effects?.includes(effect.id) === true
          && effect.card_number === String(passive.id ?? '')
      ));
      if (source) return {
        ...passive,
        sourceEntityIds: [
          source.effect.id,
          source.effect.card_number,
          raw.matrixCase.species.id,
          raw.matrixCase.species.card_number,
        ],
      };
    }
    if (raw.matrixCase.species.card_number === DRAGONBORN_PARENT) {
      const source = assembled.effects.find(({ effect }) => (
        assembled.subrace?.related_effects?.includes(effect.id) === true
          && effect.card_number === String(passive.id ?? '')
      ));
      if (source) return {
        ...passive,
        sourceEntityIds: [
          source.effect.id,
          source.effect.card_number,
          assembled.subrace!.id,
          raw.matrixCase.species.id,
        ],
      };
    }
    return passive;
  });
  const masteryEffects = selectedWeaponMasteryEffects(raw, assembled, draft, catalogs);
  const traits = actorTraitsForRoot(raw, assembled);
  const pactTomeBookObjectId = selectedInvocation && pactDeclaration?.kind === 'tome'
    ? `${fixtureId}:${pactDeclaration.bookObjectKind.replaceAll('_', '-')}`
    : undefined;
  const spellcastingAccess = spellcastingAccessForRoot(
    raw,
    assembled,
    draft,
    catalogs,
    rulesActions,
    base.speciesAudit,
    selectedInvocation,
    pactDeclaration,
    runtimeResources.resources,
    ruleState.spellcasting?.ability,
    ruleState,
    pactTomeBookObjectId,
  );
  const warlockPactProjection = warlockPactProjectionForRoot({
    root: raw,
    assembled,
    draft,
    catalogs,
    rulesActions,
    selectedInvocation,
    pactDeclaration,
    ownerActorId: fixtureId,
    pactTomeBookObjectId,
    spellcastingAccess,
  });
  const alertFeat = assembled.feats.find((feat) => feat.card_number === ALERT_FEAT_CARD);
  const alertEffect = assembled.effects.find(({ effect }) => effect.card_number === ALERT_EFFECT_CARD)?.effect;
  const alertSourceEntityIds = alertFeat && alertEffect
    ? [alertFeat.id, alertFeat.card_number, alertEffect.id, alertEffect.card_number] as [string, ...string[]]
    : undefined;
  const restDecisionFeatureSources = rulesActions.reduce<
    Record<string, [string, ...string[]]>
  >((sources, action) => {
    if (!action.restDecision) return sources;
    const current = sources[action.restDecision.capabilityId] ?? [];
    sources[action.restDecision.capabilityId] = [...new Set([
      ...current,
      ...action.sourceEntityIds,
    ])] as [string, ...string[]];
    return sources;
  }, {});
  const featureSources = {
    ...(alertSourceEntityIds ? { [ALERT_INITIATIVE_SWAP_CAPABILITY]: alertSourceEntityIds } : {}),
    ...(fightingStyleBinding?.capabilityId ? {
      [fightingStyleBinding.capabilityId]: fightingStyleBinding.sourceEntityIds,
    } : {}),
    ...restDecisionFeatureSources,
    ...(warlockPactProjection.featureSource ? {
      [warlockPactProjection.featureSource.capabilityId]:
        warlockPactProjection.featureSource.sourceEntityIds,
    } : {}),
  };
  const actor: FixtureActorState = {
    id: fixtureId,
    name: draft.name,
    kind: 'playerCharacter',
    controllerId: 'micro-mvp-overlay-controller',
    ac: ruleState.armorClass,
    capabilities: {
      actionIds: rulesActions
        .filter((action) => !action.restDecision)
        .filter((action) => (
          pactDeclaration?.kind !== 'tome'
            || !selectedInvocation
            || !action.sourceEntityIds.includes(selectedInvocation.effect.id)
            || warlockPactProjection.states?.tome?.tome.cantripActionIds.includes(action.id)
            || warlockPactProjection.states?.tome?.tome.ritualActionIds.includes(action.id)
        ))
        .map((action) => action.id)
        .sort(),
      ...(Object.keys(featureSources).length ? { featureSources } : {}),
    },
    character: { ...character, resourceRecharge, resourceRecovery },
    runtime: {
      hp: { current: ruleState.maxHP, max: ruleState.maxHP, temp: 0 },
      resources: runtimeResources.resources,
      maxResources: runtimeResources.maxResources,
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    },
    passives,
    grantedEffects: grantedEffectsFor(rulesActions, catalogs),
    ...(masteryEffects ? { masteryEffects } : {}),
    ...(spellcastingAccess ? { spellcastingAccess } : {}),
    ...(traits ? { traits } : {}),
    ...(warlockPactProjection.states ? { warlockPacts: warlockPactProjection.states } : {}),
  };
  const decisions: MicroMvpL1Decision[] = assembled.pendingChoices.map((choice) => ({
    choiceId: choice.id,
    optionIds: [...choicesSelected(draft, choice)],
    stage: choice.context === 'in_play' ? 'rest' : 'creation',
    provenance: 'overlay-policy',
  }));
  if (base.speciesAudit.lineageId) {
    decisions.push({
      choiceId: `species:${base.speciesAudit.speciesId}:lineage`,
      optionIds: [base.speciesAudit.lineageId],
      stage: 'creation',
      provenance: 'overlay-policy',
    });
  }
  decisions.sort((left, right) => left.choiceId.localeCompare(right.choiceId));
  const selectedInvocationEffectIds = selectedInvocation ? [selectedInvocation.effect.id] : [];

  return {
    fixtureId,
    sourceFixtureId: raw.fixtureId,
    stableKey: raw.stableKey,
    matrixCase: raw.matrixCase,
    draft,
    assembled,
    actor,
    ruleState,
    decisions,
    speciesAudit: base.speciesAudit,
    unresolvedAcquireChoiceIds: unresolvedChoices(assembled, draft, false),
    unresolvedRuntimeChoiceIds: unresolvedChoices(assembled, draft, true),
    selectedSpellIds: assembled.spells.map((spell) => spell.id).sort(),
    selectedInvocationEffectIds,
    excludedResourceIds: base.excludedResourceIds,
    rulesActions,
    initialWorldObjects: warlockPactProjection.initialWorldObjects,
  };
}

function primitiveType(action: RuleActionDefinition): string | undefined {
  const primitive = action.mechanics.primitive;
  return primitive && typeof primitive === 'object'
    ? String((primitive as JsonObject).type ?? '') || undefined
    : undefined;
}

function spellPrimitiveGap(input: {
  roots: readonly CompiledMicroMvpL1Root[];
  spellCardNumbers: readonly string[];
  primitiveTypes: readonly string[];
  code: MicroMvpL1CapabilityGapCode;
  subjectId: string;
  message: string;
}): MicroMvpL1CapabilityGap | undefined {
  const applicable = input.roots.filter((root) => root.assembled.spells.some((spell) => (
    input.spellCardNumbers.includes(spell.card_number)
  )));
  const deficient = applicable.filter((root) => input.spellCardNumbers.some((cardNumber, index) => {
    const selected = root.assembled.spells.find((spell) => spell.card_number === cardNumber);
    if (!selected) return false;
    return !root.rulesActions.some((action) => (
      action.sourceEntityIds.includes(selected.id)
      && primitiveType(action) === input.primitiveTypes[index]
    ));
  }));
  if (applicable.length > 0 && deficient.length === 0) return undefined;
  return {
    code: input.code,
    subjectId: input.subjectId,
    status: applicable.length === 0 ? 'not_expressible' : 'partially_expressible',
    message: input.message,
    affectedRootCount: applicable.length === 0 ? 0 : deficient.length,
  };
}

function invocationCardNumber(root: CompiledMicroMvpL1Root): string | undefined {
  return root.assembled.effects.find(({ effect }) => (
    root.selectedInvocationEffectIds.includes(effect.id)
  ))?.effect.card_number;
}

function pactCapabilityGap(input: {
  roots: readonly CompiledMicroMvpL1Root[];
  invocationCardNumber: 'EFF-pact-blade' | 'EFF-pact-chain' | 'EFF-pact-tome';
  code: MicroMvpL1CapabilityGapCode;
  isExpressible: (root: CompiledMicroMvpL1Root) => boolean;
  message: string;
}): MicroMvpL1CapabilityGap | undefined {
  const applicable = input.roots.filter((root) => (
    invocationCardNumber(root) === input.invocationCardNumber
  ));
  const deficient = applicable.filter((root) => !input.isExpressible(root));
  if (applicable.length > 0 && deficient.length === 0) return undefined;
  return {
    code: input.code,
    subjectId: input.invocationCardNumber,
    status: applicable.length === 0 ? 'not_expressible' : 'partially_expressible',
    message: input.message,
    affectedRootCount: applicable.length === 0 ? 0 : deficient.length,
  };
}

/**
 * Derives the release capability gaps from compiled actions and focused Pact
 * branches.  It is exported so a mutation test can prove that removing a
 * primitive or typed Pact projection makes the oracle fail closed.
 */
export function deriveMicroMvpL1CapabilityGaps(input: {
  roots: readonly CompiledMicroMvpL1Root[];
  pactChoiceRoots: readonly CompiledMicroMvpL1Root[];
}): MicroMvpL1CapabilityGap[] {
  const gaps = [
    spellPrimitiveGap({
      roots: input.roots,
      spellCardNumbers: ['detect_magic'],
      primitiveTypes: ['detect_magic_world_sensing'],
      code: 'detect_magic_world_sensing',
      subjectId: 'detect_magic',
      message: 'Detect Magic must compile to the rules-core world-sensing primitive.',
    }),
    spellPrimitiveGap({
      roots: input.roots,
      spellCardNumbers: ['SPELL-0242', 'SPELL-0171'],
      primitiveTypes: ['burning_hands_objects', 'area_object_push'],
      code: 'environmental_object_effects',
      subjectId: 'SPELL-0242|SPELL-0171',
      message: 'Burning Hands and Thunderwave must compile their environmental object mutations.',
    }),
    spellPrimitiveGap({
      roots: input.roots,
      spellCardNumbers: ['light'],
      primitiveTypes: ['light_world_object'],
      code: 'light_world_illumination',
      subjectId: 'light',
      message: 'Light must compile to persistent world illumination.',
    }),
    spellPrimitiveGap({
      roots: input.roots,
      spellCardNumbers: ['minor_illusion'],
      primitiveTypes: ['minor_illusion_world_object'],
      code: 'minor_illusion_world_object_and_study',
      subjectId: 'minor_illusion',
      message: 'Minor Illusion must compile to a persistent, studyable world object.',
    }),
    pactCapabilityGap({
      roots: input.pactChoiceRoots,
      invocationCardNumber: 'EFF-pact-blade',
      code: 'warlock_pact_blade_bond_state',
      message: 'Pact Blade must compile a typed bond state and canonical bond action.',
      isExpressible: (root) => {
        const state = root.actor.warlockPacts?.blade;
        return Boolean(state
          && root.actor.capabilities.featureSources?.[PACT_BLADE_STATE_CAPABILITY]
          && root.rulesActions.some((action) => (
            action.id === state.bondActionId && primitiveType(action) === 'pact_blade_bond'
          )));
      },
    }),
    pactCapabilityGap({
      roots: input.pactChoiceRoots,
      invocationCardNumber: 'EFF-pact-chain',
      code: 'warlock_pact_chain_summoned_actor',
      message: 'Pact Chain must compile a typed familiar template and source-owned Find Familiar action.',
      isExpressible: (root) => {
        const state = root.actor.warlockPacts?.chain;
        return Boolean(state
          && root.actor.capabilities.featureSources?.[PACT_CHAIN_STATE_CAPABILITY]
          && root.rulesActions.some((action) => (
            action.id === state.template.findFamiliarActionId
            && primitiveType(action) === 'find_familiar'
          )));
      },
    }),
    pactCapabilityGap({
      roots: input.pactChoiceRoots,
      invocationCardNumber: 'EFF-pact-tome',
      code: 'warlock_pact_tome_book_rest_state',
      message: 'Pact Tome must compile rest-selected spells and a source-owned Book of Shadows.',
      isExpressible: (root) => {
        const state = root.actor.warlockPacts?.tome;
        if (!state || !root.actor.capabilities.featureSources?.[PACT_TOME_STATE_CAPABILITY]) return false;
        return state.tome.createdAfterRest === 'long'
          && state.tome.cantripActionIds.length === 3
          && state.tome.ritualActionIds.length === 2
          && root.initialWorldObjects.some((object) => object.id === state.tome.bookObjectId);
      },
    }),
  ];
  return gaps.filter((gap): gap is MicroMvpL1CapabilityGap => gap !== undefined);
}

function manifestScopeIssueSubjects(source: PinnedProdSnapshotL1Provider): Set<string> {
  return new Set(Object.values(source.scope).flat().map((item) => item.manifestKey));
}

function dispositionMatches(
  disposition: MicroMvpL1SourceIssueDisposition,
  issue: SnapshotFixtureIssue,
  manifestSubjects: ReadonlySet<string>,
): boolean {
  if (disposition.code !== issue.code) return false;
  if (disposition.subjects === 'compiler-invariant') return true;
  if (disposition.subjects === 'manifest-scope') return manifestSubjects.has(issue.subjectId);
  return disposition.subjects.includes(issue.subjectId);
}

export function sourceIssueDispositionProblems(
  source: PinnedProdSnapshotL1Provider,
): string[] {
  const problems: string[] = [];
  const manifestSubjects = manifestScopeIssueSubjects(source);
  const declaredCorrections = new Set<string>(MICRO_MVP_L1_OVERLAY_SPEC.sourceCorrections);
  const matched = new Set<MicroMvpL1SourceIssueDisposition>();
  for (const issue of source.issues) {
    const dispositions = MICRO_MVP_L1_SOURCE_ISSUE_DISPOSITIONS.filter((candidate) => (
      dispositionMatches(candidate, issue, manifestSubjects)
    ));
    if (dispositions.length !== 1) {
      problems.push(
        `source issue [${issue.code}] ${issue.subjectId} has ${dispositions.length} overlay dispositions`,
      );
      continue;
    }
    const disposition: MicroMvpL1SourceIssueDisposition = dispositions[0];
    matched.add(disposition);
    for (const correctionId of disposition.correctionIds) {
      if (!declaredCorrections.has(correctionId)) {
        problems.push(`source issue [${issue.code}] ${issue.subjectId} uses unknown correction ${correctionId}`);
      }
    }
    if (issue.code === 'missing_support_certification'
      && disposition.semanticEvidenceProfileId !== MICRO_MVP_L1_SEMANTIC_EVIDENCE_PROFILE_ID) {
      problems.push(`source issue ${issue.subjectId} is not bound to the semantic evidence profile`);
    }
  }
  for (const disposition of MICRO_MVP_L1_SOURCE_ISSUE_DISPOSITIONS) {
    if (!matched.has(disposition)) {
      problems.push(`stale source issue disposition [${disposition.code}] ${String(disposition.subjects)}`);
    }
  }
  return problems;
}

export function microMvpL1RootSemanticProjection(
  root: CompiledMicroMvpL1Root,
): JsonObject {
  return {
    stableKey: root.stableKey,
    decisions: root.decisions,
    lineage: root.speciesAudit.lineageCardNumber ?? null,
    effects: root.assembled.effects.map((item) => ({
      id: item.effect.id,
      cardNumber: item.effect.card_number,
      mechanics: item.effect.mechanics,
      origin: item.origin,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    actions: root.rulesActions,
    spells: root.assembled.spells.map((spell) => ({
      id: spell.id,
      cardNumber: spell.card_number,
      level: spell.level,
      concentration: spell.concentration,
      mechanics: spell.mechanics,
    })).sort((left, right) => left.id.localeCompare(right.id)),
    resources: root.actor.runtime.maxResources,
    proficiencies: root.actor.character.skillProficiencies,
    expertise: root.actor.character.skillExpertise,
    weaponMasteries: root.actor.character.weaponMasteries,
    masteryEffects: root.actor.masteryEffects,
    spellcastingAccess: root.actor.spellcastingAccess,
    traits: root.actor.traits,
    warlockPacts: root.actor.warlockPacts,
    initialWorldObjects: root.initialWorldObjects,
    languages: root.ruleState.proficiencies.languages,
    languageGrants: root.ruleState.appliedGrants
      .filter((grant) => grant.kind === 'language')
      .map((grant) => ({
        value: grant.value,
        choiceId: grant.choiceId ?? null,
        source: grant.source,
      })),
  };
}

function hasStructuredExecutableMechanics(mechanics: unknown): boolean {
  let executable = false;
  const visit = (value: unknown): void => {
    if (executable || value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== 'object') return;
    const record = value as JsonObject;
    if (record.primitive && typeof record.primitive === 'object') executable = true;
    if (typeof record.kind === 'string'
      && record.kind !== 'narrative'
      && record.kind !== 'choice') executable = true;
    Object.values(record).forEach(visit);
  };
  visit(mechanics);
  return executable;
}

function compiledMechanicsForSubject(
  roots: readonly CompiledMicroMvpL1Root[],
  subjectId: string,
): unknown[] {
  const mechanics: unknown[] = [];
  for (const root of roots) {
    mechanics.push(...root.assembled.effects.flatMap(({ effect }) => (
      effect.card_number === subjectId ? [effect.mechanics] : []
    )));
    mechanics.push(...root.rulesActions.flatMap((action) => (
      action.sourceEntityIds.includes(subjectId) ? [action.mechanics] : []
    )));
  }
  return mechanics;
}

function readinessProblems(provider: CompiledMicroMvpL1Provider): string[] {
  const problems: string[] = [...sourceIssueDispositionProblems(provider.source)];
  const actualContentPatchHash = hashCanonical(MICRO_MVP_L1_CONTENT_PATCH);
  if (actualContentPatchHash !== PINNED_MICRO_MVP_L1_CONTENT_PATCH_HASH) {
    problems.push(`content patch hash mismatch: ${actualContentPatchHash}`);
  }
  if (provider.roots.length !== 448) problems.push(`expected 448 roots, got ${provider.roots.length}`);
  if (new Set(provider.roots.map((root) => root.fixtureId)).size !== 448) problems.push('fixture IDs are not unique');
  if (provider.capabilityGaps.length !== 0) {
    problems.push(`unresolved capability gaps: ${provider.capabilityGaps.map((gap) => gap.code).join(', ')}`);
  }
  for (const root of provider.roots) {
    if (root.unresolvedAcquireChoiceIds.length) {
      problems.push(`${root.stableKey}: unresolved acquire choices ${root.unresolvedAcquireChoiceIds.join(', ')}`);
    }
    if (root.unresolvedRuntimeChoiceIds.length) {
      problems.push(`${root.stableKey}: unresolved runtime choices ${root.unresolvedRuntimeChoiceIds.join(', ')}`);
    }
    if ('wild_shape' in root.actor.runtime.maxResources || 'sorcery_points' in root.actor.runtime.maxResources) {
      problems.push(`${root.stableKey}: L2 resource leaked into L1 runtime`);
    }
    if (root.matrixCase.klass.card_number === 'CLASS-warlock'
      && root.selectedInvocationEffectIds.length !== 1) {
      problems.push(`${root.stableKey}: expected exactly one L1 invocation`);
    }
    const klass = root.matrixCase.klass as CharacterClass;
    if (root.actor.capabilities.actionIds.some((id) => {
      const action = provider.catalog.getAction(id);
      return action?.sourceEntityIds.some((sourceId) => (
        klass.level_progression?.['2']?.actions?.includes(sourceId)
      ));
    })) {
      problems.push(`${root.stableKey}: L2 action leaked into capabilities`);
    }
  }
  for (const issue of provider.source.issues.filter((candidate) => (
    candidate.code === 'narrative_only_mechanic'
  ))) {
    const compiled = compiledMechanicsForSubject(provider.roots, issue.subjectId);
    if (compiled.length === 0 || !compiled.every(hasStructuredExecutableMechanics)) {
      problems.push(`${issue.subjectId}: narrative source record has no structured compiled replacement`);
    }
  }
  if (provider.release.overlayHash !== PINNED_MICRO_MVP_L1_OVERLAY_HASH) {
    problems.push(`overlay hash mismatch: ${provider.release.overlayHash}`);
  }
  if (provider.release.contentHash !== PINNED_MICRO_MVP_L1_COMPILED_CONTENT_HASH) {
    problems.push(`compiled content hash mismatch: ${provider.release.contentHash}`);
  }
  if (provider.release.releaseHash !== PINNED_MICRO_MVP_L1_COMPILED_RELEASE_HASH) {
    problems.push(`compiled release hash mismatch: ${provider.release.releaseHash}`);
  }
  return problems;
}

function bindPinnedSourceRootsToCatalogs(
  source: PinnedProdSnapshotL1Provider,
  catalogs: SnapshotCatalogs,
): PinnedProdSnapshotL1Provider {
  const exact = <T extends { id: string; card_number: string }>(
    entities: readonly T[],
    expected: { id: string; card_number: string },
    label: string,
  ): T => {
    const matches = entities.filter((entity) => entity.id === expected.id);
    if (matches.length !== 1 || matches[0].card_number !== expected.card_number) {
      throw new MicroMvpL1OverlayReadinessError([
        `${label}: fetched catalog must contain exactly ${expected.id}/${expected.card_number}`,
      ]);
    }
    return matches[0];
  };
  const roots = source.roots.map((root): PinnedL1RootFixture => ({
    ...root,
    matrixCase: {
      ...root.matrixCase,
      klass: exact(catalogs.classes, root.matrixCase.klass, `${root.stableKey}:class`),
      species: exact(catalogs.races, root.matrixCase.species, `${root.stableKey}:species`),
      background: exact(
        catalogs.backgrounds,
        root.matrixCase.background,
        `${root.stableKey}:background`,
      ),
      originFeat: exact(catalogs.feats, root.matrixCase.originFeat, `${root.stableKey}:origin-feat`),
    },
  }));
  const byId = new Map(roots.map((root) => [root.fixtureId, root]));
  return {
    ...source,
    roots,
    getActor: (fixtureId) => byId.get(fixtureId)?.actor,
    getFixture: (fixtureId) => byId.get(fixtureId),
  };
}

function compilePactCapabilityChoiceRoots(input: {
  source: PinnedProdSnapshotL1Provider;
  catalogs: SnapshotCatalogs;
  spellScope: MicroMvpSpellCompileScope;
}): {
  roots: CompiledMicroMvpL1Root[];
  gaps: MicroMvpL1CapabilityGap[];
} {
  const raw = input.source.roots.find((root) => (
    root.matrixCase.klass.card_number === 'CLASS-warlock'
  ));
  const probes = [
    ['EFF-pact-blade', 'warlock_pact_blade_bond_state'],
    ['EFF-pact-chain', 'warlock_pact_chain_summoned_actor'],
    ['EFF-pact-tome', 'warlock_pact_tome_book_rest_state'],
  ] as const;
  if (!raw) {
    return {
      roots: [],
      gaps: probes.map(([subjectId, code]) => ({
        code,
        subjectId,
        status: 'not_expressible',
        message: 'No level-1 Warlock root exists for the focused Pact compile probe.',
        affectedRootCount: 0,
      })),
    };
  }
  const roots: CompiledMicroMvpL1Root[] = [];
  const gaps: MicroMvpL1CapabilityGap[] = [];
  for (const [option, code] of probes) {
    try {
      roots.push(compileRoot(
        raw,
        input.catalogs,
        input.spellScope,
        MICRO_MVP_L1_OVERLAY_RELEASE_ID,
        { warlock_invocation_l1: [option] },
        `:capability-probe:${option}`,
      ));
    } catch (error) {
      gaps.push({
        code,
        subjectId: option,
        status: 'not_expressible',
        message: `Focused Pact compile failed: ${error instanceof Error ? error.message : String(error)}`,
        affectedRootCount: 64,
      });
    }
  }
  return { roots, gaps };
}

async function compileMicroMvpL1OverlayWithCatalogs(input: {
  source: PinnedProdSnapshotL1Provider;
  sourceCatalogs: SnapshotCatalogs;
  manifest: MicroMvpSnapshotManifest;
  contentPatchMode?: ContentPatchMode;
}): Promise<CompiledMicroMvpL1Provider> {
  const { source, sourceCatalogs, manifest, contentPatchMode = 'apply' } = input;
  const spellScope = createSpellCompileScope(spellScopeReadiness(
    'micro-MVP spell compile boundary',
    () => buildMicroMvpSpellScopePolicy({ manifest, snapshotSpells: sourceCatalogs.spells }),
  ));
  const catalogs = catalogContentForCompilation(sourceCatalogs, contentPatchMode);
  // Field patches (for example a class progression relation) are database-owned
  // inputs just like mechanics. Rebind matrix roots after materialization so the
  // compiler cannot compensate with entity UUID/card-number behavior branches.
  const compilationSource = bindPinnedSourceRootsToCatalogs(source, catalogs);
  const overlayHash = hashCanonical(MICRO_MVP_L1_OVERLAY_SPEC);
  // Root IDs need a stable release identity, while the compiled content hash is
  // intentionally derived from semantic projections rather than self-referential IDs.
  const roots = compilationSource.roots.map((root) => compileRoot(
    root,
    catalogs,
    spellScope,
    MICRO_MVP_L1_OVERLAY_RELEASE_ID,
  ));
  const pactProbes = compilePactCapabilityChoiceRoots({
    source: compilationSource,
    catalogs,
    spellScope,
  });
  const failedProbeCodes = new Set(pactProbes.gaps.map((gap) => gap.code));
  const gaps = [
    ...pactProbes.gaps,
    ...deriveMicroMvpL1CapabilityGaps({
      roots,
      pactChoiceRoots: pactProbes.roots,
    }).filter((gap) => !failedProbeCodes.has(gap.code)),
  ];
  const contentHash = hashCanonical({
    sourceContentHash: source.release.contentHash,
    overlayHash,
    roots: roots.map(microMvpL1RootSemanticProjection),
    capabilityGaps: gaps,
  });
  const releaseHash = hashCanonical({
    id: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
    sourceReleaseHash: source.release.releaseHash,
    overlayHash,
    contentHash,
  });
  const ruleset: RulesetReference = {
    systemId: 'dnd5e-2024',
    releaseId: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
    contentHash,
    errataVersion: source.release.errataVersion,
  };
  const actionMap = new Map<string, RuleActionDefinition>();
  for (const root of roots) {
    root.actor.id = root.fixtureId;
    for (const action of root.rulesActions) {
      const existing = actionMap.get(action.id);
      if (existing && canonicalStringify(existing) !== canonicalStringify(action)) {
        throw new MicroMvpL1OverlayReadinessError([`action ${action.id} compiled inconsistently across roots`]);
      }
      actionMap.set(action.id, action);
    }
  }
  const globalWeaponPrimitiveTypes = new Set<string>([
    'unarmed_strike',
    WEAPON_ATTACK_PRIMITIVE,
    LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  ]);
  const globalActions = catalogs.actions
    .filter((action) => {
      const primitive = action.mechanics?.primitive;
      const type = primitive && typeof primitive === 'object' && !Array.isArray(primitive)
        ? (primitive as JsonObject).type
        : undefined;
      return (typeof type === 'string' && globalWeaponPrimitiveTypes.has(type))
        || action.card_number === 'action_basic_unarmed';
    })
    .map((action) => toRulesAction(action))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const action of globalActions) {
    const existing = actionMap.get(action.id);
    if (existing && canonicalStringify(existing) !== canonicalStringify(action)) {
      throw new MicroMvpL1OverlayReadinessError([
        `global action ${action.id} conflicts with a feature-scoped action`,
      ]);
    }
    actionMap.set(action.id, action);
  }
  const byId = new Map(roots.map((root) => [root.fixtureId, root]));
  const cardById = new Map(catalogs.cards.map((card) => [card.id, card] as const));
  return {
    source,
    release: {
      id: MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      systemId: 'dnd5e-2024',
      rulesetVersion: source.release.rulesetVersion,
      errataVersion: source.release.errataVersion,
      sourceReleaseId: source.release.id,
      sourceContentHash: source.release.contentHash,
      overlayHash,
      contentHash,
      releaseHash,
    },
    ruleset,
    roots,
    globalActions,
    capabilityGaps: gaps,
    catalog: {
      getAction: (id) => actionMap.get(id),
      listActions: () => [...actionMap.values()],
      getCard: (id) => cardById.get(id),
    },
    getRoot: (fixtureId) => byId.get(fixtureId),
    getActor: (fixtureId) => byId.get(fixtureId)?.actor,
    getInitialWorldObjects: (fixtureId) => byId.get(fixtureId)?.initialWorldObjects,
  };
}

export async function compileMicroMvpL1Overlay(): Promise<CompiledMicroMvpL1Provider> {
  const [source, sourceCatalogs, manifest] = await Promise.all([
    loadPinnedProdSnapshotL1Provider(),
    Promise.resolve(readProdSnapshotCatalogs()),
    readMicroMvpSnapshotManifest(),
  ]);
  return compileMicroMvpL1OverlayWithCatalogs({ source, sourceCatalogs, manifest });
}

/**
 * Compiles caller-supplied catalog records through the exact production
 * overlay/rules-core release.  The pinned provider supplies only the reviewed
 * matrix blueprint and source release identity; each matrix entity is rebound
 * to the fetched catalog by exact immutable ID and card number.
 *
 * The live certification layer must first attest the complete normalized
 * catalog input hash.  This entrypoint intentionally does not replace drifted
 * records with pinned fixture bytes.
 */
export async function compileMicroMvpL1OverlayFromCatalogs(
  sourceCatalogs: SnapshotCatalogs,
): Promise<CompiledMicroMvpL1Provider> {
  const [pinnedSource, manifest] = await Promise.all([
    loadPinnedProdSnapshotL1Provider(),
    readMicroMvpSnapshotManifest(),
  ]);
  const source = bindPinnedSourceRootsToCatalogs(pinnedSource, sourceCatalogs);
  return compileMicroMvpL1OverlayWithCatalogs({ source, sourceCatalogs, manifest });
}

/**
 * Production acceptance entrypoint. It refuses to compile if any declarative
 * mechanics or relationship correction still needs the migration adapter.
 * Thus a green result proves the released catalog is already authoritative.
 */
export async function compileMicroMvpL1MaterializedCatalogs(
  sourceCatalogs: SnapshotCatalogs,
): Promise<CompiledMicroMvpL1Provider> {
  const [pinnedSource, manifest] = await Promise.all([
    loadPinnedProdSnapshotL1Provider(),
    readMicroMvpSnapshotManifest(),
  ]);
  const source = bindPinnedSourceRootsToCatalogs(pinnedSource, sourceCatalogs);
  return compileMicroMvpL1OverlayWithCatalogs({
    source,
    sourceCatalogs,
    manifest,
    contentPatchMode: 'verify-only',
  });
}

/**
 * Compile one focused decision branch against the exact pinned snapshot and
 * overlay policy. This is intentionally separate from the production matrix:
 * callers use it to prove that non-default class/species choices grant the
 * right mechanics and provenance.
 */
export async function compileMicroMvpL1ChoiceVariant(input: {
  stableKey: string;
  overrides: MicroMvpL1ChoiceOverrides;
}): Promise<CompiledMicroMvpL1Root> {
  const [variant] = await compileMicroMvpL1ChoiceVariants([input]);
  return variant;
}

/** Batch form avoids rebuilding the pinned provider for every test branch. */
export async function compileMicroMvpL1ChoiceVariants(
  inputs: readonly {
    stableKey: string;
    overrides: MicroMvpL1ChoiceOverrides;
  }[],
): Promise<CompiledMicroMvpL1Root[]> {
  const [source, sourceCatalogs, manifest] = await Promise.all([
    loadPinnedProdSnapshotL1Provider(),
    Promise.resolve(readProdSnapshotCatalogs()),
    readMicroMvpSnapshotManifest(),
  ]);
  const spellScope = createSpellCompileScope(spellScopeReadiness(
    'micro-MVP spell compile boundary',
    () => buildMicroMvpSpellScopePolicy({ manifest, snapshotSpells: sourceCatalogs.spells }),
  ));
  const catalogs = catalogContentForCompilation(sourceCatalogs);
  const compilationSource = bindPinnedSourceRootsToCatalogs(source, catalogs);
  return inputs.map((input) => {
    const raw = compilationSource.roots.find((root) => root.stableKey === input.stableKey);
    if (!raw) {
      throw new MicroMvpL1OverlayReadinessError([`unknown source root ${input.stableKey}`]);
    }
    const suffix = hashCanonical({ stableKey: input.stableKey, overrides: input.overrides }).slice(7, 19);
    return compileRoot(
      raw,
      catalogs,
      spellScope,
      MICRO_MVP_L1_OVERLAY_RELEASE_ID,
      input.overrides,
      `:choice-variant:${suffix}`,
    );
  });
}

export function assertMicroMvpL1OverlayReady(provider: CompiledMicroMvpL1Provider): void {
  const problems = readinessProblems(provider);
  if (problems.length) throw new MicroMvpL1OverlayReadinessError(problems);
}
