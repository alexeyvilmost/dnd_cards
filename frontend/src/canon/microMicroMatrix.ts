import type { BuildResult } from './autoBuild';

export interface MatrixEntity {
  id: string;
  name: string;
  card_number: string;
}

export interface MicroMicroMatrixScope {
  classes: MatrixEntity[];
  species: MatrixEntity[];
  backgrounds: MatrixEntity[];
  originFeats: MatrixEntity[];
}

export interface MicroMicroMatrixCase {
  key: string;
  klass: MatrixEntity;
  species: MatrixEntity;
  background: MatrixEntity;
  originFeat: MatrixEntity;
}

const REQUIRED_DIMENSION_SIZE = 4;

export function microMicroMatrixScopeIssues(scope: MicroMicroMatrixScope): string[] {
  return (Object.entries(scope) as Array<[keyof MicroMicroMatrixScope, MatrixEntity[]]>)
    .filter(([, entities]) => entities.length !== REQUIRED_DIMENSION_SIZE)
    .map(([dimension, entities]) =>
      `${dimension}: expected ${REQUIRED_DIMENSION_SIZE}, got ${entities.length}`);
}

/** Полное декартово произведение 4 класса × 4 вида × 4 предыстории × 4 черты. */
export function createMicroMicroMatrix(scope: MicroMicroMatrixScope): MicroMicroMatrixCase[] {
  const scopeIssues = microMicroMatrixScopeIssues(scope);
  if (scopeIssues.length) {
    throw new Error(`Invalid micro-micro matrix scope: ${scopeIssues.join('; ')}`);
  }

  const cases: MicroMicroMatrixCase[] = [];
  for (const klass of scope.classes) {
    for (const species of scope.species) {
      for (const background of scope.backgrounds) {
        for (const originFeat of scope.originFeats) {
          cases.push({
            key: [
              klass.card_number,
              species.card_number,
              background.card_number,
              originFeat.card_number,
            ].join(' × '),
            klass,
            species,
            background,
            originFeat,
          });
        }
      }
    }
  }
  return cases;
}

/** Инварианты готового персонажа, общие для каждой строки matrix-gate. */
export function microMicroBuildIssues(
  matrixCase: MicroMicroMatrixCase,
  result: BuildResult,
): string[] {
  const issues: string[] = [];
  if (result.assembled.klass?.id !== matrixCase.klass.id) issues.push('wrong class assembled');
  if (result.assembled.race?.id !== matrixCase.species.id) issues.push('wrong species assembled');
  if (result.assembled.background?.id !== matrixCase.background.id) issues.push('wrong background assembled');
  if (!result.assembled.feats.some((feat) => feat.id === matrixCase.originFeat.id)) {
    issues.push('selected origin feat is absent');
  }
  if (result.draft.level !== 1) issues.push(`expected level 1, got ${result.draft.level}`);
  if (result.draft.systemId !== 'dnd5e-2024') {
    issues.push(`wrong system: ${result.draft.systemId}`);
  }
  if (result.draft.rulesetVersion !== '2024') {
    issues.push(`wrong ruleset: ${result.draft.rulesetVersion}`);
  }
  if (result.draft.characterType !== 'free') {
    issues.push(`wrong character type: ${result.draft.characterType}`);
  }
  if (result.draft.characterSchemaVersion < 1) {
    issues.push(`invalid character schema: ${result.draft.characterSchemaVersion}`);
  }
  issues.push(...result.unresolvedNonSpell.map((issue) => `unresolved: ${issue}`));
  issues.push(...result.unresolvedSpell.map((issue) => `unresolved spell: ${issue}`));
  issues.push(...result.issues.map((issue) => `completion: ${issue}`));
  return [...new Set(issues)];
}
