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

describe('micro-MVP semantic acceptance gate', () => {
  it('requires current unit, scenario, and compiled-release evidence for every entity and derived obligation', async () => {
    const manifest = await readMicroMvpSnapshotManifest();
    const denominator = createMicroMvpCoverageDenominator(manifest);
    expect(denominator.currentEntityIds).toHaveLength(MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY);
    const executionManifest = readCurrentMicroMvpEvidenceExecutionManifest();
    validatePhb2024ConditionEvidenceExecution(executionManifest);
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

    validateCapabilityEvidenceStrict({
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
  }, 60_000);
});
