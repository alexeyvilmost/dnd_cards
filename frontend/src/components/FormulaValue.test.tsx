import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CharacterFormulaProvider } from '../contexts/CharacterFormulaContext';
import FormulaValue from './FormulaValue';

it('links a symbolic spellcasting modifier and shows only its number in character context', () => {
  const formula = createElement(FormulaValue, {formula:'2d8 + spellcasting'});
  const symbolic = renderToStaticMarkup(formula);
  const resolved = renderToStaticMarkup(createElement(CharacterFormulaProvider, {value:{spellcastingMod:4}, children:formula}));
  expect(symbolic).toContain('/entity/concepts/spellcasting_modifier');
  expect(symbolic).toContain('2к8 + ');
  expect(resolved).toContain('2к8 + 4');
  expect(resolved).not.toContain('МЗ');
  expect(resolved).not.toContain('/entity/concepts/spellcasting_modifier');
});

it('offers a keyboard and touch trigger for unresolved functions without a native tooltip', () => {
  const html = renderToStaticMarkup(createElement(FormulaValue, {formula:'sum(dice) + spellcasting'}));
  expect(html).toContain('type="button"');
  expect(html).toContain('aria-label="Формула: sum ( dice ) + МЗ"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain('title=');
});
