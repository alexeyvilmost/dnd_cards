import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalStringify } from '../determinism';
import { readMicroMvpSnapshotManifest } from '../../canon/prodSnapshotL1Fixtures';
import type { MicroMvpSnapshotManifest } from '../../canon/prodSnapshotL1Fixtures';
import type { AssertionEvidence } from './assertionEvidenceIndex';
import { coverageCellKey } from './capabilityEvidenceMatrix';
import {
  createMicroMvpCoverageDenominator,
  MICRO_MVP_DERIVED_OBLIGATION_SPECS,
  MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY,
  MICRO_MVP_PRODUCT_RULE_ID,
  MICRO_MVP_SEMANTIC_ASPECT,
  PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH,
  PINNED_PHB_2024_CORPUS_HASH,
} from './microMvpDenominator';
import type { MicroMvpCoverageDenominator } from './microMvpDenominator';
import {
  createMicroMvpCompiledReleaseScenarioEvidenceRegistry,
  createMicroMvpUnitEvidenceRegistry,
  executeMicroMvpScenarioEvidence,
  materializeMicroMvpCompiledReleaseScenarioEvidence,
  materializeMicroMvpScenarioTestEvidence,
  materializeMicroMvpUnitEvidence,
  MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR,
  MicroMvpEvidenceRegistrationError,
  MICRO_MVP_SCENARIO_EVIDENCE_REGISTRY,
  MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY,
  type RegisteredScenarioTestEvidence,
  type RegisteredUnitEvidence,
} from './microMvpEvidence';
import {
  validateCapabilityEvidence,
  validateCapabilityEvidenceStrict,
} from './validator';
import {
  validateMicroMvpEvidenceExecutionManifest,
  type MicroMvpEvidenceExecutionState,
  type ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';

const FRONTEND_ROOT = join(import.meta.dirname, '../../..');

const FIXTURE_RUN_ID = 'denominator-unit-test-run';
const FIXTURE_STARTED_AT = '2026-08-05T09:00:00.000Z';
const FIXTURE_CREATED_AT = '2026-08-05T09:00:01.000Z';
const FIXTURE_CONFIG_HASH = `sha256:${'a'.repeat(64)}`;

function executionManifestFor(
  locators: readonly {
    testFile: string;
    testName: string;
    evidenceKind?: string;
    semanticProtocol?: string;
    scenarioId?: string;
  }[],
  state: MicroMvpEvidenceExecutionState = 'passed',
): ValidatedMicroMvpEvidenceExecutionManifest {
  const unique = new Map(locators.map((locator) => [
    `${locator.testFile}\u0000${locator.testName}`,
    locator,
  ]));
  const tests = [...unique.values()].map((locator, index) => ({
    testId: `denominator-fixture-${index}`,
    ...locator,
    fullTestName: locator.testName,
    state,
    meta: {
      ...(locator.evidenceKind ? { evidenceKind: locator.evidenceKind } : {}),
      ...(locator.semanticProtocol ? { semanticProtocol: locator.semanticProtocol } : {}),
      ...(locator.scenarioId ? { scenarioId: locator.scenarioId } : {}),
    },
  }));
  return validateMicroMvpEvidenceExecutionManifest({
    schemaVersion: 2,
    runId: FIXTURE_RUN_ID,
    startedAt: FIXTURE_STARTED_AT,
    createdAt: FIXTURE_CREATED_AT,
    configHash: FIXTURE_CONFIG_HASH,
    runResult: 'passed',
    unhandledErrorCount: 0,
    testCount: tests.length,
    tests,
  }, {
    runId: FIXTURE_RUN_ID,
    startedAt: FIXTURE_STARTED_AT,
    configHash: FIXTURE_CONFIG_HASH,
    now: new Date(FIXTURE_CREATED_AT),
  });
}

function registeredUnitLocators(registry: readonly RegisteredUnitEvidence[]) {
  return registry.flatMap((registration) => (
    registration.conjunctiveTests
      ? [...registration.conjunctiveTests]
      : registration.testFile && registration.testName
        ? [{ testFile: registration.testFile, testName: registration.testName }]
        : []
  ));
}

function reverseManifestCollections(manifest: MicroMvpSnapshotManifest): MicroMvpSnapshotManifest {
  return {
    ...manifest,
    collections: Object.fromEntries(Object.entries(manifest.collections).reverse().map(([key, value]) => [
      key,
      [...value].reverse(),
    ])) as MicroMvpSnapshotManifest['collections'],
  };
}

describe('executable micro-MVP semantic denominator', () => {
  let manifest: MicroMvpSnapshotManifest;
  let denominator: MicroMvpCoverageDenominator;
  let assertions: readonly AssertionEvidence[];

  beforeAll(async () => {
    manifest = await readMicroMvpSnapshotManifest();
    denominator = createMicroMvpCoverageDenominator(manifest);
    const unitRegistry = createMicroMvpUnitEvidenceRegistry(denominator);
    const compiledReleaseRegistry = createMicroMvpCompiledReleaseScenarioEvidenceRegistry(denominator);
    const executionManifest = executionManifestFor([
      ...registeredUnitLocators(unitRegistry),
      ...MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY,
      ...compiledReleaseRegistry,
    ]);
    const units = materializeMicroMvpUnitEvidence(
      unitRegistry,
      executionManifest,
    );
    const scenarios = executeMicroMvpScenarioEvidence();
    const scenarioTests = materializeMicroMvpScenarioTestEvidence(undefined, executionManifest);
    const compiledRelease = materializeMicroMvpCompiledReleaseScenarioEvidence(
      compiledReleaseRegistry,
      executionManifest,
    );
    assertions = [...units, ...scenarios, ...scenarioTests, ...compiledRelease];
  }, 60_000);

  it('derives 49 entities plus one product-rule obligation from the current canonical manifest', () => {
    expect(denominator.currentEntityIds).toHaveLength(MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY);
    expect(new Set(denominator.currentEntityIds).size).toBe(49);
    expect(denominator.matrix.scopeEntityIds).toEqual(denominator.currentEntityIds);
    expect(denominator.obligations.filter((item) => (
      item.id.startsWith('micro-mvp.entity.')
    ))).toHaveLength(49);
    expect(denominator.obligations.filter((item) => (
      item.id === 'micro-mvp.product-rule.free_origin_feat_choice_v1'
    ))).toHaveLength(1);
    expect(denominator.matrix.targets.filter((target) => (
      target.obligationId === 'micro-mvp.product-rule.free_origin_feat_choice_v1'
    )).map((target) => target.entityId)).toEqual([
      'feat.alert', 'feat.magic-initiate', 'feat.skilled', 'feat.tough',
    ]);
  });

  it('pins every PHB obligation to the independent reviewed source corpus rather than the overlay', () => {
    const source = readFileSync(join(FRONTEND_ROOT, '../officials/Player\'s Handbook 2024.txt'));
    const actual = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    expect(actual).toBe(PINNED_PHB_2024_CORPUS_HASH);
    expect(new Set(denominator.obligations
      .filter((item) => item.source.track === 'PHB')
      .map((item) => item.source.sourceHash)))
      .toEqual(new Set([PINNED_PHB_2024_CORPUS_HASH]));
    expect(PINNED_PHB_2024_CORPUS_HASH).not.toBe(denominator.currentRelease.rulesHash);
  });

  it('pins the product Origin-feat decision to its own canonical artifact, not the PHB corpus', () => {
    const artifact = JSON.parse(readFileSync(join(
      FRONTEND_ROOT,
      '../docs/product-rules/free_origin_feat_choice_v1.json',
    ), 'utf8')) as Record<string, unknown>;
    const actual = `sha256:${createHash('sha256')
      .update(canonicalStringify(artifact))
      .digest('hex')}`;
    const manifestRule = manifest.productRules.find((candidate) => (
      candidate && typeof candidate === 'object'
        && (candidate as Record<string, unknown>).id === MICRO_MVP_PRODUCT_RULE_ID
    ));
    const productObligation = denominator.obligations.find((item) => (
      item.id === `micro-mvp.product-rule.${MICRO_MVP_PRODUCT_RULE_ID}`
    ));

    expect(manifestRule).toEqual(artifact);
    expect(actual).toBe(PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH);
    expect(productObligation?.source).toMatchObject({
      sourceId: `project-rule:${MICRO_MVP_PRODUCT_RULE_ID}`,
      track: 'project-ruling',
      locator: 'docs/product-rules/free_origin_feat_choice_v1.json',
      sourceHash: PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH,
    });
    expect(PINNED_FREE_ORIGIN_FEAT_CHOICE_V1_HASH).not.toBe(PINNED_PHB_2024_CORPUS_HASH);
  });

  it('keeps invocations, lineages, mastery and other complex mechanics as derived obligations', () => {
    expect(denominator.currentEntityIds.some((id) => id.includes('invocation'))).toBe(false);
    expect(denominator.currentEntityIds.some((id) => id.includes('lineage'))).toBe(false);
    expect(denominator.currentEntityIds.some((id) => id.includes('mastery'))).toBe(false);
    expect(MICRO_MVP_DERIVED_OBLIGATION_SPECS.filter((item) => item.kind === 'invocation'))
      .toHaveLength(17);
    expect(MICRO_MVP_DERIVED_OBLIGATION_SPECS.filter((item) => (
      item.id.startsWith('derived.invocation.pact-') && item.id.split('.').length === 4
    )).map((item) => item.id).sort()).toEqual([
      'derived.invocation.pact-blade.attack-and-damage',
      'derived.invocation.pact-blade.bond-and-replacement',
      'derived.invocation.pact-blade.end-lifecycle',
      'derived.invocation.pact-blade.material-focus',
      'derived.invocation.pact-chain.actor-lifecycle',
      'derived.invocation.pact-chain.attack-substitution',
      'derived.invocation.pact-chain.casting-and-forms',
      'derived.invocation.pact-chain.touch-delivery',
      'derived.invocation.pact-tome.book-and-focus',
      'derived.invocation.pact-tome.casting-modes',
      'derived.invocation.pact-tome.owner-death',
      'derived.invocation.pact-tome.rest-selection',
    ]);
    expect(MICRO_MVP_DERIVED_OBLIGATION_SPECS.filter((item) => item.kind === 'lineage'))
      .toHaveLength(13);
    expect(MICRO_MVP_DERIVED_OBLIGATION_SPECS).toContainEqual(expect.objectContaining({
      id: 'derived.mastery.topple',
      targetEntityIds: ['class.fighter'],
    }));
    expect(MICRO_MVP_DERIVED_OBLIGATION_SPECS).toContainEqual(expect.objectContaining({
      id: 'derived.runtime.magic-missile-distribution-and-shield',
      targetEntityIds: ['spell.magic-missile'],
    }));
  });

  it('states Wizard preparation with the PHB Ritual Adept exception instead of forbidding legal rituals', () => {
    const preparedSubset = MICRO_MVP_DERIVED_OBLIGATION_SPECS.find((item) => (
      item.id === 'derived.runtime.wizard-prepared-subset'
    ));
    expect(preparedSubset?.statement).toBe(
      'A level-1 Wizard can cast a levelled spell normally only from the current prepared subset while retaining the larger spellbook; Ritual Adept permits an unprepared Ritual-tagged spell in that spellbook to be cast as a ritual, and preparation changes preserve both sets.',
    );
  });

  it('is deterministic even if manifest collections and entries arrive in reverse order', () => {
    const reversed = createMicroMvpCoverageDenominator(reverseManifestCollections(manifest));
    expect(canonicalStringify(reversed)).toBe(canonicalStringify(denominator));
  });

  it('fails closed on stale 37-era cardinality or an unreviewed new entity', () => {
    const withoutOneStyle = {
      ...manifest,
      collections: {
        ...manifest.collections,
        fightingStyles: manifest.collections.fightingStyles.slice(0, 3),
      },
    };
    expect(() => createMicroMvpCoverageDenominator(withoutOneStyle)).toThrow(
      /canonical entity cardinality changed: expected 49, got 48/,
    );

    const withUnknown = {
      ...manifest,
      collections: {
        ...manifest.collections,
        cantrips: [...manifest.collections.cantrips, {
          key: 'spell.unreviewed',
          label: 'Unreviewed',
          selector: { cardNumber: 'SPELL-NEW' },
        }],
      },
    };
    expect(() => createMicroMvpCoverageDenominator(withUnknown)).toThrow(
      /canonical entity cardinality changed: expected 49, got 50/,
    );
  });

  it('materializes unit evidence only while exact test files and literal names remain current', () => {
    const registry = createMicroMvpUnitEvidenceRegistry(denominator);
    const executionManifest = executionManifestFor(registeredUnitLocators(registry));
    const materialized = materializeMicroMvpUnitEvidence(registry, executionManifest);
    expect(materialized).toHaveLength(registry.length);
    expect(new Set(materialized.map((item) => item.assertionId)).size).toBe(materialized.length);
    expect(materialized.every((item) => item.result === 'passed')).toBe(true);

    const stale = registry.map((item, index): RegisteredUnitEvidence => {
      if (index !== 0) return item;
      if (item.conjunctiveTests) {
        return {
          ...item,
          conjunctiveTests: item.conjunctiveTests.map((locator, locatorIndex) => (
            locatorIndex === 0
              ? { ...locator, testName: `${locator.testName} (renamed)` }
              : locator
          )),
        };
      }
      return { ...item, testName: `${item.testName} (renamed)` };
    });
    expect(() => materializeMicroMvpUnitEvidence(stale, executionManifest))
      .toThrow(MicroMvpEvidenceRegistrationError);
    try {
      materializeMicroMvpUnitEvidence(stale, executionManifest);
    } catch (error) {
      expect((error as MicroMvpEvidenceRegistrationError).issues).toContainEqual(
        expect.objectContaining({ code: 'missing_test_execution' }),
      );
    }
  });

  it('materializes conjunctive unit evidence deterministically only when every exact test remains current', () => {
    const links = [{
      entityId: 'class.wizard',
      obligationId: denominator.entityObligationIds['class.wizard'],
    }];
    const first = {
      testFile: 'src/rules-core/compiledSpellcasting.integration.test.ts',
      testName: 'casts a prepared Wizard spell with exactly one source-owned slot payment',
    };
    const second = {
      testFile: 'src/rules-core/arcaneRecovery.integration.test.ts',
      testName: 'recovers one level-1 slot after the rest, spends its Long-Rest charge, and replays exactly',
    };
    const registration = (tests: RegisteredUnitEvidence['conjunctiveTests']): RegisteredUnitEvidence => ({
      assertionId: 'UNIT-CONJUNCTIVE-MODEL',
      conjunctiveTests: tests,
      links,
    });
    const executionManifest = executionManifestFor([first, second]);

    const forward = materializeMicroMvpUnitEvidence([
      registration([first, second]),
    ], executionManifest);
    const reversed = materializeMicroMvpUnitEvidence([
      registration([second, first]),
    ], executionManifest);
    expect(forward).toEqual(reversed);
    expect(forward[0].testName).toContain(first.testName);
    expect(forward[0].testName).toContain(second.testName);

    const stale = registration([
      first,
      { ...second, testName: `${second.testName} (renamed)` },
    ]);
    expect(() => materializeMicroMvpUnitEvidence([stale], executionManifest))
      .toThrow(MicroMvpEvidenceRegistrationError);
  });

  it('rejects empty, duplicated, and mixed-mode conjunctive unit registrations', () => {
    const link = [{
      entityId: 'class.wizard',
      obligationId: denominator.entityObligationIds['class.wizard'],
    }];
    const locator = {
      testFile: 'src/rules-core/compiledSpellcasting.integration.test.ts',
      testName: 'casts a prepared Wizard spell with exactly one source-owned slot payment',
    };
    const cases: Array<{
      registration: RegisteredUnitEvidence;
      code: string;
    }> = [
      {
        registration: { assertionId: 'UNIT-EMPTY-CONJUNCTION', conjunctiveTests: [], links: link },
        code: 'empty_conjunctive_tests',
      },
      {
        registration: {
          assertionId: 'UNIT-DUPLICATE-CONJUNCTION',
          conjunctiveTests: [locator, { ...locator }],
          links: link,
        },
        code: 'duplicate_test_locator',
      },
      {
        registration: {
          assertionId: 'UNIT-MIXED-CONJUNCTION',
          testFile: locator.testFile,
          testName: locator.testName,
          conjunctiveTests: [locator],
          links: link,
        },
        code: 'invalid_test_locator_mode',
      },
    ];
    const executionManifest = executionManifestFor([locator]);

    for (const candidate of cases) {
      try {
        materializeMicroMvpUnitEvidence([candidate.registration], executionManifest);
        throw new Error(`expected ${candidate.code}`);
      } catch (error) {
        expect(error).toBeInstanceOf(MicroMvpEvidenceRegistrationError);
        expect((error as MicroMvpEvidenceRegistrationError).issues).toContainEqual(
          expect.objectContaining({ code: candidate.code }),
        );
      }
    }
  });

  it('executes every registered scenario assertion instead of trusting a static passed flag', () => {
    const evidence = executeMicroMvpScenarioEvidence();
    expect(evidence).toHaveLength(MICRO_MVP_SCENARIO_EVIDENCE_REGISTRY.length);
    expect(evidence.every((item) => item.testName.startsWith('SC-'))).toBe(true);

    const stale = MICRO_MVP_SCENARIO_EVIDENCE_REGISTRY.map((item, index) => (
      index === 0 ? { ...item, scenarioAssertionIds: ['SC-01-REMOVED-ASSERTION'] } : item
    ));
    expect(() => executeMicroMvpScenarioEvidence(stale))
      .toThrow(MicroMvpEvidenceRegistrationError);
  });

  it('materializes named two-PC scenario tests only while their exact executable locator remains current', () => {
    const executionManifest = executionManifestFor(MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY);
    const evidence = materializeMicroMvpScenarioTestEvidence(undefined, executionManifest);
    expect(evidence).toHaveLength(MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.length);
    expect(evidence.every((item) => item.links.every((itemLink) => (
      itemLink.evidenceType === 'scenario'
    )))).toBe(true);
    expect(MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.every((item) => (
      item.semanticProtocol === 'mandatory-two-pc-v1' && item.scenarioId.length > 0
    ))).toBe(true);
    expect(new Set(MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.map((item) => item.scenarioId)).size)
      .toBe(MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.length);

    const stale = MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.map((item, index): RegisteredScenarioTestEvidence => (
      index === 0 ? { ...item, testName: `${item.testName} (renamed)` } : item
    ));
    expect(() => materializeMicroMvpScenarioTestEvidence(stale, executionManifest))
      .toThrow(MicroMvpEvidenceRegistrationError);

    const protocolIndex = MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.findIndex((item) => (
      item.semanticProtocol === 'mandatory-two-pc-v1'
    ));
    expect(protocolIndex).toBeGreaterThanOrEqual(0);
    const forgedProtocol = MICRO_MVP_SCENARIO_TEST_EVIDENCE_REGISTRY.map((item, index) => (
      index === protocolIndex ? { ...item, scenarioId: `${item.scenarioId}:forged` } : item
    ));
    expect(() => materializeMicroMvpScenarioTestEvidence(forgedProtocol, executionManifest))
      .toThrow(MicroMvpEvidenceRegistrationError);
  });

  it('requires one exact current-run compiled-release corpus execution for every denominator cell', () => {
    const registry = createMicroMvpCompiledReleaseScenarioEvidenceRegistry(denominator);
    expect(registry).toHaveLength(1);
    expect(registry[0]).toMatchObject(MICRO_MVP_COMPILED_RELEASE_SCENARIO_LOCATOR);
    expect(registry[0].links).toHaveLength(denominator.matrix.targets.length);
    expect(new Set(registry[0].links.map((item) => (
      `${item.entityId}|${item.obligationId}`
    ))).size).toBe(denominator.matrix.targets.length);

    const passedManifest = executionManifestFor(registry);
    const materialized = materializeMicroMvpCompiledReleaseScenarioEvidence(
      registry,
      passedManifest,
    );
    expect(materialized).toHaveLength(1);
    expect(materialized[0].links).toHaveLength(denominator.matrix.targets.length);
    expect(materialized[0].links.every((item) => (
      item.evidenceType === 'compiled_release_scenario'
    ))).toBe(true);

    expect(() => materializeMicroMvpCompiledReleaseScenarioEvidence(
      registry,
      executionManifestFor([]),
    )).toThrow(/missing_test_execution/);
    expect(() => materializeMicroMvpCompiledReleaseScenarioEvidence(
      registry,
      executionManifestFor(registry, 'skipped'),
    )).toThrow(/test_execution_not_passed/);
  });

  it('links current unit and full two-PC scenario evidence to Magic Missile and Shield obligations', () => {
    const report = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions,
    });
    const evidenceFor = (entityId: string, obligationId: string) => report.evidenceIndex[coverageCellKey({
      entityId,
      obligationId,
      aspectId: MICRO_MVP_SEMANTIC_ASPECT,
    })] ?? [];

    const magicMissile = evidenceFor(
      'spell.magic-missile',
      denominator.entityObligationIds['spell.magic-missile'],
    );
    expect(magicMissile.map((item) => item.assertionId)).toEqual([
      'COMPILED-RELEASE-SCENARIO-MICRO-MVP-DENOMINATOR',
      'SCENARIO-SPELL-MAGIC-MISSILE',
      'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-DARTS',
      'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-SHIELD',
    ]);
    expect(new Set(magicMissile.map((item) => item.evidenceType))).toEqual(new Set([
      'unit', 'scenario', 'compiled_release_scenario',
    ]));

    const distribution = evidenceFor(
      'spell.magic-missile',
      'derived.runtime.magic-missile-distribution-and-shield',
    );
    expect(distribution.map((item) => item.assertionId)).toEqual([
      'COMPILED-RELEASE-SCENARIO-MICRO-MVP-DENOMINATOR',
      'SCENARIO-RUNTIME-MAGIC-MISSILE-SHIELD',
      'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-DARTS',
      'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-SHIELD',
    ]);
    expect(new Set(distribution.map((item) => item.evidenceType))).toEqual(new Set([
      'unit', 'scenario', 'compiled_release_scenario',
    ]));

    const shield = evidenceFor('spell.shield', denominator.entityObligationIds['spell.shield']);
    expect(shield.map((item) => item.assertionId)).toEqual([
      'COMPILED-RELEASE-SCENARIO-MICRO-MVP-DENOMINATOR',
      'SCENARIO-SPELL-SHIELD-ATTACK',
      'SCENARIO-SPELL-SHIELD-MAGIC-MISSILE',
      'UNIT-MICRO-MVP-SPELL-MAGIC-MISSILE-SHIELD',
      'UNIT-MICRO-MVP-SPELL-SHIELD-ATTACK',
    ]);
    expect(new Set(shield.map((item) => item.evidenceType))).toEqual(new Set([
      'unit', 'scenario', 'compiled_release_scenario',
    ]));
  });

  it('requires complete unit, two-PC, and compiled-release evidence without fabricated green cells', () => {
    const report = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions,
    });
    expect(report.valid).toBe(true);
    expect(report.summary).toEqual({
      declaredEntities: 49,
      obligations: 128,
      denominatorCells: 136,
      applicableCells: 136,
      justifiedNotApplicableCells: 0,
      requiredEvidenceSlots: 408,
      passedEvidenceSlots: 408,
      uncoveredEvidenceSlots: 0,
      assertions: 175,
    });
    expect(report.summary.requiredEvidenceSlots).toBe(report.summary.denominatorCells * 3);
    expect(report.summary.uncoveredEvidenceSlots).toBe(0);
    expect(report.issues).toEqual([]);
    expect(() => validateCapabilityEvidenceStrict({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions,
    })).not.toThrow();
  });

  it('does not allow scenario_slice evidence to certify a released entity without compiled release execution', () => {
    const withoutCompiledRelease = assertions.filter((assertion) => (
      assertion.links.every((item) => item.evidenceType !== 'compiled_release_scenario')
    ));
    expect(withoutCompiledRelease.some((assertion) => (
      assertion.testFile === 'src/rules-core/testing/microMvpScenarioCorpus.ts'
        && assertion.links.some((item) => item.evidenceType === 'scenario')
    ))).toBe(true);

    const report = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions: withoutCompiledRelease,
    });
    expect(report.valid).toBe(false);
    expect(report.summary.uncoveredEvidenceSlots).toBe(denominator.matrix.targets.length);
    expect(report.issues.filter((issue) => (
      issue.code === 'missing_passing_evidence'
        && issue.message.includes('compiled_release_scenario')
    ))).toHaveLength(denominator.matrix.targets.length);
  });

  it('rejects duplicate, unknown and stale evidence in the real denominator', () => {
    const duplicateReport = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions: [...assertions, assertions[0]],
    });
    expect(duplicateReport.issues).toContainEqual(expect.objectContaining({
      code: 'duplicate_assertion',
    }));

    const unknown: AssertionEvidence = {
      ...assertions[0],
      assertionId: 'UNIT-UNKNOWN-ENTITY',
      links: [{ ...assertions[0].links[0], entityId: 'spell.not-in-manifest' }],
    };
    const unknownReport = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions: [...assertions, unknown],
    });
    expect(unknownReport.issues).toContainEqual(expect.objectContaining({
      code: 'orphan_assertion_link',
    }));

    const stale: AssertionEvidence = {
      ...assertions[0],
      assertionId: 'UNIT-STALE-HASH',
      contentHash: `sha256:${'0'.repeat(64)}`,
    };
    const staleReport = validateCapabilityEvidence({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions: [...assertions, stale],
    });
    expect(staleReport.issues).toContainEqual(expect.objectContaining({
      code: 'stale_content_hash',
    }));
  });
});
