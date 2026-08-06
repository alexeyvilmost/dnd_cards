import { beforeAll, describe, expect, it } from 'vitest';
import { canonicalStringify } from '../determinism';
import {
  COMPILED_MICRO_MVP_COMMON_TRACE,
  compileMicroMvpAcceptanceCorpus,
  runCompiledMicroMvpAcceptanceCase,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';

function claimKey(axis: string, entityId: string): string {
  return `${axis}:${entityId}`;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(segment in current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe('compiled micro-MVP acceptance corpus', () => {
  let corpus: CompiledMicroMvpAcceptanceCorpus;

  beforeAll(async () => {
    corpus = await compileMicroMvpAcceptanceCorpus();
  }, 60_000);

  it('selects a deterministic compiled-root cover for every released entity and selected derived source', () => {
    const observed = new Set(corpus.cases.flatMap((scenario) => (
      scenario.buildClaims.map((claim) => claimKey(claim.axis, claim.entityId))
    )));

    expect([...observed].sort()).toEqual(corpus.requiredBuildKeys);
    expect(corpus.cases.length).toBeGreaterThan(0);
    expect(new Set(corpus.cases.map((scenario) => scenario.subject.fixtureId)).size)
      .toBe(corpus.cases.length);
    for (const scenario of corpus.cases) {
      expect(scenario.provider.getActor(scenario.subject.fixtureId)?.compiledSource.stableKey)
        .toBe(scenario.subject.stableKey);
      expect(scenario.provider.getActor(scenario.support.fixtureId)?.compiledSource.stableKey)
        .toBe(scenario.support.stableKey);
      expect(scenario.subject.fixtureId).not.toBe(scenario.support.fixtureId);
      expect(scenario.provider.fixtureIds).toEqual(
        [scenario.subject.fixtureId, scenario.support.fixtureId].sort(),
      );
    }
  });

  it('runs every selected real compiled build with two PCs, strict turns, cross-character effects, the common trace, checkpoints, and exact replay', () => {
    for (const scenario of corpus.cases) {
      const run = runCompiledMicroMvpAcceptanceCase(scenario);

      expect(Object.values(run.initialState.actors)).toHaveLength(2);
      expect(Object.values(run.initialState.actors).every((actor) => actor.kind === 'playerCharacter'))
        .toBe(true);
      expect(run.rejections).toEqual([]);
      expect(run.observedTrace).toEqual([...COMPILED_MICRO_MVP_COMMON_TRACE].sort());
      expect(run.checkpoints).toHaveLength(2);
      expect(run.rngConsumed).toBe(scenario.spec.rollTape?.length);
      expect(canonicalStringify(run.finalState)).toBe(canonicalStringify(run.replayState));
      expect(run.finalState.scene.mode).toBe('encounter');
      expect(run.finalState.scene.mode === 'encounter' && run.finalState.scene.round)
        .toBeGreaterThanOrEqual(2);

      const declarations = run.events.flatMap((entry) => (
        entry.payload.type === 'ActionDeclared' ? [entry.payload] : []
      ));
      expect(declarations).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actorId: 'subject', actionId: 'core.action.hide', actionKind: 'nonSpell',
        }),
        expect.objectContaining({
          actorId: 'support', targetIds: ['subject'], actionKind: 'spell',
        }),
      ]));
      expect(run.assertionIds).toEqual(
        scenario.spec.steps.flatMap((step) => step.assertions.map((assertion) => assertion.id)),
      );
    }
  }, 60_000);

  it('proves each build identity with a separate named executable assertion', () => {
    for (const scenario of corpus.cases) {
      const run = runCompiledMicroMvpAcceptanceCase(scenario);
      for (const claim of scenario.buildClaims) {
        expect(run.assertionIds, `${scenario.id}:${claim.axis}:${claim.entityId}`)
          .toContain(claim.assertionId);
        expect(valueAtPath(run.finalState, claim.statePath)).toBe(claim.entityId);
      }
    }
  }, 60_000);
});
