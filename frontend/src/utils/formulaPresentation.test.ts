import { describe, evaluate, rollFormula } from '../engine/formula';
import { formulaPresentation, linkFormulaTerms } from './formulaPresentation';
import { expect, it } from 'vitest';

it('links МЗ in presentation while preserving the executable identifier and rolls', () => {
  const raw = '2d8 + spellcasting';
  expect(formulaPresentation(raw)).toEqual({ full: '2к8 + МЗ', complex: false, text: '2к8 + МЗ' });
  expect(linkFormulaTerms(describe(raw))).toBe('2к8 + [[МЗ|concept:spellcasting_modifier]]');
  const ctx = { spellcastingMod: 3 };
  expect(evaluate('8 + spellcasting', ctx)).toBe(11);
  expect(rollFormula(raw, ctx, { rng: () => 0 }).total).toBe(5);
  expect(linkFormulaTerms(describe(raw, ctx))).toBe('2к8 + 3');
  expect(formulaPresentation(raw, {spellcastingMod:0}).text).toBe('2к8 + 0');
  expect(formulaPresentation(raw, {spellcastingMod:-2}).text).toBe('2к8 - 2');
});

it('collapses unresolved functions but keeps useful resolved character formulas', () => {
  expect(formulaPresentation('sum(dice) + spellcasting').text).toBe('Формула');
  expect(formulaPresentation('1d8 + floor(class_level:warrior / 2)').text).toBe('Формула');
  expect(formulaPresentation('1d8 + floor(class_level:warrior / 2)', {classLevels:{warrior:6}}).text).toBe('1к8 + 3');
  expect(formulaPresentation('1d10 + self_level').text).toBe('1к10 + уровень');
  expect(formulaPresentation('1 + str', {abilityMods:{str:4}}).text).toBe('5');
});
