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
import { materializeMicroMvpL1ContentPatch } from '../canon/declarativeMechanicsPatch';
import miniMvpForgeSheetFixture from '../canon/data/mini-mvp-forge-sheet-fixture.v1.json';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
} from '../canon/prodSnapshotL1Fixtures';
import type { RuntimeState } from '../mvp/contracts';
import { canonicalStringify } from '../rules-core/determinism';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { buildMicroMvpSpellScopePolicy } from '../rules-core/microMvpSpellScope';
import { buildRulesLabFixtureArtifact } from '../pages/rulesLabFixtureGenerator';
import { collectSheetActions } from './actionSheet';
import { assemble, type EntityBundle } from './assemble';
import { buildCharacterContext } from './runtime';
import { syncRuntimeResources } from './resourceInit';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildSheetCanonicalRuntime } from './sheetCanonicalWorld';
import { spellMatchesChoice } from './spellChoices';
import { emptyDraft, type AbilityScores } from './types';
import {
  actionBelongsToSheetCombatSlice,
  MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
  projectCertifiedActorAccess,
  SHEET_COMBAT_CERTIFICATION_ARTIFACT_VERSION,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_ACTION_COUNT,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_MAGIC_INITIATE_ACTION_COUNT,
  SHEET_COMBAT_CERTIFICATION_EXPECTED_MATRIX_ROOT_COUNT,
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

const KNOWN_SPELL_CLASS_SUPPLEMENTAL_CLASSES = [
  {
    classCardNumber: 'CLASS-bard',
    abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 16 },
  },
  {
    classCardNumber: 'CLASS-sorcerer',
    abilities: { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 16 },
  },
] as const satisfies ReadonlyArray<{
  classCardNumber: string;
  abilities: AbilityScores;
}>;

function rawSpellBelongsToSheetCombatSlice(spell: { mechanics?: Record<string, unknown> | null }): boolean {
  const mechanics = spell.mechanics ?? {};
  const primitive = mechanics.primitive && typeof mechanics.primitive === 'object'
    ? mechanics.primitive as Record<string, unknown>
    : {};
  const activation = mechanics.activation && typeof mechanics.activation === 'object'
    ? mechanics.activation as Record<string, unknown>
    : {};
  const trigger = activation.trigger && typeof activation.trigger === 'object'
    ? activation.trigger as Record<string, unknown>
    : {};
  return ['burning_hands_objects', 'area_object_push', 'magic_missile'].includes(
    String(primitive.type ?? ''),
  ) || (Array.isArray(trigger.events) && trigger.events.includes('targeted_by_magic_missile'));
}

function materializeBardSpellcastingMigration118<T extends {
  effects: Array<{ card_number: string; mechanics?: Record<string, unknown> | null }>;
}>(catalogs: T): T {
  const matches = catalogs.effects.filter((effect) => effect.card_number === 'EFF-bard-spellcasting');
  if (matches.length !== 1) {
    throw new Error(`Cannot materialize Bard spellcasting migration 118: got ${matches.length} effects`);
  }
  const effect = matches[0];
  const mechanics = JSON.parse(JSON.stringify(effect.mechanics ?? {})) as Record<string, unknown>;
  const interactions = Array.isArray(mechanics.effects)
    ? mechanics.effects as Array<Record<string, unknown>>
    : [];
  const first = interactions[0];
  const results = first && Array.isArray(first.result)
    ? first.result as Array<Record<string, unknown>>
    : [];
  const hasPrimaryCharisma = results.some((result) => (
    result.kind === 'spellcasting_ability'
      && result.role === 'primary'
      && result.ability === 'cha'
  ));
  if (!first || !results.length) {
    throw new Error('Cannot materialize Bard spellcasting migration 118: legacy narrative is absent');
  }
  if (!hasPrimaryCharisma) {
    first.result = [
      { kind: 'spellcasting_ability', role: 'primary', ability: 'cha' },
      ...results,
    ];
  }
  effect.mechanics = mechanics;
  return catalogs;
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
  if (roots.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_MATRIX_ROOT_COUNT) {
    throw new Error(
      `Cannot certify combat: expected ${SHEET_COMBAT_CERTIFICATION_EXPECTED_MATRIX_ROOT_COUNT} matrix roots, got ${roots.length}`,
    );
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
  const matrixCoverage = roots.map((root) => ({
    stableKey: root.stableKey,
    actionIds: sortedUnique([
      ...root.rulesActions
        .filter(actionBelongsToSheetCombatSlice)
        .map((action) => action.id),
      ...universalActionIds,
      ...(supplementalActionIdsByRoot.get(root.stableKey) ?? []),
    ]),
  }));
  const matrixStableKeys = new Set(roots.map((root) => root.stableKey));
  const supplementalCoverage = [...supplementalActionIdsByRoot.entries()]
    .filter(([stableKey]) => !matrixStableKeys.has(stableKey))
    .map(([stableKey, actionIds]) => ({
      stableKey,
      actionIds: sortedUnique(actionIds),
    }));
  const coverage = [...matrixCoverage, ...supplementalCoverage]
    .sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  if (coverage.length !== SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT) {
    throw new Error(
      `Cannot certify combat: expected ${SHEET_COMBAT_CERTIFICATION_EXPECTED_ROOT_COUNT} total roots, got ${coverage.length}`,
    );
  }
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
 * The 448-root micro-MVP denominator predates Bard and fixes one deterministic
 * Sorcerer spell selection. Compile every legal L1 known-spell choice through
 * the same Forge -> sheet bridge so valid Bard and alternate Sorcerer builds do
 * not poison combat-session initialization. Only mechanics already admitted by
 * actionBelongsToSheetCombatSlice can enter the resulting certificate.
 */
function knownSpellClassCombatChoiceSupplementals(): SupplementalCombatActor[] {
  const catalogs = materializeBardSpellcastingMigration118(
    materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs,
  );
  const supplementals: SupplementalCombatActor[] = [];

  for (const fixture of KNOWN_SPELL_CLASS_SUPPLEMENTAL_CLASSES) {
    const classMatches = catalogs.classes.filter((candidate) => (
      candidate.card_number === fixture.classCardNumber
    ));
    if (classMatches.length !== 1) {
      throw new Error(
        `Cannot certify ${fixture.classCardNumber} spell choices: expected one class, got ${classMatches.length}`,
      );
    }
    const klass = classMatches[0];
    const origin = { kind: 'class' as const, id: klass.id, name: klass.name };
    const levelOne = klass.level_progression?.['1'];
    const effects = (levelOne?.effects ?? []).map((effectId) => {
      const matches = catalogs.effects.filter((candidate) => candidate.id === effectId);
      if (matches.length !== 1) {
        throw new Error(`${fixture.classCardNumber}: effect ${effectId} has ${matches.length} matches`);
      }
      return { effect: matches[0], origin };
    });
    const bundle = (spells: typeof catalogs.spells): EntityBundle => ({
      race: null,
      klass,
      background: null,
      feats: [],
      effects,
      // The supplemental certificate is deliberately spell-only. Other class
      // actions remain governed by their own reviewed mechanics catalogs.
      actions: [],
      spells,
      resources: catalogs.resources,
      variableDefs: catalogs.variables,
    });
    const baseDraft = {
      ...emptyDraft(),
      classId: klass.id,
      level: 1,
      abilities: fixture.abilities,
    };
    const initial = assemble(bundle([]), baseDraft);
    const spellChoices = initial.pendingChoices.filter((choice) => (
      choice.origin.kind === 'class'
        && choice.origin.id === klass.id
        && choice.source === 'spell'
        && choice.grantKind === 'grant_spell'
    ));
    if (!spellChoices.length) {
      throw new Error(`Cannot certify ${fixture.classCardNumber}: class spell choices are absent`);
    }
    const fixtureRoot = miniMvpForgeSheetFixture.roots.find((root) => (
      root.classCardNumber === fixture.classCardNumber
    ));
    if (!fixtureRoot) {
      throw new Error(`Cannot certify ${fixture.classCardNumber}: Forge fixture root is absent`);
    }
    const fixtureResolvedChoices = fixtureRoot.draft.resolvedChoices as Record<string, string[]>;
    const eligibleByChoice = new Map(spellChoices.map((choice) => [
      choice.id,
      catalogs.spells
        .filter((spell) => spellMatchesChoice(spell, choice, 1))
        .sort((left, right) => left.card_number.localeCompare(right.card_number)),
    ]));
    for (const choice of spellChoices) {
      if ((eligibleByChoice.get(choice.id)?.length ?? 0) < choice.count) {
        throw new Error(
          `Cannot certify ${fixture.classCardNumber}: ${choice.id} has fewer legal spells than required`,
        );
      }
    }
    const targets = [...new Map(
      [...eligibleByChoice.values()].flat().map((spell) => [spell.id, spell]),
    ).values()]
      .filter(rawSpellBelongsToSheetCombatSlice)
      .sort((left, right) => left.card_number.localeCompare(right.card_number));

    for (const target of targets) {
      const resolvedChoices = Object.fromEntries(spellChoices.map((choice) => {
        const eligible = eligibleByChoice.get(choice.id) ?? [];
        const fixtureSpellIds = fixtureResolvedChoices[choice.id] ?? [];
        const fixtureSpells = fixtureSpellIds.flatMap((reference) => (
          eligible.filter((spell) => spell.id === reference || spell.card_number === reference)
        ));
        const selected = [
          ...(eligible.some((spell) => spell.id === target.id) ? [target] : []),
          ...fixtureSpells.filter((spell) => spell.id !== target.id),
          ...eligible.filter((spell) => spell.id !== target.id),
        ].filter((spell, index, values) => (
          values.findIndex((candidate) => candidate.id === spell.id) === index
        )).slice(0, choice.count);
        return [choice.id, selected.map((spell) => spell.id)];
      }));
      const selectedSpells = [...new Map(
        Object.values(resolvedChoices)
          .flat()
          .map((spellId) => {
            const spell = catalogs.spells.find((candidate) => candidate.id === spellId);
            if (!spell) throw new Error(`${fixture.classCardNumber}: selected spell ${spellId} disappeared`);
            return [spell.id, spell] as const;
          }),
      ).values()];
      const draft = {
        ...baseDraft,
        resolvedChoices,
        spellIds: selectedSpells.map((spell) => spell.id),
      };
      const assembled = assemble(bundle(selectedSpells), draft);
      const ruleState = resolveCharacterRules({ draft, assembled });
      const characterContext = buildCharacterContext(
        ruleState,
        { level: 1, abilities: draft.abilities as Record<string, number> },
        [],
        klass,
      );
      const resourceRuntime = syncRuntimeResources(
        characterContext,
        assembled,
        undefined,
        ruleState.freeuseSpells,
      );
      const runtime: RuntimeState = {
        hp: { current: ruleState.maxHP, max: ruleState.maxHP, temp: 0 },
        resources: resourceRuntime.resources,
        maxResources: resourceRuntime.maxResources,
        equipment: {},
        inventory: [],
        activeEffects: [],
        firedThisTurn: [],
        firedThisRest: [],
      };
      const sheetActions = collectSheetActions(assembled).filter((action) => (
        action.spellRef?.id === target.id
      ));
      if (sheetActions.length !== 1) {
        throw new Error(
          `Cannot certify ${fixture.classCardNumber}/${target.card_number}: expected one sheet action, got ${sheetActions.length}`,
        );
      }
      const canonical = buildSheetCanonicalRuntime({
        character: {
          id: `sheet-combat-cert:${fixture.classCardNumber}:${target.card_number}`,
          name: `${fixture.classCardNumber} ${target.card_number}`,
          system_id: 'dnd5e-2024',
          ruleset_version: '2024',
          turn_state: null,
          resolved_choices: resolvedChoices,
        },
        assembled,
        ruleState,
        sheetActions,
        runtime,
        characterContext,
        ac: ruleState.armorClass,
      });
      const combatActions = canonical.actions.filter((action) => (
        action.kind === 'spell'
          && action.spell.sourceClass === fixture.classCardNumber
          && actionBelongsToSheetCombatSlice(action)
      ));
      if (combatActions.length) {
        supplementals.push({
          stableKey: `supplemental:known-spell-class:${fixture.classCardNumber}`,
          actor: canonical.world.actors[canonical.actorId],
          actions: combatActions,
        });
      }
    }
  }
  return supplementals;
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
  const knownSpellClassSupplementals = knownSpellClassCombatChoiceSupplementals();
  return buildSheetCombatCertificationArtifactFromProvider(provider, [
    { actor: familiarWizard.actor, actions: familiarWizard.actions },
    ...magicInitiateSupplementals,
    ...knownSpellClassSupplementals,
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
