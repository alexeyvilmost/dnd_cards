import { describe, expect, it } from 'vitest';
import { readMicroMvpSnapshotManifest } from '../../canon/prodSnapshotL1Fixtures';
import {
  createMicroMvpCoverageDenominator,
  MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY,
} from './microMvpDenominator';
import {
  createMicroMvpCompiledReleaseScenarioEvidenceRegistry,
  createMicroMvpUnitEvidenceRegistry,
  executeMicroMvpScenarioEvidence,
  materializeMicroMvpCompiledReleaseScenarioEvidence,
  materializeMicroMvpScenarioTestEvidence,
  materializeMicroMvpUnitEvidence,
} from './microMvpEvidence';
import { readCurrentMicroMvpEvidenceExecutionManifest } from './microMvpEvidenceExecution.node';
import { validateCapabilityEvidenceStrict } from './validator';
import { validatePhb2024ConditionEvidenceExecution } from './phb2024ConditionEvidence';
import { MICRO_MVP_L1_CONTENT_PATCH } from '../../canon/declarativeMechanicsPatch';
import { validateConditionDatabaseMaterialization } from '../../canon/conditionDatabaseMaterialization';
import { createMicroMvpTestCoverageSummary } from './microMvpCoverageSummary';
import { validateBasicInteractionEvidenceExecution } from './basicInteractionEvidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

describe('micro-MVP semantic acceptance gate', () => {
  it('requires current unit, scenario, and compiled-release evidence for every entity and derived obligation', async () => {
    const manifest = await readMicroMvpSnapshotManifest();
    const denominator = createMicroMvpCoverageDenominator(manifest);
    expect(denominator.currentEntityIds).toHaveLength(MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY);
    const executionManifest = readCurrentMicroMvpEvidenceExecutionManifest();
    validatePhb2024ConditionEvidenceExecution(executionManifest);
    validateBasicInteractionEvidenceExecution(executionManifest);
    validateConditionDatabaseMaterialization(
      MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((declaration) => ({
        card_number: declaration.cardNumber,
        name: String(declaration.fields.name ?? ''),
        description: String(declaration.fields.description ?? ''),
        effect_type: String(declaration.fields.effect_type ?? ''),
        mechanics: declaration.fields.mechanics,
      })),
    );

    const unitEvidence = materializeMicroMvpUnitEvidence(
      createMicroMvpUnitEvidenceRegistry(denominator),
      executionManifest,
    );
    const scenarioEvidence = executeMicroMvpScenarioEvidence();
    const scenarioTestEvidence = materializeMicroMvpScenarioTestEvidence(
      undefined,
      executionManifest,
    );
    const compiledReleaseEvidence = materializeMicroMvpCompiledReleaseScenarioEvidence(
      createMicroMvpCompiledReleaseScenarioEvidenceRegistry(denominator),
      executionManifest,
    );

    const report = validateCapabilityEvidenceStrict({
      currentRelease: denominator.currentRelease,
      currentEntityIds: denominator.currentEntityIds,
      obligations: denominator.obligations,
      matrix: denominator.matrix,
      assertions: [
        ...unitEvidence,
        ...scenarioEvidence,
        ...scenarioTestEvidence,
        ...compiledReleaseEvidence,
      ],
    });
    const coverage = createMicroMvpTestCoverageSummary(denominator, report.evidenceIndex);
    expect(Object.keys(coverage.entities)).toHaveLength(64);
    expect(coverage.entities).toHaveProperty('class.fighter');
    expect(coverage.entities).toHaveProperty('condition.unconscious');
    expect(coverage.required).toBeGreaterThan(0);
    expect(coverage.passed).toBe(coverage.required);
    expect(coverage.percent).toBe(100);

    const outputPath = process.env.MICRO_MVP_COVERAGE_SUMMARY_PATH;
    if (outputPath) {
      const destination = resolve(outputPath);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, `${JSON.stringify(coverage, null, 2)}\n`, 'utf8');
    }
  }, 60_000);
});
