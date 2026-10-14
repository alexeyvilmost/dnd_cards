import { formatFormulaDisplay, type FormulaContext } from '../engine/formula';

/** Presentation only: never send the formatted text back to the evaluator. */
export function formulaPresentation(formula: string | number, ctx?: FormulaContext | null) {
  const full = formatFormulaDisplay(formula, ctx);
  // Remaining authoring identifiers/functions cannot give useful numbers in a
  // library preview. Resolved character values and simple dice remain visible.
  const complex = !['weapon', 'auto'].includes(String(formula).trim().toLowerCase())
    && (/[a-z_][a-z_\d]*\s*\(|[a-z_]+:[\w-]+|[a-z_]{2,}/i.test(full)
      || (full.length > 36 && /[+*/]/.test(full)));
  return { full, complex, text: complex ? 'Формула' : full };
}

export function linkFormulaTerms(text: string): string {
  return text.replace(/МЗ/g, '[[МЗ|concept:spellcasting_modifier]]');
}
