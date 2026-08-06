import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assemble,
  collectEffectGrantRefs,
  gatherFeatureRefs,
} from '../character/assemble';
import type {
  AssembledCharacter,
  EntityBundle,
  OriginAction,
  OriginEffect,
} from '../character/assemble';
import { buildCharacterContext } from '../character/runtime';
import { syncRuntimeResources } from '../character/resourceInit';
import { resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { emptyDraft } from '../character/types';
import type { AbilityKey, CharacterDraft } from '../character/types';
import { canonicalStringify } from '../rules-core/determinism';
import type { ActorState, RulesetReference } from '../rules-core/domain';
import type {
  Action,
  Background,
  Card,
  CharacterClass,
  Feat,
  PassiveEffect,
  Race,
  ResourceDefinition,
  Spell,
  Variable,
} from '../types';
import {
  createMicroMvpMatrix,
  FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
} from './microMicroMatrix';
import type {
  MicroMvpMatrixCase,
  MicroMvpMatrixScope,
  MicroMvpOriginFeatGrant,
} from './microMicroMatrix';

type JsonObject = Record<string, unknown>;
type CollectionName = 'classes' | 'species' | 'backgrounds' | 'originFeats';
type SnapshotEntityType = 'class' | 'race' | 'background' | 'feat' | 'effect' | 'action' | 'spell';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');
export const PROD_SNAPSHOT_DIRECTORY = join(REPO_ROOT, 'officials/canon/prod-snapshot');

export const PINNED_PROD_SNAPSHOT_L1_RELEASE_ID = 'prod-snapshot@2026-08-06.micro-mvp-l1.v2';
export const PINNED_PROD_SNAPSHOT_L1_RULES_HASH =
  'sha256:743d07a76b6bb459062a055daa360bf80c28de43e16b27be61e1ae2783221c3b' as const;
export const PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH =
  'sha256:95556fca97630dd76af1cdc5e991635f42eca5379d85432c23075c0cb0bfb17d' as const;
export const PINNED_PROD_SNAPSHOT_L1_RELEASE_HASH =
  'sha256:306bcbcac6bfc154b27d067a2ee8b52c9e1f0dd1e0bc96a065f106761c72fda1' as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VOLATILE_FIELDS = new Set(['support', 'created_at', 'updated_at', 'deleted_at']);
const RULE_SOURCE_ARTIFACTS = [
  "officials/Player's Handbook 2024.txt",
  'officials/Книга игрока 2024.txt',
] as const;

export interface SnapshotCatalogs {
  cards: Card[];
  classes: CharacterClass[];
  races: Race[];
  backgrounds: Background[];
  feats: Feat[];
  effects: PassiveEffect[];
  actions: Action[];
  spells: Spell[];
  resources: ResourceDefinition[];
  variables: Variable[];
}

interface ManifestEntry {
  key: string;
  label: string;
  selector: { cardNumber?: string };
  expected?: Record<string, unknown>;
}

export interface MicroMvpSnapshotManifest {
  schemaVersion: number;
  manifestVersion: string;
  release: string;
  systemId: 'dnd5e-2024';
  rulesetVersion: string;
  characterLevel: number;
  sourceTrack: string;
  errataVersion: string;
  sourceCorpus: unknown[];
  errata: unknown[];
  productRules: unknown[];
  collections: Record<string, ManifestEntry[]> & Record<CollectionName, ManifestEntry[]>;
}

export interface PinnedSnapshotEntity<T> {
  manifestKey: string;
  id: string;
  cardNumber: string;
  entity: T;
}

export interface PinnedSnapshotScope {
  classes: PinnedSnapshotEntity<CharacterClass>[];
  species: PinnedSnapshotEntity<Race>[];
  backgrounds: PinnedSnapshotEntity<Background>[];
  originFeats: PinnedSnapshotEntity<Feat>[];
}

export type SnapshotFixtureIssueCode =
  | 'background_origin_feat_leak'
  | 'broken_reference'
  | 'higher_level_ability_leak'
  | 'l1_choice_unresolved'
  | 'l1_warlock_invocation_mismatch'
  | 'l2_resource_source_leak'
  | 'missing_support_certification'
  | 'narrative_only_mechanic'
  | 'release_hash_mismatch';

export interface SnapshotFixtureIssue {
  severity: 'error' | 'warning';
  code: SnapshotFixtureIssueCode;
  subjectId: string;
  message: string;
  affectedRootCount?: number;
}

export interface PinnedSnapshotRelease {
  id: typeof PINNED_PROD_SNAPSHOT_L1_RELEASE_ID;
  systemId: 'dnd5e-2024';
  rulesetVersion: string;
  errataVersion: string;
  rulesHash: string;
  contentHash: string;
  releaseHash: string;
  sourceArtifactHashes: Readonly<Record<string, string>>;
  dependencyEntityCount: number;
}

export interface OriginFeatGrantAudit {
  productRuleId: typeof FREE_ORIGIN_FEAT_CHOICE_RULE_ID;
  selectedOriginFeatId: string;
  suppressedOfficialBackgroundFeatId?: string;
  grants: MicroMvpOriginFeatGrant[];
}

export type FixtureActorState = ActorState & {
  capabilities: { actionIds: string[] };
};

export interface PinnedL1RootFixture {
  fixtureId: string;
  stableKey: string;
  matrixCase: MicroMvpMatrixCase;
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  actor: FixtureActorState;
  originFeatAudit: OriginFeatGrantAudit;
  unresolvedAcquireChoiceIds: string[];
  rawExcludedL2Resources: string[];
  higherLevelEffectIds: string[];
  higherLevelActionIds: string[];
}

export interface PinnedProdSnapshotL1Provider {
  release: PinnedSnapshotRelease;
  ruleset: RulesetReference;
  scope: PinnedSnapshotScope;
  roots: readonly PinnedL1RootFixture[];
  issues: readonly SnapshotFixtureIssue[];
  getActor(fixtureId: string): FixtureActorState | undefined;
  getFixture(fixtureId: string): PinnedL1RootFixture | undefined;
}

export class PinnedSnapshotStructureError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Pinned prod snapshot is structurally invalid:\n${problems.join('\n')}`);
    this.name = 'PinnedSnapshotStructureError';
  }
}

export class PinnedSnapshotReadinessError extends Error {
  constructor(readonly issues: readonly SnapshotFixtureIssue[]) {
    super([
      `Pinned L1 fixture release has ${issues.length} blocking issue(s):`,
      ...issues.map((issue) => `[${issue.code}] ${issue.subjectId}: ${issue.message}`),
    ].join('\n'));
    this.name = 'PinnedSnapshotReadinessError';
  }
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(PROD_SNAPSHOT_DIRECTORY, `${name}.json`), 'utf8')) as T;
}

/** Reads immutable fixture files only; this path never calls API/fetch/axios. */
export function readProdSnapshotCatalogs(): SnapshotCatalogs {
  return {
    cards: readJson<Card[]>('cards'),
    classes: readJson<CharacterClass[]>('classes'),
    races: readJson<Race[]>('races'),
    backgrounds: readJson<Background[]>('backgrounds'),
    feats: readJson<Feat[]>('feats'),
    effects: readJson<PassiveEffect[]>('effects'),
    actions: readJson<Action[]>('actions'),
    spells: readJson<Spell[]>('spells'),
    resources: readJson<ResourceDefinition[]>('resources'),
    variables: readJson<Variable[]>('variables'),
  };
}

export async function readMicroMvpSnapshotManifest(): Promise<MicroMvpSnapshotManifest> {
  const manifestUrl = new URL('../../../scripts/content/micro-mvp-manifest.mjs', import.meta.url);
  const module = await import(/* @vite-ignore */ manifestUrl.href) as {
    MICRO_MVP_MANIFEST: MicroMvpSnapshotManifest;
  };
  return module.MICRO_MVP_MANIFEST;
}

function sha256(data: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function semanticValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(semanticValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .filter((key) => !VOLATILE_FIELDS.has(key) && record[key] !== undefined)
      .sort()
      .map((key) => [key, semanticValue(record[key])]),
  );
}

function hashCanonical(value: unknown): string {
  return sha256(canonicalStringify(semanticValue(value)));
}

function sourceArtifactHashes(): Record<string, string> {
  return Object.fromEntries(RULE_SOURCE_ARTIFACTS.map((relativePath) => [
    relativePath,
    sha256(readFileSync(join(REPO_ROOT, relativePath))),
  ]));
}

function stableRecord(entity: { id: string; card_number?: string }, type: SnapshotEntityType) {
  return {
    type,
    identity: `${type}:${entity.id}`,
    id: entity.id,
    cardNumber: entity.card_number ?? '',
    entity,
  };
}

function dependencyClosure(
  seeds: Array<ReturnType<typeof stableRecord>>,
  catalogs: SnapshotCatalogs,
): Array<ReturnType<typeof stableRecord>> {
  const records = [
    ...catalogs.classes.map((entity) => stableRecord(entity, 'class')),
    ...catalogs.races.map((entity) => stableRecord(entity, 'race')),
    ...catalogs.backgrounds.map((entity) => stableRecord(entity, 'background')),
    ...catalogs.feats.map((entity) => stableRecord(entity, 'feat')),
    ...catalogs.effects.map((entity) => stableRecord(entity, 'effect')),
    ...catalogs.actions.map((entity) => stableRecord(entity, 'action')),
    ...catalogs.spells.map((entity) => stableRecord(entity, 'spell')),
  ];
  const byReference = new Map<string, Array<ReturnType<typeof stableRecord>>>();
  for (const record of records) {
    for (const reference of [record.id, record.cardNumber]) {
      if (!reference) continue;
      byReference.set(reference, [...(byReference.get(reference) ?? []), record]);
    }
  }

  const selected = new Map(seeds.map((record) => [record.identity, record]));
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        for (const dependency of byReference.get(value) ?? []) {
          if (selected.has(dependency.identity)) continue;
          selected.set(dependency.identity, dependency);
          queue.push(dependency);
        }
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (!VOLATILE_FIELDS.has(key)) visit(nested);
      }
    };
    visit(current.entity);
  }
  return [...selected.values()].sort((left, right) => left.identity.localeCompare(right.identity));
}

function resolveManifestCollection<T extends { id: string; card_number: string }>(
  name: string,
  entries: readonly ManifestEntry[],
  catalog: readonly T[],
  problems: string[],
): PinnedSnapshotEntity<T>[] {
  return entries.flatMap((entry) => {
    const cardNumber = entry.selector.cardNumber;
    if (!cardNumber) {
      problems.push(`${entry.key}: snapshot fixture requires selector.cardNumber`);
      return [];
    }
    const matches = catalog.filter((entity) => entity.card_number === cardNumber);
    if (matches.length !== 1) {
      problems.push(`${entry.key}: expected exactly one ${name}/${cardNumber}, got ${matches.length}`);
      return [];
    }
    const entity = matches[0];
    if (!UUID_PATTERN.test(entity.id)) {
      problems.push(`${entry.key}: unstable or invalid entity id ${entity.id}`);
    }
    return [{ manifestKey: entry.key, id: entity.id, cardNumber, entity }];
  });
}

function resolveScope(
  manifest: MicroMvpSnapshotManifest,
  catalogs: SnapshotCatalogs,
): PinnedSnapshotScope {
  const problems: string[] = [];
  const scope: PinnedSnapshotScope = {
    classes: resolveManifestCollection('class', manifest.collections.classes, catalogs.classes, problems),
    species: resolveManifestCollection('race', manifest.collections.species, catalogs.races, problems),
    backgrounds: resolveManifestCollection(
      'background', manifest.collections.backgrounds, catalogs.backgrounds, problems,
    ),
    originFeats: resolveManifestCollection('feat', manifest.collections.originFeats, catalogs.feats, problems),
  };
  const expected = { classes: 7, species: 4, backgrounds: 4, originFeats: 4 } as const;
  for (const [key, count] of Object.entries(expected) as Array<[keyof typeof expected, number]>) {
    if (scope[key].length !== count) problems.push(`${key}: expected ${count}, got ${scope[key].length}`);
    const ids = scope[key].map((item) => item.id);
    if (new Set(ids).size !== ids.length) problems.push(`${key}: duplicate resolved UUIDs`);
  }
  const allIds = Object.values(scope).flat().map((item) => item.id);
  if (new Set(allIds).size !== allIds.length) problems.push('resolved root UUIDs collide across collections');
  if (problems.length) throw new PinnedSnapshotStructureError(problems);
  return scope;
}

function releaseSeeds(
  manifest: MicroMvpSnapshotManifest,
  catalogs: SnapshotCatalogs,
): Array<ReturnType<typeof stableRecord>> {
  const typeByCollection: Record<string, SnapshotEntityType> = {
    classes: 'class', species: 'race', backgrounds: 'background', originFeats: 'feat',
    cantrips: 'spell', firstLevelSpells: 'spell', fightingStyles: 'feat',
  };
  const catalogByType: Record<SnapshotEntityType, Array<{ id: string; card_number?: string }>> = {
    class: catalogs.classes,
    race: catalogs.races,
    background: catalogs.backgrounds,
    feat: catalogs.feats,
    effect: catalogs.effects,
    action: catalogs.actions,
    spell: catalogs.spells,
  };
  return Object.entries(manifest.collections).flatMap(([collection, entries]) => {
    const type = typeByCollection[collection];
    if (!type) return [];
    return entries.flatMap((entry) => {
      const matches = catalogByType[type].filter(
        (entity) => entity.card_number === entry.selector.cardNumber,
      );
      return matches.length === 1 ? [stableRecord(matches[0] as { id: string; card_number?: string }, type)] : [];
    });
  });
}

function computeRelease(
  manifest: MicroMvpSnapshotManifest,
  catalogs: SnapshotCatalogs,
): PinnedSnapshotRelease {
  const artifacts = sourceArtifactHashes();
  const rulesHash = hashCanonical({
    schemaVersion: manifest.schemaVersion,
    manifestVersion: manifest.manifestVersion,
    systemId: manifest.systemId,
    rulesetVersion: manifest.rulesetVersion,
    characterLevel: manifest.characterLevel,
    sourceTrack: manifest.sourceTrack,
    errataVersion: manifest.errataVersion,
    sourceCorpus: manifest.sourceCorpus,
    errata: manifest.errata,
    productRules: manifest.productRules,
    sourceArtifactHashes: artifacts,
  });
  const dependencies = dependencyClosure(releaseSeeds(manifest, catalogs), catalogs);
  const contentHash = hashCanonical(dependencies.map((record) => ({
    type: record.type,
    identity: record.identity,
    cardNumber: record.cardNumber,
    entity: record.entity,
  })));
  const releaseHash = hashCanonical({
    id: PINNED_PROD_SNAPSHOT_L1_RELEASE_ID,
    rulesHash,
    contentHash,
  });
  return {
    id: PINNED_PROD_SNAPSHOT_L1_RELEASE_ID,
    systemId: manifest.systemId,
    rulesetVersion: manifest.rulesetVersion,
    errataVersion: manifest.errataVersion,
    rulesHash,
    contentHash,
    releaseHash,
    sourceArtifactHashes: artifacts,
    dependencyEntityCount: dependencies.length,
  };
}

function byReference<T extends { id: string; card_number?: string }>(entities: readonly T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const entity of entities) {
    for (const reference of [entity.id, entity.card_number]) {
      if (!reference) continue;
      result.set(reference, [...(result.get(reference) ?? []), entity]);
    }
  }
  return result;
}

function uniqueReference<T>(
  index: Map<string, T[]>,
  reference: string,
  kind: string,
  issues: SnapshotFixtureIssue[],
): T | undefined {
  const matches = index.get(reference) ?? [];
  if (matches.length !== 1) {
    issues.push({
      severity: 'error',
      code: 'broken_reference',
      subjectId: reference,
      message: `${kind} reference resolves to ${matches.length} records`,
    });
    return undefined;
  }
  return matches[0];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function materializeEffectTypeChoices(
  effects: OriginEffect[],
  allEffects: readonly PassiveEffect[],
): void {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as JsonObject;
    if (record.kind === 'choice') {
      const options = record.options as JsonObject | undefined;
      if (options?.source === 'effect_type') {
        const type = String(options.type ?? '');
        const candidates = allEffects
          .filter((effect) => effect.type === type)
          .sort((left, right) => left.id.localeCompare(right.id));
        options.source = 'effect';
        options.items = candidates.map((effect) => ({
          id: effect.card_number || effect.id,
          name: effect.name,
          value: effect.card_number || effect.id,
        }));
        delete options.type;
        if (record.count === 'all' || options.count === 'all') record.count = candidates.length || 1;
      }
    }
    Object.values(record).forEach(visit);
  };
  effects.forEach(({ effect }) => visit(effect.mechanics));
}

function expandLocalEffectGrants(
  base: OriginEffect[],
  draft: CharacterDraft,
  effectIndex: Map<string, PassiveEffect[]>,
  issues: SnapshotFixtureIssue[],
): OriginEffect[] {
  const result = [...base];
  const seen = new Set(base.flatMap(({ effect }) => [effect.id, effect.card_number].filter(Boolean)));
  let frontier = [...base];
  for (let depth = 0; depth < 6 && frontier.length; depth += 1) {
    const next: OriginEffect[] = [];
    for (const item of frontier) {
      const references = collectEffectGrantRefs(item.effect.mechanics, item.effect.id, item.origin, draft);
      for (const reference of references) {
        if (seen.has(reference)) continue;
        seen.add(reference);
        const effect = uniqueReference(effectIndex, reference, 'effect grant', issues);
        if (!effect || seen.has(effect.id)) continue;
        seen.add(effect.id);
        if (effect.card_number) seen.add(effect.card_number);
        const expanded = { effect: cloneJson(effect), origin: item.origin };
        result.push(expanded);
        next.push(expanded);
      }
    }
    frontier = next;
  }
  return result;
}

function choiceBlockers(assembled: AssembledCharacter, draft: CharacterDraft): string[] {
  return assembled.pendingChoices
    .filter((choice) => choice.context !== 'in_play')
    .filter((choice) => (draft.resolvedChoices[choice.id] ?? []).length < choice.count)
    .map((choice) => choice.id)
    .sort();
}

function levelReferences(
  entity: { level_progression?: Record<string, { effects?: string[] | null; actions?: string[] | null }> | null },
  predicate: (level: number) => boolean,
): { effectIds: string[]; actionIds: string[] } {
  const effectIds: string[] = [];
  const actionIds: string[] = [];
  for (const [rawLevel, entry] of Object.entries(entity.level_progression ?? {})) {
    if (!predicate(Number(rawLevel))) continue;
    effectIds.push(...(entry.effects ?? []));
    actionIds.push(...(entry.actions ?? []));
  }
  return { effectIds, actionIds };
}

function containsExactValue(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsExactValue(item, expected));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as JsonObject).some((item) => containsExactValue(item, expected));
}

function classResourceUnlockedAtL1(
  definition: unknown,
  resourceId: string,
  assembled: AssembledCharacter,
): boolean {
  if (!definition || typeof definition !== 'object') return false;
  const row = definition as JsonObject;
  if (row.by_level && typeof row.by_level === 'object') {
    return Object.entries(row.by_level as JsonObject)
      .some(([level, value]) => Number(level) <= 1 && Number(value) > 0);
  }
  return [...assembled.effects.map((item) => item.effect.mechanics),
    ...assembled.actions.map((item) => item.action.mechanics)]
    .some((mechanics) => containsExactValue(mechanics, resourceId));
}

function withoutUnprovenL2Resources(
  assembled: AssembledCharacter,
  runtime: { resources: Record<string, number>; maxResources: Record<string, number> },
): { resources: Record<string, number>; maxResources: Record<string, number>; excluded: string[] } {
  const resources = { ...runtime.resources };
  const maxResources = { ...runtime.maxResources };
  const definitions = (assembled.klass?.resources ?? {}) as JsonObject;
  const excluded = Object.entries(definitions).flatMap(([resourceId, definition]) => {
    if (!(maxResources[resourceId] > 0)) return [];
    if (classResourceUnlockedAtL1(definition, resourceId, assembled)) return [];
    delete resources[resourceId];
    delete maxResources[resourceId];
    return [resourceId];
  });
  return { resources, maxResources, excluded: excluded.sort() };
}

function sourceKinds(value: unknown): Set<string> {
  const result = new Set<string>();
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== 'object') return;
    const record = item as JsonObject;
    if (typeof record.kind === 'string') result.add(record.kind);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return result;
}

function stableKeyForCase(matrixCase: MicroMvpMatrixCase, scope: PinnedSnapshotScope): string {
  const keyOf = (items: Array<PinnedSnapshotEntity<unknown>>, id: string) => (
    items.find((item) => item.id === id)?.manifestKey ?? id
  );
  return [
    keyOf(scope.classes, matrixCase.klass.id),
    keyOf(scope.species, matrixCase.species.id),
    keyOf(scope.backgrounds, matrixCase.background.id),
    keyOf(scope.originFeats, matrixCase.originFeat.id),
  ].join('|');
}

function baseDraft(matrixCase: MicroMvpMatrixCase): CharacterDraft {
  const klass = matrixCase.klass as CharacterClass;
  const background = matrixCase.background as Background;
  const recommended = (klass.recommended_abilities ?? {}) as Partial<Record<AbilityKey, number>>;
  const abilities = Object.fromEntries(
    (['str', 'dex', 'con', 'int', 'wis', 'cha'] as AbilityKey[])
      .map((ability) => [ability, recommended[ability] ?? 10]),
  ) as Record<AbilityKey, number>;
  const eligible = (background.ability_scores ?? [])
    .filter((ability): ability is AbilityKey => (
      ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ability)
    ));
  if (eligible[0]) abilities[eligible[0]] += 2;
  if (eligible[1]) abilities[eligible[1]] += 1;
  const backgroundSkills = new Set(background.skill_proficiencies ?? []);
  const skillChoice = klass.skill_choices as { options?: string[]; count?: number } | null | undefined;
  const classSkills = (skillChoice?.options ?? [])
    .filter((skill) => !backgroundSkills.has(skill))
    .slice(0, Number(skillChoice?.count ?? 0));

  return {
    ...emptyDraft(),
    name: `Fixture · ${matrixCase.key}`,
    level: 1,
    classId: matrixCase.klass.id,
    raceId: matrixCase.species.id,
    backgroundId: matrixCase.background.id,
    featIds: [matrixCase.originFeat.id],
    swapFeat: true,
    abilities,
    abilityBonuses: {
      mode: 'two_one',
      assignments: {
        ...(eligible[0] ? { [eligible[0]]: 2 } : {}),
        ...(eligible[1] ? { [eligible[1]]: 1 } : {}),
      },
      anyAbilities: false,
    },
    classSkillChoices: classSkills,
  };
}

function originFeatAudit(
  matrixCase: MicroMvpMatrixCase,
  catalogs: SnapshotCatalogs,
): OriginFeatGrantAudit {
  const background = matrixCase.background as Background;
  const official = background.origin_feat
    ? (byReference(catalogs.feats).get(background.origin_feat) ?? [])[0]
    : undefined;
  return {
    productRuleId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
    selectedOriginFeatId: matrixCase.originFeat.id,
    ...(official ? { suppressedOfficialBackgroundFeatId: official.id } : {}),
    grants: [{
      entityId: matrixCase.originFeat.id,
      sourceType: 'product_rule',
      sourceId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
    }],
  };
}

function createRootFixture(
  matrixCase: MicroMvpMatrixCase,
  scope: PinnedSnapshotScope,
  catalogs: SnapshotCatalogs,
  issues: SnapshotFixtureIssue[],
): PinnedL1RootFixture {
  const klass = matrixCase.klass as CharacterClass;
  const race = matrixCase.species as Race;
  const background = matrixCase.background as Background;
  const feat = matrixCase.originFeat as Feat;
  const draft = baseDraft(matrixCase);
  const effectIndex = byReference(catalogs.effects);
  const actionIndex = byReference(catalogs.actions);
  const refs = gatherFeatureRefs(race, klass, [feat], 1);

  const effects: OriginEffect[] = [];
  const seenNonRepeatable = new Set<string>();
  const repeatableCount = new Map<string, number>();
  for (const reference of refs.effectRefs) {
    const source = uniqueReference(effectIndex, reference.id, 'L1 effect', issues);
    if (!source) continue;
    const effect = cloneJson(source);
    if (!effect.repeatable) {
      if (seenNonRepeatable.has(effect.id)) continue;
      seenNonRepeatable.add(effect.id);
      effects.push({ effect, origin: reference.origin });
      continue;
    }
    const index = repeatableCount.get(effect.id) ?? 0;
    repeatableCount.set(effect.id, index + 1);
    effects.push({
      effect,
      origin: {
        ...reference.origin,
        instanceKey: reference.origin.instanceKey
          ?? `${reference.origin.kind}:${reference.origin.id}:${effect.id}:${index}`,
      },
    });
  }
  materializeEffectTypeChoices(effects, catalogs.effects);
  const expandedEffects = expandLocalEffectGrants(effects, draft, effectIndex, issues);

  const actions = refs.actionRefs.flatMap((reference): OriginAction[] => {
    const action = uniqueReference(actionIndex, reference.id, 'L1 action', issues);
    return action ? [{ action: cloneJson(action), origin: reference.origin }] : [];
  });
  const bundle: EntityBundle = {
    race,
    klass,
    background,
    feats: [feat],
    effects: expandedEffects,
    actions,
    spells: [],
    resources: [],
    variableDefs: catalogs.variables,
  };
  const assembled = assemble(bundle, draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  const character = buildCharacterContext(
    ruleState,
    { level: 1, abilities: draft.abilities as Record<string, number> },
    [],
    assembled.klass,
  );
  const rawResources = syncRuntimeResources(character, assembled);
  const l1Resources = withoutUnprovenL2Resources(assembled, rawResources);
  const higher = levelReferences(klass, (level) => level > 1);
  const actionIds = [...new Set(assembled.actions.map((item) => item.action.id))].sort();
  const stableKey = stableKeyForCase(matrixCase, scope);
  const fixtureId = `${PINNED_PROD_SNAPSHOT_L1_RELEASE_ID}:${stableKey}`;
  const actor: FixtureActorState = {
    id: fixtureId,
    name: draft.name,
    kind: 'playerCharacter',
    controllerId: 'pinned-fixture-controller',
    ac: ruleState.armorClass,
    capabilities: { actionIds },
    character,
    runtime: {
      hp: { current: ruleState.maxHP, max: ruleState.maxHP, temp: 0 },
      resources: l1Resources.resources,
      maxResources: l1Resources.maxResources,
      equipment: {},
      inventory: [],
      activeEffects: [],
      firedThisTurn: [],
      firedThisRest: [],
    },
    passives: assembled.effects.flatMap(({ effect }) => (
      effect.mechanics ? [effect.mechanics as JsonObject] : []
    )),
  };

  return {
    fixtureId,
    stableKey,
    matrixCase,
    draft,
    assembled,
    actor,
    originFeatAudit: originFeatAudit(matrixCase, catalogs),
    unresolvedAcquireChoiceIds: choiceBlockers(assembled, draft),
    rawExcludedL2Resources: l1Resources.excluded,
    higherLevelEffectIds: higher.effectIds,
    higherLevelActionIds: higher.actionIds,
  };
}

function dedupeIssues(issues: SnapshotFixtureIssue[]): SnapshotFixtureIssue[] {
  const byKey = new Map<string, SnapshotFixtureIssue>();
  for (const issue of issues) {
    const key = `${issue.code}|${issue.subjectId}|${issue.message}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...issue });
    } else if (issue.affectedRootCount) {
      existing.affectedRootCount = (existing.affectedRootCount ?? 0) + issue.affectedRootCount;
    }
  }
  return [...byKey.values()].sort((left, right) => (
    left.code.localeCompare(right.code)
    || left.subjectId.localeCompare(right.subjectId)
    || left.message.localeCompare(right.message)
  ));
}

function releaseIssues(release: PinnedSnapshotRelease): SnapshotFixtureIssue[] {
  const checks = [
    ['rules', release.rulesHash, PINNED_PROD_SNAPSHOT_L1_RULES_HASH],
    ['content', release.contentHash, PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH],
    ['release', release.releaseHash, PINNED_PROD_SNAPSHOT_L1_RELEASE_HASH],
  ] as const;
  return checks.flatMap(([kind, actual, expected]) => actual === expected ? [] : [{
    severity: 'error' as const,
    code: 'release_hash_mismatch' as const,
    subjectId: `${PINNED_PROD_SNAPSHOT_L1_RELEASE_ID}:${kind}`,
    message: `Pinned ${kind} hash ${expected} does not match current snapshot ${actual}`,
  }]);
}

function auditFixtureSet(
  release: PinnedSnapshotRelease,
  scope: PinnedSnapshotScope,
  roots: readonly PinnedL1RootFixture[],
): SnapshotFixtureIssue[] {
  const issues: SnapshotFixtureIssue[] = [...releaseIssues(release)];
  for (const item of Object.values(scope).flat()) {
    const entity = item.entity as { support?: { status?: string } | null };
    if (!entity.support?.status) {
      issues.push({
        severity: 'error',
        code: 'missing_support_certification',
        subjectId: item.manifestKey,
        message: `${item.cardNumber} has no support certification in the pinned snapshot`,
      });
    }
  }

  const seenMechanics = new Set<string>();
  for (const root of roots) {
    for (const item of [
      ...root.assembled.effects.map(({ effect }) => ({
        id: effect.id, cardNumber: effect.card_number, name: effect.name, mechanics: effect.mechanics,
      })),
      ...root.assembled.actions.map(({ action }) => ({
        id: action.id, cardNumber: action.card_number, name: action.name, mechanics: action.mechanics,
      })),
    ]) {
      if (seenMechanics.has(item.id)) continue;
      seenMechanics.add(item.id);
      const kinds = sourceKinds(item.mechanics);
      const behavioral = [...kinds].filter((kind) => kind !== 'narrative' && kind !== 'choice');
      if (kinds.has('narrative') && behavioral.length === 0) {
        issues.push({
          severity: 'error',
          code: 'narrative_only_mechanic',
          subjectId: item.cardNumber || item.id,
          message: `${item.name} has narrative text but no executable/grant payload`,
        });
      }
    }
  }

  const blockers = new Map<string, number>();
  const resourceLeaks = new Map<string, number>();
  for (const root of roots) {
    root.unresolvedAcquireChoiceIds.forEach((id) => blockers.set(id, (blockers.get(id) ?? 0) + 1));
    root.rawExcludedL2Resources.forEach((id) => {
      const key = `${root.matrixCase.klass.card_number}:${id}`;
      resourceLeaks.set(key, (resourceLeaks.get(key) ?? 0) + 1);
    });
    const higherEffects = new Set(root.higherLevelEffectIds);
    const higherActions = new Set(root.higherLevelActionIds);
    for (const effect of root.assembled.effects) {
      if (higherEffects.has(effect.effect.id)) {
        issues.push({
          severity: 'error',
          code: 'higher_level_ability_leak',
          subjectId: effect.effect.id,
          message: `Higher-level effect leaked into ${root.stableKey}`,
        });
      }
    }
    for (const actionId of root.actor.capabilities.actionIds) {
      if (higherActions.has(actionId)) {
        issues.push({
          severity: 'error',
          code: 'higher_level_ability_leak',
          subjectId: actionId,
          message: `Higher-level action leaked into ${root.stableKey}`,
        });
      }
    }
    const grants = root.originFeatAudit.grants;
    if (grants.filter((grant) => grant.sourceType === 'product_rule').length !== 1
      || grants.some((grant) => grant.sourceType === 'official_background')) {
      issues.push({
        severity: 'error',
        code: 'background_origin_feat_leak',
        subjectId: root.stableKey,
        message: 'Background grant was added instead of being replaced by the product-rule slot',
      });
    }
  }
  for (const [id, count] of blockers) {
    issues.push({
      severity: 'error',
      code: 'l1_choice_unresolved',
      subjectId: id,
      affectedRootCount: count,
      message: 'Acquire-time choice is unresolved; this root fixture is not a completed character build',
    });
  }
  for (const [key, count] of resourceLeaks) {
    issues.push({
      severity: 'error',
      code: 'l2_resource_source_leak',
      subjectId: key,
      affectedRootCount: count,
      message: 'Raw class resource data would initialize an L2 resource at character level 1; fixture runtime excluded it',
    });
  }

  const warlock = roots.find((root) => root.matrixCase.klass.card_number === 'CLASS-warlock');
  const invocationChoice = warlock?.assembled.pendingChoices.find((choice) => (
    choice.id.includes('warlock_invocations')
  ));
  if (!invocationChoice || invocationChoice.count !== 1 || invocationChoice.id.includes('_l2')) {
    issues.push({
      severity: 'error',
      code: 'l1_warlock_invocation_mismatch',
      subjectId: invocationChoice?.id ?? 'CLASS-warlock:invocation-choice',
      affectedRootCount: roots.filter((root) => root.matrixCase.klass.card_number === 'CLASS-warlock').length,
      message: invocationChoice
        ? `L1 invocation choice is count=${invocationChoice.count} and keeps an L2 identity`
        : 'L1 invocation choice is missing',
    });
  }
  return dedupeIssues(issues);
}

function matrixScope(scope: PinnedSnapshotScope): MicroMvpMatrixScope {
  return {
    classes: scope.classes.map((item) => item.entity),
    species: scope.species.map((item) => item.entity),
    backgrounds: scope.backgrounds.map((item) => item.entity),
    originFeats: scope.originFeats.map((item) => item.entity),
  };
}

/**
 * Builds all 448 L1 root fixtures against a pinned local snapshot. The returned
 * actors are safe L1 projections; `issues` still records every source/build gap.
 */
export async function loadPinnedProdSnapshotL1Provider(): Promise<PinnedProdSnapshotL1Provider> {
  const [manifest, catalogs] = await Promise.all([
    readMicroMvpSnapshotManifest(),
    Promise.resolve(readProdSnapshotCatalogs()),
  ]);
  const scope = resolveScope(manifest, catalogs);
  const release = computeRelease(manifest, catalogs);
  const buildIssues: SnapshotFixtureIssue[] = [];
  const roots = createMicroMvpMatrix(matrixScope(scope)).map((matrixCase) => (
    createRootFixture(matrixCase, scope, catalogs, buildIssues)
  ));
  if (roots.length !== 448 || new Set(roots.map((root) => root.fixtureId)).size !== 448) {
    throw new PinnedSnapshotStructureError([
      `root matrix must contain 448 unique fixtures, got ${roots.length}`,
    ]);
  }
  const byId = new Map(roots.map((root) => [root.fixtureId, root]));
  const issues = dedupeIssues([...buildIssues, ...auditFixtureSet(release, scope, roots)]);
  return {
    release,
    ruleset: {
      systemId: 'dnd5e-2024',
      releaseId: release.id,
      contentHash: release.contentHash,
      errataVersion: release.errataVersion,
    },
    scope,
    roots,
    issues,
    getActor: (fixtureId) => byId.get(fixtureId)?.actor,
    getFixture: (fixtureId) => byId.get(fixtureId),
  };
}

/** Full-build/release gate. Current known red snapshot data intentionally throws. */
export function assertPinnedProdSnapshotL1Ready(
  provider: PinnedProdSnapshotL1Provider,
): void {
  const blocking = provider.issues.filter((issue) => issue.severity === 'error');
  if (blocking.length) throw new PinnedSnapshotReadinessError(blocking);
}
