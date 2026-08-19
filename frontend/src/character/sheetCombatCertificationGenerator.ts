import { createHash } from 'node:crypto';
import {
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileMicroMvpL1Overlay,
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Provider,
} from '../canon/microMvpL1Overlay';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
} from '../canon/prodSnapshotL1Fixtures';
import { canonicalStringify } from '../rules-core/determinism';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { buildMicroMvpSpellScopePolicy } from '../rules-core/microMvpSpellScope';
import { buildRulesLabFixtureArtifact } from '../pages/rulesLabFixtureGenerator';
import {
  actionBelongsToSheetCombatSlice,
  MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
  projectCertifiedActorAccess,
  SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT,
  SHEET_COMBAT_CERTIFICATION_SCHEMA_VERSION,
  sheetCombatCertificationSourceProjection,
  type CertifiedActorAccessProjection,
  type CertifiedPreparedSourceProjection,
  type CertifiedSpellGrantProjection,
  type SheetCombatCertificationArtifact,
  type SheetCombatMagicInitiateProvenance,
} from './sheetCombatCertifiedCatalog';

export const SHEET_COMBAT_CERTIFICATION_ARTIFACT_PATH = fileURLToPath(
  new URL('./sheetCombatCertification.generated.json', import.meta.url),
);

function sha256Canonical(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueCanonical<T>(values: readonly T[]): T[] {
  const bySignature = new Map<string, T>();
  for (const value of values) bySignature.set(canonicalStringify(value), value);
  return [...bySignature.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

interface SupplementalCombatActor {
  actor: ActorState;
  actions: readonly RuleActionDefinition[];
  /** Root whose declared choice branch was compiled for this supplemental actor. */
  stableKey?: string;
}

function exactActionCatalog(
  provider: CompiledMicroMvpL1Provider,
  supplementalActors: readonly SupplementalCombatActor[] = [],
): RuleActionDefinition[] {
  const byId = new Map<string, RuleActionDefinition>();
  for (const sourceActions of [
    ...provider.roots.map((root) => root.rulesActions),
    provider.globalActions,
    ...supplementalActors.map((supplemental) => supplemental.actions),
  ]) {
    for (const action of sourceActions.filter(actionBelongsToSheetCombatSlice)) {
      const previous = byId.get(action.id);
      if (previous && canonicalStringify(previous) !== canonicalStringify(action)) {
        throw new Error(`Cannot certify ambiguous combat action ${action.id}`);
      }
      byId.set(action.id, action);
    }
  }
  return [...byId.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((action) => JSON.parse(JSON.stringify(action)) as RuleActionDefinition);
}

function accessSignatures(
  provider: CompiledMicroMvpL1Provider,
  actions: readonly RuleActionDefinition[],
  supplementalActors: readonly SupplementalCombatActor[] = [],
): Record<string, CertifiedActorAccessProjection[]> {
  const actionIds = new Set(actions.map((action) => action.id));
  const signatures = new Map<string, CertifiedActorAccessProjection[]>();
  for (const root of provider.roots) {
    for (const action of root.rulesActions) {
      if (!actionIds.has(action.id)) continue;
      const values = signatures.get(action.id) ?? [];
      values.push(projectCertifiedActorAccess(root.actor, action.id));
      signatures.set(action.id, values);
    }
  }
  for (const supplemental of supplementalActors) {
    for (const action of supplemental.actions) {
      if (!actionIds.has(action.id)) continue;
      const expected = actions.find((candidate) => candidate.id === action.id);
      if (!expected || canonicalStringify(expected) !== canonicalStringify(action)) {
        throw new Error(`Cannot certify supplemental action drift for ${action.id}`);
      }
      const values = signatures.get(action.id) ?? [];
      values.push(projectCertifiedActorAccess(supplemental.actor, action.id));
      signatures.set(action.id, values);
    }
  }
  return Object.fromEntries(actions.map((action) => {
    const values = uniqueCanonical(signatures.get(action.id) ?? (
      action.kind === 'nonSpell' ? [{ grants: [], preparedSources: [] }] : []
    ));
    if (!values.length) throw new Error(`Cannot certify missing actor access for ${action.id}`);
    return [action.id, values];
  }));
}

function preparedSourceProfiles(
  signatures: Readonly<Record<string, readonly CertifiedActorAccessProjection[]>>,
): CertifiedPreparedSourceProjection[] {
  return uniqueCanonical(Object.values(signatures)
    .flatMap((values) => values)
    .flatMap((signature) => signature.preparedSources));
}

function magicInitiateProvenance(
  provider: CompiledMicroMvpL1Provider,
  actions: readonly RuleActionDefinition[],
  signatures: Readonly<Record<string, readonly CertifiedActorAccessProjection[]>>,
): SheetCombatMagicInitiateProvenance {
  const roots = provider.roots.filter((root) => (
    root.matrixCase.originFeat.card_number === MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID
  ));
  const originFeatEntityIds = sortedUnique(roots.map((root) => root.matrixCase.originFeat.id));
  if (originFeatEntityIds.length !== 1) {
    throw new Error('Cannot certify Magic Initiate: origin feat entity identity is ambiguous');
  }
  const rows = actions.flatMap((action) => {
    const grants = uniqueCanonical((signatures[action.id] ?? [])
      .flatMap((signature) => signature.grants)
      .filter((grant) => grant.sourceId === MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID));
    if (!grants.length) return [];
    if (!action.sourceEntityIds.includes(originFeatEntityIds[0])) {
      throw new Error(`Cannot certify Magic Initiate provenance for ${action.id}`);
    }
    return [{
      actionId: action.id,
      sourceEntityIds: [...action.sourceEntityIds],
      grantSignatures: grants as CertifiedSpellGrantProjection[],
    }];
  });
  if (rows.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT) {
    throw new Error(
      `Cannot certify Magic Initiate: expected `
      + `${SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT} combat actions, got ${rows.length}`,
    );
  }
  return {
    grantSourceId: MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
    originFeatEntityId: originFeatEntityIds[0],
    actions: rows.sort((left, right) => left.actionId.localeCompare(right.actionId)),
  };
}

/**
 * Builds a separate runtime certificate from the complete compiled matrix.
 * No curated UI fixture participates in the denominator or its signatures.
 */
export function buildSheetCombatCertificationArtifactFromProvider(
  provider: CompiledMicroMvpL1Provider,
  supplementalActors: readonly SupplementalCombatActor[] = [],
): SheetCombatCertificationArtifact {
  const roots = [...provider.roots].sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  if (roots.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT) {
    throw new Error(`Cannot certify combat: expected 448 roots, got ${roots.length}`);
  }
  const actions = exactActionCatalog(provider, supplementalActors);
  if (actions.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT) {
    throw new Error(
      `Cannot certify combat: expected ${SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT} exact actions, got ${actions.length}`,
    );
  }
  const universalActionIds = provider.globalActions
    .filter(actionBelongsToSheetCombatSlice)
    .map((action) => action.id);
  const supplementalActionIdsByRoot = new Map<string, string[]>();
  for (const supplemental of supplementalActors) {
    if (!supplemental.stableKey) continue;
    const ids = supplementalActionIdsByRoot.get(supplemental.stableKey) ?? [];
    ids.push(...supplemental.actions
      .filter(actionBelongsToSheetCombatSlice)
      .map((action) => action.id));
    supplementalActionIdsByRoot.set(supplemental.stableKey, ids);
  }
  const coverage = roots.map((root) => ({
    stableKey: root.stableKey,
    actionIds: sortedUnique([
      ...root.rulesActions
        .filter(actionBelongsToSheetCombatSlice)
        .map((action) => action.id),
      ...universalActionIds,
      ...(supplementalActionIdsByRoot.get(root.stableKey) ?? []),
    ]),
  }));
  const signatures = accessSignatures(provider, actions, supplementalActors);
  const profiles = preparedSourceProfiles(signatures);
  const base = {
    schemaVersion: SHEET_COMBAT_CERTIFICATION_SCHEMA_VERSION,
    artifactVersion: SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION,
    source: {
      ruleset: JSON.parse(JSON.stringify(provider.ruleset)) as typeof provider.ruleset,
      release: JSON.parse(JSON.stringify(provider.release)) as typeof provider.release,
    },
    summary: {
      rootCount: coverage.length,
      combatRootCount: coverage.filter((row) => row.actionIds.length > 0).length,
      actionOccurrenceCount: coverage.reduce((sum, row) => sum + row.actionIds.length, 0),
      uniqueActionCount: actions.length,
    },
    coverage,
    actions,
    accessSignaturesByAction: signatures,
    preparedSourceProfiles: profiles,
    magicInitiate: magicInitiateProvenance(provider, actions, signatures),
  };
  const sourceProjectionHash = sha256Canonical(sheetCombatCertificationSourceProjection(base));
  const content = { ...base, sourceProjectionHash };
  return { ...content, contentHash: sha256Canonical(content) };
}

/**
 * The 448-root denominator intentionally chooses one deterministic option for
 * each Forge choice. Runtime certification must additionally include every
 * legal combat-capable Magic Initiate spell and every legal mental casting
 * ability; otherwise a valid non-default Forge build poisons the whole combat
 * session even when the action being used is a certified weapon attack.
 */
async function magicInitiateCombatChoiceSupplementals(
  provider: CompiledMicroMvpL1Provider,
): Promise<SupplementalCombatActor[]> {
  const sourceRoot = [...provider.roots]
    .filter((root) => (
      root.matrixCase.originFeat.card_number === MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID
      && root.stableKey.startsWith('class.fighter|')
    ))
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey))[0];
  if (!sourceRoot) throw new Error('Cannot certify Magic Initiate choice branches: no Fighter root');

  const [catalogs, manifest] = await Promise.all([
    Promise.resolve(readProdSnapshotCatalogs()),
    readMicroMvpSnapshotManifest(),
  ]);
  const policy = buildMicroMvpSpellScopePolicy({
    manifest,
    snapshotSpells: catalogs.spells,
  });
  const spellIds = policy.choices.magic_initiate_wizard_level_1.spellIds;
  const abilities = ['int', 'wis', 'cha'] as const;
  const variants = await compileMicroMvpL1ChoiceVariants(spellIds.flatMap((spellId) => (
    abilities.map((ability) => ({
      stableKey: sourceRoot.stableKey,
      overrides: {
        magic_initiate_wizard_level_1: [spellId],
        magic_initiate_spellcasting_ability: [ability],
      },
    }))
  )));
  return variants.map((variant) => ({
    stableKey: sourceRoot.stableKey,
    actor: variant.actor,
    actions: variant.rulesActions.filter((action) => (
      action.sourceEntityIds.includes(variant.matrixCase.originFeat.id)
    )),
  }));
}

export async function buildSheetCombatCertificationArtifact(): Promise<SheetCombatCertificationArtifact> {
  const [provider, fixture] = await Promise.all([
    compileMicroMvpL1Overlay(),
    buildRulesLabFixtureArtifact(),
  ]);
  const roots = (fixture.roots ?? {}) as Record<string, {
    actor?: ActorState;
    actions?: RuleActionDefinition[];
  }>;
  const familiarWizard = roots.familiarWizard;
  if (!familiarWizard?.actor || !Array.isArray(familiarWizard.actions)) {
    throw new Error('Cannot certify Rules Lab familiar Wizard access variant');
  }
  const magicInitiateSupplementals = await magicInitiateCombatChoiceSupplementals(provider);
  return buildSheetCombatCertificationArtifactFromProvider(provider, [
    { actor: familiarWizard.actor, actions: familiarWizard.actions },
    ...magicInitiateSupplementals,
  ]);
}

export function serializeSheetCombatCertificationArtifact(
  artifact: SheetCombatCertificationArtifact,
): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export interface SheetCombatCertificationDriftResult {
  matches: boolean;
  expected: string;
  actual: string | null;
  expectedHash: string;
  actualHash: string | null;
}

function sha256Bytes(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export async function checkSheetCombatCertificationDrift(
  artifactPath = SHEET_COMBAT_CERTIFICATION_ARTIFACT_PATH,
  expected?: string,
): Promise<SheetCombatCertificationDriftResult> {
  const rendered = expected ?? serializeSheetCombatCertificationArtifact(
    await buildSheetCombatCertificationArtifact(),
  );
  let actual: string | null = null;
  try {
    actual = await readFile(artifactPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    matches: actual === rendered,
    expected: rendered,
    actual,
    expectedHash: sha256Bytes(rendered),
    actualHash: actual === null ? null : sha256Bytes(actual),
  };
}

let temporaryFileOrdinal = 0;

export async function writeSheetCombatCertificationAtomically(
  serialized: string,
  artifactPath = SHEET_COMBAT_CERTIFICATION_ARTIFACT_PATH,
): Promise<void> {
  const directory = dirname(artifactPath);
  const temporaryPath = join(
    directory,
    `.${basename(artifactPath)}.${process.pid}.${temporaryFileOrdinal += 1}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o644);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, artifactPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

export async function generateSheetCombatCertification(
  artifactPath = SHEET_COMBAT_CERTIFICATION_ARTIFACT_PATH,
): Promise<{ artifactPath: string; hash: string; bytes: number }> {
  const serialized = serializeSheetCombatCertificationArtifact(
    await buildSheetCombatCertificationArtifact(),
  );
  await writeSheetCombatCertificationAtomically(serialized, artifactPath);
  return {
    artifactPath,
    hash: sha256Bytes(serialized),
    bytes: Buffer.byteLength(serialized),
  };
}
