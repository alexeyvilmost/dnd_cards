import type {
  ActorState,
  RuleActionDefinition,
  RulesCatalog,
  RulesetReference,
} from '../rules-core/domain';
import { canonicalSha256, canonicalStringify } from '../rules-core/determinism';
import type { SpellGrantAccess, SpellAccessKind } from '../rules-core/spellcastingAccess';
import { parseWorldSpellPolicy } from '../rules-core/worldSpellPolicies';
import { bindEquippedWeaponActionContext } from '../engine/weapon';
import { compileDeclaredMechanicsTargeting } from '../rules-core/actionTargeting';
import {
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
  parseDeclaredWeaponActionPolicy,
  WEAPON_ATTACK_PRIMITIVE,
} from '../rules-core/weaponActionPolicies';
import { UNARMED_STRIKE_PRIMITIVE } from './sheetCombatDeclaration';
import { applyUnarmedDamageProfileToAction } from '../rules-core/fightingStyleComplexPrimitives';
import generatedSheetCombatArtifact from './sheetCombatCertification.generated.json';

export const SHEET_COMBAT_CERTIFICATION_SCHEMA_VERSION = 1 as const;
export const SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION = '1.0.0' as const;
export const SHEET_COMBAT_CERTIFICATION_EXPECTED_MATRIX_ROOT_COUNT = 448 as const;
export const SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT = 450 as const;
export const SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT = 18 as const;
export const SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT = 4 as const;
export const MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID = 'FEAT-0009' as const;

const COMBAT_PRIMITIVES = new Set([
  'burning_hands_objects',
  'area_object_push',
  'magic_missile',
  UNARMED_STRIKE_PRIMITIVE,
  WEAPON_ATTACK_PRIMITIVE,
  LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE,
]);
const SPELL_ACCESS_KINDS = new Set<SpellAccessKind>([
  'cantrip',
  'known',
  'spellbook',
  'always_prepared',
  'innate',
  'ritual_only',
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;

interface CertifiedReleaseReference {
  id: string;
  systemId: 'dnd5e-2024';
  rulesetVersion: string;
  errataVersion: string;
  sourceReleaseId: string;
  sourceContentHash: string;
  overlayHash: string;
  contentHash: string;
  releaseHash: string;
}

export interface CertifiedSpellGrantProjection {
  grantId: string;
  actionId: string;
  sourceId: string;
  access: SpellAccessKind;
  level: number;
  spellcastingAbility: SpellGrantAccess['spellcastingAbility'];
  ritual: boolean;
  slotResource: string | null;
  freeUseResource: string | null;
}

export interface CertifiedPreparedSourceProjection {
  sourceId: string;
  capacity: number;
  availableActionIds: string[];
  preparedActionIds: string[];
}

export interface CertifiedActorAccessProjection {
  grants: CertifiedSpellGrantProjection[];
  preparedSources: CertifiedPreparedSourceProjection[];
}

export interface SheetCombatCoverageRow {
  stableKey: string;
  actionIds: string[];
}

export interface SheetCombatMagicInitiateProvenance {
  grantSourceId: typeof MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID;
  originFeatEntityId: string;
  actions: Array<{
    actionId: string;
    sourceEntityIds: string[];
    grantSignatures: CertifiedSpellGrantProjection[];
  }>;
}

export interface SheetCombatCertificationArtifact {
  schemaVersion: typeof SHEET_COMBAT_CERTIFICATION_SCHEMA_VERSION;
  artifactVersion: typeof SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION;
  source: {
    ruleset: RulesetReference;
    release: CertifiedReleaseReference;
  };
  summary: {
    rootCount: number;
    combatRootCount: number;
    actionOccurrenceCount: number;
    uniqueActionCount: number;
  };
  coverage: SheetCombatCoverageRow[];
  actions: RuleActionDefinition[];
  accessSignaturesByAction: Record<string, CertifiedActorAccessProjection[]>;
  preparedSourceProfiles: CertifiedPreparedSourceProjection[];
  magicInitiate: SheetCombatMagicInitiateProvenance;
  sourceProjectionHash: string;
  contentHash: string;
}

export interface CertifiedSheetCombatCatalog {
  ruleset: RulesetReference;
  actions: readonly RuleActionDefinition[];
  catalog: RulesCatalog;
  accessSignaturesByAction: Readonly<Record<string, readonly CertifiedActorAccessProjection[]>>;
  preparedSourceProfiles: readonly CertifiedPreparedSourceProjection[];
  artifact: Readonly<SheetCombatCertificationArtifact>;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredObject(value: unknown, label: string): Record<string, unknown> {
  const parsed = object(value);
  if (!parsed) throw new Error(`Sheet combat certification ${label} must be an object`);
  return parsed;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.length) {
    throw new Error(`Sheet combat certification ${label} must be a non-empty string`);
  }
  return value;
}

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Sheet combat certification ${label} must be an integer >= ${minimum}`);
  }
  return Number(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalStringify(actual) !== canonicalStringify(expected)) {
    throw new Error(`Sheet combat certification ${label} must declare exactly: ${expected.join(', ')}`);
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function exactStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.length)) {
    throw new Error(`Sheet combat certification ${label} must be a string array`);
  }
  const strings = value as string[];
  if (new Set(strings).size !== strings.length) {
    throw new Error(`Sheet combat certification ${label} must not contain duplicates`);
  }
  const normalized = sortedUnique(strings);
  if (canonicalStringify(strings) !== canonicalStringify(normalized)) {
    throw new Error(`Sheet combat certification ${label} must be sorted`);
  }
  return normalized;
}

function isSheetCombatAction(action: RuleActionDefinition): boolean {
  const activation = object(action.mechanics.activation);
  const trigger = object(activation?.trigger);
  const isCertifiedMagicMissileReaction = Array.isArray(trigger?.events)
    && trigger.events.includes('targeted_by_magic_missile');
  if (isCertifiedMagicMissileReaction) return true;
  // Triggered higher-level actions are merged into solo combat from the
  // character's live data after the independently pinned L1 certificate has
  // been established. A compatibility primitive must not promote them into
  // that certificate (for example Martial Arts is still an unarmed attack).
  if (activation?.mode === 'triggered') {
    return false;
  }
  const primitive = object(action.mechanics.primitive)?.type;
  return typeof primitive === 'string' && COMBAT_PRIMITIVES.has(primitive);
}

/**
 * Every field consulted by resolveSpellAccess is made explicit. Undefined and
 * false/null are normalized by meaning, so serialization syntax cannot create
 * a second access identity while a ritual or payment namespace cannot hide.
 */
export function projectCertifiedSpellGrant(
  grant: SpellGrantAccess,
): CertifiedSpellGrantProjection {
  return {
    grantId: grant.grantId,
    actionId: grant.actionId,
    sourceId: grant.sourceId,
    access: grant.access,
    level: grant.level,
    spellcastingAbility: grant.spellcastingAbility,
    ritual: grant.ritual === true,
    slotResource: grant.slotResource ?? null,
    freeUseResource: grant.freeUseResource ?? null,
  };
}

function parseGrantProjection(value: unknown, label: string): CertifiedSpellGrantProjection {
  const raw = requiredObject(value, label);
  exactKeys(raw, [
    'grantId',
    'actionId',
    'sourceId',
    'access',
    'level',
    'spellcastingAbility',
    'ritual',
    'slotResource',
    'freeUseResource',
  ], label);
  const access = requiredString(raw.access, `${label}.access`) as SpellAccessKind;
  if (!SPELL_ACCESS_KINDS.has(access)) {
    throw new Error(`Sheet combat certification ${label}.access is unsupported`);
  }
  const spellcastingAbility = requiredString(
    raw.spellcastingAbility,
    `${label}.spellcastingAbility`,
  ) as SpellGrantAccess['spellcastingAbility'];
  if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(spellcastingAbility)) {
    throw new Error(`Sheet combat certification ${label}.spellcastingAbility is unsupported`);
  }
  if (typeof raw.ritual !== 'boolean') {
    throw new Error(`Sheet combat certification ${label}.ritual must be boolean`);
  }
  const nullableResource = (resource: unknown, field: string): string | null => {
    if (resource === null) return null;
    return requiredString(resource, `${label}.${field}`);
  };
  return {
    grantId: requiredString(raw.grantId, `${label}.grantId`),
    actionId: requiredString(raw.actionId, `${label}.actionId`),
    sourceId: requiredString(raw.sourceId, `${label}.sourceId`),
    access,
    level: requiredInteger(raw.level, `${label}.level`),
    spellcastingAbility,
    ritual: raw.ritual,
    slotResource: nullableResource(raw.slotResource, 'slotResource'),
    freeUseResource: nullableResource(raw.freeUseResource, 'freeUseResource'),
  };
}

export function projectCertifiedPreparedSource(input: {
  sourceId: string;
  capacity: number;
  availableActionIds: readonly string[];
  preparedActionIds: readonly string[];
}): CertifiedPreparedSourceProjection {
  return {
    sourceId: input.sourceId,
    capacity: input.capacity,
    availableActionIds: sortedUnique(input.availableActionIds),
    preparedActionIds: sortedUnique(input.preparedActionIds),
  };
}

function parsePreparedSourceProjection(
  value: unknown,
  label: string,
): CertifiedPreparedSourceProjection {
  const raw = requiredObject(value, label);
  exactKeys(raw, [
    'sourceId',
    'capacity',
    'availableActionIds',
    'preparedActionIds',
  ], label);
  const result = {
    sourceId: requiredString(raw.sourceId, `${label}.sourceId`),
    capacity: requiredInteger(raw.capacity, `${label}.capacity`),
    availableActionIds: exactStringArray(raw.availableActionIds, `${label}.availableActionIds`),
    preparedActionIds: exactStringArray(raw.preparedActionIds, `${label}.preparedActionIds`),
  };
  if (result.preparedActionIds.length !== result.capacity) {
    throw new Error(`Sheet combat certification ${label} prepared count differs from capacity`);
  }
  const available = new Set(result.availableActionIds);
  if (result.preparedActionIds.some((actionId) => !available.has(actionId))) {
    throw new Error(`Sheet combat certification ${label} prepares an unavailable action`);
  }
  return result;
}

/** Exact resolution-owned slice of actor access for one combat action. */
export function projectCertifiedActorAccess(
  actor: ActorState,
  actionId: string,
): CertifiedActorAccessProjection {
  const access = actor.spellcastingAccess;
  const grants = (access?.grants ?? [])
    .filter((grant) => grant.actionId === actionId)
    .map(projectCertifiedSpellGrant)
    .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));
  const preparedSources = Object.entries(access?.preparedSources ?? {})
    .map(([key, source]) => {
      if (!source) throw new Error(`Actor ${actor.id} prepared source ${key} is missing`);
      if (key !== source.sourceId) {
        throw new Error(`Actor ${actor.id} prepared source key ${key} differs from ${source.sourceId}`);
      }
      return projectCertifiedPreparedSource(source);
    })
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  return { grants, preparedSources };
}

function parseAccessProjection(value: unknown, label: string): CertifiedActorAccessProjection {
  const raw = requiredObject(value, label);
  exactKeys(raw, ['grants', 'preparedSources'], label);
  if (!Array.isArray(raw.grants) || !Array.isArray(raw.preparedSources)) {
    throw new Error(`Sheet combat certification ${label} grants/preparedSources must be arrays`);
  }
  const grants = raw.grants.map((grant, index) => (
    parseGrantProjection(grant, `${label}.grants[${index}]`)
  ));
  const preparedSources = raw.preparedSources.map((source, index) => (
    parsePreparedSourceProjection(source, `${label}.preparedSources[${index}]`)
  ));
  const sortedGrants = [...grants]
    .sort((left, right) => canonicalStringify(left).localeCompare(canonicalStringify(right)));
  const sortedSources = [...preparedSources]
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  if (canonicalStringify(grants) !== canonicalStringify(sortedGrants)
    || canonicalStringify(preparedSources) !== canonicalStringify(sortedSources)) {
    throw new Error(`Sheet combat certification ${label} must be canonically sorted`);
  }
  if (new Set(preparedSources.map((source) => source.sourceId)).size !== preparedSources.length) {
    throw new Error(`Sheet combat certification ${label} has duplicate prepared sources`);
  }
  return { grants, preparedSources };
}

export function sheetCombatCertificationSourceProjection(
  artifact: Pick<SheetCombatCertificationArtifact,
    | 'source'
    | 'summary'
    | 'coverage'
    | 'actions'
    | 'accessSignaturesByAction'
    | 'preparedSourceProfiles'
    | 'magicInitiate'>,
): Record<string, unknown> {
  return {
    source: artifact.source,
    summary: artifact.summary,
    coverage: artifact.coverage,
    actions: artifact.actions,
    accessSignaturesByAction: artifact.accessSignaturesByAction,
    preparedSourceProfiles: artifact.preparedSourceProfiles,
    magicInitiate: artifact.magicInitiate,
  };
}

export function sheetCombatCertificationContent(
  artifact: SheetCombatCertificationArtifact,
): Omit<SheetCombatCertificationArtifact, 'contentHash'> {
  const { contentHash: _contentHash, ...content } = artifact;
  return content;
}

function validateRulesetAndRelease(artifact: SheetCombatCertificationArtifact): void {
  const { ruleset, release } = artifact.source;
  if (ruleset.systemId !== 'dnd5e-2024' || release.systemId !== 'dnd5e-2024'
    || ruleset.releaseId !== release.id
    || ruleset.contentHash !== release.contentHash
    || ruleset.errataVersion !== release.errataVersion) {
    throw new Error('Sheet combat certification source ruleset/release identity differs');
  }
  for (const [field, value] of Object.entries({
    'ruleset.contentHash': ruleset.contentHash,
    'release.sourceContentHash': release.sourceContentHash,
    'release.overlayHash': release.overlayHash,
    'release.contentHash': release.contentHash,
    'release.releaseHash': release.releaseHash,
  })) {
    if (!SHA256.test(value)) {
      throw new Error(`Sheet combat certification ${field} is not a SHA-256 pin`);
    }
  }
}

function validateArtifactEnvelopeShape(raw: Record<string, unknown>): void {
  exactKeys(raw, [
    'schemaVersion',
    'artifactVersion',
    'source',
    'summary',
    'coverage',
    'actions',
    'accessSignaturesByAction',
    'preparedSourceProfiles',
    'magicInitiate',
    'sourceProjectionHash',
    'contentHash',
  ], 'artifact');
  const source = requiredObject(raw.source, 'source');
  exactKeys(source, ['ruleset', 'release'], 'source');
  exactKeys(requiredObject(source.ruleset, 'source.ruleset'), [
    'systemId',
    'releaseId',
    'contentHash',
    'errataVersion',
  ], 'source.ruleset');
  exactKeys(requiredObject(source.release, 'source.release'), [
    'id',
    'systemId',
    'rulesetVersion',
    'errataVersion',
    'sourceReleaseId',
    'sourceContentHash',
    'overlayHash',
    'contentHash',
    'releaseHash',
  ], 'source.release');
  exactKeys(requiredObject(raw.summary, 'summary'), [
    'rootCount',
    'combatRootCount',
    'actionOccurrenceCount',
    'uniqueActionCount',
  ], 'summary');
  if (!Array.isArray(raw.coverage) || !Array.isArray(raw.actions)
    || !Array.isArray(raw.preparedSourceProfiles)) {
    throw new Error('Sheet combat certification coverage/actions/profiles must be arrays');
  }
  raw.coverage.forEach((row, index) => exactKeys(
    requiredObject(row, `coverage[${index}]`),
    ['stableKey', 'actionIds'],
    `coverage[${index}]`,
  ));
  requiredObject(raw.accessSignaturesByAction, 'accessSignaturesByAction');
  const magicInitiate = requiredObject(raw.magicInitiate, 'magicInitiate');
  exactKeys(magicInitiate, [
    'grantSourceId',
    'originFeatEntityId',
    'actions',
  ], 'magicInitiate');
  if (!Array.isArray(magicInitiate.actions)) {
    throw new Error('Sheet combat certification magicInitiate.actions must be an array');
  }
  magicInitiate.actions.forEach((row, index) => exactKeys(
    requiredObject(row, `magicInitiate.actions[${index}]`),
    ['actionId', 'sourceEntityIds', 'grantSignatures'],
    `magicInitiate.actions[${index}]`,
  ));
}

function validateArtifactDenominator(artifact: SheetCombatCertificationArtifact): void {
  const { summary } = artifact;
  if (summary.rootCount !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT
    || summary.uniqueActionCount !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT
    || artifact.coverage.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT
    || artifact.actions.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT) {
    throw new Error(
      `Sheet combat certification does not cover the ${SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT}-root/`
      + `${SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT}-action denominator`,
    );
  }
  const stableKeys = artifact.coverage.map((row) => row.stableKey);
  if (new Set(stableKeys).size !== stableKeys.length
    || canonicalStringify(stableKeys) !== canonicalStringify([...stableKeys].sort())) {
    throw new Error('Sheet combat certification coverage roots must be unique and sorted');
  }
  const actionIds = artifact.actions.map((action) => action.id);
  if (new Set(actionIds).size !== actionIds.length
    || canonicalStringify(actionIds) !== canonicalStringify([...actionIds].sort())) {
    throw new Error('Sheet combat certification actions must be unique and sorted');
  }
  const actionIdSet = new Set(actionIds);
  let combatRootCount = 0;
  let actionOccurrenceCount = 0;
  const coveredActionIds = new Set<string>();
  for (const row of artifact.coverage) {
    requiredString(row.stableKey, 'coverage.stableKey');
    const rowActionIds = exactStringArray(row.actionIds, `${row.stableKey}.actionIds`);
    if (rowActionIds.length) combatRootCount += 1;
    actionOccurrenceCount += rowActionIds.length;
    for (const actionId of rowActionIds) {
      if (!actionIdSet.has(actionId)) {
        throw new Error(`Sheet combat certification root ${row.stableKey} names unknown ${actionId}`);
      }
      coveredActionIds.add(actionId);
    }
  }
  if (combatRootCount !== summary.combatRootCount
    || actionOccurrenceCount !== summary.actionOccurrenceCount
    || canonicalStringify([...coveredActionIds].sort()) !== canonicalStringify(actionIds)) {
    throw new Error('Sheet combat certification coverage summary or action union differs');
  }
}

function validateArtifactActions(artifact: SheetCombatCertificationArtifact): void {
  for (const action of artifact.actions) {
    if (!object(action) || typeof action.id !== 'string' || !object(action.mechanics)
      || !isSheetCombatAction(action)) {
      throw new Error('Sheet combat certification contains a non-combat or malformed action');
    }
    const primitive = object(action.mechanics.primitive)?.type;
    if (primitive === WEAPON_ATTACK_PRIMITIVE
      || primitive === LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE) {
      const parsed = parseDeclaredWeaponActionPolicy(action, 'template');
      if (parsed.status !== 'valid') {
        throw new Error(
          `Sheet combat certification is stale: ${action.id} ${parsed.issue}`,
        );
      }
      continue;
    }
    if (primitive !== 'burning_hands_objects' && primitive !== 'magic_missile') continue;
    const parsed = parseWorldSpellPolicy(action.mechanics);
    if (parsed.status !== 'valid' || parsed.primitiveType !== primitive) {
      throw new Error(
        `Sheet combat certification is stale: ${action.id} ${parsed.status === 'invalid'
          ? parsed.issue
          : 'has no strict data-owned policy'}`,
      );
    }
  }
}

function validateAccessAndPreparation(artifact: SheetCombatCertificationArtifact): void {
  const actionIds = artifact.actions.map((action) => action.id);
  const signatureKeys = Object.keys(artifact.accessSignaturesByAction).sort();
  if (canonicalStringify(signatureKeys) !== canonicalStringify(actionIds)) {
    throw new Error('Sheet combat certification access signatures do not cover every exact action');
  }
  const parsedProfiles = artifact.preparedSourceProfiles.map((profile, index) => (
    parsePreparedSourceProjection(profile, `preparedSourceProfiles[${index}]`)
  ));
  const canonicalProfiles = parsedProfiles.map(canonicalStringify);
  if (new Set(canonicalProfiles).size !== canonicalProfiles.length
    || canonicalStringify(canonicalProfiles) !== canonicalStringify([...canonicalProfiles].sort())) {
    throw new Error('Sheet combat certification prepared source profiles must be unique and sorted');
  }
  const certifiedProfiles = new Set(canonicalProfiles);
  const referencedProfiles = new Set<string>();
  for (const actionId of actionIds) {
    const action = artifact.actions.find((candidate) => candidate.id === actionId)!;
    const rawSignatures = artifact.accessSignaturesByAction[actionId];
    if (!Array.isArray(rawSignatures) || !rawSignatures.length) {
      throw new Error(`Sheet combat certification has no actor access signature for ${actionId}`);
    }
    const signatures = rawSignatures.map((signature, index) => (
      parseAccessProjection(signature, `accessSignaturesByAction.${actionId}[${index}]`)
    ));
    const canonicalSignatures = signatures.map(canonicalStringify);
    if (new Set(canonicalSignatures).size !== canonicalSignatures.length
      || canonicalStringify(canonicalSignatures)
        !== canonicalStringify([...canonicalSignatures].sort())) {
      throw new Error(`Sheet combat certification signatures for ${actionId} must be unique and sorted`);
    }
    for (const signature of signatures) {
      if ((action.kind === 'spell' && !signature.grants.length)
        || (action.kind === 'nonSpell' && signature.grants.length > 0)
        || signature.grants.some((grant) => grant.actionId !== actionId)) {
        throw new Error(`Sheet combat certification access for ${actionId} has wrong grants`);
      }
      for (const profile of signature.preparedSources) {
        const canonical = canonicalStringify(profile);
        if (!certifiedProfiles.has(canonical)) {
          throw new Error(`Sheet combat certification access for ${actionId} has unknown preparation`);
        }
        referencedProfiles.add(canonical);
      }
    }
  }
  if (canonicalStringify([...referencedProfiles].sort())
    !== canonicalStringify([...certifiedProfiles].sort())) {
    throw new Error('Sheet combat certification has an unreferenced prepared source profile');
  }
}

function validateMagicInitiateProvenance(artifact: SheetCombatCertificationArtifact): void {
  const provenance = artifact.magicInitiate;
  if (provenance.grantSourceId !== MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID
    || typeof provenance.originFeatEntityId !== 'string'
    || !provenance.originFeatEntityId.length
    || !Array.isArray(provenance.actions)
    || provenance.actions.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT) {
    throw new Error('Sheet combat certification Magic Initiate provenance is incomplete');
  }
  const expectedActionIds = Object.entries(artifact.accessSignaturesByAction)
    .filter(([, signatures]) => signatures.some((signature) => signature.grants.some(
      (grant) => grant.sourceId === MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
    )))
    .map(([actionId]) => actionId)
    .sort();
  const actualActionIds = provenance.actions.map((row) => row.actionId);
  if (canonicalStringify(actualActionIds) !== canonicalStringify(expectedActionIds)) {
    throw new Error('Sheet combat certification Magic Initiate action coverage differs');
  }
  const actionById = new Map(artifact.actions.map((action) => [action.id, action]));
  for (const row of provenance.actions) {
    const action = actionById.get(row.actionId);
    if (!action
      || canonicalStringify(row.sourceEntityIds) !== canonicalStringify(action.sourceEntityIds)
      || !row.sourceEntityIds.includes(provenance.originFeatEntityId)) {
      throw new Error(`Sheet combat certification Magic Initiate provenance differs for ${row.actionId}`);
    }
    const expectedGrants = artifact.accessSignaturesByAction[row.actionId]
      .flatMap((signature) => signature.grants)
      .filter((grant) => grant.sourceId === MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID)
      .map(canonicalStringify);
    const actualGrants = row.grantSignatures.map((grant, index) => canonicalStringify(
      parseGrantProjection(grant, `magicInitiate.${row.actionId}.grantSignatures[${index}]`),
    ));
    if (canonicalStringify(sortedUnique(actualGrants))
      !== canonicalStringify(sortedUnique(expectedGrants))) {
      throw new Error(`Sheet combat certification Magic Initiate grants differ for ${row.actionId}`);
    }
  }
}

/**
 * Hashes and validates the checked-in artifact before exposing any catalog
 * bytes. This is exported so tamper tests can exercise the same browser path.
 */
export async function certifySheetCombatArtifact(
  input: unknown,
): Promise<CertifiedSheetCombatCatalog> {
  const raw = requiredObject(input, 'artifact');
  if (raw.schemaVersion !== SHEET_COMBAT_CERTIFICATION_SCHEMA_VERSION
    || raw.artifactVersion !== SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION) {
    throw new Error('Sheet combat certification schema/version is unsupported');
  }
  validateArtifactEnvelopeShape(raw);
  if (!SHA256.test(String(raw.sourceProjectionHash ?? ''))
    || !SHA256.test(String(raw.contentHash ?? ''))) {
    throw new Error('Sheet combat certification hashes are not pinned');
  }
  const artifact = clone(input) as SheetCombatCertificationArtifact;
  const expectedContentHash = await canonicalSha256(sheetCombatCertificationContent(artifact));
  if (expectedContentHash !== artifact.contentHash) {
    throw new Error('Sheet combat certification content hash mismatch');
  }
  const expectedSourceHash = await canonicalSha256(
    sheetCombatCertificationSourceProjection(artifact),
  );
  if (expectedSourceHash !== artifact.sourceProjectionHash) {
    throw new Error('Sheet combat certification source projection hash mismatch');
  }
  validateRulesetAndRelease(artifact);
  validateArtifactDenominator(artifact);
  validateArtifactActions(artifact);
  validateAccessAndPreparation(artifact);
  validateMagicInitiateProvenance(artifact);

  const actions = artifact.actions.map(clone);
  const byId = new Map(actions.map((action) => [action.id, action]));
  return {
    ruleset: clone(artifact.source.ruleset),
    actions,
    catalog: {
      getAction: (id) => byId.get(id),
      listActions: () => actions,
    },
    accessSignaturesByAction: clone(artifact.accessSignaturesByAction),
    preparedSourceProfiles: clone(artifact.preparedSourceProfiles),
    artifact,
  };
}

/** Loads only the independently generated 448-root combat certificate.
 *
 * The certificate stays in the route chunk: a nested dynamic JSON import can
 * be omitted by a static host even when the sheet route itself is available.
 */
export async function loadCertifiedSheetCombatCatalog(): Promise<CertifiedSheetCombatCatalog> {
  return certifySheetCombatArtifact(generatedSheetCombatArtifact);
}

/**
 * Display metadata is intentionally editable on a mechanics-locked entity. Keep
 * it out of the execution certificate so renaming a reviewed action cannot make
 * combat unavailable. Every field that can affect resolution remains exact.
 */
function certifiedExecutionProjection(action: RuleActionDefinition): Omit<RuleActionDefinition, 'name'> {
  const { name: _displayName, ...execution } = action;
  return execution;
}

function certifiedActionWithLiveMetadata(
  expected: RuleActionDefinition,
  live: RuleActionDefinition,
): RuleActionDefinition {
  return { ...clone(expected), name: live.name };
}

function firstExecutionDifference(
  expected: unknown,
  actual: unknown,
  path = 'action',
): string {
  const equal = (left: unknown, right: unknown): boolean => {
    if (left === undefined || right === undefined) return left === right;
    return canonicalStringify(left) === canonicalStringify(right);
  };
  if (equal(expected, actual)) return path;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) return `${path}.length`;
    for (let index = 0; index < expected.length; index += 1) {
      if (!equal(expected[index], actual[index])) {
        return firstExecutionDifference(expected[index], actual[index], `${path}[${index}]`);
      }
    }
  }
  const expectedObject = object(expected);
  const actualObject = object(actual);
  if (expectedObject && actualObject) {
    const keys = [...new Set([...Object.keys(expectedObject), ...Object.keys(actualObject)])].sort();
    for (const key of keys) {
      if (!equal(expectedObject[key], actualObject[key])) {
        return firstExecutionDifference(expectedObject[key], actualObject[key], `${path}.${key}`);
      }
    }
  }
  return path;
}

/** Exact semantic membership: a DB/sheet action's execution fields must be in the reviewed release. */
export function assertCertifiedSheetCombatAction(
  action: RuleActionDefinition,
  certified: CertifiedSheetCombatCatalog,
): RuleActionDefinition {
  const expected = certified.catalog.getAction(action.id);
  const expectedExecution = expected && certifiedExecutionProjection(expected);
  const actualExecution = certifiedExecutionProjection(action);
  if (!expectedExecution || canonicalStringify(expectedExecution)
    !== canonicalStringify(actualExecution)) {
    throw new Error(
      `Action ${action.id} differs from the reviewed micro-MVP combat catalog at ${
        expectedExecution ? firstExecutionDifference(expectedExecution, actualExecution) : 'action.id'
      }`,
    );
  }
  return certifiedActionWithLiveMetadata(expected, action);
}

/**
 * Actor-aware certification for contextual templates. The release certificate
 * keeps immutable contextual weapon markers; a sheet may carry only the exact
 * deterministic ammo and targeting projection for its own equipment and Card data.
 */
export function assertCertifiedSheetCombatActorAction(
  action: RuleActionDefinition,
  actor: ActorState,
  certified: CertifiedSheetCombatCatalog,
): RuleActionDefinition {
  const expected = certified.catalog.getAction(action.id);
  if (!expected) {
    throw new Error(`Action ${action.id} is outside the reviewed micro-MVP combat catalog`);
  }
  const primitive = object(expected.mechanics.primitive)?.type;
  if (primitive === UNARMED_STRIKE_PRIMITIVE) {
    const cards = new Map([
      ...(actor.character.knownCards ?? []),
      ...(actor.character.equippedCards ?? []),
    ].map((card) => [card.id, card] as const));
    const heldCards = (['main_hand', 'off_hand'] as const).flatMap((slot) => {
      const cardId = actor.runtime.equipment[slot];
      return cardId && cards.get(cardId) ? [cards.get(cardId)!] : [];
    });
    const equippedCards = Object.values(actor.runtime.equipment).flatMap((cardId) => (
      cardId && cards.get(cardId) ? [cards.get(cardId)!] : []
    ));
    const expectedBound = applyUnarmedDamageProfileToAction(
      expected,
      actor.passives ?? [],
      {
        holdingWeaponOrShield: heldCards.some((card) => (
          card.type === 'weapon' || card.type === 'shield' || card.defense_type === 'shield'
        )),
        wearingArmorOrShield: equippedCards.some((card) => card.defense_type != null),
        variables: actor.character.variables,
        abilityMods: actor.character.abilityMods,
      },
    );
    const expectedExecution = certifiedExecutionProjection(expectedBound);
    const actualExecution = certifiedExecutionProjection(action);
    if (canonicalStringify(actualExecution) !== canonicalStringify(expectedExecution)) {
      throw new Error(
        `Action ${action.id} differs from its actor-specific certified unarmed binding at ${
          firstExecutionDifference(expectedExecution, actualExecution)
        }`,
      );
    }
    return certifiedActionWithLiveMetadata(expectedBound, action);
  }
  if (primitive !== WEAPON_ATTACK_PRIMITIVE
    && primitive !== LIGHT_WEAPON_EXTRA_ATTACK_PRIMITIVE) {
    return assertCertifiedSheetCombatAction(action, certified);
  }
  const template = parseDeclaredWeaponActionPolicy(expected, 'template');
  if (template.status !== 'valid') {
    throw new Error(`Certified weapon action ${expected.id} is invalid: ${template.issue}`);
  }
  const cards = new Map([
    ...(actor.character.knownCards ?? []),
    ...(actor.character.equippedCards ?? []),
  ].map((card) => [card.id, card] as const));
  let expectedBound: RuleActionDefinition;
  try {
    const mechanics = bindEquippedWeaponActionContext(
      expected.mechanics,
      actor.runtime.equipment,
      cards,
    );
    expectedBound = {
      ...expected,
      mechanics,
      targeting: compileDeclaredMechanicsTargeting(mechanics),
    };
  } catch (error) {
    throw new Error(
      `Cannot bind certified weapon action ${expected.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  const bound = parseDeclaredWeaponActionPolicy(expectedBound, 'bound');
  if (bound.status !== 'valid') {
    throw new Error(`Bound weapon action ${expected.id} is invalid: ${bound.issue}`);
  }
  const expectedExecution = certifiedExecutionProjection(expectedBound);
  const actualExecution = certifiedExecutionProjection(action);
  if (canonicalStringify(actualExecution) !== canonicalStringify(expectedExecution)) {
    const expectedRange = object(expectedExecution.mechanics.targeting)?.range_ft;
    const actualRange = object(actualExecution.mechanics.targeting)?.range_ft;
    throw new Error(
      `Action ${action.id} differs from its actor-specific certified weapon binding at ${
        firstExecutionDifference(expectedExecution, actualExecution)
      } (expected range ${String(expectedRange)}, received ${String(actualRange)})`,
    );
  }
  // Keep the reviewed identity and the actor-specific weapon binding together.
  // Returning the unbound 600-foot template here makes the session's own
  // second certification pass reject the action that just passed validation.
  return certifiedActionWithLiveMetadata(expectedBound, action);
}

export function actionBelongsToSheetCombatSlice(action: RuleActionDefinition): boolean {
  return isSheetCombatAction(action);
}

function assertCertifiedPreparedSources(
  actor: ActorState,
  certified: CertifiedSheetCombatCatalog,
): void {
  const access = actor.spellcastingAccess;
  const preparedEntries = Object.entries(access?.preparedSources ?? {});
  const actualSourceIds = preparedEntries.map(([sourceId]) => sourceId).sort();
  const spellbookBySource = new Map<string, string[]>();
  for (const grant of access?.grants ?? []) {
    if (grant.access !== 'spellbook') continue;
    const actionIds = spellbookBySource.get(grant.sourceId) ?? [];
    actionIds.push(grant.actionId);
    spellbookBySource.set(grant.sourceId, actionIds);
  }
  const expectedSourceIds = [...spellbookBySource.keys()].sort();
  if (canonicalStringify(actualSourceIds) !== canonicalStringify(expectedSourceIds)) {
    throw new Error(`Actor ${actor.id} prepared source set differs from certified spellbook access`);
  }
  const certifiedSourceIds = new Set(certified.preparedSourceProfiles.map((profile) => (
    profile.sourceId
  )));
  for (const [sourceKey, source] of preparedEntries) {
    if (!source || source.sourceId !== sourceKey) {
      throw new Error(`Actor ${actor.id} prepared source ${sourceKey} has invalid identity`);
    }
    if (new Set(source.availableActionIds).size !== source.availableActionIds.length
      || new Set(source.preparedActionIds).size !== source.preparedActionIds.length
      || source.preparedActionIds.length !== source.capacity) {
      throw new Error(`Actor ${actor.id} prepared source ${sourceKey} has invalid capacity or duplicates`);
    }
    const projected = projectCertifiedPreparedSource(source);
    // Capacity is character-progression data. The L1 certification proves the
    // source identity and every spell grant; later levels may legitimately
    // increase the exact prepared subset without changing those mechanics.
    // Cardinality, uniqueness, availability and grant equality remain strict.
    if (!certifiedSourceIds.has(projected.sourceId)) {
      throw new Error(`Actor ${actor.id} prepared source ${sourceKey} is uncertified`);
    }
    const grantedActionIds = sortedUnique(spellbookBySource.get(sourceKey) ?? []);
    if (canonicalStringify(projected.availableActionIds) !== canonicalStringify(grantedActionIds)) {
      throw new Error(`Actor ${actor.id} available spells for ${sourceKey} differ from its grants`);
    }
    if (projected.preparedActionIds.some((actionId) => !projected.availableActionIds.includes(actionId))) {
      throw new Error(`Actor ${actor.id} prepares an unavailable spell for ${sourceKey}`);
    }
  }
}

/**
 * Rejects any resolution-affecting grant or preparation bytes that were not
 * produced by one of the fully compiled, covered micro-MVP roots.
 */
export function assertCertifiedSheetCombatActorAccess(
  actor: ActorState,
  actionIds: readonly string[],
  certified: CertifiedSheetCombatCatalog,
): void {
  if (new Set(actionIds).size !== actionIds.length) {
    throw new Error(`Actor ${actor.id} has duplicate certified combat action IDs`);
  }
  assertCertifiedPreparedSources(actor, certified);
  for (const actionId of actionIds) {
    const action = certified.catalog.getAction(actionId);
    if (!action) throw new Error(`Action ${actionId} is outside certified combat access`);
    if (!actor.capabilities.actionIds.includes(actionId)) {
      throw new Error(`Actor ${actor.id} capability set does not grant ${actionId}`);
    }
    if (action.kind !== 'spell') continue;
    const expected = new Set(
      (certified.accessSignaturesByAction[actionId] ?? [])
        .map((signature) => canonicalStringify(signature.grants)),
    );
    const actual = projectCertifiedActorAccess(actor, actionId);
    if (!actual.grants.length || !expected.has(canonicalStringify(actual.grants))) {
      throw new Error(`Actor ${actor.id} access for ${actionId} differs from certified access`);
    }
  }
}
