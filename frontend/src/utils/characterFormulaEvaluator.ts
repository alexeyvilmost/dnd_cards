import { CharacterRuleFormula, normalizeRuleIdentifier } from './characterRules';

export interface FormulaEvaluationResult {
  value: number;
  displayExpression: string;
  tokens: string[];
}

const tokenRegex = /\{([^{}]+)\}/g;

const normalizeTokenName = (token: string): string =>
  token.trim().toUpperCase().replace(/[\s-]+/g, '_');

const replaceMathFunctionsForEvaluation = (expression: string): string =>
  expression
    .replace(/\bmin\s*\(/gi, 'Math.min(')
    .replace(/\bmax\s*\(/gi, 'Math.max(')
    .replace(/\babs\s*\(/gi, 'Math.abs(')
    .replace(/\bfloor\s*\(/gi, 'Math.floor(')
    .replace(/\bceil\s*\(/gi, 'Math.ceil(');

const replaceMathFunctionsForDisplay = (expression: string): string =>
  expression
    .replace(/\bMath\.min\s*\(/gi, 'min(')
    .replace(/\bMath\.max\s*\(/gi, 'max(')
    .replace(/\bMath\.abs\s*\(/gi, 'abs(')
    .replace(/\bMath\.floor\s*\(/gi, 'floor(')
    .replace(/\bMath\.ceil\s*\(/gi, 'ceil(');

export const formatSignedValue = (value: number): string => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return '0';
  }
  if (value > 0) {
    return `+${value}`;
  }
  if (value < 0) {
    return `${value}`;
  }
  return '0';
};

export const evaluateCharacterFormula = (
  formula: string,
  rawContext: Record<string, number>
): FormulaEvaluationResult => {
  const context: Record<string, number> = {};
  Object.entries(rawContext).forEach(([key, value]) => {
    const normalizedKey = normalizeTokenName(key);
    context[normalizedKey] = Number.isFinite(value) ? Number(value) : 0;
  });

  const tokensUsed = new Set<string>();

  const expressionForEval = replaceMathFunctionsForEvaluation(
    formula.replace(tokenRegex, (_match, token) => {
      const normalizedToken = normalizeTokenName(token);
      tokensUsed.add(normalizedToken);
      const value = context[normalizedToken] ?? 0;
      return `(${value})`;
    })
  );

  const sanitizedForCheck = expressionForEval.replace(
    /Math\.(min|max|abs|floor|ceil)/g,
    ''
  );
  if (/[^0-9+\-*/().,\s]/.test(sanitizedForCheck)) {
    throw new Error(
      `[characterFormulaEvaluator] Недопустимые символы в формуле: ${expressionForEval}`
    );
  }

  let evaluatedValue = 0;
  try {
    // eslint-disable-next-line no-new-func
    evaluatedValue = Function(`"use strict"; return (${expressionForEval});`)();
  } catch (error) {
    console.error(
      '[characterFormulaEvaluator] Ошибка вычисления формулы:',
      formula,
      'контекст:',
      context,
      'ошибка:',
      error
    );
    evaluatedValue = 0;
  }

  if (!Number.isFinite(evaluatedValue)) {
    evaluatedValue = 0;
  }

  const displayExpression = replaceMathFunctionsForDisplay(
    formula.replace(tokenRegex, (_match, token) => {
      const normalizedToken = normalizeTokenName(token);
      const value = context[normalizedToken] ?? 0;
      return `(${formatSignedValue(value)})`;
    })
  );

  return {
    value: evaluatedValue,
    displayExpression,
    tokens: Array.from(tokensUsed),
  };
};

export const selectRuleFormula = (
  formulas: CharacterRuleFormula[],
  filters: Record<string, string>
): CharacterRuleFormula | undefined => {
  if (!formulas.length) {
    return undefined;
  }

  const normalizedFilters: Record<string, string> = {};
  Object.entries(filters).forEach(([key, value]) => {
    normalizedFilters[normalizeRuleIdentifier(key)] = normalizeRuleIdentifier(value);
  });

  let bestMatch: CharacterRuleFormula | undefined;
  let bestSpecificity = -1;

  formulas.forEach((formula) => {
    const conditionEntries = Object.entries(formula.conditions ?? {});
    if (
      conditionEntries.every(([conditionKey, conditionValue]) => {
        if (!conditionKey) {
          return true;
        }
        return normalizedFilters[conditionKey] === conditionValue;
      })
    ) {
      const specificity = conditionEntries.length;
      if (specificity > bestSpecificity) {
        bestMatch = formula;
        bestSpecificity = specificity;
      }
    }
  });

  if (!bestMatch) {
    bestMatch = formulas.find(
      (formula) => !formula.conditions || Object.keys(formula.conditions).length === 0
    );
  }

  return bestMatch;
};


