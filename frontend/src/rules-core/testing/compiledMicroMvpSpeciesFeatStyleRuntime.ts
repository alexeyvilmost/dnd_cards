import type { CompiledMicroMvpL1Root } from '../../canon/microMvpL1Overlay';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
} from '../determinism';
import type {
  ActorState,
  RuleActionDefinition,
  RuleHazardDefinition,
  RulesCatalog,
} from '../domain';
import {
  COMPILED_MICRO_MVP_COMMON_TRACE,
  createCompiledMicroMvpAcceptanceCaseForRoot,
  type CompiledMicroMvpAcceptanceCase,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import type { CompiledMicroMvpScenarioFixtureProvider } from './compiledMicroMvpScenarioAdapter';
import {
  runScenario,
  type ScenarioRun,
  type ScenarioSpec,
} from './scenario';

export type RuntimeActorTransform = (actor: ActorState) => ActorState;

export interface CompiledRuntimeScenarioFoundation {
  acceptance: CompiledMicroMvpAcceptanceCase;
  root: CompiledMicroMvpL1Root;
  spec: ScenarioSpec;
  provider: CompiledMicroMvpScenarioFixtureProvider;
}

export function cloneRuntimeValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createCompiledRuntimeScenarioFoundation(input: {
  corpus: CompiledMicroMvpAcceptanceCorpus;
  root: CompiledMicroMvpL1Root;
  index: number;
  idPrefix: string;
}): CompiledRuntimeScenarioFoundation {
  const acceptance = createCompiledMicroMvpAcceptanceCaseForRoot(
    input.corpus,
    input.root,
    { index: input.index, idPrefix: input.idPrefix },
  );
  return {
    acceptance,
    root: input.root,
    spec: cloneRuntimeValue(acceptance.spec),
    provider: acceptance.provider,
  };
}

export function extendCompiledRuntimeProvider(input: {
  foundation: CompiledRuntimeScenarioFoundation;
  subject?: RuntimeActorTransform;
  support?: RuntimeActorTransform;
  actions?: readonly RuleActionDefinition[];
  hazards?: readonly RuleHazardDefinition[];
}): CompiledMicroMvpScenarioFixtureProvider {
  const { foundation } = input;
  const actionMap = new Map((input.actions ?? []).map((action) => [action.id, action]));
  const hazardMap = new Map((input.hazards ?? []).map((hazard) => [hazard.id, hazard]));
  const baseCatalog = foundation.provider.catalog;
  const catalog: RulesCatalog = {
    ...baseCatalog,
    getAction: (id) => actionMap.get(id) ?? baseCatalog.getAction(id),
    getHazard: (id) => hazardMap.get(id) ?? baseCatalog.getHazard?.(id),
  };
  return {
    ...foundation.provider,
    catalog,
    getActor: (fixtureId) => {
      const actor = foundation.provider.getActor(fixtureId);
      if (!actor) return undefined;
      const copied = cloneRuntimeValue(actor);
      if (fixtureId === foundation.acceptance.subject.fixtureId && input.subject) {
        return input.subject(copied) as ReturnType<typeof foundation.provider.getActor>;
      }
      if (fixtureId === foundation.acceptance.support.fixtureId && input.support) {
        return input.support(copied) as ReturnType<typeof foundation.provider.getActor>;
      }
      return copied;
    },
  };
}

export class CompiledRuntimeScenarioProtocolError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Compiled species/feat/style runtime protocol failed:\n${problems.join('\n')}`);
    this.name = 'CompiledRuntimeScenarioProtocolError';
  }
}

/**
 * A mechanism-specific suite may add steps before, inside, or after the shared
 * trace. This guard ensures it never weakens the two-PC chronology that makes
 * the test eligible as scenario evidence.
 */
export function runCompiledRuntimeScenario(input: {
  foundation: CompiledRuntimeScenarioFoundation;
  spec: ScenarioSpec;
  provider?: CompiledMicroMvpScenarioFixtureProvider;
  expectedRejections?: number;
}): ScenarioRun {
  const run = runScenario(input.spec, input.provider ?? input.foundation.provider, {
    clock: createLogicalClock(130_000),
    nextId: createSequentialIdFactory(`compiled-runtime:${input.spec.id}`),
  });
  const problems: string[] = [];
  const actors = Object.values(run.initialState.actors);
  if (actors.length !== 2 || actors.some((actor) => actor.kind !== 'playerCharacter')) {
    problems.push('scenario must instantiate exactly two player characters');
  }
  if (input.foundation.acceptance.subject.fixtureId
    === input.foundation.acceptance.support.fixtureId) {
    problems.push('subject and support compiled roots must be distinct');
  }
  if (canonicalStringify(run.observedTrace)
    !== canonicalStringify([...COMPILED_MICRO_MVP_COMMON_TRACE].sort())) {
    problems.push('shared nonspell/spell/condition/save/check trace is incomplete');
  }
  if (run.checkpoints.length < 2) {
    problems.push(`shared chronology requires at least two checkpoints; got ${run.checkpoints.length}`);
  }
  if (run.rejections.length !== (input.expectedRejections ?? 0)) {
    problems.push(`expected ${input.expectedRejections ?? 0} explicit rejection(s), got ${run.rejections.length}`);
  }
  if (run.rngConsumed !== input.spec.rollTape?.length) {
    problems.push('strict deterministic RNG tape was not consumed exactly');
  }
  if (canonicalStringify(run.finalState) !== canonicalStringify(run.replayState)) {
    problems.push('event replay diverged from authoritative final state');
  }
  if (run.finalState.scene.mode !== 'encounter' || run.finalState.scene.round < 2) {
    problems.push('strict two-PC turn sequence did not complete');
  }
  const commonAssertionSuffixes = [
    'TWO-PC-INITIATIVE',
    'NONSPELL-ACTION',
    'CONDITION-APPLIED',
    'ABILITY-CHECK',
    'SUBJECT-ENDS-TURN',
    'CROSS-PC-SPELL',
    'SAVING-THROW',
    'SUPPORT-ENDS-TURN',
    'BUILD-SURVIVES-CHECKPOINT',
    'SAVE-SURVIVES-CHECKPOINT',
  ];
  for (const suffix of commonAssertionSuffixes) {
    if (!run.assertionIds.some((id) => id.endsWith(`:${suffix}`))) {
      problems.push(`shared assertion ${suffix} did not execute`);
    }
  }
  const finalSubject = run.finalState.actors.subject as ActorState & {
    compiledSource?: { stableKey?: string };
  };
  if (finalSubject.compiledSource?.stableKey !== input.foundation.root.stableKey) {
    problems.push('compiled subject identity did not survive mechanism execution');
  }
  if (problems.length) throw new CompiledRuntimeScenarioProtocolError(problems);
  return run;
}
