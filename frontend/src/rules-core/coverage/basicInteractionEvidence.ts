import {
  matchingMicroMvpEvidenceExecutions,
  type ValidatedMicroMvpEvidenceExecutionManifest,
} from './microMvpEvidenceExecution';

export type BasicInteractionPrimitive =
  | 'attack'
  | 'resource_spend'
  | 'saving_throw'
  | 'ability_check';

interface BasicInteractionLocator {
  testFile: string;
  testName: string;
  evidenceKind: 'unit' | 'two_pc';
}

export interface BasicInteractionEvidenceContract {
  primitive: BasicInteractionPrimitive;
  unit: BasicInteractionLocator;
  twoPc: BasicInteractionLocator;
}

export const BASIC_INTERACTION_EVIDENCE: readonly BasicInteractionEvidenceContract[] = [
  {
    primitive: 'attack',
    unit: {
      testFile: 'src/rules-core/attackSequence.test.ts',
      testName: 'is pure across attack counts and survives a JSON checkpoint',
      evidenceKind: 'unit',
    },
    twoPc: {
      testFile: 'src/rules-core/attackRuntime.integration.test.ts',
      testName: 'uses the ruleset-owned weapon action, actor proficiency, durable budget, and byte-stable replay',
      evidenceKind: 'two_pc',
    },
  },
  {
    primitive: 'resource_spend',
    unit: {
      testFile: 'src/rules-core/spellcastingExecution.test.ts',
      testName: 'honors a declaration that preserves the free use and pays the ordinary slot',
      evidenceKind: 'unit',
    },
    twoPc: {
      testFile: 'src/rules-core/testing/fighterMandatoryProtocolScenarios.test.ts',
      testName: 'runs the Fighter L1 mandatory two-PC protocol through Second Wind and Topple with exact migration and replay',
      evidenceKind: 'two_pc',
    },
  },
  {
    primitive: 'saving_throw',
    unit: {
      testFile: 'src/rules-core/interactionPrimitives.test.ts',
      testName: 'opens a catalog-owned environment save and resumes its canonical consequence after JSON reload',
      evidenceKind: 'unit',
    },
    twoPc: {
      testFile: 'src/rules-core/testing/fighterMandatoryProtocolScenarios.test.ts',
      testName: 'runs the mandatory two-PC protocol then resumes one Topple save after accepted Shield without repeating damage or costs',
      evidenceKind: 'two_pc',
    },
  },
  {
    primitive: 'ability_check',
    unit: {
      testFile: 'src/rules-core/interactionPrimitives.test.ts',
      testName: 'applies Help and a generic one-shot bonus to the matching check and consumes only matching next-check effects',
      evidenceKind: 'unit',
    },
    twoPc: {
      testFile: 'src/rules-core/testing/compiledWarlockPactMandatoryScenarios.test.ts',
      testName: 'runs Pact Blade bond, replacement, focus, attack, pending-safe checkpoints, and explicit terminal lifecycle',
      evidenceKind: 'two_pc',
    },
  },
] as const;

export interface BasicInteractionEvidenceIssue {
  primitive: BasicInteractionPrimitive;
  message: string;
}

export class BasicInteractionEvidenceError extends Error {
  constructor(readonly issues: readonly BasicInteractionEvidenceIssue[]) {
    super([
      `Basic interaction evidence has ${issues.length} issue(s):`,
      ...issues.map((issue) => `[${issue.primitive}] ${issue.message}`),
    ].join('\n'));
    this.name = 'BasicInteractionEvidenceError';
  }
}

/**
 * Blocking release contract for reusable engine primitives. Each interaction
 * needs one focused test and one persisted two-player scenario from this exact
 * runner invocation, with metadata proving the test's intended evidence role.
 */
export function validateBasicInteractionEvidenceExecution(
  manifest: ValidatedMicroMvpEvidenceExecutionManifest,
): void {
  const issues: BasicInteractionEvidenceIssue[] = [];
  if (BASIC_INTERACTION_EVIDENCE.length !== 4
    || new Set(BASIC_INTERACTION_EVIDENCE.map((item) => item.primitive)).size !== 4) {
    throw new BasicInteractionEvidenceError([{
      primitive: 'attack',
      message: 'contract must contain exactly attack, resource_spend, saving_throw, and ability_check',
    }]);
  }
  for (const contract of BASIC_INTERACTION_EVIDENCE) {
    for (const locator of [contract.unit, contract.twoPc]) {
      const matches = matchingMicroMvpEvidenceExecutions(manifest, locator);
      if (matches.length !== 1) {
        issues.push({
          primitive: contract.primitive,
          message: `${locator.evidenceKind} locator matched ${matches.length} executions`,
        });
        continue;
      }
      const execution = matches[0];
      if (execution.state !== 'passed') {
        issues.push({
          primitive: contract.primitive,
          message: `${locator.evidenceKind} execution is ${execution.state}`,
        });
      }
      if (execution.meta.basicPrimitive !== contract.primitive
        || execution.meta.evidenceKind !== locator.evidenceKind) {
        issues.push({
          primitive: contract.primitive,
          message: `${locator.evidenceKind} execution metadata does not bind the primitive`,
        });
      }
    }
  }
  if (issues.length) throw new BasicInteractionEvidenceError(issues);
}
