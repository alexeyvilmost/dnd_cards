import { describe, expect, it } from 'vitest';
import {
  createMicroMicroMatrix,
  microMicroMatrixScopeIssues,
  type MatrixEntity,
} from './microMicroMatrix';

const entities = (prefix: string, count = 4): MatrixEntity[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-id-${index}`,
    name: `${prefix} ${index}`,
    card_number: `${prefix}-${index}`,
  }));

describe('micro-micro acceptance matrix', () => {
  it('строит ровно 256 уникальных сочетаний 4 × 4 × 4 × 4', () => {
    const cases = createMicroMicroMatrix({
      classes: entities('class'),
      species: entities('species'),
      backgrounds: entities('background'),
      originFeats: entities('feat'),
    });

    expect(cases).toHaveLength(256);
    expect(new Set(cases.map((matrixCase) => matrixCase.key))).toHaveLength(256);
    expect(new Set(cases.map((matrixCase) => matrixCase.klass.id))).toHaveLength(4);
    expect(new Set(cases.map((matrixCase) => matrixCase.species.id))).toHaveLength(4);
    expect(new Set(cases.map((matrixCase) => matrixCase.background.id))).toHaveLength(4);
    expect(new Set(cases.map((matrixCase) => matrixCase.originFeat.id))).toHaveLength(4);
  });

  it('не допускает тихое уменьшение одной из четырёх осей', () => {
    const scope = {
      classes: entities('class', 3),
      species: entities('species'),
      backgrounds: entities('background'),
      originFeats: entities('feat'),
    };

    expect(microMicroMatrixScopeIssues(scope)).toEqual(['classes: expected 4, got 3']);
    expect(() => createMicroMicroMatrix(scope)).toThrow('Invalid micro-micro matrix scope');
  });
});
