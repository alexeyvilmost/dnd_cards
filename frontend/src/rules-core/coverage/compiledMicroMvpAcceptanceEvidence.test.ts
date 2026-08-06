import { beforeAll, describe, expect, it } from 'vitest';
import { readMicroMvpSnapshotManifest } from '../../canon/prodSnapshotL1Fixtures';
import { compileMicroMvpAcceptanceCorpus } from '../testing/compiledMicroMvpAcceptanceCorpus';
import type { CompiledMicroMvpAcceptanceCorpus } from '../testing/compiledMicroMvpAcceptanceCorpus';
import {
  CompiledMicroMvpAcceptanceEvidenceError,
  executeCompiledMicroMvpAcceptanceEvidence,
  validateCompiledMicroMvpAcceptanceEvidence,
  validateCompiledMicroMvpReleaseEntityCoverage,
} from './compiledMicroMvpAcceptanceEvidence';
import {
  createMicroMvpCoverageDenominator,
  type MicroMvpCoverageDenominator,
} from './microMvpDenominator';

declare module '@vitest/runner' {
  interface TaskMeta {
    evidenceKind?: string;
  }
}

describe('compiled micro-MVP acceptance evidence gate', () => {
  let corpus: CompiledMicroMvpAcceptanceCorpus;
  let denominator: MicroMvpCoverageDenominator;

  beforeAll(async () => {
    const [compiled, manifest] = await Promise.all([
      compileMicroMvpAcceptanceCorpus(),
      readMicroMvpSnapshotManifest(),
    ]);
    corpus = compiled;
    denominator = createMicroMvpCoverageDenominator(manifest);
  }, 60_000);

  it('materializes every released entity from the pinned compiled corpus and runs each through the common two-PC protocol', {
    timeout: 60_000,
    meta: {
      evidenceKind: 'compiled_release_scenario',
      semanticProtocol: 'compiled-release-corpus-v1',
      scenarioId: 'SC-COMPILED-RELEASE-CORPUS-01',
    },
  }, () => {
    const evidence = executeCompiledMicroMvpAcceptanceEvidence(corpus);

    expect(() => validateCompiledMicroMvpAcceptanceEvidence(corpus, evidence)).not.toThrow();
    expect(() => validateCompiledMicroMvpReleaseEntityCoverage(denominator, evidence)).not.toThrow();
    expect(evidence).toHaveLength(corpus.requiredBuildKeys.length);
    expect(denominator.entities.every((entity) => (
      evidence.filter((item) => item.cardNumber === entity.cardNumber).length === 1
    ))).toBe(true);
    expect(evidence.every((item) => (
      item.evidenceKind === 'compiled_build_fact'
        && item.commonTraceAssertionIds.length === 5
        && item.checkpointCount === 2
        && item.replayHash.startsWith('fnv1a32:')
    ))).toBe(true);
  });

  it('fails closed when an executed compiled fact is removed, duplicated, or replaced', () => {
    const evidence = executeCompiledMicroMvpAcceptanceEvidence(corpus);
    const missing = evidence.slice(1);
    expect(() => validateCompiledMicroMvpAcceptanceEvidence(corpus, missing))
      .toThrow(CompiledMicroMvpAcceptanceEvidenceError);

    const duplicated = [...evidence, evidence[0]];
    expect(() => validateCompiledMicroMvpAcceptanceEvidence(corpus, duplicated))
      .toThrow(/duplicate_fact/);

    const unexpected = [{
      ...evidence[0], entityId: 'forged-entity', assertionId: 'forged-assertion',
    }, ...evidence.slice(1)];
    expect(() => validateCompiledMicroMvpAcceptanceEvidence(corpus, unexpected))
      .toThrow(/unexpected_fact/);

    const releasedFact = evidence.find((item) => (
      denominator.entities.some((entity) => entity.cardNumber === item.cardNumber)
    ));
    expect(releasedFact).toBeDefined();
    expect(() => validateCompiledMicroMvpReleaseEntityCoverage(
      denominator,
      evidence.filter((item) => item !== releasedFact),
    )).toThrow(/missing_release_entity/);
    expect(() => validateCompiledMicroMvpReleaseEntityCoverage(
      denominator,
      [...evidence, releasedFact!],
    )).toThrow(/duplicate_release_entity/);
  }, 60_000);
});
