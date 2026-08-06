import { beforeAll, describe, expect, it } from 'vitest';
import type { CompiledMicroMvpL1Root } from '../../canon/microMvpL1Overlay';
import { canonicalStringify } from '../determinism';
import type { WorldState } from '../domain';
import { migrateWorldState } from '../worldMigration';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import {
  createCompiledRuntimeScenarioFoundation,
  runCompiledRuntimeScenario,
} from './compiledMicroMvpSpeciesFeatStyleRuntime';

const FIGHTER = 'CLASS-warrior';
const DWARF = 'RACE-0003';
const TOUGH = 'FEAT-0005';
const ALERT = 'FEAT-0001';

let corpus: CompiledMicroMvpAcceptanceCorpus;
let tough: CompiledMicroMvpL1Root;
let baseline: CompiledMicroMvpL1Root;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing Tough scenario fixture: ${label}`);
  return value;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('compiled Tough mandatory two-player scenario evidence', () => {
  beforeAll(async () => {
    corpus = await compileMicroMvpAcceptanceCorpus();
    tough = required(corpus.compiled.roots.find((root) => (
      root.matrixCase.klass.card_number === FIGHTER
        && root.matrixCase.species.card_number === DWARF
        && root.matrixCase.originFeat.card_number === TOUGH
    )), 'level-1 Fighter with Tough');
    baseline = required(corpus.compiled.roots.find((root) => (
      root.matrixCase.klass.card_number === tough.matrixCase.klass.card_number
        && root.matrixCase.species.card_number === tough.matrixCase.species.card_number
        && root.matrixCase.background.card_number === tough.matrixCase.background.card_number
        && root.speciesAudit.lineageCardNumber === tough.speciesAudit.lineageCardNumber
        && root.matrixCase.originFeat.card_number === ALERT
    )), 'equivalent Fighter with Alert instead of Tough');
  }, 60_000);

  it('compiles Tough as exactly plus two level-1 HP then survives real two-PC spell damage, reload, migration, and replay', {
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-TOUGH-L1-01' },
  }, () => {
    expect(tough.actor.character.level).toBe(1);
    expect(baseline.actor.character.level).toBe(1);
    expect(tough.matrixCase.klass.id).toBe(baseline.matrixCase.klass.id);
    expect(tough.matrixCase.species.id).toBe(baseline.matrixCase.species.id);
    expect(tough.matrixCase.background.id).toBe(baseline.matrixCase.background.id);
    expect(tough.matrixCase.originFeat.card_number).toBe(TOUGH);
    expect(baseline.matrixCase.originFeat.card_number).toBe(ALERT);
    expect(tough.actor.runtime.hp.max - baseline.actor.runtime.hp.max).toBe(2);
    expect(tough.actor.runtime.hp.current - baseline.actor.runtime.hp.current).toBe(2);

    const foundation = createCompiledRuntimeScenarioFoundation({
      corpus,
      root: tough,
      index: 9_001,
      idPrefix: 'compiled-tough-mandatory',
    });
    const run = runCompiledRuntimeScenario({
      foundation,
      spec: copy(foundation.spec),
    });

    expect(Object.values(run.initialState.actors)).toHaveLength(2);
    expect(Object.values(run.initialState.actors).every((actor) => (
      actor.kind === 'playerCharacter'
    ))).toBe(true);
    expect(run.initialState.actors.subject.runtime.hp.max).toBe(tough.actor.runtime.hp.max);
    expect(run.finalState.actors.subject.runtime.hp.current)
      .toBeLessThan(run.initialState.actors.subject.runtime.hp.current);
    expect(run.events).toContainEqual(expect.objectContaining({
      sourceActorId: 'support',
      payload: expect.objectContaining({
        type: 'EngineEventRecorded',
        event: expect.objectContaining({ type: 'damage', damageType: 'thunder' }),
      }),
    }));
    expect(run.checkpoints.length).toBeGreaterThanOrEqual(2);
    for (const serialized of run.checkpoints) {
      const persisted = JSON.parse(serialized) as WorldState;
      const migrated = migrateWorldState(copy(persisted));
      expect(migrated.id).toBe(persisted.id);
      expect(migrated.revision).toBe(persisted.revision);
      expect(migrated.scene).toEqual(persisted.scene);
      expect(migrated.actors.subject.runtime.hp).toEqual(persisted.actors.subject.runtime.hp);
      expect(migrateWorldState(copy(migrated))).toEqual(migrated);
    }
    expect(canonicalStringify(run.replayState)).toBe(canonicalStringify(run.finalState));
    expect(run.rngConsumed).toBe(foundation.spec.rollTape?.length);
    expect(run.observedTrace).toEqual([
      'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
    ]);
  });
});
